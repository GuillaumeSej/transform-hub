import type {
  ActionStatus,
  Alert,
  BeTrackData,
  DependencyType,
  HierarchyLevelDef,
  HierarchyNode,
  Lever,
  LeverAction,
  LeverDependency,
  Program,
  ProgramSummary,
  RiskLevel,
  WorkstreamSummary,
} from "@/types";
import { daysBetween } from "@/lib/dateUtils";
import { nodesForDomain, resolveHierarchyPath } from "@/lib/hierarchyLogic";
import { STATUS_CYCLE, STATUS_LEVEL, STATUS_SHORT_LABEL } from "@/lib/status-config";
import type { LeverStatus } from "@/types";

/**
 * Portage fidèle du moteur de calcul `ENGINE` du prototype de Guillaume (legacy/index.html).
 * Fonctions pures : prennent les données en paramètre plutôt que de lire un état global mutable.
 */

export function realizedSavings(lever: Lever): number {
  if (lever.status === "cancelled") return 0;
  return Math.round(lever.netSavings * (lever.progress / 100) * 100) / 100;
}

export function realizedFte(lever: Lever): number {
  if (lever.status === "cancelled") return 0;
  return Math.round(lever.fteImpact * (lever.progress / 100) * 10) / 10;
}

export function worstRisk(levers: Lever[]): RiskLevel {
  const order: Record<RiskLevel, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  return levers.reduce<RiskLevel>((w, l) => (order[l.risk] > order[w] ? l.risk : w), "low");
}

/** Coûts d'implémentation d'un levier (CAPEX + OPEX one-off), hors OPEX récurrent. */
function implementationCosts(snapshot: { capex: number; opexOneOff: number }): number {
  return snapshot.capex + snapshot.opexOneOff;
}

/** Retard planning d'un levier in_progress : écart entre progression attendue (proportion du
 *  temps écoulé start→end) et progression réelle. Même logique que underperformers().
 *  `now` est calculé à chaque appel (Date.now() par défaut) plutôt que figé au chargement du
 *  module, pour que le retard affiché reste réellement temps réel sur une session longue. */
function scheduleGap(lever: Lever, now: number = Date.now()): number {
  if (lever.status !== "in_progress") return 0;
  const start = new Date(lever.start).getTime();
  const end = new Date(lever.end).getTime();
  if (end <= start) return 0;
  const expected = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
  return expected - lever.progress;
}

export function programSummary(data: BeTrackData): ProgramSummary {
  const active = data.levers.filter((l) => l.status !== "cancelled");
  const target = active.reduce((s, l) => s + l.netSavings, 0);
  const realized = active.reduce((s, l) => s + realizedSavings(l), 0);
  const capex = active.reduce((s, l) => s + l.capex, 0);
  const opex = active.reduce((s, l) => s + l.opexOneOff + l.opexRec, 0);
  const fteImpact = active.reduce((s, l) => s + l.fteImpact, 0);
  const popImpacted = active.reduce((s, l) => s + l.popImpacted, 0);

  // Cible réactualisée — même chaîne de repli que la courbe "Réactualisé" de sCurve3.
  const reforecastTarget = active.reduce(
    (s, l) => s + (l.reforecast?.netSavings ?? l.lockedPlan?.netSavings ?? l.netSavings),
    0
  );

  // Coûts d'implémentation (CAPEX + one-off, jamais l'OPEX récurrent) : plan / engagé / reforecast.
  const plannedCosts = active.reduce((s, l) => s + implementationCosts(l.lockedPlan ?? l), 0);
  const engagedCosts = active.reduce(
    (s, l) => s + implementationCosts(l) * (l.status === "delivered" ? 1 : l.progress / 100),
    0
  );
  const reforecastCosts = active.reduce(
    (s, l) => s + implementationCosts(l.reforecast ?? l.lockedPlan ?? l),
    0
  );

  // Catégories de risque dérivées (un levier peut cumuler plusieurs catégories).
  const now = Date.now();
  const riskDelay = active.filter((l) => scheduleGap(l, now) > 10).length;
  const riskCostOverrun = active.filter(
    (l) =>
      l.reforecast &&
      l.lockedPlan &&
      implementationCosts(l.reforecast) > implementationCosts(l.lockedPlan)
  ).length;
  const riskSavingsCut = active.filter(
    (l) => l.reforecast && l.lockedPlan && l.reforecast.netSavings < l.lockedPlan.netSavings
  ).length;

  // Suppressions de postes (mouvements RH type "Suppression"), en ETP.
  const suppressionMoves = data.workforce.movements.filter((m) => m.type === "Suppression");
  const suppressionsPlanned = suppressionMoves.reduce((s, m) => s + m.fte, 0);
  const suppressionsRealized = suppressionMoves
    .filter((m) => m.status === "Réalisé")
    .reduce((s, m) => s + m.fte, 0);

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
    reforecastTarget: Math.round(reforecastTarget * 10) / 10,
    plannedCosts: Math.round(plannedCosts * 10) / 10,
    engagedCosts: Math.round(engagedCosts * 10) / 10,
    reforecastCosts: Math.round(reforecastCosts * 10) / 10,
    riskDelay,
    riskCostOverrun,
    riskSavingsCut,
    suppressionsPlanned: Math.round(suppressionsPlanned * 10) / 10,
    suppressionsRealized: Math.round(suppressionsRealized * 10) / 10,
  };
}

