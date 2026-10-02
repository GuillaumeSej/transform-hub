import { AXIS_FALLBACK_COLOR } from "@/lib/axisLogic";
import type { StrategicApproval } from "@/lib/strategicApprovals";
import type {
  ActionPrerequisite,
  Chantier,
  ChantierAction,
  ChantierDependency,
  ChantierStaffing,
  Indicator,
  IndicatorMeasurement,
  StrategicAxis,
} from "@/types";

/**
 * Intégrité référentielle du Plan Stratégique (lot 3) — logique PURE, sans Firestore.
 *
 *  1. CASCADE de suppression (`planDeletionCascade`) : supprimer un chantier, un projet ou un
 *     indicateur laissait des orphelins comptés partout (lignes ETP → taux IT 125 % au lieu de
 *     90 % + fausse alerte de sur-staffing ; indicateur d'un chantier supprimé → « 7 indicateurs
 *     dont 3 à risque » + cloche). Le plan calculé ici est écrit en UN SEUL `writeBatch` par
 *     `lib/firestore/strategicCascade.ts` (tout ou rien) :
 *       - chantier → ses projets, ses lignes ETP (niveau chantier ET projet), ses indicateurs et
 *         leurs mesures ;
 *       - projet   → ses lignes ETP ;
 *       - indicateur → ses mesures ;
 *       - dans tous les cas : les dépendances de chantier et les prérequis de projet qui CITENT un
 *         élément supprimé sont retirés, et les demandes de validation EN ATTENTE qui le visent
 *         passent au statut « annulée » (motif « Cible supprimée »).
 *     Axe : suppression BLOQUÉE tant qu'un chantier ou un indicateur y est rattaché
 *     (`axisDeletionBlockers`) — voir le doc-comment de cette fonction.
 *  2. FILTRE DÉFENSIF (`dropOrphanStaffing` / `dropOrphanIndicators`) : les données orphelines
 *     DÉJÀ en base (avant ce lot) sont ignorées par les calculs, en cohérence avec
 *     `chantierPlannedFte` (lib/staffingNeed.ts) qui excluait déjà les lignes d'un projet inconnu.
 *     Le nettoyage en base est fait par `scripts/clean-strategic-orphans.js`.
 *  3. GROUPE « SANS AXE » (`withUnassignedAxisGroup`) : un chantier dont aucun axe n'existe plus
 *     était compté dans la puce « N chantiers » mais absent de la feuille de route.
 */

// ─── Filtre défensif des orphelins ──────────────────────────────────────────────────────────

/** Lignes ETP dont le chantier existe ET, si rattachées à un projet, dont le projet existe. */
export function dropOrphanStaffing<S extends Pick<ChantierStaffing, "chantierId" | "actionId">>(
  staffing: S[],
  chantiers: Pick<Chantier, "id">[],
  actions: Pick<ChantierAction, "id">[]
): S[] {
  const chantierIds = new Set(chantiers.map((c) => c.id));
  const actionIds = new Set(actions.map((a) => a.id));
  return staffing.filter(
    (s) => chantierIds.has(s.chantierId) && (!s.actionId || actionIds.has(s.actionId))
  );
}

/** Indicateurs dont le chantier (s'ils en ont un) existe. Un indicateur macro (porté par l'axe,
 *  sans `chantierId`) est conservé. */
export function dropOrphanIndicators<I extends Pick<Indicator, "chantierId">>(
  indicators: I[],
  chantiers: Pick<Chantier, "id">[]
): I[] {
  const chantierIds = new Set(chantiers.map((c) => c.id));
  return indicators.filter((i) => !i.chantierId || chantierIds.has(i.chantierId));
}

// ─── Groupe « Sans axe » ────────────────────────────────────────────────────────────────────

/** Id de l'axe SYNTHÉTIQUE « Sans axe » (affichage uniquement, jamais écrit en base). */
export const UNASSIGNED_AXIS_ID = "__sans_axe__";

export function isUnassignedAxis(axis: Pick<StrategicAxis, "id"> | string): boolean {
  return (typeof axis === "string" ? axis : axis.id) === UNASSIGNED_AXIS_ID;
}

/** Chantiers dont AUCUN des `axisIds` ne correspond à un axe connu du programme. */
export function chantiersWithoutAxis<C extends Pick<Chantier, "axisIds">>(
  chantiers: C[],
  knownAxisIds: Iterable<string>
): C[] {
  const known = new Set(knownAxisIds);
  return chantiers.filter((c) => !(c.axisIds ?? []).some((id) => known.has(id)));
}

