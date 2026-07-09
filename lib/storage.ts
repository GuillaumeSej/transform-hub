import { mockData } from "@/data/mockData";
import type {
  Alert,
  Department,
  Operations,
  ProductionLine,
  ProgramConfig,
  Scenario,
  Workforce,
  WorkforceMovement,
  Workstream,
} from "@/types";

/**
 * Couche de persistance localStorage pour tout ce qui n'est PAS le périmètre "leviers"
 * (program, workstreams, workforce, operations, alerts, scenarios). Les leviers/sous-leviers/
 * commentaires/audit vivent désormais dans Firestore — voir lib/firestore/levers.ts et
 * lib/leversLogic.ts — car c'est la donnée qui doit être partagée en temps réel entre
 * utilisateurs. mockData ne sert QUE de seed initial : une fois `initializeStorage()` exécuté,
 * toute lecture/écriture passe par ce fichier — jamais par un import direct de
 * `data/mockData.ts` ailleurs dans l'app.
 */

const KEYS = {
  initialized: "betrack_initialized",
  program: "betrack_program",
  workstreams: "betrack_workstreams",
  workforce: "betrack_workforce",
  operations: "betrack_operations",
  alerts: "betrack_alerts",
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
const SCHEMA_VERSION = "5";

// Anciennes clés localStorage du périmètre "leviers", devenu Firestore — nettoyées au passage
// pour ne pas laisser traîner de données orphelines dans le navigateur.
const LEGACY_LEVER_KEYS = [
  "betrack_levers",
  "betrack_sublevers",
  "betrack_audit_log",
  "betrack_comments",
];

export function initializeStorage(): void {
  if (!isBrowser()) return;
  if (window.localStorage.getItem(KEYS.initialized) === SCHEMA_VERSION) return;
  write(KEYS.program, mockData.program);
  write(KEYS.workstreams, mockData.workstreams);
  write(KEYS.workforce, mockData.workforce);
  write(KEYS.operations, mockData.operations);
  write(KEYS.alerts, mockData.alerts);
  write(KEYS.scenarios, mockData.scenarios);
  write(KEYS.activeScenario, mockData.activeScenario);
  LEGACY_LEVER_KEYS.forEach((k) => window.localStorage.removeItem(k));

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

export function getWorkforce(): Workforce {
  return read(KEYS.workforce, mockData.workforce);
}

export function getOperations(): Operations {
  return read(KEYS.operations, mockData.operations);
}

export function getAlerts(): Alert[] {
  return read(KEYS.alerts, mockData.alerts);
}

export function getScenarios(): Scenario[] {
  return read(KEYS.scenarios, mockData.scenarios);
}

export function getActiveScenario(): string {
  return read(KEYS.activeScenario, mockData.activeScenario);
}

// ---------- Setters ----------

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
  return after;
}

export function createWorkforceMovement(input: Omit<WorkforceMovement, "id">): WorkforceMovement {
  const workforce = getWorkforce();
  const maxNum = workforce.movements.reduce((max, m) => {
    const n = /^MV(\d+)$/.exec(m.id);
    return n ? Math.max(max, Number(n[1])) : max;
  }, 0);
  const movement: WorkforceMovement = { ...input, id: `MV${String(maxNum + 1).padStart(3, "0")}` };
  workforce.movements.push(movement);
  write(KEYS.workforce, workforce);
  return movement;
}

export function deleteWorkforceMovement(id: string): void {
  const workforce = getWorkforce();
  workforce.movements = workforce.movements.filter((m) => m.id !== id);
  write(KEYS.workforce, workforce);
}

export function updateDepartment(name: string, patch: Partial<Department>): Department {
  const workforce = getWorkforce();
  const idx = workforce.departments.findIndex((d) => d.name === name);
  if (idx === -1) throw new Error(`Département "${name}" introuvable`);
  const after = { ...workforce.departments[idx], ...patch };
  workforce.departments[idx] = after;
  write(KEYS.workforce, workforce);
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
}

export function setActiveScenario(scenarioId: string): void {
  write(KEYS.activeScenario, scenarioId);
}
