/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Crée en masse les comptes BeTrack (Firebase Auth + document Firestore 'adminUsers') des
 * responsables de leviers ("Owner") listés dans un fichier Excel de leviers (colonnes "Owner",
 * "Owner (initiales)", "Entité", "Fonction" — voir demo/leviers_demo.xlsx pour le format).
 *
 * Un seul compte est créé par nom "Owner" distinct (déduplication). Le rôle applicatif assigné
 * est "lever" (responsable de levier) par défaut.
 *
 * Mode par défaut = DRY-RUN : affiche la liste des comptes qui seraient créés, sans rien écrire
 * ni contacter Firebase. Ajouter --apply pour écrire réellement.
 *
 * Usage (dry-run) :
 *   npm run bulk-create-lever-owners -- --company-id rs-associes
 *
 * Usage réel (contre le VRAI projet Firebase — nécessite des identifiants de service, voir
 * scripts/create-admin.js pour le détail GOOGLE_APPLICATION_CREDENTIALS / gcloud) :
 *   npm run bulk-create-lever-owners -- --company-id rs-associes --apply
 *
 * Usage contre l'ÉMULATEUR Firebase local (aucun identifiant requis) :
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     npm run bulk-create-lever-owners -- --company-id rs-associes --apply
 *
 * --company-id est l'id EXACT du document Firestore 'companies/{id}' tel que créé sur la
 * plateforme (visible dans l'écran Admin > Entreprises, ou dans l'URL/Firestore) — PAS le nom
 * affiché ("RS & Associés"). Le script échoue explicitement si cet argument est absent.
 *
 * Chaque compte reçoit un mot de passe temporaire généré aléatoirement. En mode --apply, ces
 * mots de passe sont écrits UNIQUEMENT dans un fichier local horodaté sous scripts/output/
 * (jamais dans Git — voir .gitignore), à charge pour l'administrateur de les transmettre aux
 * intéressés puis de les inviter à changer leur mot de passe.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    out[key] = value;
  }
  return out;
}

