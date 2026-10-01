/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Prépare (ou nettoie) les données de la vidéo de démo « Plan Stratégique » — programme
 * « Excellence Opérationnelle 2026-2028 » (p-strat-demo-2026) d'Acme Corp (c1). Toute la logique
 * est dans le planificateur PUR scripts/lib/demoStratVideoPlan.js (testé par
 * lib/__tests__/demoStratVideoPlan.test.ts) ; ce script ne fait que lire l'état Firestore, afficher
 * le plan et, sur demande explicite, l'écrire.
 *
 * Tournage à 3 connexions : test.cto, --sponsor, --restricted-user. Deux comptes EXISTANTS non
 * filmés (--project-owner, --contributor) reçoivent réversiblement les profils et positions
 * nécessaires à la chaîne responsable projet → sponsor de chantier.
 *
 * Ne crée JAMAIS de compte Firebase Auth ni de mot de passe : il vérifie seulement que les 3 comptes
 * filmés et les 2 figurants existent.
 *
 * Identifiants : session `firebase login` de l'opérateur (scripts/lib/firebaseCliAdc.js), à défaut
 * les ADC standard. Projet = NEXT_PUBLIC_FIREBASE_PROJECT_ID (.env.local).
 *
 * Usage :
 *   node scripts/prepare-demo-strat-video.js                                   # DRY RUN (défaut)
 *   CONFIRM_PROD_MIGRATION=yes node scripts/prepare-demo-strat-video.js --apply
 *   node scripts/prepare-demo-strat-video.js --cleanup                         # DRY RUN du nettoyage
 *   CONFIRM_PROD_MIGRATION=yes node scripts/prepare-demo-strat-video.js --cleanup --apply
 *   Options : --now 2026-10-05T09:00:00Z (date de référence du tournage, défaut : maintenant),
 *             --sponsor, --restricted-user, --project-owner, --contributor (voir --help).
 */
const fs = require("fs");
const path = require("path");
const {
  PROGRAM_ID,
  COMPANY_ID,
  BACKUP_PATH,
  DELETE_FIELD,
  DEFAULT_CAST,
  PROJECT_OWNER_ROLE,
  CONTRIBUTOR_ROLE,
  planDemoStratVideo,
  planDemoStratVideoCleanup,
} = require("./lib/demoStratVideoPlan");

const HELP = `Prépare les données de la vidéo Plan Stratégique (${PROGRAM_ID}, entreprise ${COMPANY_ID}).

  node scripts/prepare-demo-strat-video.js [--apply] [--cleanup] [--now <ISO>] [distribution]

  (sans option)  DRY RUN : lit Firestore et affiche les écritures prévues, n'écrit rien.
  --apply        écrit réellement (exige CONFIRM_PROD_MIGRATION=yes hors émulateur).
  --cleanup      supprime les documents demo-video-* et restaure les valeurs sauvegardées
                 dans ${BACKUP_PATH} (DRY RUN sauf --apply).
  --now <ISO>    date de référence (retards / échéances / mois de sur-staffing), défaut : maintenant.
  --help         cette aide.

Distribution — 3 connexions filmées : ${DEFAULT_CAST.cto}, --sponsor, --restricted-user :
  --sponsor <id>          sponsor du chantier « Optimisation Supply Chain »
                          (défaut ${DEFAULT_CAST.sponsor})
  --restricted-user <id>  compte filmé sans habilitation « Confidentiel »
                          (défaut ${DEFAULT_CAST.restrictedUser})
  --project-owner <id>    figurant NON filmé : responsable projet, profil ${PROJECT_OWNER_ROLE}
                          (défaut ${DEFAULT_CAST.projectOwner})
  --contributor <id>      figurant NON filmé : contributeur projet, profil ${CONTRIBUTOR_ROLE}
                          (défaut ${DEFAULT_CAST.contributor})
  Un figurant inexistant, filmé, pilote, admin, sponsor de l'axe Supply Chain ou impliqué dans
  « Talents & Organisation » est remplacé automatiquement (voir les notes du dry run).

Prérequis : une personne ayant les droits IAM sur le projet Firebase exécute \`firebase login\`.
Aucun compte Firebase Auth n'est créé : le script vérifie que les 5 comptes existent.`;

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

function printWrites(writes) {
  if (writes.length === 0) return console.log("  (aucune écriture — déjà à jour)");
  for (const w of writes) {
    const detail =
      w.op === "delete"
        ? ""
        : w.op === "update"
          ? ` ${Object.entries(w.data)
              .map(([k, v]) => `${k}=${v === DELETE_FIELD ? "<supprimé>" : JSON.stringify(v)}`)
              .join(", ")}`
          : ` ${w.data.name ?? w.data.kind ?? w.data.function ?? ""}${w.data.status ? ` [${w.data.status}]` : ""}`;
    console.log(`  ${w.op.toUpperCase().padEnd(6)} ${w.path}${detail}`);
  }
}

