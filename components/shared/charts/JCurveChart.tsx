"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type JCurvePoint = {
  month: string;
  plan: number;
  reforecast: number;
  actual: number | null;
};

/** Courbe en J — visualise le profil coûts → gains d'un levier dans le temps.
 *  Zone rouge (sous 0) = phase d'investissement. Zone verte (au-dessus de 0) = création de valeur.
 *  3 courbes : Plan (pointillé brun), Reforecast (pointillé noir), Réalisé (coral plein). */
export function JCurveChart({
  data,
  height = 280,
  paybackMonth,
  labelPlan = "Plan",
  labelReforecast = "Reforecast",
  labelActual = "Réalisé",
}: {
  data: JCurvePoint[];
  height?: number;
  paybackMonth?: string | null;
  labelPlan?: string;
  labelReforecast?: string;
  labelActual?: string;
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucune donnée à afficher.</p>;
  }

  // Séparer les données en zones positive/négative pour la coloration
  const chartData = data.map((d) => ({
    ...d,
    planPositive: d.plan >= 0 ? d.plan : 0,
    planNegative: d.plan < 0 ? d.plan : 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2E7D32" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#2E7D32" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="redGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#C8281A" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#C8281A" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" />
        <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `€${v}M`}
        />
        <Tooltip formatter={(value) => `€${Number(value).toFixed(2)}M`} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {/* Zone verte (au-dessus de 0) */}
        <Area
          type="monotone"
          dataKey="planPositive"
          fill="url(#greenGrad)"
          stroke="none"
          name=" "
          legendType="none"
        />
        {/* Zone rouge (en dessous de 0) */}
        <Area
          type="monotone"
          dataKey="planNegative"
          fill="url(#redGrad)"
          stroke="none"
          name=" "
          legendType="none"
        />
        {/* Ligne zéro */}
        <ReferenceLine y={0} stroke="#1A1A1A" strokeWidth={1} strokeDasharray="4 4" />
        {/* Payback marker */}
        {paybackMonth && (
          <ReferenceLine
            x={paybackMonth}
            stroke="#2E7D32"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            label={{ value: "Payback", position: "top", fontSize: 10, fill: "#2E7D32" }}
          />
        )}
        {/* Plan */}
        <Line
          type="monotone"
          dataKey="plan"
          name={labelPlan}
          stroke="#806659"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
        />
        {/* Reforecast */}
        <Line
          type="monotone"
          dataKey="reforecast"
          name={labelReforecast}
          stroke="#320300"
          strokeWidth={1.5}
          strokeDasharray="2 3"
          dot={false}
        />
        {/* Réalisé */}
        <Line
          type="monotone"
          dataKey="actual"
          name={labelActual}
          stroke="#FF3C47"
          strokeWidth={2.5}
          dot={{ r: 3 }}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
