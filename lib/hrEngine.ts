import type {
  Company,
  Employee,
  HierarchyLevelDef,
  HierarchyNode,
  Lever,
  MovementType,
  Workforce,
  WorkforceMovement,
} from "@/types";
import { daysBetween, parseISO } from "@/lib/dateUtils";
import { STATUS_ORDER } from "@/lib/status-config";
import { resolveHierarchyPath } from "@/lib/hierarchyLogic";

/**
 * Moteur de calcul pur du module RH — agrégations de la base ETP et des mouvements pour le
 * Dashboard RH (waterfall, breakdowns, PSE, rythme mensuel, économie nette, projection
 * multi-exercices) et les alertes de réconciliation RH ↔ leviers. Séparé de lib/engine.ts
 * (leviers) pour limiter les conflits de merge : mêmes conventions, fonctions pures qui
 * prennent les données en paramètre.
 *
 * Aligné sur la typologie 5-types de "OD Monitoring" (Gooduelle) : `Recrutement`, `Attrition`,
 * `Départ forcé`, `Transfert entrant`, `Transfert sortant` — voir `types/index.ts::MovementType`.
 */

/** Date de référence du scénario démo — alignée sur DEMO_NOW de lib/engine.ts. */
export const HR_TODAY = "2026-06-22";

/** Effet d'un mouvement sur l'effectif TOTAL — les transferts internes (entrants/sortants au
 *  sens Gooduelle : mobilités internes entre départements) sont neutres, la neutralité étant la
 *  même que pour l'ancienne paire Redéploiement/Reconversion. */
export function fteEffect(m: WorkforceMovement): number {
  switch (m.type) {
    case "Recrutement":
      return +m.fte;
    case "Attrition":
    case "Départ forcé":
      return -m.fte;
    case "Transfert entrant":
    case "Transfert sortant":
      return 0;
  }
}

export function currentFTE(wf: Workforce): number {
  return (
    wf.totalFTE +
    wf.movements.filter((m) => m.status === "Réalisé").reduce((s, m) => s + fteEffect(m), 0)
  );
}

/** Atterrissage : effectif si TOUS les mouvements du plan se réalisent. */
export function plannedFTE(wf: Workforce): number {
  return wf.totalFTE + wf.movements.reduce((s, m) => s + fteEffect(m), 0);
}

export function targetFTE(wf: Workforce): number {
  return wf.departments.reduce((s, d) => s + d.fteTarget, 0);
}

// ---------- Fiscal year utilities ----------

/** Détermine l'exercice fiscal auquel appartient une date, à partir de `Company.fyStart`
 *  (mois-jour de début, format "YYYY-MM-DD" — seule la partie MM-DD est prise en compte pour
 *  reproduire le décalage annuel). Retourne un libellé "FY26/27" si l'exercice traverse deux
 *  années civiles, "FY2026" sinon (fyStart == 1er janvier).
 *
 *  Ex. fyStart = "2026-07-01" (juillet-juin) :
 *   - date "2026-06-01" → "FY25/26"
 *   - date "2026-07-01" → "FY26/27"
 *   - date "2027-06-30" → "FY26/27"
 *
 *  Retourne `null` si la date ou fyStart sont invalides. */