/**
 * Ajoute un groupe « Sans axe » (axe synthétique `UNASSIGNED_AXIS_ID`, en DERNIER) quand des
 * chantiers ne sont rattachés à aucun axe existant (axe supprimé avant le blocage de ce lot, ou
 * donnée importée incomplète), et y rattache ces chantiers POUR L'AFFICHAGE uniquement.
 *
 * `knownAxisIds` = TOUS les axes du programme avant filtrage de visibilité
 * (`useStrategicData().programAxisIds`) : un chantier dont l'axe est seulement MASQUÉ au lecteur
 * (confidentialité, filtre de la feuille de route) n'est jamais classé « Sans axe ». Sans
 * chantier orphelin, les entrées sont renvoyées telles quelles (mêmes références).
 */
export function withUnassignedAxisGroup<C extends Chantier>(
  axes: StrategicAxis[],
  chantiers: C[],
  knownAxisIds: Iterable<string>,
  label: string
): { axes: StrategicAxis[]; chantiers: C[] } {
  const orphans = new Set(chantiersWithoutAxis(chantiers, knownAxisIds).map((c) => c.id));
  if (orphans.size === 0) return { axes, chantiers };
  const reference = axes[0] ?? chantiers[0];
  const unassigned: StrategicAxis = {
    id: UNASSIGNED_AXIS_ID,
    companyId: reference?.companyId ?? "",
    programId: reference?.programId ?? "",
    name: label,
    color: AXIS_FALLBACK_COLOR,
    stage: "",
    createdAt: "",
    lastUpdate: "",
  };
  return {
    axes: [...axes, unassigned],
    chantiers: chantiers.map((c) =>
      orphans.has(c.id) ? { ...c, axisIds: [UNASSIGNED_AXIS_ID] } : c
    ),
  };
}

// ─── Suppression d'un axe : bloquée tant qu'il porte des données ────────────────────────────

export type AxisDeletionBlockers = { chantierIds: string[]; indicatorIds: string[] };

/**
 * Ce qui EMPÊCHE de supprimer un axe : les chantiers qui le citent dans `axisIds` et les
 * indicateurs qui le portent (`axisId`). Choix « bloquer » plutôt que « détacher » : détacher en
 * silence ferait basculer des chantiers (et leur budget) dans « Sans axe » ou réattribuerait leur
 * budget à un autre de leurs axes, et laisserait des indicateurs pointer vers un axe inexistant —
 * une décision métier qui doit être prise explicitement (rattacher les chantiers à un autre axe ou
 * les supprimer), pas un effet de bord d'une suppression. Aucune donnée n'est perdue.
 */
export function axisDeletionBlockers(
  axisId: string,
  chantiers: Pick<Chantier, "id" | "axisIds">[],
  indicators: Pick<Indicator, "id" | "axisId">[]
): AxisDeletionBlockers {
  return {
    chantierIds: chantiers.filter((c) => (c.axisIds ?? []).includes(axisId)).map((c) => c.id),
    indicatorIds: indicators.filter((i) => i.axisId === axisId).map((i) => i.id),
  };
}

export class AxisNotEmptyError extends Error {
  constructor(
    public readonly axisName: string,
    public readonly blockers: AxisDeletionBlockers
  ) {
    super(
      `Impossible de supprimer l'axe « ${axisName} » : ${blockers.chantierIds.length} chantier(s) et ${blockers.indicatorIds.length} indicateur(s) y sont rattachés. Rattachez-les à un autre axe ou supprimez-les d'abord.`
    );
    this.name = "AxisNotEmptyError";
  }
}

// ─── Cascade de suppression ─────────────────────────────────────────────────────────────────

/** Données lues en base (entreprise) nécessaires au calcul de la cascade. Toutes optionnelles :
 *  une collection absente est traitée comme vide. */
export type CascadeSnapshot = {
  axes?: Pick<StrategicAxis, "id" | "name">[];
  chantiers?: Pick<Chantier, "id" | "axisIds" | "dependencies">[];
  chantierActions?: Pick<ChantierAction, "id" | "chantierId" | "prerequisites">[];
  staffing?: Pick<ChantierStaffing, "id" | "chantierId" | "actionId">[];
  indicators?: Pick<Indicator, "id" | "axisId" | "chantierId">[];
  measurements?: Pick<IndicatorMeasurement, "id" | "indicatorId">[];
  approvals?: StrategicApproval[];
};

/** Racines de la suppression (ce que l'utilisateur supprime explicitement). */
export type CascadeRoots = {
  axisIds?: string[];
  chantierIds?: string[];
  actionIds?: string[];
  indicatorIds?: string[];
};

