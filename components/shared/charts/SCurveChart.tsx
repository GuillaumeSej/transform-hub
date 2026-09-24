"use client";

import { useState, type ReactNode } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { formatMillions } from "@/lib/format";

export type SCurvePoint = {
  month: string;
  planned: number;
  actual: number | null;
  reforecast: number;
  /** Écart cumulé RÉALISÉ − PLANIFIÉ INITIAL (voir `engine.savingsSeries`, `gap.total`) — même
   *  définition que le badge (`currentGapMarks`) et le détail au clic (`gapEntriesAt`) ; `cancelled`
   *  est un mémo (plan des leviers annulés échus). */
  gap?: { total: number; late: number; cancelled: number; other: number };
};

const fmtM = (v: number) => formatMillions(v);

/** Repère de l'écart sur la période courante (segment + badge) : RÉALISÉ − PLANIFIÉ INITIAL, signé
 *  (+ = mieux que prévu, − = en deçà) — EXACTEMENT la valeur `gap.total` de `engine.savingsSeries`
 *  que détaille la pop-up ouverte au clic (`gapEntriesAt`). Avant, le badge montrait réactualisé −
 *  réalisé alors que le détail montrait réalisé − planifié : deux chiffres pour un même « écart ».
 *  À appeler comme enfant direct du graphe Recharts (`{currentGapMarks(...)}`). */
export function currentGapMarks(
  cur: { month: string; actual: number | null; planned: number } | null,
  label: string
) {
  if (!cur || cur.actual === null) return null;
  const gap = Math.round((cur.actual - cur.planned) * 10) / 10;
  if (gap === 0) return null;
  return (
    <>
      <ReferenceLine
        segment={[
          { x: cur.month, y: cur.actual },
          { x: cur.month, y: cur.planned },
        ]}
        stroke="#FF3C47"
        strokeWidth={3}
        ifOverflow="extendDomain"
      />
      <ReferenceDot
        x={cur.month}
        y={Math.max(cur.planned, cur.actual)}
        r={0}
        ifOverflow="extendDomain"
        label={{
          value: `${label} ${gap > 0 ? "+" : "−"}${fmtM(Math.abs(gap))}`,
          position: "top",
          fontSize: 11,
          fontWeight: 700,
          fill: "#FF3C47",
        }}
      />
    </>
  );
}

/** Enveloppe d'un graphe cliquable : au survol, un petit badge « Cliquer pour plus de détails »
 *  suit le curseur (décalé, sans intercepter la souris) au lieu d'un texte fixe sous le graphe. */
export function HoverDetailsHint({
  enabled = true,
  children,
}: {
  enabled?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      className="relative"
      onMouseMove={
        enabled
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
            }
          : undefined
      }
      onMouseLeave={enabled ? () => setPos(null) : undefined}
    >
      {children}
      {enabled && pos && (
        <span
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded bg-[rgba(50,3,0,0.82)] px-1.5 py-0.5 text-[10.5px] font-medium text-white shadow-sm"
          style={{ left: pos.x + 14, top: pos.y + 16 }}
        >
          {t("chart.clickForDetails", "Cliquer pour plus de détails")}
        </span>
      )}
    </div>
  );
}

/** Dernier point pour lequel le réalisé est connu = période courante. */
export function currentPointIndex(data: SCurvePoint[]): number {
  for (let i = data.length - 1; i >= 0; i--) if (data[i].actual !== null) return i;
  return -1;
}

/** S-Curve à 3 courbes — Plan initial (figé à L3), Réalisé à date, Réactualisé (prévision à jour,
 * éditable à partir de L4). Porté/étendu depuis le chart Chart.js `ch-scurve` du prototype legacy.
 * Clic sur le graphe -> `onPointClick` (l'appelant ouvre le détail de la trajectoire).
 * L'écart réalisé − planifié initial n'est affiché que sur la période courante (badge permanent).
 *
 * Les labels des courbes sont passables en props pour la traduction (i18n). */
export function SCurveChart({
  data,
  height = 260,
  onPointClick,
  labelActual,
  labelPlanned,
  labelReforecast,
}: {
  data: SCurvePoint[];
  height?: number;
  onPointClick?: (month: string) => void;
  labelActual?: string;
  labelPlanned?: string;
  labelReforecast?: string;
}) {
  const { t } = useTranslation();
  const resolvedLabelActual = labelActual ?? t("chart.scurve.actual", "Réalisé");
  const resolvedLabelPlanned = labelPlanned ?? t("chart.scurve.planned", "Plan initial");
  const resolvedLabelReforecast = labelReforecast ?? t("chart.scurve.reforecast", "Réactualisé");
  const curIdx = currentPointIndex(data);
  const cur = curIdx >= 0 ? data[curIdx] : null;
  return (
    <HoverDetailsHint enabled={!!onPointClick}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={data}
          margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
          onClick={(e) => {
            const label = e?.activeLabel;
            if (typeof label === "string") onPointClick?.(label);
          }}
          style={{ cursor: onPointClick ? "pointer" : undefined }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => formatMillions(Number(v))}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="line"
            wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
          />
          {/* Écart réalisé ↔ planifié initial : uniquement sur la période courante, badge visible. */}
          {currentGapMarks(cur, t("chart.scurve.gapBadge", "Écart"))}
          <Line
            type="monotone"
            dataKey="actual"
            name={resolvedLabelActual}
            stroke="#FF3C47"
            strokeWidth={2.5}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="planned"
            name={resolvedLabelPlanned}
            stroke="#806659"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="reforecast"
            name={resolvedLabelReforecast}
            stroke="#320300"
            strokeWidth={2}
            strokeDasharray="2 3"
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </HoverDetailsHint>
  );
}
