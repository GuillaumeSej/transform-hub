/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Migration : éclate les 5 anciens documents Firestore mutualisés `leverMeta/{comments,auditLog,
 * workforceEmployees,workforceMovements,workforceSummary}` (qui mélangeaient les données de TOUTES
 * les entreprises — le bug confirmé en conditions réelles : deux entreprises différentes voyaient
 * exactement les mêmes "160 employés / 51 mouvements") en documents partitionnés par entreprise,
 * `leverMeta/{companyId}__{comments|auditLog|workforceEmployees|workforceMovements|
 * workforceSummary}` — le motif déjà attendu par firestore.rules (voir la section
 * `match /leverMeta/{docId}` et lib/firestore/levers.ts / lib/firestore/workforce.ts, qui lisent/
 * écrivent déjà ce nouveau schéma).
 *
 * NE SUPPRIME RIEN : ce script ne fait que LIRE les 5 anciens documents et ÉCRIRE (avec écrasement
 * idempotent) les nouveaux documents partitionnés. Les anciens documents mutualisés restent
 * intacts — leur suppression est un choix explicite séparé, une fois la migration vérifiée
 * manuellement (voir le commentaire de transition dans firestore.rules).
 *
 * ── Comment chaque type d'enregistrement est rattaché à une entreprise ─────────────────────────
 *
 * - comments (Record<leverId, Comment[]>) : chaque clé est un id de levier — on remonte au levier
 *   correspondant (collection `levers`) pour connaître son `companyId`. Un `leverId` référencé sans
 *   levier correspondant trouvable est un ORPHELIN : log un avertissement et écrit sous
 *   `leverMeta/orphan__comments` plutôt que d'être perdu silencieusement ou deviné.
 *
 * - auditLog (AuditEntry[]) : `entry.entity` est soit un id de levier (`L\d+`), soit un id de
 *   mouvement RH (`MV...`), soit un id d'employé (`EMP...`), soit autre chose (jamais vu en
 *   pratique mais traité comme orphelin par prudence). Résolution :
 *     1. entité "levier" → via la map levier → companyId (comme pour les commentaires).
 *     2. entité "mouvement" → via `movementCompanyOf` (le mouvement porte `leverId` directement,
 *        voir types/index.ts::WorkforceMovement — c'est un champ DIRECT, pas une hypothèse).
 *     3. entité "employé" → via `employeeCompanyOf` (voir ASSUMPTION ci-dessous : Employee n'a pas
 *        de champ companyId ni leverId propre).
 *     4. Rien de tout ça ne résout → orphelin (`leverMeta/orphan__auditLog`).
 *
 * - workforceMovements (WorkforceMovement[]) : `movement.leverId` est un champ DIRECT du type (voir
 *   types/index.ts) — pas d'hypothèse ici, on résout via la map levier → companyId comme pour les
 *   commentaires/audit. Un mouvement dont le `leverId` ne correspond à aucun levier connu est un
 *   orphelin.
 *
 * - workforceEmployees (Employee[]) : ⚠️ ASSUMPTION EXPLICITE — `Employee` (types/index.ts) NE
 *   PORTE AUCUN champ direct reliant un employé à une entreprise ou à un levier. Le seul signal
 *   disponible dans le modèle de données actuel est INDIRECT : un `WorkforceMovement` référence à
 *   la fois un employé (`empId`) et un levier (`leverId`, → companyId). On construit donc
 *   `employeeCompanyOf[empId] = companyId` en parcourant tous les mouvements. Un employé qui
 *   n'apparaît dans AUCUN mouvement (ou dont tous les mouvements référencent un levier inconnu/
 *   orphelin) ne peut pas être rattaché : il est loggé comme orphelin et écrit sous
 *   `leverMeta/orphan__workforceEmployees`. Si un employé apparaît dans des mouvements de PLUSIEURS
 *   entreprises différentes (incohérence de données), le script logge un avertissement explicite et
 *   retient la première entreprise rencontrée (ordre de la liste `movements`) — un cas qui ne
 *   devrait normalement jamais se produire dans un modèle sain.
 *
 * - workforceSummary (WorkforceMeta — UN SEUL objet agrégé, pas une liste) : ⚠️ ASSUMPTION EXPLICITE
 *   — il n'existe AUCUN moyen de "démutualiser" un agrégat déjà consolidé (totalFTE, massSalary,
 *   budgetSalary, departments, baselines) en valeurs par entreprise sans perdre en fidélité. Plutôt
 *   que de dupliquer purement et simplement l'ancien total mutualisé pour chaque entreprise (ce qui
 *   REPRODUIRAIT le bug qu'on corrige — les mêmes chiffres partout), ce script RECALCULE un résumé
 *   par entreprise à partir des employés déjà rattachés à cette entreprise ci-dessus :
 *     - totalFTE = somme des `employee.fte` de l'entreprise.
 *     - massSalary (€M) = somme des `employee.salary` de l'entreprise / 1 000 000.
 *     - budgetSalary = même valeur que massSalary (aucun signal budget distinct par employé dans le
 *       modèle actuel — approximation assumée, à corriger manuellement si besoin).
 *     - departments = regroupement des employés par `employee.department`, `fte` = somme, et
 *       `fteTarget` = même valeur que `fte` (aucun signal de cible par département par employé —
 *       approximation assumée).
 *     - countryBaselines = regroupement par `employee.country` (champ réel disponible).
 *     - workstreamBaselines = [] (Employee ne porte pas de champ workstream — aucun signal
 *       disponible pour cette dimension, laissé vide plutôt que deviné).
 *   Une entreprise sans aucun employé rattaché n'obtient PAS de document `workforceSummary` (rien à
 *   résumer) — elle repart d'une base ETP vide, comme une entreprise fraîchement créée.
 *
 * Usage (émulateur, comme create-admin.js) :
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     node scripts/migrate-lever-meta-tenant-split.js
 *
 * Usage (vrai projet — nécessite des identifiants de service, voir scripts/create-admin.js) :
 *   node scripts/migrate-lever-meta-tenant-split.js
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

