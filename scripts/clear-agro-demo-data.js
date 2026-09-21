/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Nettoie les données "leviers" et "workforce" (base ETP + mouvements) de l'entreprise démo
 * AgroVerde (companyId "agroverde-demo") pour repartir d'une ardoise propre avant un réimport en
 * live pendant la démo — voir scripts/seed-agro-demo.js (entreprise/programme/utilisateurs,
 * INTACTS ici) et scripts/generate-agro-demo-excel.js (fichiers à réimporter).
 *
 * NE touche PAS : companies/, companyDirectory/, programs/, meta/program__agroverde-demo
 * (workstreams), adminUsers/ — uniquement les leviers + workforce + traces qui en dépendent.
 *
 * Usage : node scripts/clear-agro-demo-data.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

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
loadEnvFile(path.resolve(__dirname, "..", ".env.local"));
loadEnvFile(path.resolve(__dirname, "..", ".env.production"));

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const COMPANY_ID = "agroverde-demo";

function loadCliCredential() {
  const configPath = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const tokens = raw.tokens;
  if (!tokens?.refresh_token) {
    throw new Error("Pas de refresh_token trouvé — lance `npx firebase-tools login` d'abord.");
  }
  const adc = {
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
    refresh_token: tokens.refresh_token,
    type: "authorized_user",
  };
  const adcPath = path.join(os.tmpdir(), "betrack-seed-adc.json");
  fs.writeFileSync(adcPath, JSON.stringify(adc), { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
  return applicationDefault();
}

const app = initializeApp({ credential: loadCliCredential(), projectId: PROJECT_ID });
const db = getFirestore(app);

async function deleteCollectionWhere(collectionName, field, value) {
  const snap = await db.collection(collectionName).where(field, "==", value).get();
  if (snap.empty) {
    console.log(`  - ${collectionName} : rien à supprimer`);
    return;
  }
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  console.log(`  - ${collectionName} : ${snap.size} document(s) supprimé(s)`);
}

async function deleteDocIfExists(path_) {
  const ref = db.doc(path_);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`  - ${path_} : n'existe pas`);
    return;
  }
  await ref.delete();
  console.log(`  - ${path_} : supprimé`);
}

async function main() {
  console.log(`Nettoyage des données leviers/workforce pour "${COMPANY_ID}"...`);
  await deleteCollectionWhere("levers", "companyId", COMPANY_ID);
  await deleteCollectionWhere("subLevers", "companyId", COMPANY_ID); // legacy, vide normalement
  await deleteDocIfExists(`leverMeta/${COMPANY_ID}__workforceEmployees`);
  await deleteDocIfExists(`leverMeta/${COMPANY_ID}__workforceMovements`);
  await deleteDocIfExists(`leverMeta/${COMPANY_ID}__workforceSummary`);
  await deleteDocIfExists(`leverMeta/${COMPANY_ID}__comments`);
  await deleteDocIfExists(`leverMeta/${COMPANY_ID}__auditLog`);
  console.log("Terminé — entreprise/programme/workstreams/utilisateurs conservés intacts.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
