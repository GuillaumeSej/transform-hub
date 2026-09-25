/**
 * Flux UI → validation du Plan Stratégique (logique pure, testable sans rendu).
 *
 * Chaque fonction reçoit une « porte » (`ApprovalGate`, = `useStrategicApprovals()` restreint à
 * `needsApproval` + `request`) : `null` (hors contexte stratégique) ⇒ comportement direct historique.
 * Si la chaîne de validation de l'acteur est vide (`needsApproval` = false : admin, pilote du plan,
 * modification libre) l'action est appliquée directement ; sinon UNE demande à paliers (N+1 puis
 * N+2, voir lib/strategicApprovals.ts) est créée et RIEN n'est écrit côté données publiées.
 *
 * Quel flux pour quelle action UI :
 *   saisie KPI                    → submitKpiValueFlow        (2 validations)
 *   correction/suppression KPI    → editKpiValueFlow / deleteKpiValueFlow (+ sa.kpiCorrectionRoute)
 *   demande de passage de jalon   → milestoneFlow             (2 validations)
 *   édition de champs d'un projet → updateProjetFlow          (libre / 1 / 2 selon les champs)
 *   édition de champs d'un chantier → updateChantierFlow      (idem)
 *   désignation resp./contributeurs → updateProjetFlow({ owner } / { contributors })  (1 validation)
 *   création de projet            → createProjetFlow          (2 validations)
 *   suppression projet / chantier → deleteFlow                (2 validations)
 *   création de chantier          → createChantierFlow        (2 validations)
 */
import { requestMilestoneApproval as requestMilestoneApprovalLogic } from "@/lib/axisLogic";
import {
  findPeriodCollision,
  MeasurementPeriodCollisionError,
  submitIndicatorValue,
  type IndicatorValueInput,
  type MeasurementEditPatch,
} from "@/lib/kpiHistory";
import type { KpiCorrectionRoute } from "@/lib/kpiCorrectionRouting";
import {
  pendingApproversOf,
  splitPatchByCategory,
  type ChantierCreateApprovalPayload,
  type GatedCategory,
  type KpiValueApprovalPayload,
  type PatchEntity,
  type ProjetCreateApprovalPayload,
  type ProjetCreateStage,
  type StrategicApproval,
  type StrategicApprovalKind,
  type StrategicApprovalPayload,
  type StrategicApprovalTarget,
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
  /** `stage` : LEGACY, ignoré. `payload` : requis pour "projet_update"/"chantier_update"
   *  (catégorie) et "chantier_create" (axes) — voir `needsApproval` (lib/strategicApprovals.ts). */
  needsApproval: (
    kind: StrategicApprovalKind,
    target: StrategicApprovalTarget,
    stage?: ProjetCreateStage,
    payload?: StrategicApprovalPayload
  ) => boolean;
  request: (
    kind: StrategicApprovalKind,
    target: StrategicApprovalTarget,
    payload: StrategicApprovalPayload,
    reason?: string
  ) => Promise<StrategicApproval>;
  /** Information des responsables supérieurs après une correction KPI appliquée directement
   *  (voir `lib/kpiCorrectionRouting.ts`). Optionnel : absent ⇒ personne n'est informé. */
  notifyKpiCorrection?: (
    target: StrategicApprovalTarget,
    payload: KpiValueApprovalPayload,
    informUsernames: string[]
  ) => Promise<unknown>;
};

/** Informe sans faire échouer la correction déjà appliquée (la notification est secondaire). */
async function informSafely(
  gate: ApprovalGate | null | undefined,
  target: StrategicApprovalTarget,
  payload: KpiValueApprovalPayload,
  inform: string[]
): Promise<void> {
  if (!gate?.notifyKpiCorrection || inform.length === 0) return;
  try {
    await gate.notifyKpiCorrection(target, payload, inform);
  } catch (err) {
    console.error("[betrack] notification de correction KPI :", err);
  }
}

function previousOf(
  measurement: Pick<IndicatorMeasurement, "period" | "value" | "note">
): Pick<KpiValueApprovalPayload, "previousPeriod" | "previousValue" | "previousNote"> {
  const note = measurement.note?.trim();
  return {
    previousPeriod: measurement.period,
    ...(measurement.value !== undefined ? { previousValue: measurement.value } : {}),
    ...(note ? { previousNote: note } : {}),
  };
}

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

