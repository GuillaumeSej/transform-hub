"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MovementExecutionStatus, MovementProgressRow } from "@/lib/hrExecution";
import { MOVEMENT_PROGRESS_STATUS_ORDER } from "@/lib/hrExecution";
import { STATUS_COLORS as EXECUTION_STATUS_COLORS } from "@/components/shared/charts/HrExecutionCharts";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  departmentContributors,
  executionMovementFte as movementFte,
  shareOfTotal,
} from "@/lib/hrChartPreview";
import { isActiveMovement } from "@/lib/workforceLogic";
import { formatFte, formatMillions, formatPct } from "@/lib/format";
import { ChartHoverArea, FloatingPreview, HIDDEN_TOOLTIP_WRAPPER } from "./HoverPreview";
import { HrChartPreview } from "./HrChartPreview";

/**
 * Widget "Avancement des mouvements par {dimension} (proposition)" — barres horizontales
 * empilées, une par groupe (programme / département / pays), 5 segments = 5 statuts d'exécution
 * (`lib/hrExecution.ts::classifyMovementExecution`, agrégés par `movementProgressByDimension`).
 *
 * AUCUN calcul métier ici : les lignes (compteurs + mouvements derrière chaque segment) sont
 * calculées par l'appelant. Clic sur un segment → `onSegmentClick(row, status)` ; clic sur le
 * libellé d'un groupe → `onSegmentClick(row, null)` (tous statuts du groupe). Le détail "qui a
 * fait quoi" est rendu par `MovementDetailDrilldownModal` (câblé dans app/(app)/hr/page.tsx).
 */

/** Couleurs charte BP (app/globals.css proscrit vert/orange/bleu), alignées sur le widget "vue
 *  combinée" et `ExecutionStatusChart` : réalisé / en retard / abandonné reprennent exactement les
 *  couleurs de statut existantes (`STATUS_COLORS`) ; les deux "à venir" forment une rampe rouge
 *  d'urgence (plus l'échéance est proche, plus c'est saturé) sans se confondre avec "en retard". */
export const MOVEMENT_PROGRESS_COLORS: Record<MovementExecutionStatus, string> = {
  abandoned: EXECUTION_STATUS_COLORS.abandoned, // --bp-warm-brown #806659
  overdue: EXECUTION_STATUS_COLORS.overdue, // --bp-coral #FF3C47
  realized: EXECUTION_STATUS_COLORS.realized, // --bp-purple #421799
  dueSoon: EXECUTION_STATUS_COLORS.dueSoon, // --bp-coral-pink #FF797B
  later: EXECUTION_STATUS_COLORS.later, // --bp-light-pink #FFB1B5
};

/** Couleur du chiffre centré dans chaque segment (lisibilité sur les teintes claires). */
const SEGMENT_LABEL_COLORS: Record<MovementExecutionStatus, string> = {
  abandoned: "#ffffff",
  overdue: "#ffffff",
  realized: "#ffffff",
  dueSoon: "#320300",
  later: "#320300",
};

/** Libellés i18n des 5 statuts — partagés avec `MovementDetailDrilldownModal`. */
export function movementProgressStatusLabel(
  t: (key: string, fallback?: string) => string,
  status: MovementExecutionStatus
): string {
  switch (status) {
    case "abandoned":
      return t("hr.movementProgress.status.abandoned", "Abandonné");
    case "overdue":
      return t("hr.movementProgress.status.overdue", "En retard");
    case "realized":
      return t("hr.movementProgress.status.realized", "Réalisé");
    case "dueSoon":
      return t("hr.movementProgress.status.dueSoon", "À venir (≤ 90 j)");
    case "later":
      return t("hr.movementProgress.status.later", "À venir (> 90 j)");
  }
}

const LABEL_WIDTH = 150;

