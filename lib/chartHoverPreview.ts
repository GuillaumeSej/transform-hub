/**
 * Données des aperçus au survol des graphiques du dashboard Performance (Marimekko, donut,
 * entonnoir des étapes, matrice Santé) — fonctions pures qui AGRÈGENT les helpers existants du
 * moteur (`realizedSavings`, `displayedReforecastNet`, `plannedInitialNet`, `leverActionProgress`,
 * `computeLeverRisk`) sans redéfinir aucune formule. Le rendu est dans
 * `components/shared/charts/LeverGroupPreview.tsx`.
 */

import {
  computeLeverRisk,
  displayedReforecastNet,
  leverActionProgress,
  plannedInitialNet,
  realizedSavings,
  stageCounts,
  type LeverRiskAssessment,
} from "@/lib/engine";
import { getMetricDef } from "@/lib/dashboardPivot";
import { formatMillions, formatNumber } from "@/lib/format";
import { formatFteValue } from "@/lib/hrEngine";
import type { Alert, BeTrackData, Lever, LeverStatus, RiskLevel } from "@/types";

/** Levier listé dans un aperçu (« Principaux leviers ») — `value` dans l'unité du graphique. */
export type PreviewLever = { id: string; code: string; name: string; value: number };

/** Synthèse d'un groupe de leviers (segment, part, étape) pour l'aperçu au survol. */
export type LeverGroupSummary = {
  count: number;
  /** Réalisé net à date (M€, `realizedSavings`). */
  realized: number;
  /** Net réactualisé (M€, `displayedReforecastNet`). */
  reforecast: number;
  /** Planifié initial (M€, `plannedInitialNet`). */
  planned: number;
  /** Leviers les plus contributeurs (valeur absolue de `rank` décroissante). */
  top: PreviewLever[];
};

const reforecastOf = (l: Lever) => displayedReforecastNet(l).value;

/** Synthèse d'un ensemble de leviers ; `rank` = valeur servant à classer (et affichée pour) les
 *  principaux leviers — par défaut le net réactualisé. */
export function summarizeLeverGroup(
  levers: Lever[],
  rank: (l: Lever) => number = reforecastOf,
  topN = 3
): LeverGroupSummary {
  const top = levers
    .map((l) => ({ id: l.id, code: l.code, name: l.name, value: rank(l) }))
    .filter((l) => l.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, topN);
  return {
    count: levers.length,
    realized: levers.reduce((s, l) => s + realizedSavings(l), 0),
    reforecast: levers.reduce((s, l) => s + reforecastOf(l), 0),
    planned: plannedInitialNet(levers),
    top,
  };
}

/** Part (en %) de `part` dans `total` ; `null` si le total est nul (part non significative). */
export function sharePct(part: number, total: number): number | null {
  if (!Number.isFinite(total) || total === 0) return null;
  return (part / total) * 100;
}

/** Aperçu d'une étape du cycle de vie (entonnoir) : leviers de l'étape, valeur = net réactualisé,
 *  part du pipeline = part de cette valeur dans celle des étapes actives (hors Annulé — un levier
 *  annulé ne fait plus partie du pipeline, sa part est `null`). */
export type StagePreview = LeverGroupSummary & { value: number; pipelineShare: number | null };

export function stagePreviews(data: BeTrackData): Record<LeverStatus, StagePreview> {
  const pipelineValue = data.levers
    .filter((l) => l.status !== "cancelled")
    .reduce((s, l) => s + reforecastOf(l), 0);
  const out = {} as Record<LeverStatus, StagePreview>;
  for (const { status } of stageCounts(data)) {
    const summary = summarizeLeverGroup(data.levers.filter((l) => l.status === status));
    out[status] = {
      ...summary,
      value: summary.reforecast,
      pipelineShare: status === "cancelled" ? null : sharePct(summary.reforecast, pipelineValue),
    };
  }
  return out;
}

const ALERT_SEVERITY: Record<string, number> = { red: 3, amber: 2, blue: 1, green: 0 };

/** Alerte principale d'un levier : alerte OUVERTE la plus sévère (rouge > orange > …), puis au
 *  montant (|impactEur|) le plus élevé, puis la plus récente. */
export function mainLeverAlert(leverId: string, alerts: Alert[]): Alert | undefined {
  return alerts
    .filter((a) => a.scope === leverId && !a.resolved)
    .sort(
      (a, b) =>
        (ALERT_SEVERITY[b.type] ?? 0) - (ALERT_SEVERITY[a.type] ?? 0) ||
        Math.abs(b.impactEur ?? 0) - Math.abs(a.impactEur ?? 0) ||
        String(b.createdAt ?? b.ts ?? "").localeCompare(String(a.createdAt ?? a.ts ?? ""))
    )[0];
}

/** Aperçu d'un levier de la matrice Santé. */
export type LeverCellPreview = {
  realized: number;
  reforecast: number;
  /** Avancement du plan d'action (0-100, `leverActionProgress`). */
  actionProgress: number;
  actionCount: number;
  risk: LeverRiskAssessment;
  mainAlert?: Alert;
};

export function leverCellPreview(
  lever: Lever,
  alerts: Alert[],
  thresholds?: { level: RiskLevel; minAmount: number; delayDays?: number }[]
): LeverCellPreview {
  return {
    realized: realizedSavings(lever),
    reforecast: reforecastOf(lever),
    actionProgress: leverActionProgress(lever),
    actionCount: lever.actions?.length ?? 0,
    risk: computeLeverRisk(lever.id, alerts, thresholds),
    mainAlert: mainLeverAlert(lever.id, alerts),
  };
}

/** Leviers actifs d'une part des donuts historiques « par pays » / « par fonction » — même
 *  regroupement (valeur brute du champ, leviers non annulés) que `engine.byCountry` / `byFunction`. */
export function leversByField(
  data: BeTrackData,
  field: "country" | "function",
  value: string
): Lever[] {
  return data.levers.filter((l) => l.status !== "cancelled" && String(l[field]) === value);
}

/** Format d'affichage d'une valeur de métrique du pivot (`METRIC_REGISTRY`) : nombre de leviers
 *  entier, avancement en %, ETP à une décimale, sinon montant en M€. */
export function metricValueFormatter(metricKey: string | undefined): (v: number) => string {
  if (metricKey === "leverCount") return (v) => formatNumber(Math.round(v));
  if (metricKey === "progress") return (v) => `${formatNumber(Math.round(v))} %`;
  if (metricKey === "fteImpact") return (v) => formatFteValue(v);
  return (v) => formatMillions(v);
}

/** Classement (et format) des « principaux leviers » d'un aperçu de pivot : la métrique affichée,
 *  sauf pour « nombre de leviers » (chaque levier vaut 1, classement sans objet) → net réactualisé
 *  en M€ (classement par défaut de `summarizeLeverGroup`). */
export function pivotLeverRanking(metricKey: string | undefined): {
  rank?: (l: Lever) => number;
  format: (v: number) => string;
} {
  const metric = metricKey ? getMetricDef(metricKey) : undefined;
  if (!metric || metric.aggregation === "count") return { format: (v) => formatMillions(v) };
  return { rank: metric.getValue, format: metricValueFormatter(metric.key) };
}
