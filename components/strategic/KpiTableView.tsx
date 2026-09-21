"use client";

import { Fragment } from "react";
import {
  latestMeasurement,
  resolveIndicatorStatus,
  resolveIndicatorTargetForPeriod,
} from "@/lib/axisLogic";
import { IndicatorStatusBadge } from "@/components/strategic/IndicatorStatusBadge";
import type { Chantier, Indicator, IndicatorMeasurement, StrategicAxis } from "@/types";

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
  labels,
}: {
  grouped: {
    axis: StrategicAxis;
    macro: Indicator[];
    byChantier: { chantier: Chantier; indicators: Indicator[] }[];
  }[];
  orphans: Indicator[];
  measurements: IndicatorMeasurement[];
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
  const th =
    "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-tertiary whitespace-nowrap";
  const td = "px-3 py-2 text-sm text-text-primary align-top";

  const renderRow = (indicator: Indicator, chantierName?: string) => {
    const latest = latestMeasurement(indicator.id, measurements);
    const unitSuffix = indicator.unit ? ` ${indicator.unit}` : "";
    const current =
      latest?.value !== undefined
        ? `${latest.value}${unitSuffix}`
        : (latest?.note ?? labels.noValue);
    // Cible APPLICABLE à la période de la dernière mesure — sans mesure, rien à résoudre (pas de
    // repli sur "aujourd'hui" : on ne sait pas quelle période comparer), voir le doc-comment du
    // composant.
    const currentTarget = latest
      ? resolveIndicatorTargetForPeriod(indicator, latest.period)
      : undefined;
    const status = resolveIndicatorStatus(indicator);

    return (
      <tr key={indicator.id} className="border-t border-border">
        <td className={td}>
          <div className="font-medium">{indicator.name}</div>
          {chantierName && <div className="text-[11px] text-text-secondary">{chantierName}</div>}
        </td>
        <td className={td}>{current}</td>
        <td className={td}>
          {currentTarget !== undefined ? `${currentTarget}${unitSuffix}` : "—"}
        </td>
        <td className={td}>
          {indicator.objectiveValue !== undefined
            ? `${indicator.objectiveValue}${unitSuffix}`
            : "—"}
        </td>
        <td className={td}>
          <IndicatorStatusBadge
            status={status}
            label={status === "on_track" ? labels.onTrack : labels.atRisk}
          />
        </td>
      </tr>
    );
  };

  const renderTable = (rows: React.ReactNode) => (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-bg-surface">
          <tr>
            <th className={th}>{labels.indicator}</th>
            <th className={th}>{labels.current}</th>
            <th className={th}>{labels.target}</th>
            <th className={th}>{labels.finalTarget}</th>
            <th className={th}>{labels.status}</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      {grouped.map(({ axis, macro, byChantier }) => (
        <div key={axis.id} className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-text-primary">
            {axis.name}
          </h3>
          {renderTable(
            <Fragment>
              {macro.map((indicator) => renderRow(indicator))}
              {byChantier.map(({ chantier, indicators }) => (
                <Fragment key={chantier.id}>
                  {indicators.map((indicator) => renderRow(indicator, chantier.name))}
                </Fragment>
              ))}
            </Fragment>
          )}
        </div>
      ))}
      {orphans.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-text-primary">
            {labels.axisUnknown}
          </h3>
          {renderTable(<Fragment>{orphans.map((indicator) => renderRow(indicator))}</Fragment>)}
        </div>
      )}
    </div>
  );
}
