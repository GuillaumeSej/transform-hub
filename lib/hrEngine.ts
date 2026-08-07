import type { Lever, MovementType, Workforce, WorkforceMovement } from "@/types";
import { daysBetween } from "@/lib/dateUtils";
import { STATUS_ORDER } from "@/lib/status-config";
import { isActiveMovement } from "@/lib/workforceLogic";

/**
 * Moteur de calcul pur du module RH — agrégations de la base ETP et des mouvements pour le
 * Dashboard RH (waterfall, breakdowns, PSE, pont ETP, rythme mensuel) et les alertes de
 * réconciliation RH ↔ leviers. Séparé de lib/engine.ts (leviers) pour limiter les conflits
 * de merge : mêmes conventions, fonctions pures qui prennent les données en paramètre.
 *
 * Aligné sur la typologie 5-types de "OD Monitoring" (Gooduelle) — voir
 * `types/index.ts::MovementType`.
 */

/** Date de référence du scénario démo — alignée sur DEMO_NOW de lib/engine.ts. */
export const HR_TODAY = "2026-06-22";

/** Liste ordonnée des 5 types Gooduelle — utilisée par les widgets qui ont besoin d'itérer sur
 *  toutes les catégories dans un ordre stable (breakdown, ventilation, pont ETP). */
export const MOVEMENT_TYPES: MovementType[] = [
  "Recrutement",
  "Attrition",
  "Départ forcé",
  "Transfert entrant",
  "Transfert sortant",
];

/** Effet d'un mouvement sur l'effectif TOTAL — les transferts internes (entrants/sortants) sont
 *  neutres pour le total, seuls Recrutement (+) et Attrition/Départ forcé (−) le modifient.
 *
 *  Filet défensif (Août 2026) : un type inconnu (donnée Firestore antérieure à la migration
 *  5-types, valeur importée depuis un Excel legacy, saisie API non validée) retombe sur 0
 *  plutôt que de propager `undefined` en NaN dans tous les KPI dépendants (currentFTE,
 *  plannedFTE, fteBridge, hrProgramSummary…). Un warning dev signale la donnée pour traçabilité. */
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
    default: {
      const rawType = (m as { type?: unknown }).type;
      if (typeof console !== "undefined" && process.env.NODE_ENV !== "production") {
        console.warn(
          `[hrEngine] fteEffect: unknown MovementType "${String(rawType)}" for movement ${m.id} — falling back to 0. Vérifier la migration 5-types Gooduelle (voir workforce SCHEMA_VERSION).`
        );
      }
      return 0;
    }
  }
}

export function currentFTE(wf: Workforce): number {
  return (
    wf.totalFTE +
    wf.movements
      .filter((m) => isActiveMovement(m) && m.status === "Réalisé")
      .reduce((s, m) => s + fteEffect(m), 0)
  );
}

/** Atterrissage : effectif si TOUS les mouvements du plan se réalisent. */
export function plannedFTE(wf: Workforce): number {
  return wf.totalFTE + wf.movements.filter(isActiveMovement).reduce((s, m) => s + fteEffect(m), 0);
}

export function targetFTE(wf: Workforce): number {
  return wf.departments.reduce((s, d) => s + d.fteTarget, 0);
}

// ---------- Waterfall ETP ----------

/** Décomposition signée d'un bucket par type (positifs pour Recrutement, négatifs pour
 *  Attrition/Départ forcé, 0 pour les transferts internes). */
export type MovementTypeDelta = Record<MovementType, number>;

const EMPTY_TYPE_DELTA = (): MovementTypeDelta => ({
  Recrutement: 0,
  Attrition: 0,
  "Départ forcé": 0,
  "Transfert entrant": 0,
  "Transfert sortant": 0,
});

