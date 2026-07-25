"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type QuarterBridgePoint = { quarter: string; delta: number; cumulative: number };

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
  barLabel = "Économies de la période",
  labelCumulative = "Cumulé",
  labelPlanned = "Plan initial",
}: {
  data: QuarterBridgePoint[];
  height?: number;
  onBarClick?: (quarter: string) => void;
  /** Valeurs cumulées du plan initial, une par période — même longueur que `data`. */
  plannedCumulative?: number[];
  /** Label des barres (adapté à la granularité : "du mois" vs "du trimestre"). */
  barLabel?: string;
  /** Label de la ligne cumulative. */
  labelCumulative?: string;
  /** Label de la ligne plan initial. */
  labelPlanned?: string;
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucun levier à représenter.</p>;
  }

  const chartData = data.map((d, i) => ({
    ...d,
    ...(plannedCumulative ? { planned: plannedCumulative[i] ?? 0 } : {}),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="quarter" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `€${v}M`}
        />
        <Tooltip formatter={(value) => `€${value}M`} />
        <Legend
          verticalAlign="top"
          align="right"
          iconType="line"
          wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
        />
        <Bar
          dataKey="delta"
          name={barLabel}
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
          name={labelCumulative}
          stroke="#806659"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
        {plannedCumulative && (
          <Line
            type="monotone"
            dataKey="planned"
            name={labelPlanned}
            stroke="#320300"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
