import type {
  ActionImpact,
  BeTrackData,
  HierarchyLevelDef,
  HierarchyNode,
  Lever,
  Workstream,
} from "@/types";
import {
  MONTH_LABELS,
  displayedReforecastSnapshot,
  isInvestCostEngaged,
  leverEngagedInvestCost,
  leverImpactsOf,
  leverOpexRecOf,
} from "@/lib/engine";
import { fiscalYearLabel } from "@/lib/fiscalYear";
import { impactDatesOf, isFteHire, isWorkingCapitalImpact } from "@/lib/impactKinds";
import { parseLocalDate } from "@/lib/impactStatus";

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
  lever: Lever;
};

export type SavingImpactRow = {
  impact: ActionImpact;
  lever: Lever;
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Aplatit tous les impacts de type "cost" des leviers actifs (via `leverImpactsOf` : impacts
 *  portés par le levier, repli sur les anciens impacts d'actions) — exclut les leviers annulés
 *  (même filtre que `programSummary`/`realizedSavings`). Les impacts "fte" sont exclus (leur
 *  salaire chargé est traité par le moteur ETP, pas comme coût d'investissement). */
export function flattenCostImpacts(data: BeTrackData): CostImpactRow[] {
  return data.levers
    .filter((lever) => lever.status !== "cancelled")
    .flatMap((lever) =>
      leverImpactsOf(lever)
        .filter((impact) => impact.type === "cost")
        .map((impact) => ({ impact, lever }))
    );
}

/** Aplatit les impacts "saving" RÉCURRENTS des leviers actifs. Les gains one-off sont exclus des
 *  totaux de savings (voir `flattenOneOffGainImpacts` pour les afficher à part). */
export function flattenSavingImpacts(data: BeTrackData): SavingImpactRow[] {
  return data.levers
    .filter((lever) => lever.status !== "cancelled")
    .flatMap((lever) =>
      leverImpactsOf(lever)
        .filter(
          (impact) =>
            impact.type === "saving" &&
            impact.gainRecurrence !== "oneoff" &&
            !isWorkingCapitalImpact(impact)
        )
        .map((impact) => ({ impact, lever }))
    );
}

/** Gains ponctuels (one-off) des leviers actifs — à afficher séparément, jamais dans les savings. */
export function flattenOneOffGainImpacts(data: BeTrackData): SavingImpactRow[] {
  return data.levers
    .filter((lever) => lever.status !== "cancelled")
    .flatMap((lever) =>
      leverImpactsOf(lever)
        .filter(
          (impact) =>
            impact.type === "saving" &&
            impact.gainRecurrence === "oneoff" &&
            !isWorkingCapitalImpact(impact)
        )
        .map((impact) => ({ impact, lever }))
    );
}

/** Leviers actifs qui portent un coût CAPEX/OPEX RÉACTUALISÉ (`displayedReforecastSnapshot`,
 *  saisie macro au niveau du levier, sans plan de coûts détaillé) mais dont AUCUN impact "cost"
 *  n'apparaît dans `flattenCostImpacts`. Leurs coûts Invest (CAPEX + OPEX ponctuel) sont comptés
 *  dans le donut engagé / à venir, l'engagement des coûts et « Invest vs Savings » (lignes
 *  synthétiques `undetailedInvestCostRows`, audit lot 6), mais la répartition par compte P&L /
 *  centre de coût (`costsByHierarchyNode`) ne peut pas les ventiler : sert à l'écrire dans la note
 *  de périmètre de ce donut plutôt qu'un silence trompeur. */
export function leversWithUndetailedCosts(data: BeTrackData): Lever[] {
  const leversWithCostImpacts = new Set(flattenCostImpacts(data).map((row) => row.lever.id));
  return data.levers.filter((lever) => {
    if (lever.status === "cancelled" || leversWithCostImpacts.has(lever.id)) return false;
    const snap = displayedReforecastSnapshot(lever);
    return snap.capex > 0 || snap.opexOneOff > 0 || snap.opexRec > 0;
  });
}

/** Lignes de coût Invest SYNTHÉTIQUES des leviers SANS ligne de coût Invest (saisie macro) — même
 *  règle que le donut engagé / à venir (`engagedVsUpcomingRows`) et le KPI « CAPEX & coûts
 *  ponctuels » (`programSummary.reforecastCosts`) : CAPEX et OPEX ponctuel RÉACTUALISÉS
 *  (`displayedReforecastSnapshot`), datés au DÉBUT du levier (repli : sa fin). Audit lot 6 : depuis
 *  le lot 5, les GAINS de ces leviers comptaient dans « Invest vs Savings » mais pas leurs COÛTS
 *  (coût d'investissement 2,5 au lieu de 6,0, ROI ≈ 900 % au lieu de ≈ 316 %). Leviers abandonnés
 *  exclus (comme le KPI). Utilisées UNIQUEMENT par les vues datées Invest (engagement des coûts,
 *  Invest vs Savings) — jamais par la ventilation par centre de coût. */
export function undetailedInvestCostRows(data: BeTrackData): CostImpactRow[] {
  const out: CostImpactRow[] = [];
  for (const lever of data.levers) {
    if (lever.status === "cancelled") continue;
    const hasInvestLine = leverImpactsOf(lever).some(
      (impact) => impact.type === "cost" && isInvestNature(impact.nature)
    );
    if (hasInvestLine) continue;
    const snap = displayedReforecastSnapshot(lever);
    const date = lever.start || lever.end;
    const parts: [ActionImpact["nature"], number][] = [
      ["capex", snap.capex],
      ["oneoff", snap.opexOneOff],
    ];
    for (const [nature, amount] of parts) {
      if (!amount) continue;
      out.push({
        lever,
        impact: {
          id: `${lever.id}__macro_${nature}`,
          label: lever.name,
          type: "cost",
          nature,
          amount,
          // Date propre = début du levier (`referenceDate` la lit en priorité).
          capexDeploymentDate: date,
        },
      });
    }
  }
  return out;
}

/** Lignes de coût des vues DATÉES Invest : lignes détaillées (`flattenCostImpacts`) + lignes
 *  synthétiques des leviers macro (`undetailedInvestCostRows`). Total Invest = KPI = donut. */
function datedCostRows(data: BeTrackData): CostImpactRow[] {
  return [...flattenCostImpacts(data), ...undetailedInvestCostRows(data)];
}

/** Un coût "Invest" = CAPEX ou OPEX one-off, à l'exclusion de l'OPEX récurrent — périmètre commun
 *  à `CostEngagedVsUpcomingChart`, `CostCommitmentTimelineChart` et à la série "Coûts (Invest)" du
 *  nouveau graphique Invest vs Savings. */
export function isInvestNature(nature: ActionImpact["nature"]): boolean {
  return nature !== "opex_rec";
}

/** Date de référence d'un coût pour le bucketing temporel — la date PROPRE de la ligne (audit M6 ;
 *  avant, tout OPEX était daté au début du levier) :
 *  - CAPEX lissé : `capexStartDate` (début de la période de lissage — la fin est
 *    `capexDeploymentDate`, voir `attributeCostRowsToPeriods` qui répartit le montant entre les deux) ;
 *  - sinon (CAPEX one-shot, OPEX one-off/récurrent) : date de début de la ligne
 *    (`capexDeploymentDate ?? capexStartDate`, voir `impactDatesOf`) ;
 *  - repli : date de début du levier. */
function referenceDate(impact: ActionImpact, lever: Lever): string {
  if (
    impact.nature === "capex" &&
    impact.capexAllocationMode === "smoothed" &&
    impact.capexStartDate
  ) {
    return impact.capexStartDate;
  }
  return impact.capexDeploymentDate ?? impact.capexStartDate ?? lever.start;
}

/** Un coût est "déjà engagé" à `today` — règle DATÉE unique partagée avec le KPI du dashboard
 *  (`engine.isInvestCostEngaged`, audit M8) : sa date propre est passée ; sans date, le levier est
 *  « Réalisé », ou « Exécuté » et démarré. */
export function isCostEngaged(
  row: Pick<CostImpactRow, "impact" | "lever">,
  today: Date = new Date()
): boolean {
  return isInvestCostEngaged(row.impact, row.lever, today);
}

/** Détail Engagé / À venir des coûts "Invest" (CAPEX + OPEX one-off, OPEX récurrent EXCLU —
 *  décision produit round finance-charts-v2), MÊME périmètre et MÊMES fonctions que le KPI
 *  « CAPEX & coûts ponctuels » du dashboard (`engine.programSummary` : `engagedCosts` /
 *  `reforecastCosts`) — audit lot 2, le donut excluait les leviers sans ligne de coût (KPI
 *  1,3 / 3,3 vs donut 1,0 / 2,8) alors que son infobulle annonçait « même périmètre » :
 *  - levier avec lignes de coût Invest : chaque ligne, engagée selon la règle datée unique
 *    (`isCostEngaged` → `engine.isInvestCostEngaged`) ;
 *  - levier SANS ligne de coût Invest (saisie macro au niveau du levier) : engagé =
 *    `engine.leverEngagedInvestCost` (coûts × avancement), total = coûts réactualisés
 *    (`engine.displayedReforecastSnapshot`), à venir = total − engagé — exactement le KPI.
 *  Leviers abandonnés exclus (comme le KPI). Les lignes `{ lever, amount }` alimentent le
 *  drill-down chantier → levier ; `undetailed` isole la part des leviers non détaillés. */
export function engagedVsUpcomingRows(
  data: BeTrackData,
  today: Date = new Date()
): {
  engagedRows: { lever: Lever; amount: number }[];
  upcomingRows: { lever: Lever; amount: number }[];
  engaged: number;
  upcoming: number;
  total: number;
  undetailed: { engaged: number; upcoming: number; leverCount: number };
} {
  const engagedRows: { lever: Lever; amount: number }[] = [];
  const upcomingRows: { lever: Lever; amount: number }[] = [];
  let undetailedEngaged = 0;
  let undetailedUpcoming = 0;
  let undetailedCount = 0;
  for (const lever of data.levers) {
    if (lever.status === "cancelled") continue;
    const investLines = leverImpactsOf(lever).filter(
      (impact) => impact.type === "cost" && isInvestNature(impact.nature)
    );
    if (investLines.length > 0) {
      for (const impact of investLines) {
        if (impact.amount === 0) continue;
        const row = { lever, amount: impact.amount };
        if (isCostEngaged({ impact, lever }, today)) engagedRows.push(row);
        else upcomingRows.push(row);
      }
      continue;
    }
    const snap = displayedReforecastSnapshot(lever);
    const total = snap.capex + snap.opexOneOff;
    const engaged = leverEngagedInvestCost(lever, today);
    // À venir ≥ 0 : un engagé (champs courants × avancement) supérieur au réactualisé ne crée pas
    // de part négative — cas de données incohérentes, le total du donut dépasse alors le KPI.
    const upcoming = Math.max(0, total - engaged);
    if (engaged === 0 && upcoming === 0) continue;
    undetailedCount += 1;
    if (engaged !== 0) {
      engagedRows.push({ lever, amount: engaged });
      undetailedEngaged += engaged;
    }
    if (upcoming !== 0) {
      upcomingRows.push({ lever, amount: upcoming });
      undetailedUpcoming += upcoming;
    }
  }
  const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);
  const engaged = sum(engagedRows);
  const upcoming = sum(upcomingRows);
  return {
    engagedRows,
    upcomingRows,
    engaged: round2(engaged),
    upcoming: round2(upcoming),
    total: round2(engaged + upcoming),
    undetailed: {
      engaged: round2(undetailedEngaged),
      upcoming: round2(undetailedUpcoming),
      leverCount: undetailedCount,
    },
  };
}

/** Répartition Engagé / À venir / Total (€M) des coûts "Invest" — totaux de
 *  `engagedVsUpcomingRows` (donut `CostEngagedVsUpcomingChart`, = KPI du dashboard). */
export function splitEngagedVsUpcoming(
  data: BeTrackData,
  today: Date = new Date()
): { engaged: number; upcoming: number; total: number } {
  const { engaged, upcoming, total } = engagedVsUpcomingRows(data, today);
  return { engaged, upcoming, total };
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

/** Réconciliation de l'OPEX récurrent ANNUEL entre la page Finance et la cascade du dashboard
 *  (`engine.savingsWaterfall`) — ce sont deux périmètres différents, pas deux périodes : tous deux
 *  sont des montants annualisés (run-rate), sans prorata sur la période du programme.
 *  - `costLines` : lignes d'impact de coût « OPEX récurrent » (= `splitByNature(data).opexRec`),
 *    seules ventilables par compte P&L / centre de coût ;
 *  - `fteHires` : salaires chargés des recrutements ETP (impacts « fte » de direction recrutement),
 *    que le moteur compte en OPEX récurrent (`leverImpactTotals.opexRec`) mais qui ne sont pas des
 *    lignes de coût ;
 *  - `dashboard` : OPEX récurrent de la cascade (Σ `leverOpexRecOf` des leviers actifs) ;
 *  - `other` : reste (montants saisis au niveau du levier sans ligne d'impact, arrondis). */
export function recurringOpexReconciliation(data: BeTrackData): {
  costLines: number;
  fteHires: number;
  other: number;
  dashboard: number;
} {
  const active = data.levers.filter((l) => l.status !== "cancelled");
  const costLines = splitByNature(data).opexRec;
  let fteHires = 0;
  for (const lever of active) {
    for (const imp of leverImpactsOf(lever)) {
      if (isFteHire(imp)) fteHires += imp.amount;
    }
  }
  const dashboard = round2(active.reduce((s, l) => s + leverOpexRecOf(l), 0));
  fteHires = round2(fteHires);
  return { costLines, fteHires, other: round2(dashboard - costLines - fteHires) || 0, dashboard };
}

export type CostPeriodPoint = {
  period: string;
  sortKey: string;
  delta: number;
  cumulative: number;
};

/** Clé de tri chronologique "YYYY", "YYYY-Q" ou "YYYY-MM" pour un point temporel. Années et
 *  trimestres = EXERCICES FISCAUX du programme (audit lot 2, même convention que le P&L et le
 *  tableau par niveau financier de la page Finance, `engine.impactYearRange`) : "YYYY" = l'exercice
 *  qui COMMENCE en YYYY, Q1 = ses 3 premiers mois ; `fyStartMonth` = mois (0-11) de début
 *  d'exercice, 0 (défaut) = années civiles. Les mois restent des mois civils ("YYYY-MM", MM 0-11). */
function periodSortKey(d: Date, granularity: FinanceGranularity, fyStartMonth = 0): string {
  if (granularity === "month") {
    return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
  }
  const fiscalMonth = (d.getMonth() - fyStartMonth + 12) % 12; // 0 = 1er mois de l'exercice
  const fiscalYear = d.getMonth() >= fyStartMonth ? d.getFullYear() : d.getFullYear() - 1;
  if (granularity === "year") return `${fiscalYear}`;
  return `${fiscalYear}-Q${Math.floor(fiscalMonth / 3) + 1}`;
}

/** Libellé d'une clé de période : exercice décalé → "FY26/27" / "Q1 FY26/27" (`fiscalYearLabel`,
 *  lib/fiscalYear.ts) ; exercice civil → "2026" / "Q1 2026" (inchangé) ; mois → "Apr 2026". */
function periodLabel(sortKey: string, granularity: FinanceGranularity, fyStartMonth = 0): string {
  if (granularity === "year") return fiscalYearLabel(Number(sortKey), fyStartMonth);
  const [year, part] = sortKey.split(granularity === "quarter" ? "-Q" : "-");
  return granularity === "quarter"
    ? `Q${part} ${fiscalYearLabel(Number(year), fyStartMonth)}`
    : `${MONTH_LABELS[Number(part)]} ${year}`;
}

/** Index de mois absolu (année × 12 + mois) d'une date ISO — `NaN` si invalide. */
function monthIndexOf(date: string | undefined): number {
  if (!date) return NaN;
  const d = parseLocalDate(date);
  return Number.isNaN(d.getTime()) ? NaN : d.getFullYear() * 12 + d.getMonth();
}

function periodKeyOfMonthIndex(
  mi: number,
  granularity: FinanceGranularity,
  fyStartMonth = 0
): string {
  return periodSortKey(new Date(Math.floor(mi / 12), mi % 12, 1), granularity, fyStartMonth);
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
  granularity: FinanceGranularity,
  fyStartMonth = 0
): PeriodAttributedCostRow[] {
  const out: PeriodAttributedCostRow[] = [];
  for (const row of rows) {
    const { impact, lever } = row;
    if (
      impact.nature === "capex" &&
      impact.capexAllocationMode === "smoothed" &&
      impact.capexStartDate &&
      impact.capexDeploymentDate
    ) {
      const start = parseLocalDate(impact.capexStartDate);
      const end = parseLocalDate(impact.capexDeploymentDate);
      const months = monthKeysBetween(start <= end ? start : end, start <= end ? end : start);
      const perMonth = impact.amount / months.length;
      for (const monthKey of months) {
        const [year, month] = monthKey.split("-").map(Number);
        const d = new Date(year, month, 1);
        out.push({
          ...row,
          periodAmount: perMonth,
          periodKey: periodSortKey(d, granularity, fyStartMonth),
        });
      }
      continue;
    }
    const ref = parseLocalDate(referenceDate(impact, lever));
    out.push({
      ...row,
      periodAmount: impact.amount,
      periodKey: periodSortKey(ref, granularity, fyStartMonth),
    });
  }
  return out;
}

function pointsFromPeriodAmounts(
  byPeriod: Map<string, number>,
  fyStartMonth = 0
): CostPeriodPoint[] {
  const sortedKeys = Array.from(byPeriod.keys()).sort();
  let cumulative = 0;
  return sortedKeys.map((key) => {
    const delta = round2(byPeriod.get(key) ?? 0);
    cumulative = round2(cumulative + delta);
    return {
      period: periodLabel(key, granularityHintFromKey(key), fyStartMonth),
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
 *  graphique Invest vs Savings). Omis = tous les coûts (comportement historique).
 *
 *  Leviers SANS ligne de coût Invest (saisie macro) : leur CAPEX et OPEX ponctuel réactualisés
 *  sont datés à leur début (`undetailedInvestCostRows`, audit lot 6) — total Invest = KPI = donut.
 *
 *  `fyStartMonth` (0-11) : années / trimestres = exercices fiscaux du programme (voir
 *  `periodSortKey`) — la page Finance passe le même que son P&L et son tableau. */
export function bucketCostsByPeriod(
  data: BeTrackData,
  granularity: FinanceGranularity = "quarter",
  natureFilter?: (nature: ActionImpact["nature"]) => boolean,
  fyStartMonth = 0
): CostPeriodPoint[] {
  let rows = datedCostRows(data);
  if (natureFilter) rows = rows.filter(({ impact }) => natureFilter(impact.nature));
  const attributed = attributeCostRowsToPeriods(rows, granularity, fyStartMonth);
  const byPeriod = new Map<string, number>();
  for (const row of attributed) {
    byPeriod.set(row.periodKey, (byPeriod.get(row.periodKey) ?? 0) + row.periodAmount);
  }
  return pointsFromPeriodAmounts(byPeriod, fyStartMonth);
}

/** Détail des lignes de coût (avec leur montant attribué) qui contribuent à UNE période donnée
 *  (`periodKey`, tel que renvoyé dans `CostPeriodPoint.sortKey` par `bucketCostsByPeriod`) — sert
 *  au drill-down au clic sur une barre de `CostCommitmentTimelineChart`. Même `natureFilter` que
 *  `bucketCostsByPeriod` : à fournir identique pour rester cohérent avec le montant affiché sur la
 *  barre cliquée (de même que `fyStartMonth`). */
export function costRowsForPeriod(
  data: BeTrackData,
  granularity: FinanceGranularity,
  periodKey: string,
  natureFilter?: (nature: ActionImpact["nature"]) => boolean,
  fyStartMonth = 0
): { lever: Lever; amount: number }[] {
  let rows = datedCostRows(data);
  if (natureFilter) rows = rows.filter(({ impact }) => natureFilter(impact.nature));
  return attributeCostRowsToPeriods(rows, granularity, fyStartMonth)
    .filter((row) => row.periodKey === periodKey)
    .map((row) => ({ lever: row.lever, amount: row.periodAmount }));
}

// ─── Coût d'investissement vs Savings : flux par levier et par période ────────────────────────

/** Flux d'UN levier sur UNE période du graphique « Coût d'investissement vs Savings ». */
type InvestVsSavingsEntry = {
  lever: Lever;
  periodKey: string;
  grossSavings: number;
  opexRec: number;
  capex: number;
  opexOneOff: number;
};

/** Ligne RÉCURRENTE (montant annualisé) avec sa période d'effet [début, fin] en index de mois. */
type RecurringFlow = {
  lever: Lever;
  kind: "gain" | "opexRec";
  annual: number;
  fromMi: number;
  toMi: number; // Infinity = sans date de fin
};

/** Lignes récurrentes des leviers actifs, avec la même assiette que `engine.leverImpactTotals`
 *  (audit M6 — les impacts ETP étaient ignorés) : gain annuel (hors one-off) et départ ETP →
 *  gain ; OPEX récurrent et recrutement ETP → OPEX récurrent. Date de début PROPRE de la ligne
 *  (gain : `gainDate`, sinon fin du levier — même repli que `engine.impactTrajectory` ; coût :
 *  `capexDeploymentDate ?? capexStartDate`, sinon début du levier), fin = `endDate` si renseignée. */
function recurringFlows(data: BeTrackData): RecurringFlow[] {
  const out: RecurringFlow[] = [];
  for (const lever of data.levers) {
    if (lever.status === "cancelled") continue;
    let hasRecurringLine = false;
    for (const imp of leverImpactsOf(lever)) {
      let kind: RecurringFlow["kind"] | null = null;
      // Impact BFR (trésorerie) : hors économies.
      if (isWorkingCapitalImpact(imp)) continue;
      if (imp.type === "saving") kind = imp.gainRecurrence === "oneoff" ? null : "gain";
      else if (imp.type === "fte") kind = isFteHire(imp) ? "opexRec" : "gain";
      else if (imp.nature === "opex_rec") kind = "opexRec";
      if (!kind || !imp.amount) continue;
      hasRecurringLine = true;
      const { start, end } = impactDatesOf(imp);
      const fromMi = monthIndexOf(start ?? (kind === "gain" ? lever.end : lever.start));
      if (!Number.isFinite(fromMi)) continue;
      const endMi = monthIndexOf(end);
      out.push({
        lever,
        kind,
        annual: imp.amount,
        fromMi,
        toMi: Number.isFinite(endMi) ? Math.max(fromMi, endMi) : Infinity,
      });
    }
    if (hasRecurringLine) continue;
    // Levier SANS ligne récurrente (saisie macro) : même règle que le P&L
    // (`engine.pnlImpactDetailed`, bloc `leverMonthRange`) — RÉCURRENT SANS FIN depuis son début
    // (repli : sa fin), pour son réactualisé (`displayedReforecastSnapshot`). Avant, il était
    // absent d'« Invest vs Savings » alors qu'il comptait dans le P&L. OPEX récurrent = celui du
    // snapshot ; gain = net + OPEX récurrent (règle « net = brut − OPEX récurrent »), pour que le
    // net de ces flux égale EXACTEMENT le réactualisé net retenu par le P&L.
    const fromMi = monthIndexOf(lever.start);
    const leverFromMi = Number.isFinite(fromMi) ? fromMi : monthIndexOf(lever.end);
    if (!Number.isFinite(leverFromMi)) continue;
    const snap = displayedReforecastSnapshot(lever);
    const gain = snap.netSavings + snap.opexRec;
    if (gain) out.push({ lever, kind: "gain", annual: gain, fromMi: leverFromMi, toMi: Infinity });
    if (snap.opexRec) {
      out.push({
        lever,
        kind: "opexRec",
        annual: snap.opexRec,
        fromMi: leverFromMi,
        toMi: Infinity,
      });
    }
  }
  return out;
}

/** Tous les flux « Invest vs Savings » par levier et par période : coûts d'investissement (CAPEX,
 *  lissage compris, et OPEX one-off) à leur date propre ; gains récurrents et OPEX récurrent en
 *  RUN-RATE — 1/12 du montant annualisé chaque mois depuis leur date de début, jusqu'à leur date
 *  de fin si renseignée (audit M6 : un gain annuel n'était compté qu'une fois, au trimestre de sa
 *  date, ce qui faussait le cumul, le ROI et le délai de retour). Horizon : de la première date à
 *  12 mois après la dernière date connue (au moins un an plein de run-rate) — toutes les périodes
 *  de l'horizon sont présentes, même vides. Leviers annulés exclus. Années / trimestres =
 *  exercices fiscaux selon `fyStartMonth` (voir `periodSortKey`). */
function investVsSavingsEntries(
  data: BeTrackData,
  granularity: FinanceGranularity,
  fyStartMonth = 0
): { entries: InvestVsSavingsEntry[]; periodKeys: string[] } {
  // Coûts Invest : lignes détaillées ET leviers macro (`datedCostRows`, audit lot 6 — leurs gains y
  // étaient comptés, pas leurs coûts) ; total sur l'horizon = KPI « CAPEX & coûts ponctuels » =
  // donut engagé / à venir.
  const investRows = attributeCostRowsToPeriods(
    datedCostRows(data).filter(({ impact }) => isInvestNature(impact.nature)),
    "month"
  );
  const flows = recurringFlows(data);
  const marks: number[] = [];
  const monthKeyToIndex = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return y * 12 + m;
  };
  for (const r of investRows) marks.push(monthKeyToIndex(r.periodKey));
  for (const f of flows) {
    marks.push(f.fromMi);
    if (Number.isFinite(f.toMi)) marks.push(f.toMi);
  }
  if (marks.length === 0) return { entries: [], periodKeys: [] };
  const startMi = Math.min(...marks);
  const endMi = Math.max(...marks) + 11;

  const byKey = new Map<string, InvestVsSavingsEntry>();
  const entryFor = (lever: Lever, periodKey: string) => {
    const k = `${periodKey}|${lever.id}`;
    let e = byKey.get(k);
    if (!e) {
      e = { lever, periodKey, grossSavings: 0, opexRec: 0, capex: 0, opexOneOff: 0 };
      byKey.set(k, e);
    }
    return e;
  };
  for (const r of investRows) {
    const mi = monthKeyToIndex(r.periodKey);
    const e = entryFor(r.lever, periodKeyOfMonthIndex(mi, granularity, fyStartMonth));
    if (r.impact.nature === "capex") e.capex += r.periodAmount;
    else e.opexOneOff += r.periodAmount;
  }
  for (const f of flows) {
    const last = Math.min(f.toMi, endMi);
    for (let mi = f.fromMi; mi <= last; mi++) {
      const e = entryFor(f.lever, periodKeyOfMonthIndex(mi, granularity, fyStartMonth));
      if (f.kind === "gain") e.grossSavings += f.annual / 12;
      else e.opexRec += f.annual / 12;
    }
  }
  const periodKeys: string[] = [];
  for (let mi = startMi; mi <= endMi; mi++) {
    const key = periodKeyOfMonthIndex(mi, granularity, fyStartMonth);
    if (periodKeys[periodKeys.length - 1] !== key) periodKeys.push(key);
  }
  return { entries: Array.from(byKey.values()), periodKeys };
}

/** Coûts OPEX récurrents (run-rate) par période : 1/12 du montant annualisé chaque mois depuis la
 *  date de début de la ligne (recrutements ETP compris), jusqu'à sa date de fin si renseignée —
 *  même attribution que `bucketInvestVsSavingsByPeriod` (champ `opexRecStarted`). */
export function bucketRecurrentOpexByPeriod(
  data: BeTrackData,
  granularity: FinanceGranularity = "quarter",
  fyStartMonth = 0
): CostPeriodPoint[] {
  const { entries } = investVsSavingsEntries(data, granularity, fyStartMonth);
  const byPeriod = new Map<string, number>();
  for (const e of entries) {
    if (e.opexRec) byPeriod.set(e.periodKey, (byPeriod.get(e.periodKey) ?? 0) + e.opexRec);
  }
  return pointsFromPeriodAmounts(byPeriod, fyStartMonth);
}

/** Gains bruts récurrents (run-rate, départs ETP compris) par période — même attribution que
 *  `bucketInvestVsSavingsByPeriod` (champ `grossSavings`). Gains one-off exclus. */
export function bucketSavingsByPeriod(
  data: BeTrackData,
  granularity: FinanceGranularity = "quarter",
  fyStartMonth = 0
): CostPeriodPoint[] {
  const { entries } = investVsSavingsEntries(data, granularity, fyStartMonth);
  const byPeriod = new Map<string, number>();
  for (const e of entries) {
    if (e.grossSavings) {
      byPeriod.set(e.periodKey, (byPeriod.get(e.periodKey) ?? 0) + e.grossSavings);
    }
  }
  return pointsFromPeriodAmounts(byPeriod, fyStartMonth);
}

export type InvestVsSavingsPoint = {
  period: string;
  sortKey: string;
  /** Coûts d'investissement (CAPEX + OPEX one-off) de la période — même logique de lissage que
   *  `bucketCostsByPeriod`. */
  investCost: number;
  /** Gains bruts récurrents de la période (run-rate : 1/12 du montant annualisé par mois actif). */
  grossSavings: number;
  /** OPEX récurrent de la période (run-rate, recrutements ETP compris). Nom historique conservé. */
  opexRecStarted: number;
  /** `grossSavings - opexRecStarted`. */
  netSavings: number;
  /** Résultat net de LA période, capex inclus : `netSavings - investCost`. Négatif tant que
   *  l'investissement domine, positif dès que les gains nets dépassent l'investissement de la
   *  période — c'est la valeur affichée en barre (positive/négative) du graphique. */
  netPeriodResult: number;
  /** Cumul de `netPeriodResult` depuis le début de l'horizon — la courbe de breakeven : le point où
   *  elle repasse au-dessus de 0 est le mois/trimestre de retour sur investissement. */
  netCumulative: number;
};

/** Compare, période par période, les coûts d'investissement (CAPEX + OPEX one-off, à leurs dates
 *  réelles) aux gains récurrents en run-rate, nets de l'OPEX récurrent en run-rate (voir
 *  `investVsSavingsEntries`). Alimente le graphique "Coût d'investissement vs Savings" : une barre
 *  signée par période (`netPeriodResult`) + une courbe de cumul (`netCumulative`) qui matérialise
 *  le breakeven. Toutes les périodes de l'horizon sont présentes (cumul continu). Années /
 *  trimestres = exercices fiscaux selon `fyStartMonth` (0 = années civiles). */
export function bucketInvestVsSavingsByPeriod(
  data: BeTrackData,
  granularity: FinanceGranularity = "quarter",
  fyStartMonth = 0
): InvestVsSavingsPoint[] {
  const { entries, periodKeys } = investVsSavingsEntries(data, granularity, fyStartMonth);
  const byKey = new Map<string, { investCost: number; grossSavings: number; opexRec: number }>();
  for (const key of periodKeys) byKey.set(key, { investCost: 0, grossSavings: 0, opexRec: 0 });
  for (const e of entries) {
    const v = byKey.get(e.periodKey);
    if (!v) continue;
    v.investCost += e.capex + e.opexOneOff;
    v.grossSavings += e.grossSavings;
    v.opexRec += e.opexRec;
  }
  let cumulative = 0;
  return periodKeys.map((key) => {
    const v = byKey.get(key)!;
    const grossSavings = round2(v.grossSavings);
    const opexRecStarted = round2(v.opexRec);
    const investCost = round2(v.investCost);
    const netSavings = round2(grossSavings - opexRecStarted);
    const netPeriodResult = round2(netSavings - investCost);
    cumulative = round2(cumulative + netPeriodResult);
    return {
      period: periodLabel(key, granularity, fyStartMonth),
      sortKey: key,
      investCost,
      grossSavings,
      opexRecStarted,
      netSavings,
      netPeriodResult,
      netCumulative: cumulative,
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
   *  workstream au clic sur la maille la plus fine. `impact` = la ligne d'impact d'origine (aperçu
   *  au survol : répartition engagé / à venir / OPEX récurrent, `financePreview.costCommitmentSplit`). */
  rows: { lever: Lever; amount: number; impact: ActionImpact }[];
  /** `true` s'il existe des `HierarchyNode` enfants (niveau suivant, `parentId === node.id`) — le
   *  composant descend d'un niveau au clic si `true`, sinon ouvre directement la décomposition par
   *  workstream. Toujours `false` pour une part « (direct) ». */
  hasChildren: boolean;
  /** Part « (direct) » : coûts rattachés DIRECTEMENT au nœud parent du drill (feuille plus macro que
   *  le niveau affiché). `node` est alors le parent lui-même — l'appelant suffixe son libellé. */
  isDirect?: boolean;
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

/** Le nœud `ancestorId` figure-t-il dans la chaîne de `leafId` (lui-même compris) ? */
function chainContains(
  leafId: string,
  ancestorId: string,
  byId: Map<string, HierarchyNode>
): boolean {
  let cur: HierarchyNode | null = byId.get(leafId) ?? null;
  while (cur) {
    if (cur.id === ancestorId) return true;
    cur = cur.parentId ? (byId.get(cur.parentId) ?? null) : null;
  }
  return false;
}

/** Niveaux financiers configurés pour l'entreprise, triés par `order` croissant (le plus macro en
 *  premier) — vue affichée initialement par le donut "Répartition des coûts par centre de coût /
 *  P&L" (`levels[0]`). */
export function sortedHierarchyLevels(levels: HierarchyLevelDef[]): HierarchyLevelDef[] {
  return [...levels].sort((a, b) => a.order - b.order);
}

/** Répartition des coûts (tous types de nature confondus — CAPEX, OPEX récurrent, one-off) par
 *  nœud d'arborescence financière, à un niveau (`levelKey`) et sous un parent donnés (`parentId`,
 *  `null` = niveau racine). Rattachement d'une ligne : son propre `impact.hierarchyLeafId` en
 *  priorité, sinon celui du levier (audit M9 — seul le levier était lu, alors que c'est l'impact
 *  qui porte la maille fine depuis la suppression du rattachement par défaut du levier). Une ligne
 *  sans rattachement résolvable n'est comptée dans aucune part (état vide clair plutôt qu'une part
 *  fourre-tout).
 *
 *  Drill dans un nœud qui porte lui-même des coûts (ligne rattachée au parent, plus macro que le
 *  niveau affiché) : ces coûts forment une part « (direct) » (`isDirect`), pour que la somme des
 *  parts d'un niveau égale toujours la part cliquée au niveau au-dessus (ils disparaissaient). */
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
  const rows = flattenCostImpacts(data).map(({ lever, impact }) => ({
    lever,
    impact,
    amount: impact.amount,
    leafId: impact.hierarchyLeafId ?? lever.hierarchyLeafId,
  }));
  const nodesAtLevel = hierarchyNodes.filter(
    (n) => n.levelKey === levelKey && (n.parentId ?? null) === (parentId ?? null)
  );

  const slices: HierarchyCostSlice[] = nodesAtLevel.map((node) => {
    const nodeRows = rows
      .filter(({ leafId }) => {
        if (!leafId) return false;
        return resolveAncestorAtLevel(leafId, levelKey, byId)?.id === node.id;
      })
      .map(({ lever, amount, impact }) => ({ lever, amount, impact }));
    const amount = round2(nodeRows.reduce((sum, r) => sum + r.amount, 0));
    return { node, amount, rows: nodeRows, hasChildren: childrenParentIds.has(node.id) };
  });

  const parent = parentId ? byId.get(parentId) : undefined;
  if (parent) {
    const directRows = rows
      .filter(
        ({ leafId }) =>
          !!leafId &&
          chainContains(leafId, parent.id, byId) &&
          !resolveAncestorAtLevel(leafId, levelKey, byId)
      )
      .map(({ lever, amount, impact }) => ({ lever, amount, impact }));
    const amount = round2(directRows.reduce((sum, r) => sum + r.amount, 0));
    if (amount > 0) {
      slices.push({ node: parent, amount, rows: directRows, hasChildren: false, isDirect: true });
    }
  }

  return slices.filter((slice) => slice.amount > 0).sort((a, b) => b.amount - a.amount);
}

// ─── Détail d'une période du graphique "Coût d'investissement vs Savings" ─────────────────────

export type InvestVsSavingsLeverRow = {
  leverId: string;
  leverCode: string;
  leverName: string;
  wsId: string;
  grossSavings: number;
  opexRec: number;
  opexOneOff: number;
  capex: number;
  /** grossSavings - opexRec - opexOneOff - capex (négatif = économie négative). */
  net: number;
};

/** Décomposition par levier d'une période du graphique "Coût d'investissement vs Savings" (mêmes
 *  flux que `bucketInvestVsSavingsByPeriod` — voir `investVsSavingsEntries`). `periodKey === null`
 *  = tout l'horizon (vue « Total » du détail de calcul). `fyStartMonth` : le même que le graphique. */
export function investVsSavingsRowsForPeriod(
  data: BeTrackData,
  granularity: FinanceGranularity,
  periodKey: string | null,
  fyStartMonth = 0
): InvestVsSavingsLeverRow[] {
  const { entries } = investVsSavingsEntries(data, granularity, fyStartMonth);
  const byLever = new Map<string, InvestVsSavingsLeverRow>();
  for (const e of entries) {
    if (periodKey !== null && e.periodKey !== periodKey) continue;
    let r = byLever.get(e.lever.id);
    if (!r) {
      r = {
        leverId: e.lever.id,
        leverCode: e.lever.code,
        leverName: e.lever.name,
        wsId: e.lever.ws,
        grossSavings: 0,
        opexRec: 0,
        opexOneOff: 0,
        capex: 0,
        net: 0,
      };
      byLever.set(e.lever.id, r);
    }
    r.grossSavings += e.grossSavings;
    r.opexRec += e.opexRec;
    r.opexOneOff += e.opexOneOff;
    r.capex += e.capex;
  }
  return Array.from(byLever.values())
    .map((r) => ({
      ...r,
      grossSavings: round2(r.grossSavings),
      opexRec: round2(r.opexRec),
      opexOneOff: round2(r.opexOneOff),
      capex: round2(r.capex),
      net: round2(r.grossSavings - r.opexRec - r.opexOneOff - r.capex),
    }))
    .sort((a, b) => a.net - b.net);
}
