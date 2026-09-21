"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { ClickForDetailsHint, currentGapMarks } from "./SCurveChart";

export type QuarterBridgePoint = { quarter: string; delta: number; cumulative: number | null };

/** Économies par période (barres) cumulées vs plan initial (ligne pointillée).
 *
 * `plannedCumulative` remplace l'ancienne ligne plate `target` : c'est la courbe du plan initial
 * cumulé, alignée sur les mêmes périodes que les données du bridge. Si non fournie, la ligne
 * de plan n'est pas affichée (pas de fallback sur une droite plate).
 *
 * `barLabel` et `labelCumulative`/`labelPlanned` sont passables en props pour la traduction. */
export function QuarterlyBridgeChart({
  data,
  height = 240,
  onBarClick,
  plannedCumulative,
  reforecastCumulative,
  barLabel,
  labelCumulative,
  labelPlanned,
  labelReforecast,
}: {
  data: QuarterBridgePoint[];
  height?: number;
  onBarClick?: (quarter: string) => void;
  /** Valeurs cumulées du plan initial, une par période — même longueur que `data`. */
  plannedCumulative?: number[];
  /** Réactualisé cumulé, une valeur par période (même série que la courbe en S). */
  reforecastCumulative?: number[];
  /** Label de la ligne réactualisé. */
  labelReforecast?: string;
  /** Label des barres (adapté à la granularité : "du mois" vs "du trimestre"). */
  barLabel?: string;
  /** Label de la ligne cumulative. */
  labelCumulative?: string;
  /** Label de la ligne plan initial. */
  labelPlanned?: string;
}) {
  const { t } = useTranslation();
  const resolvedBarLabel = barLabel ?? t("chart.bridge.periodSavings", "Économies de la période");
  const resolvedLabelCumulative = labelCumulative ?? t("chart.bridge.cumulative", "Cumulé");
  const resolvedLabelPlanned = labelPlanned ?? t("chart.bridge.planned", "Plan initial");
  const resolvedLabelReforecast = labelReforecast ?? t("chart.scurve.reforecast", "Réactualisé");

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("chart.emptyLevers", "Aucun levier à représenter.")}
      </p>
    );
  }

  const chartData = data.map((d, i) => ({
    ...d,
    ...(plannedCumulative ? { planned: plannedCumulative[i] ?? 0 } : {}),
    ...(reforecastCumulative ? { reforecast: reforecastCumulative[i] ?? 0 } : {}),
  }));
  // Période courante = dernier point dont le cumulé réalisé est connu (même règle que la S-curve).
  let curIdx = -1;
  for (let i = chartData.length - 1; i >= 0; i--) {
    if (chartData[i].cumulative !== null) {
      curIdx = i;
      break;
    }
  }
  const cur =
    curIdx >= 0 && reforecastCumulative
      ? {
          month: chartData[curIdx].quarter,
          actual: chartData[curIdx].cumulative,
          reforecast: reforecastCumulative[curIdx] ?? 0,
        }
      : null;

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={chartData}
          margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
          onClick={(e) => {
            const label = e?.activeLabel;
            if (typeof label === "string") onBarClick?.(label);
          }}
          style={{ cursor: onBarClick ? "pointer" : undefined }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
          <XAxis dataKey="quarter" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `€${v}M`}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="line"
            wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
          />
          {currentGapMarks(cur, t("chart.scurve.gapBadge", "Écart"))}
          <Bar
            dataKey="delta"
            name={resolvedBarLabel}
            fill="rgba(255,60,71,0.35)"
            radius={[3, 3, 0, 0]}
          />
          <Line
            type="monotone"
            dataKey="cumulative"
            name={resolvedLabelCumulative}
            stroke="#FF3C47"
            strokeWidth={2.5}
            dot={{ r: 3 }}
          />
          {plannedCumulative && (
            <Line
              type="monotone"
              dataKey="planned"
              name={resolvedLabelPlanned}
              stroke="#806659"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
            />
          )}
          {reforecastCumulative && (
            <Line
              type="monotone"
              dataKey="reforecast"
              name={resolvedLabelReforecast}
              stroke="#320300"
              strokeWidth={2}
              strokeDasharray="2 3"
              dot={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {onBarClick && <ClickForDetailsHint />}
    </div>
  );
}
