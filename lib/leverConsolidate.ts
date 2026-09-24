import type { Lever } from "@/types";
import { leverImpactTotals, leverImpactsOf, realizedGrossSavings } from "@/lib/engine";

// ─── Consolidation des KPIs d'un levier depuis ses actions ──────────────────

/** Vérifie si le levier a des impacts définis (niveau levier, ou anciens impacts d'actions non
 *  encore migrés). Nom conservé pour compat des appelants. */
export function hasActionImpacts(lever: Lever): boolean {
  return leverImpactsOf(lever).length > 0;
}

/** Consolide les KPIs financiers d'un levier depuis ses impacts (`Lever.impacts`, repli sur
 *  l'ancien `action.impacts`). Retourne undefined si le levier n'a aucun impact (= saisie manuelle
 *  des macro-valeurs conservée).
 *
 *  `netSavings = gains récurrents annuels − OPEX récurrent` (règle métier : le CAPEX et l'OPEX
 *  one-off ne réduisent JAMAIS le "net" annualisé, ils sont suivis séparément). Les gains one-off sont EXCLUS de grossSavings/netSavings
 *  (voir `engine.leverImpactTotals`). Le salaire des départs ETP compte en gain, celui des
 *  recrutements en OPEX récurrent. */
export function consolidateLeverFromActions(lever: Lever): Partial<Lever> | undefined {
  if (!hasActionImpacts(lever)) return undefined;
  const t = leverImpactTotals(lever);
  return {
    grossSavings: t.grossAnnual,
    netSavings: t.netAnnual,
    capex: t.capex,
    opexOneOff: t.opexOneOff,
    opexRec: t.opexRec,
    fteImpact: t.fteNet,
  };
}

/** Alias explicite du nom courant (les impacts vivent sur le levier). */
export const consolidateLeverFromImpacts = consolidateLeverFromActions;

// (L'ancienne courbe en J par levier — `leverJCurve`/`leverPayback` — n'avait plus aucun
// consommateur : la trajectoire d'un levier est désormais `engine.impactTrajectory`, et le
// « Réalisé à date » de la fiche levier vient de `engine.realizedSavings`. Code retiré.)

/** Gains BRUTS (avant déduction des coûts) déjà réalisés à date, pour un levier piloté par
 *  actions — somme des impacts de type "saving" des seules actions au statut "done" (même
 *  périmètre que le "Réalisé à date" net `engine.realizedSavings`, qui lui soustrait aussi l'OPEX
 *  récurrent réalisé). Sert à afficher, sous le "Réalisé à date" (net), le détail "dont X€ de
 *  gains bruts" — utile pour comprendre l'écart quand des coûts ont déjà été engagés sur des
 *  actions livrées. */
export function leverGrossRealizedToDate(lever: Lever): number {
  return Math.round(realizedGrossSavings(lever) * 100) / 100;
}
