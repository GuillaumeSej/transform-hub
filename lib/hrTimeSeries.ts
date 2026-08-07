import type { MovementType, WorkforceMovement } from "@/types";
import { fteEffect, type BridgeGranularity, type DateRange } from "@/lib/hrEngine";
import { isActiveMovement } from "@/lib/workforceLogic";

/**
 * Séries temporelles pour les 4 nouveaux graphiques Gooduelle du Dashboard RH :
 *   - `salarySavingsSeries` — barres Actual+Forecast vs Plan + courbes cumul (double échelle Y).
 *   - `socialCostSeries` — barres ENR par période + courbe cumul.
 *   - `netEconomySeries` — barres +/− économie nette + courbe cumul.
 *   - `movementRhythmSeries` — barres empilées 5 types + point net + courbe cumul.
 *
 * Toutes ces fonctions groupent les mouvements en buckets temporels (Mois/Trimestre/Année) et
 * ne contiennent AUCUN accès I/O — elles reçoivent les mouvements déjà filtrés par la page.
 * Le référentiel de "date d'arrêté" est fourni par l'appelant : au-delà, les valeurs
 * réelles sont remplacées par les valeurs prévues (reforecast si dispo, sinon plan).
 */

const MONTH_LABELS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

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
function generateBuckets(range: DateRange, granularity: BridgeGranularity): BucketKey[] {
  const fromYear = range.from ? Number(range.from.slice(0, 4)) : new Date().getFullYear();
  const toYear = range.to ? Number(range.to.slice(0, 4)) : fromYear + 2;
  const buckets: BucketKey[] = [];

  for (let year = fromYear; year <= toYear; year++) {
    const bucketCount = granularity === "month" ? 12 : granularity === "quarter" ? 4 : 1;
    for (let idx = 0; idx < bucketCount; idx++) {
      let startISO: string;
      let endISO: string;
      let label: string;
      if (granularity === "month") {
        startISO = firstDayOfMonth(year, idx);
        endISO = lastDayOfMonth(year, idx);
        label = `${MONTH_LABELS[idx]} ${year}`;
      } else if (granularity === "quarter") {
        const startMonth = idx * 3;
        startISO = firstDayOfMonth(year, startMonth);
        endISO = lastDayOfMonth(year, startMonth + 2);
        label = `T${idx + 1} ${year}`;
      } else {
        startISO = firstDayOfMonth(year, 0);
        endISO = lastDayOfMonth(year, 11);
        label = `${year}`;
      }
      if (range.from && endISO < range.from) continue;
      if (range.to && startISO > range.to) continue;
      buckets.push({
        key: `${year}-${idx}`,
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

// ---------- Économies salariales : actual + forecast vs plan + cumul ----------

export type SalarySavingsBucket = {
  label: string;
  startISO: string;
  endISO: string;
  /** Valeurs Actual (m.savings pour Réalisé) + Forecast (reforecast/lockedPlan/brut pour les
   *  non-réalisés). €M par période. */
  actualPlusForecast: number;
  /** Plan initial (lockedPlan.savings ou m.savings) €M par période. */
  plan: number;
  /** Cumul Actual+Forecast depuis le début de la plage — €M. */
  cumulActualForecast: number;
  /** Cumul Plan depuis le début de la plage — €M. */
  cumulPlan: number;
  /** Flag pour distinguer les buckets antérieurs à la date d'arrêté (Actual) des suivants
   *  (Forecast) — pour la ligne verticale de repère sur le graphique. */
  isFuture: boolean;
};

/** Économies salariales par période (Actual pour le passé, Forecast pour le futur) vs Plan
 *  initial, plus les cumuls (double axe Y du graphique). Valeurs converties en €M pour
 *  l'affichage cohérent avec le reste du dashboard. */
export function salarySavingsSeries(
  movements: WorkforceMovement[],
  granularity: BridgeGranularity,
  range: DateRange,
  referenceDate: string
): SalarySavingsBucket[] {
  const buckets = generateBuckets(range, granularity);
  if (buckets.length === 0) return [];

  const map = new Map<string, { actual: number; forecast: number; plan: number }>();
  for (const b of buckets) map.set(b.key, { actual: 0, forecast: 0, plan: 0 });

  for (const m of movements) {
    if (!isActiveMovement(m)) continue;
    if (!m.plannedDate) continue;
    const b = findBucket(buckets, m.plannedDate);
    if (!b) continue;
    const cell = map.get(b.key)!;
    const planValue = m.lockedPlan?.savings ?? m.savings;
    cell.plan += planValue;

    if (m.status === "Réalisé") {
      cell.actual += m.savings;
    } else {
      // Non réalisé : le forecast est reforecast ?? lockedPlan ?? savings brut.
      const forecastValue = m.reforecast?.savings ?? m.lockedPlan?.savings ?? m.savings;
      cell.forecast += forecastValue;
    }
  }

  let cumulActualForecast = 0;
  let cumulPlan = 0;
  return buckets.map((b) => {
    const cell = map.get(b.key)!;
    const actualForecast = (cell.actual + cell.forecast) / 1_000_000;
    const plan = cell.plan / 1_000_000;
    cumulActualForecast += actualForecast;
    cumulPlan += plan;
    return {
      label: b.label,
      startISO: b.startISO,
      endISO: b.endISO,
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
  label: string;
  startISO: string;
  endISO: string;
  /** ENR par période — €M. */
  enr: number;
  /** Cumul ENR — €M. */
  cumulEnr: number;
};

/** ENR (Éléments Non Récurrents = coûts sociaux one-off) par période, avec cumul. Reflète
 *  reforecast ?? lockedPlan ?? cost brut, converti en €M. */
export function socialCostSeries(
  movements: WorkforceMovement[],
  granularity: BridgeGranularity,
  range: DateRange
): SocialCostBucket[] {
  const buckets = generateBuckets(range, granularity);
  if (buckets.length === 0) return [];

  const map = new Map<string, number>();
  for (const b of buckets) map.set(b.key, 0);

  for (const m of movements) {
    if (!isActiveMovement(m)) continue;
    if (!m.plannedDate) continue;
    const b = findBucket(buckets, m.plannedDate);
    if (!b) continue;
    const value = m.reforecast?.cost ?? m.lockedPlan?.cost ?? m.cost;
    map.set(b.key, (map.get(b.key) ?? 0) + value);
  }

  let cumul = 0;
  return buckets.map((b) => {
    const enr = (map.get(b.key) ?? 0) / 1_000_000;
    cumul += enr;
    return {
      label: b.label,
      startISO: b.startISO,
      endISO: b.endISO,
      enr: Math.round(enr * 1000) / 1000,
      cumulEnr: Math.round(cumul * 1000) / 1000,
    };
  });
}

// ---------- Économie nette (savings − ENR) ----------

export type NetEconomyBucket = {
  label: string;
  startISO: string;
  endISO: string;
  /** Économie nette de la période — €M (signée : positive ou négative). */
  net: number;
  /** Cumul économie nette depuis le début de la plage — €M. */
  cumulNet: number;
};

/** Économie nette (staff costs économisés − ENR) par période et cumulée. */
export function netEconomySeries(
  movements: WorkforceMovement[],
  granularity: BridgeGranularity,
  range: DateRange
): NetEconomyBucket[] {
  const buckets = generateBuckets(range, granularity);
  if (buckets.length === 0) return [];

  const map = new Map<string, { savings: number; cost: number }>();
  for (const b of buckets) map.set(b.key, { savings: 0, cost: 0 });

  for (const m of movements) {
    if (!isActiveMovement(m)) continue;
    if (!m.plannedDate) continue;
    const b = findBucket(buckets, m.plannedDate);
    if (!b) continue;
    const cell = map.get(b.key)!;
    const savings = m.reforecast?.savings ?? m.lockedPlan?.savings ?? m.savings;
    const cost = m.reforecast?.cost ?? m.lockedPlan?.cost ?? m.cost;
    cell.savings += savings;
    cell.cost += cost;
  }

  let cumul = 0;
  return buckets.map((b) => {
    const cell = map.get(b.key)!;
    const net = (cell.savings - cell.cost) / 1_000_000;
    cumul += net;
    return {
      label: b.label,
      startISO: b.startISO,
      endISO: b.endISO,
      net: Math.round(net * 1000) / 1000,
      cumulNet: Math.round(cumul * 1000) / 1000,
    };
  });
}

// ---------- Rythme des mouvements ----------

export type MovementRhythmBucket = {
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
};

/** Rythme mensuel/trimestriel/annuel des mouvements décomposé par les 5 types + net + cumul.
 *
 *  Les 5 barres sont visuellement empilées :
 *  - Positives (au-dessus de 0) : Recrutements (vert)
 *  - Négatives (en-dessous de 0) : Attrition (orange), Départs forcés (rouge)
 *  - Nulles nettement (colonnes empilées visuellement) : Transferts entrants/sortants (gris)
 *
 *  Le "net" est la somme algébrique — les transferts internes n'y contribuent pas (fteEffect = 0).
 *  Un point noir marque le net période, une ligne noire relie les cumuls. */
export function movementRhythmSeries(
  movements: WorkforceMovement[],
  granularity: BridgeGranularity,
  range: DateRange
): MovementRhythmBucket[] {
  const buckets = generateBuckets(range, granularity);
  if (buckets.length === 0) return [];

  const emptyByType = (): Record<MovementType, number> => ({
    Recrutement: 0,
    Attrition: 0,
    "Départ forcé": 0,
    "Transfert entrant": 0,
    "Transfert sortant": 0,
  });

  const map = new Map<string, Record<MovementType, number>>();
  for (const b of buckets) map.set(b.key, emptyByType());

  for (const m of movements) {
    if (!isActiveMovement(m)) continue;
    if (!m.plannedDate) continue;
    const b = findBucket(buckets, m.plannedDate);
    if (!b) continue;
    const cell = map.get(b.key)!;
    // Les transferts internes sont affichés en volume brut (signé selon direction) pour la
    // décomposition visuelle : entrants au-dessus (positif = accueil), sortants en-dessous
    // (négatif = perte pour le département source). Mais leur effet net reste 0 (fteEffect).
    if (m.type === "Recrutement") cell[m.type] += m.fte;
    else if (m.type === "Attrition" || m.type === "Départ forcé") cell[m.type] -= m.fte;
    else if (m.type === "Transfert entrant") cell[m.type] += m.fte;
    else if (m.type === "Transfert sortant") cell[m.type] -= m.fte;
  }

  let cumul = 0;
  return buckets.map((b) => {
    const byType = map.get(b.key)!;
    // Le net programme (impact ETP total) = fteEffect appliqué à tous les mouvements du bucket.
    // On le recalcule proprement à partir des mouvements pour rester cohérent avec `fteBridge`.
    const netMovements = movements.filter(
      (m) => isActiveMovement(m) && m.plannedDate >= b.startISO && m.plannedDate <= b.endISO
    );
    const net = netMovements.reduce((s, m) => s + fteEffect(m), 0);
    cumul += net;
    return {
      label: b.label,
      startISO: b.startISO,
      endISO: b.endISO,
      byType,
      net: Math.round(net * 10) / 10,
      cumulNet: Math.round(cumul * 10) / 10,
    };
  });
}