/** Motif posé sur une demande annulée par la suppression de sa cible. */
export const TARGET_DELETED_REASON = "Cible supprimée";

export type CancelledApprovalPatch = Pick<
  StrategicApproval,
  "status" | "decidedBy" | "decidedByName" | "decidedAt" | "decisionComment"
>;

export type CascadePlan = {
  deleteAxisIds: string[];
  deleteChantierIds: string[];
  deleteActionIds: string[];
  deleteStaffingIds: string[];
  deleteIndicatorIds: string[];
  deleteMeasurementIds: string[];
  /** Chantiers SURVIVANTS dont une dépendance citait un chantier supprimé. */
  chantierDependencyUpdates: { id: string; dependencies: ChantierDependency[] }[];
  /** Projets SURVIVANTS dont un prérequis citait un projet supprimé. */
  actionPrerequisiteUpdates: { id: string; prerequisites: ActionPrerequisite[] }[];
  /** Demandes EN ATTENTE visant un élément supprimé → annulées. */
  cancelledApprovals: { id: string; patch: CancelledApprovalPatch }[];
};

export function emptyCascadePlan(): CascadePlan {
  return {
    deleteAxisIds: [],
    deleteChantierIds: [],
    deleteActionIds: [],
    deleteStaffingIds: [],
    deleteIndicatorIds: [],
    deleteMeasurementIds: [],
    chantierDependencyUpdates: [],
    actionPrerequisiteUpdates: [],
    cancelledApprovals: [],
  };
}

/** Nombre d'écritures Firestore du plan (contrôle de la limite d'un `writeBatch`). */
export function cascadeWriteCount(plan: CascadePlan): number {
  return (
    plan.deleteAxisIds.length +
    plan.deleteChantierIds.length +
    plan.deleteActionIds.length +
    plan.deleteStaffingIds.length +
    plan.deleteIndicatorIds.length +
    plan.deleteMeasurementIds.length +
    plan.chantierDependencyUpdates.length +
    plan.actionPrerequisiteUpdates.length +
    plan.cancelledApprovals.length
  );
}

/** Une demande en attente vise-t-elle un élément supprimé ? Cible directe (axe, chantier, projet,
 *  indicateur) ou ligne ETP d'un chantier/projet supprimé (`staffing_update`), ou création d'un
 *  projet dans un chantier supprimé (`projet_create`). */
function approvalTargetsDeleted(
  approval: StrategicApproval,
  sets: { axes: Set<string>; chantiers: Set<string>; actions: Set<string>; indicators: Set<string> }
): boolean {
  const byType: Record<StrategicApproval["targetType"], Set<string>> = {
    axe: sets.axes,
    chantier: sets.chantiers,
    projet: sets.actions,
    indicateur: sets.indicators,
  };
  if (byType[approval.targetType]?.has(approval.targetId)) return true;
  const payload = approval.payload as Record<string, unknown> | undefined;
  if (approval.kind === "staffing_update") {
    const line = payload?.line as Partial<ChantierStaffing> | undefined;
    if (line?.chantierId && sets.chantiers.has(line.chantierId)) return true;
    if (line?.actionId && sets.actions.has(line.actionId)) return true;
  }
  if (approval.kind === "projet_create") {
    const action = payload?.action as Partial<ChantierAction> | undefined;
    if (action?.chantierId && sets.chantiers.has(action.chantierId)) return true;
  }
  return false;
}

/**
 * Plan COMPLET de la suppression de `roots` sur `snapshot` (voir l'en-tête du fichier). Lève
 * `AxisNotEmptyError` si un axe à supprimer porte encore des chantiers/indicateurs qui ne sont pas
 * eux-mêmes supprimés par la même opération.
 *
 * `ctx.excludeApprovalIds` : demandes à NE PAS annuler (typiquement la demande de suppression en
 * cours d'approbation, encore « en attente » au moment où ses effets sont écrits).
 */
