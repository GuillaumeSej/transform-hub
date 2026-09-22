import type {
  LeverImpact,
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
import {
  nodesForDomain,
  resolveHierarchyNodeChain,
  resolveHierarchyPath,
} from "@/lib/hierarchyLogic";
import { STATUS_CYCLE, STATUS_LEVEL, STATUS_SHORT_LABEL } from "@/lib/status-config";
import type { LeverStatus } from "@/types";
import { impactStatusOf } from "@/lib/impactStatus";

/**
 * Portage fidèle du moteur de calcul `ENGINE` du prototype HTML historique de Guillaume
 * (depuis retiré du repo).
 * Fonctions pures : prennent les données en paramètre plutôt que de lire un état global mutable.
 */

// ---------- Impacts au niveau levier ----------

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Lignes d'impact effectives d'un levier : `lever.impacts` (modèle actuel) ; à défaut, repli sur
 *  les anciens `action.impacts` non encore migrés (voir `lib/leverImpactMigration.ts`). */
export function leverImpactsOf(lever: Lever): LeverImpact[] {
  if (lever.impacts && lever.impacts.length > 0) return lever.impacts;
  return (lever.actions ?? []).flatMap((a) => a.impacts ?? []);
}

export function hasLeverImpacts(lever: Lever): boolean {
  return leverImpactsOf(lever).length > 0;
}

export type LeverImpactTotals = {
  /** Gains récurrents annuels (hors one-off) + salaire des départs ETP. */
  grossAnnual: number;
  /** Gains ponctuels — JAMAIS inclus dans grossAnnual/netAnnual/totaux programme. */
  oneOffGains: number;
  opexOneOff: number;
  /** OPEX récurrent, y compris salaire chargé des recrutements ETP. */
  opexRec: number;
  capex: number;
  /** +recrutements / −départs. */
  fteNet: number;
  /** grossAnnual − opexRec (règle métier "net = brut − OPEX récurrent" ; CAPEX et one-off exclus). */
  netAnnual: number;
};

/** Totaux financiers/ETP dérivés des impacts du levier (source de vérité unique). */
export function leverImpactTotals(lever: Lever | LeverImpact[]): LeverImpactTotals {
  const impacts = Array.isArray(lever) ? lever : leverImpactsOf(lever);
  let gross = 0;
  let oneOffGains = 0;
  let opexOneOff = 0;
  let opexRec = 0;
  let capex = 0;
  let fte = 0;
  for (const imp of impacts) {
    if (imp.type === "saving") {
      if (imp.gainRecurrence === "oneoff") oneOffGains += imp.amount;
      else gross += imp.amount;
      if (imp.fteCount) fte += imp.fteCount;
    } else if (imp.type === "fte") {
      const count = imp.fteCount ?? 0;
      if (imp.fteDirection === "hire") {
        opexRec += imp.amount;
        fte += count;
      } else {
        gross += imp.amount;
        fte -= count;
      }
    } else if (imp.nature === "capex") {
      capex += imp.amount;
      if (imp.fteCount) fte += imp.fteCount;
    } else if (imp.nature === "oneoff") {
      opexOneOff += imp.amount;
      if (imp.fteCount) fte += imp.fteCount;
    } else {
      opexRec += imp.amount;
      if (imp.fteCount) fte += imp.fteCount;
    }
  }
  return {
    grossAnnual: round2(gross),
    oneOffGains: round2(oneOffGains),
    opexOneOff: round2(opexOneOff),
    opexRec: round2(opexRec),
    capex: round2(capex),
    fteNet: Math.round(fte * 10) / 10,
    // Règle métier : net annuel = gain brut − OPEX récurrent. CAPEX et coûts one-off n'y entrent JAMAIS.
    netAnnual: round2(gross - opexRec),
  };
}

/** Avancement d'UNE action (0-100) : `declaredProgressPct` s'il est renseigné, sinon dérivé du
 *  statut (done=100, todo=0, in_progress=50, delayed=0). */
export function actionProgressPct(action: LeverAction): number {
  if (typeof action.declaredProgressPct === "number") {
    return Math.min(100, Math.max(0, action.declaredProgressPct));
  }
  return ACTION_STATUS_WEIGHT[action.status] ?? 0;
}

export type LeverActionWeighting = {
  mode: "weighted" | "unweighted";
  /** Poids (en %, somme = 100) par id d'action. */
  weights: Record<string, number>;
};

/** Mode pondéré ssi TOUTES les actions ont `weightPct` ET la somme vaut 100 ; sinon moyenne simple. */
export function leverActionWeighting(lever: Pick<Lever, "actions">): LeverActionWeighting {
  const actions = lever.actions ?? [];
  const weights: Record<string, number> = {};
  const weighted =
    actions.length > 0 &&
    actions.every((a) => typeof a.weightPct === "number") &&
    Math.abs(actions.reduce((s, a) => s + (a.weightPct as number), 0) - 100) < 1e-6;
  if (weighted) {
    for (const a of actions) weights[a.id] = a.weightPct as number;
    return { mode: "weighted", weights };
  }
  for (const a of actions) weights[a.id] = actions.length ? 100 / actions.length : 0;
  return { mode: "unweighted", weights };
}

/** Avancement d'un levier = avancement pondéré de ses ACTIONS uniquement (jamais les gains).
 *  Sans action : 0. */
export function leverActionProgress(lever: Pick<Lever, "actions">): number {
  const actions = lever.actions ?? [];
  if (actions.length === 0) return 0;
  const { weights } = leverActionWeighting(lever);
  const total = actions.reduce((s, a) => s + (weights[a.id] / 100) * actionProgressPct(a), 0);
  return Math.round(total);
}

/** Fraction (0-1) du plan du levier considérée comme réalisée : avancement des actions ; sans
 *  action, 1 si livré sinon 0. */
function realizationFraction(lever: Lever): number {
  if (lever.status === "delivered") return 1;
  if ((lever.actions ?? []).length === 0) return 0;
  return leverActionProgress(lever) / 100;
}

/** Somme des impacts (legacy : portés par les actions) des actions "done". `pick === "net"` :
 *  gains bruts − OPEX récurrent (CAPEX et one-off exclus). Utilisé uniquement pour les leviers SANS impact de niveau
 *  levier (données non migrées). */
function doneActionImpactsTotal(lever: Lever, pick: "net" | "gross" | "fte"): number {
  let total = 0;
  for (const action of lever.actions ?? []) {
    if (action.status !== "done") continue;
    for (const imp of action.impacts ?? []) {
      if (pick === "fte") {
        if (imp.fteCount) total += imp.fteCount;
      } else if (pick === "gross") {
        if (imp.type === "saving" && imp.gainRecurrence !== "oneoff") total += imp.amount;
        else if (imp.type === "fte" && imp.fteDirection !== "hire") total += imp.amount;
      } else if (imp.type === "saving") {
        if (imp.gainRecurrence !== "oneoff") total += imp.amount;
      } else if (imp.type === "fte") {
        if (imp.fteDirection === "hire") total -= imp.amount;
        else total += imp.amount;
      } else if (imp.nature !== "capex" && imp.nature !== "oneoff") {
        total -= imp.amount;
      }
    }
  }
  return pick === "fte" ? total : Math.round(total * 100) / 100;
}

/** Réalisé net : levier avec impacts de niveau levier → dernière version nette (réactualisé,
 *  sinon plan figé, sinon impacts live) × fraction d'avancement des actions (100 % si livré) ;
 *  ancien modèle (impacts sur les actions) → somme des actions "done". Annulé → 0. */
export function realizedSavings(lever: Lever): number {
  if (lever.status === "cancelled") return 0;
  if (lever.impacts && lever.impacts.length > 0) {
    return round2(displayedReforecastNet(lever).value * realizationFraction(lever));
  }
  return doneActionImpactsTotal(lever, "net");
}

/** Équivalent BRUT (avant déduction des coûts) de `realizedSavings`. */
export function realizedGrossSavings(lever: Lever): number {
  if (lever.status === "cancelled") return 0;
  if (lever.impacts && lever.impacts.length > 0) {
    const gross = lever.reforecast?.grossSavings ?? lever.lockedPlan?.grossSavings;
    return round2((gross ?? leverImpactTotals(lever).grossAnnual) * realizationFraction(lever));
  }
  return doneActionImpactsTotal(lever, "gross");
}

/** Valeur "Plan initial" affichée pour un levier : le snapshot figé s'il existe, sinon la valeur
 * courante de `netSavings` en repli — même chaîne que celle utilisée par `sCurve3`/`financialTotal`
 * pour la courbe "Plan" agrégée, afin que la page détail d'un levier et le dashboard exécutif ne
 * se contredisent jamais. `isLocked` distingue un vrai snapshot figé d'une valeur de repli non
 * figée, pour que l'UI puisse le signaler sans induire l'utilisateur en erreur. */
export function displayedLockedPlanNet(lever: Lever): { value: number; isLocked: boolean } {
  return lever.lockedPlan
    ? { value: lever.lockedPlan.netSavings, isLocked: true }
    : { value: lever.netSavings, isLocked: false };
}

/** Valeur "Réactualisé" affichée pour un levier : le reforecast s'il existe, sinon le plan figé,
 * sinon `netSavings` — même chaîne de repli que la courbe "Réactualisé" de `sCurve3` (voir aussi
 * `programSummary.reforecastTarget`). `isReforecast` distingue un vrai reforecast d'une valeur de
 * repli non réactualisée. */
export function displayedReforecastNet(lever: Lever): { value: number; isReforecast: boolean } {
  if (lever.reforecast) return { value: lever.reforecast.netSavings, isReforecast: true };
  return { value: lever.lockedPlan?.netSavings ?? lever.netSavings, isReforecast: false };
}

/** Progression % affichée d'un levier — SEULE et UNIQUE formule utilisée partout où une
 *  "progression" de levier est montrée à l'utilisateur (bandeau Overview de la fiche détail,
 *  liste des leviers, page Workstreams) : `réalisé net à date / réactualisé net`, jamais le champ
 *  brut `lever.progress` (moyenne pondérée du statut des actions — sert encore aux automatismes de
 *  cycle de vie et de retard, `recomputeLeverProgress`/`scheduleGap`, mais plus à l'affichage).
 *  Si le ratio est négatif (réalisé négatif, ou réactualisé négatif), on affiche 0 % plutôt qu'un
 *  pourcentage négatif dénué de sens — dès qu'il redevient positif, le vrai pourcentage s'affiche
 *  (pas de plafond à 100 : un levier qui dépasse sa cible réactualisée peut légitimement afficher
 *  plus, les composants d'affichage (`RadialProgress`/`ProgressBar`) clampent déjà visuellement). */
export function displayedProgressPct(lever: Lever): number {
  const reforecast = displayedReforecastNet(lever).value;
  if (!reforecast) return 0;
  const pct = (realizedSavings(lever) / reforecast) * 100;
  return pct > 0 ? Math.round(pct) : 0;
}

export function realizedFte(lever: Lever): number {
  if (lever.status === "cancelled") return 0;
  if (lever.impacts && lever.impacts.length > 0) {
    return Math.round(leverImpactTotals(lever).fteNet * realizationFraction(lever) * 10) / 10;
  }
  return Math.round(doneActionImpactsTotal(lever, "fte") * 10) / 10;
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

  // Suppressions de postes (mouvements RH type "Départ forcé" — départs contraints /
  // licenciements, distincts de l'attrition volontaire), en ETP.
  const suppressionMoves = data.workforce.movements.filter((m) => m.type === "Départ forcé");
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

/** Sentinelle pour les montants dont le rattachement P&L n'a pas (encore) été précisé : à la
 *  création d'un levier, il n'y a plus de rattachement à un compte P&L par défaut (ça se fait au
 *  niveau de chaque action/impact, via `ActionImpact.hierarchyLeafId`) — tant qu'un impact n'a pas
 *  de rattachement fin, son montant apparaît dans ce bucket plutôt que d'être arbitrairement
 *  rattaché à un compte. */
/** Montant signé d'une ligne d'impact pour le P&L (gain +, coût −) ; `null` pour un gain one-off
 *  (jamais agrégé aux totaux annualisés). */
function impactSignedAmount(imp: LeverImpact): number | null {
  if (imp.type === "saving") return imp.gainRecurrence === "oneoff" ? null : imp.amount;
  if (imp.type === "fte") return imp.fteDirection === "hire" ? -imp.amount : imp.amount;
  return -imp.amount;
}

export const UNALLOCATED_ACCOUNT_ID = "__unallocated__";

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
 *  levier dessus, à plan=0/realized=0). Le rattachement de chaque montant suit cet ordre de
 *  priorité : 1) rattachement fin de CET impact (`ActionImpact.hierarchyLeafId`, voir
 *  `resolveImpactAccount`) ; 2) repli sur le rattachement du levier porteur (`hierarchyLeafId`,
 *  compat ascendante/legacy) ; 3) repli sur l'ancien système sans arborescence
 *  (`impact.pnlMap || lever.pnlMap`) ; 4) si toujours rien, le bucket `UNALLOCATED_ACCOUNT_ID`
 *  ("Gains non attribués"). Si aucune arborescence financière avec un niveau "pnl" n'est
 *  configurée, le comportement est identique à avant (aucun changement pour les entreprises sans
 *  arborescence). */
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

  // Même mécanique que `resolveLeverAccount`, appliquée au rattachement fin de CET impact
  // (`ActionImpact.hierarchyLeafId`) — résolution prioritaire, voir doc-comment ci-dessus.
  const resolveImpactAccount = (impact: LeverImpact): string | undefined => {
    if (!useHierarchy || !impact.hierarchyLeafId) return undefined;
    const path = resolveHierarchyPath(
      impact.hierarchyLeafId,
      financialNodes,
      hierarchyLevels ?? []
    );
    return path.find((entry) => entry.levelKey === pnlLevel!.key)?.code;
  };

  for (const lever of active) {
    const hierarchyAccount = resolveLeverAccount(lever);
    // Modèle actuel : impacts portés par le levier (gains one-off exclus : jamais dans le P&L
    // annualisé). Plan à la date de gain (sinon fin du levier) ; réalisé au prorata de
    // l'avancement des actions, à la date de livraison (sinon fin du levier).
    if (lever.impacts && lever.impacts.length > 0) {
      const frac = realizationFraction(lever);
      for (const impact of lever.impacts) {
        const signed = impactSignedAmount(impact);
        if (signed === null) continue;
        const account =
          resolveImpactAccount(impact) ??
          hierarchyAccount ??
          (impact.pnlMap || lever.pnlMap) ??
          UNALLOCATED_ACCOUNT_ID;
        const planDate = impact.gainDate ?? impact.capexDeploymentDate ?? lever.end;
        if (!periodFilter || dateMatchesPeriod(planDate, periodFilter)) addPlan(account, signed);
        if (frac > 0) {
          const realDate = lever.deliveredDate ?? lever.end;
          if (!periodFilter || dateMatchesPeriod(realDate, periodFilter)) {
            addRealized(account, signed * frac);
          }
        }
      }
      continue;
    }
    const actionImpacts = (lever.actions ?? []).flatMap((action) =>
      (action.impacts ?? []).map((impact) => ({ action, impact }))
    );
    if (actionImpacts.length > 0) {
      for (const { action, impact } of actionImpacts) {
        const account =
          resolveImpactAccount(impact) ??
          hierarchyAccount ??
          (impact.pnlMap || lever.pnlMap) ??
          UNALLOCATED_ACCOUNT_ID;
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
    const account = hierarchyAccount ?? lever.pnlMap ?? UNALLOCATED_ACCOUNT_ID;
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
        id === UNALLOCATED_ACCOUNT_ID
          ? "Gains non attribués"
          : ((useHierarchy ? pnlNodes.find((node) => node.code === id)?.label : undefined) ??
            data.pnlAccounts.find((a) => a.id === id)?.name ??
            id),
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
export const DEFAULT_RISK_THRESHOLDS: {
  level: RiskLevel;
  minAmount: number;
  delayDays?: number;
}[] = [
  { level: "critical", minAmount: 500_000, delayDays: 7 },
  { level: "high", minAmount: 200_000, delayDays: 15 },
  { level: "medium", minAmount: 50_000, delayDays: 30 },
  { level: "low", minAmount: 0, delayDays: 60 },
];

/** Rang de sévérité d'un RiskLevel, du plus élevé au plus faible — sert à comparer/combiner deux
 * critères de bascule indépendants (montant, délai) dans computeLeverRisk ci-dessous. */
const RISK_SEVERITY: Record<RiskLevel, number> = { critical: 3, high: 2, medium: 1, low: 0 };

/** Résultat enrichi de `computeLeverRisk` : garde le niveau (`level`, ce qui est stocké dans
 * `Lever.risk`) ET un motif textuel en français, concis (une phrase), prêt à afficher tel quel
 * dans un badge/tooltip UI — explique quel critère (montant ou délai, le plus sévère des deux) a
 * déterminé le niveau retenu, avec la valeur réelle et le seuil comparé. */
export type LeverRiskAssessment = {
  level: RiskLevel;
  reason: string;
};

const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  critical: "critique",
  high: "élevé",
  medium: "moyen",
  low: "faible",
};

function fmtRiskAmount(amount: number): string {
  return amount >= 1000
    ? `${(amount / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} k€`
    : `${Math.round(amount).toLocaleString("fr-FR")} €`;
}

/** Risque d'un levier dérivé des alertes qui lui sont liées (Alert.scope === leverId, non
 * résolues), segmenté par cumul de montant à risque (valeur absolue de Alert.impactEur) selon les
 * seuils de l'entreprise (ou les seuils par défaut). Un levier sans alerte chiffrée est "low".
 * Remplace la saisie manuelle de Lever.risk : c'est la nouvelle source de vérité, "vivante" — elle
 * évolue avec les alertes plutôt que d'être figée à la main.
 *
 * Second critère optionnel — `delayDays` par seuil : un levier bascule aussi à ce niveau si
 * l'ancienneté (en jours, depuis `Alert.createdAt`/`ts` en repli) de sa plus vieille alerte
 * ouverte dépasse ce délai, indépendamment du montant. Les deux critères sont évalués séparément,
 * et c'est le niveau le plus sévère des deux qui est retenu — un délai dépassé peut donc faire
 * monter le risque même si le montant cumulé reste sous le seuil, et inversement.
 *
 * Retourne un objet enrichi (`LeverRiskAssessment`) : `level` (le `RiskLevel` simple, à assigner à
 * `Lever.risk`) + `reason`, un texte expliquant lequel des deux critères a déterminé ce niveau. */
export function computeLeverRisk(
  leverId: string,
  alerts: Alert[],
  thresholds: {
    level: RiskLevel;
    minAmount: number;
    delayDays?: number;
  }[] = DEFAULT_RISK_THRESHOLDS,
  today: Date = new Date()
): LeverRiskAssessment {
  const scoped = alerts.filter((a) => a.scope === leverId && !a.resolved);
  const total = scoped
    .filter((a) => typeof a.impactEur === "number")
    .reduce((s, a) => s + Math.abs(a.impactEur ?? 0), 0);
  const oldestOpenDays = scoped.reduce((max, a) => {
    const raw = a.createdAt ?? a.ts;
    if (!raw) return max;
    const days = (today.getTime() - new Date(raw).getTime()) / 86_400_000;
    return Number.isFinite(days) ? Math.max(max, days) : max;
  }, 0);

  const bySeverityDesc = [...thresholds].sort(
    (a, b) => RISK_SEVERITY[b.level] - RISK_SEVERITY[a.level]
  );
  const amountThreshold = bySeverityDesc.find((t) => total >= t.minAmount);
  const byAmount = amountThreshold?.level ?? "low";
  const delayThreshold = bySeverityDesc.find(
    (t) => t.delayDays != null && oldestOpenDays >= t.delayDays
  );
  const byDelay = delayThreshold?.level;

  const level = byDelay && RISK_SEVERITY[byDelay] > RISK_SEVERITY[byAmount] ? byDelay : byAmount;

  let reason: string;
  if (level === "low") {
    reason = "Aucun critère de risque dépassé : niveau faible.";
  } else if (byDelay && RISK_SEVERITY[byDelay] >= RISK_SEVERITY[byAmount]) {
    reason = `Retard : la plus ancienne alerte ouverte date de ${Math.floor(oldestOpenDays)} jours (seuil ${RISK_LEVEL_LABELS[level]} : ${delayThreshold?.delayDays} jours).`;
  } else {
    reason = `Montant à risque : ${fmtRiskAmount(total)} d'alertes ouvertes (seuil ${RISK_LEVEL_LABELS[level]} : ${fmtRiskAmount(amountThreshold?.minAmount ?? 0)}).`;
  }

  return { level, reason };
}

/**
 * Un levier est "en retard" SI ET SEULEMENT SI au moins une de ses actions est en retard
 * (voir `isActionLate`) — c'est le SEUL mécanisme de détection de retard d'un levier
 * (remplace l'ancienne heuristique date/progression `expectedProgress - progress > 10`,
 * complètement déconnectée du plan d'action réel).
 *
 * Cas limite : un levier SANS AUCUNE action déclarée ne peut jamais être flaggé en retard par
 * cette fonction (il n'y a rien à évaluer) — c'est un changement de comportement assumé par
 * rapport à l'ancienne heuristique, qui pouvait détecter un retard purement sur start/end/progress
 * même à 0 action. Un levier sans plan d'action doit d'abord se voir doter d'actions pour être
 * suivi par ce mécanisme.
 *
 * `now` est calculé à chaque appel (`Date.now()` par défaut) plutôt que figé au chargement du
 * module, pour que l'écart affiché reste réellement temps réel sur une session longue.
 */
export function underperformers(data: BeTrackData, wsId?: string, now: number = Date.now()) {
  const today = new Date(now);
  return data.levers
    .filter((l) => (!wsId || l.ws === wsId) && l.status === "in_progress")
    .map((l) => {
      const lateActions = (l.actions ?? []).filter((a) => isActionLate(a, today));
      return { ...l, lateActionsCount: lateActions.length, lateActions };
    })
    .filter((x) => x.lateActionsCount > 0)
    .sort((a, b) => b.lateActionsCount - a.lateActionsCount);
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

/**
 * Une action est "en retard" si :
 *  - son statut a été manuellement mis à "delayed" par un utilisateur (retard explicite, qui
 *    peut couvrir une raison non capturée par la date seule — toujours vrai, quelle que soit la
 *    date), OU
 *  - elle n'est pas terminée ("done") ET sa date de fin (`end`) est déjà passée par rapport à
 *    `today`.
 *
 * C'est la SEULE source de vérité pour le retard d'une action dans l'application (Kanban, retard
 * d'un levier via `underperformers`, badges). `today` est un paramètre optionnel (défaut
 * `new Date()`) pour rester testable sans mocker l'horloge globale.
 */
export function isActionLate(action: LeverAction, today: Date = new Date()): boolean {
  // Une action terminée (statut « fait » OU avancement à 100 %) n'est jamais en retard.
  if (action.status === "done" || actionProgressPct(action) >= 100) return false;
  if (action.status === "delayed") return true;
  return new Date(action.end).getTime() < today.getTime();
}

/** Impact financier net (€M) d'une action — DEPRECATED : les impacts vivent sur le levier. Ne
 *  lit plus que l'ancien `action.impacts` (données non migrées). */
export function actionNetImpact(action: LeverAction): number {
  return (action.impacts ?? []).reduce(
    (sum, impact) => sum + (impact.type === "saving" ? impact.amount : -impact.amount),
    0
  );
}

/** Progression d'un plan d'action (liste d'actions) — pondérée si toutes les actions portent un
 *  `weightPct` sommant à 100, sinon moyenne simple ; jamais pondérée par des montants. */
export function actionProgress(actions: LeverAction[]): number {
  return leverActionProgress({ actions });
}

/**
 * Progression d'un levier : avancement pondéré de ses actions ; sans action, la valeur manuelle
 * existante est conservée inchangée.
 */
export function recomputeLeverProgress(lever: Lever): number {
  if (lever.actions && lever.actions.length > 0) {
    return leverActionProgress(lever);
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

/**
 * SÉRIE PARTAGÉE courbe en S + graphique en barres (pont) — une seule source de calcul pour que
 * les deux vues ne divergent plus. Cause de l'ancien écart : la S-curve lissait les montants avec
 * un noyau gaussien et plafonnait sur l'index de mois fiscal, alors que le pont bucketisait le
 * réalisé à la date de fin exacte des seuls leviers échus — deux règles de temporalité différentes.
 *
 * Règles communes (leviers annulés exclus de planned/reforecast/actual) :
 *  - planned    : net du plan figé (sinon net courant), cumulé à la date de fin du levier ;
 *  - reforecast : net réactualisé (repli plan figé, net courant), cumulé à la date de fin ;
 *  - actual     : réalisé (`realizedSavings`) cumulé à `deliveredDate`, sinon min(fin, aujourd'hui) —
 *                 donc le cumul à date == `programSummary.realized` ; null pour les périodes futures ;
 *  - gap        : écart PLANIFIÉ INITIAL − RÉALISÉ cumulé par période (`total`), décomposé en 2 écarts
 *                 successifs qui s'additionnent à `total` :
 *                   `adjustment` = planifié initial − réactualisé (sur/sous-performance : l'effet du
 *                     réajustement du plan lui-même, indépendant de l'exécution) ;
 *                   `delay`      = réactualisé − réalisé (écart d'exécution par rapport à la CIBLE
 *                     réactualisée), lui-même ventilé en `late` (leviers en retard : action en retard
 *                     ou fin dépassée non livrée) et `other` (le reste).
 *                 `cancelled` est un mémo (plan des leviers annulés échus, hors `total` car déjà
 *                 retirés du réactualisé).
 * Les dates hors exercice sont rattachées à la première/dernière période (comme avant).
 */
export type SavingsSeriesGap = {
  /** Écart total : planifié initial − réalisé = `adjustment` + `delay`. */
  total: number;
  /** Écart dû au réajustement du plan : planifié initial − réactualisé. */
  adjustment: number;
  /** Écart dû à l'exécution : réactualisé − réalisé = `late` + `other`. */
  delay: number;
  late: number;
  cancelled: number;
  other: number;
};
export type SavingsSeriesPoint = {
  month: string;
  planned: number;
  reforecast: number;
  actual: number | null;
  /** Réalisé apporté par cette seule période (pour le pont / barres). */
  actualDelta: number;
  gap: SavingsSeriesGap;
};

function isLeverLate(lever: Lever, today: Date): boolean {
  if (lever.status === "delivered" || lever.status === "cancelled") return false;
  if ((lever.actions ?? []).some((a) => isActionLate(a, today))) return true;
  return new Date(lever.end).getTime() < today.getTime();
}

export function savingsSeries(
  data: BeTrackData,
  granularity: TimeGranularity = "month",
  today: Date = new Date()
): SavingsSeriesPoint[] {
  const fyStart = new Date(data.program.fyStart);
  const all = data.levers;
  const active = all.filter((l) => l.status !== "cancelled");
  const cancelled = all.filter((l) => l.status === "cancelled");
  const N = 12;
  const idxOf = (date: string) => fiscalMonthIndex(date, fyStart);
  const todayIdx = Math.min(
    N - 1,
    Math.max(
      0,
      (today.getFullYear() - fyStart.getFullYear()) * 12 + today.getMonth() - fyStart.getMonth()
    )
  );

  const planned = new Array(N).fill(0);
  const reforecast = new Array(N).fill(0);
  const actualDelta = new Array(N).fill(0);
  const lateGap = new Array(N).fill(0);
  const otherGap = new Array(N).fill(0);
  const cancelledMemo = new Array(N).fill(0);
  const add = (arr: number[], i: number, v: number) => {
    for (let k = i; k < N; k++) arr[k] += v;
  };

  for (const l of active) {
    const endI = idxOf(l.end);
    const plan = l.lockedPlan?.netSavings ?? l.netSavings;
    const refo = displayedReforecastNet(l).value;
    add(planned, endI, plan);
    add(reforecast, endI, refo);
    const real = realizedSavings(l);
    let actI = -1;
    if (real !== 0) {
      const d = l.deliveredDate
        ? new Date(l.deliveredDate)
        : new Date(Math.min(new Date(l.end).getTime(), today.getTime()));
      actI = idxOf(d.toISOString().slice(0, 10));
      actualDelta[actI] += real;
    }
    const late = isLeverLate(l, today);
    for (let i = 0; i < N; i++) {
      const expected = i >= endI ? refo : 0;
      const got = actI >= 0 && i >= actI ? real : 0;
      const g = expected - got;
      if (late) lateGap[i] += g;
      else otherGap[i] += g;
    }
  }
  for (const l of cancelled) {
    add(cancelledMemo, idxOf(l.end), l.lockedPlan?.netSavings ?? l.netSavings);
  }

  const r1 = (n: number) => Math.round(n * 10) / 10;
  let cumActual = 0;
  const monthly: SavingsSeriesPoint[] = MONTH_LABELS.map((label, i) => {
    cumActual += actualDelta[i];
    const shown = i <= todayIdx;
    const late = lateGap[i];
    const other = otherGap[i];
    return {
      month: label,
      planned: r1(planned[i]),
      reforecast: r1(reforecast[i]),
      actual: shown ? r1(cumActual) : null,
      actualDelta: r1(actualDelta[i]),
      gap: shown
        ? {
            total: r1(planned[i] - cumActual),
            adjustment: r1(planned[i] - reforecast[i]),
            delay: r1(late + other),
            late: r1(late),
            other: r1(other),
            cancelled: r1(cancelledMemo[i]),
          }
        : { total: 0, adjustment: 0, delay: 0, late: 0, other: 0, cancelled: 0 },
    };
  });
  if (granularity === "month") return monthly;
  return [2, 5, 8, 11].map((endIdx, q) => {
    const from = q * 3;
    return {
      ...monthly[endIdx],
      month: `Q${q + 1}`,
      actualDelta: r1(monthly.slice(from, endIdx + 1).reduce((s, p) => s + p.actualDelta, 0)),
    };
  });
}

/** S-curve à 3 courbes (Plan initial / Réalisé / Réactualisé) — projection de `savingsSeries`
 * (mêmes valeurs que le pont `financialBridge`). Voir `savingsSeries` pour les règles. */
export function sCurve3(data: BeTrackData, granularity: TimeGranularity = "month") {
  return savingsSeries(data, granularity).map(({ month, planned, reforecast, actual }) => ({
    month,
    planned,
    reforecast,
    actual,
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
 * granularités proposées par le sélecteur mois/trimestre.
 *
 * Plafonné à la période en cours (comme la courbe "Réalisé" de `sCurve3`, voir son `currentMonthIdx`)
 * : un levier dont la date de fin est dans le futur n'a, par définition, rien de réalisé à ce jour,
 * même s'il a déjà de la progression — sans ce plafond, son montant apparaissait dans une période
 * future et gonflait le cumul final du bridge au-delà de ce qu'affiche la S-Curve au même instant. */
export function financialBridge(
  data: BeTrackData,
  granularity: TimeGranularity = "quarter"
): QuarterBridge[] {
  const now = new Date();
  // Même règle de temporalité que `savingsSeries` (courbe en S) : réalisé daté à `deliveredDate`,
  // sinon min(fin, aujourd'hui). Un levier sans réalisé n'apparaît que s'il est échu (delta 0).
  const active = data.levers.filter(
    (l) => l.status !== "cancelled" && (realizedSavings(l) !== 0 || new Date(l.end) <= now)
  );
  const byPeriod = new Map<string, number>();
  active.forEach((l) => {
    const real = realizedSavings(l);
    const d =
      real !== 0
        ? l.deliveredDate
          ? new Date(l.deliveredDate)
          : new Date(Math.min(new Date(l.end).getTime(), now.getTime()))
        : new Date(l.end);
    const key = periodSortKey(d, granularity);
    byPeriod.set(key, (byPeriod.get(key) ?? 0) + real);
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

// ─── Trajectoire des impacts (courbe en J réelle) ────────────────────────────

export type TrajectoryGranularity = "month" | "quarter" | "year";

/** Contribution d'un impact à une période (montant positif ; le sens est porté par `category`). */
export type TrajectoryItem = {
  impactId: string;
  label: string;
  category: "gain" | "opex" | "capex";
  recurrence: "recurring" | "oneoff";
  amount: number;
  planned: boolean;
};

export type ImpactTrajectoryPoint = {
  period: string;
  /** Détail des impacts contribuant à la période (pour le drill-down du graphique). */
  items: TrajectoryItem[];
  /** Début de période (ISO yyyy-mm-01). */
  periodStart: string;
  /** OPEX one-off de la période (montant positif = coût). */
  opexOneOff: number;
  /** OPEX récurrent : montant annualisé, compté à la date de début et à chaque anniversaire. */
  opexRec: number;
  /** CAPEX de la période : en une fois à sa date, ou lissé de capexStartDate à capexDeploymentDate. */
  capex: number;
  /** Gains récurrents annualisés : comptés à la date de début et à chaque anniversaire (+12 mois). */
  gains: number;
  /** Gains ponctuels (one-off) de la période — séparés, jamais agrégés aux gains annualisés. */
  oneOffGains: number;
  /** Cumul net gains récurrents + one-off − OPEX − CAPEX (vue trésorerie/J-curve). */
  cumulativeNet: number;
  /** Idem `cumulativeNet` mais SANS les gains one-off (cohérent avec les totaux savings). */
  cumulativeNetRecurring: number;
  /** Part PLANIFIÉE (statut « planned ») des montants ci-dessus — sous-ensemble de chaque colonne,
   *  à rendre en prévisionnel ; le reste (réalisé / en cours) est effectif depuis sa date de début. */
  planned: {
    opexOneOff: number;
    opexRec: number;
    capex: number;
    gains: number;
    oneOffGains: number;
  };
  /** Net cumulé (avec ponctuels) des seuls impacts effectifs (réalisés / en cours). */
  cumulativeNetActual: number;
  /** ETP cumulés en fin de période (+recrutements / −départs). */
  fte: number;
};

export type ImpactTrajectory = {
  points: ImpactTrajectoryPoint[];
  /** Index de la période contenant `today` (borné à [0, n-1]) — pour tracer le curseur. */
  todayIndex: number;
};

const monthIndexOf = (iso: string): number => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1;
  return y * 12 + (Number.isFinite(m) ? m : 0);
};

const isoOfMonthIndex = (mi: number): string =>
  `${Math.floor(mi / 12)}-${String((mi % 12) + 1).padStart(2, "0")}-01`;

/**
 * Trajectoire temporelle des impacts d'un ou plusieurs leviers (annulés exclus sauf
 * `includeCancelled`). Calendrier : du plus tôt des dates d'impact/levier à 12 mois après la
 * dernière (min. 24 mois de fenêtre pour montrer la récurrence).
 *  - dates : gain → `gainDate ?? lever.end` ; coût → `capexDeploymentDate ?? capexStartDate ?? lever.start`
 *  - CAPEX "smoothed" : réparti uniformément sur les mois capexStartDate → capexDeploymentDate
 *  - récurrent (gain annuel, OPEX récurrent, salaire ETP) : le montant ANNUALISÉ est acquis à la
 *    date de début puis à chaque date anniversaire (+12 mois) — jamais réparti/répété par mois
 *  - `view: "fte"` ne renseigne que la colonne ETP (les montants restent à 0).
 */
export function impactTrajectory(
  input: Lever | Lever[],
  opts: {
    granularity?: TrajectoryGranularity;
    view?: "financial" | "fte";
    today?: Date;
    includeCancelled?: boolean;
    /** Lisse les montants annualisés (gains, OPEX récurrent) : annuel / 12 par mois écoulé depuis
     *  la date de début, au lieu du montant complet à la date de début puis à chaque anniversaire. */
    smoothRecurring?: boolean;
  } = {}
): ImpactTrajectory {
  const granularity = opts.granularity ?? "month";
  const view = opts.view ?? "financial";
  const today = opts.today ?? new Date();
  const levers = (Array.isArray(input) ? input : [input]).filter(
    (l) => opts.includeCancelled || l.status !== "cancelled"
  );

  type Ev = {
    mi: number;
    kind: "oneoff_cost" | "capex" | "oneoff_gain";
    amount: number;
    planned: boolean;
    id: string;
    label: string;
  };
  type Rec = {
    from: number;
    kind: "opexRec" | "gain";
    annual: number;
    planned: boolean;
    id: string;
    label: string;
  };
  const events: Ev[] = [];
  const recs: Rec[] = [];
  const smoothed: {
    from: number;
    to: number;
    amount: number;
    planned: boolean;
    id: string;
    label: string;
  }[] = [];
  const fteEvents: { mi: number; delta: number }[] = [];

  for (const lever of levers) {
    for (const imp of leverImpactsOf(lever)) {
      const gainMi = monthIndexOf(imp.gainDate ?? lever.end);
      const costMi = monthIndexOf(imp.capexDeploymentDate ?? imp.capexStartDate ?? lever.start);
      const isGain = imp.type === "saving" || (imp.type === "fte" && imp.fteDirection !== "hire");
      const planned =
        impactStatusOf(imp, today, isGain ? (imp.gainDate ?? lever.end) : undefined) === "planned";
      if (imp.type === "fte") {
        const count = imp.fteCount ?? 0;
        fteEvents.push(
          imp.fteDirection === "hire" ? { mi: costMi, delta: count } : { mi: gainMi, delta: -count }
        );
      } else if (imp.fteCount) {
        fteEvents.push({ mi: imp.type === "saving" ? gainMi : costMi, delta: imp.fteCount });
      }
      if (isGain) {
        if (imp.type === "saving" && imp.gainRecurrence === "oneoff") {
          events.push({
            mi: gainMi,
            kind: "oneoff_gain",
            amount: imp.amount,
            planned,
            id: imp.id,
            label: imp.label,
          });
        } else {
          recs.push({
            from: gainMi,
            kind: "gain",
            annual: imp.amount,
            planned,
            id: imp.id,
            label: imp.label,
          });
        }
      } else if (imp.type === "fte") {
        recs.push({
          from: costMi,
          kind: "opexRec",
          annual: imp.amount,
          planned,
          id: imp.id,
          label: imp.label,
        });
      } else if (imp.nature === "capex") {
        if (imp.capexAllocationMode === "smoothed" && imp.capexStartDate) {
          const from = monthIndexOf(imp.capexStartDate);
          const to = Math.max(from, monthIndexOf(imp.capexDeploymentDate ?? imp.capexStartDate));
          smoothed.push({ from, to, amount: imp.amount, planned, id: imp.id, label: imp.label });
        } else {
          events.push({
            mi: costMi,
            kind: "capex",
            amount: imp.amount,
            planned,
            id: imp.id,
            label: imp.label,
          });
        }
      } else if (imp.nature === "oneoff") {
        events.push({
          mi: costMi,
          kind: "oneoff_cost",
          amount: imp.amount,
          planned,
          id: imp.id,
          label: imp.label,
        });
      } else {
        recs.push({
          from: costMi,
          kind: "opexRec",
          annual: imp.amount,
          planned,
          id: imp.id,
          label: imp.label,
        });
      }
    }
  }

  const todayMi = today.getFullYear() * 12 + today.getMonth();
  const marks = [
    ...events.map((e) => e.mi),
    ...recs.map((r) => r.from),
    ...smoothed.flatMap((x) => [x.from, x.to]),
    ...fteEvents.map((e) => e.mi),
    ...levers.map((l) => monthIndexOf(l.start)),
  ].filter((n) => Number.isFinite(n));
  if (marks.length === 0) return { points: [], todayIndex: 0 };
  let startMi = Math.min(...marks);
  const step = granularity === "year" ? 12 : granularity === "quarter" ? 3 : 1;
  if (granularity === "year") startMi = Math.floor(startMi / 12) * 12;
  if (granularity === "quarter") startMi = Math.floor(startMi / 3) * 3;
  // Fenêtre : ≥ 36 mois pour montrer au moins 2 dates anniversaires des impacts récurrents.
  const endMi = Math.max(Math.max(...marks) + 12, startMi + 35);

  const points: ImpactTrajectoryPoint[] = [];
  let cum = 0;
  let cumRec = 0;
  let cumActual = 0;
  let fteCum = 0;
  let todayIndex = 0;
  const r2 = (n: number) => Math.round(n * 1000) / 1000;
  for (let ps = startMi; ps <= endMi; ps += step) {
    const pe = ps + step - 1; // dernier mois inclus
    let opexOneOff = 0;
    let opexRec = 0;
    let capex = 0;
    let gains = 0;
    let oneOffGains = 0;
    const pl = { opexOneOff: 0, opexRec: 0, capex: 0, gains: 0, oneOffGains: 0 };
    const items: TrajectoryItem[] = [];
    const addItem = (
      x: { id: string; label: string; planned: boolean },
      category: TrajectoryItem["category"],
      recurrence: TrajectoryItem["recurrence"],
      amount: number
    ) => {
      if (view === "fte" || amount === 0) return;
      items.push({
        impactId: x.id,
        label: x.label,
        category,
        recurrence,
        amount: r2(amount),
        planned: x.planned,
      });
    };
    for (const e of events) {
      if (e.mi < ps || e.mi > pe) continue;
      addItem(
        e,
        e.kind === "capex" ? "capex" : e.kind === "oneoff_cost" ? "opex" : "gain",
        "oneoff",
        e.amount
      );
      if (e.kind === "capex") {
        capex += e.amount;
        if (e.planned) pl.capex += e.amount;
      } else if (e.kind === "oneoff_cost") {
        opexOneOff += e.amount;
        if (e.planned) pl.opexOneOff += e.amount;
      } else {
        oneOffGains += e.amount;
        if (e.planned) pl.oneOffGains += e.amount;
      }
    }
    for (const sm of smoothed) {
      const months = sm.to - sm.from + 1;
      const overlap = Math.max(0, Math.min(pe, sm.to) - Math.max(ps, sm.from) + 1);
      capex += (sm.amount * overlap) / months;
      if (sm.planned) pl.capex += (sm.amount * overlap) / months;
      addItem(sm, "capex", "oneoff", (sm.amount * overlap) / months);
    }
    for (const r of recs) {
      // Montant annualisé constaté à la date de début, puis « réannualisé » à chaque anniversaire.
      let v: number;
      if (opts.smoothRecurring) {
        const months = Math.max(0, pe - Math.max(ps, r.from) + 1);
        v = (r.annual * months) / 12;
      } else {
        let hits = 0;
        for (let a = r.from; a <= pe; a += 12) if (a >= ps) hits++;
        v = r.annual * hits;
      }
      addItem(r, r.kind === "gain" ? "gain" : "opex", "recurring", v);
      if (r.kind === "gain") {
        gains += v;
        if (r.planned) pl.gains += v;
      } else {
        opexRec += v;
        if (r.planned) pl.opexRec += v;
      }
    }
    fteCum = fteEvents.reduce((s, f) => (f.mi <= pe ? s + f.delta : s), 0);
    if (view === "fte") {
      opexOneOff = opexRec = capex = gains = oneOffGains = 0;
      pl.opexOneOff = pl.opexRec = pl.capex = pl.gains = pl.oneOffGains = 0;
    }
    cumRec += gains - opexOneOff - opexRec - capex;
    cum += gains + oneOffGains - opexOneOff - opexRec - capex;
    cumActual +=
      gains -
      pl.gains +
      (oneOffGains - pl.oneOffGains) -
      (opexOneOff - pl.opexOneOff) -
      (opexRec - pl.opexRec) -
      (capex - pl.capex);
    if (todayMi >= ps && todayMi <= pe) todayIndex = points.length;
    else if (todayMi > pe) todayIndex = points.length;
    points.push({
      period:
        granularity === "year"
          ? String(Math.floor(ps / 12))
          : granularity === "quarter"
            ? `Q${Math.floor((ps % 12) / 3) + 1} ${Math.floor(ps / 12)}`
            : `${MONTH_LABELS[ps % 12]} ${Math.floor(ps / 12)}`,
      periodStart: isoOfMonthIndex(ps),
      items,
      opexOneOff: r2(opexOneOff),
      opexRec: r2(opexRec),
      capex: r2(capex),
      gains: r2(gains),
      oneOffGains: r2(oneOffGains),
      cumulativeNet: r2(cum),
      cumulativeNetRecurring: r2(cumRec),
      planned: {
        opexOneOff: r2(pl.opexOneOff),
        opexRec: r2(pl.opexRec),
        capex: r2(pl.capex),
        gains: r2(pl.gains),
        oneOffGains: r2(pl.oneOffGains),
      },
      cumulativeNetActual: r2(cumActual),
      fte: Math.round(fteCum * 10) / 10,
    });
  }
  return { points, todayIndex: Math.min(points.length - 1, Math.max(0, todayIndex)) };
}

// ─── Cascade planifié → réactualisé → annulé → cible réactualisée ───────────

export type WaterfallStepKey =
  "initial" | "reforecast" | "cancelled" | "target" | "gross" | "opexRec" | "net";

export type WaterfallStep = {
  key: WaterfallStepKey;
  label: string;
  /** "total" = barre pleine depuis 0 ; "delta" = variation signée. */
  kind: "total" | "delta";
  value: number;
  /** Cumul après cette étape (€M). */
  cumulative: number;
};

export type SavingsWaterfall = {
  /** Groupe A : initial → ± réactualisé → − annulé → = cible ; groupe B : brut → − OPEX → = net. */
  steps: WaterfallStep[];
  /** Planifié initial annualisé (plan figé de TOUS les leviers, annulés inclus). */
  initial: number;
  /** Δ des leviers actifs réactualisés (réactualisé − plan figé). */
  reforecastDelta: number;
  /** Plan figé des leviers annulés (retiré de la cible). */
  cancelled: number;
  /** Net annualisé réactualisé (€M) = MÊME valeur que `savingsTriple(...).reforecast`
   *  (graphe "Réalisation des économies", KPI du dashboard). */
  target: number;
  /** Réalisé = MÊME valeur que `savingsTriple(...).realized` (KPI "économies réalisées"). */
  realized: number;
  remaining: number;
  /** Gain brut annualisé des leviers actifs (= net + OPEX récurrent). */
  gross: number;
  /** OPEX récurrent annuel des leviers actifs (déduit du brut pour obtenir le net). */
  opexRec: number;
};

/**
 * Cascade des économies ANNUALISÉES (€M), en deux groupes :
 *  (a) planifié initial (plan figé, tous leviers) ± réactualisé − annulé = cible réactualisée (net) ;
 *  (b) décomposition de cette cible : brut − OPEX récurrent = net.
 * Règle métier : net = brut − OPEX récurrent ; le CAPEX et les coûts one-off n'y entrent jamais.
 * Le net est celui de `savingsTriple` (scindé réalisé / reste à faire) ; le brut est dérivé
 * (net + OPEX récurrent) et le Δ réactualisé est dérivé de l'arrondi pour que tout boucle
 * exactement. Leviers annulés exclus de la cible.
 */
export function savingsWaterfall(data: BeTrackData): SavingsWaterfall {
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const active = data.levers.filter((l) => l.status !== "cancelled");
  const cancelledLevers = data.levers.filter((l) => l.status === "cancelled");
  const lockedOf = (l: Lever) => l.lockedPlan?.netSavings ?? l.netSavings;
  const realized = r1(active.reduce((s, l) => s + realizedSavings(l), 0));
  const target = r1(active.reduce((s, l) => s + displayedReforecastNet(l).value, 0));
  const opexRec = r1(active.reduce((s, l) => s + leverOpexRecOf(l), 0));
  const cancelled = r1(cancelledLevers.reduce((s, l) => s + lockedOf(l), 0));
  const initial = r1(data.levers.reduce((s, l) => s + lockedOf(l), 0));
  const reforecastDelta = r1(target + cancelled - initial);
  const gross = r1(target + opexRec);
  const steps: WaterfallStep[] = [
    {
      key: "initial",
      label: "Planifié initial",
      kind: "total",
      value: initial,
      cumulative: initial,
    },
    {
      key: "reforecast",
      label: "Réactualisé",
      kind: "delta",
      value: reforecastDelta,
      cumulative: r1(initial + reforecastDelta),
    },
    { key: "cancelled", label: "Annulé", kind: "delta", value: -cancelled, cumulative: target },
    {
      key: "target",
      label: "Cible réactualisée",
      kind: "total",
      value: target,
      cumulative: target,
    },
    { key: "gross", label: "Gain brut annualisé", kind: "total", value: gross, cumulative: gross },
    { key: "opexRec", label: "OPEX récurrent", kind: "delta", value: -opexRec, cumulative: target },
    { key: "net", label: "Net annualisé", kind: "total", value: target, cumulative: target },
  ];
  return {
    steps,
    initial,
    reforecastDelta,
    cancelled,
    target,
    realized,
    remaining: r1(target - realized),
    gross,
    opexRec,
  };
}

/** OPEX récurrent annuel d'un levier (snapshot réactualisé ?? plan figé ?? courant). */
export function leverOpexRecOf(l: Lever): number {
  const snap = l.reforecast ?? l.lockedPlan ?? l;
  return snap.opexRec ?? 0;
}

// ─── Finance par niveau de hiérarchie ───────────────────────────────────────

export type FinanceHierarchyRow = {
  nodeId: string;
  code: string;
  label: string;
  /** Planifié initial (plan figé, tous leviers y compris annulés). */
  planned: number;
  reforecast: number;
  cancelled: number;
  late: number;
  realized: number;
};

export const UNATTRIBUTED_NODE_ID = "__unattributed__";

/**
 * Finance (€M) par nœud du niveau `levelOrder` (`HierarchyLevelDef.order`) de l'arborescence
 * financière : chaque levier est rattaché via `hierarchyLeafId` (ou celui de ses impacts, au prorata
 * du |montant net| de chaque impact) puis remonté à l'ancêtre du niveau demandé via `parentId`.
 * Une feuille plus macro que le niveau demandé reste sur son propre nœud. Sans rattachement :
 * ligne "Non attribué". Le total de toutes les lignes égale la somme des leviers.
 */
export function financeByHierarchyLevel(
  data: BeTrackData,
  company: { hierarchyLevels?: HierarchyLevelDef[] } | null | undefined,
  levelOrder: number,
  nodes: HierarchyNode[],
  opts: { today?: Date } = {}
): FinanceHierarchyRow[] {
  const today = opts.today ?? new Date();
  const levels = company?.hierarchyLevels ?? [];
  const financial = nodesForDomain(nodes, "financial");
  const targetKey = levels.find((lv) => lv.order === levelOrder)?.key;
  const rows = new Map<string, FinanceHierarchyRow>();
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const rowFor = (id: string, code: string, label: string) => {
    let row = rows.get(id);
    if (!row) {
      row = {
        nodeId: id,
        code,
        label,
        planned: 0,
        reforecast: 0,
        cancelled: 0,
        late: 0,
        realized: 0,
      };
      rows.set(id, row);
    }
    return row;
  };
  const resolveNode = (leafId: string | undefined): HierarchyNode | undefined => {
    if (!leafId) return undefined;
    const chain = resolveHierarchyNodeChain(leafId, financial, levels);
    if (chain.length === 0) return undefined;
    return chain.find((n) => n.levelKey === targetKey) ?? chain[chain.length - 1];
  };

  for (const l of data.levers) {
    const locked = l.lockedPlan?.netSavings ?? l.netSavings;
    const isCancelled = l.status === "cancelled";
    const refo = isCancelled ? 0 : displayedReforecastNet(l).value;
    const real = isCancelled ? 0 : realizedSavings(l);
    const late = !isCancelled && isLeverLate(l, today) ? Math.max(0, refo - real) : 0;

    // Répartition par feuille
    const shares = new Map<string | undefined, number>();
    const imps = leverImpactsOf(l);
    for (const imp of imps) {
      const w = Math.abs(impactSignedAmount(imp) ?? 0);
      if (w === 0) continue;
      const key = imp.hierarchyLeafId ?? l.hierarchyLeafId;
      shares.set(key, (shares.get(key) ?? 0) + w);
    }
    if (shares.size === 0) shares.set(l.hierarchyLeafId, 1);
    const totalW = Array.from(shares.values()).reduce((s, v) => s + v, 0) || 1;

    for (const [leafId, w] of Array.from(shares.entries())) {
      const f = w / totalW;
      const node = resolveNode(leafId);
      const row = node
        ? rowFor(node.id, node.code, node.label)
        : rowFor(UNATTRIBUTED_NODE_ID, "", "Non attribué");
      row.planned += locked * f;
      row.reforecast += refo * f;
      if (isCancelled) row.cancelled += locked * f;
      row.late += late * f;
      row.realized += real * f;
    }
  }
  return Array.from(rows.values())
    .map((r) => ({
      ...r,
      planned: r1(r.planned),
      reforecast: r1(r.reforecast),
      cancelled: r1(r.cancelled),
      late: r1(r.late),
      realized: r1(r.realized),
    }))
    .sort((a, b) => b.planned - a.planned);
}
