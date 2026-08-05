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

export type PnlBarPoint = { account: string; plan: number; realized: number };

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

/** Impact P&L par compte — barres horizontales empilées : le réalisé (coral) est superposé
 *  sur le plan (gris). La portion grise visible = ce qui reste à réaliser pour atteindre le plan. */
export function PnlBarChart({
  data,
  labelPlan = "Plan",
  labelRealized = "Réalisé",
}: {
  data: PnlBarPoint[];
  labelPlan?: string;
  labelRealized?: string;
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucun impact à afficher.</p>;
  }

  const chartData = data.map((d) => ({
    ...d,
    remaining: Math.max(0, Math.round((d.plan - d.realized) * 10) / 10),
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 36 + 40)}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" horizontal={false} />
        {/* domain={[0, "auto"]} : sans borne min explicite, Recharts applique un `nice()` qui
         * élargit l'axe des deux côtés du zéro (ex. €-3M → €9M pour des valeurs €0 → €6M) et
         * décale visuellement les barres loin des libellés Y — voir capture pilote Août 2026.
         * Ancrer à 0 remet les barres immédiatement contre les libellés. Les impacts P&L
         * (savings, coûts) sont toujours ≥ 0 dans ce widget (seule la "part restante" est signée
         * positive par construction dans chartData). */}
        <XAxis
          type="number"
          domain={[0, "auto"]}
          allowDecimals={false}
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
        <Tooltip formatter={(value) => `€${Number(value).toFixed(1)}M`} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar
          dataKey="realized"
          name={labelRealized}
          stackId="a"
          fill="#FF3C47"
          radius={[0, 0, 0, 0]}
        />
        <Bar
          dataKey="remaining"
          name={labelPlan}
          stackId="a"
          fill="rgba(168,154,147,0.3)"
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
