import { deleteApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Next.js exécute ce module côté serveur (SSR/build) ET côté client : on ne réinitialise
// jamais une app déjà existante (HMR) et Firestore reste inerte tant qu'aucune requête
// n'est faite, donc l'absence de config pendant le build ne casse rien.
const app = getApps()[0] ?? initializeApp(firebaseConfig);

export const db = getFirestore(app);

// getAuth() (contrairement à getFirestore()) valide le format de l'apiKey de façon SYNCHRONE dès
// l'appel — sans config Firebase valide (ex. en CI, où aucune variable NEXT_PUBLIC_FIREBASE_* n'a
// jamais été nécessaire jusqu'ici), un `export const auth = getAuth(app)` évalué au chargement du
// module ferait planter tout import de lib/firebase.ts, y compris des tests qui ne s'authentifient
// jamais. On ne l'appelle donc qu'à la demande, la première fois qu'une vraie utilisation de l'auth
// se produit (connexion, écoute de session...) — jamais pendant le simple import du module.
let _auth: Auth | undefined;
export function getAuthInstance(): Auth {
  if (!_auth) _auth = getAuth(app);
  return _auth;
}

/**
 * Exécute `fn` sur une instance Firebase App/Auth SECONDAIRE, jetable, plutôt que sur l'instance
 * principale ci-dessus. Indispensable pour toute opération qui appelle
 * createUserWithEmailAndPassword en dehors d'un vrai flux d'inscription : le SDK client Firebase
 * connecte automatiquement l'utilisateur nouvellement créé sur l'instance Auth utilisée — sur
 * l'instance principale, cela écraserait silencieusement la session active (ex. un admin créant
 * un compte pour quelqu'un d'autre serait déconnecté de son propre compte, ou une session déjà
 * ouverte serait remplacée pendant un seed en arrière-plan). L'app secondaire est détruite dans
 * tous les cas (succès ou échec) pour ne pas fuiter de ressources.
 *
 * Utilisé par UsersPanel.tsx lors de la création d'un utilisateur d'entreprise par un admin, et
 * par scripts/create-admin.js lors du bootstrap du premier compte admin.
 */
export async function withSecondaryAuth<T>(fn: (secondaryAuth: Auth) => Promise<T>): Promise<T> {
  const secondaryApp: FirebaseApp = initializeApp(firebaseConfig, `auth-secondary-${Date.now()}`);
  try {
    return await fn(getAuth(secondaryApp));
  } finally {
    await deleteApp(secondaryApp);
  }
}
