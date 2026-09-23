"use client";

/**
 * Graphiques RH alignés "OD Monitoring" (Gooduelle) — Août 2026.
 *
 * Chaque composant est un mapping pur `data → Recharts` : aucune agrégation métier ici, tout
 * est déjà pré-calculé dans `lib/hrTimeSeries.ts` (savings/ENR/net/rythme) ou `lib/hrEngine.ts`
 * (pont ETP). Le composant se contente de tracer.
 */

import { useState } from "react";
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
import type { MovementType, WorkforceMovement } from "@/types";
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
const COLOR_PLAN_LINE = "#A99E9A"; // warm-taupe : cumul plan (plus lisible que le warm-gray en trait fin)
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

/** Écart signé en M€ (« +0.3 M€ » / « −0.2 M€ »). */
const fmtSignedMEur = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtMEur(Math.abs(v))}`;

type SavingsSeriesGroup = "actual" | "plan";

/** Pastille de légende combinée : une barre (valeur par période) + un trait (cumul). */
function BarLineSwatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden="true" className="shrink-0">
      <rect x="0" y="2" width="8" height="10" fill={color} />
      <line
        x1="11"
        y1="6"
        x2="26"
        y2="6"
        stroke={color}
        strokeWidth={2}
        strokeDasharray={dashed ? "4 3" : undefined}
      />
    </svg>
  );
}

export function SavingsPeriodCumulChart({
  buckets,
  height = 300,
}: {
  buckets: SalarySavingsBucket[];
  height?: number;
}) {
  const { t } = useTranslation();
  // Séries masquées via la légende cliquable (chaque groupe = barre période + courbe cumul).
  const [hidden, setHidden] = useState<Record<SavingsSeriesGroup, boolean>>({
    actual: false,
    plan: false,
  });
  // Période épinglée par un clic sur le graphique (détail affiché sous le graphique).
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

  if (buckets.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("chart.noDataToDisplay", "Aucune donnée à afficher.")}
      </p>
    );
  }

  const selected = buckets.find((b) => b.label === selectedLabel) ?? null;

  const labelActual = t("shared.hrGooduelleCharts.legendActualForecast", "Réalisé + prévision");
  const labelPlan = t("shared.hrGooduelleCharts.legendPlan", "Plan initial");
  const labelPeriod = t("shared.hrGooduelleCharts.axisPeriod", "Par période");
  const labelCumul = t("shared.hrGooduelleCharts.axisCumul", "Cumul");
  const labelGap = t("shared.hrGooduelleCharts.gapVsPlan", "Écart vs plan");

  const groups: { key: SavingsSeriesGroup; label: string; color: string; dashed?: boolean }[] = [
    { key: "actual", label: labelActual, color: COLOR_SAVINGS },
    { key: "plan", label: labelPlan, color: COLOR_PLAN_LINE, dashed: true },
  ];

  const toggle = (key: SavingsSeriesGroup) => setHidden((h) => ({ ...h, [key]: !h[key] }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onChartClick = (state: any) => {
    const label = state?.activeLabel;
    if (typeof label !== "string" && typeof label !== "number") return;
    const key = String(label);
    setSelectedLabel((prev) => (prev === key ? null : key));
  };

  // Barres des périodes non sélectionnées estompées quand une période est épinglée.
  const cellOpacity = (b: SalarySavingsBucket) =>
    selected && b.label !== selected.label ? 0.35 : 1;

  return (
    <div>
      {/* Légende compacte et cliquable : 2 groupes, clé barre/courbe expliquée une seule fois. */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px]">
        <div className="flex flex-wrap items-center gap-1">
          {groups.map((g) => {
            const off = hidden[g.key];
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => toggle(g.key)}
                aria-pressed={!off}
                title={t(
                  "shared.hrGooduelleCharts.legendToggle",
                  "Cliquer pour masquer / afficher"
                )}
                className={`flex items-center gap-1.5 rounded-sm border px-2 py-0.5 transition-colors hover:bg-neutral-50 ${
                  off
                    ? "border-dashed border-border text-tertiary line-through opacity-60"
                    : "border-border text-primary"
                }`}
              >
                <BarLineSwatch color={off ? "#C4C4C4" : g.color} dashed={g.dashed} />
                <span>{g.label}</span>
              </button>
            );
          })}
        </div>
        <span className="text-tertiary">
          {t("shared.hrGooduelleCharts.legendKey", "Barre = par période · Courbe = cumul")}
        </span>
      </div>
      {/* Libellés d'axes explicites (double échelle). */}
      <div className="flex justify-between px-1 text-[10px] font-medium text-tertiary">
        <span>← {labelPeriod} (M€)</span>
        <span>{labelCumul} (M€) →</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={buckets}
          margin={{ top: 8, right: 8, left: 0, bottom: 20 }}
          onClick={onChartClick}
          style={{ cursor: "pointer" }}
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
            contentStyle={{ fontSize: 11 }}
          />
          {selected && (
            <ReferenceLine
              yAxisId="period"
              x={selected.label}
              stroke="rgba(0,0,0,0.35)"
              strokeDasharray="3 3"
            />
          )}
          <Bar
            yAxisId="period"
            dataKey="actualPlusForecast"
            name={`${labelActual} — ${labelPeriod.toLowerCase()}`}
            fill={COLOR_SAVINGS}
            hide={hidden.actual}
            cursor="pointer"
          >
            {buckets.map((b) => (
              <Cell key={b.label} fill={COLOR_SAVINGS} fillOpacity={cellOpacity(b)} />
            ))}
          </Bar>
          <Bar
            yAxisId="period"
            dataKey="plan"
            name={`${labelPlan} — ${labelPeriod.toLowerCase()}`}
            fill={COLOR_PLAN}
            hide={hidden.plan}
            cursor="pointer"
          >
            {buckets.map((b) => (
              <Cell key={b.label} fill={COLOR_PLAN} fillOpacity={cellOpacity(b)} />
            ))}
          </Bar>
          <Line
            yAxisId="cumul"
            type="monotone"
            dataKey="cumulActualForecast"
            name={`${labelCumul} ${labelActual.toLowerCase()}`}
            stroke={COLOR_SAVINGS}
            strokeWidth={2}
            dot={{ r: 3 }}
            hide={hidden.actual}
          />
          <Line
            yAxisId="cumul"
            type="monotone"
            dataKey="cumulPlan"
            name={`${labelCumul} ${labelPlan.toLowerCase()}`}
            stroke={COLOR_PLAN_LINE}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            hide={hidden.plan}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {/* Détail épinglé de la période cliquée. */}
      {selected ? (
        <div className="mt-1 border border-border bg-neutral-50 px-3 py-2 text-xs">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-primary">{selected.label}</span>
              <span className="rounded-sm border border-border px-1.5 py-px text-[10px] text-secondary">
                {selected.isFuture
                  ? t("shared.hrGooduelleCharts.badgeForecast", "Prévision")
                  : t("shared.hrGooduelleCharts.badgeActual", "Réalisé")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedLabel(null)}
              className="text-[11px] text-tertiary underline-offset-2 hover:text-primary hover:underline"
            >
              {t("common.close", "Fermer")}
            </button>
          </div>
          <table className="w-full tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-tertiary">
                <th className="py-0.5 text-left font-medium" />
                <th className="py-0.5 text-right font-medium">{labelPeriod}</th>
                <th className="py-0.5 text-right font-medium">{labelCumul}</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr>
                <td className="py-0.5">
                  <span className="inline-flex items-center gap-1.5">
                    <BarLineSwatch color={COLOR_SAVINGS} />
                    {labelActual}
                  </span>
                </td>
                <td className="py-0.5 text-right">{fmtMEur(selected.actualPlusForecast)}</td>
                <td className="py-0.5 text-right">{fmtMEur(selected.cumulActualForecast)}</td>
              </tr>
              <tr>
                <td className="py-0.5">
                  <span className="inline-flex items-center gap-1.5">
                    <BarLineSwatch color={COLOR_PLAN_LINE} dashed />
                    {labelPlan}
                  </span>
                </td>
                <td className="py-0.5 text-right">{fmtMEur(selected.plan)}</td>
                <td className="py-0.5 text-right">{fmtMEur(selected.cumulPlan)}</td>
              </tr>
              <tr className="border-t border-border font-semibold text-primary">
                <td className="pt-1">{labelGap}</td>
                <td className="pt-1 text-right">
                  {fmtSignedMEur(selected.actualPlusForecast - selected.plan)}
                </td>
                <td className="pt-1 text-right">
                  {fmtSignedMEur(selected.cumulActualForecast - selected.cumulPlan)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-tertiary">
          {t(
            "shared.hrGooduelleCharts.clickPeriodHint",
            "Cliquez sur une période pour épingler son détail."
          )}
        </p>
      )}
    </div>
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
  onBarClick,
}: {
  buckets: MovementRhythmBucket[];
  height?: number;
  /** Clic sur une barre (n'importe lequel des 5 types) — ouvre le détail des mouvements de la
   *  période (voir `MovementDrilldownModal`, câblé dans `app/(app)/hr/page.tsx`). */
  onBarClick?: (label: string, movements: WorkforceMovement[]) => void;
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
    movements: b.movements,
  }));
  const axisDomains = movementRhythmAxisDomains(buckets);
  const handleBarClick = (payload: unknown) => {
    const row = payload as { label?: string; movements?: WorkforceMovement[] } | undefined;
    if (row?.label && onBarClick) onBarClick(row.label, row.movements ?? []);
  };

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
          onClick={handleBarClick}
          cursor={onBarClick ? "pointer" : undefined}
        />
        <Bar
          yAxisId="period"
          dataKey="Attrition"
          stackId="mouv"
          fill={TYPE_COLORS["Attrition"]}
          name={t("chart.movementType.attrition", "Attrition")}
          onClick={handleBarClick}
          cursor={onBarClick ? "pointer" : undefined}
        />
        <Bar
          dataKey="Départ forcé"
          yAxisId="period"
          stackId="mouv"
          fill={TYPE_COLORS["Départ forcé"]}
          name={t("chart.movementType.forcedDepartures", "Départs forcés")}
          onClick={handleBarClick}
          cursor={onBarClick ? "pointer" : undefined}
        />
        <Bar
          dataKey="Transfert entrant"
          yAxisId="period"
          stackId="mouv"
          fill={TYPE_COLORS["Transfert entrant"]}
          name={t("chart.movementType.transfersIn", "Transferts entrants")}
          onClick={handleBarClick}
          cursor={onBarClick ? "pointer" : undefined}
        />
        <Bar
          dataKey="Transfert sortant"
          yAxisId="period"
          stackId="mouv"
          fill={TYPE_COLORS["Transfert sortant"]}
          name={t("chart.movementType.transfersOut", "Transferts sortants")}
          onClick={handleBarClick}
          cursor={onBarClick ? "pointer" : undefined}
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