export function workstreamSummary(data: BeTrackData, wsId: string): WorkstreamSummary {
  const levers = data.levers.filter((l) => l.ws === wsId && l.status !== "cancelled");
  const target = levers.reduce((s, l) => s + l.netSavings, 0);
  const realized = levers.reduce((s, l) => s + realizedSavings(l), 0);
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

// ─── P&L Impact détaillé (plan vs réalisé, ventilé par période) ──────────────

export type PnlDetailedPoint = {
  accountId: string;
  accountName: string;
  plan: number;
  realized: number;
};

/** Période : mois ("Jan 2026"), trimestre ("Q2 2026"), ou année ("2026"). */
export type PnlPeriodFilter = {
  year: string;
  quarter?: string; // "Q1" | "Q2" | "Q3" | "Q4"
  month?: string; // "Jan" | "Feb" | ... | "Dec"
};

function dateMatchesPeriod(dateStr: string | undefined, filter: PnlPeriodFilter): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const year = String(d.getFullYear());
  if (year !== filter.year) return false;
  if (filter.quarter) {
    const q = `Q${Math.floor(d.getMonth() / 3) + 1}`;
    if (q !== filter.quarter) return false;
  }
  if (filter.month) {
    if (MONTH_LABELS[d.getMonth()] !== filter.month) return false;
  }
  return true;
}

/** Impact P&L détaillé : plan vs réalisé par compte, ventilé par période.
 *
 *  - **Plan** : pour chaque levier/sous-levier, `lockedPlan.netSavings ?? netSavings` est
 *    comptabilisé au mois de sa date de fin prévue (`end`). Si le levier a des sous-leviers,
 *    chaque sous-levier est ventilé séparément (sur sa propre date de fin).
 *  - **Réalisé** : pour chaque levier/sous-levier en M5 (delivered), `netSavings` est
 *    comptabilisé au mois de `deliveredDate` (date de passage en M5). Les leviers non M5
 *    ne comptent pas dans le réalisé P&L.
 *  - Si aucun filtre de période, les totaux couvrent tout l'exercice.
 *
 *  Comptes P&L : si `hierarchyLevels` contient un niveau `semantic === "pnl"` avec des
 *  `hierarchyNodes` (domaine "financial") configurés pour ce niveau, ce sont CES nœuds qui
 *  font foi pour la liste des comptes — TOUS apparaissent dans le résultat (même sans aucun
 *  levier dessus, à plan=0/realized=0), et chaque levier est rattaché à son compte en
 *  remontant `lever.hierarchyLeafId` jusqu'à ce niveau macro (voir `resolveHierarchyPath`).
 *  Un levier sans `hierarchyLeafId` (donnée pas encore migrée) retombe sur l'ancien matching
 *  par `lever.pnlMap` / `impact.pnlMap` pour lui seul. Si aucune arborescence financière avec
 *  un niveau "pnl" n'est configurée, le comportement est identique à avant (aucun changement
 *  pour les entreprises sans arborescence). */