export function MovementProgressByDimensionChart({
  data,
  height = 260,
  onSegmentClick,
}: {
  data: MovementProgressRow[];
  height?: number;
  /** `status === null` = clic sur le libellé du groupe (tous statuts confondus). */
  onSegmentClick?: (row: MovementProgressRow, status: MovementExecutionStatus | null) => void;
}) {
  const { t } = useTranslation();

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("shared.executionStatusChart.noData", "Aucun mouvement à afficher.")}
      </p>
    );
  }

  const chartData = data.map((row) => ({ label: row.label, ...row.counts, meta: row }));
  const rowByLabel = new Map(data.map((row) => [row.label, row]));
  const clickable = Boolean(onSegmentClick);
  const grandTotal = data.reduce((sum, row) => sum + row.total, 0);
  const etp = t("etp.column.fte", "ETP");

  const renderTick = (props: {
    x?: number | string;
    y?: number | string;
    payload?: { value?: string };
  }) => {
    const x = Number(props.x ?? 0);
    const y = Number(props.y ?? 0);
    const value = String(props.payload?.value ?? "");
    const row = rowByLabel.get(value);
    const display = value.length > 22 ? `${value.slice(0, 21)}…` : value;
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={-6}
          y={0}
          dy={4}
          textAnchor="end"
          fontSize={11}
          fill="#404040"
          style={{
            cursor: clickable ? "pointer" : undefined,
            textDecoration: clickable ? "underline dotted" : undefined,
          }}
          onClick={() => row && onSegmentClick?.(row, null)}
        >
          <title>
            {clickable
              ? t(
                  "hr.movementProgress.labelClickHint",
                  "{label} — cliquer pour voir tous les mouvements"
                ).replace("{label}", value)
              : value}
          </title>
          {display}
          {row ? ` (${row.total})` : ""}
        </text>
      </g>
    );
  };

  return (
    <div>
      <ChartHoverArea>
        <ResponsiveContainer width="100%" height={Math.max(height, data.length * 36 + 40)}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
            barCategoryGap="22%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" horizontal={false} />
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={LABEL_WIDTH}
              axisLine={false}
              tickLine={false}
              interval={0}
              tick={renderTick}
            />
            {/* Aperçu au survol (retour PO) : mouvements par statut, total, ETP et impact masse
              salariale, taux de réalisation, part du total et principaux départements. */}
            <Tooltip
              cursor={{ fill: "rgba(0,0,0,0.04)" }}
              wrapperStyle={HIDDEN_TOOLTIP_WRAPPER}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload?.meta as MovementProgressRow | undefined;
                if (!row) return null;
                const activeMovements = MOVEMENT_PROGRESS_STATUS_ORDER.flatMap(
                  (status) => row.movementsByStatus[status]
                ).filter(isActiveMovement);
                const fte = activeMovements.reduce((sum, m) => sum + movementFte(m), 0);
                const salary = activeMovements.reduce((sum, m) => sum + (m.salaryImpact || 0), 0);
                const realizedPct = shareOfTotal(
                  row.counts.realized,
                  row.total - row.counts.abandoned
                );
                // Groupe survolé exclu : en vue Département la liste est vide (pas redondante).
                const contributors = departmentContributors(activeMovements, movementFte, {
                  exclude: [row.label],
                });
                return (
                  <FloatingPreview>
                    <HrChartPreview
                      title={row.label}
                      rows={[
                        ...MOVEMENT_PROGRESS_STATUS_ORDER.filter(
                          (status) => row.counts[status] > 0
                        ).map((status) => ({
                          label: movementProgressStatusLabel(t, status),
                          value: String(row.counts[status]),
                          marker: { color: MOVEMENT_PROGRESS_COLORS[status] },
                        })),
                        {
                          label: t("chart.hrPreview.total", "Total"),
                          value: String(row.total),
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
                        pct: shareOfTotal(row.total, grandTotal),
                      }}
                      list={{
                        title: t("chart.hrPreview.topDepartments", "Principaux départements"),
                        items: contributors.map((c) => ({
                          key: c.key,
                          label: c.label,
                          value: formatFte(c.value, { unit: etp }),
                        })),
                      }}
                      clickHint={
                        clickable
                          ? t(
                              "hr.movementProgress.clickHint",
                              "Cliquer sur un segment pour voir le détail des mouvements"
                            )
                          : undefined
                      }
                    />
                  </FloatingPreview>
                );
              }}
            />
            {MOVEMENT_PROGRESS_STATUS_ORDER.map((status) => (
              <Bar
                key={status}
                dataKey={status}
                name={movementProgressStatusLabel(t, status)}
                stackId="progress"
                fill={MOVEMENT_PROGRESS_COLORS[status]}
                isAnimationActive={false}
                cursor={clickable ? "pointer" : undefined}
                onClick={(entry) => {
                  const row = (entry as { meta?: MovementProgressRow } | undefined)?.meta;
                  if (row && row.counts[status] > 0) onSegmentClick?.(row, status);
                }}
              >
                <LabelList
                  dataKey={status}
                  position="center"
                  fontSize={10}
                  fill={SEGMENT_LABEL_COLORS[status]}
                  formatter={(value: unknown) => (Number(value) > 0 ? String(value) : "")}
                />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartHoverArea>
      {/* Légende en bas, centrée — même position/taille que la `<Legend>` Recharts du widget
          "vue combinée" (DepartmentMovementsChart). */}
      <ul className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-secondary">
        {MOVEMENT_PROGRESS_STATUS_ORDER.map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5"
              style={{ backgroundColor: MOVEMENT_PROGRESS_COLORS[status] }}
            />
            {movementProgressStatusLabel(t, status)}
          </li>
        ))}
      </ul>
    </div>
  );
}