/** « X » affichable de l'approbateur ATTENDU (palier courant pour une demande à chaîne). */
export function approverLabel(
  a: Pick<StrategicApproval, "approverUsername" | "approverUsernames"> &
    Partial<Pick<StrategicApproval, "chain" | "stepIndex" | "status">>
): string {
  if (a.chain?.length) {
    return pendingApproversOf({ status: "pending", ...a } as StrategicApproval).join(", ");
  }
  return a.approverUsername ?? a.approverUsernames[0] ?? "";
}

/** Saisie d'une valeur KPI (KPI et KPI marché) : publiée directement, ou soumise à validation.
 *  `existing` (mesures connues de l'indicateur) : une période DÉJÀ renseignée lève
 *  `MeasurementPeriodCollisionError` AVANT toute écriture/demande — l'appelant propose alors de
 *  remplacer la mesure existante (correction routée, `editKpiValueFlow`) ou refuse. */
export async function submitKpiValueFlow<M>(
  gate: ApprovalGate | null | undefined,
  indicator: Pick<Indicator, "id" | "name">,
  input: IndicatorValueInput,
  addMeasurement: (input: IndicatorValueInput) => Promise<M>,
  existing?: Pick<IndicatorMeasurement, "id" | "indicatorId" | "period">[]
): Promise<FlowOutcome> {
  if (existing && findPeriodCollision(existing, indicator.id, input.period)) {
    throw new MeasurementPeriodCollisionError(input.period.trim());
  }
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
 * Correction d'une mesure KPI déjà publiée. Avec `route` (règles PO, `routeKpiCorrection` de
 * `lib/kpiCorrectionRouting.ts`) : `"direct"` ⇒ correction appliquée puis responsables supérieurs
 * informés (`gate.notifyKpiCorrection`) ; `"request"` ⇒ demande `"kpi_value"` portant
 * `measurementId`, adressée au responsable du chantier (le doc est réécrit à l'approbation, voir
 * `applyApprovedPayload`) ; `"forbidden"` ⇒ lève. Sans `route` (compatibilité) : même porte
 * `"kpi_value"` que la saisie.
 */
export async function editKpiValueFlow(
  gate: ApprovalGate | null | undefined,
  indicator: Pick<Indicator, "id" | "name">,
  measurement: Pick<IndicatorMeasurement, "id" | "period" | "value" | "note">,
  patch: MeasurementEditPatch,
  updateMeasurement: (id: string, patch: MeasurementEditPatch) => Promise<unknown>,
  route?: KpiCorrectionRoute
): Promise<FlowOutcome> {
  const target: StrategicApprovalTarget = {
    type: "indicateur",
    id: indicator.id,
    name: indicator.name,
  };
  const period = patch.period !== undefined ? patch.period.trim() : measurement.period;
  const value = patch.value === undefined ? measurement.value : (patch.value ?? undefined);
  const note = (patch.note === undefined ? measurement.note : (patch.note ?? undefined))?.trim();
  const payload: KpiValueApprovalPayload = {
    period,
    measurementId: measurement.id,
    ...(value !== undefined ? { value } : {}),
    ...(note ? { note } : {}),
  };
  if (gate && route) {
    if (route.mode === "forbidden") {
      throw new Error("Vous n'êtes pas habilité à corriger cette mesure");
    }
    if (route.mode === "request") {
      await gate.request("kpi_value", target, { ...payload, ...previousOf(measurement) });
      return "pending";
    }
    await updateMeasurement(measurement.id, patch);
    await informSafely(gate, target, { ...payload, ...previousOf(measurement) }, route.inform);
    return "applied";
  }
  if (gate && gate.needsApproval("kpi_value", target)) {
    await gate.request("kpi_value", target, payload);
    return "pending";
  }
  await updateMeasurement(measurement.id, patch);
  return "applied";
}

/** Suppression d'une mesure KPI publiée — même routage que la correction (`route`, voir
 *  `editKpiValueFlow`) ; sans `route`, même porte `"kpi_value"` que la saisie. */