export function pnlImpactDetailed(
  data: BeTrackData,
  periodFilter?: PnlPeriodFilter,
  hierarchyNodes?: HierarchyNode[],
  hierarchyLevels?: HierarchyLevelDef[]
): PnlDetailedPoint[] {
  const active = data.levers.filter((l) => l.status !== "cancelled");

  const pnlLevel = hierarchyLevels?.find((level) => level.semantic === "pnl");
  const financialNodes = pnlLevel ? nodesForDomain(hierarchyNodes ?? [], "financial") : [];
  const pnlNodes = pnlLevel ? financialNodes.filter((node) => node.levelKey === pnlLevel.key) : [];
  const useHierarchy = !!pnlLevel && pnlNodes.length > 0;

  const map = new Map<string, { plan: number; realized: number }>();
  if (useHierarchy) {
    // Pré-remplit TOUS les comptes réellement configurés dans l'arborescence, même sans levier
    // dessus — c'est le point clé du besoin : voir tous les blocs P&L définis, remplis ou vides.
    for (const node of pnlNodes) {
      map.set(node.code, { plan: 0, realized: 0 });
    }
  }

  const addPlan = (pnlMap: string, amount: number) => {
    const e = map.get(pnlMap) ?? { plan: 0, realized: 0 };
    e.plan += amount;
    map.set(pnlMap, e);
  };
  const addRealized = (pnlMap: string, amount: number) => {
    const e = map.get(pnlMap) ?? { plan: 0, realized: 0 };
    e.realized += amount;
    map.set(pnlMap, e);
  };

  // Résout le compte P&L (macro) d'un levier via son `hierarchyLeafId`, `undefined` si
  // l'arborescence n'est pas utilisable ou si le levier n'a pas (encore) de leaf id — auquel
  // cas l'appelant retombe sur `lever.pnlMap`/`impact.pnlMap` pour ce levier précis.
  const resolveLeverAccount = (lever: Lever): string | undefined => {
    if (!useHierarchy || !lever.hierarchyLeafId) return undefined;
    const path = resolveHierarchyPath(lever.hierarchyLeafId, financialNodes, hierarchyLevels ?? []);
    return path.find((entry) => entry.levelKey === pnlLevel!.key)?.code;
  };

  for (const lever of active) {
    const hierarchyAccount = resolveLeverAccount(lever);
    const actionImpacts = (lever.actions ?? []).flatMap((action) =>
      (action.impacts ?? []).map((impact) => ({ action, impact }))
    );
    if (actionImpacts.length > 0) {
      for (const { action, impact } of actionImpacts) {
        const account = hierarchyAccount ?? (impact.pnlMap || lever.pnlMap);
        const signedAmount = impact.type === "saving" ? impact.amount : -impact.amount;
        if (!periodFilter || dateMatchesPeriod(action.end, periodFilter)) {
          addPlan(account, signedAmount);
        }
        if (action.status === "done") {
          const realDate = action.deliveredDate ?? action.end;
          if (!periodFilter || dateMatchesPeriod(realDate, periodFilter)) {
            addRealized(account, signedAmount);
          }
        }
      }
      continue;
    }

    // Levier sans impacts d'action détaillés : traité comme un bloc unique.
    const account = hierarchyAccount ?? lever.pnlMap;
    const planAmount = lever.lockedPlan?.netSavings ?? lever.netSavings;
    const planDate = lever.end;
    if (!periodFilter || dateMatchesPeriod(planDate, periodFilter)) {
      addPlan(account, planAmount);
    }
    if (lever.status === "delivered") {
      const realDate = lever.deliveredDate ?? lever.end;
      if (!periodFilter || dateMatchesPeriod(realDate, periodFilter)) {
        addRealized(account, lever.netSavings);
      }
    }
  }

  return Array.from(map.entries())
    .map(([id, vals]) => ({
      accountId: id,
      accountName:
        (useHierarchy ? pnlNodes.find((node) => node.code === id)?.label : undefined) ??
        data.pnlAccounts.find((a) => a.id === id)?.name ??
        id,
      plan: Math.round(vals.plan * 10) / 10,
      realized: Math.round(vals.realized * 10) / 10,
    }))
    .sort((a, b) => b.plan - a.plan);
}

export function pnlImpact(data: BeTrackData): Record<string, number> {
  const map: Record<string, number> = {};
  data.levers
    .filter((l) => l.status !== "cancelled")
    .forEach((l) => {
      map[l.pnlMap] = (map[l.pnlMap] || 0) + realizedSavings(l);
    });
  return map;
}

export function byGeo(data: BeTrackData): Record<string, number> {
  const map: Record<string, number> = {};
  data.levers
    .filter((l) => l.status !== "cancelled")
    .forEach((l) => {
      map[l.geography] = (map[l.geography] || 0) + realizedSavings(l);
    });
  return map;
}

export function byFunction(data: BeTrackData): Record<string, number> {
  const map: Record<string, number> = {};
  data.levers
    .filter((l) => l.status !== "cancelled")
    .forEach((l) => {
      map[l.function] = (map[l.function] || 0) + realizedSavings(l);
    });
  return map;
}

export function byCountry(data: BeTrackData): Record<string, number> {
  const map: Record<string, number> = {};
  data.levers
    .filter((l) => l.status !== "cancelled")
    .forEach((l) => {
      map[l.country] = (map[l.country] || 0) + realizedSavings(l);
    });
  return map;
}

/** Répartition des savings par programme (Lever.programId) — pendant de `workstreamSummary` mais
 * pour la dimension "programme" plutôt que "workstream". Les leviers sans programme assigné sont
 * regroupés sous "Non assigné" plutôt qu'exclus, pour que le total reste cohérent avec les autres
 * vues. */
