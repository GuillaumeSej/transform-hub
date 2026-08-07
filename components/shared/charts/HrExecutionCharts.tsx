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
import type { ExecutionImpactRow, MovementExecutionStatus } from "@/lib/hrExecution";
import { EXECUTION_LABELS } from "@/lib/hrExecution";

const STATUS_COLORS: Record<MovementExecutionStatus, string> = {
  realized: "#421799",
  overdue: "#FF3C47",
  dueSoon: "#FFB1B5",
  later: "#A99E9A",
  abandoned: "#806659",
};

const STATUS_ORDER: MovementExecutionStatus[] = [
  "realized",
  "overdue",
  "dueSoon",
  "later",
  "abandoned",
];

/** Graphique partagé ETP / masse salariale par statut d'exécution. */
export function ExecutionStatusChart({
  data,
  mode,
  height = 280,
  onBarClick,
}: {
  data: ExecutionImpactRow[];
  mode: "fte" | "salary";
  height?: number;
  onBarClick?: (dimensionValue: string, status: MovementExecutionStatus) => void;
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucun mouvement à afficher.</p>;
  }
  const chartData = data.map((row) => ({
    label: row.label,
    ...Object.fromEntries(STATUS_ORDER.map((status) => [status, row[status].volume])),
    meta: row,
  }));
  const formatValue = (value: number) =>
    mode === "fte"
      ? `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ETP`
      : `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} M€`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 6, right: 8, left: 0, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          angle={-20}
          textAnchor="end"
          height={42}
        />
        <YAxis
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value) =>
            mode === "fte" ? String(value) : `${Number(value).toFixed(1)} M€`
          }
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0]?.payload?.meta as ExecutionImpactRow | undefined;
            if (!row) return null;
            return (
              <div className="rounded-md border border-border bg-white px-3 py-2 text-xs shadow-sm">
                <div className="mb-1 font-semibold text-primary">{label}</div>
                {STATUS_ORDER.map((status) => (
                  <div key={status} className="flex items-center justify-between gap-5 py-0.5">
                    <span style={{ color: STATUS_COLORS[status] }}>{EXECUTION_LABELS[status]}</span>
                    <span className="font-semibold tabular-nums text-primary">
                      {formatValue(row[status].volume)} · {row[status].count} mvt
                      {mode === "fte"
                        ? ` · net ${row[status].net > 0 ? "+" : ""}${row[status].net.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}`
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            );
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {STATUS_ORDER.map((status) => (
          <Bar
            key={status}
            dataKey={status}
            name={EXECUTION_LABELS[status]}
            stackId="status"
            fill={STATUS_COLORS[status]}
            onClick={(entry) => {
              const label = (entry as { label?: string })?.label;
              if (label) onBarClick?.(label, status);
            }}
            cursor={onBarClick ? "pointer" : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
