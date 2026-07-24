import { mockData } from "@/data/mockData";
import type { Alert, Operations, ProductionLine, ProgramConfig, Workstream } from "@/types";

/**
 * Couche de persistance localStorage pour tout ce qui n'est PAS partagé en temps réel
 * (program, workstreams, operations, alerts). Les leviers/sous-leviers/commentaires/
 * audit ET la base ETP (employees/movements/départements) vivent dans Firestore — voir
 * lib/firestore/levers.ts et lib/firestore/workforce.ts. mockData ne sert QUE de seed initial :
 * une fois `initializeStorage()` exécuté, toute lecture/écriture passe par ce fichier — jamais
 * par un import direct de `data/mockData.ts` ailleurs dans l'app.
 */

const KEYS = {
  initialized: "betrack_initialized",
  program: "betrack_program",
  workstreams: "betrack_workstreams",
  operations: "betrack_operations",
  alerts: "betrack_alerts",
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
const SCHEMA_VERSION = "7";

// Anciennes clés localStorage des périmètres migrés sur Firestore (leviers, puis workforce) —
// nettoyées au passage pour ne pas laisser traîner de données orphelines dans le navigateur.
const LEGACY_KEYS = [
  "betrack_levers",
  "betrack_sublevers",
  "betrack_audit_log",
  "betrack_comments",
  "betrack_workforce",
  "betrack_scenarios",
  "betrack_active_scenario",
];

export function initializeStorage(): void {
  if (!isBrowser()) return;
  if (window.localStorage.getItem(KEYS.initialized) === SCHEMA_VERSION) return;
  write(KEYS.program, mockData.program);
  write(KEYS.workstreams, mockData.workstreams);
  write(KEYS.operations, mockData.operations);
  write(KEYS.alerts, mockData.alerts);
  LEGACY_KEYS.forEach((k) => window.localStorage.removeItem(k));

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

export function getOperations(): Operations {
  return read(KEYS.operations, mockData.operations);
}

export function getAlerts(): Alert[] {
  return read(KEYS.alerts, mockData.alerts);
}

// ---------- Setters ----------

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