export function fiscalYearBucket(
  dateISO: string | null | undefined,
  fyStart: string | null | undefined
): string | null {
  if (!dateISO || !fyStart) return null;
  const y = Number(dateISO.slice(0, 4));
  const m = Number(dateISO.slice(5, 7));
  const d = Number(dateISO.slice(8, 10));
  const sm = Number(fyStart.slice(5, 7));
  const sd = Number(fyStart.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (!Number.isFinite(sm) || !Number.isFinite(sd)) return null;

  // fyStart == 01-01 → année civile pure
  if (sm === 1 && sd === 1) return `FY${y}`;

  // Sinon l'exercice commence en (sm-sd) : si la date est avant fyStart de l'année civile,
  // elle appartient à l'exercice précédent.
  const beforeStart = m < sm || (m === sm && d < sd);
  const startYear = beforeStart ? y - 1 : y;
  const endYear = startYear + 1;
  return `FY${String(startYear).slice(-2)}/${String(endYear).slice(-2)}`;
}

/** Liste ordonnée des exercices fiscaux couvrant une plage de dates, avec leurs bornes
 *  ISO (utile pour poser des buckets et pour l'axe temporel des widgets multi-FY). */
export type FiscalYear = {
  label: string; // "FY26/27" ou "FY2026"
  startISO: string;
  endISO: string;
};

export function fiscalYearRange(
  fyStart: string | null | undefined,
  fromISO: string,
  toISO: string
): FiscalYear[] {
  if (!fyStart) return [];
  const sm = Number(fyStart.slice(5, 7));
  const sd = Number(fyStart.slice(8, 10));
  if (!Number.isFinite(sm) || !Number.isFinite(sd)) return [];

  const startBucket = fiscalYearBucket(fromISO, fyStart);
  const endBucket = fiscalYearBucket(toISO, fyStart);
  if (!startBucket || !endBucket) return [];

  const results: FiscalYear[] = [];
  const startYearOf = (label: string): number => {
    // "FY2026" ou "FY26/27"
    if (label.includes("/")) return 2000 + Number(label.slice(2, 4));
    return Number(label.slice(2));
  };

  let year = startYearOf(startBucket);
  const endYear = startYearOf(endBucket);
  while (year <= endYear) {
    const startISO = `${year}-${String(sm).padStart(2, "0")}-${String(sd).padStart(2, "0")}`;
    const endYearCivil = sm === 1 && sd === 1 ? year : year + 1;
    // Fin de l'exercice = veille du prochain démarrage (approx via addDays -1)
    const nextStart = new Date(
      `${endYearCivil}-${String(sm).padStart(2, "0")}-${String(sd).padStart(2, "0")}T00:00:00`
    );
    nextStart.setTime(nextStart.getTime() - 86_400_000);
    const endISO = nextStart.toISOString().slice(0, 10);
    results.push({ label: fiscalYearBucket(startISO, fyStart)!, startISO, endISO });
    year += 1;
  }
  return results;
}

// ---------- Waterfall ETP ----------

/** Détail signé par type de mouvement dans un bucket — utile pour le waterfall décomposé
 *  (Gooduelle-style, cf. `FteWaterfallChart` avec prop `byType`). Les valeurs sont SIGNÉES par
 *  `fteEffect` : Recrutement > 0, Attrition/Départ forcé < 0, transferts = 0. */
export type MovementTypeDelta = Record<MovementType, number>;

const EMPTY_TYPE_DELTA = (): MovementTypeDelta => ({
  Recrutement: 0,
  Attrition: 0,
  "Départ forcé": 0,
  "Transfert entrant": 0,
  "Transfert sortant": 0,
});

export type FteBridgeBucket = {
  /** "Jan", "Fév"… ou "T1"… ou "FY26/27" */
  label: string;
  delta: number;
  cumulative: number; // effectif total en fin de bucket
  movements: WorkforceMovement[];
  /** Détail du delta par type (utilisé par la waterfall décomposée). */
  byType: MovementTypeDelta;
};

const MONTH_LABELS = [
  "Jan",
  "Fév",
  "Mar",
  "Avr",
  "Mai",
  "Juin",
  "Juil",
  "Août",
  "Sep",
  "Oct",
  "Nov",
  "Déc",
];

export type BridgeGranularity = "month" | "quarter" | "year";

/**
 * Projection en cascade des mouvements par mois, trimestre ou exercice fiscal, de la baseline
 * vers l'atterrissage. Chaque bucket porte ses mouvements et un détail signé par type
 * (`byType`) pour la décomposition Gooduelle-style au clic ou dans la waterfall décomposée.
 *
 * Granularités :
 *  - `"month"` / `"quarter"` : buckets d'année civile (comportement historique). L'année de
 *    référence est celle du premier mouvement rencontré ; si aucun, retour à HR_TODAY.
 *  - `"year"` : buckets par exercice fiscal — nécessite `fyStart` (mois-jour de début
 *    d'exercice), sinon retour à des buckets d'année civile.
 */
export function fteBridge(
  wf: Workforce,
  granularity: BridgeGranularity,
  fyStart?: string | null
): FteBridgeBucket[] {
  if (granularity === "year") {
    return fteBridgeYearly(wf, fyStart ?? null);
  }

  const bucketCount = granularity === "month" ? 12 : 4;
  const buckets: FteBridgeBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    label: granularity === "month" ? MONTH_LABELS[i] : `T${i + 1}`,
    delta: 0,
    cumulative: 0,
    movements: [],
    byType: EMPTY_TYPE_DELTA(),
  }));

  for (const m of wf.movements) {
    const month = Number(m.plannedDate.slice(5, 7)) - 1; // 0-11
    if (Number.isNaN(month) || month < 0 || month > 11) continue;
    const idx = granularity === "month" ? month : Math.floor(month / 3);
    const effect = fteEffect(m);
    buckets[idx].delta += effect;
    buckets[idx].byType[m.type] += effect;
    buckets[idx].movements.push(m);
  }

  let running = wf.totalFTE;
  for (const b of buckets) {
    running += b.delta;
    b.cumulative = Math.round(running * 10) / 10;
  }
  return buckets;
}

