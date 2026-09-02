"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { IndicatorMeasurement } from "@/types";

/**
 * Graphique d'un indicateur : valeurs mesurées dans le temps + ligne d'objectif. Structure
 * recharts inspirée de `components/shared/charts/SCurveChart.tsx` (même conteneur responsive,
 * mêmes réglages d'axes), mais AUCUNE unité en dur : la S-Curve formate en `€xM`, alors qu'un
 * indicateur stratégique peut être en %, en jours, en NPS, en nombre de sites… d'où la prop
 * `unit`.
 *
 * Un indicateur QUALITATIF (pas de valeur numérique comparable, pas d'`objectiveValue`) n'a pas de
 * courbe qui ait du sens : le composant retombe alors sur une lecture chronologique simple des
 * notes saisies, plutôt que d'afficher un graphique vide.
 */

export type IndicatorChartProps = {
  measurements: IndicatorMeasurement[];
  /** Valeur cible — matérialisée par une `ReferenceLine` horizontale. Absente = pas de ligne. */
  objectiveValue?: number;
  /** Suffixe d'unité affiché sur l'axe et dans l'infobulle (ex. "%", "j", "NPS"). */
  unit?: string;
  /** true = indicateur qualitatif : rendu en liste de notes datées, pas en courbe. */
  qualitative?: boolean;
  height?: number;
  /** Libellés (traduits par l'appelant) — repli français. */
  labelValue?: string;
  labelObjective?: string;
  emptyLabel?: string;
};

function formatValue(value: number | string, unit?: string): string {
  return unit ? `${value} ${unit}` : `${value}`;
}

export function IndicatorChart({
  measurements,
  objectiveValue,
  unit,
  qualitative = false,
  height = 200,
  labelValue = "Valeur",
  labelObjective = "Objectif",
  emptyLabel = "Aucune mesure enregistrée.",
}: IndicatorChartProps) {
  // Tri chronologique explicite : les mesures arrivent dans l'ordre arbitraire de Firestore.
  const sorted = [...measurements].sort((a, b) => a.period.localeCompare(b.period));

  if (sorted.length === 0) {
    return <div className="py-6 text-center text-xs text-tertiary">{emptyLabel}</div>;
  }

  // Repli qualitatif — également utilisé quand un indicateur quantitatif n'a que des mesures sans
  // valeur numérique (saisies uniquement commentées) : tracer une courbe vide induirait en erreur.
  const hasNumericValue = sorted.some((m) => m.value !== undefined);
  if (qualitative || !hasNumericValue) {
    return (
      <ul className="divide-y divide-border text-sm">
        {sorted.map((m) => (
          <li key={m.id} className="flex items-start justify-between gap-3 py-2">
            <span className="shrink-0 font-mono text-xs text-secondary">{m.period}</span>
            <span className="text-right text-text-primary">
              {m.note ?? (m.value !== undefined ? formatValue(m.value, unit) : "—")}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  const data = sorted.map((m) => ({ period: m.period, value: m.value ?? null }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="period" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatValue(v as number, unit)}
        />
        <Tooltip formatter={(value) => [formatValue(value as number, unit), labelValue]} />
        {objectiveValue !== undefined && (
          <ReferenceLine
            y={objectiveValue}
            stroke="#806659"
            strokeDasharray="6 4"
            label={{
              value: `${labelObjective} : ${formatValue(objectiveValue, unit)}`,
              position: "insideTopRight",
              fontSize: 11,
              fill: "#806659",
            }}
          />
        )}
        <Line
          type="monotone"
          dataKey="value"
          name={labelValue}
          stroke="#FF3C47"
          strokeWidth={2.5}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
