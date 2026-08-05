"use client";

/**
 * Graphiques RH alignés sur la vue "OD Monitoring" (Gooduelle). Chaque composant est un mapping
 * pur `data → Recharts` — aucune agrégation métier, tout est déjà calculé dans `lib/hrEngine.ts`
 * ou `lib/hrFinancials.ts` (voir les types importés).
 */

import {
  Bar,
  BarChart,
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
import type { MovementRhythmBucket } from "@/lib/hrEngine";
import type { NetEconomyBucket } from "@/lib/hrFinancials";
import type { MovementType } from "@/types";

const TYPE_COLORS: Record<MovementType, string> = {
  Recrutement: "#421799",
  Attrition: "#FFB1B5",
  "Départ forcé": "#FF3C47",
  "Transfert entrant": "#806659",
  "Transfert sortant": "#A99E9A",
};

/**
 * Rythme mensuel / trimestriel / annuel des mouvements décomposé par les 5 types Gooduelle,
 * plus une ligne "cumul net" centrée sur zéro — reproduit exactement le widget "Rythme des
 * mouvements" de "OD Monitoring".
 *
 * Les barres positives (Recrutement + transferts positifs) sont empilées vers le haut, les
 * négatives (Attrition + Départ forcé) vers le bas depuis 0. La ligne cumul lit sur un second
 * axe pour préserver la lecture des barres même quand le cumul dépasse la magnitude des
 * mouvements individuels.
 */
export function MovementRhythmChart({
  buckets,
  height = 280,
  unit = "ETP",
}: {
  buckets: MovementRhythmBucket[];
  height?: number;
  unit?: string;
}) {
  if (buckets.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        Aucun mouvement sur la période sélectionnée.
      </p>
    );
  }

  const fmt = (v: number) =>
    v.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

  const data = buckets.map((b) => ({
    label: b.label,
    net: b.net,
    cumulativeNet: b.cumulativeNet,
    Recrutement_pos: Math.max(0, b.byType.Recrutement ?? 0),
    "Transfert entrant_pos": Math.max(0, b.byType["Transfert entrant"] ?? 0),
    "Transfert sortant_pos": Math.max(0, b.byType["Transfert sortant"] ?? 0),
    Attrition_neg: Math.min(0, b.byType.Attrition ?? 0),
    "Départ forcé_neg": Math.min(0, b.byType["Départ forcé"] ?? 0),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={56}
          tickFormatter={(v) => fmt(Number(v))}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={56}
          tickFormatter={(v) => fmt(Number(v))}
        />
        <Tooltip formatter={(value, name) => [`${fmt(Number(value))} ${unit}`, String(name)]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine yAxisId="left" y={0} stroke="rgba(0,0,0,0.35)" />
        <Bar
          yAxisId="left"
          dataKey="Recrutement_pos"
          name="Recrutement"
          stackId="pos"
          fill={TYPE_COLORS.Recrutement}
        />
        <Bar
          yAxisId="left"
          dataKey="Transfert entrant_pos"
          name="Transfert entrant"
          stackId="pos"
          fill={TYPE_COLORS["Transfert entrant"]}
        />
        <Bar
          yAxisId="left"
          dataKey="Transfert sortant_pos"
          name="Transfert sortant"
          stackId="pos"
          fill={TYPE_COLORS["Transfert sortant"]}
        />
        <Bar
          yAxisId="left"
          dataKey="Attrition_neg"
          name="Attrition"
          stackId="neg"
          fill={TYPE_COLORS.Attrition}
        />
        <Bar
          yAxisId="left"
          dataKey="Départ forcé_neg"
          name="Départ forcé"
          stackId="neg"
          fill={TYPE_COLORS["Départ forcé"]}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="cumulativeNet"
          name={`Cumul net (${unit})`}
          stroke="#320300"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * Économie nette = savings récurrentes annualisées − ENR (coûts sociaux one-off), avec ligne
 * "économie nette" superposée aux barres savings/ENR. Reprend la vue "Économie nette" du
 * "OD Monitoring".
 */
export function NetEconomyChart({
  buckets,
  height = 280,
  currencyDivisor = 1_000_000,
  currencyUnit = "€M",
}: {
  buckets: NetEconomyBucket[];
  height?: number;
  /** Diviseur d'affichage — 1_000_000 pour afficher en €M (défaut). */
  currencyDivisor?: number;
  currencyUnit?: string;
}) {
  if (buckets.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucune donnée financière.</p>;
  }

  const fmt = (v: number) =>
    (v / currencyDivisor).toLocaleString("fr-FR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    });

  const data = buckets.map((b) => ({
    label: b.label,
    grossSavings: b.grossSavings,
    enr: -b.enr, // vers le bas
    net: b.net,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={64}
          tickFormatter={(v) => `${fmt(Number(v))} ${currencyUnit}`}
        />
        <Tooltip
          formatter={(value, name) => [`${fmt(Number(value))} ${currencyUnit}`, String(name)]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine y={0} stroke="rgba(0,0,0,0.35)" />
        <Bar dataKey="grossSavings" name="Savings récurrentes" fill="#3D9970" />
        <Bar dataKey="enr" name="ENR (coût social)" fill="#FF3C47" />
        <Line
          type="monotone"
          dataKey="net"
          name="Économie nette"
          stroke="#320300"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * Projection multi-exercices — barres empilées savings / ENR par FY + ligne cumul net.
 * Utilise la même structure que `NetEconomyChart` mais avec un axe temporel en exercices
 * fiscaux (bornes issues de `Company.fyStart`, calculées dans `lib/hrEngine.ts::fiscalYearRange`).
 */
export function MultiFYBudgetChart({
  buckets,
  height = 280,
  currencyDivisor = 1_000_000,
  currencyUnit = "€M",
}: {
  buckets: NetEconomyBucket[];
  height?: number;
  currencyDivisor?: number;
  currencyUnit?: string;
}) {
  if (buckets.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        Aucun exercice fiscal configuré — définir `fyStart` sur l&apos;entreprise pour activer cette
        vue.
      </p>
    );
  }

  const fmt = (v: number) =>
    (v / currencyDivisor).toLocaleString("fr-FR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    });

  const data = buckets.map((b) => ({
    label: b.label,
    grossSavings: b.grossSavings,
    enr: b.enr,
    net: b.net,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12, fontWeight: 600 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={64}
          tickFormatter={(v) => `${fmt(Number(v))} ${currencyUnit}`}
        />
        <Tooltip
          formatter={(value, name) => [`${fmt(Number(value))} ${currencyUnit}`, String(name)]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="grossSavings" name="Savings récurrentes" fill="#3D9970" stackId="a" />
        <Bar dataKey="enr" name="ENR (coût social)" fill="#FF3C47" stackId="b" />
        <Bar dataKey="net" name="Économie nette" fill="#421799" />
      </BarChart>
    </ResponsiveContainer>
  );
}
