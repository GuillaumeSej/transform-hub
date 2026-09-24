import type { MovementType, WorkforceMovement } from "@/types";
import type { BridgeGranularity, DateRange, HrSeriesOptions } from "@/lib/hrEngine";
import { hrPeriodKey, hrPeriodLabel, hrToday } from "@/lib/hrEngine";
import { isActiveMovement } from "@/lib/workforceLogic";
import {
  movementSalarySavings,
  planMovementFte,
  targetMovementFteImpact,
} from "@/lib/hrProgramSummary";

/**
 * Séries temporelles pour les 4 nouveaux graphiques Gooduelle du Dashboard RH :
 *   - `salarySavingsSeries` — barres Actual+Forecast vs Plan + courbes cumul (double échelle Y).
 *   - `socialCostSeries` — barres ENR par période + courbe cumul.
 *   - `netEconomySeries` — barres +/− économie nette + courbe cumul.
 *   - `movementRhythmSeries` — barres empilées 5 types + point net + courbe cumul.
 *
 * Toutes ces fonctions groupent les mouvements en buckets temporels (Mois/Trimestre/Année) et
 * ne contiennent AUCUN accès I/O — elles reçoivent les mouvements déjà filtrés par la page.
 * Le référentiel de "date d'arrêté" est fourni par l'appelant (défaut `hrToday()`) : les
 * mouvements réalisés comptent au réalisé à leur date effective, les autres en prévision à partir
 * de leur date prévue — jamais avant la date d'arrêté (un mouvement en retard n'a encore rien
 * produit).
 *
 * Plan : mouvements ABANDONNÉS exclus, comme pour les KPI (M8). Chaque bucket expose une `key`
 * stable ("2026-02", "2026-Q1", "2026") et un `label` localisé (`options.locale`).
 */

/** Structure commune d'un bucket temporel. */
type BucketKey = {
  key: string;
  label: string;
  startISO: string;
  endISO: string;
  year: number;
  index: number;
};

