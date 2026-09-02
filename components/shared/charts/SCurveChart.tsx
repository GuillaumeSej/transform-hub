"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "@/lib/i18n/useTranslation";

export type SCurvePoint = {
  month: string;
  planned: number;
  actual: number | null;
  reforecast: number;
};

/** S-Curve à 3 courbes — Plan initial (figé à L3), Réalisé à date, Réactualisé (prévision à jour,
 * éditable à partir de L4). Porté/étendu depuis le chart Chart.js `ch-scurve` du prototype legacy.
 * Clic sur un point (ou son mois) -> creuse vers les leviers qui se terminent ce mois-là.
 *
 * Les labels des courbes sont passables en props pour la traduction (i18n). */
export function SCurveChart({
  data,
  height = 260,
  onPointClick,
  labelActual,
  labelPlanned,
  labelReforecast,
}: {
  data: SCurvePoint[];
  height?: number;
  onPointClick?: (month: string) => void;
  labelActual?: string;
  labelPlanned?: string;
  labelReforecast?: string;
}) {
  const { t } = useTranslation();
  const resolvedLabelActual = labelActual ?? t("chart.scurve.actual", "Réalisé");
  const resolvedLabelPlanned = labelPlanned ?? t("chart.scurve.planned", "Plan initial");
  const resolvedLabelReforecast = labelReforecast ?? t("chart.scurve.reforecast", "Réactualisé");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart
        data={data}
        margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
        onClick={(e) => {
          const label = e?.activeLabel;
          if (typeof label === "string") onPointClick?.(label);
        }}
        style={{ cursor: onPointClick ? "pointer" : undefined }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `€${v}M`}
        />
        <Tooltip formatter={(value, name) => [`€${value}M`, name]} />
        <Legend
          verticalAlign="top"
          align="right"
          iconType="line"
          wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
        />
        <Line
          type="monotone"
          dataKey="actual"
          name={resolvedLabelActual}
          stroke="#FF3C47"
          strokeWidth={2.5}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="planned"
          name={resolvedLabelPlanned}
          stroke="#806659"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="reforecast"
          name={resolvedLabelReforecast}
          stroke="#320300"
          strokeWidth={2}
          strokeDasharray="2 3"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
