import type {
  ActionStatus,
  BestPracticeRule,
  BeTrackData,
  DependencyType,
  Lever,
  LeverAction,
  LeverDependency,
  ProgramSummary,
  Project,
  RiskLevel,
  SubLever,
  WorkstreamSummary,
} from "@/types";
import { addDays, daysBetween } from "@/lib/dateUtils";
import { STATUS_CYCLE, STATUS_LEVEL, STATUS_SHORT_LABEL } from "@/lib/status-config";
import type { LeverStatus } from "@/types";

/**
 * Portage fidèle du moteur de calcul `ENGINE` du prototype de Guillaume (legacy/index.html).
 * Fonctions pures : prennent les données en paramètre plutôt que de lire un état global mutable.
 */

// Date de référence courante — utilisée par underperformers() pour calculer l'avancement attendu.
const DEMO_NOW = Date.now();

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

export function byCountry(data: BeTrackData): Record<string, number> {
  const map: Record<string, number> = {};
  data.levers
    .filter((l) => l.status !== "cancelled")
    .forEach((l) => {
      map[l.country] = (map[l.country] || 0) + realizedSavings(l, data);
    });
  return map;
}

/** Répartition des savings par projet (Lever.projectId) — pendant de `workstreamSummary` mais
 * pour la dimension "projet" plutôt que "workstream". Les leviers sans projet assigné sont
 * regroupés sous "Non assigné" plutôt qu'exclus, pour que le total reste cohérent avec les autres
 * vues. */
