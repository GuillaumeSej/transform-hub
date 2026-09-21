/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Seed ponctuel : entreprise démo agro-industrie ("AgroVerde International") pour une démo
 * commerciale. Crée l'entreprise, le programme Performance, la config legacy programme/workstreams
 * (meta/program__{companyId}, requis par useStorage pour afficher les workstreams) et les comptes
 * utilisateurs (Firebase Auth + adminUsers), mot de passe "test123" pour tous.
 *
 * Volontairement NE crée PAS les leviers/l'arborescence/la base ETP : ces données sont importées
 * en live pendant la démo via les 4 fichiers Excel générés par scripts/generate-agro-demo-excel.js,
 * pour démontrer la fonctionnalité d'import (voir lib/leverExcelImport.ts, lib/hierarchyExcel.ts,
 * lib/hrExcel.ts).
 *
 * Auth : utilise le token OAuth déjà obtenu par `firebase login` (aucune clé de service compte
 * disponible en local) — voir loadCliCredential() ci-dessous. Ne PAS committer ce script avec des
 * identifiants en dur : il ne lit que ~/.config/configstore/firebase-tools.json (session locale de
 * l'utilisateur), rien n'est écrit dans le repo.
 *
 * Usage : node scripts/seed-agro-demo.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
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
if (!PROJECT_ID) throw new Error("NEXT_PUBLIC_FIREBASE_PROJECT_ID introuvable dans .env.local");

/** Réutilise la session OAuth de `firebase login` (mêmes scopes que le CLI, dont cloud-platform)
 *  au lieu d'une clé de service compte — évite de générer/stocker un fichier secret pour un script
 *  ponctuel de démo. Le SDK Admin Firestore n'accepte qu'un credential "certificate" ou
 *  "application default" (voir node_modules/firebase-admin/lib/firestore/firestore-internal.js) —
 *  un objet { getAccessToken } custom marche pour Auth mais pas pour Firestore. On régénère donc
 *  le même fichier ADC "authorized_user" que `firebase-tools` construit en interne
 *  (lib/defaultCredentials.js : client_id/client_secret publics du CLI Firebase + notre propre
 *  refresh_token de session, jamais committés) et on pointe GOOGLE_APPLICATION_CREDENTIALS dessus. */
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
const auth = getAuth(app);
const db = getFirestore(app);

// ---------- lib/auth.ts, réimplémenté en JS brut (pas d'alias TS ici) ----------
function usernameToSyntheticEmail(username, companyId) {
  const normalized = username.trim().toLowerCase();
  return companyId ? `${normalized}.${companyId}@betrack.local` : `${normalized}@betrack.local`;
}
function accountSlug(username, companyId) {
  const normalized = username.trim().toLowerCase();
  return companyId ? `${normalized}.${companyId}` : normalized;
}

const COMPANY_ID = "agroverde-demo";
const PROGRAM_ID = "prog-agroverde-perf";
const PASSWORD = "test123";
const TODAY = new Date().toISOString().slice(0, 10);

const company = {
  id: COMPANY_ID,
  name: "AgroVerde International",
  industry: "Agro-industrie",
  createdAt: TODAY,
  fyStart: "2026-01-01",
  fyEnd: "2026-12-31",
  confidentialityLevels: ["Public", "Confidentiel"],
  hierarchyLevels: [
    { key: "pnl", label: "P&L", order: 0, semantic: "pnl" },
    { key: "cost_center", label: "Centre de coût", order: 1 },
  ],
  geographyHierarchyLevels: [
    { key: "continent", label: "Continent", order: 0, semantic: "continent" },
    { key: "country", label: "Pays", order: 1, semantic: "country" },
    { key: "plant", label: "Usine", order: 2 },
  ],
};

const program = {
  id: PROGRAM_ID,
  companyId: COMPANY_ID,
  name: "Programme Performance 2026",
  sponsor: "youssef.benali",
  owner: "admin.agrov",
  currency: "EUR",
  fyStart: "2026-01-01",
  fyEnd: "2026-12-31",
  baselineEBIT: 68,
  revenue: 850,
  createdAt: TODAY,
  type: "performance",
  actionPlanEnabled: true,
  ambition:
    "Renforcer la compétitivité industrielle et logistique du groupe en Europe et en Afrique.",
};

// meta/program__{companyId} : config legacy (nom/sponsor/target affichés sur le dashboard exécutif)
// + workstreams, partagées par toute l'entreprise (voir lib/firestore/programConfig.ts).
const workstreams = [
  {
    id: "WS-ACH",
    name: "Achats & Approvisionnement",
    sponsor: "Youssef Benali",
    sponsorUsername: "youssef.benali",
    function: "Procurement",
    color: "#C8281A",
    target: 9.8,
  },
  {
    id: "WS-PROD",
    name: "Production & Industriel",
    sponsor: "Youssef Benali",
    sponsorUsername: "youssef.benali",
    function: "Operations",
    color: "#E68900",
    target: 11.9,
  },
  {
    id: "WS-LOG",
    name: "Supply Chain & Logistique",
    sponsor: "Youssef Benali",
    sponsorUsername: "youssef.benali",
    function: "Supply Chain",
    color: "#2E7D32",
    target: 3.5,
  },
  {
    id: "WS-COM",
    name: "Commercial & Marketing",
    sponsor: "Camille Nguyen",
    sponsorUsername: "admin.agrov",
    function: "Sales",
    color: "#1565C0",
    target: 2.9,
  },
  {
    id: "WS-DIGIT",
    name: "Digital & IT",
    sponsor: "Camille Nguyen",
    sponsorUsername: "admin.agrov",
    function: "IT",
    color: "#6A1B9A",
    target: 3.5,
  },
  {
    id: "WS-RH",
    name: "RH & Support",
    sponsor: "Camille Nguyen",
    sponsorUsername: "admin.agrov",
    function: "HR",
    color: "#00838F",
    target: 2.2,
  },
];

const programConfigDoc = {
  program: {
    id: PROGRAM_ID,
    name: program.name,
    sponsor: "Youssef Benali",
    target: workstreams.reduce((s, w) => s + w.target, 0),
    currency: "EUR",
    fyStart: program.fyStart,
    fyEnd: program.fyEnd,
    baselineEBIT: program.baselineEBIT,
    revenue: program.revenue,
  },
  workstreams,
};

// ---------- Utilisateurs (mot de passe "test123" pour tous) ----------
const users = [
  {
    username: "admin.agrov",
    firstName: "Camille",
    lastName: "Nguyen",
    isCompanyAdmin: true,
    profiles: [{ role: "cto", programId: PROGRAM_ID }],
  },
  {
    username: "youssef.benali",
    firstName: "Youssef",
    lastName: "Benali",
    profiles: [{ role: "sponsor", programId: PROGRAM_ID }],
  },
  {
    username: "elodie.marchand",
    firstName: "Élodie",
    lastName: "Marchand",
    profiles: [{ role: "finance", programId: PROGRAM_ID }],
  },
  {
    username: "aicha.ndiaye",
    firstName: "Aïcha",
    lastName: "Ndiaye",
    profiles: [{ role: "hr", programId: PROGRAM_ID }],
  },
  {
    username: "thomas.girard",
    firstName: "Thomas",
    lastName: "Girard",
    profiles: [{ role: "ops", programId: PROGRAM_ID }],
  },
  {
    username: "marc.lefevre",
    firstName: "Marc",
    lastName: "Lefèvre",
    profiles: [{ role: "lever", programId: PROGRAM_ID }],
  },
  {
    username: "yasmine.elamrani",
    firstName: "Yasmine",
    lastName: "El Amrani",
    profiles: [{ role: "lever", programId: PROGRAM_ID }],
  },
  {
    username: "fatou.diarra",
    firstName: "Fatou",
    lastName: "Diarra",
    profiles: [{ role: "lever", programId: PROGRAM_ID }],
  },
  {
    username: "julien.meyer",
    firstName: "Julien",
    lastName: "Meyer",
    profiles: [{ role: "lever", programId: PROGRAM_ID }],
  },
  {
    username: "nadia.cherif",
    firstName: "Nadia",
    lastName: "Cherif",
    profiles: [{ role: "lever", programId: PROGRAM_ID }],
  },
  {
    username: "karim.belhadj",
    firstName: "Karim",
    lastName: "Belhadj",
    profiles: [{ role: "lever", programId: PROGRAM_ID }],
  },
  {
    username: "sophie.rousseau",
    firstName: "Sophie",
    lastName: "Rousseau",
    profiles: [{ role: "lever", programId: PROGRAM_ID }],
  },
  {
    username: "amadou.traore",
    firstName: "Amadou",
    lastName: "Traoré",
    profiles: [{ role: "lever", programId: PROGRAM_ID }],
  },
];

function stripUndefined(value) {
  return JSON.parse(JSON.stringify(value));
}

async function upsertAuthUser(email, password) {
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, { password });
    return existing.uid;
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      const created = await auth.createUser({ email, password });
      return created.uid;
    }
    throw err;
  }
}

