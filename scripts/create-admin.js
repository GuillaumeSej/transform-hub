/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Crée le premier compte admin BeTrack (Firebase Auth + document Firestore 'adminUsers').
 *
 * Nécessaire depuis que les comptes de démo pré-seedés (TEST_USERS, ex-lib/auth.ts) ont été
 * retirés : sans ce script, il n'existe aucun moyen de se connecter à une base Firestore vide,
 * puisque la création d'utilisateurs via le panneau Admin > Utilisateurs exige déjà d'être
 * connecté en admin.
 *
 * Usage :
 *   npm run create-admin
 *   npm run create-admin -- --username admin --password "un-mot-de-passe-solide" --first Admin --last BeTrack
 *
 * Lit la config Firebase depuis .env.local (ou .env.production en fallback), comme lib/firebase.ts.
 * Idempotent : si le compte existe déjà côté Firebase Auth, le script met simplement à jour le
 * document Firestore correspondant plutôt que d'échouer.
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

// .env.local d'abord (dev local), .env.production en repli (mêmes valeurs pour ce projet Firebase).
loadEnvFile(path.resolve(__dirname, "..", ".env.local"));
loadEnvFile(path.resolve(__dirname, "..", ".env.production"));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "";
    out[key] = value;
  }
  return out;
}

function prompt(rl, question, { hidden = false } = {}) {
  if (!hidden) {
    return new Promise((resolve) => rl.question(question, resolve));
  }
  // Saisie masquée pour le mot de passe (pas de dépendance externe) : on intercepte l'écriture
  // du terminal pendant cette question précise et on la remplace par des '*'.
  return new Promise((resolve) => {
    const onWrite = rl._writeToOutput;
    rl._writeToOutput = (chunk) => {
      if (chunk.trim() === "" || chunk.includes("\n")) rl.output.write(chunk);
      else rl.output.write("*");
    };
    rl.question(question, (answer) => {
      rl._writeToOutput = onWrite;
      resolve(answer);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const username = args.username || (await prompt(rl, "Identifiant admin (ex: admin) : "));
  const password =
    args.password || (await prompt(rl, "Mot de passe (min. 6 caractères) : ", { hidden: true }));
  const firstName = args.first || (await prompt(rl, "Prénom : "));
  const lastName = args.last || (await prompt(rl, "Nom : "));
  rl.close();

  if (!username || !password) {
    console.error("Identifiant et mot de passe sont requis.");
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("Firebase Auth exige un mot de passe d'au moins 6 caractères.");
    process.exit(1);
  }
  if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    console.error(
      "Config Firebase introuvable (NEXT_PUBLIC_FIREBASE_API_KEY manquant) — vérifier .env.local."
    );
    process.exit(1);
  }

  const { initializeApp } = require("firebase/app");
  const { getAuth, createUserWithEmailAndPassword } = require("firebase/auth");
  const { getFirestore, doc, setDoc } = require("firebase/firestore");

  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const normalizedUsername = username.trim().toLowerCase();
  const syntheticEmail = `${normalizedUsername}@betrack.local`;

  try {
    await createUserWithEmailAndPassword(auth, syntheticEmail, password);
    console.log(`Compte Firebase Auth créé pour "${normalizedUsername}".`);
  } catch (err) {
    if (err && err.code === "auth/email-already-in-use") {
      console.log(`Compte Firebase Auth déjà existant pour "${normalizedUsername}" — inchangé.`);
    } else {
      console.error("Échec de la création du compte Firebase Auth :", err);
      process.exit(1);
    }
  }

  await setDoc(doc(db, "adminUsers", normalizedUsername), {
    username: normalizedUsername,
    role: "admin",
    firstName: firstName || "Admin",
    lastName: lastName || "BeTrack",
    name: `${firstName || "Admin"} ${lastName || "BeTrack"}`,
    companyId: null,
  });
  console.log(`Document Firestore 'adminUsers/${normalizedUsername}' créé/mis à jour.`);
  console.log("Terminé — connexion possible avec cet identifiant sur l'écran de login.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
