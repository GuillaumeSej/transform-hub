/**
 * Flux UI → validation du Plan Stratégique (logique pure, testable sans rendu).
 *
 * Chaque fonction reçoit une « porte » (`ApprovalGate`, = `useStrategicApprovals()` restreint à
 * `needsApproval` + `request`) : `null` (hors contexte stratégique) ⇒ comportement direct historique.
 * Si l'acteur est l'approbateur (`needsApproval` = false) l'action est appliquée directement ;
 * sinon une demande est créée et RIEN n'est écrit côté données publiées.
 */
import { requestMilestoneApproval as requestMilestoneApprovalLogic } from "@/lib/axisLogic";
import {
  submitIndicatorValue,
  type IndicatorValueInput,
  type MeasurementEditPatch,
} from "@/lib/kpiHistory";
import type {
  ProjetCreateApprovalPayload,
  ProjetCreateStage,
  StrategicApproval,
  StrategicApprovalKind,
  StrategicApprovalPayload,
  StrategicApprovalTarget,
} from "@/lib/strategicApprovals";
import type {
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierStaffing,
  Indicator,
  IndicatorMeasurement,
} from "@/types";

export type ApprovalGate = {
  /** `stage` : uniquement significatif pour `"projet_create"` (double validation, voir l'en-tête
   *  de `lib/strategicApprovals.ts`) — permet à `createProjetFlow` de tester séparément le palier
   *  "chantier" (pilote) et le palier "axis" (responsable de l'axe). Ignoré pour les autres kinds. */
  needsApproval: (
    kind: StrategicApprovalKind,
    target: StrategicApprovalTarget,
    stage?: ProjetCreateStage
  ) => boolean;
  request: (
    kind: StrategicApprovalKind,
    target: StrategicApprovalTarget,
    payload: StrategicApprovalPayload,
    reason?: string
  ) => Promise<StrategicApproval>;
};

export type FlowOutcome = "applied" | "pending";

/** Demandes en attente d'un `kind` (et éventuellement d'une cible). */
export function pendingApprovals(
  approvals: StrategicApproval[] | undefined,
  kind: StrategicApprovalKind,
  targetId?: string
): StrategicApproval[] {
  return (approvals ?? []).filter(
    (a) =>
      a.status === "pending" &&
      a.kind === kind &&
      (targetId === undefined || a.targetId === targetId)
  );
}

/** « X » affichable de l'approbateur nominal d'une demande. */
export function approverLabel(
  a: Pick<StrategicApproval, "approverUsername" | "approverUsernames">
): string {
  return a.approverUsername ?? a.approverUsernames[0] ?? "";
}

/** Saisie d'une valeur KPI (KPI et KPI marché) : publiée directement, ou soumise à validation. */
export async function submitKpiValueFlow<M>(
  gate: ApprovalGate | null | undefined,
  indicator: Pick<Indicator, "id" | "name">,
  input: IndicatorValueInput,
  addMeasurement: (input: IndicatorValueInput) => Promise<M>
): Promise<FlowOutcome> {
  const target: StrategicApprovalTarget = {
    type: "indicateur",
    id: indicator.id,
    name: indicator.name,
  };
  if (gate && gate.needsApproval("kpi_value", target)) {
    const note = input.note?.trim();
    await gate.request("kpi_value", target, {
      period: input.period,
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(note ? { note } : {}),
    });
    return "pending";
  }
  await submitIndicatorValue(addMeasurement, input);
  return "applied";
}

/**
 * Correction d'une mesure KPI déjà publiée — MÊME porte que la saisie (`"kpi_value"`) : une
 * correction change une valeur publiée exactement comme une saisie, elle ne doit donc pas
 * permettre de contourner la validation. Approbateur (lead/admin) ou hors contexte ⇒ correction
 * directe ; sinon demande `"kpi_value"` portant `measurementId` (le doc est réécrit à
 * l'approbation, voir `applyApprovedPayload`).
 */
