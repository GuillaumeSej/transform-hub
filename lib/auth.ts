import type { AuthUser } from "@/types";

/**
 * Comptes de démo — connexion réelle par identifiant/mot de passe (mot de passe "test123" pour
 * les 8 — Firebase Auth exige au moins 6 caractères, "test" seul est rejeté), mais toujours des
 * comptes de test, pas une vraie authentification. `name` doit correspondre
 * exactement au champ `owner` des leviers de démo qu'on veut voir apparaître pour ce compte (voir
 * data/mockData.ts, leviers rattachés au Lever Owner de test).
 */
export const TEST_USERS: AuthUser[] = [
  {
    username: "admin",
    password: "test123",
    role: "admin",
    firstName: "Admin",
    lastName: "BeTrack",
    name: "Admin BeTrack",
    companyId: null,
  },
  {
    username: "admin.c1",
    password: "test123",
    role: "admin_entreprise",
    firstName: "Admin",
    lastName: "Acme",
    name: "Admin Acme",
    companyId: "c1",
  },
  {
    username: "test.cto",
    password: "test123",
    role: "cto",
    firstName: "Jean",
    lastName: "Dupont",
    name: "Jean Dupont",
    companyId: "c1",
  },
  {
    username: "test.sponsor",
    password: "test123",
    role: "sponsor",
    firstName: "Marie",
    lastName: "Martin",
    name: "Marie Martin",
    companyId: "c1",
  },
  {
    username: "test.lever",
    password: "test123",
    role: "lever",
    firstName: "Pierre",
    lastName: "Bernard",
    name: "Pierre Bernard",
    companyId: "c1",
  },
  {
    username: "test.finance",
    password: "test123",
    role: "finance",
    firstName: "Sophie",
    lastName: "Dubois",
    name: "Sophie Dubois",
    companyId: "c1",
  },
  {
    username: "test.hr",
    password: "test123",
    role: "hr",
    firstName: "Claire",
    lastName: "Moreau",
    name: "Claire Moreau",
    companyId: "c1",
  },
  {
    username: "test.ops",
    password: "test123",
    role: "ops",
    firstName: "Lucas",
    lastName: "Petit",
    name: "Lucas Petit",
    companyId: "c1",
  },
];

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

let authUsersSeeded = false;

/**
 * Crée le compte Firebase Auth de chaque TEST_USERS s'il n'existe pas déjà — idempotent (même
 * pattern que ensureAdminSeeded() dans lib/firestore/admin.ts, mais côté Auth plutôt que
 * Firestore). Nécessaire pour que les comptes de démo soient réellement utilisables via
 * signInUser() : TEST_USERS ne décrit que la donnée de seed, pas des comptes Firebase existants.
 *
 * Tourne sur une instance Auth SECONDAIRE (voir withSecondaryAuth dans lib/firebase.ts) : sinon
 * createUserWithEmailAndPassword connecterait le navigateur en tant que dernier compte de démo
 * créé, écrasant une session déjà active pendant ce seed en arrière-plan.
 *
 * 'auth/email-already-in-use' est ignorée (compte déjà seedé lors d'un run précédent). Toute
 * autre erreur — notamment 'auth/configuration-not-found' (produit Authentication jamais activé
 * pour ce projet Firebase) ou 'auth/operation-not-allowed' (méthode e-mail/mot de passe non
 * activée dans Firebase Console > Authentication > Sign-in method) — est un vrai problème de
 * configuration : elle est loggée ET remontée à l'appelant, jamais avalée silencieusement.
 */
export async function ensureAuthUsersSeeded(): Promise<void> {
  if (authUsersSeeded) return;
  authUsersSeeded = true;

  try {
    const { withSecondaryAuth } = await import("@/lib/firebase");
    const { createUserWithEmailAndPassword } = await import("firebase/auth");

    await withSecondaryAuth(async (secondaryAuth) => {
      for (const u of TEST_USERS) {
        try {
          await createUserWithEmailAndPassword(
            secondaryAuth,
            usernameToSyntheticEmail(u.username),
            u.password
          );
        } catch (err) {
          if (isFirebaseErrorCode(err, "auth/email-already-in-use")) continue;
          console.error(
            `[ensureAuthUsersSeeded] Échec de création du compte Firebase Auth pour "${u.username}" — ` +
              `la méthode "Adresse e-mail/Mot de passe" est-elle activée dans Firebase Console > ` +
              `Authentication > Sign-in method ?`,
            err
          );
          throw err;
        }
      }
    });
  } catch (err) {
    // Ne pas laisser un run raté empêcher tout nouvel essai (ex. l'admin vient d'activer la
    // méthode e-mail/mot de passe côté console après un premier échec) : sur les rechargements,
    // ensureAuthUsersSeeded() ré-essaiera plutôt que de rester bloqué "déjà tenté".
    authUsersSeeded = false;
    throw err;
  }
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
