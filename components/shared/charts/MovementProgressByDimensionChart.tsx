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
import { useTranslation } from "@/lib/i18n/useTranslation";

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

/** Couleurs sémantiques demandées pour ce widget (gris / rouge / vert / bleu / bleu clair). NB : la
 *  charte (app/globals.css) proscrit vert/bleu — `#2E7D32` est toutefois déjà utilisé par
 *  JCurveChart/SankeyChart/MarimekkoChart, et le rouge est l'accent BearingPoint (`--bp-coral`). */
export const MOVEMENT_PROGRESS_COLORS: Record<MovementExecutionStatus, string> = {
  abandoned: "#A3A3A3",
  overdue: "#FF3C47",
  realized: "#2E7D32",
  dueSoon: "#2F6FB5",
  later: "#9CC3E6",
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
      <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-secondary">
        {MOVEMENT_PROGRESS_STATUS_ORDER.map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-[2px]"
              style={{ backgroundColor: MOVEMENT_PROGRESS_COLORS[status] }}
            />
            {movementProgressStatusLabel(t, status)}
          </li>
        ))}
      </ul>
      <ResponsiveContainer width="100%" height={Math.max(height, data.length * 36 + 40)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
          barCategoryGap="22%"
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
            dataKey="label"
            width={LABEL_WIDTH}
            axisLine={false}
            tickLine={false}
            interval={0}
            tick={renderTick}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]?.payload?.meta as MovementProgressRow | undefined;
              if (!row) return null;
              return (
                <div className="rounded-md border border-border bg-white px-3 py-2 text-xs shadow-sm">
                  <div className="mb-1 font-semibold text-primary">
                    {label} · {row.total}
                  </div>
                  {MOVEMENT_PROGRESS_STATUS_ORDER.map((status) => (
                    <div key={status} className="flex items-center justify-between gap-5 py-0.5">
                      <span className="flex items-center gap-1.5 text-secondary">
                        <span
                          aria-hidden
                          className="inline-block h-2 w-2 rounded-[2px]"
                          style={{ backgroundColor: MOVEMENT_PROGRESS_COLORS[status] }}
                        />
                        {movementProgressStatusLabel(t, status)}
                      </span>
                      <span className="font-semibold tabular-nums text-primary">
                        {row.counts[status]}
                      </span>
                    </div>
                  ))}
                  {clickable && (
                    <div className="mt-1 text-[10.5px] text-tertiary">
                      {t(
                        "hr.movementProgress.clickHint",
                        "Cliquer sur un segment pour voir le détail des mouvements"
                      )}
                    </div>
                  )}
                </div>
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
                fill={status === "later" ? "#0a0a0a" : "#ffffff"}
                formatter={(value: unknown) => (Number(value) > 0 ? String(value) : "")}
              />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
