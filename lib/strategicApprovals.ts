import {
  axisDecisionMakers,
  computeIndicatorStatus,
  displayMilestoneId,
  isStrategicLeadOf,
  latestMeasurement,
} from "@/lib/axisLogic";
import { MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import { hasRole, isAnyAdmin } from "@/lib/roleProfiles";
import type {
  Alert,
  AuditEntry,
  AuthUser,
  Chantier,
  ChantierAction,
  Indicator,
  IndicatorMeasurement,
  MilestoneId,
  Role,
  StrategicAxis,
} from "@/types";

/**
 * Validation stratégique — modèle + logique PURE (aucun accès Firestore/React ici ; la persistance
 * est dans lib/firestore/strategicApprovals.ts, l'API React dans lib/hooks/useStrategicApprovals.ts).
 *
 * Qui valide quoi :
 *  - "milestone"       passage de jalon d'un projet      → responsable (pilote) du CHANTIER
 *  - "kpi_value"       valeur KPI renseignée             → responsable du plan (strategic_lead)
 *  - "projet_create"   projet ajouté à un chantier       → responsable de l'AXE
 *  - "projet_delete"   suppression d'un projet           → responsable du CHANTIER
 *  - "chantier_delete" suppression d'un chantier         → responsable de l'AXE
 * Repli en cascade quand le responsable nominal n'est pas renseigné : pilote de chantier → owner
 * d'axe → strategic_lead. Un admin peut toujours décider ; le strategic_lead du programme aussi
 * (escalade). Personne (hors admin) ne décide sa propre demande.
 */

export type StrategicApprovalKind =
  "milestone" | "kpi_value" | "projet_create" | "projet_delete" | "chantier_delete";

export const STRATEGIC_APPROVAL_KINDS: StrategicApprovalKind[] = [
  "milestone",
  "kpi_value",
  "projet_create",
  "projet_delete",
  "chantier_delete",
];

export type StrategicApprovalTargetType = "axe" | "chantier" | "projet" | "indicateur";
export type StrategicApprovalStatus = "pending" | "approved" | "rejected";

export type StrategicApprovalTarget = {
  type: StrategicApprovalTargetType;
  id: string;
  /** Libellé lisible au moment de la demande (survit à la suppression de la cible). */
  name?: string;
};

export type MilestoneApprovalPayload = {
  targetMilestone: MilestoneId;
  fromMilestone?: MilestoneId;
};
export type KpiValueApprovalPayload = { period: string; value?: number; note?: string };
/** `action` complet (avec son `id` déjà généré : l'application est idempotente). */
export type ProjetCreateApprovalPayload = { action: ChantierAction };
export type DeleteApprovalPayload = { name?: string };
export type StrategicApprovalPayload =
  | MilestoneApprovalPayload
  | KpiValueApprovalPayload
  | ProjetCreateApprovalPayload
  | DeleteApprovalPayload;

export type StrategicApproval = {
  id: string;
  companyId: string;
  programId: string;
  kind: StrategicApprovalKind;
  targetType: StrategicApprovalTargetType;
  targetId: string;
  targetName?: string;
  payload: StrategicApprovalPayload;
  requestedBy: string; // username
  requestedByName?: string;
  requestedAt: string; // ISO
  approverRole: Role;
  /** Approbateur nominal résolu à la demande (premier de `approverUsernames`), peut être absent. */
  approverUsername?: string;
  approverUsernames: string[];
  status: StrategicApprovalStatus;
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: string;
  decisionComment?: string;
  /** Motif saisi par le demandeur. */
  reason?: string;
};

/** Ce que la résolution d'approbateur a besoin de connaître du plan (déjà scopé programme). */
export type StrategicApprovalData = {
  programId?: string | null;
  axes: StrategicAxis[];
  chantiers: Chantier[];
  chantierActions: ChantierAction[];
  indicators: Indicator[];
  measurements?: IndicatorMeasurement[];
  users?: Pick<AuthUser, "username" | "name" | "profiles">[];
};

export type ResolvedApprover = {
  role: Role;
  usernames: string[];
  username?: string;
};

type Actor = Pick<AuthUser, "username" | "profiles" | "isGlobalAdmin" | "isCompanyAdmin">;

// ─── Résolution ─────────────────────────────────────────────────────────────────────────────

/** Programme d'une cible (via son chantier/axe/indicateur), sinon `data.programId`. */
export function resolveTargetProgramId(
  target: StrategicApprovalTarget,
  data: StrategicApprovalData
): string | undefined {
  let programId: string | undefined;
  if (target.type === "chantier") {
    programId = data.chantiers.find((c) => c.id === target.id)?.programId;
  } else if (target.type === "projet") {
    const action = data.chantierActions.find((a) => a.id === target.id);
    programId = data.chantiers.find((c) => c.id === action?.chantierId)?.programId;
  } else if (target.type === "axe") {
    programId = data.axes.find((a) => a.id === target.id)?.programId;
  } else {
    programId = data.indicators.find((i) => i.id === target.id)?.programId;
  }
  return programId ?? data.programId ?? undefined;
}

function chantierOfTarget(
  target: StrategicApprovalTarget,
  data: StrategicApprovalData
): Chantier | undefined {
  if (target.type === "chantier") return data.chantiers.find((c) => c.id === target.id);
  if (target.type === "projet") {
    const action = data.chantierActions.find((a) => a.id === target.id);
    return data.chantiers.find((c) => c.id === action?.chantierId);
  }
  if (target.type === "indicateur") {
    const indicator = data.indicators.find((i) => i.id === target.id);
    return data.chantiers.find((c) => c.id === indicator?.chantierId);
  }
  return undefined;
}

function axisOwners(axisIds: string[], axes: StrategicAxis[]): string[] {
  const out: string[] = [];
  for (const id of axisIds) {
    const axis = axes.find((a) => a.id === id);
    if (!axis) continue;
    // Le sponsor de l'axe (rôle unique) décide.
    for (const u of axisDecisionMakers(axis)) if (!out.includes(u)) out.push(u);
  }
  return out;
}

function strategicLeadUsernames(programId: string | undefined, data: StrategicApprovalData) {
  return (data.users ?? [])
    .filter((u) => isStrategicLeadOf({ programId: programId ?? "" }, u))
    .map((u) => u.username);
}

/** Approbateur attendu pour une demande de ce `kind` sur cette cible (voir en-tête du fichier). */
export function resolveApprover(
  kind: StrategicApprovalKind,
  target: StrategicApprovalTarget,
  data: StrategicApprovalData
): ResolvedApprover {
  const programId = resolveTargetProgramId(target, data);
  const lead = (): ResolvedApprover => {
    const usernames = strategicLeadUsernames(programId, data);
    return { role: "strategic_lead", usernames, username: usernames[0] };
  };
  const chantier = chantierOfTarget(target, data);

  const axisLevel = (): ResolvedApprover => {
    const axisIds = target.type === "axe" ? [target.id] : (chantier?.axisIds ?? []);
    const owners = axisOwners(axisIds, data.axes);
    return owners.length
      ? { role: "axis_sponsor", usernames: owners, username: owners[0] }
      : lead();
  };
  const chantierLevel = (): ResolvedApprover =>
    chantier?.pilote
      ? { role: "chantier_owner", usernames: [chantier.pilote], username: chantier.pilote }
      : axisLevel();

  switch (kind) {
    case "kpi_value":
      return lead();
    case "milestone":
    case "projet_delete":
      return chantierLevel();
    case "projet_create":
    case "chantier_delete":
      return axisLevel();
  }
}

function isLeadOfProgram(user: Actor | null | undefined, programId: string | undefined): boolean {
  return (
    !!user &&
    hasRole(user, "strategic_lead") &&
    isStrategicLeadOf({ programId: programId ?? "" }, user)
  );
}

/** L'utilisateur est-il un approbateur légitime de ce type de demande (hors règle d'auto-décision) ? */
function isApproverFor(
  user: Actor | null | undefined,
  approver: ResolvedApprover,
  programId: string | undefined
): boolean {
  if (!user) return false;
  if (isAnyAdmin(user)) return true;
  if (approver.usernames.includes(user.username)) return true;
  return isLeadOfProgram(user, programId);
}

/**
 * L'acteur doit-il passer par une demande ? `false` s'il est lui-même l'approbateur (ou admin, ou
 * strategic_lead du programme) : l'action est alors appliquée directement.
 */
export function needsApproval(
  kind: StrategicApprovalKind,
  actor: Actor | null | undefined,
  target: StrategicApprovalTarget,
  data: StrategicApprovalData
): boolean {
  if (!actor) return true;
  const approver = resolveApprover(kind, target, data);
  return !isApproverFor(actor, approver, resolveTargetProgramId(target, data));
}

/** `user` peut-il approuver/refuser cette demande (encore en attente) ? */
export function canDecide(
  user: Actor | null | undefined,
  approval: StrategicApproval,
  data: StrategicApprovalData
): boolean {
  if (!user || approval.status !== "pending") return false;
  if (isAnyAdmin(user)) return true;
  if (approval.requestedBy === user.username) return false;
  const resolved = resolveApprover(
    approval.kind,
    { type: approval.targetType, id: approval.targetId, name: approval.targetName },
    data
  );
  const usernames = Array.from(new Set([...resolved.usernames, ...approval.approverUsernames]));
  return isApproverFor(user, { ...resolved, usernames }, approval.programId);
}

// ─── Construction ───────────────────────────────────────────────────────────────────────────

export function newApprovalId(): string {
  return `SA-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Retire récursivement les `undefined` (Firestore les refuse dans `setDoc`). */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

export function buildApproval(input: {
  kind: StrategicApprovalKind;
  target: StrategicApprovalTarget;
  payload: StrategicApprovalPayload;
  reason?: string;
  companyId: string;
  programId: string;
  requester: Pick<AuthUser, "username" | "name">;
  data: StrategicApprovalData;
  id?: string;
  now?: string;
}): StrategicApproval {
  const approver = resolveApprover(input.kind, input.target, input.data);
  return stripUndefined({
    id: input.id ?? newApprovalId(),
    companyId: input.companyId,
    programId: input.programId,
    kind: input.kind,
    targetType: input.target.type,
    targetId: input.target.id,
    targetName: input.target.name,
    payload: input.payload,
    requestedBy: input.requester.username,
    requestedByName: input.requester.name,
    requestedAt: input.now ?? new Date().toISOString(),
    approverRole: approver.role,
    approverUsername: approver.username,
    approverUsernames: approver.usernames,
    status: "pending" as const,
    reason: input.reason?.trim() || undefined,
  });
}

// ─── Effets ─────────────────────────────────────────────────────────────────────────────────

/** Écritures à exécuter (par le hook) pour appliquer une décision. Idempotentes (ids stables). */
export type ApprovalEffects = {
  saveActions: ChantierAction[];
  deleteActionIds: string[];
  deleteChantierIds: string[];
  saveMeasurements: IndicatorMeasurement[];
  saveIndicators: Indicator[];
};

function emptyEffects(): ApprovalEffects {
  return {
    saveActions: [],
    deleteActionIds: [],
    deleteChantierIds: [],
    saveMeasurements: [],
    saveIndicators: [],
  };
}

function withoutMilestoneApproval(action: ChantierAction): ChantierAction {
  const copy = { ...action };
  delete copy.milestoneApproval;
  return copy;
}

/**
 * Effets de la DEMANDE elle-même : pour un jalon, pose `milestoneApproval` sur le projet (le
 * marqueur "en attente" déjà affiché par l'UI existante). Sans effet pour les autres kinds.
 */
export function applyRequestSideEffects(
  approval: StrategicApproval,
  data: StrategicApprovalData
): ApprovalEffects {
  const effects = emptyEffects();
  if (approval.kind === "milestone") {
    const action = data.chantierActions.find((a) => a.id === approval.targetId);
    const payload = approval.payload as MilestoneApprovalPayload;
    if (action) {
      effects.saveActions.push({
        ...action,
        milestoneApproval: {
          targetMilestone: payload.targetMilestone,
          requestedBy: approval.requestedBy,
          requestedAt: approval.requestedAt,
        },
      });
    }
  }
  return effects;
}

/**
 * Applique l'effet d'une demande APPROUVÉE : valide le jalon, publie la valeur KPI, crée le projet,
 * supprime le projet/chantier (avec ses projets). Lève si la cible a disparu ou est périmée.
 */
export function applyApprovedPayload(
  approval: StrategicApproval,
  data: StrategicApprovalData
): ApprovalEffects {
  const effects = emptyEffects();
  switch (approval.kind) {
    case "milestone": {
      const action = data.chantierActions.find((a) => a.id === approval.targetId);
      if (!action) throw new Error("Projet introuvable : il a peut-être été supprimé");
      const { targetMilestone } = approval.payload as MilestoneApprovalPayload;
      const before = action.milestones ?? {
        currentMilestone: "E0" as MilestoneId,
        passedMilestones: [] as MilestoneId[],
        checklists: {},
      };
      if (
        MILESTONE_ORDER.indexOf(targetMilestone) <= MILESTONE_ORDER.indexOf(before.currentMilestone)
      ) {
        throw new Error(
          `Le projet est déjà au jalon ${displayMilestoneId(before.currentMilestone)} ou au-delà : demande périmée`
        );
      }
      const passed = before.passedMilestones.includes(before.currentMilestone)
        ? before.passedMilestones
        : [...before.passedMilestones, before.currentMilestone];
      effects.saveActions.push(
        withoutMilestoneApproval({
          ...action,
          milestones: { ...before, currentMilestone: targetMilestone, passedMilestones: passed },
        })
      );
      return effects;
    }
    case "kpi_value": {
      const indicator = data.indicators.find((i) => i.id === approval.targetId);
      if (!indicator) throw new Error("Indicateur introuvable : il a peut-être été supprimé");
      const p = approval.payload as KpiValueApprovalPayload;
      const measurement: IndicatorMeasurement = stripUndefined({
        id: `IM-${approval.id}`,
        companyId: approval.companyId,
        indicatorId: indicator.id,
        period: p.period,
        value: p.value,
        note: p.note,
        reportedBy: approval.requestedBy,
        reportedAt: approval.decidedAt ?? new Date().toISOString(),
      });
      effects.saveMeasurements.push(measurement);
      const others = (data.measurements ?? []).filter((m) => m.id !== measurement.id);
      const status = computeIndicatorStatus(indicator, [...others, measurement]);
      if (status !== indicator.status) {
        effects.saveIndicators.push({
          ...indicator,
          status,
          lastUpdate: (approval.decidedAt ?? new Date().toISOString()).slice(0, 10),
        });
      }
      return effects;
    }
    case "projet_create": {
      const { action } = approval.payload as ProjetCreateApprovalPayload;
      if (!data.chantiers.some((c) => c.id === action.chantierId)) {
        throw new Error("Chantier introuvable : il a peut-être été supprimé");
      }
      effects.saveActions.push({ ...action, companyId: approval.companyId });
      return effects;
    }
    case "projet_delete": {
      effects.deleteActionIds.push(approval.targetId);
      return effects;
    }
    case "chantier_delete": {
      effects.deleteChantierIds.push(approval.targetId);
      // Pas d'orphelins : les projets du chantier partent avec lui.
      for (const a of data.chantierActions) {
        if (a.chantierId === approval.targetId) effects.deleteActionIds.push(a.id);
      }
      return effects;
    }
  }
}

/** Effets d'un REFUS : un jalon refusé retire le marqueur "en attente" du projet. */
export function applyRejectedPayload(
  approval: StrategicApproval,
  data: StrategicApprovalData
): ApprovalEffects {
  const effects = emptyEffects();
  if (approval.kind === "milestone") {
    const action = data.chantierActions.find((a) => a.id === approval.targetId);
    if (action?.milestoneApproval) effects.saveActions.push(withoutMilestoneApproval(action));
  }
  return effects;
}

// ─── Description (UI) ───────────────────────────────────────────────────────────────────────

export type ApprovalDescription = {
  subject: string;
  /** Valeur actuelle (absente pour une création). */
  before?: string;
  /** Valeur demandée (absente pour une suppression : l'UI affiche "Supprimé"). */
  after?: string;
};

export function describeApproval(
  approval: StrategicApproval,
  data: StrategicApprovalData
): ApprovalDescription {
  const subject = approval.targetName ?? approval.targetId;
  switch (approval.kind) {
    case "milestone": {
      const p = approval.payload as MilestoneApprovalPayload;
      const action = data.chantierActions.find((a) => a.id === approval.targetId);
      const from = p.fromMilestone ?? action?.milestones?.currentMilestone ?? "E0";
      return {
        subject,
        before: displayMilestoneId(from),
        after: displayMilestoneId(p.targetMilestone),
      };
    }
    case "kpi_value": {
      const p = approval.payload as KpiValueApprovalPayload;
      const indicator = data.indicators.find((i) => i.id === approval.targetId);
      const unit = indicator?.unit ? ` ${indicator.unit}` : "";
      const latest = latestMeasurement(approval.targetId, data.measurements ?? []);
      return {
        subject,
        before: latest?.value !== undefined ? `${latest.value}${unit}` : undefined,
        after: `${p.value ?? "—"}${unit} (${p.period})`,
      };
    }
    case "projet_create": {
      const { action } = approval.payload as ProjetCreateApprovalPayload;
      return { subject: action.name || subject, after: `${action.start} → ${action.end}` };
    }
    default: {
      const p = approval.payload as DeleteApprovalPayload;
      return { subject: p.name ?? subject, before: p.name ?? subject };
    }
  }
}

// ─── Audit ──────────────────────────────────────────────────────────────────────────────────

export type ApprovalEvent = "requested" | "approved" | "rejected";

function displayName(
  username: string | undefined,
  users: StrategicApprovalData["users"],
  fb?: string
) {
  if (!username) return fb ?? "—";
  return users?.find((u) => u.username === username)?.name ?? fb ?? username;
}

function verbPhrase(approval: StrategicApproval, pastTense: boolean): string {
  const name = approval.targetName ?? approval.targetId;
  switch (approval.kind) {
    case "milestone": {
      const p = approval.payload as MilestoneApprovalPayload;
      const to = displayMilestoneId(p.targetMilestone);
      return pastTense
        ? `a fait passer le projet « ${name} » au jalon ${to}`
        : `le passage du projet « ${name} » au jalon ${to}`;
    }
    case "kpi_value": {
      const p = approval.payload as KpiValueApprovalPayload;
      return pastTense
        ? `a renseigné ${p.value ?? "—"} (${p.period}) sur l'indicateur « ${name} »`
        : `la valeur ${p.value ?? "—"} (${p.period}) de l'indicateur « ${name} »`;
    }
    case "projet_create":
      return pastTense ? `a ajouté le projet « ${name} »` : `l'ajout du projet « ${name} »`;
    case "projet_delete":
      return pastTense
        ? `a supprimé le projet « ${name} »`
        : `la suppression du projet « ${name} »`;
    case "chantier_delete":
      return pastTense
        ? `a supprimé le chantier « ${name} »`
        : `la suppression du chantier « ${name} »`;
  }
}

