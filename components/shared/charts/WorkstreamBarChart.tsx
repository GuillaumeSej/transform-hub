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

export type WorkstreamBarPoint = { label: string; realized: number; target: number };

/** Savings réalisés vs cible par workstream — porté depuis le chart Chart.js `ch-ws` du prototype legacy. */
export function WorkstreamBarChart({ data }: { data: WorkstreamBarPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `€${v}M`}
        />
        <Tooltip formatter={(value, name) => [`€${value}M`, name]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="realized" name="Réalisé" fill="#FF3D3D" radius={[4, 4, 0, 0]} />
        <Bar dataKey="target" name="Cible" fill="rgba(168,154,147,0.5)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
