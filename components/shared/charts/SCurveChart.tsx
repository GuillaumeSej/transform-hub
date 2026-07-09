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
 * éditable à partir de L4). Porté/étendu depuis le chart Chart.js `ch-scurve` du prototype legacy. */
export function SCurveChart({ data }: { data: SCurvePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `€${v}M`}
        />
        <Tooltip formatter={(value, name) => [`€${value}M`, name]} />
        <Line
          type="monotone"
          dataKey="actual"
          name="Réalisé (€M)"
          stroke="#FF3D3D"
          strokeWidth={2.5}
          dot={{ r: 3 }}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="planned"
          name="Plan initial (€M)"
          stroke="#6B5750"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="reforecast"
          name="Réactualisé (€M)"
          stroke="#2E7D32"
          strokeWidth={2}
          strokeDasharray="2 3"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
