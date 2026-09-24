"use client";

import { Fragment } from "react";
import { Maximize2 } from "lucide-react";
import {
  baselineMeasurement,
  computeIndicatorDelta,
  formatIndicatorProgress,
  indicatorReadingState,
  latestMeasurement,
  latestNumericMeasurement,
  progressBucket,
  resolveIndicatorTargetForPeriod,
  type ProgressBucket,
} from "@/lib/axisLogic";
import { IndicatorStatusBadge } from "@/components/strategic/IndicatorStatusBadge";
import { IndicatorMetaLine } from "@/components/strategic/IndicatorMetaLine";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Chantier, Indicator, IndicatorMeasurement, StrategicAxis } from "@/types";

/** Couleur d'accent de ligne selon la progression vers la cible (`ProgressBucket`, même 3 seaux
 *  discrets — jamais de dégradé — que `MilestoneChecklistPanel.tsx`, seule source de vérité déjà
 *  établie pour ces 3 couleurs dans le Plan Stratégique) : "dans la cible" (vert, 100%), "sur la
 *  trajectoire" (ambre, progression partielle mais favorable), "à risque" (rouge, aucune
 *  progression ou défavorable). `"empty"` (pas de mesure/cible exploitable) reste neutre — même
 *  garde-fou que `computeIndicatorDelta` : on n'invente jamais un statut sans donnée. */
const ROW_ACCENT: Record<ProgressBucket, string> = {
  empty: "border-l-transparent",
  red: "border-l-rag-red",
  amber: "border-l-rag-amber",
  green: "border-l-rag-green",
};
const VALUE_COLOR: Record<ProgressBucket, string> = {
  empty: "text-text-primary",
  red: "text-rag-red",
  amber: "text-rag-amber",
  green: "text-rag-green-dark",
};

/**
 * Vue alternative de la page KPI (round "cible évolutive", demande PO) : un tableau plat, sans
 * graphique, groupé par axe — colonnes Actuel / Cible (palier applicable à la période de la
 * dernière mesure, `axisLogic.resolveIndicatorTargetForPeriod`) / Cible finale (`objectiveValue`
 * brut), avec un badge de couleur reprenant EXACTEMENT le même statut effectif que le reste de la
 * page (`axisLogic.resolveIndicatorStatus`, via `IndicatorStatusBadge` — déjà utilisé ailleurs
 * dans le Plan Stratégique, aucune nouvelle échelle de couleur inventée ici).
 *
 * Prend en entrée le MÊME regroupement déjà calculé par `KpiPageClient` (`grouped`/`orphans`,
 * issus de `filteredIndicators` — donc déjà bornés par les filtres Axe/Chantier/Responsable actifs)
 * et le tableau brut `measurements` : aucun second appel de données, purement une projection
 * tabulaire du même périmètre que la vue Cartes. Couvre à la fois les indicateurs "macro"
 * (KPI business/marché, `axisLogic`-alias `isMarketKpi` côté `lib/kpiHistory.ts`) — présents dans
 * `grouped[].macro` — et les indicateurs de chantier (`grouped[].byChantier`), exactement comme la
 * vue Cartes.
 */
