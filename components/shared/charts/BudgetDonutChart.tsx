"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

/** Même palette que `GeoDonutChart` — catégorielle, tons de marque, déjà validée sur fond clair.
 *  Round 12 : pas de nouvelle couleur saturée introduite, réutilisation à l'identique. */
const COLORS = ["#FF3C47", "#991D1F", "#FF797B", "#806659", "#A99E9A", "#320300"];

export type BudgetDonutSlice = { name: string; value: number };

/**
 * Donut GÉNÉRIQUE de répartition budgétaire (round 12) — même patron recharts que `GeoDonutChart`
 * (`Pie`/`Cell`/`Tooltip`/`Legend`/`ResponsiveContainer`) mais délibérément PAS spécialisé : ni
 * unité, ni devise, ni domaine en dur — `formatValue` est fourni par l'appelant (ex. `"€2,3M"`,
 * `"120 j.h"`), contrairement à `GeoDonutChart` qui fige `€…M` dans son `Tooltip`. Trois agents
 * réutilisent ce composant pour des ventilations budgétaires différentes (budget de chantier par
 * levier, budget de programme par axe, etc.) — garder ce composant minimal, ne pas lui ajouter de
 * logique métier propre à l'un de ces usages.
 *
 * `onSliceClick`, si fourni, rend à la fois les parts du donut (`Cell`, via le `onClick`/`cursor`
 * du `Pie` — même patron que `HrDonutChart` dans `HrBreakdownCharts.tsx`) et les entrées de la
 * légende cliquables, les deux appelant `onSliceClick(name)` avec le NOM de la part cliquée (pas
 * son index ni sa valeur).
 */
export function BudgetDonutChart({
  data,
  formatValue,
  onSliceClick,
}: {
  data: BudgetDonutSlice[];
  formatValue: (value: number) => string;
  onSliceClick?: (name: string) => void;
}): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={55}
          outerRadius={90}
          paddingAngle={1}
          onClick={(d) => {
            const name = (d as { name?: string })?.name;
            if (name) onSliceClick?.(name);
          }}
          cursor={onSliceClick ? "pointer" : undefined}
        >
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => formatValue(Number(value))} />
        <Legend
          wrapperStyle={{ fontSize: 11, cursor: onSliceClick ? "pointer" : undefined }}
          layout="vertical"
          verticalAlign="middle"
          align="right"
          onClick={(entry) => {
            const name = (entry as { value?: string })?.value;
            if (name) onSliceClick?.(name);
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