export async function deleteKpiValueFlow(
  gate: ApprovalGate | null | undefined,
  indicator: Pick<Indicator, "id" | "name">,
  measurement: Pick<IndicatorMeasurement, "id" | "period" | "value" | "note">,
  deleteMeasurement: (id: string) => Promise<unknown>,
  route?: KpiCorrectionRoute
): Promise<FlowOutcome> {
  const target: StrategicApprovalTarget = {
    type: "indicateur",
    id: indicator.id,
    name: indicator.name,
  };
  if (gate && route) {
    if (route.mode === "forbidden") {
      throw new Error("Vous n'êtes pas habilité à supprimer cette mesure");
    }
    const payload: KpiValueApprovalPayload = {
      period: measurement.period,
      measurementId: measurement.id,
      remove: true,
      ...(measurement.value !== undefined ? { value: measurement.value } : {}),
      ...previousOf(measurement),
    };
    if (route.mode === "request") {
      await gate.request("kpi_value", target, payload);
      return "pending";
    }
    await deleteMeasurement(measurement.id);
    await informSafely(gate, target, payload, route.inform);
    return "applied";
  }
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
 * Création d'un projet : UNE demande `"projet_create"` à deux paliers (sponsor de chantier PUIS
 * sponsor d'axe, l'auteur étant traité au moins comme responsable projet — voir
 * lib/strategicApprovals.ts), ou création directe si la chaîne est vide (admin, pilote du plan,
 * personne au-dessus). L'ancienne double demande enchaînée (`payload.stage`) n'est plus produite ;
 * les demandes legacy déjà en base restent traitées par `useStrategicApprovals`.
 *
 * `staffing` (round 29) : lignes ETP bufferisées dans le formulaire de création, `actionId` =
 * `action.id`. Chemin direct : ignoré ici (c'est `createDirect` qui les écrit). Chemin demande :
 * embarqué dans le payload, appliqué par `applyApprovedPayload` à la validation finale.
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
  const payload: ProjetCreateApprovalPayload = {
    action,
    ...(staffing.length ? { staffing } : {}),
  };
  if (gate.needsApproval("projet_create", target, undefined, payload)) {
    await gate.request("projet_create", target, payload);
    return "pending";
  }
  await createDirect();
  return "applied";
}

/**
 * Création d'un chantier : demande `"chantier_create"` (sponsor d'axe puis pilote du plan), ou
 * création directe si la chaîne est vide (admin, pilote). `chantier` : complet, id déjà généré
 * (voir `newChantierId`), `axisIds` non vide ; cible = son axe principal (`axisIds[0]`).
 */
export async function createChantierFlow(
  gate: ApprovalGate | null | undefined,
  chantier: Chantier,
  createDirect: () => Promise<unknown>,
  reason?: string
): Promise<FlowOutcome> {
  if (!gate) {
    await createDirect();
    return "applied";
  }
  const target: StrategicApprovalTarget = {
    type: "axe",
    id: chantier.axisIds[0],
    name: chantier.name,
  };
  const payload: ChantierCreateApprovalPayload = { chantier };
  if (gate.needsApproval("chantier_create", target, undefined, payload)) {
    await gate.request("chantier_create", target, payload, reason?.trim() || undefined);
    return "pending";
  }
  await createDirect();
  return "applied";
}