/**
 * Entrée du journal d'audit (admin/history) pour une demande/décision, avec un texte explicite :
 * « X a supprimé le chantier Y — validé par Z ».
 */
export function buildApprovalAuditEntry(
  approval: StrategicApproval,
  event: ApprovalEvent,
  users?: StrategicApprovalData["users"],
  ts?: string
): AuditEntry {
  const requester = displayName(approval.requestedBy, users, approval.requestedByName);
  const decider = displayName(approval.decidedBy, users, approval.decidedByName);
  const base = { ts: ts ?? new Date().toISOString().slice(0, 16).replace("T", " ") };
  const entity = approval.targetId;
  const field = `validation:${approval.kind}`;
  if (event === "requested") {
    const approver = approval.approverUsername
      ? displayName(approval.approverUsername, users)
      : approval.approverRole;
    return {
      ...base,
      user: requester,
      action: "approval_requested",
      entity,
      field,
      old: "",
      new: `${requester} a demandé ${verbPhrase(approval, false)} — à valider par ${approver}${approval.reason ? ` (motif : ${approval.reason})` : ""}`,
    };
  }
  const comment = approval.decisionComment ? ` (${approval.decisionComment})` : "";
  if (event === "approved") {
    return {
      ...base,
      user: decider,
      action: "approval_approved",
      entity,
      field,
      old: "pending",
      new: `${requester} ${verbPhrase(approval, true)} — validé par ${decider}${comment}`,
    };
  }
  return {
    ...base,
    user: decider,
    action: "approval_rejected",
    entity,
    field,
    old: "pending",
    new: `${decider} a refusé ${verbPhrase(approval, false)} demandé(e) par ${requester}${comment}`,
  };
}

