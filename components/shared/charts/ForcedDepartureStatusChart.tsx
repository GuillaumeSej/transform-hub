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
import type { ForcedDepartureStatusRow } from "@/lib/hrSocialPlan";

export function ForcedDepartureStatusChart({
  data,
  height = 300,
}: {
  data: ForcedDepartureStatusRow[];
  height?: number;
}) {
  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">Aucun départ forcé à afficher.</p>
    );
  }
  const chartHeight = Math.max(height, data.length * 42 + 90);
  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 12, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="scheme"
          width={92}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          formatter={(value, name) => [`${Number(value)} mouvement(s)`, String(name)]}
          labelFormatter={(label) => `Dispositif : ${label}`}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="realized" name="Réalisés" stackId="status" fill="#421799" />
        <Bar dataKey="planned" name="Prévus / restant à réaliser" stackId="status" fill="#CCC1BD" />
        <Bar dataKey="abandoned" name="Abandonnés" stackId="status" fill="#806659" />
      </BarChart>
    </ResponsiveContainer>
  );
}
