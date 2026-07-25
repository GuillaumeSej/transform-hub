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

export type WorkstreamBarPoint = {
  label: string;
  target: number;
  realized: number;
  reforecast?: number;
};

/** Tick custom pour l'axe X : label tronqué avec <title> SVG natif pour le tooltip au hover. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TruncatedTick(props: any) {
  const { x = 0, y = 0, payload } = props;
  const label = (payload?.value as string) ?? "";
  const maxLen = 12;
  const truncated = label.length > maxLen ? label.slice(0, maxLen) + "…" : label;
  return (
    <g>
      <title>{label}</title>
      <text x={x} y={y + 12} textAnchor="middle" fontSize={10} fill="#1A1A1A">
        {truncated}
      </text>
    </g>
  );
}

/** Savings réalisés vs cible par dimension (workstream, pays, fonction).
 *
 *  Chaque barre = cible (hauteur totale, fond gris) avec remplissage coral (réalisé).
 *  Un trait horizontal noir matérialise la reprévision si elle diffère de la cible.
 *  Labels tronqués avec tooltip SVG natif au hover. */
export function WorkstreamBarChart({
  data,
  labelTarget = "Cible",
  labelRealized = "Réalisé",
  labelReforecast = "Reprévision",
}: {
  data: WorkstreamBarPoint[];
  labelTarget?: string;
  labelRealized?: string;
  labelReforecast?: string;
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucun levier à représenter.</p>;
  }

  // Calculer la partie "remaining" (cible - réalisé) pour l'empilement
  const chartData = data.map((d) => ({
    ...d,
    remaining: Math.max(0, Math.round((d.target - d.realized) * 10) / 10),
  }));

  const maxValue = Math.max(...data.map((d) => Math.max(d.target, d.reforecast ?? 0)));

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart
          data={chartData}
          margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
          barCategoryGap="20%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={TruncatedTick} />
          <YAxis
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `€${v}M`}
            domain={[0, Math.ceil(maxValue * 1.1)]}
          />
          <Tooltip formatter={(value) => `€${value}M`} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {/* Barre réalisé (bas de la pile) — coral */}
          <Bar
            dataKey="realized"
            name={labelRealized}
            stackId="a"
            fill="#FF3C47"
            radius={[0, 0, 0, 0]}
          />
          {/* Barre remaining (haut de la pile) — gris transparent */}
          <Bar
            dataKey="remaining"
            name={labelTarget}
            stackId="a"
            fill="rgba(168,154,147,0.3)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
      {/* Overlay SVG pour les marqueurs de reprévision */}
      {data.some(
        (d) => d.reforecast != null && Math.abs((d.reforecast ?? 0) - d.target) > 0.05
      ) && (
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-secondary">
          <span className="inline-block h-[2px] w-3 bg-neutral-800" />
          <span>{labelReforecast}</span>
        </div>
      )}
    </div>
  );
}