function fteBridgeYearly(wf: Workforce, fyStart: string | null): FteBridgeBucket[] {
  // Détermine la plage à couvrir depuis les mouvements + HR_TODAY.
  const dates = wf.movements
    .map((m) => m.plannedDate)
    .filter((d): d is string => !!d)
    .sort();
  const from = dates[0] ?? HR_TODAY;
  const to = dates[dates.length - 1] ?? HR_TODAY;

  const range = fyStart ? fiscalYearRange(fyStart, from, to) : [];
  // Repli : si aucun fyStart, on regroupe par année civile.
  if (range.length === 0) {
    return fteBridgeByCalendarYear(wf, from, to);
  }

  const buckets: FteBridgeBucket[] = range.map((fy) => ({
    label: fy.label,
    delta: 0,
    cumulative: 0,
    movements: [],
    byType: EMPTY_TYPE_DELTA(),
  }));

  for (const m of wf.movements) {
    const idx = range.findIndex(
      (fy) =>
        parseISO(m.plannedDate) >= parseISO(fy.startISO) &&
        parseISO(m.plannedDate) <= parseISO(fy.endISO)
    );
    if (idx < 0) continue;
    const effect = fteEffect(m);
    buckets[idx].delta += effect;
    buckets[idx].byType[m.type] += effect;
    buckets[idx].movements.push(m);
  }

  let running = wf.totalFTE;
  for (const b of buckets) {
    running += b.delta;
    b.cumulative = Math.round(running * 10) / 10;
  }
  return buckets;
}

function fteBridgeByCalendarYear(wf: Workforce, fromISO: string, toISO: string): FteBridgeBucket[] {
  const startYear = Number(fromISO.slice(0, 4));
  const endYear = Number(toISO.slice(0, 4));
  const buckets: FteBridgeBucket[] = [];
  for (let y = startYear; y <= endYear; y++) {
    buckets.push({
      label: `${y}`,
      delta: 0,
      cumulative: 0,
      movements: [],
      byType: EMPTY_TYPE_DELTA(),
    });
  }
  for (const m of wf.movements) {
    const y = Number(m.plannedDate.slice(0, 4));
    const idx = y - startYear;
    if (idx < 0 || idx >= buckets.length) continue;
    const effect = fteEffect(m);
    buckets[idx].delta += effect;
    buckets[idx].byType[m.type] += effect;
    buckets[idx].movements.push(m);
  }
  let running = wf.totalFTE;
  for (const b of buckets) {
    running += b.delta;
    b.cumulative = Math.round(running * 10) / 10;
  }
  return buckets;
}

/** Décomposition d'un bucket par levier (pour le drill-down au clic sur la waterfall). */
export function bucketByLever(
  bucket: FteBridgeBucket,
  levers: Lever[]
): {
  leverId: string;
  leverCode: string;
  leverName: string;
  movements: WorkforceMovement[];
  fte: number;
}[] {
  const byLever = new Map<string, WorkforceMovement[]>();
  for (const m of bucket.movements) {
    byLever.set(m.leverId, [...(byLever.get(m.leverId) ?? []), m]);
  }
  return Array.from(byLever.entries()).map(([leverId, movements]) => {
    const lever = levers.find((l) => l.id === leverId);
    return {
      leverId,
      leverCode: lever?.code ?? leverId,
      leverName: lever?.name ?? leverId,
      movements,
      fte: Math.round(movements.reduce((s, m) => s + fteEffect(m), 0) * 10) / 10,
    };
  });
}

