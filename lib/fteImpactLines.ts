import type { LeverImpact } from "@/types";

/** Contribution ETP signée d'UNE ligne d'impact — même règle que `engine.leverImpactTotals`
 *  (`fteNet`) : ligne ETP = +effectif si recrutement, −effectif sinon ; ligne financière (gain ou
 *  coût) = son `fteCount` signé éventuel (ex. « Réduction 1 ETP » saisie comme gain, −1). */
export function impactFteContribution(imp: LeverImpact): number {
  if (imp.type === "fte") {
    const count = imp.fteCount ?? 0;
    return imp.fteDirection === "hire" ? count : -count;
  }
  return imp.fteCount ?? 0;
}

/** Lignes d'impact FINANCIER (gain/coût) qui portent un effet ETP (`fteCount` non nul). Elles sont
 *  saisies dans le tableau « Impact financier », mais comptent dans les tuiles « Impact RH » (Impact
 *  estimé / Réalisé à date) : le tableau RH doit les lister, sinon il affiche « Aucun impact
 *  renseigné » sous des tuiles non nulles. */
export function financialImpactsWithFte(impacts: LeverImpact[]): LeverImpact[] {
  return impacts.filter((imp) => imp.type !== "fte" && !!imp.fteCount);
}
