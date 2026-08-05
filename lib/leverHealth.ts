import { computeLeverRisk } from "@/lib/engine";
import type { Alert, Lever, RiskLevel, Workstream } from "@/types";

export type LeverHealthStatus = "onTrack" | "watch" | "critical" | "cancelled";
export type LeverHealthDimension = "workstream" | "country" | "function";

export type LeverHealthCell = {
  lever: Lever;
  health: LeverHealthStatus;
  computedRisk: RiskLevel;
  activeAlertCount: number;
};

export type LeverHealthGroup = {
  key: string;
  label: string;
  cells: LeverHealthCell[];
};

/** Santé synthétique d'un levier, basée sur la source de vérité risque/alertes existante. */
export function computeLeverHealth(
  lever: Lever,
  alerts: Alert[],
  thresholds?: { level: RiskLevel; minAmount: number }[]
): LeverHealthCell {
  const activeAlerts = alerts.filter((alert) => alert.scope === lever.id && !alert.resolved);
  const riskAlerts = activeAlerts.filter((alert) => alert.type === "red" || alert.type === "amber");
  const computedRisk = computeLeverRisk(lever.id, riskAlerts, thresholds);

  let health: LeverHealthStatus = "onTrack";
  if (lever.status === "cancelled") {
    health = "cancelled";
  } else if (
    activeAlerts.some((alert) => alert.type === "red") ||
    computedRisk === "critical" ||
    computedRisk === "high"
  ) {
    health = "critical";
  } else if (activeAlerts.some((alert) => alert.type === "amber") || computedRisk === "medium") {
    health = "watch";
  }

  return { lever, health, computedRisk, activeAlertCount: activeAlerts.length };
}

/** Groupe les initiatives selon la dimension choisie dans l'instance du widget. */
export function groupLeversByHealthDimension(
  levers: Lever[],
  dimension: LeverHealthDimension,
  alerts: Alert[],
  workstreams: Workstream[],
  thresholds?: { level: RiskLevel; minAmount: number }[]
): LeverHealthGroup[] {
  const groups = new Map<string, LeverHealthGroup>();

  for (const lever of levers) {
    const key =
      dimension === "workstream"
        ? lever.ws || "unassigned"
        : dimension === "country"
          ? lever.country || "unassigned"
          : lever.function || "unassigned";
    const label =
      dimension === "workstream"
        ? workstreams.find((workstream) => workstream.id === lever.ws)?.name || lever.ws || "—"
        : key === "unassigned"
          ? "—"
          : key;
    const group = groups.get(key) ?? { key, label, cells: [] };
    group.cells.push(computeLeverHealth(lever, alerts, thresholds));
    groups.set(key, group);
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (b.cells.length !== a.cells.length) return b.cells.length - a.cells.length;
    return a.label.localeCompare(b.label, "fr");
  });
}
