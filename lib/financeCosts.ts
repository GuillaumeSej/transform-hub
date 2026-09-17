import type {
  ActionImpact,
  BeTrackData,
  HierarchyLevelDef,
  HierarchyNode,
  Lever,
  LeverAction,
  Workstream,
} from "@/types";
import { MONTH_LABELS } from "@/lib/engine";

/**
 * Sélecteurs purs pour les graphiques de suivi des coûts du module Finance
 * (app/(app)/finance/page.tsx). Toutes les données proviennent de `data.levers[].actions[].
 * impacts[]` (type `ActionImpact`, voir types/index.ts) — AUCUNE donnée en dur : un impact de
 * type "cost" créé/modifié dans le formulaire d'action (components/shared/ActionForm.tsx) se
 * reflète immédiatement ici.
 *
 * Fonctions pures, testables sans React/Firestore — voir lib/__tests__/financeCosts.test.ts.
 */

export type FinanceGranularity = "month" | "quarter" | "year";

export type CostImpactRow = {
  impact: ActionImpact;
  action: LeverAction;
  lever: Lever;
};

export type SavingImpactRow = {
  impact: ActionImpact;
  action: LeverAction;
  lever: Lever;
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Aplatit tous les impacts de type "cost" de tous les leviers/actions, avec leur levier/action
 *  parent — exclut les leviers annulés (même filtre que `programSummary`/`realizedSavings` dans
 *  lib/engine.ts). */
export function flattenCostImpacts(data: BeTrackData): CostImpactRow[] {
  return data.levers
    .filter((lever) => lever.status !== "cancelled")
    .flatMap((lever) =>
      (lever.actions ?? []).flatMap((action) =>
        (action.impacts ?? [])
          .filter((impact) => impact.type === "cost")
          .map((impact) => ({ impact, action, lever }))
      )
    );
}

/** Aplatit tous les impacts de type "saving" de tous les leviers/actions, avec leur levier/action
 *  parent — même filtre d'exclusion (leviers annulés) que `flattenCostImpacts`. */
export function flattenSavingImpacts(data: BeTrackData): SavingImpactRow[] {
  return data.levers
    .filter((lever) => lever.status !== "cancelled")
    .flatMap((lever) =>
      (lever.actions ?? []).flatMap((action) =>
        (action.impacts ?? [])
          .filter((impact) => impact.type === "saving")
          .map((impact) => ({ impact, action, lever }))
      )
    );
}

/** Leviers actifs qui portent un coût CAPEX/OPEX chiffré au niveau du levier (champs cachés
 *  `capex`/`opexOneOff`/`opexRec`, saisie manuelle sans plan d'action détaillé) mais dont AUCUN
 *  impact "cost" n'apparaît dans `flattenCostImpacts` — parce qu'ils n'ont pas d'`actions`, ou que
 *  leurs actions n'ont aucun impact de type "cost". Tous les graphiques de `financeCosts.ts`
 *  (engagé/à venir, répartition par centre de coût, timeline...) sont construits exclusivement à
 *  partir de `flattenCostImpacts` (source de vérité "plan d'action"), donc CES leviers n'y
 *  contribuent jamais et n'apparaissent dans AUCUN graphique — pas seulement celui par centre de
 *  coût. Sert à afficher une note explicite ("N leviers sans plan d'action détaillé, non inclus")
 *  plutôt qu'un silence trompeur ("aucun coût saisi") quand ces leviers existent bel et bien avec
 *  un CAPEX/OPEX renseigné. */
export function leversWithUndetailedCosts(data: BeTrackData): Lever[] {
  const leversWithCostImpacts = new Set(flattenCostImpacts(data).map((row) => row.lever.id));
  return data.levers.filter(
    (lever) =>
      lever.status !== "cancelled" &&
      !leversWithCostImpacts.has(lever.id) &&
      (lever.capex > 0 || lever.opexOneOff > 0 || lever.opexRec > 0)
  );
}

/** Un coût "Invest" = CAPEX ou OPEX one-off, à l'exclusion de l'OPEX récurrent — périmètre commun
 *  à `CostEngagedVsUpcomingChart`, `CostCommitmentTimelineChart` et à la série "Coûts (Invest)" du
 *  nouveau graphique Invest vs Savings. */
export function isInvestNature(nature: ActionImpact["nature"]): boolean {
  return nature !== "opex_rec";
}

/** Date de référence d'un coût pour le bucketing temporel :
 *  - CAPEX one-shot : `capexDeploymentDate` (date de comptabilisation).
 *  - CAPEX lissé : `capexStartDate` (début de la période de lissage) — la fin est
 *    `capexDeploymentDate`, voir `bucketCostsByPeriod` qui répartit le montant entre les deux.
 *  - OPEX (récurrent ou one-off), ou CAPEX sans date renseignée : date de début de l'action, seule
 *    date toujours disponible sur une ligne de coût. */
function referenceDate(impact: ActionImpact, action: LeverAction): string {
  if (impact.nature === "capex") {
    if (impact.capexAllocationMode === "smoothed" && impact.capexStartDate) {
      return impact.capexStartDate;
    }
    if (impact.capexDeploymentDate) return impact.capexDeploymentDate;
  }
  return action.start;
}

/** Date de référence d'un gain : `gainDate` (encaissement réel) si renseignée, sinon date de
 *  début de l'action qui le porte — même repli que `referenceDate` pour les coûts. */
function savingReferenceDate(impact: ActionImpact, action: LeverAction): string {
  return impact.gainDate ?? action.start;
}

/** Un coût est "déjà engagé" si sa date de référence (voir `referenceDate`) est passée, ou —
 *  pour un OPEX sans date CAPEX dédiée — si l'action qui le porte est en cours ou terminée. Un
 *  levier/action encore "à faire" avec une date de début future reste "à venir". */
export function isCostEngaged(
  row: Pick<CostImpactRow, "impact" | "action">,
  today: Date = new Date()
): boolean {
  const { impact, action } = row;
  if (impact.nature === "capex") {
    const refDate =
      impact.capexAllocationMode === "smoothed"
        ? impact.capexStartDate
        : impact.capexDeploymentDate;
    if (refDate) return new Date(refDate).getTime() <= today.getTime();
  }
  if (action.status === "done") return true;
  if (action.status === "delayed") return true; // en retard = déjà censé être engagé
  if (action.status === "in_progress") return new Date(action.start).getTime() <= today.getTime();
  return false; // "todo" : pas encore engagé
}

/** Répartition Engagé / À venir / Total (€M) des coûts "Invest" (CAPEX + OPEX one-off,
 *  OPEX récurrent EXCLU — décision produit round finance-charts-v2) — alimente
 *  `CostEngagedVsUpcomingChart`. */
export function splitEngagedVsUpcoming(
  data: BeTrackData,
  today: Date = new Date()
): { engaged: number; upcoming: number; total: number } {
  const rows = flattenCostImpacts(data).filter(({ impact }) => isInvestNature(impact.nature));
  let engaged = 0;
  let upcoming = 0;
  for (const row of rows) {
    if (isCostEngaged(row, today)) engaged += row.impact.amount;
    else upcoming += row.impact.amount;
  }
  return {
    engaged: round2(engaged),
    upcoming: round2(upcoming),
    total: round2(engaged + upcoming),
  };
}

/** Lignes de coût "Invest" (CAPEX + OPEX one-off) déjà engagées ou à venir — pendant "détail" de
 *  `splitEngagedVsUpcoming`, utilisé pour le drill-down par workstream/levier au clic sur un
 *  segment du donut. */
export function investCostRowsBySegment(
  data: BeTrackData,
  engaged: boolean,
  today: Date = new Date()
): CostImpactRow[] {
  return flattenCostImpacts(data)
    .filter(({ impact }) => isInvestNature(impact.nature))
    .filter((row) => isCostEngaged(row, today) === engaged);
}

/** Répartition CAPEX / OPEX récurrent / One-off (€M) — sélecteur conservé pour compat (n'alimente
 *  plus aucun graphique depuis la suppression de `CapexOpexBreakdownChart`, remplacé par la
 *  répartition par centre de coût/P&L, voir `costsByHierarchyNode`). */
export function splitByNature(data: BeTrackData): {
  capex: number;
  opexRec: number;
  oneoff: number;
} {
  const rows = flattenCostImpacts(data);
  let capex = 0;
  let opexRec = 0;
  let oneoff = 0;
  for (const { impact } of rows) {
    if (impact.nature === "capex") capex += impact.amount;
    else if (impact.nature === "opex_rec") opexRec += impact.amount;
    else oneoff += impact.amount;
  }
  return { capex: round2(capex), opexRec: round2(opexRec), oneoff: round2(oneoff) };
}

export type CostPeriodPoint = {
  period: string;
  sortKey: string;
  delta: number;
  cumulative: number;
};

/** Clé de tri chronologique "YYYY", "YYYY-Q" ou "YYYY-MM" pour un point temporel — même principe
 *  que `periodSortKey` dans lib/engine.ts (non exporté), étendu à la granularité "year". */
function periodSortKey(d: Date, granularity: FinanceGranularity): string {
  if (granularity === "year") return `${d.getFullYear()}`;
  if (granularity === "quarter") return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
  return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
}

function periodLabel(sortKey: string, granularity: FinanceGranularity): string {
  if (granularity === "year") return sortKey;
  const [year, part] = sortKey.split(granularity === "quarter" ? "-Q" : "-");
  return granularity === "quarter" ? `Q${part} ${year}` : `${MONTH_LABELS[Number(part)]} ${year}`;
}

/** Liste ordonnée des clés de période (mois) couvrant [start, end] inclus — sert à répartir un
 *  CAPEX lissé au prorata sur sa période de lissage. */
function monthKeysBetween(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor.getTime() <= last.getTime()) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth()).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys.length > 0 ? keys : [periodSortKey(start, "month")];
}

