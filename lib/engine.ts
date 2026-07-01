import type { BeTrackData, Lever, ProgramSummary, RiskLevel, WorkstreamSummary } from "@/types";

/**
 * Portage fidèle du moteur de calcul `ENGINE` du prototype de Guillaume (legacy/index.html).
 * Fonctions pures : prennent les données en paramètre plutôt que de lire un état global mutable.
 */

// Date de référence du scénario démo (le programme se termine le 2026-12-31) — figée pour rendre
// underperformers() déterministe, comme dans le prototype d'origine.
const DEMO_NOW = new Date("2026-06-22").getTime();

export function modSavings(lever: Lever, data: BeTrackData): number {
  const sc = data.scenarios.find((s) => s.id === data.activeScenario);
  if (!sc) return lever.netSavings;
  let v = lever.netSavings;
  if (sc.modifiers.savingsMultiplier) v *= sc.modifiers.savingsMultiplier;
  return Math.round(v * 100) / 100;
}

export function realizedSavings(lever: Lever, data: BeTrackData): number {
  if (lever.status === "cancelled") return 0;
  return Math.round(modSavings(lever, data) * (lever.progress / 100) * 100) / 100;
}

export function worstRisk(levers: Lever[]): RiskLevel {
  const order: Record<RiskLevel, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  return levers.reduce<RiskLevel>((w, l) => (order[l.risk] > order[w] ? l.risk : w), "low");
}

export function programSummary(data: BeTrackData): ProgramSummary {
  const active = data.levers.filter((l) => l.status !== "cancelled");
  const target = active.reduce((s, l) => s + l.netSavings, 0);
  const realized = active.reduce((s, l) => s + realizedSavings(l, data), 0);
  const capex = active.reduce((s, l) => s + l.capex, 0);
  const opex = active.reduce((s, l) => s + l.opexOneOff + l.opexRec, 0);
  const fteImpact = active.reduce((s, l) => s + l.fteImpact, 0);
  const popImpacted = active.reduce((s, l) => s + l.popImpacted, 0);
  return {
    target: Math.round(target * 10) / 10,
    realized: Math.round(realized * 10) / 10,
    progressPct: target > 0 ? Math.round((realized / target) * 100) : 0,
    capex: Math.round(capex * 10) / 10,
    opex: Math.round(opex * 10) / 10,
    fteImpact,
    popImpacted,
    leverCount: active.length,
    onTrack: active.filter((l) => l.risk === "low").length,
    atRisk: active.filter((l) => l.risk === "medium" || l.risk === "high").length,
    critical: active.filter((l) => l.risk === "critical").length,
    delivered: data.levers.filter((l) => l.status === "delivered").length,
  };
}

export function workstreamSummary(data: BeTrackData, wsId: string): WorkstreamSummary {
  const levers = data.levers.filter((l) => l.ws === wsId && l.status !== "cancelled");
  const target = levers.reduce((s, l) => s + l.netSavings, 0);
  const realized = levers.reduce((s, l) => s + realizedSavings(l, data), 0);
  const capex = levers.reduce((s, l) => s + l.capex, 0);
  const opex = levers.reduce((s, l) => s + l.opexOneOff + l.opexRec, 0);
  return {
    target: Math.round(target * 10) / 10,
    realized: Math.round(realized * 10) / 10,
    progressPct: target > 0 ? Math.round((realized / target) * 100) : 0,
    capex: Math.round(capex * 10) / 10,
    opex: Math.round(opex * 10) / 10,
    leverCount: levers.length,
    avgProgress: Math.round(
      levers.reduce((s, l) => s + l.progress, 0) / Math.max(1, levers.length)
    ),
    worstRisk: levers.length ? worstRisk(levers) : "low",
  };
}

export function sCurve(data: BeTrackData) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const target = data.levers
    .filter((l) => l.status !== "cancelled")
    .reduce((s, l) => s + l.netSavings, 0);
  const plannedCurve = [0.05, 0.1, 0.18, 0.28, 0.4, 0.52, 0.62, 0.72, 0.81, 0.88, 0.94, 1.0];
  const actualCurve = [0.04, 0.09, 0.15, 0.24, 0.34, 0.44, 0.53, 0.62, 0.71, null, null, null];
  return months.map((label, i) => ({
    month: label,
    planned: Math.round(plannedCurve[i] * target * 10) / 10,
    actual:
      actualCurve[i] === null ? null : Math.round((actualCurve[i] as number) * target * 10) / 10,
  }));
}

export function pnlImpact(data: BeTrackData): Record<string, number> {
  const map: Record<string, number> = {};
  data.levers
    .filter((l) => l.status !== "cancelled")
    .forEach((l) => {
      map[l.pnlMap] = (map[l.pnlMap] || 0) + realizedSavings(l, data);
    });
  return map;
}

export function byGeo(data: BeTrackData): Record<string, number> {
  const map: Record<string, number> = {};
  data.levers
    .filter((l) => l.status !== "cancelled")
    .forEach((l) => {
      map[l.geography] = (map[l.geography] || 0) + realizedSavings(l, data);
    });
  return map;
}

export function byFunction(data: BeTrackData): Record<string, number> {
  const map: Record<string, number> = {};
  data.levers
    .filter((l) => l.status !== "cancelled")
    .forEach((l) => {
      map[l.function] = (map[l.function] || 0) + realizedSavings(l, data);
    });
  return map;
}

export function underperformers(data: BeTrackData, wsId?: string) {
  return data.levers
    .filter((l) => (!wsId || l.ws === wsId) && l.status === "in_progress")
    .map((l) => {
      const start = new Date(l.start).getTime();
      const end = new Date(l.end).getTime();
      const expectedProgress = Math.min(
        100,
        Math.max(0, Math.round(((DEMO_NOW - start) / (end - start)) * 100))
      );
      return { ...l, expectedProgress, gap: expectedProgress - l.progress };
    })
    .filter((x) => x.gap > 10)
    .sort((a, b) => b.gap - a.gap);
}

export function fmtCurr(v: number | null | undefined, dec = 1): string {
  if (v === null || v === undefined) return "—";
  const abs = Math.abs(v);
  if (abs >= 1) return `€${v.toFixed(dec)}M`;
  return `€${(v * 1000).toFixed(0)}K`;
}

export function fmtPct(v: number): string {
  return `${Math.round(v)}%`;
}

export function fmtInt(v: number): string {
  return v.toLocaleString("fr-FR");
}
