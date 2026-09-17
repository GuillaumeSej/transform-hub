/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Génère des mouvements RH (`WorkforceMovement`) fictifs mais réalistes pour les entreprises de
 * démo, afin de peupler le Dashboard RH et la page Base ETP — qui affichent actuellement tout à
 * zéro ("0/0 mouvements réalisés", "€0K" partout, "Aucun mouvement à afficher") non pas à cause
 * d'un bug, mais parce que `leverMeta/{companyId}__workforceMovements` est réellement vide :
 * depuis la suppression de l'ancien auto-seed implicite (voir lib/firestore/workforce.ts,
 * commentaire de `forceReseedWorkforce`), une entreprise démarre avec un périmètre "mouvements"
 * vide, peuplé uniquement par de la vraie saisie/import.
 *
 * Ce script écrit UNIQUEMENT le document `__workforceMovements` de chaque entreprise ciblée — il
 * ne touche JAMAIS `__workforceEmployees` (données d'effectif réelles, à préserver) ni
 * `__workforceSummary` (déjà en place, baselines/cibles par département saisies séparément).
 *
 * Pour chaque entreprise, les mouvements générés référencent des données RÉELLES déjà présentes
 * dans Firestore (jamais d'id inventé) :
 *   - les employés existants (`leverMeta/{companyId}__workforceEmployees`) pour les mouvements
 *     autres que Recrutement (Attrition, Départ forcé, Transfert entrant/sortant) — chaque
 *     employé n'est utilisé que dans AU PLUS un mouvement, pour éviter un double effet ETP
 *     incohérent sur la même personne ;
 *   - les leviers existants (collection `levers`, filtrés par companyId) pour `leverId`, et pour
 *     dériver `workstream` (Lever.ws), `function` (Lever.function) et `programId` (Lever.programId)
 *     — même logique de préremplissage que components/shared/MovementForm.tsx ;
 *   - les programmes existants (collection `programs`, filtrés par companyId) pour déterminer la
 *     plage de dates réaliste (`fyStart`/`fyEnd`) sur laquelle étaler `plannedDate`/`actualDate`.
 *
 * Si une entreprise n'a AUCUN employé ou AUCUN levier existant, elle est ignorée (warning loggé)
 * plutôt que de générer des mouvements référençant des ids inventés — l'intégrité référentielle
 * avec les données déjà en place est le point même de ce script (le dashboard doit pouvoir
 * joindre les mouvements aux employés/leviers réels).
 *
 * Calcul des montants (salaryImpact/savings/cost) : réplique EXACTEMENT les formules de
 * lib/hrFinancials.ts::computeMovementFinancials (dupliquées ci-dessous — ce script est un module
 * CJS Node hors Next.js, il ne peut pas importer du TypeScript directement, même convention que
 * scripts/backfill-lever-programid.js). `lockedPlan` est renseigné sur CHAQUE mouvement généré
 * (c'est la cible bottom-up que lisent les 4 KPI du Dashboard RH — voir lib/hrProgramSummary.ts —
 * un mouvement sans `lockedPlan` ne contribue pas à la cible). Une partie des mouvements
 * "Réalisé" a un léger écart entre le plan verrouillé et le résultat constaté (aléas d'exécution),
 * et une partie des mouvements non réalisés porte un `reforecast` légèrement réactualisé, pour
 * illustrer les 3 vues (réalisé / cible / reforecast) du dashboard.
 *
 * Utilise le SDK ADMIN (firebase-admin), pas le SDK client : depuis le durcissement de
 * firestore.rules, un `setDoc()` non authentifié via le SDK client se heurte à `permission-denied`
 * — le SDK Admin, authentifié par des identifiants de service, ignore les règles de sécurité par
 * conception (même raisonnement que scripts/seed-strategic-demo.js et scripts/create-admin.js).
 *
 * Identifiants requis contre le VRAI projet : `GOOGLE_APPLICATION_CREDENTIALS` pointant vers une
 * clé de compte de service JSON (Console Firebase > Paramètres du projet > Comptes de service),
 * ou `gcloud auth application-default login` au préalable. Contre l'ÉMULATEUR local
 * (`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` par exemple), aucun identifiant requis.
 *
 * Usage : npm run seed-workforce-demo
 * Lit la config Firebase depuis .env.local / .env.production (même pattern que
 * scripts/seed-strategic-demo.js).
 *
 * Idempotent PAR ENTREPRISE : chaque exécution ÉCRASE entièrement (`setDoc` sans merge) le
 * document `__workforceMovements` de chaque entreprise seedée avec un nouveau jeu de données —
 * aucune accumulation d'essais précédents, aucun `deleteDoc` séparé nécessaire (un seul document
 * par entreprise, remplacé intégralement).
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

if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
  console.error("Config Firebase introuvable (NEXT_PUBLIC_FIREBASE_PROJECT_ID manquant).");
  process.exit(1);
}

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

// Contre l'émulateur : FIRESTORE_EMULATOR_HOST suffit, le SDK Admin le détecte tout seul et
// n'exige alors aucun identifiant de service. Contre le vrai projet : applicationDefault() lit
// GOOGLE_APPLICATION_CREDENTIALS ou les identifiants posés par `gcloud auth application-default
// login` — voir le commentaire d'en-tête pour la marche à suivre.
const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const app = initializeApp({
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  ...(usingEmulator ? {} : { credential: applicationDefault() }),
});
const db = getFirestore(app);

// ── Shims SDK client → SDK Admin (voir commentaire d'en-tête) ─────────────────────────────────
function doc(database, collectionName, id) {
  return database.collection(collectionName).doc(id);
}
async function setDoc(ref, data) {
  await ref.set(data);
}
function collection(database, collectionName) {
  return database.collection(collectionName);
}
function where(field, op, value) {
  return { field, op, value };
}
function query(collRef, whereClause) {
  return collRef.where(whereClause.field, whereClause.op, whereClause.value);
}
async function getDocs(q) {
  return q.get();
}

// ── Entreprises de démo ciblées (celles affichées sur l'écran de connexion) ────────────────────
const COMPANIES = [
  { id: "c1", label: "Acme Corp" },
  { id: "c1788534368111", label: "ICES" },
  { id: "c1789453496834", label: "RS & Associés" },
];

// ── Calcul EUR mécanisme-dépendant — dupliqué depuis lib/hrFinancials.ts (voir doc d'en-tête) ──
const NOTICE_PERIOD_MONTHS = 2;
const ATTRITION_NOTICE_MONTHS = 0.5;
const PSE_OVERHEAD_RATE = 0.2;
const FORCED_DEPARTURE_MULTIPLIER = 1.2;
const RECRUITMENT_FEE_RATE = 0.15;
const ONBOARDING_COST_MONTHS = 0.5;
const TRANSFER_TRANSITION_RATE = 0.05;
const RETRAINING_TRANSITION_RATE = 0.15;

function loadedAnnualSalary(grossSalary) {
  return Math.max(0, grossSalary);
}

function daysBetween(aISO, bISO) {
  return Math.round((new Date(bISO).getTime() - new Date(aISO).getTime()) / 86_400_000);
}

function tenureYears(hireDate, refDate) {
  if (!hireDate) return 0;
  const days = daysBetween(hireDate, refDate);
  return days > 0 ? days / 365.25 : 0;
}

function severanceEstimate(loadedSalary, tenure) {
  const monthly = loadedSalary / 12;
  const first10 = Math.min(tenure, 10) * 0.25 * monthly;
  const beyond10 = Math.max(tenure - 10, 0) * (1 / 3) * monthly;
  return Math.round(first10 + beyond10);
}

/** Retourne { salaryImpact, savings, cost } — miroir de computeMovementEuros(). */
function computeMovementEuros(type, grossSalary, opts) {
  const tenure = opts?.tenure ?? 0;
  const inPSE = opts?.inPSE ?? false;
  const requiresRetraining = opts?.requiresRetraining ?? false;
  const loadedSalary = Math.round(loadedAnnualSalary(grossSalary));

  switch (type) {
    case "Départ forcé": {
      const severance = severanceEstimate(loadedSalary, tenure);
      const notice = Math.round((NOTICE_PERIOD_MONTHS / 12) * loadedSalary);
      const pseOverhead = inPSE ? Math.round(PSE_OVERHEAD_RATE * severance) : 0;
      const rawCost = severance + notice + pseOverhead;
      const cost = Math.round(rawCost * FORCED_DEPARTURE_MULTIPLIER);
      return { salaryImpact: -loadedSalary, savings: loadedSalary, cost };
    }
    case "Attrition": {
      const cost = Math.round((ATTRITION_NOTICE_MONTHS / 12) * loadedSalary);
      return { salaryImpact: -loadedSalary, savings: loadedSalary, cost };
    }
    case "Recrutement": {
      const fee = Math.round(RECRUITMENT_FEE_RATE * loadedSalary);
      const onboarding = Math.round((ONBOARDING_COST_MONTHS / 12) * loadedSalary);
      return { salaryImpact: loadedSalary, savings: 0, cost: fee + onboarding };
    }
    case "Transfert entrant":
    case "Transfert sortant": {
      const rate = requiresRetraining ? RETRAINING_TRANSITION_RATE : TRANSFER_TRANSITION_RATE;
      const cost = Math.round(rate * loadedSalary);
      return { salaryImpact: 0, savings: 0, cost };
    }
    default:
      return { salaryImpact: 0, savings: 0, cost: 0 };
  }
}

// ── Utilitaires aléatoires (déterministe par graine simple pour reproductibilité raisonnable) ──
let seedState = 42;
function rand() {
  // xorshift32 — assez pour une génération de démo reproductible d'un run à l'autre.
  seedState ^= seedState << 13;
  seedState ^= seedState >>> 17;
  seedState ^= seedState << 5;
  seedState |= 0;
  return ((seedState >>> 0) % 1_000_000) / 1_000_000;
}
function randInt(min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function shuffle(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
function isoAddDays(iso, days) {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
function randomDateBetween(fromISO, toISO) {
  const fromMs = new Date(fromISO).getTime();
  const toMs = new Date(toISO).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return fromISO;
  const t = fromMs + rand() * (toMs - fromMs);
  return new Date(t).toISOString().slice(0, 10);
}

// Date de référence du scénario démo — alignée sur HR_TODAY de lib/hrEngine.ts : les mouvements
// "Réalisé" sont datés avant cette date, les "Planifié"/"À faire" après, pour rester cohérent
// avec les KPI et widgets qui distinguent passé/à venir par rapport à cette référence.
const HR_TODAY = "2026-06-22";

const SOCIAL_SCHEMES = ["PSE", "RC", "RCC", "PDV", "Autre"];
const RECRUITMENT_ROLES = [
  "Chargé(e) de mission",
  "Chef de projet",
  "Analyste",
  "Coordinateur(trice)",
  "Responsable adjoint(e)",
  "Consultant(e) interne",
  "Technicien(ne) spécialisé(e)",
  "Ingénieur(e)",
  "Gestionnaire",
];
const MOVEMENT_COMMENTS = [
  "Validé en comité RH mensuel.",
  "Suivi rapproché demandé par le sponsor du levier.",
  "Cohérent avec la trajectoire cible du département.",
  "Calendrier ajusté suite à un imprévu opérationnel.",
  "",
  "",
  "",
];

// ── Lecture des données réelles par entreprise ──────────────────────────────────────────────────

async function getEmployees(companyId) {
  const snap = await doc(db, "leverMeta", `${companyId}__workforceEmployees`).get();
  return snap.exists ? (snap.data().list ?? []) : [];
}

async function getLevers(companyId) {
  const snap = await getDocs(query(collection(db, "levers"), where("companyId", "==", companyId)));
  return snap.docs.map((d) => d.data());
}

async function getPrograms(companyId) {
  const snap = await getDocs(
    query(collection(db, "programs"), where("companyId", "==", companyId))
  );
  return snap.docs.map((d) => d.data());
}

/** Plage de dates réaliste pour étaler les mouvements — bornes min(fyStart)/max(fyEnd) de TOUS
 *  les programmes existants de l'entreprise. Repli sur une fenêtre glissante autour de HR_TODAY
 *  si l'entreprise n'a aucun programme (cas normalement inattendu pour les 3 entreprises de démo,
 *  mais on reste défensif plutôt que de planter). */
function computeProgramRange(programs) {
  const starts = programs.map((p) => p.fyStart).filter(Boolean);
  const ends = programs.map((p) => p.fyEnd).filter(Boolean);
  if (starts.length === 0 || ends.length === 0) {
    return { from: isoAddDays(HR_TODAY, -365), to: isoAddDays(HR_TODAY, 730) };
  }
  return {
    from: starts.reduce((a, b) => (a < b ? a : b)),
    to: ends.reduce((a, b) => (a > b ? a : b)),
  };
}

// ── Construction des mouvements ─────────────────────────────────────────────────────────────────

/** Statut + dates cohérentes entre elles, réparties autour de HR_TODAY. */
function pickStatusAndDates(range) {
  const roll = rand();
  // 50% Réalisé (passé), 30% Planifié (futur), 15% À faire (futur), 5% Abandonné (n'importe où).
  if (roll < 0.5) {
    const plannedDate = randomDateBetween(range.from, HR_TODAY);
    const actualDate = isoAddDays(plannedDate, randInt(-5, 12));
    return { status: "Réalisé", plannedDate, actualDate, hrValidated: rand() < 0.85 };
  }
  if (roll < 0.8) {
    return {
      status: "Planifié",
      plannedDate: randomDateBetween(HR_TODAY, range.to),
      actualDate: null,
      hrValidated: false,
    };
  }
  if (roll < 0.95) {
    return {
      status: "À faire",
      plannedDate: randomDateBetween(HR_TODAY, range.to),
      actualDate: null,
      hrValidated: false,
    };
  }
  return {
    status: "Abandonné",
    plannedDate: randomDateBetween(range.from, range.to),
    actualDate: null,
    hrValidated: false,
  };
}

/** Applique un léger écart aléatoire (±pct) à un nombre — pour simuler plan vs réalisé/reforecast. */
function jitter(value, pct) {
  const factor = 1 + (rand() * 2 - 1) * pct;
  return Math.round(value * factor);
}

function buildLockedPlan(fte, euros) {
  return { fte, salaryImpact: euros.salaryImpact, savings: euros.savings, cost: euros.cost };
}

function buildMovement({
  seq,
  companyId,
  type,
  employee,
  lever,
  range,
  departments,
  fallbackCountries,
  fallbackHrOwners,
  fallbackSalaryByDept,
}) {
  const dates = pickStatusAndDates(range);
  const isRecruitment = type === "Recrutement";
  const isTransfer = type === "Transfert entrant" || type === "Transfert sortant";
  const isForcedDeparture = type === "Départ forcé";

  const department = employee ? employee.department : pick(departments);
  let toDepartment;
  if (isTransfer) {
    const others = departments.filter((d) => d !== department);
    toDepartment = others.length > 0 ? pick(others) : undefined;
  }

  const country = employee ? employee.country : pick(fallbackCountries);
  const hrOwner = employee ? employee.hrOwner : pick(fallbackHrOwners);
  const fte = employee ? employee.fte : Math.round((0.8 + rand() * 0.2) * 10) / 10;

  const grossSalary = employee
    ? employee.salary
    : Math.round((fallbackSalaryByDept[department] ?? 45_000) * (0.85 + rand() * 0.3));

  const refDate = dates.actualDate ?? dates.plannedDate;
  const tenure = employee ? tenureYears(employee.hireDate, refDate) : 0;
  const requiresRetraining = isTransfer ? rand() < 0.3 : undefined;
  const socialScheme = isForcedDeparture ? pick(SOCIAL_SCHEMES) : undefined;
  const inPSE = isForcedDeparture ? socialScheme === "PSE" : undefined;

  const euros = computeMovementEuros(type, grossSalary, {
    tenure,
    inPSE: Boolean(inPSE),
    requiresRetraining: Boolean(requiresRetraining),
  });

  // lockedPlan = plan verrouillé d'origine (cible bottom-up lue par le Dashboard RH). Pour un
  // mouvement déjà "Réalisé", on introduit un léger écart entre le plan et le résultat constaté
  // (aléas d'exécution réels) plutôt que des valeurs strictement identiques.
  const lockedPlan = buildLockedPlan(fte, euros);
  let movementFte = fte;
  let movementEuros = euros;
  if (dates.status === "Réalisé" && rand() < 0.6) {
    movementFte = Math.round(jitter(fte * 10, 0.08)) / 10 || fte;
    movementEuros = {
      salaryImpact: jitter(euros.salaryImpact, 0.08),
      savings: Math.max(0, jitter(euros.savings, 0.08)),
      cost: Math.max(0, jitter(euros.cost, 0.12)),
    };
  }

  // reforecast : uniquement sur une partie des mouvements pas encore réalisés, pour illustrer la
  // divergence prévision réactualisée vs plan verrouillé (optionnel selon le modèle).
  let reforecast;
  if ((dates.status === "Planifié" || dates.status === "À faire") && rand() < 0.3) {
    reforecast = {
      fte,
      salaryImpact: jitter(euros.salaryImpact, 0.1),
      savings: Math.max(0, jitter(euros.savings, 0.1)),
      cost: Math.max(0, jitter(euros.cost, 0.15)),
    };
  }

  const label = employee ? employee.name : `${pick(RECRUITMENT_ROLES)} – ${department}`;
  const comment = pick(MOVEMENT_COMMENTS);

  const movement = {
    id: `MV-${companyId}-${String(seq).padStart(4, "0")}`,
    empId: employee ? employee.id : null,
    label,
    leverId: lever.id,
    workstream: lever.ws,
    function: lever.function,
    programId: lever.programId,
    type,
    fte: movementFte > 0 ? movementFte : fte,
    department,
    country,
    hrOwner,
    plannedDate: dates.plannedDate,
    actualDate: dates.actualDate,
    status: dates.status,
    hrValidated: dates.hrValidated,
    salaryImpact: movementEuros.salaryImpact,
    savings: movementEuros.savings,
    cost: movementEuros.cost,
    lockedPlan,
  };
  if (toDepartment) movement.toDepartment = toDepartment;
  if (isForcedDeparture) {
    movement.inPSE = Boolean(inPSE);
    movement.socialScheme = socialScheme;
  }
  if (isTransfer) movement.requiresRetraining = Boolean(requiresRetraining);
  if (reforecast) movement.reforecast = reforecast;
  if (comment) movement.comment = comment;
  return movement;
}

async function seedCompany(company) {
  const { id: companyId, label } = company;
  console.log(`\n— ${label} (${companyId}) —`);

  const [employees, levers, programs] = await Promise.all([
    getEmployees(companyId),
    getLevers(companyId),
    getPrograms(companyId),
  ]);

  if (employees.length === 0) {
    console.warn(
      `  Ignoré : aucun employé existant dans leverMeta/${companyId}__workforceEmployees.`
    );
    return null;
  }
  if (levers.length === 0) {
    console.warn(`  Ignoré : aucun levier existant pour companyId="${companyId}".`);
    return null;
  }

  const range = computeProgramRange(programs);
  console.log(
    `  ${employees.length} employé(s), ${levers.length} levier(s), ${programs.length} programme(s) — plage ${range.from} → ${range.to}.`
  );

  const departments = Array.from(new Set(employees.map((e) => e.department).filter(Boolean)));
  const countries = Array.from(new Set(employees.map((e) => e.country).filter(Boolean)));
  const hrOwners = Array.from(new Set(employees.map((e) => e.hrOwner).filter(Boolean)));
  if (departments.length === 0) departments.push("Non renseigné");
  if (countries.length === 0) countries.push("Non renseigné");
  if (hrOwners.length === 0) hrOwners.push("Non renseigné");
  const salaryByDept = {};
  for (const dept of departments) {
    const inDept = employees.filter((e) => e.department === dept && Number.isFinite(e.salary));
    salaryByDept[dept] =
      inDept.length > 0
        ? Math.round(inDept.reduce((s, e) => s + e.salary, 0) / inDept.length)
        : 45_000;
  }

  // Nombre de mouvements "consommant" un employé réel (Attrition/Départ forcé/Transferts) — borné
  // par le nombre d'employés disponibles, jamais plus (référentiel intégrité).
  const nonRecruitTarget = clamp(Math.round(employees.length * 0.22), 8, 28);
  const nonRecruitCount = Math.min(employees.length, nonRecruitTarget);
  const recruitCount = clamp(Math.round(nonRecruitCount * 0.45), 4, 14);

  const hasMultipleDepartments = departments.length >= 2;
  // Répartition des types "consommant" un employé : Attrition 35% / Départ forcé 20% /
  // Transfert entrant 22.5% / Transfert sortant 22.5% (rebalancée sur Attrition+Départ forcé si
  // l'entreprise n'a qu'un seul département, cas où les transferts n'ont pas de sens).
  function pickNonRecruitType() {
    const roll = rand();
    if (!hasMultipleDepartments) {
      return roll < 0.65 ? "Attrition" : "Départ forcé";
    }
    if (roll < 0.35) return "Attrition";
    if (roll < 0.55) return "Départ forcé";
    if (roll < 0.775) return "Transfert entrant";
    return "Transfert sortant";
  }

  const pool = shuffle(employees).slice(0, nonRecruitCount);
  const movements = [];
  let seq = 0;

  for (const employee of pool) {
    seq++;
    const type = pickNonRecruitType();
    const lever = pick(levers);
    movements.push(
      buildMovement({
        seq,
        companyId,
        type,
        employee,
        lever,
        range,
        departments,
        fallbackCountries: countries,
        fallbackHrOwners: hrOwners,
        fallbackSalaryByDept: salaryByDept,
      })
    );
  }

  for (let i = 0; i < recruitCount; i++) {
    seq++;
    const lever = pick(levers);
    movements.push(
      buildMovement({
        seq,
        companyId,
        type: "Recrutement",
        employee: null,
        lever,
        range,
        departments,
        fallbackCountries: countries,
        fallbackHrOwners: hrOwners,
        fallbackSalaryByDept: salaryByDept,
      })
    );
  }

  await setDoc(doc(db, "leverMeta", `${companyId}__workforceMovements`), {
    list: movements,
  });

  const byType = movements.reduce((acc, m) => {
    acc[m.type] = (acc[m.type] ?? 0) + 1;
    return acc;
  }, {});
  const byStatus = movements.reduce((acc, m) => {
    acc[m.status] = (acc[m.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `  ${movements.length} mouvement(s) écrit(s) dans leverMeta/${companyId}__workforceMovements.`
  );
  console.log(`    Par type   : ${JSON.stringify(byType)}`);
  console.log(`    Par statut : ${JSON.stringify(byStatus)}`);

  return { companyId, label, count: movements.length };
}

async function main() {
  console.log("Seed des mouvements RH de démo (Dashboard RH / Base ETP)...");
  const results = [];
  for (const company of COMPANIES) {
    const result = await seedCompany(company);
    if (result) results.push(result);
  }

  console.log("\nTerminé.");
  if (results.length === 0) {
    console.warn("Aucune entreprise seedée (voir warnings ci-dessus).");
  } else {
    for (const r of results) {
      console.log(`  ${r.label} (${r.companyId}) : ${r.count} mouvement(s).`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
