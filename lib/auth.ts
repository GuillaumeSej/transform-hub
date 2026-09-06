import type { AuthUser, ProfileAssignment, Role } from "@/types";

/**
 * Compatibilité round multi-profils : les documents `adminUsers` créés AVANT ce round portent un
 * unique champ `role: Role` (parfois avec la valeur historique "admin"/"admin_entreprise", qui ne
 * fait plus partie du type `Role`). Cette fonction lit l'un ou l'autre format et renvoie toujours
 * la forme `profiles`/`isGlobalAdmin`/`isCompanyAdmin` — aucune migration Firestore n'est requise
 * pour continuer à lire les anciens comptes ; `saveUser` (lib/firestore/admin.ts) réécrit toujours
 * au nouveau format dès le prochain enregistrement (voir aussi scripts/migrate-users-multi-profile.js
 * pour une conversion en masse, optionnelle).
 */
function normalizeProfileFields(data: Record<string, unknown>): {
  profiles: ProfileAssignment[];
  isGlobalAdmin: boolean;
  isCompanyAdmin: boolean;
} {
  if (Array.isArray(data.profiles)) {
    return {
      profiles: data.profiles as ProfileAssignment[],
      isGlobalAdmin: !!data.isGlobalAdmin,
      isCompanyAdmin: !!data.isCompanyAdmin,
    };
  }
  // Ancien format : un unique champ `role`.
  const legacyRole = data.role as string | undefined;
  if (legacyRole === "admin") return { profiles: [], isGlobalAdmin: true, isCompanyAdmin: false };
  if (legacyRole === "admin_entreprise")
    return { profiles: [], isGlobalAdmin: false, isCompanyAdmin: true };
  if (legacyRole)
    return {
      profiles: [{ role: legacyRole as Role }],
      isGlobalAdmin: false,
      isCompanyAdmin: false,
    };
  return { profiles: [], isGlobalAdmin: false, isCompanyAdmin: false };
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * Firebase Auth (méthode e-mail/mot de passe) exige une adresse e-mail valide ; nos identifiants
 * applicatifs ("admin", "test.cto", "admin.c1"...) n'en sont pas. Convention adoptée : chaque
 * compte a un e-mail SYNTHÉTIQUE, utilisé uniquement comme identifiant technique côté Firebase
 * Auth — jamais affiché, jamais un vrai e-mail joignable :
 *  - `${username}@betrack.local` pour un compte ADMIN GLOBAL (`companyId` null/omis) — un seul
 *    "royaume", pas de risque de collision entre entreprises.
 *  - `${username}.${companyId}@betrack.local` pour un compte D'ENTREPRISE — permet à un même
 *    `username` humain (ex. "alice") d'exister comme compte Firebase Auth DISTINCT, avec son
 *    propre mot de passe, dans plusieurs entreprises simultanément (round 5, demande explicite :
 *    "je veux ABSOLUMENT pas qu'une entreprise puisse avoir accès aux données d'une autre" — deux
 *    comptes Firebase Auth séparés, jamais un seul compte partagé entre entreprises).
 *
 * La partie locale de cet e-mail (avant le "@") est aussi l'ID du document Firestore
 * `adminUsers/{accountSlug}` correspondant (voir lib/firestore/admin.ts:saveUser et
 * firestore.rules) — accountSlugFromEmail() fait le trajet inverse.
 *
 * Point de passage unique entre l'identifiant applicatif (username [+ entreprise]) et le compte
 * Firebase Auth : toute création/connexion de compte doit passer par ici.
 */
export function usernameToSyntheticEmail(username: string, companyId?: string | null): string {
  const normalized = normalizeUsername(username);
  return companyId ? `${normalized}.${companyId}@betrack.local` : `${normalized}@betrack.local`;
}

/** ID du document `adminUsers` pour un (username, entreprise) donné — la partie locale de l'e-mail
 *  synthétique ci-dessus, exposée séparément parce que la couche Firestore (lib/firestore/admin.ts)
 *  en a besoin sans jamais construire d'e-mail (elle ne parle qu'à Firestore, pas à Firebase Auth). */
export function accountSlug(username: string, companyId?: string | null): string {
  const normalized = normalizeUsername(username);
  return companyId ? `${normalized}.${companyId}` : normalized;
}

/** Trajet inverse : accountSlug (= partie locale de l'e-mail synthétique) à partir de l'e-mail
 *  Firebase Auth complet — utilisé par useRole.tsx pour résoudre la session courante. */
export function accountSlugFromEmail(email: string): string {
  return email.split("@")[0];
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
 * utilisateur déjà authentifié auprès de Firebase Auth, à partir de son `accountSlug` (partie
 * locale de son e-mail synthétique = ID du document `adminUsers` — voir en-tête de fichier).
 * Lecture DIRECTE par id (`getDoc`), plus une requête par champ : depuis que l'accountSlug encode
 * déjà l'entreprise, il n'y a plus d'ambiguïté à lever. Factorisé ici pour être réutilisé à la fois
 * par signInUser() (connexion explicite) et useRole.tsx (résolution d'une session persistée
 * détectée via onAuthStateChanged) — une seule source de vérité pour ce mapping Firebase Auth ->
 * AuthUser.
 */
export async function resolveAuthUserProfile(slug: string): Promise<AuthUser> {
  const { doc, getDoc } = await import("firebase/firestore");
  const { db } = await import("@/lib/firebase");

  const snap = await getDoc(doc(db, "adminUsers", slug));
  if (!snap.exists()) {
    throw new Error("Compte authentifié mais profil introuvable — contacter un administrateur");
  }

  const data = snap.data();
  const { profiles, isGlobalAdmin, isCompanyAdmin } = normalizeProfileFields(data);
  return {
    username: data.username,
    password: data.password,
    profiles,
    isGlobalAdmin,
    isCompanyAdmin,
    firstName: data.firstName,
    lastName: data.lastName,
    name: data.name ?? `${data.firstName} ${data.lastName}`,
    companyId: data.companyId ?? null,
    confidentialityClearance: data.confidentialityClearance,
    direction: data.direction,
  };
}

/**
 * Connexion réelle : authentifie contre Firebase Auth (instance PRINCIPALE — cette session doit
 * persister normalement, contrairement au seed) puis résout le profil applicatif dans Firestore.
 * `companyId` : `null`/omis pour un compte ADMIN GLOBAL, l'id de l'entreprise choisie sur l'écran
 * de connexion pour un compte d'entreprise (voir app/login/page.tsx — le sélecteur d'entreprise
 * n'est affiché QUE si l'identifiant saisi existe dans plusieurs, résolu via companyDirectory
 * PUIS une tentative de connexion par entreprise candidate ; voir le composant pour le détail).
 * Si signInWithEmailAndPassword échoue (mauvais mot de passe, compte inexistant, méthode
 * e-mail/mot de passe désactivée côté console...), l'erreur Firebase remonte telle quelle à
 * l'appelant (voir app/login/page.tsx pour l'affichage). Si l'authentification réussit mais
 * qu'aucun profil Firestore ne correspond, resolveAuthUserProfile lève une erreur explicite.
 */
export async function signInUser(
  username: string,
  password: string,
  companyId?: string | null
): Promise<AuthUser> {
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  const { getAuthInstance } = await import("@/lib/firebase");

  await signInWithEmailAndPassword(
    getAuthInstance(),
    usernameToSyntheticEmail(username, companyId),
    password
  );
  return resolveAuthUserProfile(accountSlug(username, companyId));
}
