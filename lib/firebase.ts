import { getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

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
