"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type SCurvePoint = {
  month: string;
  planned: number;
  actual: number | null;
  reforecast: number;
};

/** S-Curve à 3 courbes — Plan initial (figé à L3), Réalisé à date, Réactualisé (prévision à jour,
 * éditable à partir de L4). Porté/étendu depuis le chart Chart.js `ch-scurve` du prototype legacy.
 * Clic sur un point (ou son mois) -> creuse vers les leviers qui se terminent ce mois-là. */
export function SCurveChart({
  data,
  height = 260,
  onPointClick,
}: {
  data: SCurvePoint[];
  height?: number;
  onPointClick?: (month: string) => void;
}) {
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
        <Line
          type="monotone"
          dataKey="actual"
          name="Réalisé (€M)"
          stroke="#FF3C47"
          strokeWidth={2.5}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="planned"
          name="Plan initial (€M)"
          stroke="#806659"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="reforecast"
          name="Réactualisé (€M)"
          stroke="#320300"
          strokeWidth={2}
          strokeDasharray="2 3"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
