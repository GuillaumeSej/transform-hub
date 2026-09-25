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

/** Santé synthétique d'un levier — SOURCE UNIQUE du risque (décisions audit C6) : le badge Risque
 *  (`computeLeverRisk` : montant cumulé / ancienneté des alertes rouges et orange OUVERTES, seuils
 *  de l'entreprise), le même que la bibliothèque et la fiche levier. Critique / Élevé → « Alertes
 *  critiques », Moyen → « À surveiller », Faible → « Dans les temps » — la couleur d'une alerte
 *  isolée ne suffit plus (une petite alerte rouge de 10 k€ laisse le levier « Faible »). Le KPI
 *  « Leviers à risque » en dérive (`leverHealthCounts`). `alerts` doit être la liste NON ciblée
 *  (`generateAlerts(data)`) : le risque d'un levier ne dépend pas de qui le regarde. */
export function computeLeverHealth(
  lever: Lever,
  alerts: Alert[],
  thresholds?: { level: RiskLevel; minAmount: number }[]
): LeverHealthCell {
  const activeAlerts = alerts.filter((alert) => alert.scope === lever.id && !alert.resolved);
  const computedRisk = computeLeverRisk(lever.id, activeAlerts, thresholds).level;

  let health: LeverHealthStatus = "onTrack";
  if (lever.status === "cancelled") {
    health = "cancelled";
  } else if (computedRisk === "critical" || computedRisk === "high") {
    health = "critical";
  } else if (computedRisk === "medium") {
    health = "watch";
  }

  return { lever, health, computedRisk, activeAlertCount: activeAlerts.length };
}

/** Répartition des leviers NON abandonnés par santé (`computeLeverHealth`) — KPI « Leviers à
 *  risque » du dashboard (= watch + critical) et compteurs de la page Chantiers. */
export function leverHealthCounts(
  levers: Lever[],
  alerts: Alert[],
  thresholds?: { level: RiskLevel; minAmount: number }[]
): { onTrack: number; watch: number; critical: number } {
  const counts = { onTrack: 0, watch: 0, critical: 0 };
  for (const lever of levers) {
    if (lever.status === "cancelled") continue;
    const { health } = computeLeverHealth(lever, alerts, thresholds);
    if (health !== "cancelled") counts[health] += 1;
  }
  return counts;
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
