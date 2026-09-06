/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Crée le premier compte admin BeTrack (Firebase Auth + document Firestore 'adminUsers').
 *
 * Nécessaire depuis que les comptes de démo pré-seedés (TEST_USERS, ex-lib/auth.ts) ont été
 * retirés : sans ce script, il n'existe aucun moyen de se connecter à une base Firestore vide,
 * puisque la création d'utilisateurs via le panneau Admin > Utilisateurs exige déjà d'être
 * connecté en admin.
 *
 * Utilise le SDK ADMIN (firebase-admin), pas le SDK client (firebase/*) : depuis le durcissement
 * de firestore.rules (isolation par entreprise), créer le document 'adminUsers/{username}' via le
 * SDK client est un problème d'œuf-et-de-poule — la règle de création exige déjà d'être admin,
 * ce qu'aucun compte n'est encore avant ce tout premier bootstrap. Le SDK Admin, authentifié par
 * des identifiants de service (ou automatiquement sans identifiants contre l'émulateur), ignore
 * les règles de sécurité par conception — c'est le mécanisme standard pour ce genre d'opération
 * "hors flux utilisateur normal", pas une façon de contourner les règles pour le reste de l'app.
 *
 * Usage (contre le VRAI projet Firebase — nécessite des identifiants de service, voir plus bas) :
 *   npm run create-admin
 *   npm run create-admin -- --username admin --password "un-mot-de-passe-solide" --first Admin --last BeTrack
 *
 * Usage contre l'ÉMULATEUR Firebase local (aucun identifiant requis, le SDK Admin les ignore quand
 * ces variables sont positionnées — voir `firebase emulators:start`) :
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     npm run create-admin -- --username admin --password test123456
 *
 * Identifiants requis contre le VRAI projet : soit `GOOGLE_APPLICATION_CREDENTIALS` pointant vers
 * une clé de compte de service JSON (Console Firebase > Paramètres du projet > Comptes de
 * service > Générer une nouvelle clé privée), soit `gcloud auth application-default login`
 * exécuté au préalable avec un compte ayant le rôle IAM Firebase Admin sur le projet.
 *
 * Lit la config Firebase (projectId) depuis .env.local (ou .env.production en fallback), comme
 * lib/firebase.ts. Idempotent : si le compte existe déjà côté Firebase Auth, le script met
 * simplement à jour le document Firestore correspondant plutôt que d'échouer.
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
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    console.error(
      "Config Firebase introuvable (NEXT_PUBLIC_FIREBASE_PROJECT_ID manquant) — vérifier .env.local."
    );
    process.exit(1);
  }

  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getAuth } = require("firebase-admin/auth");
  const { getFirestore } = require("firebase-admin/firestore");

  // Contre l'émulateur : FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST suffisent, le SDK
  // Admin les détecte tout seul et n'exige alors AUCUN identifiant de service. Contre le vrai
  // projet : applicationDefault() lit GOOGLE_APPLICATION_CREDENTIALS ou les identifiants posés par
  // `gcloud auth application-default login` — voir le commentaire d'en-tête pour la marche à suivre.
  const usingEmulator = Boolean(
    process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST
  );
  const app = initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    ...(usingEmulator ? {} : { credential: applicationDefault() }),
  });
  const auth = getAuth(app);
  const db = getFirestore(app);

  const normalizedUsername = username.trim().toLowerCase();
  const syntheticEmail = `${normalizedUsername}@betrack.local`;

  let uid;
  try {
    const created = await auth.createUser({ email: syntheticEmail, password });
    uid = created.uid;
    console.log(`Compte Firebase Auth créé pour "${normalizedUsername}".`);
  } catch (err) {
    if (err && err.code === "auth/email-already-exists") {
      const existing = await auth.getUserByEmail(syntheticEmail);
      uid = existing.uid;
      // Le mot de passe saisi n'écrase PAS celui d'un compte existant (comportement identique à
      // l'ancienne version basée sur le SDK client, qui tolérait déjà silencieusement ce cas) —
      // seul le document Firestore ci-dessous est (re)créé/mis à jour.
      console.log(`Compte Firebase Auth déjà existant pour "${normalizedUsername}" — inchangé.`);
    } else {
      console.error("Échec de la création du compte Firebase Auth :", err);
      process.exit(1);
    }
  }

  await db.doc(`adminUsers/${normalizedUsername}`).set({
    username: normalizedUsername,
    profiles: [],
    isGlobalAdmin: true,
    firstName: firstName || "Admin",
    lastName: lastName || "BeTrack",
    name: `${firstName || "Admin"} ${lastName || "BeTrack"}`,
    companyId: null,
  });
  console.log(
    `Document Firestore 'adminUsers/${normalizedUsername}' créé/mis à jour (uid ${uid}).`
  );
  console.log("Terminé — connexion possible avec cet identifiant sur l'écran de login.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
