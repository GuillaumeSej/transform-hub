/**
 * Flux UI → validation du Plan Stratégique (logique pure, testable sans rendu).
 *
 * Chaque fonction reçoit une « porte » (`ApprovalGate`, = `useStrategicApprovals()` restreint à
 * `route` / `needsApproval` + `request`). La décision vient de `resolveApprovalRoute`
 * (lib/strategicApprovals.ts) :
 *   - "direct"    → l'action est appliquée (admin, pilote du programme, modification libre) ;
 *   - "request"   → UNE demande à paliers est créée et RIEN n'est écrit côté données publiées ;
 *   - "retry"     → lève `ApprovalRetryError` (utilisateurs pas encore chargés) : rien n'est écrit ;
 *   - "forbidden" → lève `ApprovalForbiddenError`.
 * Porte ABSENTE (`null`/`undefined`, hors contexte stratégique) : les flux LÈVENT
 * `ApprovalGateUnavailableError` — jamais d'application directe par défaut. Un pilote / admin sans
 * contexte passe `directGate(user, programId)` (application directe pour eux seuls, refus sinon).
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
 *   création d'axe                → createAxisFlow            (pilote/admin seuls, direct)
 *   édition d'un axe              → updateAxisFlow            (pilote direct ; sponsor de l'axe → pilote)
 *   objectif d'un KPI             → updateIndicatorTargetFlow (2 validations depuis l'auteur)
 *   lignes ETP (staffing)         → staffingFlow              (2 validations depuis l'auteur)
 */
import { advanceMilestone, milestonePassageTarget } from "@/lib/axisLogic";
import {
  findPeriodCollision,
  MeasurementPeriodCollisionError,
  submitIndicatorValue,
  type IndicatorValueInput,
  type MeasurementEditPatch,
} from "@/lib/kpiHistory";
import type { KpiCorrectionRoute } from "@/lib/kpiCorrectionRouting";
import {
  INDICATOR_TARGET_FIELDS,
  isPilotOrAdmin,
  pendingApproversOf,
  splitPatchByCategory,
  type ApprovalRoute,
  type AxeCreateApprovalPayload,
  type ChantierCreateApprovalPayload,
  type GatedCategory,
  type IndicatorTargetPatch,
  type IndicatorUpdateApprovalPayload,
  type KpiValueApprovalPayload,
  type PatchEntity,
  type ProjetCreateApprovalPayload,
  type ProjetCreateStage,
  type StaffingOp,
  type StaffingUpdateApprovalPayload,
  type StrategicApproval,
  type StrategicApprovalKind,
  type StrategicApprovalPayload,
  type StrategicApprovalTarget,
  type ValidationCategory,
} from "@/lib/strategicApprovals";
import type {
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierStaffing,
  Indicator,
  IndicatorMeasurement,
  StrategicAxis,
} from "@/types";

