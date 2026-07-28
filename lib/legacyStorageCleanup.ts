/**
 * Nettoyage des clés localStorage des périmètres métier migrés sur Firestore.
 *
 * Historique des migrations : leviers/sous-leviers/commentaires/audit d'abord, puis la base
 * ETP (workforce), et enfin program/workstreams/operations/alerts (dernier périmètre local,
 * voir lib/firestore/programConfig.ts). localStorage ne porte plus AUCUNE donnée métier —
 * seule la session utilisateur (betrack_user, géré par useRole) y reste, par design.
 *
 * À conserver quelques versions le temps que les navigateurs des utilisateurs existants
 * soient purgés, puis supprimable.
 */

const LEGACY_KEYS = [
  "betrack_initialized",
  "betrack_program",
  "betrack_workstreams",
  "betrack_operations",
  "betrack_alerts",
  "betrack_levers",
  "betrack_sublevers",
  "betrack_audit_log",
  "betrack_comments",
  "betrack_workforce",
  "betrack_scenarios",
  "betrack_active_scenario",
];

export function cleanupLegacyStorage(): void {
  if (typeof window === "undefined") return;
  try {
    LEGACY_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Stockage inaccessible (mode privé strict, quota) — sans conséquence : ces clés ne sont
    // plus jamais lues.
  }
}
