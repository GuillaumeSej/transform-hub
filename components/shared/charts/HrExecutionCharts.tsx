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
import { executionLabel } from "@/lib/hrMovementLabels";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { WorkforceMovement } from "@/types";
import { formatMillions, formatNumber, formatPct, intlTag } from "@/lib/format";
import {
  departmentContributors,
  executionMovementFte,
  shareOfTotal,
  sumAbs,
} from "@/lib/hrChartPreview";
import { ChartHoverArea, FloatingPreview, HIDDEN_TOOLTIP_WRAPPER } from "./HoverPreview";
import { HrChartPreview } from "./HrChartPreview";

/** Couleurs de statut d'exécution (charte BP) — réutilisées par `MovementProgressByDimensionChart`. */
export const STATUS_COLORS: Record<MovementExecutionStatus, string> = {
  realized: "#421799",
  overdue: "#FF3C47",
  dueSoon: "#FF797B",
  later: "#FFB1B5",
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
  /** Clic sur un segment (dimension × statut) — ouvre le détail des mouvements de cette cellule
   *  (voir `MovementDrilldownModal`, câblé dans `app/(app)/hr/page.tsx`). */
  onBarClick?: (
    dimensionValue: string,
    status: MovementExecutionStatus,
    movements: WorkforceMovement[]
  ) => void;
}) {
  const { t } = useTranslation();

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("shared.executionStatusChart.noData", "Aucun mouvement à afficher.")}
      </p>
    );
  }
  const chartData = data.map((row) => ({
    label: row.label,
    ...Object.fromEntries(STATUS_ORDER.map((status) => [status, row[status].volume])),
    meta: row,
  }));
  const fteUnit = t("etp.column.fte", "ETP");
  const formatValue = (value: number) =>
    mode === "fte"
      ? `${value.toLocaleString(intlTag(), { maximumFractionDigits: 1 })} ${fteUnit}`
      : formatMillions(value, 2);
  // Même grandeur que les barres (`executionByDimension`) : ETP réalisé constaté / ETP du plan
  // sinon, ou impact masse salariale €M.
  const contributorValue = (m: WorkforceMovement) =>
    mode === "fte" ? executionMovementFte(m) : m.salaryImpact / 1_000_000;
  const rowVolume = (row: ExecutionImpactRow) =>
    STATUS_ORDER.reduce((sum, status) => sum + row[status].volume, 0);
  const grandTotal = sumAbs(data.map(rowVolume));

  return (
    <ChartHoverArea>
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
              mode === "fte" ? formatNumber(Number(value)) : formatMillions(Number(value), 1)
            }
          />
          {/* Aperçu au survol (retour PO) : valeur et nombre de mouvements par statut, total, taux
            de réalisation, part du total et principaux départements — puis clic = mouvements. */}
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            wrapperStyle={HIDDEN_TOOLTIP_WRAPPER}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]?.payload?.meta as ExecutionImpactRow | undefined;
              if (!row) return null;
              const rowTotal = rowVolume(row);
              const planned = rowTotal - row.abandoned.volume;
              const movements = STATUS_ORDER.flatMap((status) => row[status].movements);
              const contributors = departmentContributors(movements, contributorValue);
              const mvt = (n: number) =>
                t("shared.executionStatusChart.movementCount", "{n} mvt").replace("{n}", String(n));
              const realizedPct = shareOfTotal(row.realized.volume, planned);
              return (
                <FloatingPreview>
                  <HrChartPreview
                    title={row.label}
                    rows={[
                      ...STATUS_ORDER.filter((status) => row[status].count > 0).map((status) => ({
                        label: executionLabel(t, status),
                        value: `${formatValue(row[status].volume)} · ${mvt(row[status].count)}${
                          mode === "fte"
                            ? ` · ${t("shared.executionStatusChart.net", "net")} ${row[status].net > 0 ? "+" : ""}${row[status].net.toLocaleString(intlTag(), { maximumFractionDigits: 1 })}`
                            : ""
                        }`,
                        marker: { color: STATUS_COLORS[status] },
                      })),
                      {
                        label: t("chart.hrPreview.total", "Total"),
                        value: `${formatValue(rowTotal)} · ${mvt(movements.length)}`,
                        strong: true,
                      },
                      ...(realizedPct !== null
                        ? [
                            {
                              label: t(
                                "chart.hrPreview.realizedRate",
                                "Réalisé / prévu (hors abandons)"
                              ),
                              value: formatPct(realizedPct),
                              muted: true,
                            },
                          ]
                        : []),
                    ]}
                    share={{ pct: shareOfTotal(rowTotal, grandTotal) }}
                    list={{
                      title: t("chart.hrPreview.topDepartments", "Principaux départements"),
                      items: contributors.map((c) => ({
                        key: c.key,
                        label: c.label,
                        value: formatValue(c.value),
                      })),
                    }}
                    clickHint={!!onBarClick}
                  />
                </FloatingPreview>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {STATUS_ORDER.map((status) => (
            <Bar
              key={status}
              dataKey={status}
              name={executionLabel(t, status)}
              stackId="status"
              fill={STATUS_COLORS[status]}
              onClick={(entry) => {
                const row = (entry as { meta?: ExecutionImpactRow })?.meta;
                if (row) onBarClick?.(row.label, status, row[status].movements);
              }}
              cursor={onBarClick ? "pointer" : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartHoverArea>
  );
}
