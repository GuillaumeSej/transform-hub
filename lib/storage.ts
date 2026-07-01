import { mockData } from "@/data/mockData";
import * as engine from "@/lib/engine";
import type { CascadeShift } from "@/lib/engine";
import type {
  Alert,
  AuditEntry,
  Comment,
  Lever,
  LeverAction,
  Operations,
  ProductionLine,
  ProgramConfig,
  Scenario,
  SubLever,
  Workforce,
  WorkforceMovement,
  Workstream,
} from "@/types";

/**
 * Couche de persistance localStorage. mockData ne sert QUE de seed initial : une fois
 * `initializeStorage()` exécuté, toute lecture/écriture passe par ce fichier — jamais par
 * un import direct de `data/mockData.ts` ailleurs dans l'app.
 *
 * TODO V2 — Remplacer localStorage par une vraie BDD.
 * Options envisagées : Supabase (SDK JS natif, rapide à démarrer), PocketBase (self-hosted,
 * API REST auto-générée), ou une API REST custom si contraintes IT BearingPoint imposent
 * un backend interne. Ce fichier est conçu comme une interface : seule l'implémentation
 * interne des getters/setters change en V2, aucune page/composant n'a besoin d'être modifié.
 */

const KEYS = {
  initialized: "betrack_initialized",
  program: "betrack_program",
  workstreams: "betrack_workstreams",
  levers: "betrack_levers",
  subLevers: "betrack_sublevers",
  workforce: "betrack_workforce",
  operations: "betrack_operations",
  alerts: "betrack_alerts",
  audit: "betrack_audit_log",
  comments: "betrack_comments",
  scenarios: "betrack_scenarios",
  activeScenario: "betrack_active_scenario",
} as const;

const isBrowser = () => typeof window !== "undefined";

function read<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`[betrack storage] échec d'écriture localStorage pour "${key}" :`, err);
  }
}

// Incrémenter cette valeur invalide tout cache existant (schéma de données modifié) et force
// un reseed propre depuis mockData — évite les crashs sur un localStorage d'une version antérieure.
const SCHEMA_VERSION = "4";

export function initializeStorage(): void {
  if (!isBrowser()) return;
  if (window.localStorage.getItem(KEYS.initialized) === SCHEMA_VERSION) return;
  write(KEYS.program, mockData.program);
  write(KEYS.workstreams, mockData.workstreams);
  write(KEYS.levers, mockData.levers);
  write(KEYS.subLevers, mockData.subLevers);
  write(KEYS.workforce, mockData.workforce);
  write(KEYS.operations, mockData.operations);
  write(KEYS.alerts, mockData.alerts);
  write(KEYS.audit, mockData.audit);
  write(KEYS.comments, mockData.comments);
  write(KEYS.scenarios, mockData.scenarios);
  write(KEYS.activeScenario, mockData.activeScenario);

  // Recalage initial : les leviers dotés de sous-leviers/actions doivent afficher une progression
  // dérivée du plan d'action dès le seed, pas la valeur manuelle héritée de mockData.
  mockData.levers
    .filter((l) => l.actions?.length || mockData.subLevers.some((s) => s.leverId === l.id))
    .forEach((l) => recomputeAndPersistLeverProgress(l.id));

  window.localStorage.setItem(KEYS.initialized, SCHEMA_VERSION);
}

export function resetToMockData(): void {
  if (!isBrowser()) return;
  Object.values(KEYS).forEach((k) => window.localStorage.removeItem(k));
  initializeStorage();
}

// ---------- Getters ----------

export function getProgram(): ProgramConfig {
  return read(KEYS.program, mockData.program);
}

export function getWorkstreams(): Workstream[] {
  return read(KEYS.workstreams, mockData.workstreams);
}

export function getLevers(): Lever[] {
  return read(KEYS.levers, mockData.levers);
}

export function getLeverById(id: string): Lever | undefined {
  return getLevers().find((l) => l.id === id);
}

export function getSubLevers(): SubLever[] {
  return read(KEYS.subLevers, mockData.subLevers);
}

export function getSubLeversForLever(leverId: string): SubLever[] {
  return getSubLevers().filter((s) => s.leverId === leverId);
}

export function getWorkforce(): Workforce {
  return read(KEYS.workforce, mockData.workforce);
}

export function getOperations(): Operations {
  return read(KEYS.operations, mockData.operations);
}

export function getAlerts(): Alert[] {
  return read(KEYS.alerts, mockData.alerts);
}

export function getAuditLog(): AuditEntry[] {
  return read(KEYS.audit, mockData.audit);
}

export function getAllComments(): Record<string, Comment[]> {
  return read(KEYS.comments, mockData.comments);
}

export function getComments(leverId: string): Comment[] {
  return getAllComments()[leverId] ?? [];
}

export function getScenarios(): Scenario[] {
  return read(KEYS.scenarios, mockData.scenarios);
}

export function getActiveScenario(): string {
  return read(KEYS.activeScenario, mockData.activeScenario);
}

// ---------- Audit ----------