/** Une ligne de coût attribuée à UNE période (clé de tri incluse), avec le montant EFFECTIVEMENT
 *  attribué à cette période — pour un CAPEX lissé, une même ligne source produit plusieurs entrées
 *  (une par mois de sa période de lissage, chacune au prorata), regroupées ensuite par
 *  `periodSortKey` selon la granularité demandée. Sert à la fois à `bucketCostsByPeriod` (agrégat)
 *  et au drill-down par période (`costRowsForPeriod`), qui a besoin du détail levier/workstream
 *  derrière chaque bucket. */
type PeriodAttributedCostRow = CostImpactRow & { periodAmount: number; periodKey: string };

function attributeCostRowsToPeriods(
  rows: CostImpactRow[],
  granularity: FinanceGranularity
): PeriodAttributedCostRow[] {
  const out: PeriodAttributedCostRow[] = [];
  for (const row of rows) {
    const { impact, action } = row;
    if (
      impact.nature === "capex" &&
      impact.capexAllocationMode === "smoothed" &&
      impact.capexStartDate &&
      impact.capexDeploymentDate
    ) {
      const start = new Date(impact.capexStartDate);
      const end = new Date(impact.capexDeploymentDate);
      const months = monthKeysBetween(start <= end ? start : end, start <= end ? end : start);
      const perMonth = impact.amount / months.length;
      for (const monthKey of months) {
        const [year, month] = monthKey.split("-").map(Number);
        const d = new Date(year, month, 1);
        out.push({ ...row, periodAmount: perMonth, periodKey: periodSortKey(d, granularity) });
      }
      continue;
    }
    const ref = new Date(referenceDate(impact, action));
    out.push({ ...row, periodAmount: impact.amount, periodKey: periodSortKey(ref, granularity) });
  }
  return out;
}