// ---------- Rythme mensuel Gooduelle-style (5 types empilés + cumul net) ----------

export type MovementRhythmBucket = {
  label: string;
  /** Comptages ETP SIGNÉS par `fteEffect` par type — les barres empilées Recrutement/Transferts
   *  sont vers le haut (positives ou nulles), Attrition/Départ forcé vers le bas (négatives). */
  byType: MovementTypeDelta;
  /** Somme signée du bucket (= `delta` du bucket équivalent de `fteBridge`). */
  net: number;
  /** Cumul net depuis le premier bucket — sert à la ligne "cumul" centrée zéro dans le widget. */
  cumulativeNet: number;
};

/** Rythme des mouvements sur la période, décomposé par les 5 types + cumul net — exactement le
 *  graphique "Rythme mensuel" de "OD Monitoring". Réutilise l'axe temporel de `fteBridge` pour
 *  garantir la cohérence avec la waterfall (mêmes buckets, même agrégation). */
export function movementRhythm(
  wf: Workforce,
  granularity: BridgeGranularity,
  fyStart?: string | null
): MovementRhythmBucket[] {
  const bridge = fteBridge(wf, granularity, fyStart);
  let cumulative = 0;
  return bridge.map((b) => {
    cumulative += b.delta;
    return {
      label: b.label,
      byType: b.byType,
      net: b.delta,
      cumulativeNet: Math.round(cumulative * 10) / 10,
    };
  });
}

// ---------- Breakdowns ----------

export type DepartmentMovements = {
  department: string;
  exits: number; // ETP (positif) — Attrition + Départ forcé
  recrutements: number;
  transferts: number; // Transfert entrant + Transfert sortant (entrants + sortants du département)
};

export function movementsByDepartment(wf: Workforce): DepartmentMovements[] {
  const rows = new Map<string, DepartmentMovements>();
  const row = (dept: string) => {
    if (!rows.has(dept))
      rows.set(dept, { department: dept, exits: 0, recrutements: 0, transferts: 0 });
    return rows.get(dept)!;
  };
  for (const m of wf.movements) {
    if (m.type === "Attrition" || m.type === "Départ forcé") {
      row(m.department).exits += m.fte;
    } else if (m.type === "Recrutement") {
      row(m.department).recrutements += m.fte;
    } else {
      // Transfert entrant / sortant : impacte le département source et le département cible
      row(m.department).transferts += m.fte;
      if (m.toDepartment && m.toDepartment !== m.department)
        row(m.toDepartment).transferts += m.fte;
    }
  }
  return Array.from(rows.values()).sort((a, b) => b.exits - a.exits);
}

export function movementsByCountry(
  wf: Workforce
): { country: string; fte: number; count: number }[] {
  const rows = new Map<string, { country: string; fte: number; count: number }>();
  for (const m of wf.movements) {
    const r = rows.get(m.country) ?? { country: m.country, fte: 0, count: 0 };
    r.fte += m.fte;
    r.count += 1;
    rows.set(m.country, r);
  }
  return Array.from(rows.values()).sort((a, b) => b.fte - a.fte);
}

export type MovementTypeSummary = { type: MovementType; count: number; fte: number };

export function movementsByType(wf: Workforce): MovementTypeSummary[] {
  const types: MovementType[] = [
    "Recrutement",
    "Attrition",
    "Départ forcé",
    "Transfert entrant",
    "Transfert sortant",
  ];
  return types
    .map((type) => {
      const list = wf.movements.filter((m) => m.type === type);
      return {
        type,
        count: list.length,
        fte: Math.round(list.reduce((s, m) => s + m.fte, 0) * 10) / 10,
      };
    })
    .filter((t) => t.count > 0);
}

// ---------- Masse salariale ----------

export type SalaryBridgeBucket = { label: string; delta: number; cumulative: number };

