import * as engine from "@/lib/engine";
import { consolidateLeverFromActions } from "@/lib/leverConsolidate";
import type { CascadeShift } from "@/lib/engine";
import { STATUS_ORDER } from "@/lib/status-config";
import type {
  AuditEntry,
  AuthUser,
  Comment,
  FinancialSnapshot,
  Lever,
  LeverAction,
  Role,
} from "@/types";

/**
 * Résout la liste des niveaux de confidentialité auxquels un utilisateur non-admin a accès,
 * en appliquant la précédence : habilitation INDIVIDUELLE (AuthUser.confidentialityClearance)
 * prioritaire quand définie, sinon repli sur l'habilitation de son rôle (Company.roleClearance).
 * Ne s'applique pas à admin/admin_entreprise (accès total, géré par l'appelant en amont).
 *  - user.confidentialityClearance === "all"  -> accès à tous les niveaux
 *  - user.confidentialityClearance: string[]  -> exactement cette liste (même vide = aucun accès)
 *  - user.confidentialityClearance === undefined -> repli sur roleClearance[user.role] (ou [])
 */
export function resolveConfidentialityClearance(
  user: Pick<AuthUser, "role" | "confidentialityClearance"> | null | undefined,
  roleClearance: Partial<Record<Role, string[]>> | undefined
): "all" | string[] {
  if (!user) return [];
  if (user.confidentialityClearance === "all") return "all";
  if (Array.isArray(user.confidentialityClearance)) return user.confidentialityClearance;
  return roleClearance?.[user.role] ?? [];
}

/** Un levier confidentiel est-il visible pour cette habilitation (résolue via
 * resolveConfidentialityClearance) ? Un niveau non défini sur le levier est toujours visible. */
export function isLeverVisibleForClearance(
  confidentialityLevel: string | undefined,
  clearance: "all" | string[]
): boolean {
  if (!confidentialityLevel) return true;
  if (clearance === "all") return true;
  return clearance.includes(confidentialityLevel);
}

export function canUserViewLever(
  user:
    Pick<AuthUser, "role" | "name" | "companyId" | "confidentialityClearance"> | null | undefined,
  lever: Pick<Lever, "owner" | "companyId" | "confidentialityLevel">,
  roleClearance: Partial<Record<Role, string[]>> | undefined
): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (lever.companyId != null && user.companyId !== lever.companyId) return false;
  if (user.role === "admin_entreprise") return true;
  if (user.role === "lever" && lever.owner !== user.name) return false;
  return isLeverVisibleForClearance(
    lever.confidentialityLevel,
    resolveConfidentialityClearance(user, roleClearance)
  );
}

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
 * localStorage (lib/storage.ts, supprimé depuis), mais sans I/O — prend l'état courant (levers) en
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

/** Recalcule le levier parent depuis son plan d'action : progression pondérée et agrégats
 * financiers/RH. Si le plan initial est déjà figé, les chiffres consolidés alimentent le
 * reforecast ; sinon ils alimentent directement les champs du levier. */
