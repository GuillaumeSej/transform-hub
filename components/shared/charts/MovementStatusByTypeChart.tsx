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
import type { MovementStatusByTypeRow } from "@/lib/hrExecution";

export function MovementStatusByTypeChart({
  data,
  height = 280,
}: {
  data: MovementStatusByTypeRow[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(height, data.length * 42 + 70)}>
      <BarChart data={data} layout="vertical" margin={{ top: 6, right: 14, left: 10, bottom: 16 }}>
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
          dataKey="type"
          width={115}
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip formatter={(value, name) => [`${Number(value)} mouvement(s)`, String(name)]} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <Bar dataKey="realized" name="Réalisé" stackId="status" fill="#421799" />
        <Bar dataKey="overdue" name="En retard" stackId="status" fill="#FF3C47" />
        <Bar dataKey="dueSoon" name="À venir < 90 j" stackId="status" fill="#FFB1B5" />
        <Bar dataKey="later" name="À venir > 90 j" stackId="status" fill="#A99E9A" />
        <Bar dataKey="abandoned" name="Abandonné" stackId="status" fill="#806659" />
      </BarChart>
    </ResponsiveContainer>
  );
}
