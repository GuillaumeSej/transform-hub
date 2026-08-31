import type { AuthUser } from "@/types";

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * Firebase Auth (méthode e-mail/mot de passe) exige une adresse e-mail valide ; nos identifiants
 * applicatifs ("admin", "test.cto", "admin.c1"...) n'en sont pas. Convention adoptée : chaque
 * compte a un e-mail SYNTHÉTIQUE `${username normalisé}@betrack.local`, utilisé uniquement comme
 * identifiant technique côté Firebase Auth — jamais affiché, jamais un vrai e-mail joignable.
 * Point de passage unique entre l'identifiant applicatif (username) et le compte Firebase Auth :
 * toute création/connexion de compte doit passer par ici.
 */
export function usernameToSyntheticEmail(username: string): string {
  return `${normalizeUsername(username)}@betrack.local`;
}

/** Exportée : réutilisée par UsersPanel.tsx pour ignorer 'auth/email-already-in-use' de la même
 *  façon lors de la création d'un compte Firebase Auth par un admin. */
export function isFirebaseErrorCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}

/**
 * Résout le profil applicatif complet (role, companyId, name, confidentialityClearance...) d'un
 * utilisateur déjà authentifié auprès de Firebase Auth, à partir de son username, en cherchant le
 * document Firestore 'adminUsers' correspondant. Factorisé ici pour être réutilisé à la fois par
 * signInUser() (connexion explicite) et useRole.tsx (résolution d'une session persistée détectée
 * via onAuthStateChanged) — une seule source de vérité pour ce mapping Firebase Auth -> AuthUser.
 */
export async function resolveAuthUserProfile(username: string): Promise<AuthUser> {
  const { collection, getDocs, query, where } = await import("firebase/firestore");
  const { db } = await import("@/lib/firebase");

  const q = query(
    collection(db, "adminUsers"),
    where("username", "==", normalizeUsername(username))
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    throw new Error("Compte authentifié mais profil introuvable — contacter un administrateur");
  }

  const data = snapshot.docs[0].data();
  return {
    username: data.username,
    password: data.password,
    role: data.role,
    firstName: data.firstName,
    lastName: data.lastName,
    name: data.name ?? `${data.firstName} ${data.lastName}`,
    companyId: data.companyId ?? null,
    confidentialityClearance: data.confidentialityClearance,
  };
}

/**
 * Connexion réelle : authentifie contre Firebase Auth (instance PRINCIPALE — cette session doit
 * persister normalement, contrairement au seed) puis résout le profil applicatif dans Firestore.
 * Si signInWithEmailAndPassword échoue (mauvais mot de passe, compte inexistant, méthode
 * e-mail/mot de passe désactivée côté console...), l'erreur Firebase remonte telle quelle à
 * l'appelant (voir app/login/page.tsx pour l'affichage). Si l'authentification réussit mais
 * qu'aucun profil Firestore ne correspond, resolveAuthUserProfile lève une erreur explicite.
 */
export async function signInUser(username: string, password: string): Promise<AuthUser> {
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  const { getAuthInstance } = await import("@/lib/firebase");

  await signInWithEmailAndPassword(getAuthInstance(), usernameToSyntheticEmail(username), password);
  return resolveAuthUserProfile(username);
}
