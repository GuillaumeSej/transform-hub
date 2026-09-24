import type { BeTrackData } from "@/types";
import {
  bucketInvestVsSavingsByPeriod,
  investVsSavingsRowsForPeriod,
  type FinanceGranularity,
  type InvestVsSavingsLeverRow,
  type InvestVsSavingsPoint,
} from "@/lib/financeCosts";

/**
 * Ligne de calcul complète du graphique "Coût d'investissement vs Savings", pour UNE période
 * (clic sur une barre/un point/un libellé de période) ou pour l'ensemble de l'horizon (vue
 * "Total"). Aucune formule n'est dupliquée : les montants viennent de
 * `bucketInvestVsSavingsByPeriod` (ce qu'affiche le graphique) et le partage CAPEX / OPEX ponctuel
 * + la contribution par levier de `investVsSavingsRowsForPeriod` (mêmes règles d'attribution).
 * Fonction pure — voir lib/__tests__/investVsSavingsCalc.test.ts.
 */
export type InvestVsSavingsCalc = {
  scope: "period" | "total";
  /** Clé de la période ("YYYY", "YYYY-Q#", "YYYY-MM"), `null` pour la vue Total. */
  periodKey: string | null;
  /** Libellé de la période (ou de l'horizon "Q1 2026 → Q4 2027" pour la vue Total). */
  periodLabel: string;
  grossSavings: number;
  opexRec: number;
  /** grossSavings − opexRec. */
  netSavings: number;
  capex: number;
  opexOneOff: number;
  /** capex + opexOneOff (= `investCost` du graphique). */
  investCost: number;
  /** netSavings − investCost (= barre signée du graphique, ou somme des barres en vue Total). */
  netResult: number;
  /** Cumul net à la fin de la période (vue Total : cumul final de l'horizon). */
  cumulative: number;
  /** ROI (%) = netResult / investCost × 100 — `null` si aucun investissement. Même assiette que les
   *  barres (gains et OPEX récurrents en run-rate sur la période/l'horizon, ETP compris). */
  roiPct: number | null;
  /** Première période où le cumul net repasse ≥ 0 après avoir été négatif (breakeven). */
  paybackLabel: string | null;
  /** Nombre de périodes écoulées depuis le début de l'horizon jusqu'au breakeven (inclus). */
  paybackPeriods: number | null;
  /** Contribution par levier (période cliquée ou horizon complet). */
  rows: InvestVsSavingsLeverRow[];
  /** 5 leviers au plus fort impact absolu sur le résultat net (signe conservé). */
  topLevers: InvestVsSavingsLeverRow[];
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Fusionne des lignes par levier (vue Total : somme des décompositions de chaque période). */
function mergeLeverRows(rows: InvestVsSavingsLeverRow[]): InvestVsSavingsLeverRow[] {
  const byLever = new Map<string, InvestVsSavingsLeverRow>();
  for (const r of rows) {
    const cur = byLever.get(r.leverId);
    if (!cur) {
      byLever.set(r.leverId, { ...r });
      continue;
    }
    cur.grossSavings += r.grossSavings;
    cur.opexRec += r.opexRec;
    cur.opexOneOff += r.opexOneOff;
    cur.capex += r.capex;
  }
  return Array.from(byLever.values())
    .map((r) => ({
      ...r,
      grossSavings: round2(r.grossSavings),
      opexRec: round2(r.opexRec),
      opexOneOff: round2(r.opexOneOff),
      capex: round2(r.capex),
      net: round2(r.grossSavings - r.opexRec - r.opexOneOff - r.capex),
    }))
    .sort((a, b) => a.net - b.net);
}

/** Breakeven : 1re période où le cumul net ≥ 0 après avoir été négatif. */
export function investVsSavingsPayback(
  points: InvestVsSavingsPoint[]
): { label: string; periods: number } | null {
  let wasNegative = false;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.netCumulative < 0) wasNegative = true;
    if (wasNegative && p.netCumulative >= 0) return { label: p.period, periods: i + 1 };
  }
  return null;
}

export function buildInvestVsSavingsCalc(
  data: BeTrackData,
  granularity: FinanceGranularity,
  periodKey: string | null,
  /** Points déjà calculés par le graphique (évite de les recalculer) — optionnel. */
  precomputedPoints?: InvestVsSavingsPoint[]
): InvestVsSavingsCalc | null {
  const points = precomputedPoints ?? bucketInvestVsSavingsByPeriod(data, granularity);
  if (points.length === 0) return null;
  const payback = investVsSavingsPayback(points);

  let scoped: InvestVsSavingsPoint[];
  let rows: InvestVsSavingsLeverRow[];
  let periodLabel: string;
  let cumulative: number;
  if (periodKey === null) {
    scoped = points;
    // Horizon complet : mêmes flux que les barres (run-rate compris), agrégés par levier en une passe.
    rows = mergeLeverRows(investVsSavingsRowsForPeriod(data, granularity, null));
    const first = points[0].period;
    const last = points[points.length - 1].period;
    periodLabel = first === last ? first : `${first} → ${last}`;
    cumulative = points[points.length - 1].netCumulative;
  } else {
    const point = points.find((p) => p.sortKey === periodKey);
    if (!point) return null;
    scoped = [point];
    rows = investVsSavingsRowsForPeriod(data, granularity, periodKey);
    periodLabel = point.period;
    cumulative = point.netCumulative;
  }

  const sum = (f: (p: InvestVsSavingsPoint) => number) =>
    round2(scoped.reduce((s, p) => s + f(p), 0));
  const grossSavings = sum((p) => p.grossSavings);
  const opexRec = sum((p) => p.opexRecStarted);
  const netSavings = sum((p) => p.netSavings);
  const investCost = sum((p) => p.investCost);
  const netResult = sum((p) => p.netPeriodResult);
  const capex = round2(rows.reduce((s, r) => s + r.capex, 0));
  // Le reste de l'investissement est l'OPEX ponctuel — garantit capex + opexOneOff = investCost
  // (celui affiché par le graphique) même en cas d'arrondi sur la décomposition par levier.
  const opexOneOff = round2(investCost - capex);

  const topLevers = [...rows]
    .filter((r) => r.net !== 0 || r.grossSavings !== 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 5);

  return {
    scope: periodKey === null ? "total" : "period",
    periodKey,
    periodLabel,
    grossSavings,
    opexRec,
    netSavings,
    capex,
    opexOneOff,
    investCost,
    netResult,
    cumulative,
    roiPct: investCost > 0 ? Math.round((netResult / investCost) * 1000) / 10 : null,
    paybackLabel: payback?.label ?? null,
    paybackPeriods: payback?.periods ?? null,
    rows,
    topLevers,
  };
}