// ─── Alertes ────────────────────────────────────────────────────────────────────────────────

export const APPROVAL_ALERT_ROUTE = "/validation";
/** Fenêtre (jours) pendant laquelle une décision reste signalée au demandeur/approbateur. */
export const DECISION_ALERT_WINDOW_DAYS = 14;

/**
 * Alertes DÉRIVÉES des demandes (pas de document `alerts` séparé : toujours cohérentes avec l'état
 * réel, aucun risque de désynchronisation) pour l'utilisateur courant :
 *  - approbateur : « à valider » tant que la demande est en attente ;
 *  - demandeur : « en attente » (bleu) puis « validée »/« refusée » à la décision ;
 *  - approbateur ayant décidé : accusé de décision.
 */
export function buildApprovalAlerts(
  approvals: StrategicApproval[],
  user: Actor | null | undefined,
  data: StrategicApprovalData,
  now: Date = new Date()
): Alert[] {
  if (!user) return [];
  const alerts: Alert[] = [];
  const cutoff = now.getTime() - DECISION_ALERT_WINDOW_DAYS * 86_400_000;
  for (const a of approvals) {
    const requester = displayName(a.requestedBy, data.users, a.requestedByName);
    const decider = displayName(a.decidedBy, data.users, a.decidedByName);
    const label = describeApproval(a, data).subject;
    const common = {
      scope: a.targetId,
      scopeLabel: label,
      actorRole: a.approverRole,
      source: "auto" as const,
      companyId: a.companyId,
      resolved: false,
    };
    if (a.status === "pending") {
      if (canDecide(user, a, data)) {
        alerts.push({
          ...common,
          id: `strategic-approval-${a.id}-todo`,
          type: "amber",
          ts: a.requestedAt.slice(0, 10),
          createdAt: a.requestedAt,
          title: `À valider · ${label}`,
          desc: `${requester} demande ${verbPhrase(a, false)}.`,
        });
      }
      if (a.requestedBy === user.username) {
        alerts.push({
          ...common,
          id: `strategic-approval-${a.id}-wait`,
          type: "blue",
          ts: a.requestedAt.slice(0, 10),
          createdAt: a.requestedAt,
          title: `Demande en attente · ${label}`,
          desc: `Votre demande de ${verbPhrase(a, false)} attend la validation de ${
            a.approverUsername ? displayName(a.approverUsername, data.users) : a.approverRole
          }.`,
        });
      }
      continue;
    }
    const decidedAt = a.decidedAt ?? a.requestedAt;
    if (new Date(decidedAt).getTime() < cutoff) continue;
    const approved = a.status === "approved";
    if (a.requestedBy === user.username) {
      alerts.push({
        ...common,
        id: `strategic-approval-${a.id}-decision`,
        type: approved ? "green" : "red",
        ts: decidedAt.slice(0, 10),
        createdAt: decidedAt,
        title: `${approved ? "Demande validée" : "Demande refusée"} · ${label}`,
        desc: `${decider} a ${approved ? "validé" : "refusé"} ${verbPhrase(a, false)}${
          a.decisionComment ? ` — ${a.decisionComment}` : ""
        }.`,
      });
    } else if (a.decidedBy === user.username) {
      alerts.push({
        ...common,
        id: `strategic-approval-${a.id}-decided`,
        type: approved ? "green" : "red",
        ts: decidedAt.slice(0, 10),
        createdAt: decidedAt,
        title: `${approved ? "Validation enregistrée" : "Refus enregistré"} · ${label}`,
        desc: `Vous avez ${approved ? "validé" : "refusé"} ${verbPhrase(a, false)} demandé(e) par ${requester}.`,
      });
    }
  }
  return alerts;
}

