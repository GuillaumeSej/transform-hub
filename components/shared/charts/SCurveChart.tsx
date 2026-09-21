"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ScurveTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload as SCurvePoint;
  const gap = p.gap;
  return (
    <div className="max-w-[280px] rounded-md border border-border bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-primary">{label}</div>
      <div className="flex justify-between gap-3 text-secondary">
        <span>Plan initial</span>
        <span className="font-semibold text-primary">{fmtM(p.planned)}</span>
      </div>
      <div className="flex justify-between gap-3 text-secondary">
        <span>Réactualisé</span>
        <span className="font-semibold text-primary">{fmtM(p.reforecast)}</span>
      </div>
      <div className="flex justify-between gap-3 text-secondary">
        <span>Réalisé</span>
        <span className="font-semibold text-primary">
          {p.actual === null ? "—" : fmtM(p.actual)}
        </span>
      </div>
      {gap && p.actual !== null && (
        <div className="mt-1.5 border-t border-border pt-1.5">
          <div className="flex justify-between gap-3 font-semibold text-primary">
            <span>Écart réactualisé − réalisé</span>
            <span>{fmtM(gap.total)}</span>
          </div>
          <div className="flex justify-between gap-3 text-secondary">
            <span>dont retards</span>
            <span>{fmtM(gap.late)}</span>
          </div>
          <div className="flex justify-between gap-3 text-secondary">
            <span>dont autre (avancement)</span>
            <span>{fmtM(gap.other)}</span>
          </div>
          <div className="flex justify-between gap-3 text-tertiary">
            <span>Annulations (mémo, hors écart)</span>
            <span>{fmtM(gap.cancelled)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** S-Curve à 3 courbes — Plan initial (figé à L3), Réalisé à date, Réactualisé (prévision à jour,
 * éditable à partir de L4). Porté/étendu depuis le chart Chart.js `ch-scurve` du prototype legacy.
 * Clic sur un point (ou son mois) -> creuse vers les leviers qui se terminent ce mois-là.
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
  const chartData = data.map((p) => ({
    ...p,
    gapBand: p.actual !== null && p.reforecast !== p.actual ? [p.actual, p.reforecast] : null,
  }));
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={chartData}
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
          <Tooltip content={<ScurveTooltip />} />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="line"
            wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
          />
          {/* Écart vertical réactualisé ↔ réalisé : bande entre les deux courbes (décomposition dans
            le tooltip : retards / autre / annulations). */}
          <Area
            type="monotone"
            dataKey="gapBand"
            name="Écart réactualisé − réalisé"
            stroke="none"
            fill="#FF3C47"
            fillOpacity={0.18}
            activeDot={false}
            isAnimationActive={false}
            legendType="rect"
          />
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
      <p className="mt-1 text-[11px] text-tertiary">
        {t(
          "chart.gap.explain",
          "Écart entre le réactualisé et le réalisé : retards (leviers en retard), autre (avancement en cours) ; les annulations sont déjà retirées du réactualisé."
        )}
      </p>
    </div>
  );
}