export function byProgram(data: BeTrackData, programs: Program[]): Record<string, number> {
  const map: Record<string, number> = {};
  data.levers
    .filter((l) => l.status !== "cancelled")
    .forEach((l) => {
      const label = programs.find((p) => p.id === l.programId)?.name ?? "Non assigné";
      map[label] = (map[label] || 0) + realizedSavings(l);
    });
  return map;
}

// ---------- Risque calculé depuis les alertes ----------

/** Seuils par défaut (€, cumul des montants d'alertes ouvertes liées au levier, valeur absolue de
 * Alert.impactEur) si l'entreprise n'a pas configuré Company.riskThresholds. Évalués du plus haut
 * seuil au plus bas. */
export const DEFAULT_RISK_THRESHOLDS: { level: RiskLevel; minAmount: number }[] = [
  { level: "critical", minAmount: 500_000 },
  { level: "high", minAmount: 200_000 },
  { level: "medium", minAmount: 50_000 },
  { level: "low", minAmount: 0 },
];

/** Risque d'un levier dérivé des alertes qui lui sont liées (Alert.scope === leverId, non
 * résolues), segmenté par cumul de montant à risque (valeur absolue de Alert.impactEur) selon les
 * seuils de l'entreprise (ou les seuils par défaut). Un levier sans alerte chiffrée est "low".
 * Remplace la saisie manuelle de Lever.risk : c'est la nouvelle source de vérité, "vivante" — elle
 * évolue avec les alertes plutôt que d'être figée à la main. */
export function computeLeverRisk(
  leverId: string,
  alerts: Alert[],
  thresholds: { level: RiskLevel; minAmount: number }[] = DEFAULT_RISK_THRESHOLDS
): RiskLevel {
  const total = alerts
    .filter((a) => a.scope === leverId && !a.resolved && typeof a.impactEur === "number")
    .reduce((s, a) => s + Math.abs(a.impactEur ?? 0), 0);
  const sorted = [...thresholds].sort((a, b) => b.minAmount - a.minAmount);
  const hit = sorted.find((t) => total >= t.minAmount);
  return hit?.level ?? "low";
}

/** `now` est calculé à chaque appel (Date.now() par défaut) plutôt que figé au chargement du
 *  module, pour que l'écart affiché reste réellement temps réel sur une session longue. */
