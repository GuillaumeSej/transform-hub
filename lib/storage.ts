import { mockData } from "@/data/mockData";
import type {
  Alert,
  AuditEntry,
  Comment,
  Lever,
  Operations,
  ProductionLine,
  ProgramConfig,
  Scenario,
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
const SCHEMA_VERSION = "2";

export function initializeStorage(): void {
  if (!isBrowser()) return;
  if (window.localStorage.getItem(KEYS.initialized) === SCHEMA_VERSION) return;
  write(KEYS.program, mockData.program);
  write(KEYS.workstreams, mockData.workstreams);
  write(KEYS.levers, mockData.levers);
  write(KEYS.workforce, mockData.workforce);
  write(KEYS.operations, mockData.operations);
  write(KEYS.alerts, mockData.alerts);
  write(KEYS.audit, mockData.audit);
  write(KEYS.comments, mockData.comments);
  write(KEYS.scenarios, mockData.scenarios);
  write(KEYS.activeScenario, mockData.activeScenario);
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