export function addAuditEntry(entry: Omit<AuditEntry, "ts">): void {
  const log = getAuditLog();
  log.unshift({ ...entry, ts: new Date().toISOString().slice(0, 16).replace("T", " ") });
  write(KEYS.audit, log);
}

// ---------- Setters ----------

export function createLever(
  input: Omit<Lever, "id" | "createdAt" | "lastUpdate">,
  user = "Utilisateur démo"
): Lever {
  const levers = getLevers();
  const maxNum = levers.reduce((max, l) => {
    const m = /^L(\d+)$/.exec(l.id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  const id = `L${String(maxNum + 1).padStart(3, "0")}`;
  const now = new Date().toISOString().slice(0, 10);
  const lever: Lever = { ...input, id, createdAt: now, lastUpdate: now };
  write(KEYS.levers, [...levers, lever]);
  addAuditEntry({ user, action: "created", entity: id, field: "lever", old: "", new: lever.name });
  return lever;
}

export function updateLever(id: string, patch: Partial<Lever>, user = "Utilisateur démo"): Lever {
  const levers = getLevers();
  const idx = levers.findIndex((l) => l.id === id);
  if (idx === -1) throw new Error(`Lever "${id}" introuvable`);
  const before = levers[idx];
  const after: Lever = { ...before, ...patch, lastUpdate: new Date().toISOString().slice(0, 10) };
  levers[idx] = after;
  write(KEYS.levers, levers);

  (Object.keys(patch) as (keyof Lever)[]).forEach((field) => {
    if (before[field] !== after[field]) {
      addAuditEntry({
        user,
        action: "updated",
        entity: id,
        field: String(field),
        old: before[field] as string | number,
        new: after[field] as string | number,
      });
    }
  });

  return after;
}

/** Créé un levier si `code` est inconnu, sinon met à jour le levier existant portant ce code. */
export function upsertLeverByCode(
  input: Omit<Lever, "id" | "createdAt" | "lastUpdate">,
  user = "Utilisateur démo"
): { lever: Lever; created: boolean } {
  const existing = getLevers().find((l) => l.code === input.code);
  if (existing) {
    return { lever: updateLever(existing.id, input, user), created: false };
  }
  return { lever: createLever(input, user), created: true };
}

// ---------- Sous-leviers & plan d'action ----------

function nextEntityId(prefix: string, existingIds: string[]): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  const maxNum = existingIds.reduce((max, id) => {
    const m = pattern.exec(id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `${prefix}${String(maxNum + 1).padStart(3, "0")}`;
}

function patchLeverSilently(id: string, patch: Partial<Lever>): Lever {
  const levers = getLevers();
  const idx = levers.findIndex((l) => l.id === id);
  if (idx === -1) throw new Error(`Lever "${id}" introuvable`);
  const after = { ...levers[idx], ...patch };
  levers[idx] = after;
  write(KEYS.levers, levers);
  return after;
}

/** Recalcule et persiste `lever.progress` à partir du plan d'action / des sous-leviers — sans
 * entrée d'audit dédiée (dérivé automatiquement de la mutation qui vient de se produire). */
function recomputeAndPersistLeverProgress(leverId: string): void {
  const lever = getLeverById(leverId);
  if (!lever) return;
  const newProgress = engine.recomputeLeverProgress(lever, getSubLevers());
  if (newProgress !== lever.progress) {
    patchLeverSilently(leverId, {
      progress: newProgress,
      status: newProgress >= 100 && lever.status !== "cancelled" ? "delivered" : lever.status,
    });
  }
}

export function createSubLever(
  input: Omit<SubLever, "id">,
  user = "Utilisateur démo"
): SubLever {
  const subLevers = getSubLevers();
  const id = nextEntityId("SL", subLevers.map((s) => s.id));
  const subLever: SubLever = { ...input, id };
  write(KEYS.subLevers, [...subLevers, subLever]);
  addAuditEntry({
    user,
    action: "created",
    entity: subLever.leverId,
    field: "sous-levier",
    old: "",
    new: subLever.name,
  });
  recomputeAndPersistLeverProgress(subLever.leverId);
  return subLever;
}

export function updateSubLever(
  id: string,
  patch: Partial<SubLever>,
  user = "Utilisateur démo"
): SubLever {
  const subLevers = getSubLevers();
  const idx = subLevers.findIndex((s) => s.id === id);
  if (idx === -1) throw new Error(`Sous-levier "${id}" introuvable`);
  const before = subLevers[idx];
  const after: SubLever = { ...before, ...patch };
  subLevers[idx] = after;
  write(KEYS.subLevers, subLevers);
  addAuditEntry({
    user,
    action: "updated",
    entity: before.leverId,
    field: `sous-levier ${before.name}`,
    old: "",
    new: "modifié",
  });
  recomputeAndPersistLeverProgress(before.leverId);
  return after;
}

export function deleteSubLever(id: string, user = "Utilisateur démo"): void {
  const subLevers = getSubLevers();
  const target = subLevers.find((s) => s.id === id);
  if (!target) return;
  write(
    KEYS.subLevers,
    subLevers.filter((s) => s.id !== id)
  );
  addAuditEntry({
    user,
    action: "updated",
    entity: target.leverId,
    field: "sous-levier",
    old: target.name,
    new: "supprimé",
  });
  recomputeAndPersistLeverProgress(target.leverId);
}

type ActionScope = { leverId: string; subLeverId?: string };

function readActions(scope: ActionScope): LeverAction[] {
  if (scope.subLeverId) {
    return getSubLevers().find((s) => s.id === scope.subLeverId)?.actions ?? [];
  }
  return getLeverById(scope.leverId)?.actions ?? [];
}

function writeActions(scope: ActionScope, actions: LeverAction[]): void {
  if (scope.subLeverId) {
    const subLevers = getSubLevers();
    const idx = subLevers.findIndex((s) => s.id === scope.subLeverId);
    if (idx === -1) throw new Error(`Sous-levier "${scope.subLeverId}" introuvable`);
    subLevers[idx] = { ...subLevers[idx], actions };
    write(KEYS.subLevers, subLevers);
  } else {
    patchLeverSilently(scope.leverId, { actions });
  }
  recomputeAndPersistLeverProgress(scope.leverId);
}

export function createAction(
  scope: ActionScope,
  input: Omit<LeverAction, "id">,
  user = "Utilisateur démo"
): LeverAction {
  const allIds = [
    ...getLevers().flatMap((l) => l.actions?.map((a) => a.id) ?? []),
    ...getSubLevers().flatMap((s) => s.actions.map((a) => a.id)),
  ];
  const action: LeverAction = { ...input, id: nextEntityId("AC", allIds) };
  writeActions(scope, [...readActions(scope), action]);
  addAuditEntry({
    user,
    action: "created",
    entity: scope.subLeverId ?? scope.leverId,
    field: "action",
    old: "",
    new: action.name,
  });
  return action;
}

export function updateAction(
  scope: ActionScope,
  actionId: string,
  patch: Partial<LeverAction>,
  user = "Utilisateur démo"
): LeverAction {
  const actions = readActions(scope);
  const idx = actions.findIndex((a) => a.id === actionId);
  if (idx === -1) throw new Error(`Action "${actionId}" introuvable`);
  const after = { ...actions[idx], ...patch };
  const next = [...actions];
  next[idx] = after;
  writeActions(scope, next);
  addAuditEntry({
    user,
    action: "updated",
    entity: scope.subLeverId ?? scope.leverId,
    field: `action ${after.name}`,
    old: actions[idx].status,
    new: after.status,
  });
  return after;
}

export function deleteAction(scope: ActionScope, actionId: string): void {
  writeActions(
    scope,
    readActions(scope).filter((a) => a.id !== actionId)
  );
}

// ---------- Dépendances & cascade de retard ----------

export function applyCascadeShift(shifts: CascadeShift[], user = "Utilisateur démo"): void {
  shifts.forEach((shift) => {
    if (shift.kind === "lever") {
      updateLever(shift.id, { start: shift.newStart, end: shift.newEnd }, user);
    } else {
      updateSubLever(shift.id, { start: shift.newStart, end: shift.newEnd }, user);
    }
  });
}

export function addComment(leverId: string, text: string, user = "Utilisateur démo"): Comment[] {
  const all = read<Record<string, Comment[]>>(KEYS.comments, mockData.comments);
  const comment: Comment = { user, ts: new Date().toISOString().slice(0, 10), text };
  all[leverId] = [...(all[leverId] ?? []), comment];
  write(KEYS.comments, all);
  addAuditEntry({
    user,
    action: "commented",
    entity: leverId,
    field: "comment",
    old: "",
    new: text,
  });
  return all[leverId];
}

export function updateWorkforceMovement(
  id: string,
  patch: Partial<WorkforceMovement>
): WorkforceMovement {
  const workforce = getWorkforce();
  const idx = workforce.movements.findIndex((m) => m.id === id);
  if (idx === -1) throw new Error(`Movement "${id}" introuvable`);
  const before = workforce.movements[idx];
  const after = { ...before, ...patch };
  workforce.movements[idx] = after;
  write(KEYS.workforce, workforce);
  addAuditEntry({
    user: "Utilisateur démo",
    action: "updated",
    entity: id,
    field: "movement",
    old: before.status,
    new: after.status,
  });
  return after;
}

export function updateProductionLine(id: string, patch: Partial<ProductionLine>): ProductionLine {
  const operations = getOperations();
  const idx = operations.lines.findIndex((l) => l.id === id);
  if (idx === -1) throw new Error(`Ligne "${id}" introuvable`);
  const before = operations.lines[idx];
  const after = { ...before, ...patch };
  operations.lines[idx] = after;
  write(KEYS.operations, operations);
  return after;
}

export function resolveAlert(alertId: string): void {
  const alerts = getAlerts().filter((a) => a.id !== alertId);
  write(KEYS.alerts, alerts);
  addAuditEntry({
    user: "Utilisateur démo",
    action: "updated",
    entity: alertId,
    field: "alert",
    old: "active",
    new: "resolved",
  });
}

export function setActiveScenario(scenarioId: string): void {
  write(KEYS.activeScenario, scenarioId);
}