export function underperformers(data: BeTrackData, wsId?: string, now: number = Date.now()) {
  return data.levers
    .filter((l) => (!wsId || l.ws === wsId) && l.status === "in_progress")
    .map((l) => {
      const start = new Date(l.start).getTime();
      const end = new Date(l.end).getTime();
      const expectedProgress = Math.min(
        100,
        Math.max(0, Math.round(((now - start) / (end - start)) * 100))
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
  const weights = actions.map((action) => {
    const financialWeight = (action.impacts ?? []).reduce(
      (sum, impact) => sum + Math.abs(impact.amount),
      0
    );
    return financialWeight > 0 ? financialWeight : 1;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const total = actions.reduce(
    (sum, action, index) => sum + ACTION_STATUS_WEIGHT[action.status] * weights[index],
    0
  );
  return Math.round(total / totalWeight);
}

/**
 * Progression d'un levier : moyenne pondérée par statut de son plan d'action (Lever.actions) ;
 * sans action, la valeur manuelle existante est conservée inchangée.
 */
export function recomputeLeverProgress(lever: Lever): number {
  if (lever.actions && lever.actions.length > 0) {
    return actionProgress(lever.actions);
  }
  return lever.progress;
}

// ---------- Dépendances & cascade de retard ----------

type ScheduleEntity = {
  id: string;
  kind: "lever";
  name: string;
  start: string;
  end: string;
  dependencies: LeverDependency[];
};

function toScheduleEntities(data: BeTrackData): ScheduleEntity[] {
  return data.levers.map((l) => ({
    id: l.id,
    kind: "lever",
    name: l.name,
    start: l.start,
    end: l.end,
    dependencies: l.dependencies,
  }));
}

export type CascadeShift = {
  id: string;
  kind: "lever";
  name: string;
  oldStart: string;
  oldEnd: string;
  newStart: string;
  newEnd: string;
};

export type CascadeResult = {
  /** Décalages proposés sur les leviers dépendants (jamais appliqués sans confirmation). */
  shifts: CascadeShift[];
  /** Leviers dépendants touchés par le retard : alertés, mais leurs dates ne sont JAMAIS
   * modifiées automatiquement (décision inter-leviers = décision métier, hors outil). */
  impactedLevers: { id: string; name: string; dependencyType: DependencyType }[];
};

/**
 * Calcule (sans rien muter) l'impact d'un glissement de `oldEnd` à `newEnd` sur `entityId` :
 * simple liste d'alerte pour les leviers dépendants (leurs dates ne bougent jamais
 * automatiquement).
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
  const impactedLevers: CascadeResult["impactedLevers"] = entities
    .filter((e) => e.id !== entityId && e.dependencies.some((d) => d.targetId === entityId))
    .map((dep) => {
      const link = dep.dependencies.find((d) => d.targetId === entityId);
      return { id: dep.id, name: dep.name, dependencyType: link?.type ?? "FS" };
    });

  return { shifts: [], impactedLevers };
}

// ---------- Alertes de dépendances inter-leviers ----------

export type DependencyAlert = {
  sourceId: string;
  sourceName: string;
  sourceKind: "lever";
  sourceDate: string;
  targetId: string;
  targetName: string;
  targetDate: string;
  type: DependencyType;
  message: string;
  /** Nombre de jours de retard ou décalage (toujours positif). */
  delayDays: number;
  /** Net savings (€M) du levier bloqué (source) — valeur à risque. */
  impactEur: number;
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

  // Résoudre les savings NON RÉALISÉS d'une entité — c'est le montant réellement à risque
  // (les savings déjà réalisés sont acquis et ne peuvent plus être bloqués).
  const entityUnrealizedSavings = (id: string): number => {
    const lever = data.levers.find((l) => l.id === id);
    if (lever) return Math.max(0, lever.netSavings - realizedSavings(lever));
    return 0;
  };

  for (const source of entities) {
    for (const dep of source.dependencies) {
      const target = byId.get(dep.targetId);
      if (!target) continue;

      let violated = false;
      let message = "";
      let delayDays = 0;
      let sourceDate = "";
      let targetDate = "";

      switch (dep.type) {
        case "FS":
          // Le bloqueur (target) doit finir avant que le bloqué (source) puisse commencer
          delayDays = daysBetween(source.start, target.end); // positif si target.end > source.start
          violated = delayDays > 0;
          sourceDate = source.start;
          targetDate = target.end;
          message = `"${target.name}" se termine ${delayDays} jours après le début prévu de "${source.name}"`;
          break;
        case "SS":
          // Les deux doivent démarrer ensemble
          delayDays = Math.abs(daysBetween(target.start, source.start));
          violated = delayDays > SIMULTANEITY_TOLERANCE_DAYS;
          sourceDate = source.start;
          targetDate = target.start;
          message = `"${source.name}" et "${target.name}" ont ${delayDays} jours de décalage au démarrage`;
          break;
        case "FF":
          // Les deux doivent finir ensemble
          delayDays = Math.abs(daysBetween(target.end, source.end));
          violated = delayDays > SIMULTANEITY_TOLERANCE_DAYS;
          sourceDate = source.end;
          targetDate = target.end;
          message = `"${source.name}" et "${target.name}" ont ${delayDays} jours de décalage à la fin`;
          break;
        case "SF":
          // Le bloqueur (target) doit démarrer avant que le bloqué (source) puisse finir
          delayDays = daysBetween(source.end, target.start); // positif si target.start > source.end
          violated = delayDays > 0;
          sourceDate = source.end;
          targetDate = target.start;
          message = `"${target.name}" démarre ${delayDays} jours après la fin prévue de "${source.name}"`;
          break;
      }

      if (violated) {
        // Impact € = savings non réalisés à risque.
        // Directionnel (FS/SF) : seul le levier bloqué (source) est à risque.
        // Symétrique (SS/FF) : les deux leviers sont à risque.
        const impact =
          dep.type === "SS" || dep.type === "FF"
            ? entityUnrealizedSavings(source.id) + entityUnrealizedSavings(target.id)
            : entityUnrealizedSavings(source.id);

        alerts.push({
          sourceId: source.id,
          sourceName: source.name,
          sourceKind: source.kind,
          sourceDate,
          targetId: target.id,
          targetName: target.name,
          targetDate,
          type: dep.type,
          message,
          delayDays: Math.abs(delayDays),
          impactEur: Math.round(impact * 100) / 100,
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
 * Sankey chronologique : montre le flux de leviers à travers les étapes de maturité M1→M5.
 *
 * Principe : un levier génère un flux horizontal de l'étape N vers l'étape N+1 **uniquement
 * s'il a atteint au minimum l'étape N+1**. Un levier encore à l'étape N ne génère aucun flux
 * sortant — la différence de largeur entre le flux entrant et les flux sortants du nœud rend
 * visible les leviers qui "stagnent" à cette étape.
 *
 * Les leviers annulés génèrent un flux vers "Abandonné après MX" à l'étape où ils se trouvaient.
 *
 * Structure :
 *   Tous → M1 → M2 → M3 → M4 → M5
 *           ↘     ↘     ↘     ↘     ↘
 *         Aband. Aband. Aband. Aband. Aband.
 */
export function sankeyChronology(data: BeTrackData): {
  nodes: SankeyChronoNode[];
  links: SankeyChronoLink[];
} {
  // ── Nœuds : Tous + M1-M5 + Abandonné après M1-M5 ────────────────────────
  const nodes: SankeyChronoNode[] = [{ name: "Tous les leviers" }];
  STATUS_CYCLE.forEach((status) => {
    nodes.push({ name: `${STATUS_LEVEL[status]} ${STATUS_SHORT_LABEL[status]}` });
  });
  STATUS_CYCLE.forEach((status) => {
    nodes.push({ name: `Abandonné après ${STATUS_LEVEL[status]}` });
  });
  // Indices : 0 = Tous, 1-5 = M1-M5, 6-10 = Abandonné après M1-M5

  // ── Compter les leviers par étape ────────────────────────────────────────
  // Pour chaque étape, combien de leviers l'ont AU MOINS atteinte ?
  // Un levier à M4 a traversé M1, M2, M3, M4 (4 étapes).
  // Un levier annulé à M3 a traversé M1, M2, M3 (3 étapes).

  const cancelledAtStageIdx = new Map<number, number>();
  STATUS_CYCLE.forEach((_, i) => cancelledAtStageIdx.set(i, 0));

  data.levers
    .filter((l) => l.status === "cancelled")
    .forEach((l) => {
      let stageIdx: number;
      const explicit = l.cancelledAtStage ? STATUS_CYCLE.indexOf(l.cancelledAtStage) : -1;
      if (explicit !== -1) {
        stageIdx = explicit;
      } else {
        const p = l.progress;
        if (p <= 10) stageIdx = 0;
        else if (p <= 30) stageIdx = 1;
        else if (p <= 55) stageIdx = 2;
        else if (p <= 80) stageIdx = 3;
        else stageIdx = 4;
      }
      cancelledAtStageIdx.set(stageIdx, (cancelledAtStageIdx.get(stageIdx) ?? 0) + 1);
    });

  // Pour chaque étape, combien de leviers actifs (non annulés) sont EXACTEMENT à cette étape ?
  const activeExactly = new Map<number, number>();
  STATUS_CYCLE.forEach((_, i) => activeExactly.set(i, 0));
  data.levers
    .filter((l) => l.status !== "cancelled")
    .forEach((l) => {
      const idx = STATUS_CYCLE.indexOf(l.status);
      if (idx !== -1) activeExactly.set(idx, (activeExactly.get(idx) ?? 0) + 1);
    });

  // Combien de leviers ont atteint AU MOINS l'étape i ?
  // = leviers actifs dont STATUS_ORDER >= i+1  +  leviers annulés dont l'étape d'annulation >= i
  function reachedAtLeast(stageIdx: number): number {
    let count = 0;
    // Leviers actifs
    data.levers
      .filter((l) => l.status !== "cancelled")
      .forEach((l) => {
        const lvlIdx = STATUS_CYCLE.indexOf(l.status);
        if (lvlIdx >= stageIdx) count++;
      });
    // Leviers annulés
    data.levers
      .filter((l) => l.status === "cancelled")
      .forEach((l) => {
        let cancelIdx: number;
        const explicit = l.cancelledAtStage ? STATUS_CYCLE.indexOf(l.cancelledAtStage) : -1;
        if (explicit !== -1) {
          cancelIdx = explicit;
        } else {
          const p = l.progress;
          if (p <= 10) cancelIdx = 0;
          else if (p <= 30) cancelIdx = 1;
          else if (p <= 55) cancelIdx = 2;
          else if (p <= 80) cancelIdx = 3;
          else cancelIdx = 4;
        }
        if (cancelIdx >= stageIdx) count++;
      });
    return count;
  }

  // ── Construire les liens ─────────────────────────────────────────────────
  const links: SankeyChronoLink[] = [];
  const totalLevers = data.levers.length;

  if (totalLevers > 0) {
    // Tous les leviers → M1 (tout le monde passe par M1)
    links.push({ source: 0, target: 1, value: totalLevers });
  }

  for (let i = 0; i < STATUS_CYCLE.length; i++) {
    const stageNodeIdx = i + 1; // M1=1, M2=2, ..., M5=5
    const abandonNodeIdx = i + 6; // Abandonné après M1=6, ..., M5=10

    const cancelled = cancelledAtStageIdx.get(i) ?? 0;

    // Flux vers "Abandonné après MX" (si > 0)
    if (cancelled > 0) {
      links.push({ source: stageNodeIdx, target: abandonNodeIdx, value: cancelled });
    }

    // Flux vers l'étape suivante = leviers qui ont dépassé cette étape
    if (i < STATUS_CYCLE.length - 1) {
      const nextReached = reachedAtLeast(i + 1);
      if (nextReached > 0) {
        links.push({ source: stageNodeIdx, target: stageNodeIdx + 1, value: nextReached });
      }
    }
    // Pour M5 (dernière étape) : pas de flux sortant — les leviers "delivered" restent dans M5
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

/** Index de mois fiscal (0-11) correspondant à `dateStr`, relatif à `fyStart` — clampé aux bornes
 * de l'exercice (les dates hors exercice sont rattachées au premier ou dernier mois). */
function fiscalMonthIndex(dateStr: string, fyStart: Date): number {
  const d = new Date(dateStr);
  const idx = (d.getFullYear() - fyStart.getFullYear()) * 12 + d.getMonth() - fyStart.getMonth();
  return Math.min(11, Math.max(0, idx));
}

/** Noyau de lissage (approx. gaussien) : transforme un empilement de montants sur leur mois de fin
 * exact (un "escalier") en une répartition mensuelle progressive type courbe en S, en étalant
 * chaque montant sur les mois voisins plutôt que de le concentrer sur un seul mois. */
const SCURVE_SMOOTH_KERNEL: { offset: number; weight: number }[] = [
  { offset: -2, weight: 0.06 },
  { offset: -1, weight: 0.24 },
  { offset: 0, weight: 0.4 },
  { offset: 1, weight: 0.24 },
  { offset: 2, weight: 0.06 },
];

/** Répartit 12 fractions mensuelles (deltas, somme = 1) à partir des dates de fin réelles des
 * leviers, pondérées par le montant de chacun (valeur absolue, pour éviter qu'un mélange de
 * montants positifs/négatifs n'annule la pondération), et lissées avec `SCURVE_SMOOTH_KERNEL`.
 * Même logique de ventilation par date réelle (`lever.end`) que `financialBridge` et
 * `pnlImpactDetailed`, mais cumulée en courbe en S plutôt qu'en escalier trimestriel. */
function sCurveMonthlyDeltaFractions(
  entries: { date: string; amount: number }[],
  fyStart: Date
): number[] {
  const deltas = new Array(12).fill(0);
  const totalWeight = entries.reduce((s, e) => s + Math.abs(e.amount), 0);
  if (totalWeight === 0) return deltas;
  for (const entry of entries) {
    const weight = Math.abs(entry.amount) / totalWeight;
    if (weight === 0) continue;
    const centerIdx = fiscalMonthIndex(entry.date, fyStart);
    for (const { offset, weight: kernelWeight } of SCURVE_SMOOTH_KERNEL) {
      const monthIdx = centerIdx + offset;
      if (monthIdx < 0 || monthIdx > 11) continue;
      deltas[monthIdx] += weight * kernelWeight;
    }
  }
  // Renormaliser : le noyau est tronqué en début/fin d'exercice, ce qui ferait perdre du poids.
  const sum = deltas.reduce((s, v) => s + v, 0);
  if (sum > 0) {
    for (let i = 0; i < 12; i++) deltas[i] /= sum;
  }
  return deltas;
}

function cumulativeFractions(deltas: number[]): number[] {
  let acc = 0;
  return deltas.map((v) => (acc += v));
}

/** S-curve à 3 courbes : Plan initial (figé à L3, ou valeur courante tant que non figé), Réalisé
 * à date (inchangé, calculé depuis la progression), Réactualisé (dernière prévision, ou plan
 * initial/valeur courante tant que non réactualisé à L4). Les totaux sont exacts (somme = valeur
 * réelle du programme) ; la répartition mensuelle est dérivée des vraies dates de fin des leviers
 * (`lever.end` / `deliveredDate`), lissée en courbe en S — pas d'un gabarit générique fixe. */
export function sCurve3(data: BeTrackData, granularity: TimeGranularity = "month") {
  const active = data.levers.filter((l) => l.status !== "cancelled");
  const fyStart = new Date(data.program.fyStart);

  const plannedTotal = financialTotal(data, (l) => l.lockedPlan?.netSavings ?? l.netSavings);
  const reforecastTotal = financialTotal(
    data,
    (l) => l.reforecast?.netSavings ?? l.lockedPlan?.netSavings ?? l.netSavings
  );
  const actualTotal = active.reduce((s, l) => s + realizedSavings(l), 0);

  const plannedFractions = cumulativeFractions(
    sCurveMonthlyDeltaFractions(
      active.map((l) => ({ date: l.end, amount: l.lockedPlan?.netSavings ?? l.netSavings })),
      fyStart
    )
  );
  const reforecastFractions = cumulativeFractions(
    sCurveMonthlyDeltaFractions(
      active.map((l) => ({
        date: l.end,
        amount: l.reforecast?.netSavings ?? l.lockedPlan?.netSavings ?? l.netSavings,
      })),
      fyStart
    )
  );
  const actualFractions = cumulativeFractions(
    sCurveMonthlyDeltaFractions(
      active.map((l) => ({ date: l.deliveredDate ?? l.end, amount: realizedSavings(l) })),
      fyStart
    )
  );

  const now = new Date();
  const currentMonthIdx = Math.min(
    11,
    Math.max(
      0,
      (now.getFullYear() - fyStart.getFullYear()) * 12 + now.getMonth() - fyStart.getMonth()
    )
  );

  const monthlyPoints = MONTH_LABELS.map((label, i) => ({
    month: label,
    planned: Math.round(plannedFractions[i] * plannedTotal * 10) / 10,
    reforecast: Math.round(reforecastFractions[i] * reforecastTotal * 10) / 10,
    actual: i <= currentMonthIdx ? Math.round(actualFractions[i] * actualTotal * 10) / 10 : null,
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

export type MarimekkoPairKey = "function-country" | "workstream-project" | "workstream-lever";

export type Marimekko2DSegment = {
  key: string;
  label: string;
  /** Hauteur du segment en % de la colonne (dimension secondaire) — pas en % du total du
   *  programme, comme un vrai Marimekko : chaque colonne est une barre empilée à 100%. */
  heightPct: number;
  value: number;
  count: number;
};

export type Marimekko2DColumn = {
  key: string;
  label: string;
  /** Largeur de la colonne en % du total du programme (dimension primaire). */
  widthPct: number;
  totalSavings: number;
  segments: Marimekko2DSegment[];
};

/** Répartition Marimekko à deux dimensions : la largeur des colonnes reflète le poids de la
 * dimension primaire (fonction ou workstream) dans le programme, chaque colonne se décompose
 * ensuite en segments empilés selon la dimension secondaire (pays ou projet). Remplace l'ancienne
 * version à une seule dimension (toujours "par fonction") — le TYPE de graphique (Marimekko) est
 * maintenant indépendant du COUPLE d'indicateurs affiché, choisi via `pairKey`. */
export function marimekko2D(
  data: BeTrackData,
  pairKey: MarimekkoPairKey,
  programs: Program[] = []
): Marimekko2DColumn[] {
  const active = data.levers.filter((l) => l.status !== "cancelled");
  const totalWeight = active.reduce((s, l) => s + Math.abs(l.netSavings), 0) || 1;

  const primaryOf = (l: Lever): string =>
    pairKey === "function-country"
      ? l.function
      : (data.workstreams.find((w) => w.id === l.ws)?.name ?? l.ws);
  const secondaryOf = (l: Lever): string => {
    if (pairKey === "function-country") return l.country || "—";
    if (pairKey === "workstream-lever") return l.name;
    // fallback legacy workstream-project
    return programs.find((p) => p.id === l.programId)?.name ?? "Non assigné";
  };

  const byPrimary = new Map<string, Lever[]>();
  active.forEach((l) => {
    const key = primaryOf(l);
    if (!byPrimary.has(key)) byPrimary.set(key, []);
    byPrimary.get(key)!.push(l);
  });

  return Array.from(byPrimary.entries())
    .map(([primaryKey, levers]) => {
      const colWeight = levers.reduce((s, l) => s + Math.abs(l.netSavings), 0) || 1;
      const totalSavings = levers.reduce((s, l) => s + l.netSavings, 0);

      const bySecondary = new Map<string, Lever[]>();
      levers.forEach((l) => {
        const key = secondaryOf(l);
        if (!bySecondary.has(key)) bySecondary.set(key, []);
        bySecondary.get(key)!.push(l);
      });

      const segments: Marimekko2DSegment[] = Array.from(bySecondary.entries())
        .map(([secondaryKey, segLevers]) => {
          const segWeight = segLevers.reduce((s, l) => s + Math.abs(l.netSavings), 0);
          return {
            key: secondaryKey,
            label: secondaryKey,
            heightPct: Math.round((segWeight / colWeight) * 1000) / 10,
            value: Math.round(segLevers.reduce((s, l) => s + l.netSavings, 0) * 10) / 10,
            count: segLevers.length,
          };
        })
        .sort((a, b) => b.value - a.value);

      return {
        key: primaryKey,
        label: primaryKey,
        widthPct: Math.round((colWeight / totalWeight) * 1000) / 10,
        totalSavings: Math.round(totalSavings * 10) / 10,
        segments,
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
    byPeriod.set(key, (byPeriod.get(key) ?? 0) + realizedSavings(l));
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
