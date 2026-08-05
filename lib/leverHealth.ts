import type { Alert, Lever, Workstream } from "@/types";

/**
 * Statut de santé synthétique d'un levier — utilisé par le widget "Santé des initiatives"
 * (matrice type OD Monitoring, une tuile par levier colorée selon son état).
 *
 * Priorité descendante lors de la résolution (voir `leverHealth`) : `cancelled` court-circuite
 * tout (levier abandonné, hors trajectoire) ; sinon `critical` prime sur `watch` qui prime sur
 * `onTrack`. La typologie a été validée avec le pilote (Août 2026) et est distincte des types
 * d'alertes (`red`/`amber`/`green`/`blue`) : plusieurs alertes concourent au verdict, mêlées à
 * la sévérité de risque intrinsèque du levier.
 */
export type LeverHealthStatus = "onTrack" | "watch" | "critical" | "cancelled";

/**
 * Résout le statut de santé d'UN levier à partir de son statut, de son niveau de risque et de
 * ses alertes actives (non résolues). Fonction pure — aucune I/O, aucun couplage React.
 *
 * Règles :
 *  1. `lever.status === "cancelled"` → `cancelled` (prime sur tout le reste).
 *  2. Sinon, si le levier a une alerte non résolue de sévérité `red` OU `lever.risk` ∈
 *     {`"critical"`, `"high"`} → `critical`.
 *  3. Sinon, si le levier a une alerte non résolue de sévérité `amber` OU `lever.risk` ===
 *     `"medium"` → `watch`.
 *  4. Sinon → `onTrack`.
 *
 * Les alertes résolues (`alert.resolved === true`) sont ignorées : un levier remis sur les
 * rails ne doit pas rester "critique" à jamais parce qu'une alerte historique existe.
 */
export function leverHealth(lever: Lever, leverAlerts: Alert[]): LeverHealthStatus {
  if (lever.status === "cancelled") return "cancelled";
  const activeAlerts = leverAlerts.filter((a) => !a.resolved);
  const hasRed = activeAlerts.some((a) => a.type === "red");
  const hasAmber = activeAlerts.some((a) => a.type === "amber");
  const risk = lever.risk;
  if (hasRed || risk === "critical" || risk === "high") return "critical";
  if (hasAmber || risk === "medium") return "watch";
  return "onTrack";
}

/** Dimensions supportées par la matrice santé — pilotées par le sélecteur "Grouper par" du
 *  widget. Volontairement restreint (contrairement au builder générique de
 *  `lib/dashboardPivot.ts`) pour rester lisible dans une grille dense de tuiles. */
export type HealthDimension = "workstream" | "country" | "function";

export interface LeverHealthCell {
  lever: Lever;
  health: LeverHealthStatus;
}

export interface LeverHealthGroup {
  group: string;
  levers: LeverHealthCell[];
}

/** Résout le libellé humain d'un workstream (nom lisible), fallback sur l'id si l'entrée
 *  n'existe pas dans le référentiel. */
function workstreamLabel(id: string, workstreams: Workstream[]): string {
  return workstreams.find((w) => w.id === id)?.name ?? id;
}

/**
 * Groupe les leviers par valeur d'une dimension, en résolvant leur statut de santé via
 * `leverHealth`. Les alertes sont indexées par `scope` (id du levier) pour éviter un scan
 * quadratique. Ordre de sortie stable : nombre de leviers descendant, puis libellé
 * alphabétique. Les groupes vides sont exclus.
 *
 * Cette fonction est le point d'entrée unique du widget matrice — appelée depuis la page
 * dashboard sur `filteredLevers` déjà scopés par les filtres globaux. Le widget lui-même
 * n'agrège rien : il se contente de mapper le résultat vers une grille de tuiles.
 */
export function groupLeversByDimension(
  levers: Lever[],
  dimension: HealthDimension,
  alertsByLever: Map<string, Alert[]>,
  workstreams: Workstream[]
): LeverHealthGroup[] {
  const groups = new Map<string, LeverHealthCell[]>();

  for (const lever of levers) {
    const groupKey =
      dimension === "workstream"
        ? workstreamLabel(lever.ws, workstreams)
        : dimension === "country"
          ? lever.geography || "—"
          : lever.function || "—";
    const health = leverHealth(lever, alertsByLever.get(lever.id) ?? []);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push({ lever, health });
  }

  return Array.from(groups.entries())
    .map(([group, cells]) => ({ group, levers: cells }))
    .filter((g) => g.levers.length > 0)
    .sort((a, b) => {
      if (b.levers.length !== a.levers.length) return b.levers.length - a.levers.length;
      return a.group.localeCompare(b.group, "fr");
    });
}

/** Indexe une liste d'alertes par scope (id de levier). Utilitaire d'appelant, exporté pour
 *  qu'il soit testable et réutilisable (le widget appelle cette fonction une seule fois par
 *  rendu plutôt que de re-scan la liste pour chaque levier). */
export function indexAlertsByLever(alerts: Alert[]): Map<string, Alert[]> {
  const map = new Map<string, Alert[]>();
  for (const alert of alerts) {
    const list = map.get(alert.scope) ?? [];
    list.push(alert);
    map.set(alert.scope, list);
  }
  return map;
}

/** Compte les leviers par statut de santé sur une liste de groupes (pour la légende /
 *  compteurs affichés en actions du widget). */
export function countHealthStatuses(groups: LeverHealthGroup[]): Record<LeverHealthStatus, number> {
  const counts: Record<LeverHealthStatus, number> = {
    onTrack: 0,
    watch: 0,
    critical: 0,
    cancelled: 0,
  };
  for (const group of groups) {
    for (const cell of group.levers) {
      counts[cell.health] += 1;
    }
  }
  return counts;
}
