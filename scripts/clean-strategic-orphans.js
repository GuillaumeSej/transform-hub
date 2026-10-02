/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Nettoyage des ORPHELINS du Plan Stratégique (lot 3 intégrité) — lignes ETP, projets,
 * indicateurs et mesures dont le parent a été supprimé avant la suppression en cascade, dépendances
 * et prérequis qui citent un élément disparu, demandes de validation en attente dont la cible
 * n'existe plus (annulées, jamais supprimées). Toute la logique est dans le planificateur PUR
 * scripts/lib/strategicOrphanCleanupPlan.js (testé par
 * lib/__tests__/strategicOrphanCleanupPlan.test.ts) ; ce script ne fait que lire Firestore,
 * afficher le plan et, sur demande explicite, l'écrire.
 *
 * Les cas qui demandent une décision métier (chantier sans aucun axe existant, indicateur macro
 * d'un axe supprimé, mesure sur une période future) sont SEULEMENT listés — à traiter dans
 * l'application.
 *
 * Identifiants : session `firebase login` de l'opérateur (scripts/lib/firebaseCliAdc.js), à défaut
 * les ADC standard (GOOGLE_APPLICATION_CREDENTIALS ou `gcloud auth application-default login`).
 * Projet = NEXT_PUBLIC_FIREBASE_PROJECT_ID (.env.local).
 *
 * Usage :
 *   node scripts/clean-strategic-orphans.js                          # DRY RUN (défaut), toutes entreprises
 *   node scripts/clean-strategic-orphans.js --company c1             # DRY RUN, une entreprise
 *   CONFIRM_PROD_MIGRATION=yes node scripts/clean-strategic-orphans.js --company c1 --apply
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/clean-strategic-orphans.js --apply
 *
 * SÉCURITÉ : avec --apply, ÉCRIT dans Firestore (suppressions dans chantierActions,
 * chantierStaffing, indicators, indicatorMeasurements ; mises à jour de chantiers,
 * chantierActions, strategicApprovals). Idempotent. NE PAS EXÉCUTER --apply sans avoir relu le
 * dry run et obtenu l'accord explicite du responsable des données.
 */
const fs = require("fs");
const path = require("path");
const { planStrategicOrphanCleanup } = require("./lib/strategicOrphanCleanupPlan");

const HELP = `Nettoie les orphelins du Plan Stratégique (lot 3 intégrité).

  node scripts/clean-strategic-orphans.js [--company <id>] [--apply] [--now <ISO>]

  (sans option)     DRY RUN sur toutes les entreprises : lit Firestore, affiche le plan, n'écrit rien.
  --company <id>    limite à une entreprise (companyId).
  --apply           écrit réellement (exige CONFIRM_PROD_MIGRATION=yes hors émulateur).
  --now <ISO>       date de référence (période en cours des mesures futures), défaut : maintenant.
  --help            cette aide.`;

const COLLECTIONS = {
  axes: "strategicAxes",
  chantiers: "chantiers",
  chantierActions: "chantierActions",
  staffing: "chantierStaffing",
  indicators: "indicators",
  measurements: "indicatorMeasurements",
  approvals: "strategicApprovals",
};

/** Écritures par lot (sous la limite de 500 d'un batch Firestore). */
const BATCH_SIZE = 400;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!(key in process.env)) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

async function readByCompany(db, companyFilter) {
  const out = {};
  for (const [key, name] of Object.entries(COLLECTIONS)) {
    const ref = db.collection(name);
    const snap = await (companyFilter ? ref.where("companyId", "==", companyFilter) : ref).get();
    for (const d of snap.docs) {
      const data = { ...d.data(), id: d.id };
      const companyId = data.companyId || "(sans companyId)";
      out[companyId] ??= {};
      (out[companyId][key] ??= []).push(data);
    }
  }
  return out;
}