function recomputeLeverProgress(lever: Lever): Lever | undefined {
  const newProgress = engine.recomputeLeverProgress(lever);
  const consolidated = consolidateLeverFromActions(lever);
  const nextStatus =
    newProgress >= 100 && lever.status !== "cancelled" ? "delivered" : lever.status;
  const financialPatch: Partial<Lever> = consolidated
    ? lever.lockedPlan
      ? {
          reforecast: {
            grossSavings: consolidated.grossSavings ?? lever.grossSavings,
            netSavings: consolidated.netSavings ?? lever.netSavings,
            capex: consolidated.capex ?? lever.capex,
            opexOneOff: consolidated.opexOneOff ?? lever.opexOneOff,
            opexRec: consolidated.opexRec ?? lever.opexRec,
          },
          fteImpact: consolidated.fteImpact ?? lever.fteImpact,
        }
      : consolidated
    : {};
  const next: Lever = {
    ...lever,
    ...financialPatch,
    progress: newProgress,
    status: nextStatus,
    ...(nextStatus === "delivered" && !lever.deliveredDate ? { deliveredDate: nowDate() } : {}),
  };

  return JSON.stringify(next) === JSON.stringify(lever) ? undefined : next;
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

export type BulkLeverImportResult = {
  levers: Lever[];
  /** Un élément par levier du lot (créé ou mis à jour), déjà consolidé (plan d'action pris en
   *  compte) — ce qui doit être persisté tel quel en base. */
  changedLevers: Lever[];
  auditEntries: AuditEntry[];
  createdCount: number;
  updatedCount: number;
};

/**
 * Import Excel en masse (voir lib/leverExcelImport.ts) : crée/met à jour chaque levier par Code
 * (même règle que `upsertLeverByCode`), puis pose son plan d'action complet via `writeActions` —
 * qui recalcule la progression et consolide les agrégats financiers depuis les impacts, exactement
 * comme le ferait un utilisateur créant les actions une par une dans l'UI (voir
 * `recomputeLeverProgress`/`consolidateLeverFromActions`). Chaque levier du lot est traité
 * séquentiellement sur le même état accumulé, pour que les leviers plus haut dans le fichier
 * soient visibles (ex. comme cible de dépendance) aux suivants.
 */
export function bulkUpsertLeversByCode(
  levers: Lever[],
  inputs: Omit<Lever, "id" | "createdAt" | "lastUpdate">[],
  user: string
): BulkLeverImportResult {
  let curLevers = levers;
  const changedLevers: Lever[] = [];
  const auditEntries: AuditEntry[] = [];
  let createdCount = 0;
  let updatedCount = 0;

  for (const input of inputs) {
    // Le fichier d'import référence les dépendances par Code (colonne "Dépendances"), pas par id
    // Firestore (inconnu de l'auteur du fichier au moment de le remplir) — on résout ici contre
    // les leviers déjà upsertés dans CE lot + ceux déjà en base, avant écriture. Une dépendance
    // vers un levier qui n'apparaît que PLUS LOIN dans le même fichier reste non résolue (son id
    // n'est alloué qu'à son tour) : limitation documentée dans lib/leverExcelImport.ts.
    const resolvedDependencies = (input.dependencies ?? []).map((d) => {
      const target = curLevers.find((l) => l.code.toLowerCase() === d.targetId.toLowerCase());
      return target ? { ...d, targetId: target.id } : d;
    });
    const upsert = upsertLeverByCode(
      curLevers,
      { ...input, dependencies: resolvedDependencies },
      user
    );
    curLevers = upsert.levers;
    auditEntries.push(...upsert.auditEntries);
    if (upsert.created) createdCount++;
    else updatedCount++;

    const { levers: afterActions, changedLever } = writeActions(
      curLevers,
      { leverId: upsert.lever.id },
      input.actions ?? []
    );
    curLevers = afterActions;
    changedLevers.push(changedLever ?? upsert.lever);
  }

  return { levers: curLevers, changedLevers, auditEntries, createdCount, updatedCount };
}

export type ActionScope = { leverId: string };

export type ActionMutationResult = {
  levers: Lever[];
  changedLever?: Lever;
  action: LeverAction;
  auditEntries: AuditEntry[];
};

function readActions(levers: Lever[], scope: ActionScope): LeverAction[] {
  return levers.find((l) => l.id === scope.leverId)?.actions ?? [];
}

/** Applique le nouveau tableau d'actions sur le lever ciblé par `scope`, puis recalcule sa
 * progression. Retourne toujours le lever touché (même sans changement de progression) pour que
 * l'appelant persiste le nouveau plan d'action. Exportée (en plus de createAction/updateAction/
 * deleteAction, qui l'utilisent pour une seule action à la fois) pour `bulkUpsertLeversByCode`, qui
 * doit poser le plan d'action COMPLET d'un levier importé en une fois. */
export function writeActions(
  levers: Lever[],
  scope: ActionScope,
  actions: LeverAction[]
): { levers: Lever[]; changedLever?: Lever } {
  const idx = levers.findIndex((l) => l.id === scope.leverId);
  if (idx === -1) throw new Error(`Lever "${scope.leverId}" introuvable`);
  let nextLevers = [...levers];
  nextLevers[idx] = { ...levers[idx], actions };

  const lever = nextLevers[idx];
  const recomputed = recomputeLeverProgress(lever);
  const changedLever = recomputed ?? lever;
  if (recomputed) {
    nextLevers = nextLevers.map((l) => (l.id === recomputed.id ? recomputed : l));
  }

  return { levers: nextLevers, changedLever };
}

export function createAction(
  levers: Lever[],
  scope: ActionScope,
  input: Omit<LeverAction, "id">,
  user: string
): ActionMutationResult {
  const allIds = levers.flatMap((l) => l.actions?.map((a) => a.id) ?? []);
  const action: LeverAction = {
    ...input,
    id: nextEntityId("AC", allIds),
    ...(input.status === "done" && !input.deliveredDate ? { deliveredDate: nowDate() } : {}),
  };
  const currentActions = readActions(levers, scope);
  const result = writeActions(levers, scope, [...currentActions, action]);

  const auditEntries = [
    makeAuditEntry({
      user,
      action: "created",
      entity: scope.leverId,
      field: "action",
      old: "",
      new: action.name,
    }),
  ];

  return { ...result, action, auditEntries };
}

export function updateAction(
  levers: Lever[],
  scope: ActionScope,
  actionId: string,
  patch: Partial<LeverAction>,
  user: string
): ActionMutationResult {
  const actions = readActions(levers, scope);
  const idx = actions.findIndex((a) => a.id === actionId);
  if (idx === -1) throw new Error(`Action "${actionId}" introuvable`);
  const before = actions[idx];
  const deliveredDatePatch: Partial<LeverAction> =
    patch.status === "done" && before.status !== "done"
      ? { deliveredDate: patch.deliveredDate ?? nowDate() }
      : patch.status && patch.status !== "done"
        ? { deliveredDate: undefined }
        : {};
  const after = { ...before, ...patch, ...deliveredDatePatch };
  const nextActions = [...actions];
  nextActions[idx] = after;
  const result = writeActions(levers, scope, nextActions);

  const auditEntries = [
    makeAuditEntry({
      user,
      action: "updated",
      entity: scope.leverId,
      field: `action ${after.name}`,
      old: actions[idx].status,
      new: after.status,
    }),
  ];

  return { ...result, action: after, auditEntries };
}

export function deleteAction(
  levers: Lever[],
  scope: ActionScope,
  actionId: string
): { levers: Lever[]; changedLever?: Lever } {
  const actions = readActions(levers, scope).filter((a) => a.id !== actionId);
  return writeActions(levers, scope, actions);
}

export function applyCascadeShift(
  levers: Lever[],
  shifts: CascadeShift[],
  user: string
): {
  levers: Lever[];
  changedLevers: Lever[];
  auditEntries: AuditEntry[];
} {
  let curLevers = levers;
  const changedLevers: Lever[] = [];
  const auditEntries: AuditEntry[] = [];

  shifts.forEach((shift) => {
    const result = updateLever(
      curLevers,
      shift.id,
      { start: shift.newStart, end: shift.newEnd },
      user
    );
    curLevers = result.levers;
    changedLevers.push(result.lever);
    auditEntries.push(...result.auditEntries);
  });

  return { levers: curLevers, changedLevers, auditEntries };
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