/** Impact cumulé des mouvements sur la masse salariale annuelle (€M) — baseline massSalary,
 * chaque bucket ajoute les salaryImpact des mouvements planifiés dessus. */
export function salaryBridge(
  wf: Workforce,
  granularity: BridgeGranularity,
  fyStart?: string | null
): SalaryBridgeBucket[] {
  const fte = fteBridge(wf, granularity, fyStart);
  let running = wf.massSalary;
  return fte.map((b) => {
    const deltaM = b.movements.reduce((s, m) => s + m.salaryImpact, 0) / 1_000_000;
    running += deltaM;
    return {
      label: b.label,
      delta: Math.round(deltaM * 100) / 100,
      cumulative: Math.round(running * 100) / 100,
    };
  });
}

/** Économies salariales annualisées des seuls mouvements réalisés (€). */
export function realizedSalarySavings(wf: Workforce): number {
  return wf.movements
    .filter((m) => m.status === "Réalisé")
    .reduce((s, m) => s + Math.max(0, -m.salaryImpact), 0);
}

// ---------- PSE ----------

export type PseSummary = {
  postes: number; // ETP concernés
  enCours: number;
  realises: number;
  valides: number;
  coutTotal: number; // € provision (tous les coûts one-off des mouvements PSE)
  coutEngage: number; // € coûts des mouvements réalisés
};

export function pseSummary(wf: Workforce): PseSummary {
  const pse = wf.movements.filter((m) => m.inPSE);
  return {
    postes: Math.round(pse.reduce((s, m) => s + m.fte, 0) * 10) / 10,
    enCours: pse.filter((m) => m.status === "En cours").length,
    realises: pse.filter((m) => m.status === "Réalisé").length,
    valides: pse.filter((m) => m.hrValidated).length,
    coutTotal: pse.reduce((s, m) => s + m.cost, 0),
    coutEngage: pse.filter((m) => m.status === "Réalisé").reduce((s, m) => s + m.cost, 0),
  };
}

// ---------- Départements : actuel / cible / atterrissage ----------

export type DepartmentDelta = {
  name: string;
  fte: number;
  fteTarget: number;
  landing: number; // atterrissage si tous les mouvements se réalisent
  gapToTarget: number; // atterrissage − cible (positif = il restera du chemin)
};

export function deltaByDepartment(wf: Workforce): DepartmentDelta[] {
  return wf.departments.map((d) => {
    const delta = wf.movements
      .filter((m) => m.department === d.name || m.toDepartment === d.name)
      .reduce((s, m) => {
        if ((m.type === "Attrition" || m.type === "Départ forcé") && m.department === d.name)
          return s - m.fte;
        if (m.type === "Recrutement" && m.department === d.name) return s + m.fte;
        if ((m.type === "Transfert entrant" || m.type === "Transfert sortant") && m.toDepartment) {
          if (m.toDepartment === d.name && m.department !== d.name) return s + m.fte;
          if (m.department === d.name && m.toDepartment !== d.name) return s - m.fte;
        }
        return s;
      }, 0);
    const landing = Math.round((d.fte + delta) * 10) / 10;
    return {
      name: d.name,
      fte: d.fte,
      fteTarget: d.fteTarget,
      landing,
      gapToTarget: Math.round((landing - d.fteTarget) * 10) / 10,
    };
  });
}

// ---------- Trajectoire effectifs cible vs réel (widget fte-trajectory) ----------

export type FteTrajectoryPoint = {
  label: string;
  /** Effectif réel en fin de période (baseline + mouvements réalisés cumulés) */
  actual: number;
  /** Effectif prévu par le plan (baseline + tous mouvements cumulés planifiés) */
  planned: number;
  /** Cible fin d'année (constante, pour la ligne de référence) */
  target: number;
  /** Ventilation par type de mouvement des deltas de la période */
  byType: Record<MovementType, number>;
};

/** Construit la trajectoire mois par mois ou trimestre par trimestre. Distingue :
 *  - `actual` : ne cumule que les mouvements "Réalisé"
 *  - `planned` : cumule TOUS les mouvements (plan complet)
 *  - `byType` : ventilation du delta total de la période par mécanisme
 *
 *  Note : la granularité "year" n'est pas pertinente ici (trop peu de points pour une
 *  trajectoire lisible) — elle retombe silencieusement sur "quarter". */
