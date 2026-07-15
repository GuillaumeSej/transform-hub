"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DepartmentMovements } from "@/lib/hrEngine";

// Palette catégorielle validée (dataviz, tous checks PASS sur surface claire).
export const HR_CATEGORICAL = ["#FF3D3D", "#1565C0", "#2E7D32", "#C77800", "#6D4C9F", "#0097A7"];

const COLOR_DOWN = "#FF3D3D"; // suppressions
const COLOR_UP = "#1565C0"; // recrutements
const COLOR_NEUTRAL = "#6B5750"; // transferts (redéploiements + reconversions)

/** Barres divergentes par département : suppressions vers le bas (corail), recrutements vers le
 * haut (bleu), transferts en neutre — trois séries co-signées, un seul axe ETP. */
export function DepartmentMovementsChart({
  data,
  height = 260,
}: {
  data: DepartmentMovements[];
  height?: number;
}) {
  const chartData = data.map((d) => ({
    department: d.department.split(" ")[0],
    fullName: d.department,
    Suppressions: -d.suppressions,
    Recrutements: d.recrutements,
    Transferts: d.transferts,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="department" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(value, name) => [`${Math.abs(Number(value))} ETP`, String(name)]}
          labelFormatter={(_, payload) =>
            (payload?.[0]?.payload as { fullName?: string })?.fullName ?? ""
          }
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine y={0} stroke="rgba(0,0,0,0.25)" />
        <Bar dataKey="Suppressions" fill={COLOR_DOWN} radius={[0, 0, 3, 3]} />
        <Bar dataKey="Recrutements" fill={COLOR_UP} radius={[3, 3, 0, 0]} />
        <Bar dataKey="Transferts" fill={COLOR_NEUTRAL} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Donut générique ETP (mouvements par pays) — palette catégorielle validée, ordre fixe. */
export function HrDonutChart({
  data,
  height = 240,
  onSliceClick,
}: {
  data: { name: string; value: number }[];
  height?: number;
  onSliceClick?: (name: string) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={52}
          outerRadius={86}
          paddingAngle={2}
          onClick={(d) => {
            const name = (d as { name?: string })?.name;
            if (name) onSliceClick?.(name);
          }}
          cursor={onSliceClick ? "pointer" : undefined}
        >
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={HR_CATEGORICAL[i % HR_CATEGORICAL.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => `${Number(value).toLocaleString("fr-FR")} ETP`} />
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
