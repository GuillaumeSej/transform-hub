import type { LeverImpact } from "@/types";
import { fmtCurr } from "@/lib/engine";

/**
 * Montant SIGNÉ d'une ligne d'impact pour l'affichage d'une ligne isolée (file « Réalisés à
 * valider », menu de la cloche) : ce qui s'ajoute à la valeur du levier est positif (gain, départ
 * ETP), ce qui s'en déduit est négatif (tout coût — CAPEX, OPEX ponctuel ou récurrent — et
 * recrutement ETP). Pour les lignes qui entrent dans le net, même signe que
 * `engine.impactNetSigned` (recrutement ETP −, OPEX récurrent −) ; CAPEX / OPEX ponctuel, hors net,
 * restent affichés en déduction comme avant. Avant (lot 2, cohérence A) : un recrutement ETP
 * s'affichait sans « − » alors qu'il est déduit du net.
 */
export function impactSignedAmount(imp: Pick<LeverImpact, "type" | "amount" | "fteDirection">) {
  const amount = Number.isFinite(imp.amount) ? imp.amount : 0;
  if (imp.type === "cost") return -amount;
  if (imp.type === "fte" && imp.fteDirection === "hire") return -amount;
  return amount;
}

/** Libellé du montant signé (« −0,4 M€ » / « 1,2 M€ »), format `fmtCurr` de l'application. */
export function formatImpactSignedAmount(
  imp: Pick<LeverImpact, "type" | "amount" | "fteDirection">
): string {
  const signed = impactSignedAmount(imp);
  return `${signed < 0 ? "−" : ""}${fmtCurr(Math.abs(signed))}`;
}