export function fteTrajectory(wf: Workforce, granularity: BridgeGranularity): FteTrajectoryPoint[] {
  const effectiveGranularity: "month" | "quarter" = granularity === "month" ? "month" : "quarter";
  const bucketCount = effectiveGranularity === "month" ? 12 : 4;
  const labels = effectiveGranularity === "month" ? MONTH_LABELS : ["T1", "T2", "T3", "T4"];

  // Liste des 5 types Gooduelle (post-migration Août 2026).
  const allTypes: MovementType[] = [
    "Recrutement",
    "Attrition",
    "Départ forcé",
    "Transfert entrant",
    "Transfert sortant",
  ];
  const points: FteTrajectoryPoint[] = Array.from({ length: bucketCount }, (_, i) => ({
    label: labels[i],
    actual: 0,
    planned: 0,
    target: 0,
    byType: Object.fromEntries(allTypes.map((t) => [t, 0])) as Record<MovementType, number>,
  }));

  const tgt = targetFTE(wf);
  let runningActual = wf.totalFTE;
  let runningPlanned = wf.totalFTE;

  for (const m of wf.movements) {
    const month = Number(m.plannedDate.slice(5, 7)) - 1;
    if (Number.isNaN(month) || month < 0 || month > 11) continue;
    const idx = effectiveGranularity === "month" ? month : Math.floor(month / 3);
    const effect = fteEffect(m);
    points[idx].byType[m.type] = (points[idx].byType[m.type] ?? 0) + effect;
  }

  for (let i = 0; i < bucketCount; i++) {
    // Planned = tous les mouvements
    const plannedDelta = wf.movements
      .filter((m) => {
        const month = Number(m.plannedDate.slice(5, 7)) - 1;
        const idx = effectiveGranularity === "month" ? month : Math.floor(month / 3);
        return idx === i;
      })
      .reduce((s, m) => s + fteEffect(m), 0);
    runningPlanned += plannedDelta;

    // Actual = seulement les mouvements réalisés
    const actualDelta = wf.movements
      .filter((m) => {
        if (m.status !== "Réalisé") return false;
        const month = Number(m.plannedDate.slice(5, 7)) - 1;
        const idx = effectiveGranularity === "month" ? month : Math.floor(month / 3);
        return idx === i;
      })
      .reduce((s, m) => s + fteEffect(m), 0);
    runningActual += actualDelta;

    points[i].actual = Math.round(runningActual * 10) / 10;
    points[i].planned = Math.round(runningPlanned * 10) / 10;
    points[i].target = tgt;
  }

  return points;
}

// ---------- Cluster / Région (dérivée de la hiérarchie géographique configurée) ----------

export type MovementRegionContext = {
  employees: Employee[];
  geographyNodes: HierarchyNode[];
  geographyLevels: HierarchyLevelDef[];
  /** Sémantique de niveau à extraire — par défaut `"region"` (le "cluster" Gooduelle) ; utile
   *  pour distinguer région vs continent selon la configuration client. */
  semantic?: "region" | "continent";
};

/**
 * Résout le libellé "cluster" (par défaut = région) d'un mouvement, en s'appuyant sur
 * l'arborescence géographique configurée sur l'entreprise (`Company.geographyHierarchyLevels`).
 * Ordre de résolution :
 *  1. Si le mouvement a un `empId` renseigné et que l'employé existe → `employee.region`.
 *  2. Sinon, résolution via `m.country` :
 *     - Recherche d'un `HierarchyNode` géographique dont le code ou label = `m.country`, puis
 *       remontée via `resolveHierarchyPath` jusqu'au niveau demandé (`semantic`).
 *  3. Fallback : `m.country` brut (aucune hiérarchie configurée ou pays introuvable).
 *
 * Retourne toujours une chaîne non-vide — jamais `undefined`, pour rester utilisable dans le
 * rendu et dans les registres de dimension du pivot.
 */