export type ApprovalGate = {
  /** Route complète (préférée) : voir `resolveApprovalRoute`. Absente (portes de test/legacy) :
   *  dérivée de `needsApproval` (true ⇒ demande, false ⇒ direct). */
  route?: (
    kind: StrategicApprovalKind,
    target: StrategicApprovalTarget,
    payload?: StrategicApprovalPayload
  ) => ApprovalRoute;
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

/** Pas de contexte de validation stratégique : action refusée (jamais appliquée par défaut). */
export class ApprovalGateUnavailableError extends Error {
  constructor() {
    super(
      "Circuit de validation indisponible : action impossible hors du Plan Stratégique (seuls le pilote et les administrateurs peuvent appliquer directement)"
    );
    this.name = "ApprovalGateUnavailableError";
  }
}
/** Utilisateurs pas encore chargés : rien n'a été écrit, réessayer. */
export class ApprovalRetryError extends Error {
  constructor(reason?: string) {
    super(reason || "Données en cours de chargement : réessayez dans un instant");
    this.name = "ApprovalRetryError";
  }
}
/** L'acteur n'a pas le droit de faire cette saisie. */
export class ApprovalForbiddenError extends Error {
  constructor(reason?: string) {
    super(reason || "Vous n'êtes pas habilité à effectuer cette action");
    this.name = "ApprovalForbiddenError";
  }
}

/**
 * Porte « application directe » pour un pilote du programme / un admin HORS contexte de
 * validation (`useStrategicApprovalsApi()` null) : route "direct" pour eux, "forbidden" pour tout
 * autre utilisateur ; `request` lève toujours.
 */
export function directGate(
  user:
    Pick<AuthUser, "username" | "profiles" | "isGlobalAdmin" | "isCompanyAdmin"> | null | undefined,
  programId: string | null | undefined
): ApprovalGate {
  const allowed = isPilotOrAdmin(user, programId);
  return {
    route: () =>
      allowed
        ? { mode: "direct" }
        : { mode: "forbidden", reason: new ApprovalGateUnavailableError().message },
    needsApproval: () => !allowed,
    request: async () => {
      throw new ApprovalGateUnavailableError();
    },
  };
}

/** "direct" | "request" pour cette saisie ; lève si pas de porte / à réessayer / interdit. */
export function gateMode(
  gate: ApprovalGate | null | undefined,
  kind: StrategicApprovalKind,
  target: StrategicApprovalTarget,
  payload?: StrategicApprovalPayload
): "direct" | "request" {
  if (!gate) throw new ApprovalGateUnavailableError();
  if (gate.route) {
    const r = gate.route(kind, target, payload);
    if (r.mode === "retry") throw new ApprovalRetryError(r.reason);
    if (r.mode === "forbidden") throw new ApprovalForbiddenError(r.reason);
    return r.mode;
  }
  return gate.needsApproval(kind, target, undefined, payload) ? "request" : "direct";
}

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
  const note = input.note?.trim();
  const payload: KpiValueApprovalPayload = {
    period: input.period,
    ...(input.value !== undefined ? { value: input.value } : {}),
    ...(note ? { note } : {}),
  };
  if (gateMode(gate, "kpi_value", target, payload) === "request") {
    await gate!.request("kpi_value", target, payload);
    return "pending";
  }
  await submitIndicatorValue(addMeasurement, input);
  return "applied";
}

/** Applique une route de correction KPI : lève pour "forbidden"/"retry". */
function assertKpiRoute(route: KpiCorrectionRoute, verb: "corriger" | "supprimer"): void {
  if (route.mode === "forbidden") {
    throw new ApprovalForbiddenError(`Vous n'êtes pas habilité à ${verb} cette mesure`);
  }
  if (route.mode === "retry") throw new ApprovalRetryError();
}

/**
 * Correction d'une mesure KPI déjà publiée. Avec `route` (règles PO, `routeKpiCorrection` de
 * `lib/kpiCorrectionRouting.ts`) : `"direct"` ⇒ correction appliquée (pilote/admin) ; `"request"`
 * ⇒ demande `"kpi_value"` portant `measurementId` (le doc est réécrit à l'approbation, voir
 * `applyApprovedPayload`) ; `"forbidden"`/`"retry"` ⇒ lève. Sans `route` : même porte
 * `"kpi_value"` que la saisie. Sans porte : lève.
 */