export function planDeletionCascade(
  roots: CascadeRoots,
  snapshot: CascadeSnapshot,
  ctx: { actor: { username: string; name?: string }; now: string; excludeApprovalIds?: string[] }
): CascadePlan {
  const plan = emptyCascadePlan();
  const chantiers = snapshot.chantiers ?? [];
  const actions = snapshot.chantierActions ?? [];
  const staffing = snapshot.staffing ?? [];
  const indicators = snapshot.indicators ?? [];
  const measurements = snapshot.measurements ?? [];

  const chantierIds = new Set(roots.chantierIds ?? []);
  const actionIds = new Set(roots.actionIds ?? []);
  for (const a of actions) if (chantierIds.has(a.chantierId)) actionIds.add(a.id);
  const indicatorIds = new Set(roots.indicatorIds ?? []);
  for (const i of indicators)
    if (i.chantierId && chantierIds.has(i.chantierId)) indicatorIds.add(i.id);

  const axisIds = new Set(roots.axisIds ?? []);
  for (const axisId of Array.from(axisIds)) {
    const blockers = axisDeletionBlockers(axisId, chantiers, indicators);
    const remaining: AxisDeletionBlockers = {
      chantierIds: blockers.chantierIds.filter((id) => !chantierIds.has(id)),
      indicatorIds: blockers.indicatorIds.filter((id) => !indicatorIds.has(id)),
    };
    if (remaining.chantierIds.length > 0 || remaining.indicatorIds.length > 0) {
      const name = snapshot.axes?.find((a) => a.id === axisId)?.name ?? axisId;
      throw new AxisNotEmptyError(name, remaining);
    }
  }

  plan.deleteAxisIds = Array.from(axisIds);
  plan.deleteChantierIds = Array.from(chantierIds);
  plan.deleteActionIds = Array.from(actionIds);
  plan.deleteIndicatorIds = Array.from(indicatorIds);
  plan.deleteStaffingIds = staffing
    .filter((s) => chantierIds.has(s.chantierId) || (!!s.actionId && actionIds.has(s.actionId)))
    .map((s) => s.id);
  plan.deleteMeasurementIds = measurements
    .filter((m) => indicatorIds.has(m.indicatorId))
    .map((m) => m.id);

  // Dépendances / prérequis qui CITENT un élément supprimé (sur les survivants uniquement).
  for (const c of chantiers) {
    if (chantierIds.has(c.id)) continue;
    const deps = c.dependencies ?? [];
    const kept = deps.filter((d) => !chantierIds.has(d.targetId));
    if (kept.length !== deps.length)
      plan.chantierDependencyUpdates.push({ id: c.id, dependencies: kept });
  }
  for (const a of actions) {
    if (actionIds.has(a.id) || !a.prerequisites?.length) continue;
    const kept = a.prerequisites.filter(
      (p) => !(p.kind === "action" && p.targetActionId && actionIds.has(p.targetActionId))
    );
    if (kept.length !== a.prerequisites.length) {
      plan.actionPrerequisiteUpdates.push({ id: a.id, prerequisites: kept });
    }
  }

  // Demandes en attente qui visent un élément supprimé : annulées (jamais supprimées — l'historique
  // des décisions n'est pas supprimable, voir firestore.rules).
  const excluded = new Set(ctx.excludeApprovalIds ?? []);
  const sets = {
    axes: axisIds,
    chantiers: chantierIds,
    actions: actionIds,
    indicators: indicatorIds,
  };
  for (const approval of snapshot.approvals ?? []) {
    if (approval.status !== "pending" || excluded.has(approval.id)) continue;
    if (!approvalTargetsDeleted(approval, sets)) continue;
    plan.cancelledApprovals.push({
      id: approval.id,
      patch: {
        status: "cancelled",
        decidedBy: ctx.actor.username,
        ...(ctx.actor.name ? { decidedByName: ctx.actor.name } : {}),
        decidedAt: ctx.now,
        decisionComment: TARGET_DELETED_REASON,
      },
    });
  }
  return plan;
}

/** Fusionne deux plans (union sans doublon ; la dernière mise à jour d'un même document gagne). */
export function mergeCascadePlans(a: CascadePlan, b: CascadePlan): CascadePlan {
  const uniq = (x: string[], y: string[]) => Array.from(new Set([...x, ...y]));
  const byId = <T extends { id: string }>(x: T[], y: T[]) =>
    Array.from(new Map([...x, ...y].map((e) => [e.id, e])).values());
  return {
    deleteAxisIds: uniq(a.deleteAxisIds, b.deleteAxisIds),
    deleteChantierIds: uniq(a.deleteChantierIds, b.deleteChantierIds),
    deleteActionIds: uniq(a.deleteActionIds, b.deleteActionIds),
    deleteStaffingIds: uniq(a.deleteStaffingIds, b.deleteStaffingIds),
    deleteIndicatorIds: uniq(a.deleteIndicatorIds, b.deleteIndicatorIds),
    deleteMeasurementIds: uniq(a.deleteMeasurementIds, b.deleteMeasurementIds),
    chantierDependencyUpdates: byId(a.chantierDependencyUpdates, b.chantierDependencyUpdates),
    actionPrerequisiteUpdates: byId(a.actionPrerequisiteUpdates, b.actionPrerequisiteUpdates),
    cancelledApprovals: byId(a.cancelledApprovals, b.cancelledApprovals),
  };
}
