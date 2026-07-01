"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type PnlBarPoint = { account: string; impact: number };

/** Impact savings par compte P&L (bar horizontale) — porté depuis le chart Chart.js `ch-pnl` du prototype legacy. */
export function PnlBarChart({ data }: { data: PnlBarPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `€${v}M`}
        />
        <YAxis
          type="category"
          dataKey="account"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={140}
        />
        <Tooltip formatter={(value) => [`€${Number(value).toFixed(1)}M`, "Impact savings"]} />
        <Bar dataKey="impact" fill="#FF3D3D" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