export function resolveMovementRegion(m: WorkforceMovement, ctx: MovementRegionContext): string {
  const semantic = ctx.semantic ?? "region";

  // 1. Employé lié
  if (m.empId) {
    const emp = ctx.employees.find((e) => e.id === m.empId);
    if (emp?.region) return emp.region;
  }

  // 2. Résolution via la hiérarchie géographique de l'entreprise
  if (ctx.geographyNodes.length > 0 && ctx.geographyLevels.length > 0 && m.country) {
    const geoNodes = ctx.geographyNodes.filter((n) => (n.domain ?? "financial") === "geographic");
    // Recherche large : code exact, label exact, ou insensible à la casse.
    const country = m.country.trim();
    const countryLc = country.toLowerCase();
    const leaf =
      geoNodes.find((n) => n.code === country || n.label === country) ??
      geoNodes.find(
        (n) => n.code.toLowerCase() === countryLc || n.label.toLowerCase() === countryLc
      );
    if (leaf) {
      const path = resolveHierarchyPath(leaf.id, geoNodes, ctx.geographyLevels);
      const targetLevel = ctx.geographyLevels.find((l) => l.semantic === semantic);
      if (targetLevel) {
        const entry = path.find((p) => p.levelKey === targetLevel.key);
        if (entry) return entry.label;
      }
    }
  }

  // 3. Fallback : pays brut
  return m.country || "Non renseigné";
}

// ---------- Alertes de réconciliation RH ↔ leviers ----------

export type MovementAlertKind = "overdue" | "due" | "toValidate" | "leverMismatch";

export type MovementAlert = {
  movement: WorkforceMovement;
  kind: MovementAlertKind;
  message: string;
};

const DUE_WINDOW_DAYS = 7;

/**
 * Alertes actionnables pour le RH :
 * - `overdue`  : échéance dépassée sans réalisation — relancer l'owner du levier.
 * - `due`      : échéance dans ≤ 7 jours — préparer/valider le mouvement.
 * - `toValidate` : réalisé opérationnellement mais pas encore validé RH.
 * - `leverMismatch` : le levier lié est annulé ou se termine avant la date du mouvement —
 *   le plan RH et le plan levier ne sont plus synchronisés.
 */
export function movementAlerts(
  wf: Workforce,
  levers: Lever[],
  today: string = HR_TODAY
): MovementAlert[] {
  const alerts: MovementAlert[] = [];

  for (const m of wf.movements) {
    if (m.status === "Réalisé" && !m.hrValidated) {
      alerts.push({
        movement: m,
        kind: "toValidate",
        message: `${m.label} — réalisé le ${m.actualDate ?? m.plannedDate}, en attente de validation RH`,
      });
      continue;
    }

    if (m.status !== "Réalisé") {
      const days = daysBetween(today, m.plannedDate);
      if (days < 0) {
        alerts.push({
          movement: m,
          kind: "overdue",
          message: `${m.label} — échéance dépassée de ${-days} j (prévu le ${m.plannedDate})`,
        });
      } else if (days <= DUE_WINDOW_DAYS) {
        alerts.push({
          movement: m,
          kind: "due",
          message: `${m.label} — échéance dans ${days} j (${m.plannedDate})`,
        });
      }
    }

    const lever = levers.find((l) => l.id === m.leverId);
    if (lever && m.status !== "Réalisé") {
      if (lever.status === "cancelled") {
        alerts.push({
          movement: m,
          kind: "leverMismatch",
          message: `${m.label} — le levier ${lever.code} est annulé, mouvement à requalifier`,
        });
      } else if (lever.end < m.plannedDate && STATUS_ORDER[lever.status] < STATUS_ORDER.delivered) {
        alerts.push({
          movement: m,
          kind: "leverMismatch",
          message: `${m.label} — planifié le ${m.plannedDate}, après la fin du levier ${lever.code} (${lever.end})`,
        });
      }
    }
  }

  const KIND_PRIORITY: Record<MovementAlertKind, number> = {
    overdue: 0,
    leverMismatch: 1,
    toValidate: 2,
    due: 3,
  };
  return alerts.sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
}

// Re-export utilitaire — évite un import supplémentaire côté consommateur qui a déjà `hrEngine`.
export type { Company };
