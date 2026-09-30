import { isLeverVisibleForClearance } from "@/lib/leversLogic";
import type { Chantier, ChantierStaffing, Indicator, StrategicAxis } from "@/types";

/**
 * Confidentialité HÉRITÉE du Plan Stratégique — point d'entrée UNIQUE du masquage par habilitation
 * pour axes / chantiers / indicateurs / lignes ETP (appliqué une seule fois dans
 * `useStrategicData`, dont TOUS les écrans consomment la sortie : dashboards, roadmap, page KPI,
 * Effectifs/budget, Mon espace, file de validation…).
 *
 * Règle : le niveau EFFECTIF d'un chantier est le plus restrictif entre son propre niveau et celui
 * de ses axes. Concrètement, un chantier est visible seulement si :
 *  - son propre `confidentialityLevel` est accessible, ET
 *  - CHACUN de ses axes connus (`axisIds`) est accessible.
 * Multi-axe : un seul axe confidentiel non accessible suffit à masquer le chantier. C'est la règle
 * la plus sûre, et la seule cohérente avec le modèle où un chantier appartient PLEINEMENT à chacun
 * de ses axes (`axisIds[0]` n'est « primaire » qu'en interne, voir `Chantier.axisIds`) : afficher
 * le chantier révélerait son rattachement à l'axe masqué. Un `axisId` inconnu (axe supprimé / hors
 * programme) est ignoré — il ne porte aucun niveau.
 *
 * Descendance : projets (`ChantierAction`) et lignes ETP suivent leur chantier ; un indicateur
 * chantier-scopé suit son chantier (en plus de son propre niveau), un indicateur macro (sans
 * `chantierId`) suit son axe.
 *
 * `clearance` = résultat de `resolveConfidentialityClearance` ; l'appelant court-circuite ces
 * filtres pour les admins (habilitation complète, comportement inchangé).
 */

type Clearance = "all" | string[];

/** Ids des axes dont le propre niveau est accessible. */
function accessibleAxisIds(
  axes: Pick<StrategicAxis, "id" | "confidentialityLevel">[],
  clearance: Clearance
): { visible: Set<string>; hidden: Set<string> } {
  const visible = new Set<string>();
  const hidden = new Set<string>();
  for (const a of axes) {
    (isLeverVisibleForClearance(a.confidentialityLevel, clearance) ? visible : hidden).add(a.id);
  }
  return { visible, hidden };
}

/** Un chantier est-il visible, compte tenu de son niveau ET de celui de ses axes ? */
export function isChantierVisibleForClearance(
  chantier: Pick<Chantier, "axisIds" | "confidentialityLevel">,
  axes: Pick<StrategicAxis, "id" | "confidentialityLevel">[],
  clearance: Clearance
): boolean {
  if (!isLeverVisibleForClearance(chantier.confidentialityLevel, clearance)) return false;
  const { hidden } = accessibleAxisIds(axes, clearance);
  return !(chantier.axisIds ?? []).some((id) => hidden.has(id));
}

export type StrategicConfidentialityInput<
  A extends Pick<StrategicAxis, "id" | "confidentialityLevel">,
  C extends Pick<Chantier, "id" | "axisIds" | "confidentialityLevel">,
  I extends Pick<Indicator, "axisId" | "chantierId" | "confidentialityLevel">,
  S extends Pick<ChantierStaffing, "chantierId">,
> = {
  axes: A[];
  chantiers: C[];
  indicators: I[];
  staffing: S[];
};

/**
 * Applique le masquage hérité à tout le périmètre d'un programme. Les listes rendues conservent
 * l'ordre d'entrée. `axes` doit être la liste COMPLÈTE des axes du programme (avant tout autre
 * filtre), pour que l'héritage ne dépende pas d'un autre filtre (ex. ownership).
 */
export function filterStrategicByClearance<
  A extends Pick<StrategicAxis, "id" | "confidentialityLevel">,
  C extends Pick<Chantier, "id" | "axisIds" | "confidentialityLevel">,
  I extends Pick<Indicator, "axisId" | "chantierId" | "confidentialityLevel">,
  S extends Pick<ChantierStaffing, "chantierId">,
>(
  input: StrategicConfidentialityInput<A, C, I, S>,
  clearance: Clearance
): StrategicConfidentialityInput<A, C, I, S> {
  const { hidden: hiddenAxisIds } = accessibleAxisIds(input.axes, clearance);
  const axes = input.axes.filter((a) => !hiddenAxisIds.has(a.id));

  const hiddenChantierIds = new Set<string>();
  const chantiers = input.chantiers.filter((c) => {
    const ok =
      isLeverVisibleForClearance(c.confidentialityLevel, clearance) &&
      !(c.axisIds ?? []).some((id) => hiddenAxisIds.has(id));
    if (!ok) hiddenChantierIds.add(c.id);
    return ok;
  });

  const indicators = input.indicators.filter((i) => {
    if (!isLeverVisibleForClearance(i.confidentialityLevel, clearance)) return false;
    if (i.chantierId) return !hiddenChantierIds.has(i.chantierId);
    return !hiddenAxisIds.has(i.axisId);
  });

  const staffing = input.staffing.filter((s) => !hiddenChantierIds.has(s.chantierId));

  return { axes, chantiers, indicators, staffing };
}
