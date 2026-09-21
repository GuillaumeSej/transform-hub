/**
 * Flux UI → validation du Plan Stratégique (logique pure, testable sans rendu).
 *
 * Chaque fonction reçoit une « porte » (`ApprovalGate`, = `useStrategicApprovals()` restreint à
 * `needsApproval` + `request`) : `null` (hors contexte stratégique) ⇒ comportement direct historique.
 * Si l'acteur est l'approbateur (`needsApproval` = false) l'action est appliquée directement ;
 * sinon une demande est créée et RIEN n'est écrit côté données publiées.
 */
import { requestMilestoneApproval as requestMilestoneApprovalLogic } from "@/lib/axisLogic";
import { submitIndicatorValue, type IndicatorValueInput } from "@/lib/kpiHistory";
import type {
  StrategicApproval,
  StrategicApprovalKind,
  StrategicApprovalPayload,
  StrategicApprovalTarget,
} from "@/lib/strategicApprovals";
import type { AuthUser, Chantier, ChantierAction, Indicator } from "@/types";

export type ApprovalGate = {
  needsApproval: (kind: StrategicApprovalKind, target: StrategicApprovalTarget) => boolean;
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

/** Création d'un projet : `projet_create` (validation du responsable de l'axe) ou création directe. */
export async function createProjetFlow(
  gate: ApprovalGate | null | undefined,
  chantier: Pick<Chantier, "id" | "name">,
  action: ChantierAction,
  createDirect: () => Promise<unknown>
): Promise<FlowOutcome> {
  const target: StrategicApprovalTarget = {
    type: "chantier",
    id: chantier.id,
    name: chantier.name,
  };
  if (gate && gate.needsApproval("projet_create", target)) {
    await gate.request("projet_create", target, { action });
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
