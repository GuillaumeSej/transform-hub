import { pnlImpactDetailed, type PnlPeriodFilter } from "@/lib/engine";
import { isCostEngaged, isInvestNature, type CostImpactRow } from "@/lib/financeCosts";
import type { PreviewLever } from "@/lib/chartHoverPreview";
import type { BeTrackData, HierarchyLevelDef, HierarchyNode, Lever } from "@/types";

/**
 * Aperçus au survol des graphiques du module Finance (retour PO « aperçu au survol ») — fonctions
 * PURES qui alimentent les pop-ups flottantes (`FloatingPreview`) : principaux contributeurs d'une
 * part de donut / d'une barre P&L, répartition engagé / à venir. Aucune formule propre : tout
 * repart des helpers existants (`engine.pnlImpactDetailed`, `financeCosts.isCostEngaged`), ce
 * module ne fait qu'agréger. Le tri « top N » réutilise `chartPreview.topContributors`.
 * Tests : lib/__tests__/financePreview.test.ts.
 */

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Agrège des lignes `{ lever, amount }` par levier (montant cumulé, M€) — à trier/couper ensuite
 *  avec `topContributors`. */
export function leverAmounts(
  rows: { lever: Pick<Lever, "id" | "code" | "name">; amount: number }[]
): PreviewLever[] {
  const byLever = new Map<string, PreviewLever>();
  for (const { lever, amount } of rows) {
    if (amount === 0) continue;
    const cur = byLever.get(lever.id);
    byLever.set(lever.id, {
      id: lever.id,
      code: lever.code,
      name: lever.name,
      value: (cur?.value ?? 0) + amount,
    });
  }
  return Array.from(byLever.values()).map((l) => ({ ...l, value: round2(l.value) }));
}

/** Répartition d'un ensemble de lignes de coût en ENGAGÉ / À VENIR (coûts Invest : CAPEX + OPEX
 *  ponctuel, règle datée unique `isCostEngaged`, la même que le donut « engagés vs à venir » et le
 *  KPI du dashboard) et OPEX RÉCURRENT (annuel — ni engagé ni à venir au sens Invest). */
export function costCommitmentSplit(
  rows: (Pick<CostImpactRow, "impact" | "lever"> & { amount?: number })[],
  today: Date = new Date()
): { engaged: number; upcoming: number; recurring: number } {
  let engaged = 0;
  let upcoming = 0;
  let recurring = 0;
  for (const row of rows) {
    const amount = row.amount ?? row.impact.amount;
    if (amount === 0) continue;
    if (!isInvestNature(row.impact.nature)) recurring += amount;
    else if (isCostEngaged(row, today)) engaged += amount;
    else upcoming += amount;
  }
  return { engaged: round2(engaged), upcoming: round2(upcoming), recurring: round2(recurring) };
}

/** Contribution d'un levier à un compte P&L sur la période filtrée (mêmes définitions que la barre
 *  du compte : planifié initial / réactualisé / réalisé, `engine.pnlImpactDetailed`). `value` =
 *  écart réalisé − planifié initial (négatif = en deçà du plan), valeur de tri des « principaux
 *  écarts ». */
export type PnlLeverContribution = PreviewLever & {
  plan: number;
  reforecast: number;
  realized: number;
};

/** Contributions de chaque levier à chaque compte P&L (clé = `accountId` de `PnlDetailedPoint`),
 *  triées par |écart réalisé − plan| décroissant (puis |plan|) — alimente l'aperçu au survol de
 *  « Impact P&L par compte ». Calcul : `engine.pnlImpactDetailed` appliqué levier par levier (même
 *  période, même arborescence, même rattachement), donc la somme des contributions d'un compte
 *  égale sa barre (aux arrondis près). */
export function pnlLeverContributionsByAccount(
  data: BeTrackData,
  periodFilter?: PnlPeriodFilter,
  hierarchyNodes?: HierarchyNode[],
  hierarchyLevels?: HierarchyLevelDef[],
  today: Date = new Date()
): Map<string, PnlLeverContribution[]> {
  const out = new Map<string, PnlLeverContribution[]>();
  for (const lever of data.levers) {
    const points = pnlImpactDetailed(
      { ...data, levers: [lever] },
      periodFilter,
      hierarchyNodes,
      hierarchyLevels,
      today
    );
    for (const p of points) {
      if (p.plan === 0 && p.reforecast === 0 && p.realized === 0) continue;
      const list = out.get(p.accountId) ?? [];
      list.push({
        id: lever.id,
        code: lever.code,
        name: lever.name,
        plan: p.plan,
        reforecast: p.reforecast,
        realized: p.realized,
        value: Math.round((p.realized - p.plan) * 10_000) / 10_000,
      });
      out.set(p.accountId, list);
    }
  }
  out.forEach((list) =>
    list.sort(
      (a, b) =>
        Math.abs(b.value) - Math.abs(a.value) ||
        Math.abs(b.plan) - Math.abs(a.plan) ||
        a.name.localeCompare(b.name)
    )
  );
  return out;
}