async function main() {
  console.log(`Projet Firebase : ${PROJECT_ID}`);

  console.log(`Entreprise "${company.name}" (${company.id})...`);
  await db.doc(`companies/${company.id}`).set(stripUndefined(company));
  await db.doc(`companyDirectory/${company.id}`).set({ id: company.id, name: company.name });

  console.log(`Programme "${program.name}" (${program.id})...`);
  await db.doc(`programs/${program.id}`).set(stripUndefined(program));

  console.log(
    `Config programme legacy + ${workstreams.length} workstreams (meta/program__${company.id})...`
  );
  await db.doc(`meta/program__${company.id}`).set(stripUndefined(programConfigDoc));

  console.log(`${users.length} utilisateur(s)...`);
  for (const u of users) {
    const email = usernameToSyntheticEmail(u.username, company.id);
    const slug = accountSlug(u.username, company.id);
    const uid = await upsertAuthUser(email, PASSWORD);
    const authUser = {
      username: u.username,
      password: PASSWORD, // legacy field, non utilisé pour l'auth réelle (voir lib/auth.ts)
      profiles: u.profiles ?? [],
      isGlobalAdmin: false,
      isCompanyAdmin: !!u.isCompanyAdmin,
      firstName: u.firstName,
      lastName: u.lastName,
      name: `${u.firstName} ${u.lastName}`,
      companyId: company.id,
    };
    await db.doc(`adminUsers/${slug}`).set(stripUndefined(authUser));
    console.log(
      `  - ${u.username} <${email}> (uid ${uid}) — ${u.isCompanyAdmin ? "admin entreprise" : u.profiles.map((p) => p.role).join(",")}`
    );
  }

  console.log("\nTerminé. Connexion : identifiant = username ci-dessus, mot de passe = test123.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