// ─── Sélecteurs ─────────────────────────────────────────────────────────────────────────────

export type ApprovalBuckets = {
  /** En attente ET que l'utilisateur peut décider. */
  pending: StrategicApproval[];
  /** Demandes émises par l'utilisateur, tous statuts, récentes d'abord. */
  mine: StrategicApproval[];
  /** Demandes décidées visibles de l'utilisateur (émises, décidées par lui, ou tout pour un
   *  admin/strategic_lead), récentes d'abord. */
  history: StrategicApproval[];
};

export function bucketApprovals(
  approvals: StrategicApproval[],
  user: Actor | null | undefined,
  data: StrategicApprovalData
): ApprovalBuckets {
  if (!user) return { pending: [], mine: [], history: [] };
  const byRecent = (a: StrategicApproval, b: StrategicApproval) =>
    (b.decidedAt ?? b.requestedAt).localeCompare(a.decidedAt ?? a.requestedAt);
  const pending = approvals
    .filter((a) => canDecide(user, a, data))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const mine = approvals.filter((a) => a.requestedBy === user.username).sort(byRecent);
  const seesAll = isAnyAdmin(user) || hasRole(user, "strategic_lead");
  const history = approvals
    .filter(
      (a) =>
        a.status !== "pending" &&
        (seesAll || a.requestedBy === user.username || a.decidedBy === user.username)
    )
    .sort(byRecent);
  return { pending, mine, history };
}