function pointsFromPeriodAmounts(byPeriod: Map<string, number>): CostPeriodPoint[] {
  const sortedKeys = Array.from(byPeriod.keys()).sort();
  let cumulative = 0;
  return sortedKeys.map((key) => {
    const delta = round2(byPeriod.get(key) ?? 0);
    cumulative = round2(cumulative + delta);
    return {
      period: periodLabel(key, granularityHintFromKey(key)),
      sortKey: key,
      delta,
      cumulative,
    };
  });
}

/** Devine la granularité d'une clé de période ("YYYY", "YYYY-Q#" ou "YYYY-MM") pour reformater son
 *  libellé — évite de faire porter la granularité en paramètre partout où une clé suffit déjà. */
function granularityHintFromKey(key: string): FinanceGranularity {
  if (key.includes("-Q")) return "quarter";
  if (key.includes("-")) return "month";
  return "year";
}

/** Engagement des coûts dans le temps (€M par période + cumul), pour le graphique de suivi
 *  temporel avec toggle mensuel/trimestriel/annuel. Un CAPEX lissé (`capexAllocationMode ===
 *  "smoothed"`) est réparti au prorata sur chaque mois de sa période [capexStartDate,
 *  capexDeploymentDate], puis regroupé selon la granularité demandée ; tout le reste (CAPEX
 *  one-shot, OPEX) est affecté en bloc à sa `referenceDate`.
 *
 *  `natureFilter`, optionnel, restreint les lignes de coût prises en compte (ex. Invest uniquement
 *  — `isInvestNature` — pour `CostCommitmentTimelineChart` et la série "Coûts (Invest)" du
 *  graphique Invest vs Savings). Omis = tous les coûts (comportement historique). */
