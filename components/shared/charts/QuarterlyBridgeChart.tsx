"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type QuarterBridgePoint = { quarter: string; delta: number; cumulative: number };

/** Économies par trimestre (barres) cumulées vers la cible (ligne) — clic sur une barre pour
 * creuser vers les leviers qui se terminent ce trimestre-là. */
export function QuarterlyBridgeChart({
  data,
  target,
  height = 240,
  onBarClick,
}: {
  data: QuarterBridgePoint[];
  target: number;
  height?: number;
  onBarClick?: (quarter: string) => void;
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucun levier à représenter.</p>;
  }
  const withTarget = data.map((d) => ({ ...d, target }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={withTarget} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="quarter" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `€${v}M`}
        />
        <Tooltip formatter={(value) => `€${value}M`} />
        <Bar
          dataKey="delta"
          name="Économies du trimestre (€M)"
          fill="#FF3C47"
          radius={[3, 3, 0, 0]}
          onClick={(d) => {
            const quarter = (d as { quarter?: string })?.quarter;
            if (quarter) onBarClick?.(quarter);
          }}
          cursor={onBarClick ? "pointer" : undefined}
        />
        <Line
          type="monotone"
          dataKey="cumulative"
          name="Cumulé (€M)"
          stroke="#806659"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
        <Line
          type="monotone"
          dataKey="target"
          name="Cible (€M)"
          stroke="#320300"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
