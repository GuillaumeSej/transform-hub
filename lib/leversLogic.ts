import * as engine from "@/lib/engine";
import type { CascadeShift } from "@/lib/engine";
import { STATUS_ORDER } from "@/lib/status-config";
import type { AuditEntry, Comment, FinancialSnapshot, Lever, LeverAction, SubLever } from "@/types";

type PlanLockable = Pick<
  Lever,
  | "status"
  | "lockedPlan"
  | "reforecast"
  | "grossSavings"
  | "netSavings"
  | "opexOneOff"
  | "opexRec"
  | "capex"
>;

function snapshot(entity: PlanLockable): FinancialSnapshot {
  return {
    grossSavings: entity.grossSavings,
    netSavings: entity.netSavings,
    opexOneOff: entity.opexOneOff,
    opexRec: entity.opexRec,
    capex: entity.capex,
  };
}

/** Fige le plan initial dès le passage à l'étape "validated" (une seule fois), puis initialise la
 * réactualisation dès le passage à l'étape "in_progress" (une seule fois, sur la base du plan figé). Ne
 * fait rien si déjà figé/initialisé, ou si le statut n'atteint pas ces paliers. */
export function applyPlanLock<T extends PlanLockable>(entity: T): T {
  let next = entity;
  if (!next.lockedPlan && STATUS_ORDER[next.status] >= STATUS_ORDER.validated) {
    next = { ...next, lockedPlan: snapshot(next) };
  }
  if (!next.reforecast && STATUS_ORDER[next.status] >= STATUS_ORDER.in_progress) {
    next = { ...next, reforecast: next.lockedPlan ?? snapshot(next) };
  }
  return next;
}

/**
 * Logique métier pure du périmètre "leviers" : mêmes règles que l'ancienne couche
 * localStorage (lib/storage.ts), mais sans I/O — prend l'état courant (levers/subLevers) en
 * entrée et retourne le nouvel état + les entités à persister. Permet à useBeTrackData de faire
 * une mise à jour optimiste locale puis d'écrire dans Firestore en tâche de fond.
 */

function nowDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowTs(): string {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

function nextEntityId(prefix: string, existingIds: string[]): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  const maxNum = existingIds.reduce((max, id) => {
    const m = pattern.exec(id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `${prefix}${String(maxNum + 1).padStart(3, "0")}`;
}

function makeAuditEntry(entry: Omit<AuditEntry, "ts">): AuditEntry {
  return { ...entry, ts: nowTs() };
}

/** Recalcule lever.progress à partir des sous-leviers, en renvoyant le lever mis à jour
 * seulement s'il a changé (sinon undefined) — évite une écriture Firestore inutile. */
function recomputeLeverProgress(lever: Lever, subLevers: SubLever[]): Lever | undefined {
  const newProgress = engine.recomputeLeverProgress(lever, subLevers);
  if (newProgress === lever.progress) return undefined;
  return {
    ...lever,
    progress: newProgress,
    status: newProgress >= 100 && lever.status !== "cancelled" ? "delivered" : lever.status,
  };
}

export type LeverMutationResult = {
  levers: Lever[];
  lever: Lever;
  auditEntries: AuditEntry[];
};

export function createLever(
  levers: Lever[],
  input: Omit<Lever, "id" | "createdAt" | "lastUpdate">,
  user: string
): LeverMutationResult {
  const maxNum = levers.reduce((max, l) => {
    const m = /^L(\d+)$/.exec(l.id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  const id = `L${String(maxNum + 1).padStart(3, "0")}`;
  const now = nowDate();
  const lever: Lever = applyPlanLock({ ...input, id, createdAt: now, lastUpdate: now });
  return {
    levers: [...levers, lever],
    lever,
    auditEntries: [
      makeAuditEntry({
        user,
        action: "created",
        entity: id,
        field: "lever",
        old: "",
        new: lever.name,
      }),
    ],
  };
}

export function updateLever(
  levers: Lever[],
  id: string,
  patch: Partial<Lever>,
  user: string
): LeverMutationResult {
  const idx = levers.findIndex((l) => l.id === id);
  if (idx === -1) throw new Error(`Lever "${id}" introuvable`);
  const before = levers[idx];
  // Une fois le plan initial figé (L3+), les chiffres bruts ne sont plus modifiables par cette
  // voie — seule la réactualisation (patch.reforecast) l'est encore.
  const safePatch = before.lockedPlan
    ? {
        ...patch,
        grossSavings: before.grossSavings,
        netSavings: before.netSavings,
        opexOneOff: before.opexOneOff,
        opexRec: before.opexRec,
        capex: before.capex,
      }
    : patch;
  // Annulation : on capture l'étape du cycle de vie quittée, pour que le Sankey chronologique
  // puisse brancher le levier sans avoir à deviner l'étape via une heuristique sur `progress`.
  const cancelledPatch: Partial<Lever> =
    safePatch.status === "cancelled" && before.status !== "cancelled"
      ? { cancelledAtStage: before.status }
      : {};
  const after: Lever = applyPlanLock({
    ...before,
    ...safePatch,
    ...cancelledPatch,
    lastUpdate: nowDate(),
  });
  const nextLevers = [...levers];
  nextLevers[idx] = after;

  const auditEntries: AuditEntry[] = [];
  (Object.keys(safePatch) as (keyof Lever)[]).forEach((field) => {
    if (before[field] !== after[field]) {
      auditEntries.push(
        makeAuditEntry({
          user,
          action: "updated",
          entity: id,
          field: String(field),
          old: before[field] as string | number,
          new: after[field] as string | number,
        })
      );
    }
  });

  return { levers: nextLevers, lever: after, auditEntries };
}

export function upsertLeverByCode(
  levers: Lever[],
  input: Omit<Lever, "id" | "createdAt" | "lastUpdate">,
  user: string
): LeverMutationResult & { created: boolean } {
  const existing = levers.find((l) => l.code === input.code);
  if (existing) {
    return { ...updateLever(levers, existing.id, input, user), created: false };
  }
  return { ...createLever(levers, input, user), created: true };
}

export type SubLeverMutationResult = {
  subLevers: SubLever[];
  subLever: SubLever;
  levers: Lever[];
  changedLever?: Lever;
  auditEntries: AuditEntry[];
};

export function createSubLever(
  levers: Lever[],
  subLevers: SubLever[],
  input: Omit<SubLever, "id">,
  user: string
): SubLeverMutationResult {
  const id = nextEntityId(
    "SL",
    subLevers.map((s) => s.id)
  );
  const subLever: SubLever = applyPlanLock({ ...input, id });
  const nextSubLevers = [...subLevers, subLever];

  const auditEntries = [
    makeAuditEntry({
      user,
      action: "created",
      entity: subLever.leverId,
      field: "sous-levier",
      old: "",
      new: subLever.name,
    }),
  ];

  const lever = levers.find((l) => l.id === subLever.leverId);
  const changedLever = lever ? recomputeLeverProgress(lever, nextSubLevers) : undefined;
  const nextLevers = changedLever
    ? levers.map((l) => (l.id === changedLever.id ? changedLever : l))
    : levers;

  return { subLevers: nextSubLevers, subLever, levers: nextLevers, changedLever, auditEntries };
}

export function updateSubLever(
  levers: Lever[],
  subLevers: SubLever[],
  id: string,
  patch: Partial<SubLever>,
  user: string
): SubLeverMutationResult {
  const idx = subLevers.findIndex((s) => s.id === id);
  if (idx === -1) throw new Error(`Sous-levier "${id}" introuvable`);
  const before = subLevers[idx];
  const safePatch = before.lockedPlan
    ? {
        ...patch,
        grossSavings: before.grossSavings,
        netSavings: before.netSavings,
        opexOneOff: before.opexOneOff,
        opexRec: before.opexRec,
        capex: before.capex,
      }
    : patch;
  const after: SubLever = applyPlanLock({ ...before, ...safePatch });
  const nextSubLevers = [...subLevers];
  nextSubLevers[idx] = after;

  const auditEntries = [
    makeAuditEntry({
      user,
      action: "updated",
      entity: before.leverId,
      field: `sous-levier ${before.name}`,
      old: "",
      new: "modifié",
    }),
  ];

  const lever = levers.find((l) => l.id === before.leverId);
  const changedLever = lever ? recomputeLeverProgress(lever, nextSubLevers) : undefined;
  const nextLevers = changedLever
    ? levers.map((l) => (l.id === changedLever.id ? changedLever : l))
    : levers;

  return {
    subLevers: nextSubLevers,
    subLever: after,
    levers: nextLevers,
    changedLever,
    auditEntries,
  };
}

export type DeleteSubLeverResult = {
  subLevers: SubLever[];
  deletedId: string;
  levers: Lever[];
  changedLever?: Lever;
  auditEntries: AuditEntry[];
};

export function deleteSubLever(
  levers: Lever[],
  subLevers: SubLever[],
  id: string,
  user: string
): DeleteSubLeverResult {
  const target = subLevers.find((s) => s.id === id);
  if (!target) return { subLevers, deletedId: id, levers, auditEntries: [] };
  const nextSubLevers = subLevers.filter((s) => s.id !== id);

  const auditEntries = [
    makeAuditEntry({
      user,
      action: "updated",
      entity: target.leverId,
      field: "sous-levier",
      old: target.name,
      new: "supprimé",
    }),
  ];

  const lever = levers.find((l) => l.id === target.leverId);
  const changedLever = lever ? recomputeLeverProgress(lever, nextSubLevers) : undefined;
  const nextLevers = changedLever
    ? levers.map((l) => (l.id === changedLever.id ? changedLever : l))
    : levers;

  return {
    subLevers: nextSubLevers,
    deletedId: id,
    levers: nextLevers,
    changedLever,
    auditEntries,
  };
}

export type ActionScope = { leverId: string; subLeverId?: string };

export type ActionMutationResult = {
  levers: Lever[];
  subLevers: SubLever[];
  changedLever?: Lever;
  changedSubLever?: SubLever;
  action: LeverAction;
  auditEntries: AuditEntry[];
};

function readActions(levers: Lever[], subLevers: SubLever[], scope: ActionScope): LeverAction[] {
  if (scope.subLeverId) {
    return subLevers.find((s) => s.id === scope.subLeverId)?.actions ?? [];
  }
  return levers.find((l) => l.id === scope.leverId)?.actions ?? [];
}

/** Applique le nouveau tableau d'actions sur le lever/sous-levier ciblé par `scope`, puis
 * recalcule la progression du lever parent. Retourne toujours le lever/sous-levier touché
 * (même sans changement de progression) pour que l'appelant persiste le nouveau plan d'action. */
function writeActions(
  levers: Lever[],
  subLevers: SubLever[],
  scope: ActionScope,
  actions: LeverAction[]
): { levers: Lever[]; subLevers: SubLever[]; changedLever?: Lever; changedSubLever?: SubLever } {
  let nextLevers = levers;
  let nextSubLevers = subLevers;
  let changedSubLever: SubLever | undefined;

  if (scope.subLeverId) {
    const idx = subLevers.findIndex((s) => s.id === scope.subLeverId);
    if (idx === -1) throw new Error(`Sous-levier "${scope.subLeverId}" introuvable`);
    changedSubLever = { ...subLevers[idx], actions };
    nextSubLevers = [...subLevers];
    nextSubLevers[idx] = changedSubLever;
  } else {
    const idx = levers.findIndex((l) => l.id === scope.leverId);
    if (idx === -1) throw new Error(`Lever "${scope.leverId}" introuvable`);
    nextLevers = [...levers];
    nextLevers[idx] = { ...levers[idx], actions };
  }

  const lever = nextLevers.find((l) => l.id === scope.leverId);
  const recomputed = lever ? recomputeLeverProgress(lever, nextSubLevers) : undefined;
  const changedLever = recomputed
    ? recomputed
    : scope.subLeverId
      ? undefined
      : nextLevers.find((l) => l.id === scope.leverId);
  if (recomputed) {
    nextLevers = nextLevers.map((l) => (l.id === recomputed.id ? recomputed : l));
  }

  return { levers: nextLevers, subLevers: nextSubLevers, changedLever, changedSubLever };
}

export function createAction(
  levers: Lever[],
  subLevers: SubLever[],
  scope: ActionScope,
  input: Omit<LeverAction, "id">,
  user: string
): ActionMutationResult {
  const allIds = [
    ...levers.flatMap((l) => l.actions?.map((a) => a.id) ?? []),
    ...subLevers.flatMap((s) => s.actions.map((a) => a.id)),
  ];
  const action: LeverAction = { ...input, id: nextEntityId("AC", allIds) };
  const currentActions = readActions(levers, subLevers, scope);
  const result = writeActions(levers, subLevers, scope, [...currentActions, action]);

  const auditEntries = [
    makeAuditEntry({
      user,
      action: "created",
      entity: scope.subLeverId ?? scope.leverId,
      field: "action",
      old: "",
      new: action.name,
    }),
  ];

  return { ...result, action, auditEntries };
}

export function updateAction(
  levers: Lever[],
  subLevers: SubLever[],
  scope: ActionScope,
  actionId: string,
  patch: Partial<LeverAction>,
  user: string
): ActionMutationResult {
  const actions = readActions(levers, subLevers, scope);
  const idx = actions.findIndex((a) => a.id === actionId);
  if (idx === -1) throw new Error(`Action "${actionId}" introuvable`);
  const after = { ...actions[idx], ...patch };
  const nextActions = [...actions];
  nextActions[idx] = after;
  const result = writeActions(levers, subLevers, scope, nextActions);

  const auditEntries = [
    makeAuditEntry({
      user,
      action: "updated",
      entity: scope.subLeverId ?? scope.leverId,
      field: `action ${after.name}`,
      old: actions[idx].status,
      new: after.status,
    }),
  ];

  return { ...result, action: after, auditEntries };
}

export function deleteAction(
  levers: Lever[],
  subLevers: SubLever[],
  scope: ActionScope,
  actionId: string
): { levers: Lever[]; subLevers: SubLever[]; changedLever?: Lever; changedSubLever?: SubLever } {
  const actions = readActions(levers, subLevers, scope).filter((a) => a.id !== actionId);
  return writeActions(levers, subLevers, scope, actions);
}

export function applyCascadeShift(
  levers: Lever[],
  subLevers: SubLever[],
  shifts: CascadeShift[],
  user: string
): {
  levers: Lever[];
  subLevers: SubLever[];
  changedLevers: Lever[];
  changedSubLevers: SubLever[];
  auditEntries: AuditEntry[];
} {
  let curLevers = levers;
  let curSubLevers = subLevers;
  const changedLevers: Lever[] = [];
  const changedSubLevers: SubLever[] = [];
  const auditEntries: AuditEntry[] = [];

  shifts.forEach((shift) => {
    if (shift.kind === "lever") {
      const result = updateLever(
        curLevers,
        shift.id,
        { start: shift.newStart, end: shift.newEnd },
        user
      );
      curLevers = result.levers;
      changedLevers.push(result.lever);
      auditEntries.push(...result.auditEntries);
    } else {
      const result = updateSubLever(
        curLevers,
        curSubLevers,
        shift.id,
        { start: shift.newStart, end: shift.newEnd },
        user
      );
      curLevers = result.levers;
      curSubLevers = result.subLevers;
      changedSubLevers.push(result.subLever);
      if (result.changedLever) changedLevers.push(result.changedLever);
      auditEntries.push(...result.auditEntries);
    }
  });

  return {
    levers: curLevers,
    subLevers: curSubLevers,
    changedLevers,
    changedSubLevers,
    auditEntries,
  };
}

export function addComment(
  comments: Record<string, Comment[]>,
  leverId: string,
  text: string,
  user: string
): { comments: Record<string, Comment[]>; leverComments: Comment[]; auditEntry: AuditEntry } {
  const comment: Comment = { user, ts: nowDate(), text };
  const leverComments = [...(comments[leverId] ?? []), comment];
  const nextComments = { ...comments, [leverId]: leverComments };
  const auditEntry = makeAuditEntry({
    user,
    action: "commented",
    entity: leverId,
    field: "comment",
    old: "",
    new: text,
  });
  return { comments: nextComments, leverComments, auditEntry };
}