export function byProject(data: BeTrackData, projects: Project[]): Record<string, number> {
  const map: Record<string, number> = {};
  data.levers
    .filter((l) => l.status !== "cancelled")
    .forEach((l) => {
      const label = projects.find((p) => p.id === l.projectId)?.name ?? "Non assigné";
      map[label] = (map[label] || 0) + realizedSavings(l, data);
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

/**
 * Contrôle de couverture "bonnes pratiques" : pour chaque règle active, vérifie si au moins un
 * levier non-annulé répond à TOUS ses critères définis (matchFunction/matchWorkstreamId/
 * matchType). Distinct de `underperformers`/`dependencyAlerts` : ceux-ci détectent un problème
 * sur un levier existant, alors qu'ici on détecte l'ABSENCE de levier dans une catégorie censée
 * être couverte. Fonction pure — ne filtre pas elle-même les manquements : c'est à l'appelant de
 * ne garder que `!hasMatch` s'il ne veut afficher que les manquements.
 */
export function bestPracticeGaps(
  data: BeTrackData,
  rules: BestPracticeRule[]
): { rule: BestPracticeRule; hasMatch: boolean }[] {
  const activeLevers = data.levers.filter((l) => l.status !== "cancelled");
  return rules
    .filter((r) => r.active)
    .map((rule) => {
      const hasMatch = activeLevers.some((l) => {
        if (rule.matchFunction && l.function !== rule.matchFunction) return false;
        if (rule.matchWorkstreamId && l.ws !== rule.matchWorkstreamId) return false;
        if (rule.matchType && l.type !== rule.matchType) return false;
        return true;
      });
      return { rule, hasMatch };
    });
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
  dependencies: LeverDependency[];
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

export type CascadeResult = {
  /** Décalages proposés — sous-leviers uniquement (jamais appliqués sans confirmation). */
  shifts: CascadeShift[];
  /** Leviers dépendants touchés par le retard : alertés, mais leurs dates ne sont JAMAIS
   * modifiées automatiquement (décision inter-leviers = décision métier, hors outil). */
  impactedLevers: { id: string; name: string; dependencyType: DependencyType }[];
};

/**
 * Calcule (sans rien muter) l'impact d'un glissement de `oldEnd` à `newEnd` sur `entityId` :
 * décalage rigide proposé en cascade transitive sur les SOUS-LEVIERS dépendants (même delta de
 * jours, garde-fou anti-cycle), et simple liste d'alerte pour les LEVIERS dépendants.
 */
export function computeCascadeShift(
  entityId: string,
  oldEnd: string,
  newEnd: string,
  data: BeTrackData
): CascadeResult {
  const deltaDays = daysBetween(oldEnd, newEnd);
  if (deltaDays <= 0) return { shifts: [], impactedLevers: [] };

  const entities = toScheduleEntities(data);
  const shifts: CascadeShift[] = [];
  const impactedLevers: CascadeResult["impactedLevers"] = [];
  const visited = new Set<string>([entityId]);
  let frontier = [entityId];

  while (frontier.length > 0) {
    const nextFrontier: string[] = [];
    for (const currentId of frontier) {
      const dependents = entities.filter(
        (e) => e.dependencies.some((d) => d.targetId === currentId) && !visited.has(e.id)
      );
      for (const dep of dependents) {
        visited.add(dep.id);
        if (dep.kind === "lever") {
          const link = dep.dependencies.find((d) => d.targetId === currentId);
          impactedLevers.push({ id: dep.id, name: dep.name, dependencyType: link?.type ?? "FS" });
          // On n'étend pas la cascade au-delà d'un levier : ses dates ne bougent pas, donc ses
          // propres dépendants ne glissent pas non plus.
          continue;
        }
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

  return { shifts, impactedLevers };
}

// ---------- Alertes de dépendances inter-leviers ----------

export type DependencyAlert = {
  sourceId: string;
  sourceName: string;
  sourceKind: "lever" | "subLever";
  targetId: string;
  targetName: string;
  type: DependencyType;
  message: string;
};

/** Tolérance (jours) pour les contraintes de simultanéité SS / FF. */
const SIMULTANEITY_TOLERANCE_DAYS = 7;

/**
 * Évalue toutes les dépendances (leviers et sous-leviers) contre les dates actuelles et retourne
 * les contraintes violées. Aucune date n'est modifiée : c'est du signalement pur, à afficher en
 * alerte dans la bibliothèque et sur les fiches leviers.
 */
export function dependencyAlerts(data: BeTrackData): DependencyAlert[] {
  const entities = toScheduleEntities(data);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const alerts: DependencyAlert[] = [];

  for (const source of entities) {
    for (const dep of source.dependencies) {
      const target = byId.get(dep.targetId);
      if (!target) continue;

      let violated = false;
      let message = "";
      switch (dep.type) {
        case "FS":
          violated = target.end > source.start;
          message = `"${target.name}" se termine le ${target.end}, après le début prévu (${source.start})`;
          break;
        case "SS":
          violated =
            Math.abs(daysBetween(target.start, source.start)) > SIMULTANEITY_TOLERANCE_DAYS;
          message = `Débuts désynchronisés : ${target.start} vs ${source.start} (tolérance ${SIMULTANEITY_TOLERANCE_DAYS} j)`;
          break;
        case "FF":
          violated = Math.abs(daysBetween(target.end, source.end)) > SIMULTANEITY_TOLERANCE_DAYS;
          message = `Fins désynchronisées : ${target.end} vs ${source.end} (tolérance ${SIMULTANEITY_TOLERANCE_DAYS} j)`;
          break;
        case "SF":
          violated = target.start > source.end;
          message = `"${target.name}" démarre le ${target.start}, après la fin prévue (${source.end})`;
          break;
      }

      if (violated) {
        alerts.push({
          sourceId: source.id,
          sourceName: source.name,
          sourceKind: source.kind,
          targetId: target.id,
          targetName: target.name,
          type: dep.type,
          message,
        });
      }
    }
  }

  return alerts;
}

// ---------- Avancement du cycle de vie, Sankey, S-curve 3 courbes, Marimekko, waterfall trimestriel ----------

export type StageCount = { status: LeverStatus; level: string; label: string; count: number };

/** Nombre de leviers par étape du cycle de vie (+ Annulé, hors cycle), pour le bandeau
 * d'avancement et le diagramme Sankey de l'Executive Dashboard. Fonction pure sans contexte
 * entreprise : utilise les libellés par défaut (STATUS_LEVEL/STATUS_SHORT_LABEL), pas le
 * référentiel personnalisé — voir `useLifecycleLabels` pour les vues user-facing. */
export function stageCounts(data: BeTrackData): StageCount[] {
  const statuses: LeverStatus[] = [...STATUS_CYCLE, "cancelled"];
  return statuses.map((status) => ({
    status,
    level: STATUS_LEVEL[status],
    label: STATUS_SHORT_LABEL[status],
    count: data.levers.filter((l) => l.status === status).length,
  }));
}

/** Flux Sankey "tous les leviers" -> étape atteinte (L1..L5, + Annulé) : un seul niveau de liens
 * suffit puisque chaque levier a une étape courante unique (pas d'historique de transition). */
export function sankeyData(data: BeTrackData) {
  const counts = stageCounts(data);
  const nodes = [{ name: "Tous les leviers" }, ...counts.map((c) => ({ name: c.label }))];
  const links = counts
    .filter((c) => c.count > 0)
    .map((c) => ({
      source: 0,
      target: nodes.findIndex((n) => n.name === c.label),
      value: c.count,
    }));
  return { nodes, links };
}

export type SankeyChronoNode = { name: string };
export type SankeyChronoLink = { source: number; target: number; value: number };

/**
 * Sankey chronologique : montre à quelle étape chaque levier a été "abandonné" (annulé ou encore
 * en cours). Les leviers actifs (non annulés) coulent jusqu'à leur étape actuelle. Les leviers
 * annulés (cancelled) s'écoulent à l'étape où ils se trouvaient avant annulation, créant un flux
 * de "sortie" à chaque niveau.
 *
 * Structure de flux :
 *   Tous → [L1] → [L2] → [L3] → [L4] → [L5 Réalisé]
 *         ↘ out  ↘ out  ↘ out  ↘ out
 *
 * Chaque "out" représente les leviers qui ne progressent pas au-delà de cette étape.
 */
export function sankeyChronology(data: BeTrackData): {
  nodes: SankeyChronoNode[];
  links: SankeyChronoLink[];
} {
  const nodes: SankeyChronoNode[] = [{ name: "Tous les leviers" }];

  STATUS_CYCLE.forEach((status) => {
    nodes.push({ name: STATUS_SHORT_LABEL[status] });
  });

  STATUS_CYCLE.forEach((status) => {
    nodes.push({ name: `Annulé après ${STATUS_SHORT_LABEL[status]}` });
  });

  nodes.push({ name: "Réalisé" });

  const activeByStage = new Map<LeverStatus, number>();
  STATUS_CYCLE.forEach((s) => activeByStage.set(s, 0));
  data.levers
    .filter((l) => l.status !== "cancelled")
    .forEach((l) => {
      activeByStage.set(l.status, (activeByStage.get(l.status) ?? 0) + 1);
    });

  const cancelledByStageIdx = new Map<number, number>();
  STATUS_CYCLE.forEach((_, i) => cancelledByStageIdx.set(i, 0));
  data.levers
    .filter((l) => l.status === "cancelled")
    .forEach((l) => {
      // Étape quittée à l'annulation : lue directement depuis `cancelledAtStage` quand disponible
      // (levers annulés depuis ce correctif) ; repli sur l'ancienne heuristique par `progress` pour
      // les leviers legacy annulés avant que le champ n'existe.
      let stageIdx: number;
      const cancelledStageCycleIdx = l.cancelledAtStage
        ? STATUS_CYCLE.indexOf(l.cancelledAtStage)
        : -1;
      if (cancelledStageCycleIdx !== -1) {
        stageIdx = cancelledStageCycleIdx;
      } else {
        const p = l.progress;
        if (p <= 10) stageIdx = 0;
        else if (p <= 30) stageIdx = 1;
        else if (p <= 55) stageIdx = 2;
        else if (p <= 80) stageIdx = 3;
        else stageIdx = 4;
      }
      cancelledByStageIdx.set(stageIdx, (cancelledByStageIdx.get(stageIdx) ?? 0) + 1);
    });

  const links: SankeyChronoLink[] = [];
  const totalLevers = data.levers.length;
  if (totalLevers > 0) {
    links.push({ source: 0, target: 1, value: totalLevers });
  }

  let cumulative = totalLevers;
  for (let i = 0; i < STATUS_CYCLE.length; i++) {
    const nodeIdx = i + 1;
    const exitIdx = i + 6;
    const cancelledHere = cancelledByStageIdx.get(i) ?? 0;
    const activeHere = activeByStage.get(STATUS_CYCLE[i]) ?? 0;

    if (cancelledHere > 0) {
      links.push({ source: nodeIdx, target: exitIdx, value: cancelledHere });
    }

    if (i < STATUS_CYCLE.length - 1) {
      const toNext = cumulative - cancelledHere - activeHere;
      if (toNext > 0) {
        links.push({ source: nodeIdx, target: nodeIdx + 1, value: toNext });
      }
      cumulative = toNext;
    } else {
      if (activeHere > 0) {
        links.push({ source: nodeIdx, target: nodes.length - 1, value: activeHere });
      }
    }
  }

  const keptIndices = nodes
    .map((_, i) => i)
    .filter((i) => links.some((l) => l.source === i || l.target === i));
  const indexMap = new Map<number, number>();
  keptIndices.forEach((oldIdx, newIdx) => indexMap.set(oldIdx, newIdx));

  return {
    nodes: keptIndices.map((i) => nodes[i]),
    links: links
      .filter((l) => l.value > 0 && indexMap.has(l.source) && indexMap.has(l.target))
      .map((l) => ({
        source: indexMap.get(l.source)!,
        target: indexMap.get(l.target)!,
        value: l.value,
      })),
  };
}

function financialTotal(data: BeTrackData, pick: (l: Lever) => number): number {
  return (
    Math.round(
      data.levers.filter((l) => l.status !== "cancelled").reduce((s, l) => s + pick(l), 0) * 10
    ) / 10
  );
}

export const MONTH_LABELS = [
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

/** Libellé "Mois Année" (ex: "Jun 2026") de la date de fin d'un levier — sert de valeur de filtre
 * pour le drill-down depuis la S-curve de l'Executive Dashboard. */
export function leverEndMonthLabel(lever: Lever): string {
  const d = new Date(lever.end);
  return `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Libellé "Qn Année" (ex: "Q2 2026") de la date de fin d'un levier — même regroupement que
 * quarterlyBridge, sert de valeur de filtre pour son drill-down. */
export function leverEndQuarterLabel(lever: Lever): string {
  const d = new Date(lever.end);
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

/** S-curve à 3 courbes : Plan initial (figé à L3, ou valeur courante tant que non figé), Réalisé
 * à date (inchangé, calculé depuis la progression), Réactualisé (dernière prévision, ou plan
 * initial/valeur courante tant que non réactualisé à L4). Même forme de courbe mensuelle que
 * l'ancien planned/actual — seule la valeur totale distribuée diffère par série. */
export function sCurve3(data: BeTrackData, granularity: TimeGranularity = "month") {
  const plannedTotal = financialTotal(data, (l) => l.lockedPlan?.netSavings ?? l.netSavings);
  const reforecastTotal = financialTotal(
    data,
    (l) => l.reforecast?.netSavings ?? l.lockedPlan?.netSavings ?? l.netSavings
  );
  const actualTotal = data.levers
    .filter((l) => l.status !== "cancelled")
    .reduce((s, l) => s + realizedSavings(l, data), 0);

  const curve = [0.05, 0.1, 0.18, 0.28, 0.4, 0.52, 0.62, 0.72, 0.81, 0.88, 0.94, 1.0];
  const actualCurveBase = [0.04, 0.09, 0.15, 0.24, 0.34, 0.44, 0.53, 0.62, 0.71, 0.78, 0.86, 0.93];

  const now = new Date();
  const fyStart = new Date(data.program.fyStart);
  const currentMonthIdx = Math.min(
    11,
    Math.max(
      0,
      (now.getFullYear() - fyStart.getFullYear()) * 12 + now.getMonth() - fyStart.getMonth()
    )
  );
  const actualCurve = actualCurveBase.map((v, i) => (i <= currentMonthIdx ? v : null));

  const monthlyPoints = MONTH_LABELS.map((label, i) => ({
    month: label,
    planned: Math.round(curve[i] * plannedTotal * 10) / 10,
    reforecast: Math.round(curve[i] * reforecastTotal * 10) / 10,
    actual:
      actualCurve[i] === null
        ? null
        : Math.round((actualCurve[i] as number) * actualTotal * 10) / 10,
  }));

  if (granularity === "month") return monthlyPoints;

  // Vue trimestrielle : point de fin de chaque trimestre (mois 3/6/9/12) — cohérent avec la vue
  // mensuelle puisque ce sont des courbes cumulatives (le dernier mois du trimestre porte déjà le
  // cumul des mois précédents).
  return [2, 5, 8, 11].map((endMonthIdx, qIdx) => ({
    month: `Q${qIdx + 1}`,
    planned: monthlyPoints[endMonthIdx].planned,
    reforecast: monthlyPoints[endMonthIdx].reforecast,
    actual: monthlyPoints[endMonthIdx].actual,
  }));
}

export type MarimekkoSegment = {
  function: string;
  totalSavings: number;
  widthPct: number;
  levers: { id: string; name: string; netSavings: number; risk: RiskLevel; status: LeverStatus }[];
};

/** Répartition Marimekko par fonction : largeur proportionnelle au poids (net savings) de la
 * fonction dans le total du programme. */
export function marimekko(data: BeTrackData): MarimekkoSegment[] {
  const active = data.levers.filter((l) => l.status !== "cancelled");
  const total = active.reduce((s, l) => s + Math.abs(l.netSavings), 0) || 1;
  const byFunc = new Map<string, Lever[]>();
  active.forEach((l) => {
    if (!byFunc.has(l.function)) byFunc.set(l.function, []);
    byFunc.get(l.function)!.push(l);
  });
  return Array.from(byFunc.entries())
    .map(([func, levers]) => {
      const totalSavings = levers.reduce((s, l) => s + l.netSavings, 0);
      const weight = levers.reduce((s, l) => s + Math.abs(l.netSavings), 0);
      return {
        function: func,
        totalSavings: Math.round(totalSavings * 10) / 10,
        widthPct: Math.round((weight / total) * 1000) / 10,
        levers: levers.map((l) => ({
          id: l.id,
          name: l.name,
          netSavings: l.netSavings,
          risk: l.risk,
          status: l.status,
        })),
      };
    })
    .sort((a, b) => b.totalSavings - a.totalSavings);
}

export type QuarterBridge = { quarter: string; delta: number; cumulative: number };
export type TimeGranularity = "month" | "quarter";

/** Clé de tri chronologique "YYYY-Q" / "YYYY-MM" pour un libellé "Qn AAAA" ou "Mon AAAA" — le tri
 * lexicographique direct sur le libellé affiché casserait l'ordre entre années (ex. "Q4 2025" >
 * "Q1 2026" alphabétiquement). */
function periodSortKey(d: Date, granularity: TimeGranularity): string {
  return granularity === "quarter"
    ? `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`
    : `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
}

function periodLabel(sortKey: string, granularity: TimeGranularity): string {
  const [year, part] = sortKey.split(granularity === "quarter" ? "-Q" : "-");
  return granularity === "quarter" ? `Q${part} ${year}` : `${MONTH_LABELS[Number(part)]} ${year}`;
}

/** Économies réalisées par mois ou par trimestre (date de fin du levier), cumulées jusqu'à la
 * cible du programme — sert au graphique en pont de l'Executive Dashboard, dans les deux
 * granularités proposées par le sélecteur mois/trimestre. */
export function financialBridge(
  data: BeTrackData,
  granularity: TimeGranularity = "quarter"
): QuarterBridge[] {
  const active = data.levers.filter((l) => l.status !== "cancelled");
  const byPeriod = new Map<string, number>();
  active.forEach((l) => {
    const d = new Date(l.end);
    const key = periodSortKey(d, granularity);
    byPeriod.set(key, (byPeriod.get(key) ?? 0) + realizedSavings(l, data));
  });
  const sortedKeys = Array.from(byPeriod.keys()).sort();
  let cumulative = 0;
  return sortedKeys.map((key) => {
    const delta = Math.round((byPeriod.get(key) ?? 0) * 10) / 10;
    cumulative = Math.round((cumulative + delta) * 10) / 10;
    return { quarter: periodLabel(key, granularity), delta, cumulative };
  });
}

/** @deprecated conservé pour compat — utiliser `financialBridge(data, "quarter")`. */
export function quarterlyBridge(data: BeTrackData): QuarterBridge[] {
  return financialBridge(data, "quarter");
}