/** Génère l'identifiant d'un chantier (création soumise à validation : id stable). */
export function newChantierId(): string {
  return `CH-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export type UpdateFlowResult<T> = {
  /** "applied" : tout appliqué ; "pending" : tout soumis ; "partial" : une partie appliquée
   *  (ex. libellé) et le reste soumis ; "noop" : rien de modifié. */
  outcome: FlowOutcome | "partial" | "noop";
  /** Champs appliqués directement (passés à `applyDirect`). */
  applied: Partial<T>;
  /** Demandes créées (une par catégorie soumise : pilotage / planning / désignation). */
  requests: StrategicApproval[];
};

const GATED_ORDER: GatedCategory[] = ["pilotage", "planning", "designation"];

async function updateEntityFlow<T extends { id: string; name: string }>(
  entity: PatchEntity,
  gate: ApprovalGate | null | undefined,
  current: T,
  patch: Partial<T>,
  applyDirect: (patch: Partial<T>) => Promise<unknown>,
  reason?: string
): Promise<UpdateFlowResult<T>> {
  if (!gate) {
    if (Object.keys(patch).length === 0) return { outcome: "noop", applied: {}, requests: [] };
    await applyDirect(patch);
    return { outcome: "applied", applied: patch, requests: [] };
  }
  const split = splitPatchByCategory(entity, current, patch);
  const kind: StrategicApprovalKind = entity === "projet" ? "projet_update" : "chantier_update";
  const target: StrategicApprovalTarget = { type: entity, id: current.id, name: current.name };
  const direct: Partial<T> = { ...split.free };
  const toRequest: { category: GatedCategory; payload: StrategicApprovalPayload }[] = [];
  for (const category of GATED_ORDER) {
    const part = split[category];
    const keys = Object.keys(part);
    if (!keys.length) continue;
    const before: Record<string, unknown> = {};
    for (const k of keys) before[k] = (current as Record<string, unknown>)[k];
    // Un champ VIDÉ (`undefined`) serait retiré à l'écriture Firestore (`stripUndefined`) et la
    // demande approuvée ne l'effacerait jamais : on l'encode `null`, relu comme effacement par
    // `applyApprovedPayload` (lib/strategicApprovals.ts).
    const encoded: Record<string, unknown> = {};
    for (const k of keys) {
      const v = (part as Record<string, unknown>)[k];
      encoded[k] = v === undefined ? null : v;
    }
    const payload = { patch: encoded, before, category } as unknown as StrategicApprovalPayload;
    if (gate.needsApproval(kind, target, undefined, payload)) toRequest.push({ category, payload });
    else Object.assign(direct, part);
  }
  const directKeys = Object.keys(direct);
  if (!directKeys.length && !toRequest.length) {
    return { outcome: "noop", applied: {}, requests: [] };
  }
  if (directKeys.length) await applyDirect(direct);
  const requests: StrategicApproval[] = [];
  for (const r of toRequest) requests.push(await gate.request(kind, target, r.payload, reason));
  return {
    outcome: requests.length ? (directKeys.length ? "partial" : "pending") : "applied",
    applied: direct,
    requests,
  };
}

/**
 * Modification de champs d'un PROJET selon les règles PO : champs libres (libellé, description,
 * commentaires de livrables) appliqués directement ; dates/livrables/désignations → 1 validation
 * (N+1) ; avancement déclaré (check-lists de jalon), budgets, consommés, poids → 2 validations.
 * Une demande `"projet_update"` par catégorie non vide ; les catégories dont la chaîne est vide
 * pour l'acteur (admin, pilote) sont appliquées directement avec les champs libres.
 * `applyDirect(patch)` : écriture directe (ex. `data.updateChantierAction(id, patch)`).
 * Désignation : vérifier `canDesignate` (lib/strategicHierarchy.ts) AVANT d'appeler ce flux.
 */
export function updateProjetFlow(
  gate: ApprovalGate | null | undefined,
  action: ChantierAction,
  patch: Partial<ChantierAction>,
  applyDirect: (patch: Partial<ChantierAction>) => Promise<unknown>,
  reason?: string
): Promise<UpdateFlowResult<ChantierAction>> {
  return updateEntityFlow("projet", gate, action, patch, applyDirect, reason);
}

/** Pendant de `updateProjetFlow` pour un CHANTIER (`"chantier_update"`) : enveloppe, consommés,
 *  critères de succès, grille d'effort, axes → 2 validations ; dépendances, pilote/sponsor/rôles →
 *  1 validation ; nom/description/critère de succès texte → libres. */
export function updateChantierFlow(
  gate: ApprovalGate | null | undefined,
  chantier: Chantier,
  patch: Partial<Chantier>,
  applyDirect: (patch: Partial<Chantier>) => Promise<unknown>,
  reason?: string
): Promise<UpdateFlowResult<Chantier>> {
  return updateEntityFlow("chantier", gate, chantier, patch, applyDirect, reason);
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
