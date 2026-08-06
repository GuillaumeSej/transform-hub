"use client";

/**
 * Graphiques RH alignés "OD Monitoring" (Gooduelle) — Août 2026.
 *
 * Chaque composant est un mapping pur `data → Recharts` : aucune agrégation métier ici, tout
 * est déjà pré-calculé dans `lib/hrTimeSeries.ts` (savings/ENR/net/rythme) ou `lib/hrEngine.ts`
 * (pont ETP). Le composant se contente de tracer.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  MovementRhythmBucket,
  NetEconomyBucket,
  SalarySavingsBucket,
  SocialCostBucket,
} from "@/lib/hrTimeSeries";
import type { FteBridgeSummary } from "@/lib/hrEngine";
import type { MovementType } from "@/types";

/** Palette 5-types alignée sur les tokens dataviz BeTrack / BearingPoint : famille rouge,
 *  taupes et violet de secours. Vert et orange sont volontairement exclus par la charte. */
const TYPE_COLORS: Record<MovementType, string> = {
  Recrutement: "#421799",
  Attrition: "#FFB1B5",
  "Départ forcé": "#FF3C47",
  "Transfert entrant": "#A99E9A",
  "Transfert sortant": "#806659",
};

const COLOR_SAVINGS = "#421799"; // bp-purple : actual + forecast
const COLOR_PLAN = "#CCC1BD"; // warm-gray : plan
const COLOR_ENR = "#FF3C47"; // coral : ENR par période
const COLOR_ENR_CUMUL = "#991D1F"; // red-brick : cumul ENR
const COLOR_NET_POS = "#421799"; // bp-purple : économie nette positive
const COLOR_NET_NEG = "#FF3C47"; // coral : économie nette négative
const COLOR_NET_CUMUL = "#320300"; // deep-red : cumul net
const COLOR_INK = "#320300"; // deep-red : cumul mouvements