export function KpiTableView({
  grouped,
  orphans,
  measurements,
  baselineMeasurements,
  labels,
  onIndicatorClick,
}: {
  grouped: {
    axis: StrategicAxis;
    macro: Indicator[];
    byChantier: { chantier: Chantier; indicators: Indicator[] }[];
  }[];
  orphans: Indicator[];
  measurements: IndicatorMeasurement[];
  /** Historique COMPLET (non filtré par année) d'où est tirée la valeur initiale du calcul
   *  d'avancement — voir `computeIndicatorDelta`. Défaut : `measurements`. */
  baselineMeasurements?: IndicatorMeasurement[];
  /** Clic sur une ligne : ouvre la carte du KPI (graphique compris) en pop-up, sans quitter la
   *  vue Tableau. */
  onIndicatorClick?: (indicatorId: string) => void;
  labels: {
    axisUnknown: string;
    indicator: string;
    current: string;
    target: string;
    finalTarget: string;
    status: string;
    onTrack: string;
    atRisk: string;
    noValue: string;
  };
}) {
  const { t } = useTranslation();
  const th =
    "sticky top-0 z-10 border-b border-border bg-bg-surface px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-tertiary whitespace-nowrap";
  const td = "px-3 py-2.5 text-sm text-text-primary align-top";

  const renderRow = (indicator: Indicator, index: number, chantierName?: string) => {
    // Valeur CHIFFRÉE la plus récente de la période affichée (un commentaire seul ne la masque
    // pas) ; à défaut, la dernière saisie (commentaire).
    const latest =
      latestNumericMeasurement(indicator.id, measurements) ??
      latestMeasurement(indicator.id, measurements);
    const unitSuffix = indicator.unit ? ` ${indicator.unit}` : "";
    const current =
      latest?.value !== undefined
        ? `${latest.value}${unitSuffix}`
        : (latest?.note ?? labels.noValue);
    // Référence = valeur au début du plan stratégique : la plus ancienne mesure chiffrée de
    // l'historique COMPLET (jamais bornée par le filtre d'année), même formatage que "Actuel".
    const baseline = baselineMeasurement(indicator.id, baselineMeasurements ?? measurements);
    const baselineText = baseline?.value !== undefined ? `${baseline.value}${unitSuffix}` : "—";
    // Cible APPLICABLE à la période de la dernière mesure — sans mesure, rien à résoudre (pas de
    // repli sur "aujourd'hui" : on ne sait pas quelle période comparer), voir le doc-comment du
    // composant.
    const currentTarget = latest
      ? resolveIndicatorTargetForPeriod(indicator, latest.period)
      : undefined;
    // Statut lu sur les MÊMES mesures que la valeur affichée (année sélectionnée) — plus de
    // statut global à côté d'une valeur d'une autre année. "Sans donnée" = rien à comparer.
    const readingState = indicatorReadingState(indicator, measurements);
    // Accent "dans la cible / sur la trajectoire / à risque" (round "KPI pro") : dérivé de
    // l'avancement vers la cible du PALIER courant (`progressToStepPct`, contexte du statut),
    // rebucketé par `progressBucket` — jamais une nouvelle échelle de couleur, voir doc-comment en
    // tête de fichier. `undefined` (pas d'objectif chiffré ou pas de mesure exploitable) reste
    // neutre. La colonne "Avancement" affiche, elle, l'avancement vers la cible FINALE.
    const delta = computeIndicatorDelta(indicator, latest, baselineMeasurements ?? measurements);
    const bucket = progressBucket(delta?.progressToStepPct);

    return (
      <tr
        key={indicator.id}
        onClick={onIndicatorClick ? () => onIndicatorClick(indicator.id) : undefined}
        onKeyDown={
          onIndicatorClick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onIndicatorClick(indicator.id);
                }
              }
            : undefined
        }
        tabIndex={onIndicatorClick ? 0 : undefined}
        aria-label={
          onIndicatorClick
            ? `${t("kpi.table.openIndicator", "Voir le détail du KPI")} : ${indicator.name}`
            : undefined
        }
        className={`group border-b border-l-4 border-border transition-colors last:border-b-0 hover:bg-bp-coral/[0.04] ${
          onIndicatorClick
            ? "cursor-pointer focus:outline-none focus-visible:bg-bp-coral/[0.06]"
            : ""
        } ${ROW_ACCENT[bucket]} ${index % 2 === 1 ? "bg-neutral-50/60" : "bg-white"}`}
      >
        <td className={td}>
          <div className="flex items-center gap-1.5 font-medium">
            <span
              className={
                onIndicatorClick ? "group-hover:text-bp-coral group-hover:underline" : undefined
              }
            >
              {indicator.name}
            </span>
            {onIndicatorClick && (
              <Maximize2
                size={12}
                aria-hidden
                className="shrink-0 text-tertiary opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
              />
            )}
          </div>
          {chantierName && <div className="text-[11px] text-text-secondary">{chantierName}</div>}
          <IndicatorMetaLine indicator={indicator} className="mt-1" />
        </td>
        <td className={td}>{baselineText}</td>
        <td className={`${td} font-semibold ${VALUE_COLOR[bucket]}`}>{current}</td>
        <td className={td}>
          {currentTarget !== undefined ? `${currentTarget}${unitSuffix}` : "—"}
        </td>
        <td className={td}>
          {indicator.objectiveValue !== undefined
            ? `${indicator.objectiveValue}${unitSuffix}`
            : "—"}
        </td>
        <td className={`${td} tabular-nums`}>
          {delta ? (
            <>
              <div className="font-semibold">
                {formatIndicatorProgress(delta.progressToFinalPct, delta.approximate)}
              </div>
              {delta.stepPeriod && (
                <div className="text-[11px] text-text-secondary">
                  {t("kpi.progress.step", "Palier")} {delta.stepPeriod} :{" "}
                  {formatIndicatorProgress(delta.progressToStepPct, delta.stepApproximate)}
                </div>
              )}
              {delta.approximate && (
                <div className="text-[10px] italic text-tertiary">
                  {t("kpi.progress.approxShort", "approx.")}
                </div>
              )}
            </>
          ) : (
            "—"
          )}
        </td>
        <td className={td}>
          {readingState === "no_data" ? (
            <span className="text-xs text-tertiary">{labels.noValue}</span>
          ) : (
            <IndicatorStatusBadge
              status={readingState}
              label={readingState === "on_track" ? labels.onTrack : labels.atRisk}
            />
          )}
        </td>
      </tr>
    );
  };

  const renderTable = (rows: React.ReactNode) => (
    <div className="overflow-hidden rounded-lg border border-border shadow-sm">
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>{labels.indicator}</th>
              <th
                className={th}
                title={t("kpi.table.baselineHint", "Valeur au début du plan stratégique")}
              >
                {t("kpi.table.baseline", "Référence")}
              </th>
              <th className={th}>{labels.current}</th>
              <th className={th}>{labels.target}</th>
              <th className={th}>{labels.finalTarget}</th>
              <th className={th}>{t("kpi.progress.label", "Avancement")}</th>
              <th className={th}>{labels.status}</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {grouped.map(({ axis, macro, byChantier }) => {
        // Rangées à plat (macro puis par chantier) — un SEUL compteur d'index pour tout le
        // tableau de l'axe, pour que le zébrage alterne en continu plutôt que de repartir à 0 à
        // chaque groupe de chantier (voir `renderRow`, param `index`).
        const flatRows: { indicator: Indicator; chantierName?: string }[] = [
          ...macro.map((indicator) => ({ indicator })),
          ...byChantier.flatMap(({ chantier, indicators }) =>
            indicators.map((indicator) => ({ indicator, chantierName: chantier.name }))
          ),
        ];
        return (
          <div key={axis.id} className="space-y-2">
            <h3 className="text-sm font-bold uppercase tracking-wide text-text-primary">
              {axis.name}
            </h3>
            {renderTable(
              <Fragment>
                {flatRows.map((row, i) => renderRow(row.indicator, i, row.chantierName))}
              </Fragment>
            )}
          </div>
        );
      })}
      {orphans.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-text-primary">
            {labels.axisUnknown}
          </h3>
          {renderTable(
            <Fragment>{orphans.map((indicator, i) => renderRow(indicator, i))}</Fragment>
          )}
        </div>
      )}
    </div>
  );
}