function stripAccents(str) {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function usernameFromName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const lastName = parts.pop();
  const firstName = parts.join(" ");
  const slug = (s) =>
    stripAccents(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return { firstName, lastName, username: `${slug(firstName)}.${slug(lastName)}` };
}

function randomPassword() {
  // 12 caractères alnum, lisibles (pas de 0/O/1/l ambigus), suffisant pour un mot de passe
  // temporaire à changer à la première connexion.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(12))
    .map((b) => alphabet[b % alphabet.length])
    .join("");
}

function extractOwners(xlsxPath) {
  const XLSX = require("xlsx");
  const wb = XLSX.readFile(xlsxPath);
  const sheet = wb.Sheets["Leviers"];
  if (!sheet) throw new Error(`Feuille "Leviers" introuvable dans ${xlsxPath}`);
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  const owners = new Map();
  for (const row of rows) {
    const name = row["Owner"];
    if (!name) continue;
    if (!owners.has(name)) {
      const { firstName, lastName, username } = usernameFromName(name);
      owners.set(name, {
        name,
        firstName,
        lastName,
        username,
        initiales: row["Owner (initiales)"] || null,
        entites: new Set(),
        fonctions: new Set(),
      });
    }
    const o = owners.get(name);
    if (row["Entité"]) o.entites.add(row["Entité"]);
    if (row["Fonction"]) o.fonctions.add(row["Fonction"]);
  }
  return Array.from(owners.values()).map((o) => ({
    ...o,
    entites: Array.from(o.entites),
    fonctions: Array.from(o.fonctions),
    direction: Array.from(o.fonctions).join(" / "),
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = args.apply === "true";
  const role = args.role || "lever";
  const companyId = args["company-id"];
  const xlsxPath = args.file
    ? path.resolve(process.cwd(), args.file)
    : path.resolve(__dirname, "..", "demo", "leviers_demo.xlsx");

  if (!companyId) {
    console.error(
      "--company-id est requis (id exact du document Firestore 'companies/{id}' de l'entreprise, pas son nom affiché)."
    );
    process.exit(1);
  }
  if (!fs.existsSync(xlsxPath)) {
    console.error(`Fichier introuvable : ${xlsxPath}`);
    process.exit(1);
  }

  const owners = extractOwners(xlsxPath);
  console.log(`${owners.length} responsable(s) de levier distinct(s) trouvé(s) dans ${xlsxPath} :`);
  for (const o of owners) {
    console.log(
      `  - ${o.name} (${o.username}) — ${o.direction || "sans fonction"} — ${o.entites.join(", ")}`
    );
  }

  if (!apply) {
    console.log(
      "\nDry-run (par défaut) : aucun compte créé. Relancer avec --apply pour écrire réellement."
    );
    process.exit(0);
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

  const usingEmulator = Boolean(
    process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST
  );
  const app = initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    ...(usingEmulator ? {} : { credential: applicationDefault() }),
  });
  const auth = getAuth(app);
  const db = getFirestore(app);

  const companySnap = await db.doc(`companies/${companyId}`).get();
  if (!companySnap.exists) {
    console.error(
      `--company-id "${companyId}" ne correspond à aucun document Firestore 'companies/${companyId}' — vérifier l'id exact (pas le nom affiché) dans l'écran Admin > Entreprises.`
    );
    process.exit(1);
  }
  console.log(`Entreprise cible : ${companySnap.data().name} (companies/${companyId})`);

  const results = [];
  for (const o of owners) {
    const syntheticEmail = `${o.username}.${companyId}@betrack.local`;
    const accountSlug = `${o.username}.${companyId}`;
    let uid;
    let password = null;
    let status;
    try {
      password = randomPassword();
      const created = await auth.createUser({ email: syntheticEmail, password });
      uid = created.uid;
      status = "créé";
    } catch (err) {
      if (err && err.code === "auth/email-already-exists") {
        const existing = await auth.getUserByEmail(syntheticEmail);
        uid = existing.uid;
        password = null; // mot de passe existant non modifié
        status = "déjà existant (inchangé)";
      } else {
        console.error(`Échec Auth pour ${o.username} :`, err.message || err);
        results.push({ ...o, status: "ÉCHEC", password: null });
        continue;
      }
    }

    await db.doc(`adminUsers/${accountSlug}`).set({
      username: o.username,
      profiles: [{ role }],
      isGlobalAdmin: false,
      isCompanyAdmin: false,
      firstName: o.firstName,
      lastName: o.lastName,
      name: o.name,
      companyId,
      direction: o.direction || undefined,
      confidentialityClearance: "all",
      // Le champ `password` doit toujours exister sur le doc adminUsers (UsersPanel.tsx le lit
      // directement pour pré-remplir le formulaire d'édition) : un doc sans ce champ fait planter
      // l'édition côté admin (`form.password.length` sur `undefined`). On stocke le mot de passe
      // Auth généré ci-dessus (`null` seulement si le compte existait déjà et n'a pas été touché,
      // auquel cas on ne connaît pas la valeur actuelle et on écrit une chaîne vide plutôt que null).
      password: password ?? "",
    });
    console.log(`  ${status} : ${o.username} (uid ${uid})`);
    results.push({ ...o, status, password });
  }

  const outDir = path.resolve(__dirname, "output");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `lever-owners-${companyId}-${Date.now()}.csv`);
  const csvLines = [
    "username,nom,email,mot_de_passe_temporaire,statut,direction,entites",
    ...results.map((r) =>
      [
        r.username,
        r.name,
        `${r.username}.${companyId}@betrack.local`,
        r.password || "",
        r.status,
        r.direction,
        r.entites.join(" | "),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    ),
  ];
  fs.writeFileSync(outFile, csvLines.join("\n"), "utf8");
  console.log(`\nTerminé. Identifiants (dont mots de passe temporaires) écrits dans : ${outFile}`);
  console.log(
    "Ce fichier n'est jamais commité (voir .gitignore) — à transmettre en direct aux intéressés."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