const fmtMEur = (v: number) => `${v.toFixed(1)} M€`;
const fmtEtp = (v: number) => v.toLocaleString("fr-FR");

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1. Économies salariales (Actual + Forecast vs Plan) + cumul — double échelle Y
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function SavingsPeriodCumulChart({
  buckets,
  height = 320,
  referenceLabel,
}: {
  buckets: SalarySavingsBucket[];
  height?: number;
  /** Label du bucket qui marque l'arrêté (dernier bucket réalisé). Ligne verticale de repère. */
  referenceLabel?: string;
}) {
  if (buckets.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucune donnée à afficher.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={buckets} margin={{ top: 8, right: 8, left: 0, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          angle={-25}
          textAnchor="end"
          height={40}
        />
        <YAxis
          yAxisId="period"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtMEur}
        />
        <YAxis
          yAxisId="cumul"
          orientation="right"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtMEur}
        />
        <Tooltip
          formatter={(value, name) => [fmtMEur(Number(value)), String(name)]}
          labelStyle={{ fontSize: 11, fontWeight: 600 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" align="right" iconType="rect" />
        {referenceLabel && (
          <ReferenceLine
            yAxisId="period"
            x={referenceLabel}
            stroke="rgba(0,0,0,0.35)"
            strokeDasharray="4 4"
            label={{ value: "Arrêté", fontSize: 10, position: "top", fill: "#0F172A" }}
          />
        )}
        <Bar
          yAxisId="period"
          dataKey="actualPlusForecast"
          name="Actual + forecast"
          fill={COLOR_SAVINGS}
        />
        <Bar yAxisId="period" dataKey="plan" name="Plan" fill={COLOR_PLAN} />
        <Line
          yAxisId="cumul"
          type="monotone"
          dataKey="cumulActualForecast"
          name="Cumul actual + forecast"
          stroke={COLOR_SAVINGS}
          strokeWidth={2}
          dot={{ r: 3 }}
        />
        <Line
          yAxisId="cumul"
          type="monotone"
          dataKey="cumulPlan"
          name="Cumul plan"
          stroke={COLOR_PLAN}
          strokeWidth={1.5}
          strokeDasharray="5 4"
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2. ENR (coûts sociaux exceptionnels) par période + cumul
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function EnrPeriodCumulChart({
  buckets,
  height = 300,
}: {
  buckets: SocialCostBucket[];
  height?: number;
}) {
  if (buckets.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucune donnée à afficher.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={buckets} margin={{ top: 8, right: 8, left: 0, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          angle={-25}
          textAnchor="end"
          height={40}
        />
        <YAxis
          yAxisId="period"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtMEur}
        />
        <YAxis
          yAxisId="cumul"
          orientation="right"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtMEur}
        />
        <Tooltip
          formatter={(value, name) => [fmtMEur(Number(value)), String(name)]}
          labelStyle={{ fontSize: 11, fontWeight: 600 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" align="right" />
        <Bar yAxisId="period" dataKey="enr" name="ENR période" fill={COLOR_ENR} />
        <Line
          yAxisId="cumul"
          type="monotone"
          dataKey="cumulEnr"
          name="Cumul ENR"
          stroke={COLOR_ENR_CUMUL}
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3. Économie nette (savings − ENR) — barres +/− + courbe cumul
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function NetEconomyChart({
  buckets,
  height = 300,
}: {
  buckets: NetEconomyBucket[];
  height?: number;
}) {
  if (buckets.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucune donnée à afficher.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={buckets} margin={{ top: 8, right: 8, left: 0, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          angle={-25}
          textAnchor="end"
          height={40}
        />
        <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtMEur} />
        <Tooltip
          formatter={(value, name) => [fmtMEur(Number(value)), String(name)]}
          labelStyle={{ fontSize: 11, fontWeight: 600 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" align="right" />
        <ReferenceLine y={0} stroke="rgba(0,0,0,0.35)" />
        <Bar dataKey="net" name="Économie nette">
          {buckets.map((b, i) => (
            <Cell key={i} fill={b.net >= 0 ? COLOR_NET_POS : COLOR_NET_NEG} />
          ))}
        </Bar>
        <Line
          type="monotone"
          dataKey="cumulNet"
          name="Cumul net"
          stroke={COLOR_NET_CUMUL}
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 4. Rythme des mouvements — 5 stackId (+/−) + point net + courbe cumul
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function MovementRhythmChart({
  buckets,
  height = 340,
}: {
  buckets: MovementRhythmBucket[];
  height?: number;
}) {
  if (buckets.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucune donnée à afficher.</p>;
  }

  // Structure de données pour Recharts : chaque bucket devient un objet avec les 5 keys typed.
  const data = buckets.map((b) => ({
    label: b.label,
    Recrutement: b.byType["Recrutement"],
    Attrition: b.byType["Attrition"],
    "Départ forcé": b.byType["Départ forcé"],
    "Transfert entrant": b.byType["Transfert entrant"],
    "Transfert sortant": b.byType["Transfert sortant"],
    net: b.net,
    cumulNet: b.cumulNet,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          angle={-25}
          textAnchor="end"
          height={40}
        />
        <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtEtp} />
        <Tooltip
          formatter={(value, name) => [`${fmtEtp(Number(value))} ETP`, String(name)]}
          labelStyle={{ fontSize: 11, fontWeight: 600 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" align="right" />
        <ReferenceLine y={0} stroke="rgba(0,0,0,0.35)" />
        <Bar
          dataKey="Recrutement"
          stackId="mouv"
          fill={TYPE_COLORS["Recrutement"]}
          name="Recrutements"
        />
        <Bar dataKey="Attrition" stackId="mouv" fill={TYPE_COLORS["Attrition"]} name="Attrition" />
        <Bar
          dataKey="Départ forcé"
          stackId="mouv"
          fill={TYPE_COLORS["Départ forcé"]}
          name="Départs forcés"
        />
        <Bar
          dataKey="Transfert entrant"
          stackId="mouv"
          fill={TYPE_COLORS["Transfert entrant"]}
          name="Transferts entrants"
        />
        <Bar
          dataKey="Transfert sortant"
          stackId="mouv"
          fill={TYPE_COLORS["Transfert sortant"]}
          name="Transferts sortants"
        />
        <Line
          type="monotone"
          dataKey="cumulNet"
          name="Cumul net"
          stroke={COLOR_INK}
          strokeWidth={2}
          dot={{ r: 3, fill: COLOR_INK }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 5. Pont ETP — waterfall vertical Ouverture → contributions → Clôture
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Chaque étape du pont : ouverture (barre pleine verte), contribution signée (barre flottante),
 *  clôture (barre pleine verte). Utilise le même mécanisme "pied invisible + hauteur visible"
 *  que la waterfall ETP existante. */
export function EtpBridgeChart({
  summary,
  height = 300,
}: {
  summary: FteBridgeSummary;
  height?: number;
}) {
  const { opening, closing, contributions } = summary;

  type Datum = {
    label: string;
    kind: "open" | "close" | "positive" | "negative";
    base: number;
    height: number;
    signedValue: number;
  };

  const data: Datum[] = [];
  let running = opening;
  data.push({
    label: "ETP ouverture",
    kind: "open",
    base: 0,
    height: opening,
    signedValue: opening,
  });
  for (const c of contributions) {
    if (c.delta === 0) continue; // masque les catégories neutres
    const start = running;
    running += c.delta;
    data.push({
      label: c.type,
      kind: c.delta >= 0 ? "positive" : "negative",
      base: Math.min(start, running),
      height: Math.abs(c.delta),
      signedValue: c.delta,
    });
  }
  data.push({
    label: "ETP après sélection",
    kind: "close",
    base: 0,
    height: closing,
    signedValue: closing,
  });

  const kindColor: Record<Datum["kind"], string> = {
    open: "#320300",
    close: "#320300",
    positive: "#421799",
    negative: "#FF3C47",
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 20, right: 8, left: 0, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "#404040" }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtEtp} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0]?.payload as Datum;
            const sign = d.signedValue > 0 && d.kind === "positive" ? "+" : "";
            return (
              <div className="rounded-md border border-border bg-white px-3 py-2 text-xs shadow-sm">
                <div className="font-semibold text-primary">{d.label}</div>
                <div className="text-secondary">
                  {sign}
                  {fmtEtp(d.signedValue)} ETP
                </div>
              </div>
            );
          }}
        />
        <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="height" stackId="wf" isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={kindColor[d.kind]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