export type FteBridgeBucket = {
  /** "Jan 2026" (avec année si multi-année), "T1 2026", "2026", etc. */
  label: string;
  /** ISO début et fin de la période couverte par le bucket. */
  startISO: string;
  endISO: string;
  delta: number;
  cumulative: number; // effectif total en fin de bucket
  movements: WorkforceMovement[];
  /** Détail signé du delta par type (utilisé par le rythme et le pont ETP). */
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

/** Plage de dates optionnelle (ISO). Un mouvement compte dans un bucket si sa `plannedDate` est
 *  entre `from` et `to` (inclusif). */
export type DateRange = { from?: string | null; to?: string | null };

function isInRange(dateISO: string, range?: DateRange): boolean {
  if (!range) return true;
  if (range.from && dateISO < range.from) return false;
  if (range.to && dateISO > range.to) return false;
  return true;
}

function firstDayOfMonth(year: number, monthIdx: number): string {
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}-01`;
}

function lastDayOfMonth(year: number, monthIdx: number): string {
  const d = new Date(year, monthIdx + 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Détermine les bornes ISO d'un bucket pour la granularité et l'année de référence donnés. */
function bucketBounds(
  year: number,
  index: number,
  granularity: BridgeGranularity
): { startISO: string; endISO: string; label: string } {
  if (granularity === "month") {
    return {
      startISO: firstDayOfMonth(year, index),
      endISO: lastDayOfMonth(year, index),
      label: `${MONTH_LABELS[index]} ${year}`,
    };
  }
  if (granularity === "quarter") {
    const startMonth = index * 3;
    const endMonth = startMonth + 2;
    return {
      startISO: firstDayOfMonth(year, startMonth),
      endISO: lastDayOfMonth(year, endMonth),
      label: `T${index + 1} ${year}`,
    };
  }
  // year
  return {
    startISO: firstDayOfMonth(year, 0),
    endISO: lastDayOfMonth(year, 11),
    label: `${year}`,
  };
}

/** Détermine les années couvertes par le range (ou par les mouvements si absent). */
function yearsCovered(wf: Workforce, range?: DateRange): number[] {
  let minYear: number | null = null;
  let maxYear: number | null = null;
  if (range?.from) minYear = Number(range.from.slice(0, 4));
  if (range?.to) maxYear = Number(range.to.slice(0, 4));
  if (minYear === null || maxYear === null) {
    for (const m of wf.movements) {
      if (!m.plannedDate) continue;
      const y = Number(m.plannedDate.slice(0, 4));
      if (!Number.isFinite(y)) continue;
      if (minYear === null || y < minYear) minYear = y;
      if (maxYear === null || y > maxYear) maxYear = y;
    }
  }
  if (minYear === null || maxYear === null) {
    const currentYear = Number(HR_TODAY.slice(0, 4));
    return [currentYear];
  }
  const years: number[] = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);
  return years;
}

/**
 * Projection en cascade des mouvements par mois, trimestre ou année.
 *
 *  - Sans `range` : couvre toutes les années présentes dans les mouvements.
 *  - Avec `range` : les buckets couvrent la plage `from`/`to` (bornes incluses).
 *  - Chaque bucket porte ses mouvements et un détail signé par type (`byType`) — utilisé par
 *    le rythme mensuel et le pont ETP au clic.
 */
export function fteBridge(
  wf: Workforce,
  granularity: BridgeGranularity,
  range?: DateRange
): FteBridgeBucket[] {
  const years = yearsCovered(wf, range);
  const buckets: FteBridgeBucket[] = [];
  for (const year of years) {
    const bucketCount = granularity === "month" ? 12 : granularity === "quarter" ? 4 : 1;
    for (let i = 0; i < bucketCount; i++) {
      const { startISO, endISO, label } = bucketBounds(year, i, granularity);
      // Skip buckets entièrement hors range
      if (range?.from && endISO < range.from) continue;
      if (range?.to && startISO > range.to) continue;
      buckets.push({
        label,
        startISO,
        endISO,
        delta: 0,
        cumulative: 0,
        movements: [],
        byType: EMPTY_TYPE_DELTA(),
      });
    }
  }

  for (const m of wf.movements) {
    if (!isActiveMovement(m)) continue;
    if (!m.plannedDate) continue;
    if (range && !isInRange(m.plannedDate, range)) continue;
    const bucket = buckets.find((b) => m.plannedDate >= b.startISO && m.plannedDate <= b.endISO);
    if (!bucket) continue;
    const effect = fteEffect(m);
    bucket.delta += effect;
    // Filet défensif : m.type peut ne pas être une clé connue de MovementTypeDelta (donnée
    // legacy Firestore). On garde 0 comme valeur de base pour éviter la cascade NaN.
    const currentByType = bucket.byType[m.type] ?? 0;
    bucket.byType[m.type] = currentByType + effect;
    bucket.movements.push(m);
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

// ---------- Pont ETP (bridge summary sur une plage) ----------

/** Décomposition ETP d'une plage : ouverture, contributions par type (signées), clôture.
 *  Utilisé par le widget "Contribution des mouvements au résultat net" (pont ETP vertical). */
export type FteBridgeSummary = {
  opening: number;
  closing: number;
  contributions: { type: MovementType; delta: number }[];
};

export function fteBridgeSummary(wf: Workforce, range?: DateRange): FteBridgeSummary {
  // Ouverture = totalFTE + effet cumulé des mouvements RÉALISÉS avant `range.from`.
  let opening = wf.totalFTE;
  if (range?.from) {
    for (const m of wf.movements) {
      if (!isActiveMovement(m)) continue;
      if (!m.plannedDate || m.plannedDate >= range.from) continue;
      if (m.status === "Réalisé") opening += fteEffect(m);
    }
  }

  const contribs: MovementTypeDelta = EMPTY_TYPE_DELTA();
  for (const m of wf.movements) {
    if (!isActiveMovement(m)) continue;
    if (!m.plannedDate) continue;
    if (range && !isInRange(m.plannedDate, range)) continue;
    // Filet défensif type legacy → 0 (voir fteEffect / MovementTypeDelta).
    const currentContrib = contribs[m.type] ?? 0;
    contribs[m.type] = currentContrib + fteEffect(m);
  }
  const closing = opening + Object.values(contribs).reduce((s, v) => s + v, 0);

  return {
    opening: Math.round(opening * 10) / 10,
    closing: Math.round(closing * 10) / 10,
    contributions: MOVEMENT_TYPES.map((type) => ({
      type,
      delta: Math.round(contribs[type] * 10) / 10,
    })),
  };
}

// ---------- Breakdowns ----------

/** Ventilation d'un département par type de mouvement Gooduelle. Les 5 catégories sont
 *  exposées + `exits` = attritions + départs forcés (compat legacy avec les composants).
 *  Les transferts entrants/sortants sont comptés au département SOURCE (m.department) et au
 *  département CIBLE (m.toDepartment) séparément — un transfert impacte les deux. */
export type DepartmentMovements = {
  department: string;
  recrutements: number;
  attritions: number;
  forcedDepartures: number;
  transfertEntrants: number;
  transfertSortants: number;
  /** Legacy — somme des sorties (Attrition + Départ forcé), pour compat avec les composants
   *  existants qui affichent 3 séries (créations / départs / transferts). */
  exits: number;
  /** Legacy — somme des transferts entrants + sortants. */
  transferts: number;
  /** Impact net (signé) sur le département source / cible. */
  net: number;
};

export function movementsByDepartment(wf: Workforce): DepartmentMovements[] {
  const rows = new Map<string, DepartmentMovements>();
  const row = (dept: string) => {
    if (!rows.has(dept)) {
      rows.set(dept, {
        department: dept,
        recrutements: 0,
        attritions: 0,
        forcedDepartures: 0,
        transfertEntrants: 0,
        transfertSortants: 0,
        exits: 0,
        transferts: 0,
        net: 0,
      });
    }
    return rows.get(dept)!;
  };
  for (const m of wf.movements) {
    if (!isActiveMovement(m)) continue;
    if (m.type === "Recrutement") {
      const r = row(m.department);
      r.recrutements += m.fte;
      r.net += m.fte;
    } else if (m.type === "Attrition") {
      const r = row(m.department);
      r.attritions += m.fte;
      r.exits += m.fte;
      r.net -= m.fte;
    } else if (m.type === "Départ forcé") {
      const r = row(m.department);
      r.forcedDepartures += m.fte;
      r.exits += m.fte;
      r.net -= m.fte;
    } else if (m.type === "Transfert entrant" || m.type === "Transfert sortant") {
      // Sortie du département source.
      const rSrc = row(m.department);
      rSrc.transfertSortants += m.fte;
      rSrc.transferts += m.fte;
      rSrc.net -= m.fte;
      // Entrée au département cible si renseigné et différent.
      if (m.toDepartment && m.toDepartment !== m.department) {
        const rDst = row(m.toDepartment);
        rDst.transfertEntrants += m.fte;
        rDst.transferts += m.fte;
        rDst.net += m.fte;
      }
    }
  }
  return Array.from(rows.values()).sort((a, b) => b.exits - a.exits);
}

export function movementsByCountry(
  wf: Workforce
): { country: string; fte: number; count: number }[] {
  const rows = new Map<string, { country: string; fte: number; count: number }>();
  for (const m of wf.movements) {
    if (!isActiveMovement(m)) continue;
    const r = rows.get(m.country) ?? { country: m.country, fte: 0, count: 0 };
    r.fte += m.fte;
    r.count += 1;
    rows.set(m.country, r);
  }
  return Array.from(rows.values()).sort((a, b) => b.fte - a.fte);
}

export type MovementTypeSummary = { type: MovementType; count: number; fte: number };

export function movementsByType(wf: Workforce): MovementTypeSummary[] {
  return MOVEMENT_TYPES.map((type) => {
    const list = wf.movements.filter((m) => isActiveMovement(m) && m.type === type);
    return {
      type,
      count: list.length,
      fte: Math.round(list.reduce((s, m) => s + m.fte, 0) * 10) / 10,
    };
  }).filter((t) => t.count > 0);
}

// ---------- Vues dimensionnelles génériques ----------

export type WorkforceDimension = "department" | "country" | "workstream";

export type FtePositionRow = {
  key: string;
  label: string;
  current: number;
  target: number;
  landing: number;
  gapToTarget: number;
};

function signedFteForType(type: MovementType, fte: number): number {
  if (type === "Recrutement" || type === "Transfert entrant") return fte;
  if (type === "Attrition" || type === "Départ forcé" || type === "Transfert sortant") return -fte;
  return 0;
}

function movementFteValue(
  movement: WorkforceMovement,
  source: "actual" | "target" | "reforecast"
): number {
  if (source === "actual") return movement.fte;
  if (source === "target") return movement.lockedPlan?.fte ?? movement.fte;
  return movement.reforecast?.fte ?? movement.lockedPlan?.fte ?? movement.fte;
}

/** Contributions dimensionnelles d'un mouvement. Les transferts départementaux sortent du
 * département source et entrent dans le département cible ; pays/workstream utilisent le type
 * explicite entrant/sortant, faute de destination distincte dans le modèle. */
function dimensionalContributions(
  movement: WorkforceMovement,
  dimension: WorkforceDimension,
  source: "actual" | "target" | "reforecast"
): { key: string; delta: number }[] {
  const fte = movementFteValue(movement, source);
  if (dimension === "department") {
    if (movement.type === "Recrutement") return [{ key: movement.department, delta: fte }];
    if (movement.type === "Attrition" || movement.type === "Départ forcé") {
      return [{ key: movement.department, delta: -fte }];
    }
    const rows = [{ key: movement.department, delta: -fte }];
    if (movement.toDepartment && movement.toDepartment !== movement.department) {
      rows.push({ key: movement.toDepartment, delta: fte });
    }
    return rows;
  }
  const key = dimension === "country" ? movement.country : movement.workstream;
  if (!key) return [];
  return [{ key, delta: signedFteForType(movement.type, fte) }];
}

/** Positions ETP par département, pays ou workstream.
 * - Actuel = baseline + mouvements réalisés ;
 * - Cible = baseline + plan verrouillé de tous les mouvements ;
 * - Atterrissage = actuel + reforecast des mouvements non réalisés. */
export function ftePositionsByDimension(
  wf: Workforce,
  dimension: WorkforceDimension
): FtePositionRow[] {
  const baselines =
    dimension === "department"
      ? wf.departments.map((d) => ({ key: d.name, label: d.name, fte: d.fte }))
      : dimension === "country"
        ? (wf.countryBaselines ?? [])
        : (wf.workstreamBaselines ?? []);
  const rows = new Map(
    baselines.map((baseline) => [
      baseline.key,
      {
        key: baseline.key,
        label: baseline.label,
        baseline: baseline.fte,
        realizedDelta: 0,
        targetDelta: 0,
        remainingForecastDelta: 0,
      },
    ])
  );
  const ensure = (key: string) => {
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        label: key,
        baseline: 0,
        realizedDelta: 0,
        targetDelta: 0,
        remainingForecastDelta: 0,
      });
    }
    return rows.get(key)!;
  };

  for (const movement of wf.movements) {
    if (!isActiveMovement(movement)) continue;
    for (const contribution of dimensionalContributions(movement, dimension, "target")) {
      ensure(contribution.key).targetDelta += contribution.delta;
    }
    if (movement.status === "Réalisé") {
      for (const contribution of dimensionalContributions(movement, dimension, "actual")) {
        ensure(contribution.key).realizedDelta += contribution.delta;
      }
    } else {
      for (const contribution of dimensionalContributions(movement, dimension, "reforecast")) {
        ensure(contribution.key).remainingForecastDelta += contribution.delta;
      }
    }
  }

  return Array.from(rows.values())
    .map((row) => {
      const current = row.baseline + row.realizedDelta;
      const target = row.baseline + row.targetDelta;
      const landing = current + row.remainingForecastDelta;
      return {
        key: row.key,
        label: row.label,
        current: Math.round(current * 10) / 10,
        target: Math.round(target * 10) / 10,
        landing: Math.round(landing * 10) / 10,
        gapToTarget: Math.round((landing - target) * 10) / 10,
      };
    })
    .sort((a, b) => b.current - a.current);
}

export type MovementBreakdownDimension = "department" | "country";
export type MovementBreakdownRow = Omit<DepartmentMovements, "department"> & {
  key: string;
  label: string;
};

/** Ventilation prévue des cinq types de mouvements par département ou pays. */
export function movementBreakdownByDimension(
  movements: WorkforceMovement[],
  dimension: MovementBreakdownDimension
): MovementBreakdownRow[] {
  const rows = new Map<string, MovementBreakdownRow>();
  const ensure = (key: string) => {
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        label: key,
        recrutements: 0,
        attritions: 0,
        forcedDepartures: 0,
        transfertEntrants: 0,
        transfertSortants: 0,
        exits: 0,
        transferts: 0,
        net: 0,
      });
    }
    return rows.get(key)!;
  };
  for (const movement of movements) {
    if (!isActiveMovement(movement)) continue;
    if (dimension === "country") {
      const row = ensure(movement.country || "Non renseigné");
      if (movement.type === "Recrutement") row.recrutements += movement.fte;
      if (movement.type === "Attrition") row.attritions += movement.fte;
      if (movement.type === "Départ forcé") row.forcedDepartures += movement.fte;
      if (movement.type === "Transfert entrant") row.transfertEntrants += movement.fte;
      if (movement.type === "Transfert sortant") row.transfertSortants += movement.fte;
    } else {
      const source = ensure(movement.department);
      if (movement.type === "Recrutement") source.recrutements += movement.fte;
      if (movement.type === "Attrition") source.attritions += movement.fte;
      if (movement.type === "Départ forcé") source.forcedDepartures += movement.fte;
      if (movement.type === "Transfert entrant" || movement.type === "Transfert sortant") {
        source.transfertSortants += movement.fte;
        if (movement.toDepartment && movement.toDepartment !== movement.department) {
          ensure(movement.toDepartment).transfertEntrants += movement.fte;
        }
      }
    }
  }
  return Array.from(rows.values()).map((row) => {
    row.exits = row.attritions + row.forcedDepartures;
    row.transferts = row.transfertEntrants + row.transfertSortants;
    row.net =
      row.recrutements +
      row.transfertEntrants -
      row.attritions -
      row.forcedDepartures -
      row.transfertSortants;
    return row;
  });
}

export type MovementRealizationDimension = "function" | "country";
export type MovementRealizationRow = {
  key: string;
  label: string;
  realized: number;
  remaining: number;
  target: number;
};

/** Réalisé vs reste à faire en ETP, groupé par fonction ou pays et filtrable par type. */
export function movementRealizationByDimension(
  movements: WorkforceMovement[],
  dimension: MovementRealizationDimension,
  movementType?: MovementType
): MovementRealizationRow[] {
  const rows = new Map<string, MovementRealizationRow>();
  for (const movement of movements) {
    if (!isActiveMovement(movement)) continue;
    if (movementType && movement.type !== movementType) continue;
    const key = dimension === "function" ? movement.function : movement.country;
    if (!key) continue;
    const row = rows.get(key) ?? { key, label: key, realized: 0, remaining: 0, target: 0 };
    const targetFte = movement.lockedPlan?.fte ?? movement.fte;
    row.target += targetFte;
    if (movement.status === "Réalisé") row.realized += movement.fte;
    rows.set(key, row);
  }
  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      realized: Math.round(row.realized * 10) / 10,
      // Le widget doit recomposer exactement la cible : Réalisé + Reste à faire = Cible.
      remaining: Math.round(Math.max(0, row.target - row.realized) * 10) / 10,
      target: Math.round(row.target * 10) / 10,
    }))
    .sort((a, b) => b.target - a.target);
}

// ---------- Masse salariale ----------

export type SalaryBridgeBucket = {
  label: string;
  startISO: string;
  endISO: string;
  delta: number;
  cumulative: number;
};

/** Impact cumulé des mouvements sur la masse salariale annuelle (€M) — baseline massSalary,
 * chaque bucket ajoute les salaryImpact des mouvements planifiés dessus. */
export function salaryBridge(
  wf: Workforce,
  granularity: BridgeGranularity,
  range?: DateRange
): SalaryBridgeBucket[] {
  const fte = fteBridge(wf, granularity, range);
  let running = wf.massSalary;
  return fte.map((b) => {
    const deltaM = b.movements.reduce((s, m) => s + m.salaryImpact, 0) / 1_000_000;
    running += deltaM;
    return {
      label: b.label,
      startISO: b.startISO,
      endISO: b.endISO,
      delta: Math.round(deltaM * 100) / 100,
      cumulative: Math.round(running * 100) / 100,
    };
  });
}

/** Économies salariales annualisées des seuls mouvements réalisés (€). */
export function realizedSalarySavings(wf: Workforce): number {
  return wf.movements
    .filter((m) => isActiveMovement(m) && m.status === "Réalisé")
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
  const pse = wf.movements.filter((m) => isActiveMovement(m) && m.inPSE);
  return {
    postes: Math.round(pse.reduce((s, m) => s + m.fte, 0) * 10) / 10,
    enCours: pse.filter((m) => m.status === "À faire" || m.status === "Planifié").length,
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
      .filter((m) => isActiveMovement(m) && (m.department === d.name || m.toDepartment === d.name))
      .reduce((s, m) => {
        if ((m.type === "Attrition" || m.type === "Départ forcé") && m.department === d.name) {
          return s - m.fte;
        }
        if (m.type === "Recrutement" && m.department === d.name) {
          return s + m.fte;
        }
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

// ---------- Trajectoire effectifs cible vs réel ----------

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
 *  - `byType` : ventilation du delta total de la période par mécanisme */
export function fteTrajectory(
  wf: Workforce,
  granularity: "month" | "quarter"
): FteTrajectoryPoint[] {
  const bucketCount = granularity === "month" ? 12 : 4;
  const labels = granularity === "month" ? MONTH_LABELS : ["T1", "T2", "T3", "T4"];

  const points: FteTrajectoryPoint[] = Array.from({ length: bucketCount }, (_, i) => ({
    label: labels[i],
    actual: 0,
    planned: 0,
    target: 0,
    byType: EMPTY_TYPE_DELTA(),
  }));

  const tgt = targetFTE(wf);
  let runningActual = wf.totalFTE;
  let runningPlanned = wf.totalFTE;

  for (const m of wf.movements) {
    if (!isActiveMovement(m)) continue;
    const month = Number(m.plannedDate.slice(5, 7)) - 1;
    if (Number.isNaN(month) || month < 0 || month > 11) continue;
    const idx = granularity === "month" ? month : Math.floor(month / 3);
    const effect = fteEffect(m);
    points[idx].byType[m.type] = (points[idx].byType[m.type] ?? 0) + effect;
  }

  for (let i = 0; i < bucketCount; i++) {
    const plannedDelta = wf.movements
      .filter((m) => {
        if (!isActiveMovement(m)) return false;
        const month = Number(m.plannedDate.slice(5, 7)) - 1;
        const idx = granularity === "month" ? month : Math.floor(month / 3);
        return idx === i;
      })
      .reduce((s, m) => s + fteEffect(m), 0);
    runningPlanned += plannedDelta;

    const actualDelta = wf.movements
      .filter((m) => {
        if (!isActiveMovement(m)) return false;
        if (m.status !== "Réalisé") return false;
        const month = Number(m.plannedDate.slice(5, 7)) - 1;
        const idx = granularity === "month" ? month : Math.floor(month / 3);
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

// ---------- Alertes de réconciliation RH ↔ leviers ----------

export type MovementAlertKind = "overdue" | "due" | "toValidate" | "leverMismatch";

export type MovementAlert = {
  movement: WorkforceMovement;
  kind: MovementAlertKind;
  message: string;
};

const DUE_WINDOW_DAYS = 7;

export function movementAlerts(
  wf: Workforce,
  levers: Lever[],
  today: string = HR_TODAY
): MovementAlert[] {
  const alerts: MovementAlert[] = [];

  for (const m of wf.movements) {
    if (!isActiveMovement(m)) continue;
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
