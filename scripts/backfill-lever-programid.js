/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Rattrapage round "programId requis" : `Lever.programId` est désormais un champ OBLIGATOIRE
 * (voir types/index.ts) — un levier ne peut plus être CRÉÉ sans être rattaché à un programme
 * (LeverForm/l'import Excel/firestore.rules l'imposent désormais). Ce script rattache
 * rétroactivement les leviers existants qui n'en ont pas encore, pour que la base de données
 * respecte elle aussi cette règle une fois pour toutes.
 *
 * Pour CHAQUE document `levers/{id}` sans `programId` (absent, vide, ou pointant vers un
 * programme qui n'existe plus — programme supprimé depuis) :
 *   - s'il a un `companyId` ET que cette entreprise a AU MOINS UN programme Plan Performance :
 *     rattaché au PLUS ANCIEN d'entre eux (tri par `createdAt`) — choix déterministe et sans
 *     ambiguïté quand il y en a plusieurs (le "programme d'origine" de l'entreprise).
 *   - sinon (pas de `companyId`, ou aucun programme Plan Performance pour cette entreprise) :
 *     IGNORÉ, listé en fin d'exécution pour résolution manuelle (créer d'abord un programme pour
 *     cette entreprise, puis relancer le script — idempotent).
 *
 * Usage (contre l'ÉMULATEUR local — aucun identifiant requis) :
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/backfill-lever-programid.js
 *
 * Usage contre le VRAI projet Firebase — nécessite des identifiants de service, voir
 * scripts/create-admin.js pour le détail (GOOGLE_APPLICATION_CREDENTIALS ou
 * `gcloud auth application-default login`) :
 *   CONFIRM_PROD_MIGRATION=yes node scripts/backfill-lever-programid.js
 *
 * SÉCURITÉ : ce script ÉCRIT dans Firestore (collection `levers` uniquement). Idempotent —
 * relançable sans effet de bord (un levier déjà rattaché à un programme EXISTANT n'est jamais
 * modifié).
 */
const fs = require("fs");
const path = require("path");

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

// Même règle que resolveProgramType() (lib/axisLogic.ts), dupliquée ici : ce script est un module
// CJS Node hors Next.js, il ne peut pas importer du TypeScript directement.
function resolveProgramType(program) {
  return program?.type ?? "performance";
}

async function main() {
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    console.error(
      "Config Firebase introuvable (NEXT_PUBLIC_FIREBASE_PROJECT_ID manquant) — vérifier .env.local."
    );
    process.exit(1);
  }

  const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (!usingEmulator && process.env.CONFIRM_PROD_MIGRATION !== "yes") {
    console.warn(
      "\n⚠️  AUCUNE variable d'émulateur détectée (FIRESTORE_EMULATOR_HOST).\n" +
        "   Ce script s'apprête à ÉCRIRE dans le VRAI projet Firebase " +
        `"${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}".\n` +
        "   Interruption volontaire. Pour tester d'abord (recommandé), positionner\n" +
        "   FIRESTORE_EMULATOR_HOST. Pour l'exécuter VOLONTAIREMENT contre le vrai projet,\n" +
        "   ajouter CONFIRM_PROD_MIGRATION=yes.\n"
    );
    process.exit(1);
  }

  const { initializeApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");

  const app = initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
  const db = getFirestore(app);

  const [leversSnap, programsSnap] = await Promise.all([
    db.collection("levers").get(),
    db.collection("programs").get(),
  ]);

  const allPrograms = programsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const programIds = new Set(allPrograms.map((p) => p.id));

  // Programme Plan Performance le plus ancien, par entreprise — calculé une fois.
  const defaultProgramByCompany = new Map();
  for (const program of allPrograms) {
    if (resolveProgramType(program) !== "performance") continue;
    if (!program.companyId) continue;
    const current = defaultProgramByCompany.get(program.companyId);
    if (!current || (program.createdAt ?? "") < (current.createdAt ?? "")) {
      defaultProgramByCompany.set(program.companyId, program);
    }
  }

  console.log(
    `Trouvé ${leversSnap.size} levier(s), ${allPrograms.length} programme(s), ` +
      `${defaultProgramByCompany.size} entreprise(s) avec au moins un programme Plan Performance.\n`
  );

  let fixed = 0;
  let alreadyOk = 0;
  const skipped = [];

  for (const docSnap of leversSnap.docs) {
    const data = docSnap.data();
    const currentProgramId = data.programId;
    const needsFix = !currentProgramId || !programIds.has(currentProgramId);
    if (!needsFix) {
      alreadyOk++;
      continue;
    }

    const companyId = data.companyId ?? null;
    const defaultProgram = companyId ? defaultProgramByCompany.get(companyId) : undefined;
    if (!defaultProgram) {
      skipped.push({
        id: docSnap.id,
        code: data.code,
        companyId,
        reason: companyId
          ? "aucun programme Plan Performance pour cette entreprise"
          : "levier sans companyId (orphelin déjà avant ce round)",
      });
      continue;
    }

    await docSnap.ref.update({ programId: defaultProgram.id });
    console.log(
      `[OK] levers/${docSnap.id} (code="${data.code}", companyId="${companyId}") ` +
        `-> programId="${defaultProgram.id}" ("${defaultProgram.name}")`
    );
    fixed++;
  }

  console.log("\n──────────── Résumé ────────────");
  console.log(`Leviers déjà rattachés à un programme existant : ${alreadyOk}`);
  console.log(`Leviers rattachés par ce script                : ${fixed}`);
  console.log(`Leviers ignorés (résolution manuelle requise)  : ${skipped.length}`);
  if (skipped.length > 0) {
    console.log("\nDétail des leviers ignorés :");
    for (const s of skipped) {
      console.log(
        `  - levers/${s.id} (code="${s.code}", companyId="${s.companyId}") : ${s.reason}`
      );
    }
    console.log(
      "\n  → Pour ces entreprises : créez un programme Plan Performance (Admin > Entreprises > " +
        "Programmes) puis relancez ce script (idempotent, ne touche pas aux leviers déjà corrects)."
    );
  }
  console.log("─────────────────────────────────\n");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
