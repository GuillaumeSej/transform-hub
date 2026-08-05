"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FteTrajectoryPoint } from "@/lib/hrEngine";
import type { MovementType } from "@/types";

const COLOR_ACTUAL = "#000000"; // encre — la réalité
const COLOR_PLANNED = "#A99E9A"; // taupe — le plan
const COLOR_TARGET = "#FF3C47"; // coral — la cible
const AREA_FILL = "rgba(0,0,0,0.04)"; // surface grise très légère sous la courbe réelle

/** Couleurs de la ventilation par type de mouvement dans le tooltip.
 *  Typologie 5-types Gooduelle (post-migration Août 2026) : partage la palette de
 *  `components/shared/charts/FteWaterfallChart.tsx` — sorties en corail/rose, entrée en bleu,
 *  transferts internes en taupe. */
const TYPE_COLORS: Record<MovementType, string> = {
  Recrutement: "#421799",
  Attrition: "#FFB1B5",
  "Départ forcé": "#FF3C47",
  "Transfert entrant": "#806659",
  "Transfert sortant": "#A99E9A",
};

const TYPE_LABELS: Record<MovementType, string> = {
  Recrutement: "Recrutements",
  Attrition: "Attritions",
  "Départ forcé": "Départs forcés",
  "Transfert entrant": "Transferts entrants",
  "Transfert sortant": "Transferts sortants",
};

/** Trajectoire effectifs — lignes cible / plan / réel avec ventilation par type au hover.
 *  Pas de boucle sur des API externes : les données sont pré-calculées par `hrEngine.fteTrajectory`. */
export function FteTrajectoryChart({
  data,
  height = 320,
}: {
  data: FteTrajectoryPoint[];
  height?: number;
}) {
  if (data.length === 0) return null;

  const allValues = data.flatMap((d) => [d.actual, d.planned, d.target]);
  const min = Math.floor(Math.min(...allValues) / 10) * 10 - 20;
  const max = Math.ceil(Math.max(...allValues) / 10) * 10 + 20;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e2e2" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "#737373" }}
          axisLine={{ stroke: "#e2e2e2" }}
          tickLine={false}
        />
        <YAxis
          domain={[min, max]}
          tick={{ fontSize: 11, fill: "#737373" }}
          axisLine={false}
          tickLine={false}
          width={48}
          tickFormatter={(v: number) => v.toLocaleString("fr-FR")}
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0]?.payload as FteTrajectoryPoint;
            if (!point) return null;
            const types = (Object.keys(TYPE_LABELS) as MovementType[]).filter(
              (t) => point.byType[t] !== 0
            );
            return (
              <div className="rounded-md border border-border bg-white px-3 py-2 text-xs shadow-md">
                <div className="mb-1.5 font-bold text-primary">{label}</div>
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: COLOR_ACTUAL }}
                      />
                      Réel
                    </span>
                    <strong>{point.actual.toLocaleString("fr-FR")}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: COLOR_PLANNED }}
                      />
                      Plan
                    </span>
                    <strong>{point.planned.toLocaleString("fr-FR")}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: COLOR_TARGET }}
                      />
                      Cible
                    </span>
                    <strong>{point.target.toLocaleString("fr-FR")}</strong>
                  </div>
                </div>
                {types.length > 0 && (
                  <>
                    <div className="mt-2 border-t border-border pt-1.5 text-[10px] font-bold uppercase tracking-wide text-tertiary">
                      Ventilation
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {types.map((t) => (
                        <div key={t} className="flex items-center justify-between gap-4">
                          <span className="flex items-center gap-1.5">
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ background: TYPE_COLORS[t] }}
                            />
                            {TYPE_LABELS[t]}
                          </span>
                          <span className="tabular-nums">
                            {point.byType[t] > 0 ? "+" : ""}
                            {point.byType[t]}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          }}
        />
        <Legend
          verticalAlign="top"
          height={28}
          iconType="plainline"
          formatter={(value: string) => (
            <span className="text-[11px] font-semibold text-secondary">{value}</span>
          )}
        />

        {/* Surface sous la courbe réelle — repère visuel du chemin parcouru */}
        <Area
          type="monotone"
          dataKey="actual"
          name="Réel"
          stroke="none"
          fill={AREA_FILL}
          fillOpacity={1}
        />

        {/* Ligne pointillée du plan */}
        <Line
          type="monotone"
          dataKey="planned"
          name="Plan"
          stroke={COLOR_PLANNED}
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0, fill: COLOR_PLANNED }}
        />

        {/* Ligne pleine du réel */}
        <Line
          type="monotone"
          dataKey="actual"
          name="Réel"
          stroke={COLOR_ACTUAL}
          strokeWidth={2.5}
          dot={{ r: 3, strokeWidth: 0, fill: COLOR_ACTUAL }}
          activeDot={{ r: 5, strokeWidth: 0, fill: COLOR_ACTUAL }}
        />

        {/* Ligne de référence cible — toujours visible */}
        <ReferenceLine
          y={data[0]?.target}
          stroke={COLOR_TARGET}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          label={{
            value: `Cible ${data[0]?.target.toLocaleString("fr-FR")}`,
            position: "right",
            fill: COLOR_TARGET,
            fontSize: 10,
            fontWeight: 700,
          }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
