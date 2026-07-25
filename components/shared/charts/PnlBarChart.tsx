"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type PnlBarPoint = { account: string; impact: number };

/** Tick custom pour l'axe Y : label tronqué avec tooltip SVG natif au hover. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TruncatedYTick(props: any) {
  const { x = 0, y = 0, payload } = props;
  const label = (payload?.value as string) ?? "";
  const maxLen = 18;
  const truncated = label.length > maxLen ? label.slice(0, maxLen) + "…" : label;
  return (
    <g>
      <title>{label}</title>
      <text x={x - 4} y={y} dy={4} textAnchor="end" fontSize={10} fill="#1A1A1A">
        {truncated}
      </text>
    </g>
  );
}

/** Impact savings par compte P&L (bar horizontale) avec légende et tooltips sur les labels
 *  tronqués. Porté depuis le chart Chart.js `ch-pnl` du prototype legacy. */
export function PnlBarChart({
  data,
  labelImpact = "Impact savings",
}: {
  data: PnlBarPoint[];
  labelImpact?: string;
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucun impact à afficher.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 36 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `€${v}M`}
        />
        <YAxis
          type="category"
          dataKey="account"
          tick={TruncatedYTick}
          axisLine={false}
          tickLine={false}
          width={140}
        />
        <Tooltip formatter={(value) => [`€${Number(value).toFixed(1)}M`, labelImpact]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="impact" name={labelImpact} fill="#FF3C47" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
