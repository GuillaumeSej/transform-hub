import type { LeverImpact } from "@/types";

export type ImpactStatus = NonNullable<LeverImpact["status"]>;

/** Impact récurrent (gain annualisé, OPEX récurrent, ETP) vs ponctuel (CAPEX, one-off). */
export function isRecurringImpact(imp: LeverImpact): boolean {
  if (imp.type === "fte") return true;
  if (imp.type === "saving") return imp.gainRecurrence !== "oneoff";
  return imp.nature === "opex_rec";
}

/** Date de début propre à l'impact (sans repli sur le levier). */
export function impactStartDateOf(imp: LeverImpact): string | undefined {
  const isGain = imp.type === "saving" || (imp.type === "fte" && imp.fteDirection === "departure");
  return isGain ? imp.gainDate : (imp.capexStartDate ?? imp.capexDeploymentDate);
}

/** Statuts autorisés : ponctuel → planned/done ; récurrent → planned/ongoing. */
export function allowedImpactStatuses(imp: LeverImpact): ImpactStatus[] {
  return isRecurringImpact(imp) ? ["planned", "ongoing"] : ["planned", "done"];
}

/** Statut valide pour la nature de l'impact (done ↔ ongoing selon récurrence). */
export function coerceImpactStatus(imp: LeverImpact, status: ImpactStatus): ImpactStatus {
  if (status === "planned") return status;
  return isRecurringImpact(imp) ? "ongoing" : "done";
}

/**
 * Statut effectif d'un impact. Champ explicite s'il existe (normalisé selon la récurrence) ;
 * sinon dérivé de la date de début : futur ou absente → planned ; passée → done (ponctuel) /
 * ongoing (récurrent). `fallbackDate` sert quand l'impact n'a pas de date propre.
 */
export function impactStatusOf(
  imp: LeverImpact,
  today: Date = new Date(),
  fallbackDate?: string
): ImpactStatus {
  if (imp.status) return coerceImpactStatus(imp, imp.status);
  const start = impactStartDateOf(imp) ?? fallbackDate;
  if (!start) return "planned";
  const d = new Date(start);
  if (Number.isNaN(d.getTime()) || d > today) return "planned";
  return isRecurringImpact(imp) ? "ongoing" : "done";
}