export async function editKpiValueFlow(
  gate: ApprovalGate | null | undefined,
  indicator: Pick<Indicator, "id" | "name">,
  measurement: Pick<IndicatorMeasurement, "id" | "period" | "value" | "note">,
  patch: MeasurementEditPatch,
  updateMeasurement: (id: string, patch: MeasurementEditPatch) => Promise<unknown>,
  route?: KpiCorrectionRoute
): Promise<FlowOutcome> {
  if (!gate) throw new ApprovalGateUnavailableError();
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
  if (route) {
    assertKpiRoute(route, "corriger");
    if (route.mode === "request") {
      await gate.request("kpi_value", target, { ...payload, ...previousOf(measurement) });
      return "pending";
    }
    await updateMeasurement(measurement.id, patch);
    if (route.mode === "direct") {
      await informSafely(gate, target, { ...payload, ...previousOf(measurement) }, route.inform);
    }
    return "applied";
  }
  if (gateMode(gate, "kpi_value", target, payload) === "request") {
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
  if (!gate) throw new ApprovalGateUnavailableError();
  const target: StrategicApprovalTarget = {
    type: "indicateur",
    id: indicator.id,
    name: indicator.name,
  };
  const payload: KpiValueApprovalPayload = {
    period: measurement.period,
    measurementId: measurement.id,
    remove: true,
    ...(measurement.value !== undefined ? { value: measurement.value } : {}),
    ...previousOf(measurement),
  };
  if (route) {
    assertKpiRoute(route, "supprimer");
    if (route.mode === "request") {
      await gate.request("kpi_value", target, payload);
      return "pending";
    }
    await deleteMeasurement(measurement.id);
    if (route.mode === "direct") await informSafely(gate, target, payload, route.inform);
    return "applied";
  }
  if (gateMode(gate, "kpi_value", target, payload) === "request") {
    await gate.request("kpi_value", target, payload);
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
  const payload = { name: target.name };
  if (gateMode(gate, approvalKind, t, payload) === "request") {
    await gate!.request(approvalKind, t, payload, reason.trim() || undefined);
    return "pending";
  }
  await deleteDirect();
  return "applied";
}

/**
 * Création d'un projet : UNE demande `"projet_create"` à deux paliers (sponsor de chantier PUIS
 * sponsor d'axe, l'auteur étant traité au moins comme responsable projet — voir
 * lib/strategicApprovals.ts), ou création directe (admin, pilote du programme). L'ancienne double
 * demande enchaînée (`payload.stage`) n'est plus produite ; les demandes legacy déjà en base
 * restent traitées par `useStrategicApprovals`.
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
  const payload: ProjetCreateApprovalPayload = {
    action,
    ...(staffing.length ? { staffing } : {}),
  };
  if (gateMode(gate, "projet_create", target, payload) === "request") {
    await gate!.request("projet_create", target, payload);
    return "pending";
  }
  await createDirect();
  return "applied";
}

/**
 * Création d'un chantier : demande `"chantier_create"` (sponsor d'axe puis pilote du plan), ou
 * création directe (admin, pilote). `chantier` : complet, id déjà généré (voir `newChantierId`),
 * `axisIds` non vide ; cible = son axe principal (`axisIds[0]`).
 */
export async function createChantierFlow(
  gate: ApprovalGate | null | undefined,
  chantier: Chantier,
  createDirect: () => Promise<unknown>,
  reason?: string
): Promise<FlowOutcome> {
  const target: StrategicApprovalTarget = {
    type: "axe",
    id: chantier.axisIds[0],
    name: chantier.name,
  };
  const payload: ChantierCreateApprovalPayload = { chantier };
  if (gateMode(gate, "chantier_create", target, payload) === "request") {
    await gate!.request("chantier_create", target, payload, reason?.trim() || undefined);
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

const UPDATE_KIND: Record<PatchEntity, StrategicApprovalKind> = {
  projet: "projet_update",
  chantier: "chantier_update",
  axe: "axe_update",
};

async function updateEntityFlow<T extends { id: string; name: string }>(
  entity: PatchEntity,
  gate: ApprovalGate | null | undefined,
  current: T,
  patch: Partial<T>,
  applyDirect: (patch: Partial<T>) => Promise<unknown>,
  reason?: string
): Promise<UpdateFlowResult<T>> {
  const split = splitPatchByCategory(entity, current, patch);
  const kind = UPDATE_KIND[entity];
  const target: StrategicApprovalTarget = { type: entity, id: current.id, name: current.name };
  const direct: Partial<T> = { ...split.free };
  const hasGated = GATED_ORDER.some((c) => Object.keys(split[c]).length > 0);
  if (!Object.keys(direct).length && !hasGated) {
    return { outcome: "noop", applied: {}, requests: [] };
  }
  // Toutes les routes sont calculées AVANT la moindre écriture : un refus (porte absente, droit,
  // utilisateurs non chargés) n'applique rien, pas même les libellés.
  if (entity === "axe" && Object.keys(direct).length) {
    // Axe : même un libellé exige le droit d'édition (`canEditAxis`).
    gateMode(gate, kind, target, {
      patch: direct,
      before: {},
      category: "free" as ValidationCategory,
    } as unknown as StrategicApprovalPayload);
  }
  if (!gate) throw new ApprovalGateUnavailableError();
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
    if (gateMode(gate, kind, target, payload) === "request") toRequest.push({ category, payload });
    else Object.assign(direct, part);
  }
  const directKeys = Object.keys(direct);
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
 * Une demande `"projet_update"` par catégorie non vide ; pour le pilote/admin tout est direct.
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
 *  critères de succès, grille d'effort, axes → 2 validations ; dépendances, pilote/rôles →
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

/**
 * Création d'un AXE (`"axe_create"`) : pilote du programme / admin uniquement — appliquée
 * directement (`createDirect`). Tout autre acteur : `ApprovalForbiddenError` (vérifier
 * `canCreateAxis` pour masquer le bouton). `axis` : complet, id déjà généré (`newAxisId`).
 */
export async function createAxisFlow(
  gate: ApprovalGate | null | undefined,
  axis: StrategicAxis,
  createDirect: () => Promise<unknown>,
  reason?: string
): Promise<FlowOutcome> {
  const target: StrategicApprovalTarget = { type: "axe", id: axis.id, name: axis.name };
  const payload: AxeCreateApprovalPayload = { axis };
  if (gateMode(gate, "axe_create", target, payload) === "request") {
    await gate!.request("axe_create", target, payload, reason?.trim() || undefined);
    return "pending";
  }
  await createDirect();
  return "applied";
}

/** Génère l'identifiant d'un axe (même format que les autres ids stables). */
export function newAxisId(): string {
  return `AX-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Modification d'un AXE (`"axe_update"`) : pilote/admin → tout direct ; sponsor de CET axe →
 * libellés (nom, description, couleur) directs, le reste soumis au pilote (1 validation) ; la
 * désignation du sponsor (`owner`) reste réservée au pilote/admin ; autres rôles → refus
 * (`ApprovalForbiddenError`, voir `canEditAxis`).
 */
export function updateAxisFlow(
  gate: ApprovalGate | null | undefined,
  axis: StrategicAxis,
  patch: Partial<StrategicAxis>,
  applyDirect: (patch: Partial<StrategicAxis>) => Promise<unknown>,
  reason?: string
): Promise<UpdateFlowResult<StrategicAxis>> {
  return updateEntityFlow("axe", gate, axis, patch, applyDirect, reason);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Modification de l'OBJECTIF d'un KPI (`"indicator_update"` : objective / objectiveValue /
 * direction / targetSchedule — les autres champs de `patch` sont ignorés). Pilote/admin → direct ;
 * sponsor de chantier (KPI de chantier) → sponsor d'axe puis pilote ; sponsor d'axe → pilote.
 * Autres : `ApprovalForbiddenError` (voir `canEditIndicatorTarget`). `applyDirect(patch)` reçoit
 * le patch filtré (`undefined` = champ vidé).
 */
export async function updateIndicatorTargetFlow(
  gate: ApprovalGate | null | undefined,
  indicator: Indicator,
  patch: IndicatorTargetPatch,
  applyDirect: (patch: IndicatorTargetPatch) => Promise<unknown>,
  reason?: string
): Promise<UpdateFlowResult<Indicator>> {
  const changed: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  for (const field of INDICATOR_TARGET_FIELDS) {
    if (!(field in patch)) continue;
    const next = (patch as Record<string, unknown>)[field];
    const prev = (indicator as Record<string, unknown>)[field];
    if (sameJson(next, prev)) continue;
    changed[field] = next;
    before[field] = prev;
  }
  if (!Object.keys(changed).length) return { outcome: "noop", applied: {}, requests: [] };
  const target: StrategicApprovalTarget = {
    type: "indicateur",
    id: indicator.id,
    name: indicator.name,
  };
  const encoded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(changed)) encoded[k] = v === undefined ? null : v;
  const payload: IndicatorUpdateApprovalPayload = {
    patch: encoded as IndicatorTargetPatch,
    before: before as IndicatorTargetPatch,
  };
  if (gateMode(gate, "indicator_update", target, payload) === "request") {
    const request = await gate!.request("indicator_update", target, payload, reason);
    return { outcome: "pending", applied: {}, requests: [request] };
  }
  await applyDirect(changed as IndicatorTargetPatch);
  return { outcome: "applied", applied: changed as Partial<Indicator>, requests: [] };
}

/**
 * Création / modification / suppression d'UNE ligne ETP (`"staffing_update"`). `line` : la ligne
 * complète visée (id déjà généré pour une création — `newStaffingId`) ; `before` : la ligne
 * actuelle (modification/suppression). Cible = le projet (`line.actionId`) sinon le chantier.
 * Pilote/admin → `applyDirect()` ; sinon demande à 2 paliers depuis le niveau de l'auteur ;
 * `ApprovalForbiddenError` si `canEditStaffing` refuse.
 */
export async function staffingFlow(
  gate: ApprovalGate | null | undefined,
  input: {
    op: StaffingOp;
    line: ChantierStaffing;
    before?: ChantierStaffing;
    /** Libellé lisible de la cible (nom du projet/chantier). */
    targetName?: string;
  },
  applyDirect: () => Promise<unknown>,
  reason?: string
): Promise<FlowOutcome> {
  const { op, line, before, targetName } = input;
  const target: StrategicApprovalTarget = line.actionId
    ? { type: "projet", id: line.actionId, name: targetName }
    : { type: "chantier", id: line.chantierId, name: targetName };
  const payload: StaffingUpdateApprovalPayload = {
    op,
    line,
    ...(op !== "create" ? { before: before ?? line } : {}),
  };
  if (gateMode(gate, "staffing_update", target, payload) === "request") {
    await gate!.request("staffing_update", target, payload, reason?.trim() || undefined);
    return "pending";
  }
  await applyDirect();
  return "applied";
}

/** Génère l'identifiant d'une ligne ETP. */
export function newStaffingId(): string {
  return `CS-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Génère l'identifiant d'un projet (même format que `useStrategicData`). */
export function newProjetId(): string {
  return `CA-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Passage de jalon : valide les prérequis (check-list du jalon courant complète, jalon suivant
 * existant — lève sinon) puis route "milestone" : demande à chaîne (N+1 puis N+2 au-dessus de
 * l'auteur — contributeurs compris) → "pending" ; pilote/admin → "applied" (si `applyDirect` est
 * fourni, le patch d'avancée `advanceMilestone` lui est passé ; sinon l'appelant applique
 * `directMilestoneAdvance`, lib/strategicFiche.ts). `user` : conservé pour compatibilité (la
 * porte connaît l'acteur).
 */
export async function milestoneFlow(
  gate: ApprovalGate | null | undefined,
  action: ChantierAction,
  user: Pick<AuthUser, "username" | "isGlobalAdmin" | "isCompanyAdmin">,
  chantiers: Chantier[],
  actions: ChantierAction[],
  applyDirect?: (
    patch: Pick<ChantierAction, "milestones" | "milestoneApproval">
  ) => Promise<unknown>
): Promise<FlowOutcome> {
  void user;
  const { from, targetMilestone } = milestonePassageTarget(action, chantiers, actions);
  const target: StrategicApprovalTarget = { type: "projet", id: action.id, name: action.name };
  const payload = { targetMilestone, fromMilestone: from };
  if (gateMode(gate, "milestone", target, payload) === "request") {
    await gate!.request("milestone", target, payload);
    return "pending";
  }
  if (applyDirect) await applyDirect(advanceMilestone(action, targetMilestone));
  return "applied";
}
