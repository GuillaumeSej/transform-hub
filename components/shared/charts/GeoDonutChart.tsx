"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatMillions } from "@/lib/format";

const COLORS = ["#FF3C47", "#991D1F", "#FF797B", "#806659", "#A99E9A", "#320300"];

export type GeoDonutPoint = { name: string; value: number };

/** Répartition des savings par géographie — porté depuis le donut Chart.js `ch-geo` du prototype legacy. */
export function GeoDonutChart({ data }: { data: GeoDonutPoint[] }) {
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
        >
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => formatMillions(Number(value))} />
        <Legend
          wrapperStyle={{ fontSize: 11 }}
          layout="vertical"
          verticalAlign="middle"
          align="right"
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