export function bucketCostsByPeriod(
  data: BeTrackData,
  granularity: FinanceGranularity = "quarter",
  natureFilter?: (nature: ActionImpact["nature"]) => boolean
): CostPeriodPoint[] {
  let rows = flattenCostImpacts(data);
  if (natureFilter) rows = rows.filter(({ impact }) => natureFilter(impact.nature));
  const attributed = attributeCostRowsToPeriods(rows, granularity);
  const byPeriod = new Map<string, number>();
  for (const row of attributed) {
    byPeriod.set(row.periodKey, (byPeriod.get(row.periodKey) ?? 0) + row.periodAmount);
  }
  return pointsFromPeriodAmounts(byPeriod);
}

/** Détail des lignes de coût (avec leur montant attribué) qui contribuent à UNE période donnée
 *  (`periodKey`, tel que renvoyé dans `CostPeriodPoint.sortKey` par `bucketCostsByPeriod`) — sert
 *  au drill-down au clic sur une barre de `CostCommitmentTimelineChart`. Même `natureFilter` que
 *  `bucketCostsByPeriod` : à fournir identique pour rester cohérent avec le montant affiché sur la
 *  barre cliquée. */
export function costRowsForPeriod(
  data: BeTrackData,
  granularity: FinanceGranularity,
  periodKey: string,
  natureFilter?: (nature: ActionImpact["nature"]) => boolean
): { lever: Lever; amount: number }[] {
  let rows = flattenCostImpacts(data);
  if (natureFilter) rows = rows.filter(({ impact }) => natureFilter(impact.nature));
  return attributeCostRowsToPeriods(rows, granularity)
    .filter((row) => row.periodKey === periodKey)
    .map((row) => ({ lever: row.lever, amount: row.periodAmount }));
}

/** Coûts OPEX récurrents (run-rate annuel) par période, à partir de la date de début de l'action
 *  qui les porte — alimente `OpexRecurrentChart`. Simplification assumée : un OPEX récurrent n'a
 *  pas de date de fin dans le modèle actuel (voir ActionImpact), donc chaque ligne est affichée
 *  une seule fois, sur la période de démarrage de son action — pas répétée automatiquement sur
 *  les périodes suivantes. */
export function bucketRecurrentOpexByPeriod(
  data: BeTrackData,
  granularity: FinanceGranularity = "quarter"
): CostPeriodPoint[] {
  const rows = flattenCostImpacts(data).filter(({ impact }) => impact.nature === "opex_rec");
  const byPeriod = new Map<string, number>();
  for (const { impact, action } of rows) {
    const d = new Date(action.start);
    const key = periodSortKey(d, granularity);
    byPeriod.set(key, (byPeriod.get(key) ?? 0) + impact.amount);
  }
  return pointsFromPeriodAmounts(byPeriod);
}

/** Détail des lignes d'OPEX récurrent démarrées sur UNE période donnée — pendant "détail" de
 *  `bucketRecurrentOpexByPeriod`, pour le drill-down au clic sur la barre d'`OpexRecurrentChart`. */
export function recurrentOpexRowsForPeriod(
  data: BeTrackData,
  granularity: FinanceGranularity,
  periodKey: string
): { lever: Lever; amount: number }[] {
  return flattenCostImpacts(data)
    .filter(({ impact }) => impact.nature === "opex_rec")
    .filter(({ action }) => periodSortKey(new Date(action.start), granularity) === periodKey)
    .map(({ lever, impact }) => ({ lever, amount: impact.amount }));
}

/** Gains bruts (tous les impacts `type==="saving"`) par période — même principe non-répété que
 *  `bucketRecurrentOpexByPeriod` : chaque gain est affiché une seule fois, sur sa période de
 *  référence (`gainDate` si renseignée, sinon date de début de l'action). */