const LEVER_ENTITY_RE = /^L\d+$/i;
const MOVEMENT_ENTITY_RE = /^MV/i;
const EMPLOYEE_ENTITY_RE = /^EMP/i;

async function main() {
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    console.error(
      "Config Firebase introuvable (NEXT_PUBLIC_FIREBASE_PROJECT_ID manquant) — vérifier .env.local."
    );
    process.exit(1);
  }

  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");

  const usingEmulator = Boolean(
    process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST
  );
  // Même garde stricte que scripts/migrate-adminusers-tenant-keys.js (arrêt net, pas un simple
  // délai) : une migration de données réelles ne doit jamais partir "par défaut" contre le vrai
  // projet — l'opérateur doit soit tester sur l'émulateur, soit lever la garde explicitement.
  if (!usingEmulator && process.env.CONFIRM_PROD_MIGRATION !== "yes") {
    console.error(
      "\n⚠️  AUCUNE variable d'émulateur détectée (FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST).\n" +
        "   Ce script s'apprête à ÉCRIRE dans le VRAI projet Firebase " +
        `"${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}".\n` +
        "   Interruption volontaire. Pour l'exécuter contre l'émulateur (recommandé pour vérifier\n" +
        "   d'abord), positionner FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST. Pour l'exécuter\n" +
        "   VOLONTAIREMENT contre le vrai projet, ajouter CONFIRM_PROD_MIGRATION=yes.\n"
    );
    process.exit(1);
  }

  const app = initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    ...(usingEmulator ? {} : { credential: applicationDefault() }),
  });
  const db = getFirestore(app);

  console.log(
    `Migration leverMeta → partitionné par entreprise — projet "${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}"` +
      (usingEmulator ? " (émulateur)" : " (VRAI PROJET)") +
      "\n"
  );

  // ── 1. Lecture des référentiels ────────────────────────────────────────────────────────────
  const [companiesSnap, leversSnap, commentsDoc, auditDoc, employeesDoc, movementsDoc, summaryDoc] =
    await Promise.all([
      db.collection("companies").get(),
      db.collection("levers").get(),
      db.doc("leverMeta/comments").get(),
      db.doc("leverMeta/auditLog").get(),
      db.doc("leverMeta/workforceEmployees").get(),
      db.doc("leverMeta/workforceMovements").get(),
      db.doc("leverMeta/workforceSummary").get(),
    ]);

  const companyIds = new Set(companiesSnap.docs.map((d) => d.id));
  /** leverId -> companyId (ou undefined si le levier lui-même est orphelin/sans companyId). */
  const leverCompanyOf = new Map();
  leversSnap.docs.forEach((d) => {
    const data = d.data();
    if (data && data.companyId) leverCompanyOf.set(d.id, data.companyId);
  });

  console.log(
    `Référentiels : ${companyIds.size} entreprise(s), ${leversSnap.size} levier(s) (${leverCompanyOf.size} rattaché(s) à une entreprise).`
  );

  const comments = commentsDoc.exists ? commentsDoc.data() || {} : {};
  const auditEntries = auditDoc.exists ? auditDoc.data().entries || [] : [];
  const employees = employeesDoc.exists ? employeesDoc.data().list || [] : [];
  const movements = movementsDoc.exists ? movementsDoc.data().list || [] : [];
  const summary = summaryDoc.exists ? summaryDoc.data() : null;

  console.log(
    `Documents legacy lus : comments(${Object.keys(comments).length} leviers), ` +
      `auditLog(${auditEntries.length} entrées), workforceEmployees(${employees.length}), ` +
      `workforceMovements(${movements.length}), workforceSummary(${summary ? "présent" : "absent"}).\n`
  );

  // ── 2. movements : leverId est un champ DIRECT → companyId résolu sans hypothèse ──────────────
  /** movementId -> companyId (résolu) */
  const movementCompanyOf = new Map();
  const movementsByCompany = new Map(); // companyId -> WorkforceMovement[]
  const orphanMovements = [];
  for (const mv of movements) {
    const companyId = mv.leverId ? leverCompanyOf.get(mv.leverId) : undefined;
    if (companyId) {
      movementCompanyOf.set(mv.id, companyId);
      if (!movementsByCompany.has(companyId)) movementsByCompany.set(companyId, []);
      movementsByCompany.get(companyId).push(mv);
    } else {
      orphanMovements.push(mv);
    }
  }
  if (orphanMovements.length > 0) {
    console.warn(
      `⚠️  ${orphanMovements.length} mouvement(s) RH sans levier rattachable à une entreprise ` +
        `(leverId manquant ou inconnu) — écrits sous leverMeta/orphan__workforceMovements : ` +
        orphanMovements.map((m) => m.id).join(", ")
    );
  }

  // ── 3. employees : AUCUN champ direct — rattachement INDIRECT via les mouvements (voir
  //      ASSUMPTION en en-tête de fichier). ────────────────────────────────────────────────────
  /** empId -> companyId */
  const employeeCompanyOf = new Map();
  /** empId -> Set<companyId> vus (pour détecter les incohérences) */
  const employeeCompaniesSeen = new Map();
  for (const mv of movements) {
    if (!mv.empId) continue;
    const companyId = movementCompanyOf.get(mv.id);
    if (!companyId) continue;
    if (!employeeCompaniesSeen.has(mv.empId)) employeeCompaniesSeen.set(mv.empId, new Set());
    employeeCompaniesSeen.get(mv.empId).add(companyId);
    if (!employeeCompanyOf.has(mv.empId)) employeeCompanyOf.set(mv.empId, companyId);
  }
  for (const [empId, seen] of employeeCompaniesSeen.entries()) {
    if (seen.size > 1) {
      console.warn(
        `⚠️  Employé ${empId} référencé par des mouvements de PLUSIEURS entreprises (${[...seen].join(", ")}) ` +
          `— rattaché à "${employeeCompanyOf.get(empId)}" (première entreprise rencontrée), incohérence de données à vérifier manuellement.`
      );
    }
  }

  const employeesByCompany = new Map(); // companyId -> Employee[]
  const orphanEmployees = [];
  for (const emp of employees) {
    const companyId = employeeCompanyOf.get(emp.id);
    if (companyId) {
      if (!employeesByCompany.has(companyId)) employeesByCompany.set(companyId, []);
      employeesByCompany.get(companyId).push(emp);
    } else {
      orphanEmployees.push(emp);
    }
  }
  if (orphanEmployees.length > 0) {
    console.warn(
      `⚠️  ${orphanEmployees.length} employé(s) non rattachable(s) à une entreprise (aucun mouvement ` +
        `RH exploitable ne les référence) — écrits sous leverMeta/orphan__workforceEmployees : ` +
        orphanEmployees.map((e) => e.id).join(", ")
    );
  }

  // ── 4. comments : clé = leverId, résolution DIRECTE via la map levier → companyId ─────────────
  const commentsByCompany = new Map(); // companyId -> Record<leverId, Comment[]>
  const orphanComments = {};
  for (const [leverId, leverComments] of Object.entries(comments)) {
    const companyId = leverCompanyOf.get(leverId);
    if (companyId) {
      if (!commentsByCompany.has(companyId)) commentsByCompany.set(companyId, {});
      commentsByCompany.get(companyId)[leverId] = leverComments;
    } else {
      orphanComments[leverId] = leverComments;
    }
  }
  const orphanCommentKeys = Object.keys(orphanComments);
  if (orphanCommentKeys.length > 0) {
    console.warn(
      `⚠️  ${orphanCommentKeys.length} clé(s) de commentaires sans levier rattachable — écrites sous ` +
        `leverMeta/orphan__comments : ${orphanCommentKeys.join(", ")}`
    );
  }

  // ── 5. auditLog : résolution en cascade levier → mouvement → employé (voir en-tête) ───────────
  const auditByCompany = new Map(); // companyId -> AuditEntry[]
  const orphanAudit = [];
  for (const entry of auditEntries) {
    const entity = entry.entity || "";
    let companyId;
    if (LEVER_ENTITY_RE.test(entity)) {
      companyId = leverCompanyOf.get(entity);
    } else if (MOVEMENT_ENTITY_RE.test(entity)) {
      companyId = movementCompanyOf.get(entity);
    } else if (EMPLOYEE_ENTITY_RE.test(entity)) {
      companyId = employeeCompanyOf.get(entity);
    }
    if (companyId) {
      if (!auditByCompany.has(companyId)) auditByCompany.set(companyId, []);
      auditByCompany.get(companyId).push(entry);
    } else {
      orphanAudit.push(entry);
    }
  }
  if (orphanAudit.length > 0) {
    console.warn(
      `⚠️  ${orphanAudit.length} entrée(s) d'audit non rattachable(s) à une entreprise — écrites sous ` +
        `leverMeta/orphan__auditLog : ${orphanAudit.map((e) => e.entity).join(", ")}`
    );
  }

  // ── 6. workforceSummary : RECALCULÉ par entreprise depuis ses employés déjà rattachés (voir
  //      ASSUMPTION en en-tête — pas une simple duplication de l'ancien agrégat mutualisé). ──────
  function summarizeCompanyWorkforce(companyEmployees) {
    const totalFTE = companyEmployees.reduce((sum, e) => sum + (e.fte || 0), 0);
    const massSalary = companyEmployees.reduce((sum, e) => sum + (e.salary || 0), 0) / 1_000_000;
    const deptMap = new Map();
    for (const e of companyEmployees) {
      if (!e.department) continue;
      deptMap.set(e.department, (deptMap.get(e.department) || 0) + (e.fte || 0));
    }
    const departments = [...deptMap.entries()].map(([name, fte]) => ({
      name,
      fte,
      fteTarget: fte, // ASSUMPTION : aucun signal de cible par département par employé, voir en-tête.
    }));
    const countryMap = new Map();
    for (const e of companyEmployees) {
      if (!e.country) continue;
      countryMap.set(e.country, (countryMap.get(e.country) || 0) + (e.fte || 0));
    }
    const countryBaselines = [...countryMap.entries()].map(([key, fte]) => ({
      key,
      label: key,
      fte,
    }));
    return {
      totalFTE,
      massSalary,
      budgetSalary: massSalary, // ASSUMPTION : pas de signal budget distinct, voir en-tête.
      departments,
      countryBaselines,
      workstreamBaselines: [], // ASSUMPTION : Employee ne porte pas de champ workstream, voir en-tête.
    };
  }

  // ── 7. Écriture des documents partitionnés (idempotent — écrase si déjà présent, ne supprime
  //      JAMAIS les anciens documents mutualisés). ─────────────────────────────────────────────
  const allTargetCompanyIds = new Set([
    ...companyIds,
    ...commentsByCompany.keys(),
    ...auditByCompany.keys(),
    ...employeesByCompany.keys(),
    ...movementsByCompany.keys(),
  ]);

  let batch = db.batch();
  let opsInBatch = 0;
  const summaryLines = [];
  async function commitIfFull() {
    if (opsInBatch >= 450) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }
  function setDoc(docId, data) {
    batch.set(db.doc(`leverMeta/${docId}`), data);
    opsInBatch++;
  }

  for (const companyId of allTargetCompanyIds) {
    const cComments = commentsByCompany.get(companyId) || {};
    const cAudit = auditByCompany.get(companyId) || [];
    const cEmployees = employeesByCompany.get(companyId) || [];
    const cMovements = movementsByCompany.get(companyId) || [];

    const nCommentKeys = Object.keys(cComments).length;
    if (nCommentKeys > 0) {
      setDoc(`${companyId}__comments`, cComments);
      await commitIfFull();
    }
    if (cAudit.length > 0) {
      setDoc(`${companyId}__auditLog`, { entries: cAudit });
      await commitIfFull();
    }
    if (cEmployees.length > 0) {
      setDoc(`${companyId}__workforceEmployees`, { list: cEmployees });
      await commitIfFull();
      setDoc(`${companyId}__workforceSummary`, summarizeCompanyWorkforce(cEmployees));
      await commitIfFull();
    }
    if (cMovements.length > 0) {
      setDoc(`${companyId}__workforceMovements`, { list: cMovements });
      await commitIfFull();
    }

    if (nCommentKeys + cAudit.length + cEmployees.length + cMovements.length > 0) {
      summaryLines.push({
        companyId,
        comments: nCommentKeys,
        audit: cAudit.length,
        employees: cEmployees.length,
        movements: cMovements.length,
      });
    }
  }

  if (orphanCommentKeys.length > 0) {
    setDoc("orphan__comments", orphanComments);
    await commitIfFull();
  }
  if (orphanAudit.length > 0) {
    setDoc("orphan__auditLog", { entries: orphanAudit });
    await commitIfFull();
  }
  if (orphanEmployees.length > 0) {
    setDoc("orphan__workforceEmployees", { list: orphanEmployees });
    await commitIfFull();
  }
  if (orphanMovements.length > 0) {
    setDoc("orphan__workforceMovements", { list: orphanMovements });
    await commitIfFull();
  }

  if (opsInBatch > 0) await batch.commit();

  // ── 8. Résumé final ──────────────────────────────────────────────────────────────────────────
  console.log("── Résumé de la migration ──────────────────────────────────────────");
  if (summaryLines.length === 0) {
    console.log("Aucune donnée migrée (documents legacy vides ou déjà tous orphelins).");
  }
  for (const line of summaryLines) {
    console.log(
      `  ${line.companyId} : ${line.comments} clé(s) commentaires, ${line.audit} entrée(s) audit, ` +
        `${line.employees} employé(s), ${line.movements} mouvement(s)`
    );
  }
  console.log(
    `Orphelins : ${orphanCommentKeys.length} clé(s) commentaires, ${orphanAudit.length} entrée(s) audit, ` +
      `${orphanEmployees.length} employé(s), ${orphanMovements.length} mouvement(s).`
  );
  console.log(
    "\nLes anciens documents leverMeta/comments, auditLog, workforceEmployees, workforceMovements, " +
      "workforceSummary n'ont PAS été supprimés (voir en-tête de fichier). Vérifier manuellement les " +
      "nouveaux documents partitionnés avant toute suppression."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
