import {
  computeIndicatorDelta,
  indicatorReadingState,
  latestNumericMeasurement,
  type IndicatorReadingState,
} from "@/lib/axisLogic";
import type { ChantierAction, Indicator, IndicatorMeasurement } from "@/types";

/** KPI rattaché aux projets/leviers d'un chantier, dédupliqué, avec la liste des projets porteurs. */
export type LinkedKpi = { indicator: Indicator; projetNames: string[] };

/** Agrège les KPI (`ChantierAction.indicatorId`) des projets d'un chantier, sans doublon. Les ids
 *  de `excludeIds` (ex. déjà affichés comme critères de succès) sont écartés. */
export function aggregateLinkedKpis(
  actions: Pick<ChantierAction, "name" | "indicatorId">[],
  indicators: Indicator[],
  excludeIds: ReadonlySet<string> = new Set()
): LinkedKpi[] {
  const byId = new Map(indicators.map((i) => [i.id, i]));
  const out = new Map<string, LinkedKpi>();
  for (const a of actions) {
    if (!a.indicatorId || excludeIds.has(a.indicatorId)) continue;
    const indicator = byId.get(a.indicatorId);
    if (!indicator) continue;
    const entry = out.get(indicator.id) ?? { indicator, projetNames: [] };
    if (!entry.projetNames.includes(a.name)) entry.projetNames.push(a.name);
    out.set(indicator.id, entry);
  }
  return Array.from(out.values());
}

export type KpiReading = {
  current?: number;
  target?: number;
  /** Avancement (arrondi) vers la cible finale, depuis la baseline — voir `computeIndicatorDelta`.
   *  Plancher 0, sans plafond (un dépassement s'affiche > 100). */
  progressPct?: number;
  /** `true` si `progressPct` est un repli approximatif (pas de baseline exploitable). */
  approximate?: boolean;
  /** Statut de la lecture vs la cible LUE ICI (`targetOverride` si fourni, sinon statut calculé
   *  de l'indicateur) — le point de couleur doit dire la même chose que la ligne affichée.
   *  `"no_data"` : rien à comparer. */
  status: IndicatorReadingState;
};

/** Valeur actuelle / cible / % d'avancement d'un KPI. `targetOverride` = cible propre au critère de
 *  succès du chantier (sinon `objectiveValue` de l'indicateur). */
export function readKpi(
  indicator: Indicator,
  measurements: IndicatorMeasurement[],
  targetOverride?: number
): KpiReading {
  // Dernière valeur CHIFFRÉE (un commentaire seul ne masque pas la valeur).
  const latest = latestNumericMeasurement(indicator.id, measurements);
  const target = targetOverride ?? indicator.objectiveValue;
  const current = latest?.value;
  const status: IndicatorReadingState =
    targetOverride !== undefined
      ? current === undefined || indicator.kind === "qualitative"
        ? "no_data"
        : (indicator.direction === "down" ? current <= targetOverride : current >= targetOverride)
          ? "on_track"
          : "at_risk"
      : indicatorReadingState(indicator, measurements);
  if (target === undefined || current === undefined) return { current, target, status };
  const delta = computeIndicatorDelta(
    { objectiveValue: target, direction: indicator.direction },
    latest,
    measurements
  );
  return {
    current,
    target,
    progressPct: delta ? Math.round(delta.progressToFinalPct) : undefined,
    approximate: delta?.approximate,
    status,
  };
}

export type DeleteApprovalInfo = {
  approvers: string[];
  /** L'utilisateur peut supprimer directement (admin, approbateur, ou aucun approbateur défini). */
  canApproveSelf: boolean;
};

export function resolveDeleteApproval(
  approvers: (string | undefined)[],
  username: string | undefined,
  isAdmin: boolean
): DeleteApprovalInfo {
  const list = Array.from(new Set(approvers.filter((a): a is string => !!a)));
  return {
    approvers: list,
    canApproveSelf: isAdmin || list.length === 0 || (!!username && list.includes(username)),
  };
}