export function bucketSavingsByPeriod(
  data: BeTrackData,
  granularity: FinanceGranularity = "quarter"
): CostPeriodPoint[] {
  const rows = flattenSavingImpacts(data);
  const byPeriod = new Map<string, number>();
  for (const { impact, action } of rows) {
    const d = new Date(savingReferenceDate(impact, action));
    const key = periodSortKey(d, granularity);
    byPeriod.set(key, (byPeriod.get(key) ?? 0) + impact.amount);
  }
  return pointsFromPeriodAmounts(byPeriod);
}

export type InvestVsSavingsPoint = {
  period: string;
  sortKey: string;
  /** Coûts d'investissement (CAPEX + OPEX one-off) de la période — même logique de lissage que
   *  `bucketCostsByPeriod`. */
  investCost: number;
  /** Somme des gains (`type==="saving"`) dont la période de référence tombe sur cette période. */
  grossSavings: number;
  /** OPEX récurrent démarré sur cette période (voir `bucketRecurrentOpexByPeriod`). */
  opexRecStarted: number;
  /** `grossSavings - opexRecStarted`. */
  netSavings: number;
};

/** Compare, période par période, les coûts d'investissement (CAPEX + OPEX one-off, intégrés à
 *  leurs dates réelles) aux gains — bruts et nets de l'OPEX récurrent démarré sur la même période.
 *  Alimente le nouveau graphique "Coûts (Invest) vs Savings" (barres empilées gains nets + OPEX
 *  récurrent, comparées à la barre coûts Invest, tooltip détaillé au survol). */
export function bucketInvestVsSavingsByPeriod(
  data: BeTrackData,
  granularity: FinanceGranularity = "quarter"
): InvestVsSavingsPoint[] {
  const investPoints = bucketCostsByPeriod(data, granularity, isInvestNature);
  const savingsPoints = bucketSavingsByPeriod(data, granularity);
  const opexPoints = bucketRecurrentOpexByPeriod(data, granularity);

  const byKey = new Map<
    string,
    { investCost: number; grossSavings: number; opexRecStarted: number }
  >();
  const ensure = (key: string) => {
    let entry = byKey.get(key);
    if (!entry) {
      entry = { investCost: 0, grossSavings: 0, opexRecStarted: 0 };
      byKey.set(key, entry);
    }
    return entry;
  };
  investPoints.forEach((p) => {
    ensure(p.sortKey).investCost = p.delta;
  });
  savingsPoints.forEach((p) => {
    ensure(p.sortKey).grossSavings = p.delta;
  });
  opexPoints.forEach((p) => {
    ensure(p.sortKey).opexRecStarted = p.delta;
  });

  const sortedKeys = Array.from(byKey.keys()).sort();
  return sortedKeys.map((key) => {
    const v = byKey.get(key)!;
    return {
      period: periodLabel(key, granularityHintFromKey(key)),
      sortKey: key,
      investCost: round2(v.investCost),
      grossSavings: round2(v.grossSavings),
      opexRecStarted: round2(v.opexRecStarted),
      netSavings: round2(v.grossSavings - v.opexRecStarted),
    };
  });
}

// ─── Drill-down par workstream → levier, commun aux graphiques (a)/(d)/(e) ───────────────────

export type LeverCostAmount = {
  leverId: string;
  leverCode: string;
  leverName: string;
  amount: number;
};

export type WorkstreamCostGroup = {
  wsId: string;
  wsName: string;
  color: string;
  amount: number;
  levers: LeverCostAmount[];
};

/** Regroupe une liste de {lever, amount} (déjà filtrée par l'appelant — segment engagé/à venir,
 *  période cliquée, etc.) par workstream (`Lever.ws`) puis par levier, triés par montant
 *  décroissant. Réutilisé par `CostDrilldownModal` pour tous les graphiques cliquables du module
 *  Finance. */
