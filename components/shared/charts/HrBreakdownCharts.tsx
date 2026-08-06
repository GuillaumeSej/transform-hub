"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MovementBreakdownRow, MovementRealizationRow } from "@/lib/hrEngine";

// Palette catégorielle validée (dataviz, tous checks PASS sur surface claire).
export const HR_CATEGORICAL = ["#FF3C47", "#421799", "#320300", "#FFB1B5", "#421799", "#A99E9A"];

const COLOR_DOWN = "#FF3C47"; // départs forcés + attrition (exits)
const COLOR_UP = "#421799"; // recrutements — bp-purple, aligné waterfall ETP
const COLOR_NEUTRAL = "#806659"; // transferts (entrants + sortants)

/** Barres divergentes des cinq types de mouvements par département ou pays, avec point net. */
export function DepartmentMovementsChart({
  data,
  height = 260,
}: {
  data: MovementBreakdownRow[];
  height?: number;
}) {
  const chartData = data.map((d) => ({
    dimension: d.label,
    fullName: d.label,
    Recrutements: d.recrutements,
    Attrition: -d.attritions,
    "Départs forcés": -d.forcedDepartures,
    "Transferts entrants": d.transfertEntrants,
    "Transferts sortants": -d.transfertSortants,
    Net: d.net,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="dimension" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(value, name) => [`${Math.abs(Number(value))} ETP`, String(name)]}
          labelFormatter={(_, payload) =>
            (payload?.[0]?.payload as { fullName?: string })?.fullName ?? ""
          }
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine y={0} stroke="rgba(0,0,0,0.25)" />
        <Bar dataKey="Recrutements" fill={COLOR_UP} radius={[3, 3, 0, 0]} />
        <Bar dataKey="Attrition" fill="#FFB1B5" radius={[0, 0, 3, 3]} />
        <Bar dataKey="Départs forcés" fill={COLOR_DOWN} radius={[0, 0, 3, 3]} />
        <Bar dataKey="Transferts entrants" fill="#A99E9A" radius={[3, 3, 0, 0]} />
        <Bar dataKey="Transferts sortants" fill={COLOR_NEUTRAL} radius={[0, 0, 3, 3]} />
        <Line type="monotone" dataKey="Net" stroke="#320300" strokeWidth={0} dot={{ r: 4 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Réalisé + reste à faire = cible, par fonction ou pays. */
export function MovementRealizationChart({
  data,
  height = 260,
}: {
  data: MovementRealizationRow[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(value, name) => [
            `${Number(value).toLocaleString("fr-FR")} ETP`,
            String(name),
          ]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="realized" name="Réalisé" stackId="total" fill="#421799" />
        <Bar dataKey="remaining" name="Reste à faire" stackId="total" fill="#CCC1BD" />
      </BarChart>
    </ResponsiveContainer>
  );
}

const defaultFteFormat = (v: number) => `${v.toLocaleString("fr-FR")} ETP`;

/** Donut générique (mouvements par pays par défaut) — palette catégorielle validée, ordre fixe.
 * `formatValue` permet de réutiliser ce composant pour n'importe quelle métrique du builder
 * générique RH (voir `lib/hrDashboardPivot.ts`) — défaut = suffixe "ETP" inchangé pour l'usage
 * historique (ventilation par pays). */
export function HrDonutChart({
  data,
  height = 240,
  onSliceClick,
  formatValue = defaultFteFormat,
}: {
  data: { name: string; value: number }[];
  height?: number;
  onSliceClick?: (name: string) => void;
  formatValue?: (value: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={52}
          outerRadius={86}
          paddingAngle={2}
          onClick={(d) => {
            const name = (d as { name?: string })?.name;
            if (name) onSliceClick?.(name);
          }}
          cursor={onSliceClick ? "pointer" : undefined}
        >
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={HR_CATEGORICAL[i % HR_CATEGORICAL.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => formatValue(Number(value))} />
        <Legend
          wrapperStyle={{ fontSize: 11 }}
          layout="vertical"
          verticalAlign="middle"
          align="right"
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Barre simple générique (une seule série) pour les vues construites par l'utilisateur via le
 * builder générique RH — une métrique croisée avec une dimension (voir `lib/hrDashboardPivot.ts`),
 * contrairement à `DepartmentMovementsChart` qui est câblé en dur sur 3 séries fixes. */
export function HrPivotBarChart({
  data,
  height = 260,
  formatValue = defaultFteFormat,
  onBarClick,
}: {
  data: { label: string; value: number }[];
  height?: number;
  formatValue?: (value: number) => string;
  onBarClick?: (label: string) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(value) => formatValue(Number(value))} />
        <Bar
          dataKey="value"
          fill={HR_CATEGORICAL[0]}
          radius={[3, 3, 0, 0]}
          onClick={(d) => {
            const label = (d as { label?: string })?.label;
            if (label) onBarClick?.(label);
          }}
          cursor={onBarClick ? "pointer" : undefined}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