export async function editKpiValueFlow(
  gate: ApprovalGate | null | undefined,
  indicator: Pick<Indicator, "id" | "name">,
  measurement: Pick<IndicatorMeasurement, "id" | "period" | "value" | "note">,
  patch: MeasurementEditPatch,
  updateMeasurement: (id: string, patch: MeasurementEditPatch) => Promise<unknown>
): Promise<FlowOutcome> {
  const target: StrategicApprovalTarget = {
    type: "indicateur",
    id: indicator.id,
    name: indicator.name,
  };
  if (gate && gate.needsApproval("kpi_value", target)) {
    const period = patch.period !== undefined ? patch.period.trim() : measurement.period;
    const value = patch.value === undefined ? measurement.value : (patch.value ?? undefined);
    const note = (patch.note === undefined ? measurement.note : (patch.note ?? undefined))?.trim();
    await gate.request("kpi_value", target, {
      period,
      measurementId: measurement.id,
      ...(value !== undefined ? { value } : {}),
      ...(note ? { note } : {}),
    });
    return "pending";
  }
  await updateMeasurement(measurement.id, patch);
  return "applied";
}

/** Suppression d'une mesure KPI publiée — même porte `"kpi_value"` que la saisie/correction. */
export async function deleteKpiValueFlow(
  gate: ApprovalGate | null | undefined,
  indicator: Pick<Indicator, "id" | "name">,
  measurement: Pick<IndicatorMeasurement, "id" | "period" | "value">,
  deleteMeasurement: (id: string) => Promise<unknown>
): Promise<FlowOutcome> {
  const target: StrategicApprovalTarget = {
    type: "indicateur",
    id: indicator.id,
    name: indicator.name,
  };
  if (gate && gate.needsApproval("kpi_value", target)) {
    await gate.request("kpi_value", target, {
      period: measurement.period,
      measurementId: measurement.id,
      remove: true,
      ...(measurement.value !== undefined ? { value: measurement.value } : {}),
    });
    return "pending";
  }
  await deleteMeasurement(measurement.id);
  return "applied";
}

/** Suppression d'un chantier / projet : demande (motif) ou suppression directe. */
export async function deleteFlow(
  gate: ApprovalGate | null | undefined,
  kind: "chantier" | "projet",
  target: { id: string; name: string },
  reason: string,
  deleteDirect: () => Promise<void>
): Promise<FlowOutcome> {
  const approvalKind: StrategicApprovalKind =
    kind === "chantier" ? "chantier_delete" : "projet_delete";
  const t: StrategicApprovalTarget = { type: kind, id: target.id, name: target.name };
  if (gate && gate.needsApproval(approvalKind, t)) {
    await gate.request(approvalKind, t, { name: target.name }, reason.trim() || undefined);
    return "pending";
  }
  await deleteDirect();
  return "applied";
}

