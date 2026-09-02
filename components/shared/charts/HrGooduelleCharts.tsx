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
import { movementRhythmAxisDomains } from "@/lib/hrTimeSeries";
import type { FteBridgeSummary } from "@/lib/hrEngine";
import type { MovementType } from "@/types";
import { useTranslation } from "@/lib/i18n/useTranslation";

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
}: {
  buckets: SalarySavingsBucket[];
  height?: number;
}) {
  const { t } = useTranslation();

  if (buckets.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("chart.noDataToDisplay", "Aucune donnée à afficher.")}
      </p>
    );
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
        <Bar
          yAxisId="period"
          dataKey="actualPlusForecast"
          name={t("shared.hrGooduelleCharts.actualForecastPeriod", "Réalisé + prévision — période")}
          fill={COLOR_SAVINGS}
        />
        <Bar
          yAxisId="period"
          dataKey="plan"
          name={t("shared.hrGooduelleCharts.planPeriod", "Plan initial — période")}
          fill={COLOR_PLAN}
        />
        <Line
          yAxisId="cumul"
          type="monotone"
          dataKey="cumulActualForecast"
          name={t("shared.hrGooduelleCharts.cumulActualForecast", "Cumul réalisé + prévision")}
          stroke={COLOR_SAVINGS}
          strokeWidth={2}
          dot={{ r: 3 }}
        />
        <Line
          yAxisId="cumul"
          type="monotone"
          dataKey="cumulPlan"
          name={t("shared.hrGooduelleCharts.cumulPlan", "Cumul plan initial")}
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
  const { t } = useTranslation();

  if (buckets.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("chart.noDataToDisplay", "Aucune donnée à afficher.")}
      </p>
    );
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
        <Bar
          yAxisId="period"
          dataKey="actualForecast"
          name={t(
            "shared.hrGooduelleCharts.enrActualForecastPeriod",
            "ENR réalisé + prévision — période"
          )}
          fill={COLOR_ENR}
        />
        <Bar
          yAxisId="period"
          dataKey="plan"
          name={t("shared.hrGooduelleCharts.enrPlanPeriod", "ENR plan initial — période")}
          fill={COLOR_PLAN}
        />
        <Line
          yAxisId="cumul"
          type="monotone"
          dataKey="cumulActualForecast"
          name={t(
            "shared.hrGooduelleCharts.enrCumulActualForecast",
            "Cumul ENR réalisé + prévision"
          )}
          stroke={COLOR_ENR_CUMUL}
          strokeWidth={2}
          dot={{ r: 3 }}
        />
        <Line
          yAxisId="cumul"
          type="monotone"
          dataKey="cumulPlan"
          name={t("shared.hrGooduelleCharts.enrCumulPlan", "Cumul ENR plan initial")}
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
// 3. Économie nette (savings − ENR) — barres +/− + courbe cumul
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function NetEconomyChart({
  buckets,
  height = 300,
}: {
  buckets: NetEconomyBucket[];
  height?: number;
}) {
  const { t } = useTranslation();

  if (buckets.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("chart.noDataToDisplay", "Aucune donnée à afficher.")}
      </p>
    );
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
        <ReferenceLine yAxisId="period" y={0} stroke="rgba(0,0,0,0.35)" />
        <Bar
          yAxisId="period"
          dataKey="actualForecast"
          name={t(
            "shared.hrGooduelleCharts.netEconomyActualForecast",
            "Économie nette réalisé + prévision"
          )}
        >
          {buckets.map((b, i) => (
            <Cell key={i} fill={b.actualForecast >= 0 ? COLOR_NET_POS : COLOR_NET_NEG} />
          ))}
        </Bar>
        <Line
          yAxisId="cumul"
          type="monotone"
          dataKey="cumulActualForecast"
          name={t(
            "shared.hrGooduelleCharts.netCumulActualForecast",
            "Cumul net réalisé + prévision"
          )}
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
  const { t } = useTranslation();

  if (buckets.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("chart.noDataToDisplay", "Aucune donnée à afficher.")}
      </p>
    );
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
  const axisDomains = movementRhythmAxisDomains(buckets);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        stackOffset="sign"
        margin={{ top: 8, right: 8, left: 0, bottom: 20 }}
      >
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
          domain={axisDomains.period}
          allowDataOverflow
          allowDecimals={false}
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtEtp}
        />
        <YAxis
          yAxisId="cumul"
          domain={axisDomains.cumulative}
          allowDataOverflow
          orientation="right"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtEtp}
        />
        <Tooltip
          formatter={(value, name) => [
            `${fmtEtp(Number(value))} ${t("etp.column.fte", "ETP")}`,
            String(name),
          ]}
          labelStyle={{ fontSize: 11, fontWeight: 600 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" align="right" />
        <ReferenceLine yAxisId="period" y={0} stroke="rgba(0,0,0,0.35)" />
        <Bar
          dataKey="Recrutement"
          yAxisId="period"
          stackId="mouv"
          fill={TYPE_COLORS["Recrutement"]}
          name={t("chart.movementType.recruitments", "Recrutements")}
        />
        <Bar
          yAxisId="period"
          dataKey="Attrition"
          stackId="mouv"
          fill={TYPE_COLORS["Attrition"]}
          name={t("chart.movementType.attrition", "Attrition")}
        />
        <Bar
          dataKey="Départ forcé"
          yAxisId="period"
          stackId="mouv"
          fill={TYPE_COLORS["Départ forcé"]}
          name={t("chart.movementType.forcedDepartures", "Départs forcés")}
        />
        <Bar
          dataKey="Transfert entrant"
          yAxisId="period"
          stackId="mouv"
          fill={TYPE_COLORS["Transfert entrant"]}
          name={t("chart.movementType.transfersIn", "Transferts entrants")}
        />
        <Bar
          dataKey="Transfert sortant"
          yAxisId="period"
          stackId="mouv"
          fill={TYPE_COLORS["Transfert sortant"]}
          name={t("chart.movementType.transfersOut", "Transferts sortants")}
        />
        <Line
          yAxisId="period"
          type="monotone"
          dataKey="net"
          name={t("shared.hrGooduelleCharts.netTargetFte", "Net ETP cible (hors transferts)")}
          stroke="transparent"
          strokeWidth={0}
          dot={{ r: 6, fill: "white", stroke: "#320300", strokeWidth: 2.5 }}
          activeDot={{ r: 7, fill: "white", stroke: "#320300", strokeWidth: 3 }}
        />
        <Line
          yAxisId="cumul"
          type="monotone"
          dataKey="cumulNet"
          name={t("shared.hrGooduelleCharts.cumulNet", "Cumul net")}
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
  const { t } = useTranslation();
  const { opening, closing, contributions } = summary;

  type Datum = {
    label: string;
    kind: "open" | "close" | "positive" | "negative" | "zero";
    base: number;
    height: number;
    signedValue: number;
    count: number;
  };

  const data: Datum[] = [];
  let running = opening;
  data.push({
    label: t("shared.hrGooduelleCharts.etpOpening", "ETP ouverture"),
    kind: "open",
    base: 0,
    height: opening,
    signedValue: opening,
    count: 0,
  });
  for (const c of contributions) {
    const start = running;
    running += c.delta;
    data.push({
      label: c.type,
      kind: c.delta === 0 ? "zero" : c.delta > 0 ? "positive" : "negative",
      base: Math.min(start, running),
      height: Math.abs(c.delta),
      signedValue: c.delta,
      count: c.count,
    });
  }
  data.push({
    label: t("shared.hrGooduelleCharts.etpClosing", "ETP après sélection"),
    kind: "close",
    base: 0,
    height: closing,
    signedValue: closing,
    count: 0,
  });

  const kindColor: Record<Datum["kind"], string> = {
    open: "#320300",
    close: "#320300",
    positive: "#421799",
    negative: "#FF3C47",
    zero: "#A99E9A",
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
                  {fmtEtp(d.signedValue)} {t("etp.column.fte", "ETP")}
                </div>
                {d.count > 0 && (
                  <div className="text-tertiary">
                    {t(
                      "shared.hrGooduelleCharts.volumeConcerned",
                      "Volume concerné : {n} mouvement(s)"
                    ).replace("{n}", String(d.count))}
                  </div>
                )}
              </div>
            );
          }}
        />
        <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="height" stackId="wf" minPointSize={4} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={kindColor[d.kind]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
