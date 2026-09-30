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
import type { MovementExecutionStatus, MovementStatusByTypeRow } from "@/lib/hrExecution";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { movementTypeLabel } from "@/lib/hrMovementLabels";
import {
  departmentContributors,
  executionMovementFte as movementFte,
  shareOfTotal,
} from "@/lib/hrChartPreview";
import { formatFte, formatMillions, formatPct } from "@/lib/format";
import { isActiveMovement } from "@/lib/workforceLogic";
import type { WorkforceMovement } from "@/types";
import { ChartHoverArea, FloatingPreview, HIDDEN_TOOLTIP_WRAPPER } from "./HoverPreview";
import { HrChartPreview } from "./HrChartPreview";

const STATUS_ORDER: MovementExecutionStatus[] = [
  "realized",
  "overdue",
  "dueSoon",
  "later",
  "abandoned",
];

export function MovementStatusByTypeChart({
  data,
  height = 280,
  onBarClick,
}: {
  data: MovementStatusByTypeRow[];
  height?: number;
  /** Clic sur un segment (type × statut) — ouvre le détail des mouvements de cette cellule (voir
   *  `MovementDrilldownModal`, câblé dans `app/(app)/hr/page.tsx`). */
  onBarClick?: (
    type: WorkforceMovement["type"],
    status: MovementExecutionStatus,
    movements: WorkforceMovement[]
  ) => void;
}) {
  const { t } = useTranslation();
  const etp = t("etp.column.fte", "ETP");
  const handleClick = (status: MovementExecutionStatus) => (payload: unknown) => {
    const row = payload as MovementStatusByTypeRow | undefined;
    if (row && onBarClick) onBarClick(row.type, status, row.movementsByStatus[status]);
  };
  const series: Record<MovementExecutionStatus, { label: string; color: string }> = {
    realized: { label: t("chart.bar.realized", "Réalisé"), color: "#421799" },
    overdue: { label: t("hr.alert.overdue", "En retard"), color: "#FF3C47" },
    dueSoon: { label: t("shared.hrOwnerActionTable.dueSoon", "À venir ≤ 90 j"), color: "#FFB1B5" },
    later: { label: t("shared.hrOwnerActionTable.later", "À venir > 90 j"), color: "#A99E9A" },
    abandoned: { label: t("dashboard.widgets.healthCancelled", "Abandonné"), color: "#806659" },
  };
  const rowTotal = (row: MovementStatusByTypeRow) =>
    STATUS_ORDER.reduce((sum, status) => sum + row[status], 0);
  const grandTotal = data.reduce((sum, row) => sum + rowTotal(row), 0);
  const movementsText = (n: number) =>
    t("shared.forcedDepartureStatusChart.movementsTooltip", "{n} mouvement(s)").replace(
      "{n}",
      String(n)
    );
  return (
    <ChartHoverArea>
      <ResponsiveContainer width="100%" height={Math.max(height, data.length * 42 + 70)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 6, right: 14, left: 10, bottom: 16 }}
        >
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
            tickFormatter={(value) => movementTypeLabel(t, String(value))}
            tick={{ fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          {/* Aperçu au survol (retour PO) : mouvements par statut, total, ETP et impact masse
              salariale, taux de réalisation, part du total et principaux départements. */}
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            wrapperStyle={HIDDEN_TOOLTIP_WRAPPER}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as MovementStatusByTypeRow | undefined;
              if (!active || !row) return null;
              const total = rowTotal(row);
              const movements = STATUS_ORDER.flatMap((status) => row.movementsByStatus[status]);
              const activeMovements = movements.filter(isActiveMovement);
              const fte = activeMovements.reduce((sum, m) => sum + movementFte(m), 0);
              const salary = activeMovements.reduce((sum, m) => sum + (m.salaryImpact || 0), 0);
              const realizedPct = shareOfTotal(row.realized, total - row.abandoned);
              const contributors = departmentContributors(activeMovements, movementFte);
              return (
                <FloatingPreview>
                  <HrChartPreview
                    title={movementTypeLabel(t, row.type)}
                    rows={[
                      ...STATUS_ORDER.filter((status) => row[status] > 0).map((status) => ({
                        label: series[status].label,
                        value: movementsText(row[status]),
                        marker: { color: series[status].color },
                      })),
                      {
                        label: t("chart.hrPreview.total", "Total"),
                        value: movementsText(total),
                        strong: true,
                      },
                      {
                        label: t("chart.hrPreview.fteExclAbandoned", "ETP (hors abandons)"),
                        value: formatFte(fte, { unit: etp }),
                      },
                      {
                        label: t("chart.hrPreview.salaryImpact", "Impact masse salariale"),
                        value: formatMillions(salary / 1_000_000),
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
                    share={{
                      label: t("chart.hrPreview.shareOfMovementCount", "Part des mouvements"),
                      pct: shareOfTotal(total, grandTotal),
                    }}
                    list={{
                      title: t("chart.hrPreview.topDepartments", "Principaux départements"),
                      items: contributors.map((c) => ({
                        key: c.key,
                        label: c.label,
                        value: formatFte(c.value, { unit: etp }),
                      })),
                    }}
                    clickHint={!!onBarClick}
                  />
                </FloatingPreview>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {STATUS_ORDER.map((status) => (
            <Bar
              key={status}
              dataKey={status}
              name={series[status].label}
              stackId="status"
              fill={series[status].color}
              onClick={handleClick(status)}
              cursor={onBarClick ? "pointer" : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartHoverArea>
  );
}
