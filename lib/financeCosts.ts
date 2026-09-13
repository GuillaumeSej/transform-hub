import type { ActionImpact, BeTrackData, Lever, LeverAction } from "@/types";
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

/** Répartition Engagé / À venir / Total (€M) de l'ensemble des coûts (CAPEX + OPEX one-off +
 *  OPEX récurrent confondus) — alimente `CostEngagedVsUpcomingChart`. */
export function splitEngagedVsUpcoming(
  data: BeTrackData,
  today: Date = new Date()
): { engaged: number; upcoming: number; total: number } {
  const rows = flattenCostImpacts(data);
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

/** Répartition CAPEX / OPEX récurrent / One-off (€M) — alimente `CapexOpexBreakdownChart`. */
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

/** Engagement des coûts dans le temps (€M par période + cumul), pour le graphique de suivi
 *  temporel avec toggle mensuel/trimestriel/annuel. Un CAPEX lissé (`capexAllocationMode ===
 *  "smoothed"`) est réparti au prorata sur chaque mois de sa période [capexStartDate,
 *  capexDeploymentDate], puis regroupé selon la granularité demandée ; tout le reste (CAPEX
 *  one-shot, OPEX) est affecté en bloc à sa `referenceDate`. */
export function bucketCostsByPeriod(
  data: BeTrackData,
  granularity: FinanceGranularity = "quarter"
): CostPeriodPoint[] {
  const rows = flattenCostImpacts(data);
  const byMonthKey = new Map<string, number>();

  const addToMonth = (monthKey: string, amount: number) => {
    byMonthKey.set(monthKey, (byMonthKey.get(monthKey) ?? 0) + amount);
  };

  for (const { impact, action } of rows) {
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
      months.forEach((monthKey) => addToMonth(monthKey, perMonth));
      continue;
    }
    const ref = new Date(referenceDate(impact, action));
    addToMonth(`${ref.getFullYear()}-${String(ref.getMonth()).padStart(2, "0")}`, impact.amount);
  }

  // Regroupe les buckets mensuels internes selon la granularité demandée (un mois est toujours
  // le grain de calcul interne, y compris pour "quarter"/"year", pour que le lissage CAPEX reste
  // exact quelle que soit la granularité affichée).
  const byPeriod = new Map<string, number>();
  for (const [monthKey, amount] of Array.from(byMonthKey.entries())) {
    const [year, month] = monthKey.split("-").map(Number);
    const d = new Date(year, month, 1);
    const key = periodSortKey(d, granularity);
    byPeriod.set(key, (byPeriod.get(key) ?? 0) + amount);
  }

  const sortedKeys = Array.from(byPeriod.keys()).sort();
  let cumulative = 0;
  return sortedKeys.map((key) => {
    const delta = round2(byPeriod.get(key) ?? 0);
    cumulative = round2(cumulative + delta);
    return { period: periodLabel(key, granularity), sortKey: key, delta, cumulative };
  });
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
  const sortedKeys = Array.from(byPeriod.keys()).sort();
  let cumulative = 0;
  return sortedKeys.map((key) => {
    const delta = round2(byPeriod.get(key) ?? 0);
    cumulative = round2(cumulative + delta);
    return { period: periodLabel(key, granularity), sortKey: key, delta, cumulative };
  });
}