function printPlan(companyId, { writes, report }) {
  console.log(`\n═══ Entreprise ${companyId} ═══`);
  const line = (label, list, fmt) => {
    console.log(`${label} : ${list.length}`);
    for (const item of list) console.log(`    - ${fmt(item)}`);
  };
  line(
    "Projets orphelins (chantier inexistant)",
    report.orphanActions,
    (a) => `${a.id} « ${a.name} » (chantier ${a.chantierId})`
  );
  line(
    "Lignes ETP orphelines",
    report.orphanStaffing,
    (s) =>
      `${s.id} ${s.function} ${s.fte} ETP — ${s.reason} (chantier ${s.chantierId}${s.actionId ? `, projet ${s.actionId}` : ""})`
  );
  line(
    "Indicateurs orphelins (chantier inexistant)",
    report.orphanIndicators,
    (i) => `${i.id} « ${i.name} » (chantier ${i.chantierId})`
  );
  line(
    "Mesures orphelines",
    report.orphanMeasurements,
    (m) => `${m.id} ${m.period} (indicateur ${m.indicatorId})`
  );
  line(
    "Dépendances de chantier nettoyées",
    report.dependencyUpdates,
    (u) => `${u.id} : ${u.removed} retirée(s)`
  );
  line(
    "Prérequis de projet nettoyés",
    report.prerequisiteUpdates,
    (u) => `${u.id} : ${u.removed} retiré(s)`
  );
  line(
    "Axes inexistants retirés d'un chantier multi-axe",
    report.axisIdsUpdates,
    (u) => `${u.id} : ${u.removed.join(", ")}`
  );
  line(
    "Demandes en attente annulées (cible supprimée)",
    report.cancelledApprovals,
    (a) => `${a.id} ${a.kind} → ${a.target}${a.targetName ? ` « ${a.targetName} »` : ""}`
  );
  if (report.manual.length) {
    console.log(`À traiter MANUELLEMENT dans l'application (${report.manual.length}) :`);
    for (const m of report.manual) console.log(`    - ${m.path} : ${m.issue}`);
  }
  console.log(`→ ${writes.length} écriture(s) prévue(s).`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  const apply = args.includes("--apply");
  const option = (name) => {
    const idx = args.indexOf(name);
    if (idx < 0) return undefined;
    const value = args[idx + 1];
    if (!value || value.startsWith("--")) {
      console.error(`${name} attend une valeur.`);
      process.exit(1);
    }
    return value;
  };
  const companyFilter = option("--company");
  const now = option("--now") ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(now))) {
    console.error(`--now invalide : ${now}`);
    process.exit(1);
  }

  loadEnvFile(path.resolve(__dirname, "..", ".env.local"));
  loadEnvFile(path.resolve(__dirname, "..", ".env.production"));
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    console.error(
      "Config Firebase introuvable (NEXT_PUBLIC_FIREBASE_PROJECT_ID manquant) — vérifier .env.local."
    );
    process.exit(1);
  }
  const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (apply && !usingEmulator && process.env.CONFIRM_PROD_MIGRATION !== "yes") {
    console.error(
      `\n⚠️  --apply écrirait dans le VRAI projet Firebase "${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}".\n` +
        "   Interruption volontaire : relancer d'abord sans --apply (dry run), puis ajouter\n" +
        "   CONFIRM_PROD_MIGRATION=yes pour écrire volontairement.\n"
    );
    process.exit(1);
  }

  const { setupFirebaseCliAdc } = require("./lib/firebaseCliAdc");
  const usedCli = setupFirebaseCliAdc();
  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const db = getFirestore(
    initializeApp({
      ...(usedCli ? { credential: applicationDefault() } : {}),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    })
  );

  console.log(
    `Nettoyage des orphelins du Plan Stratégique — projet "${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}"` +
      (usingEmulator ? " (émulateur)" : "") +
      ` — ${companyFilter ? `entreprise ${companyFilter}` : "toutes entreprises"}` +
      ` — ${apply ? "APPLY" : "DRY RUN"} — now=${now}`
  );

  const byCompany = await readByCompany(db, companyFilter);
  const allWrites = [];
  for (const [companyId, snapshot] of Object.entries(byCompany)) {
    const plan = planStrategicOrphanCleanup(snapshot, {
      now,
      actor: "script-nettoyage-orphelins",
    });
    printPlan(companyId, plan);
    allWrites.push(...plan.writes);
  }
  console.log(`\nTotal : ${allWrites.length} écriture(s).`);

  if (!apply) {
    console.log("\nDRY RUN — rien n'a été écrit. Ajouter --apply (et CONFIRM_PROD_MIGRATION=yes).");
    return;
  }
  for (let start = 0; start < allWrites.length; start += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = allWrites.slice(start, start + BATCH_SIZE);
    for (const w of chunk) {
      const ref = db.doc(w.path);
      if (w.op === "delete") batch.delete(ref);
      else batch.update(ref, w.data);
    }
    await batch.commit();
    console.log(`écrit ${start + chunk.length}/${allWrites.length}`);
  }
  console.log("\nNettoyage terminé (relancer en dry run : 0 écriture attendue).");
}

if (require.main === module)
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    }
  );