function firstDayOfMonth(year: number, monthIdx: number): string {
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}-01`;
}

function lastDayOfMonth(year: number, monthIdx: number): string {
  const d = new Date(year, monthIdx + 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Génère la liste ordonnée des buckets sur la plage `range` selon la granularité. */
function generateBuckets(
  range: DateRange,
  granularity: BridgeGranularity,
  locale?: string
): BucketKey[] {
  const fromYear = range.from ? Number(range.from.slice(0, 4)) : new Date().getFullYear();
  const toYear = range.to ? Number(range.to.slice(0, 4)) : fromYear + 2;
  const buckets: BucketKey[] = [];

  for (let year = fromYear; year <= toYear; year++) {
    const bucketCount = granularity === "month" ? 12 : granularity === "quarter" ? 4 : 1;
    for (let idx = 0; idx < bucketCount; idx++) {
      let startISO: string;
      let endISO: string;
      if (granularity === "month") {
        startISO = firstDayOfMonth(year, idx);
        endISO = lastDayOfMonth(year, idx);
      } else if (granularity === "quarter") {
        const startMonth = idx * 3;
        startISO = firstDayOfMonth(year, startMonth);
        endISO = lastDayOfMonth(year, startMonth + 2);
      } else {
        startISO = firstDayOfMonth(year, 0);
        endISO = lastDayOfMonth(year, 11);
      }
      const label = hrPeriodLabel(year, idx, granularity, locale);
      if (range.from && endISO < range.from) continue;
      if (range.to && startISO > range.to) continue;
      buckets.push({
        key: hrPeriodKey(year, idx, granularity),
        label,
        startISO,
        endISO,
        year,
        index: idx,
      });
    }
  }
  return buckets;
}

function findBucket(buckets: BucketKey[], dateISO: string): BucketKey | undefined {
  return buckets.find((b) => dateISO >= b.startISO && dateISO <= b.endISO);
}

function effectDate(movement: WorkforceMovement): string {
  return movement.status === "Réalisé"
    ? (movement.actualDate ?? movement.plannedDate)
    : movement.plannedDate;
}

/** Proratisation calendaire d'un impact annuel récurrent sur les mois actifs du bucket. */
function recurringImpactForBucket(
  annualImpact: number,
  startISO: string,
  bucket: BucketKey
): number {
  const startYear = Number(startISO.slice(0, 4));
  const startMonth = Number(startISO.slice(5, 7));
  let activeMonths = 0;
  const cursor = new Date(`${bucket.startISO}T00:00:00Z`);
  const end = new Date(`${bucket.endISO}T00:00:00Z`);
  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    if (year > startYear || (year === startYear && month >= startMonth)) activeMonths += 1;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return (annualImpact / 12) * activeMonths;
}

// ---------- Économies salariales : actual + forecast vs plan + cumul ----------

export type SalarySavingsBucket = {
  /** Clé stable de la période ("2026-02", "2026-Q1", "2026"). */
  key: string;
  label: string;
  startISO: string;
  endISO: string;
  /** Économies nettes de masse salariale (€M) des mouvements RÉALISÉS, à partir de leur date
   *  effective (−salaryImpact proratisé, recrutements négatifs — définition unique M7). */
  realized: number;
  /** Économies nettes (€M) des mouvements NON réalisés (prévision), à partir de
   *  max(date prévue, date d'arrêté) — un mouvement en retard n'a encore rien produit (M9). */
  forecast: number;
  /** realized + forecast (€M) — barre "Réalisé + prévision". */
  actualPlusForecast: number;
  /** Plan initial récurrent, dérivé de `−(lockedPlan.salaryImpact ?? salaryImpact)`, mouvements
   *  abandonnés exclus (M8). */
  plan: number;
  /** Cumul Actual+Forecast depuis le début de la plage — €M. */
  cumulActualForecast: number;
  /** Cumul Plan depuis le début de la plage — €M. */
  cumulPlan: number;
  /** Bucket postérieur à la date d'arrêté (repère visuel uniquement — le statut réalisé /
   *  prévision d'une période se lit sur `realized` / `forecast`, pas sur la date du bucket). */
  isFuture: boolean;
};

/** Économies nettes de masse salariale récurrentes par période et cumul, proratisées
 *  mensuellement, avec séparation réalisé / prévision par STATUT des mouvements (M9). */
export function salarySavingsSeries(
  movements: WorkforceMovement[],
  granularity: BridgeGranularity,
  range: DateRange,
  referenceDate: string = hrToday(),
  options: HrSeriesOptions = {}
): SalarySavingsBucket[] {
  const buckets = generateBuckets(range, granularity, options.locale);
  if (buckets.length === 0) return [];
  const active = movements.filter(isActiveMovement);

  let cumulActualForecast = 0;
  let cumulPlan = 0;
  return buckets.map((b) => {
    let realized = 0;
    let forecast = 0;
    let plan = 0;
    for (const movement of active) {
      plan += recurringImpactForBucket(
        movementSalarySavings(movement, "target"),
        movement.plannedDate,
        b
      );
      // Économie positive pour une baisse de masse salariale, négative pour un recrutement.
      const savings = movementSalarySavings(movement, "actual");
      if (movement.status === "Réalisé") {
        realized += recurringImpactForBucket(savings, effectDate(movement), b);
      } else {
        const start =
          movement.plannedDate && movement.plannedDate > referenceDate
            ? movement.plannedDate
            : referenceDate;
        forecast += recurringImpactForBucket(savings, start, b);
      }
    }
    realized /= 1_000_000;
    forecast /= 1_000_000;
    plan /= 1_000_000;
    const actualForecast = realized + forecast;
    cumulActualForecast += actualForecast;
    cumulPlan += plan;
    return {
      key: b.key,
      label: b.label,
      startISO: b.startISO,
      endISO: b.endISO,
      realized: Math.round(realized * 1000) / 1000,
      forecast: Math.round(forecast * 1000) / 1000,
      actualPlusForecast: Math.round(actualForecast * 1000) / 1000,
      plan: Math.round(plan * 1000) / 1000,
      cumulActualForecast: Math.round(cumulActualForecast * 1000) / 1000,
      cumulPlan: Math.round(cumulPlan * 1000) / 1000,
      isFuture: b.startISO > referenceDate,
    };
  });
}

// ---------- ENR (coûts sociaux exceptionnels) par période + cumul ----------

export type SocialCostBucket = {
  key: string;
  label: string;
  startISO: string;
  endISO: string;
  actualForecast: number;
  plan: number;
  cumulActualForecast: number;
  cumulPlan: number;
};

/** ENR par période, strictement basé sur la colonne `movement.cost`, compté une seule fois.
 *  Plan : `lockedPlan.cost ?? cost` des mouvements actifs (abandonnés exclus, M8). */
export function socialCostSeries(
  movements: WorkforceMovement[],
  granularity: BridgeGranularity,
  range: DateRange,
  options: HrSeriesOptions = {}
): SocialCostBucket[] {
  const buckets = generateBuckets(range, granularity, options.locale);
  if (buckets.length === 0) return [];

  let cumulActualForecast = 0;
  let cumulPlan = 0;
  return buckets.map((b) => {
    let actualForecast = 0;
    let plan = 0;
    for (const movement of movements) {
      if (!isActiveMovement(movement)) continue;
      const planDate = movement.plannedDate;
      if (planDate >= b.startISO && planDate <= b.endISO) {
        plan += movement.lockedPlan?.cost ?? movement.cost;
      }
      const date = effectDate(movement);
      if (date >= b.startISO && date <= b.endISO) actualForecast += movement.cost;
    }
    actualForecast /= 1_000_000;
    plan /= 1_000_000;
    cumulActualForecast += actualForecast;
    cumulPlan += plan;
    return {
      key: b.key,
      label: b.label,
      startISO: b.startISO,
      endISO: b.endISO,
      actualForecast: Math.round(actualForecast * 1000) / 1000,
      plan: Math.round(plan * 1000) / 1000,
      cumulActualForecast: Math.round(cumulActualForecast * 1000) / 1000,
      cumulPlan: Math.round(cumulPlan * 1000) / 1000,
    };
  });
}

// ---------- Économie nette (savings − ENR) ----------

export type NetEconomyBucket = {
  key: string;
  label: string;
  startISO: string;
  endISO: string;
  actualForecast: number;
  plan: number;
  cumulActualForecast: number;
  cumulPlan: number;
};

/** Économie nette = impact salarial récurrent moins coût social one-off. */
export function netEconomySeries(
  movements: WorkforceMovement[],
  granularity: BridgeGranularity,
  range: DateRange,
  referenceDate: string = hrToday(),
  options: HrSeriesOptions = {}
): NetEconomyBucket[] {
  const buckets = generateBuckets(range, granularity, options.locale);
  if (buckets.length === 0) return [];

  const savings = salarySavingsSeries(movements, granularity, range, referenceDate, options);
  const enr = socialCostSeries(movements, granularity, range, options);
  return buckets.map((bucket, index) => ({
    key: bucket.key,
    label: bucket.label,
    startISO: bucket.startISO,
    endISO: bucket.endISO,
    actualForecast:
      Math.round((savings[index].actualPlusForecast - enr[index].actualForecast) * 1000) / 1000,
    plan: Math.round((savings[index].plan - enr[index].plan) * 1000) / 1000,
    cumulActualForecast:
      Math.round((savings[index].cumulActualForecast - enr[index].cumulActualForecast) * 1000) /
      1000,
    cumulPlan: Math.round((savings[index].cumulPlan - enr[index].cumulPlan) * 1000) / 1000,
  }));
}

// ---------- Rythme des mouvements ----------

export type MovementRhythmBucket = {
  key: string;
  label: string;
  startISO: string;
  endISO: string;
  /** Volume signé par type sur la période — Recrutements/Transferts positifs, Attrition/Départs
   *  forcés négatifs, transferts entrants/sortants nuls sur l'impact net (mais non nuls dans
   *  chaque colonne pour la visualisation empilée). */
  byType: Record<MovementType, number>;
  /** Net période (signé). */
  net: number;
  /** Cumul net depuis le début de la plage. */
  cumulNet: number;
  /** Mouvements actifs de la période (même granularité que `FteBridgeBucket.movements` de
   *  `lib/hrEngine.ts`, dont ce bucket reprend la convention) — alimente le drill-down au clic sur
   *  une barre (`MovementRhythmChart` + `MovementDrilldownModal`). */
  movements: WorkforceMovement[];
};

export type MovementRhythmAxisDomains = {
  period: [number, number];
  cumulative: [number, number];
};

/** Arrondit une borne positive à une graduation lisible (1/2/5 × puissance de 10). */
function niceAxisMax(value: number, padding: number): number {
  const padded = Math.max(1, value * padding);
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  const normalized = padded / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Domaines symétriques du graphique rythme des mouvements.
 *
 * L'axe période doit considérer les SOMMES empilées positives/négatives par bucket, et non la
 * plus grande série individuelle. Une marge protège également les barres, points et courbes des
 * limites du canvas. Les deux domaines sont symétriques afin que leurs zéros coïncident. */
export function movementRhythmAxisDomains(
  buckets: MovementRhythmBucket[]
): MovementRhythmAxisDomains {
  let periodExtent = 1;
  let cumulativeExtent = 1;
  for (const bucket of buckets) {
    const values = Object.values(bucket.byType);
    const positiveStack = values.reduce((sum, value) => sum + Math.max(0, value), 0);
    const negativeStack = values.reduce((sum, value) => sum + Math.min(0, value), 0);
    periodExtent = Math.max(
      periodExtent,
      Math.abs(positiveStack),
      Math.abs(negativeStack),
      Math.abs(bucket.net)
    );
    cumulativeExtent = Math.max(cumulativeExtent, Math.abs(bucket.cumulNet));
  }
  const periodMax = niceAxisMax(periodExtent, 1.2);
  const cumulativeMax = niceAxisMax(cumulativeExtent, 1.15);
  return {
    period: [-periodMax, periodMax],
    cumulative: [-cumulativeMax, cumulativeMax],
  };
}

/** Rythme mensuel/trimestriel/annuel des mouvements décomposé par les 5 types + net + cumul.
 *
 *  Les 5 barres sont visuellement empilées :
 *  - Positives (au-dessus de 0) : Recrutements (vert)
 *  - Négatives (en-dessous de 0) : Attrition (orange), Départs forcés (rouge)
 *  - Nulles nettement (colonnes empilées visuellement) : Transferts entrants/sortants (gris)
 *
 *  Le "net" (transferts neutralisés) n'est plus tracé : il est affiché comme "Bilan net" dans
 *  l'infobulle et la modale (`lib/hrMovementBalance.ts`). Seule la courbe du cumul net est tracée. */
export function movementRhythmSeries(
  movements: WorkforceMovement[],
  granularity: BridgeGranularity,
  range: DateRange,
  options: HrSeriesOptions = {}
): MovementRhythmBucket[] {
  const buckets = generateBuckets(range, granularity, options.locale);
  if (buckets.length === 0) return [];

  const emptyByType = (): Record<MovementType, number> => ({
    Recrutement: 0,
    Attrition: 0,
    "Départ forcé": 0,
    "Transfert entrant": 0,
    "Transfert sortant": 0,
  });

  const map = new Map<string, Record<MovementType, number>>();
  const movementsByBucket = new Map<string, WorkforceMovement[]>();
  for (const b of buckets) {
    map.set(b.key, emptyByType());
    movementsByBucket.set(b.key, []);
  }

  for (const m of movements) {
    if (!isActiveMovement(m)) continue;
    if (!m.plannedDate) continue;
    const b = findBucket(buckets, m.plannedDate);
    if (!b) continue;
    const cell = map.get(b.key)!;
    // Les transferts sont affichés en volume brut signé : entrants positifs, sortants négatifs.
    // Vue PLAN : ETP = lockedPlan.fte ?? fte (règle M10).
    const targetFte = planMovementFte(m);
    if (m.type === "Recrutement") cell[m.type] += targetFte;
    else if (m.type === "Attrition" || m.type === "Départ forcé") cell[m.type] -= targetFte;
    else if (m.type === "Transfert entrant") cell[m.type] += targetFte;
    else if (m.type === "Transfert sortant") cell[m.type] -= targetFte;
    movementsByBucket.get(b.key)!.push(m);
  }

  let cumul = 0;
  return buckets.map((b) => {
    const byType = map.get(b.key)!;
    // Net cible = même définition que le KPI Impact ETP. Les transferts sont des flux visibles
    // mais restent neutres sur l'effectif total.
    const net = movements
      .filter((movement) => movement.plannedDate >= b.startISO && movement.plannedDate <= b.endISO)
      .reduce((sum, movement) => sum + targetMovementFteImpact(movement), 0);
    cumul += net;
    return {
      key: b.key,
      label: b.label,
      startISO: b.startISO,
      endISO: b.endISO,
      byType,
      net: Math.round(net * 10) / 10,
      cumulNet: Math.round(cumul * 10) / 10,
      movements: movementsByBucket.get(b.key)!,
    };
  });
}
