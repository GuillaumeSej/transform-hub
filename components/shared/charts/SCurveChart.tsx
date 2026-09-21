"use client";

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

export type SCurvePoint = {
  month: string;
  planned: number;
  actual: number | null;
  reforecast: number;
  /** Écart réactualisé − réalisé cumulé (voir `engine.savingsSeries`) : total = retards + autre ;
   *  `cancelled` est un mémo (plan des leviers annulés échus, déjà retirés du réactualisé). */
  gap?: { total: number; late: number; cancelled: number; other: number };
};

const fmtM = (v: number) => `€${Math.round(v * 10) / 10}M`;

/** Repère de l'écart réactualisé − réalisé sur la période courante (segment + badge). Partagé avec
 *  le bridge pour que les deux vues affichent exactement le même écart. À appeler comme enfant
 *  direct du graphe Recharts (`{currentGapMarks(...)}`). */
export function currentGapMarks(
  cur: { month: string; actual: number | null; reforecast: number } | null,
  label: string
) {
  if (!cur || cur.actual === null) return null;
  const gap = Math.round((cur.reforecast - cur.actual) * 10) / 10;
  if (gap === 0) return null;
  return (
    <>
      <ReferenceLine
        segment={[
          { x: cur.month, y: cur.actual },
          { x: cur.month, y: cur.reforecast },
        ]}
        stroke="#FF3C47"
        strokeWidth={3}
        ifOverflow="extendDomain"
      />
      <ReferenceDot
        x={cur.month}
        y={cur.reforecast}
        r={0}
        ifOverflow="extendDomain"
        label={{
          value: `${label} ${gap > 0 ? "−" : "+"}${fmtM(Math.abs(gap))}`,
          position: "top",
          fontSize: 11,
          fontWeight: 700,
          fill: "#FF3C47",
        }}
      />
    </>
  );
}

/** Indication « Cliquer pour plus de détails » placée sous le graphe (hors zone de tracé, donc
 *  jamais au-dessus des courbes ni des libellés). */
export function ClickForDetailsHint() {
  const { t } = useTranslation();
  return (
    <p className="mt-1 text-right text-[11px] text-tertiary">
      {t("chart.clickForDetails", "Cliquer pour plus de détails")}
    </p>
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
 * L'écart réactualisé − réalisé n'est affiché que sur la période courante (badge permanent).
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
    <div>
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
            tickFormatter={(v) => `€${v}M`}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="line"
            wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
          />
          {/* Écart réactualisé ↔ réalisé : uniquement sur la période courante, avec badge visible. */}
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
      {onPointClick && <ClickForDetailsHint />}
    </div>
  );
}