export function groupCostsByWorkstream(
  entries: { lever: Lever; amount: number }[],
  workstreams: Workstream[]
): WorkstreamCostGroup[] {
  const wsById = new Map(workstreams.map((w) => [w.id, w]));
  const byWs = new Map<string, Map<string, LeverCostAmount>>();
  for (const { lever, amount } of entries) {
    if (amount === 0) continue;
    const leverMap = byWs.get(lever.ws) ?? new Map<string, LeverCostAmount>();
    const existing = leverMap.get(lever.id);
    leverMap.set(lever.id, {
      leverId: lever.id,
      leverCode: lever.code,
      leverName: lever.name,
      amount: round2((existing?.amount ?? 0) + amount),
    });
    byWs.set(lever.ws, leverMap);
  }
  const groups: WorkstreamCostGroup[] = [];
  for (const [wsId, leverMap] of Array.from(byWs.entries())) {
    const ws = wsById.get(wsId);
    const levers = Array.from(leverMap.values()).sort((a, b) => b.amount - a.amount);
    const amount = round2(levers.reduce((sum, l) => sum + l.amount, 0));
    groups.push({ wsId, wsName: ws?.name ?? wsId, color: ws?.color ?? "#806659", amount, levers });
  }
  return groups.sort((a, b) => b.amount - a.amount);
}

// ─── Répartition par centre de coût / P&L (arborescence financière) ──────────────────────────

export type HierarchyCostSlice = {
  node: HierarchyNode;
  amount: number;
  /** Lignes de coût (avec levier) qui contribuent à cette part — utilisé pour le drill-down par
   *  workstream au clic sur la maille la plus fine. */
  rows: { lever: Lever; amount: number }[];
  /** `true` s'il existe des `HierarchyNode` enfants (niveau suivant, `parentId === node.id`) — le
   *  composant descend d'un niveau au clic si `true`, sinon ouvre directement la décomposition par
   *  workstream. */
  hasChildren: boolean;
};

function resolveAncestorAtLevel(
  leafId: string,
  levelKey: string,
  byId: Map<string, HierarchyNode>
): HierarchyNode | null {
  let cur: HierarchyNode | null = byId.get(leafId) ?? null;
  while (cur) {
    if (cur.levelKey === levelKey) return cur;
    cur = cur.parentId ? (byId.get(cur.parentId) ?? null) : null;
  }
  return null;
}

/** Niveaux financiers configurés pour l'entreprise, triés par `order` croissant (le plus macro en
 *  premier) — vue affichée initialement par le donut "Répartition des coûts par centre de coût /
 *  P&L" (`levels[0]`). */
export function sortedHierarchyLevels(levels: HierarchyLevelDef[]): HierarchyLevelDef[] {
  return [...levels].sort((a, b) => a.order - b.order);
}

/** Répartition des coûts (tous types de nature confondus — CAPEX, OPEX récurrent, one-off) par
 *  nœud d'arborescence financière, à un niveau (`levelKey`) et sous un parent donnés (`parentId`,
 *  `null` = niveau racine). Un levier sans `hierarchyLeafId`, ou dont la chaîne de `parentId` ne
 *  remonte pas jusqu'à `levelKey`, n'est compté dans aucune part (plutôt que dans une part
 *  "Non affecté" fictive — le produit demande un état vide clair si l'arborescence n'est pas
 *  configurée, pas une part fourre-tout). */
export function costsByHierarchyNode(
  data: BeTrackData,
  hierarchyNodes: HierarchyNode[],
  levelKey: string,
  parentId: string | null
): HierarchyCostSlice[] {
  const byId = new Map(hierarchyNodes.map((n) => [n.id, n]));
  const childrenParentIds = new Set(
    hierarchyNodes.filter((n) => n.parentId).map((n) => n.parentId as string)
  );
  const rows = flattenCostImpacts(data);
  const nodesAtLevel = hierarchyNodes.filter(
    (n) => n.levelKey === levelKey && (n.parentId ?? null) === (parentId ?? null)
  );

  return nodesAtLevel
    .map((node) => {
      const nodeRows = rows
        .filter(({ lever }) => {
          if (!lever.hierarchyLeafId) return false;
          const ancestor = resolveAncestorAtLevel(lever.hierarchyLeafId, levelKey, byId);
          return ancestor?.id === node.id;
        })
        .map(({ lever, impact }) => ({ lever, amount: impact.amount }));
      const amount = round2(nodeRows.reduce((sum, r) => sum + r.amount, 0));
      return { node, amount, rows: nodeRows, hasChildren: childrenParentIds.has(node.id) };
    })
    .filter((slice) => slice.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}