async function readSnapshot(db) {
  const byCompany = async (collection) =>
    (await db.collection(collection).where("companyId", "==", COMPANY_ID).get()).docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
  const inProgram = (list) => list.filter((x) => x.programId === PROGRAM_ID);
  const [programDoc, companyDoc, usersSnap, axes, chantiers, actions, indicators, measurements] =
    await Promise.all([
      db.doc(`programs/${PROGRAM_ID}`).get(),
      db.doc(`companies/${COMPANY_ID}`).get(),
      db.collection("adminUsers").where("companyId", "==", COMPANY_ID).get(),
      byCompany("strategicAxes"),
      byCompany("chantiers"),
      byCompany("chantierActions"),
      byCompany("indicators"),
      byCompany("indicatorMeasurements"),
    ]);
  const [staffing, approvals, employeesDoc, backupDoc] = await Promise.all([
    byCompany("chantierStaffing"),
    byCompany("strategicApprovals"),
    db.doc(`leverMeta/${COMPANY_ID}__workforceEmployees`).get(),
    db.doc(BACKUP_PATH).get(),
  ]);
  const programChantiers = inProgram(chantiers);
  const chantierIds = new Set(programChantiers.map((c) => c.id));
  const programIndicators = inProgram(indicators);
  const indicatorIds = new Set(programIndicators.map((i) => i.id));
  return {
    program: programDoc.exists ? { id: programDoc.id, ...programDoc.data() } : null,
    company: companyDoc.exists ? { id: companyDoc.id, ...companyDoc.data() } : null,
    // Même filtre que scripts/set-strategic-owners.js : l'app ne charge que les docs `${username}.c1`.
    users: usersSnap.docs
      .map((d) => ({ docId: d.id, ...d.data() }))
      .filter((u) => u.docId === `${u.username}.${COMPANY_ID}`),
    axes: inProgram(axes),
    chantiers: programChantiers,
    chantierActions: actions.filter((a) => chantierIds.has(a.chantierId)),
    indicators: programIndicators,
    measurements: measurements.filter((m) => indicatorIds.has(m.indicatorId)),
    staffing: inProgram(staffing),
    employees: employeesDoc.exists ? employeesDoc.data().list || [] : [],
    approvals: inProgram(approvals),
    backup: backupDoc.exists ? backupDoc.data() : null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  const apply = args.includes("--apply");
  const cleanup = args.includes("--cleanup");
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
  const now = option("--now") ?? new Date().toISOString();
  const cast = {
    sponsor: option("--sponsor"),
    restrictedUser: option("--restricted-user"),
    projectOwner: option("--project-owner"),
    contributor: option("--contributor"),
  };
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
  const { getFirestore, FieldValue } = require("firebase-admin/firestore");
  const db = getFirestore(
    initializeApp({
      ...(usedCli ? { credential: applicationDefault() } : {}),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    })
  );

  console.log(
    `Vidéo Plan Stratégique — projet "${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}"` +
      (usingEmulator ? " (émulateur)" : "") +
      ` — ${cleanup ? "NETTOYAGE" : "PRÉPARATION"} — ${apply ? "APPLY" : "DRY RUN"} — now=${now}\n`
  );
  const snapshot = await readSnapshot(db);
  console.log(
    `Lu : ${snapshot.users.length} compte(s), ${snapshot.axes.length} axe(s), ${snapshot.chantiers.length} chantier(s), ` +
      `${snapshot.chantierActions.length} projet(s), ${snapshot.indicators.length} KPI, ${snapshot.staffing.length} ligne(s) ETP, ` +
      `${snapshot.employees.length} employé(s), ${snapshot.approvals.length} demande(s), sauvegarde ${snapshot.backup ? "présente" : "absente"}.\n`
  );

  const { writes, report } = cleanup
    ? planDemoStratVideoCleanup(snapshot)
    : planDemoStratVideo(snapshot, { now, ...cast });

  if (report.cast) {
    console.log("Distribution :");
    for (const [k, v] of Object.entries(report.cast)) console.log(`  ${k}: ${JSON.stringify(v)}`);
    console.log("");
  }
  console.log(`Écritures prévues (${writes.length}) :`);
  printWrites(writes);
  if (report.notes?.length) {
    console.log("\nNotes :");
    report.notes.forEach((n) => console.log(`  - ${n}`));
  }
  if (report.usersWithoutClearance) {
    console.log(
      `\nSans habilitation « Confidentiel » (ne verront pas l'axe Talents & Organisation) : ` +
        (report.usersWithoutClearance.join(", ") || "aucun")
    );
  }
  if (report.accounts?.length) {
    console.log("\nComptes (aucun n'est créé ; seuls les 3 comptes filmés se connectent) :");
    for (const a of report.accounts) {
      const replaced = a.requested ? ` (au lieu de ${a.requested})` : "";
      console.log(
        `  ${a.status === "ok" ? "OK" : "KO"}  ${a.label} : ${a.username ?? "—"}${replaced} — ${a.status}`
      );
    }
    if (report.missingAccounts?.length) {
      console.log("\nÀ régler avant le tournage :");
      report.missingAccounts.forEach((m) => console.log(`  - ${m.label} : ${m.action}`));
    } else console.log("  → les 5 comptes existent, aucune connexion supplémentaire requise.");
  }

  if (!apply) {
    console.log("\nDRY RUN — rien n'a été écrit. Ajouter --apply (et CONFIRM_PROD_MIGRATION=yes).");
    return;
  }
  const toFirestore = (data) =>
    Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v === DELETE_FIELD ? FieldValue.delete() : v])
    );
  for (const w of writes) {
    const ref = db.doc(w.path);
    try {
      if (w.op === "set") await ref.set(w.data);
      else if (w.op === "update") await ref.update(toFirestore(w.data));
      else await ref.delete();
      console.log(`écrit ${w.op} ${w.path}`);
    } catch (err) {
      console.warn(`⚠️  échec ${w.op} ${w.path} : ${err.message}`);
    }
  }
  console.log(
    cleanup
      ? "\nNettoyage terminé."
      : "\nTerminé. Annuler : CONFIRM_PROD_MIGRATION=yes node scripts/prepare-demo-strat-video.js --cleanup --apply"
  );
}

if (require.main === module)
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    }
  );
