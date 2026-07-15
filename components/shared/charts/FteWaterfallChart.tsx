"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FteBridgeBucket } from "@/lib/hrEngine";

// Polarité validée (dataviz) : réductions en corail, ajouts en bleu — ΔE CVD 81.6.
const COLOR_DOWN = "#FF3C47";
const COLOR_UP = "#421799";
const COLOR_TARGET = "#806659";

type WaterfallDatum = {
  label: string;
  /** pied invisible de la barre flottante */
  base: number;
  /** hauteur visible (|delta|) */
  height: number;
  delta: number;
  cumulative: number;
};

/**
 * Waterfall des effectifs : chaque barre "flotte" entre l'effectif avant et après le bucket
 * (mois/trimestre), de la baseline vers l'atterrissage. Réductions en corail (vers le bas),
 * recrutements en bleu (vers le haut), cible en pointillés. Clic sur une barre → drill-down.
 */
export function FteWaterfallChart({
  buckets,
  baseline,
  target,
  height = 280,
  unit = "ETP",
  decimals = 0,
  onBarClick,
}: {
  buckets: Pick<FteBridgeBucket, "label" | "delta">[];
  baseline: number;
  target: number;
  height?: number;
  /** "ETP" ou "€M" — utilisé dans les tooltips et libellés */
  unit?: string;
  decimals?: number;
  onBarClick?: (label: string) => void;
}) {
  if (buckets.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucun mouvement planifié.</p>;
  }

  const fmt = (v: number) =>
    v.toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  let running = baseline;
  const raw = buckets.map((b) => {
    const start = running;
    running += b.delta;
    return {
      label: b.label,
      base: Math.min(start, running),
      height: Math.abs(b.delta),
      delta: b.delta,
      cumulative: running,
    };
  });

  const values = [baseline, target, ...raw.map((d) => d.cumulative)];
  const range = Math.max(...values) - Math.min(...values);
  const pad = Math.max(range * 0.15, decimals > 0 ? 0.5 : 10);
  // Les barres empilées de recharts partent toujours de 0 : pour zoomer sur la plage utile
  // (ex. 2 550-2 850 ETP), on translate toutes les valeurs de `offset` et on ré-ajoute l'offset
  // dans les libellés d'axe/tooltips.
  const offset = Math.min(...values) - pad;
  const domainMax = Math.max(...values) + pad - offset;
  const data: WaterfallDatum[] = raw.map((d) => ({ ...d, base: d.base - offset }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          domain={[0, domainMax]}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={56}
          tickFormatter={(v) => fmt(Number(v) + offset)}
        />
        <Tooltip
          content={({ active, payload }) => {
            const d = payload?.[1]?.payload as WaterfallDatum | undefined;
            if (!active || !d) return null;
            return (
              <div className="rounded-md border border-border bg-white px-3 py-2 text-xs shadow-sm">
                <div className="font-semibold text-primary">{d.label}</div>
                <div className="font-semibold text-primary">
                  {d.delta > 0 ? "+" : ""}
                  {fmt(d.delta)} {unit}
                </div>
                <div className="text-tertiary">
                  Fin de période : {fmt(d.cumulative)} {unit}
                </div>
                {onBarClick && <div className="mt-1 text-[10px] text-tertiary">Cliquer pour le détail par levier</div>}
              </div>
            );
          }}
        />
        {/* pied invisible de la barre flottante */}
        <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
        <Bar
          dataKey="height"
          stackId="wf"
          radius={[3, 3, 3, 3]}
          onClick={(d) => {
            const label = (d as { label?: string })?.label;
            if (label) onBarClick?.(label);
          }}
          cursor={onBarClick ? "pointer" : undefined}
        >
          {data.map((d) => (
            <Cell key={d.label} fill={d.delta < 0 ? COLOR_DOWN : d.delta > 0 ? COLOR_UP : "rgba(0,0,0,0.12)"} />
          ))}
        </Bar>
        <ReferenceLine
          y={baseline - offset}
          stroke="rgba(0,0,0,0.35)"
          strokeWidth={1}
          label={{ value: `Baseline ${fmt(baseline)}`, fontSize: 10, position: "insideTopLeft", fill: "#806659" }}
        />
        <ReferenceLine
          y={target - offset}
          stroke={COLOR_TARGET}
          strokeDasharray="5 4"
          strokeWidth={1.5}
          label={{ value: `Cible ${fmt(target)}`, fontSize: 10, position: "insideBottomLeft", fill: COLOR_TARGET }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Légende de polarité affichée sous la waterfall (identité jamais portée par la couleur seule). */
export function FteWaterfallLegend({
  downLabel = "Réductions (suppressions)",
  upLabel = "Recrutements",
}: {
  downLabel?: string;
  upLabel?: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-secondary">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_DOWN }} /> {downLabel}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_UP }} /> {upLabel}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: COLOR_TARGET }} /> Cible
      </span>
    </div>
  );
}