/**
 * Création d'un projet : DOUBLE validation séquentielle — pilote du chantier PUIS responsable de
 * l'axe (voir l'en-tête de `lib/strategicApprovals.ts`, section "Double validation de
 * projet_create") — ou création directe si l'acteur satisfait déjà les DEUX paliers (il en est un
 * des deux ET l'autre aussi, ou il est admin/strategic_lead).
 *
 * On ne demande QUE les paliers que l'acteur ne peut pas lui-même trancher :
 *  - s'il ne satisfait ni l'un ni l'autre : demande palier "chantier" (1er palier) — l'approbation
 *    du pilote enchaînera ensuite automatiquement la 2e demande, palier "axis"
 *    (`nextProjetCreateApproval`, appelé par `useStrategicApprovals.decide()`) ;
 *  - s'il EST déjà le pilote (ou qu'aucun palier "chantier" distinct n'existe, cascade vers l'axe
 *    quand le chantier n'a pas de pilote renseigné — voir `resolveApprover`) mais pas responsable
 *    d'axe : demande DIRECTEMENT le palier "axis", sans repasser par un palier "chantier" déjà
 *    implicitement satisfait par son propre geste de création ;
 *  - s'il satisfait les deux (ou admin/strategic_lead) : création immédiate, aucune demande.
 *
 * `staffing` (round 29) : lignes ETP bufferisées dans le formulaire de création
 * (`StaffingDraftTable.tsx`), déjà converties en `ChantierStaffing` avec `actionId` = `action.id`
 * (l'id pré-généré de ce même appel, voir `newProjetId` ci-dessous). Optionnel/par défaut vide :
 * tous les appelants existants (avant round 29) continuent de fonctionner sans rien changer.
 * Chemin direct : ignoré ici, c'est `createDirect` (fourni par l'appelant) qui les écrit — cette
 * fonction n'a pas accès à l'id RÉEL généré côté direct (`data.createChantierAction` génère le
 * sien, indépendant de `action.id`, voir le commentaire de tête de `newProjetId`). Chemin demande :
 * embarqué dans le payload, appliqué par `applyApprovedPayload` (`lib/strategicApprovals.ts`) une
 * fois la demande du palier "axis" approuvée, puisque `action.id` EST alors l'id définitif du
 * projet (le palier "chantier", lui, n'a jamais d'effet de création direct : voir cette fonction).
 */
export async function createProjetFlow(
  gate: ApprovalGate | null | undefined,
  chantier: Pick<Chantier, "id" | "name" | "pilote">,
  action: ChantierAction,
  createDirect: () => Promise<unknown>,
  staffing: ChantierStaffing[] = []
): Promise<FlowOutcome> {
  const target: StrategicApprovalTarget = {
    type: "chantier",
    id: chantier.id,
    name: chantier.name,
  };
  if (!gate) {
    await createDirect();
    return "applied";
  }
  const payloadFor = (stage: ProjetCreateStage): ProjetCreateApprovalPayload => ({
    action,
    stage,
    ...(staffing.length ? { staffing } : {}),
  });
  // Pas de pilote renseigné : `resolveApprover` fait déjà cascader le palier "chantier" vers
  // l'axe (mêmes usernames) — démarrer directement au palier terminal "axis" évite de créer un
  // premier palier qui résoudrait identique au second (comportement historique à un seul palier,
  // inchangé quand le chantier n'a pas de pilote).
  const firstStage: ProjetCreateStage = chantier.pilote ? "chantier" : "axis";
  if (gate.needsApproval("projet_create", target, firstStage)) {
    await gate.request("projet_create", target, payloadFor(firstStage));
    return "pending";
  }
  if (firstStage === "chantier" && gate.needsApproval("projet_create", target, "axis")) {
    await gate.request("projet_create", target, payloadFor("axis"));
    return "pending";
  }
  await createDirect();
  return "applied";
}

/** Génère l'identifiant d'un projet (même format que `useStrategicData`). */
export function newProjetId(): string {
  return `CA-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Passage de jalon : valide les prérequis (lève sinon, via la logique existante) puis crée une
 * demande `milestone` si l'acteur n'est pas l'approbateur. "applied" = l'appelant garde son flux
 * historique (soumission + approbation directe).
 */
export async function milestoneFlow(
  gate: ApprovalGate | null | undefined,
  action: ChantierAction,
  user: Pick<AuthUser, "username" | "isGlobalAdmin" | "isCompanyAdmin">,
  chantiers: Chantier[],
  actions: ChantierAction[]
): Promise<FlowOutcome> {
  if (!gate) return "applied";
  const { targetMilestone } = requestMilestoneApprovalLogic(action, user, chantiers, actions);
  const target: StrategicApprovalTarget = { type: "projet", id: action.id, name: action.name };
  if (!gate.needsApproval("milestone", target)) return "applied";
  await gate.request("milestone", target, {
    targetMilestone,
    fromMilestone: action.milestones?.currentMilestone ?? "E0",
  });
  return "pending";
}
