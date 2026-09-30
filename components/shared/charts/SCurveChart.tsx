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
  Tooltip,
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
  gap?: {
    total: number;
    late: number;
    cancelled: number;
    other: number;
    /** Réajustement du plan : réactualisé − planifié initial (voir `engine.SavingsSeriesGap`). */
    adjustment?: number;
    /** Retard d'exécution : réalisé − réactualisé. `total` = `adjustment` + `delay`. */
    delay?: number;
  };
};

/** Levier contribuant à l'écart d'une période (aperçu au survol) — `value` = écart signé en M€. */
export type SCurveGapContributor = { id: string; name: string; value: number };

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

const signedM = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtM(Math.abs(v))}`;

/** Aperçu au survol d'une période de la courbe en S : plan / réactualisé / réalisé, mini-comparaison
 *  réalisé ↔ plan, écart décomposé (réajustement du plan + retard d'exécution, même identité que
 *  `engine.savingsSeries`) et principaux leviers contributeurs. Le clic ouvre le détail complet. */
export function SCurvePreview({
  point,
  contributors,
  clickable,
  labels,
}: {
  point: SCurvePoint;
  contributors?: SCurveGapContributor[];
  clickable: boolean;
  labels: { actual: string; planned: string; reforecast: string };
}) {
  const { t } = useTranslation();
  const { planned, reforecast, actual } = point;
  const max = Math.max(Math.abs(planned), Math.abs(reforecast), Math.abs(actual ?? 0), 1e-9);
  const width = (v: number) => `${Math.max(2, (Math.abs(v) / max) * 100)}%`;
  const compared = actual ?? reforecast;
  const gap = Math.round((compared - planned) * 10) / 10;
  const top = (contributors ?? []).filter((c) => Math.abs(c.value) >= 0.05).slice(0, 3);
  const row = (color: string, dashed: boolean, label: string, value: number | null) => (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-secondary">
        <span
          className="inline-block h-0 w-3 border-t-2"
          style={{ borderColor: color, borderTopStyle: dashed ? "dashed" : "solid" }}
        />
        {label}
      </span>
      <span className="font-semibold tabular-nums text-primary">
        {value === null ? "—" : fmtM(value)}
      </span>
    </div>
  );
  return (
    <div className="w-[260px] border border-border bg-white p-3 text-[11.5px] shadow-lg">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[12.5px] font-bold text-primary">{point.month}</span>
        {actual === null && (
          <span className="text-[10.5px] text-tertiary">
            {t("chart.scurvePreview.forecast", "Prévision")}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {row("#806659", true, labels.planned, planned)}
        {row("#320300", true, labels.reforecast, reforecast)}
        {row("#FF3C47", false, labels.actual, actual)}
      </div>
      {/* Mini-zoom : réalisé (ou réactualisé en prévision) comparé au plan initial. */}
      <div className="mt-2.5 space-y-1">
        <div className="h-1.5 bg-neutral-100">
          <div className="h-full bg-bp-warm-brown/60" style={{ width: width(planned) }} />
        </div>
        <div className="h-1.5 bg-neutral-100">
          <div
            className={actual !== null ? "h-full bg-bp-coral" : "h-full bg-bp-deep-red/70"}
            style={{ width: width(compared) }}
          />
        </div>
      </div>
      <div className="mt-2.5 border-t border-border pt-2">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-primary">
            {actual !== null
              ? t("chart.scurvePreview.gap", "Écart réalisé − plan")
              : t("chart.scurvePreview.gapForecast", "Écart prévu (réactualisé − plan)")}
          </span>
          <span
            className={
              gap < 0
                ? "font-bold tabular-nums text-bp-coral"
                : "font-bold tabular-nums text-primary"
            }
          >
            {gap === 0 ? fmtM(0) : signedM(gap)}
          </span>
        </div>
        {actual !== null &&
          point.gap?.adjustment !== undefined &&
          point.gap?.delay !== undefined && (
            <div className="mt-1 space-y-0.5 text-[11px] text-secondary">
              <div className="flex justify-between">
                <span>{t("chart.scurvePreview.adjustment", "dont réajustement du plan")}</span>
                <span className="tabular-nums">{signedM(point.gap.adjustment)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("chart.scurvePreview.delay", "dont écart d'exécution")}</span>
                <span className="tabular-nums">{signedM(point.gap.delay)}</span>
              </div>
            </div>
          )}
      </div>
      {actual !== null && top.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
            {t("chart.scurvePreview.topLevers", "Principaux écarts")}
          </div>
          <div className="space-y-0.5">
            {top.map((c) => (
              <div key={c.id} className="flex justify-between gap-3">
                <span className="truncate text-secondary">{c.name}</span>
                <span
                  className={
                    c.value < 0 ? "tabular-nums text-bp-coral" : "tabular-nums text-primary"
                  }
                >
                  {signedM(c.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {clickable && (
        <div className="mt-2 text-[10.5px] font-medium text-tertiary">
          {t("chart.scurvePreview.click", "Cliquer pour le détail →")}
        </div>
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
  gapContributors,
}: {
  data: SCurvePoint[];
  height?: number;
  onPointClick?: (month: string) => void;
  labelActual?: string;
  labelPlanned?: string;
  labelReforecast?: string;
  /** Leviers contribuant à l'écart d'une période, triés par importance — alimente l'aperçu au
   *  survol (3 premiers affichés). Absent = aperçu sans liste de leviers. */
  gapContributors?: (month: string) => SCurveGapContributor[];
}) {
  const { t } = useTranslation();
  const resolvedLabelActual = labelActual ?? t("chart.scurve.actual", "Réalisé");
  const resolvedLabelPlanned = labelPlanned ?? t("chart.scurve.planned", "Plan initial");
  const resolvedLabelReforecast = labelReforecast ?? t("chart.scurve.reforecast", "Réactualisé");
  const curIdx = currentPointIndex(data);
  const cur = curIdx >= 0 ? data[curIdx] : null;
  return (
    <div className="relative">
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
          {/* Aperçu au survol (retour PO) : plan / réalisé / écart de la période, puis clic = détail. */}
          <Tooltip
            cursor={{ stroke: "#A99E9A", strokeDasharray: "3 3" }}
            wrapperStyle={{ outline: "none", zIndex: 20 }}
            allowEscapeViewBox={{ x: false, y: true }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as SCurvePoint | undefined;
              if (!active || !point) return null;
              return (
                <SCurvePreview
                  point={point}
                  contributors={point.actual !== null ? gapContributors?.(point.month) : undefined}
                  clickable={!!onPointClick}
                  labels={{
                    actual: resolvedLabelActual,
                    planned: resolvedLabelPlanned,
                    reforecast: resolvedLabelReforecast,
                  }}
                />
              );
            }}
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
    </div>
  );
}
