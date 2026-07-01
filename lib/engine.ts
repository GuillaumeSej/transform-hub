import type {
  ActionStatus,
  BeTrackData,
  Lever,
  LeverAction,
  ProgramSummary,
  RiskLevel,
  SubLever,
  WorkstreamSummary,
} from "@/types";
import { addDays, daysBetween } from "@/lib/dateUtils";

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

export function realizedFte(lever: Lever): number {
  if (lever.status === "cancelled") return 0;
  return Math.round(lever.fteImpact * (lever.progress / 100) * 10) / 10;
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

// ---------- Sous-leviers, plan d'action, rollup de progression ----------

const ACTION_STATUS_WEIGHT: Record<ActionStatus, number> = {
  done: 100,
  in_progress: 50,
  todo: 0,
  delayed: 0,
};

/** Progression d'un plan d'action : moyenne pondérée par statut des actions (done=100, in_progress=50). */
export function actionProgress(actions: LeverAction[]): number {
  if (actions.length === 0) return 0;
  const total = actions.reduce((s, a) => s + ACTION_STATUS_WEIGHT[a.status], 0);
  return Math.round(total / actions.length);
}

export function subLeverProgress(subLever: SubLever): number {
  return actionProgress(subLever.actions);
}

/**
 * Progression d'un levier : si des sous-leviers existent, moyenne de leur progression pondérée par
 * leur poids financier (|netSavings|) ; sinon, si le levier a son propre plan d'action, la
 * progression de ce plan ; sinon, la valeur manuelle existante (levier à impact unique, inchangé).
 */
export function recomputeLeverProgress(lever: Lever, subLevers: SubLever[]): number {
  const mySubLevers = subLevers.filter((s) => s.leverId === lever.id);
  if (mySubLevers.length > 0) {
    const totalWeight = mySubLevers.reduce((s, sl) => s + Math.abs(sl.netSavings), 0);
    if (totalWeight === 0) {
      return Math.round(
        mySubLevers.reduce((s, sl) => s + subLeverProgress(sl), 0) / mySubLevers.length
      );
    }
    return Math.round(
      mySubLevers.reduce((s, sl) => s + subLeverProgress(sl) * Math.abs(sl.netSavings), 0) /
        totalWeight
    );
  }
  if (lever.actions && lever.actions.length > 0) {
    return actionProgress(lever.actions);
  }
  return lever.progress;
}

// ---------- Dépendances & cascade de retard ----------

type ScheduleEntity = {
  id: string;
  kind: "lever" | "subLever";
  name: string;
  start: string;
  end: string;
  dependencies: string[];
};

function toScheduleEntities(data: BeTrackData): ScheduleEntity[] {
  const leverEntities: ScheduleEntity[] = data.levers.map((l) => ({
    id: l.id,
    kind: "lever",
    name: l.name,
    start: l.start,
    end: l.end,
    dependencies: l.dependencies,
  }));
  const subEntities: ScheduleEntity[] = data.subLevers.map((s) => ({
    id: s.id,
    kind: "subLever",
    name: s.name,
    start: s.start,
    end: s.end,
    dependencies: s.dependencies,
  }));
  return [...leverEntities, ...subEntities];
}

export type CascadeShift = {
  id: string;
  kind: "lever" | "subLever";
  name: string;
  oldStart: string;
  oldEnd: string;
  newStart: string;
  newEnd: string;
};

/**
 * Calcule (sans rien muter) le décalage à proposer sur les entités dépendantes (leviers et
 * sous-leviers confondus) quand `entityId` glisse de `oldEnd` à `newEnd`. Décalage rigide : même
 * delta de jours appliqué en cascade transitive, avec garde-fou anti-cycle.
 */
export function computeCascadeShift(
  entityId: string,
  oldEnd: string,
  newEnd: string,
  data: BeTrackData
): CascadeShift[] {
  const deltaDays = daysBetween(oldEnd, newEnd);
  if (deltaDays <= 0) return [];

  const entities = toScheduleEntities(data);
  const shifts: CascadeShift[] = [];
  const visited = new Set<string>([entityId]);
  let frontier = [entityId];

  while (frontier.length > 0) {
    const nextFrontier: string[] = [];
    for (const currentId of frontier) {
      const dependents = entities.filter(
        (e) => e.dependencies.includes(currentId) && !visited.has(e.id)
      );
      for (const dep of dependents) {
        visited.add(dep.id);
        shifts.push({
          id: dep.id,
          kind: dep.kind,
          name: dep.name,
          oldStart: dep.start,
          oldEnd: dep.end,
          newStart: addDays(dep.start, deltaDays),
          newEnd: addDays(dep.end, deltaDays),
        });
        nextFrontier.push(dep.id);
      }
    }
    frontier = nextFrontier;
  }

  return shifts;
}
