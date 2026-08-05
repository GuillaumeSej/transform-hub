"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Cell,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FteBridgeBucket } from "@/lib/hrEngine";
import type { MovementType } from "@/types";

// Polarité validée (dataviz) : réductions en corail, ajouts en bleu — ΔE CVD 81.6.
const COLOR_DOWN = "#FF3C47";
const COLOR_UP = "#421799";
const COLOR_TARGET = "#806659";

/** Palette catégorielle des 5 types "OD Monitoring" — utilisée en mode `byType`. Les 2 catégories
 *  de sorties ETP (Attrition + Départ forcé) partagent la teinte corail (négatif) avec une
 *  variante d'intensité, le Recrutement est en bleu (positif), les transferts internes en gris
 *  (neutre) car ils ne modifient pas le total. */
const TYPE_COLORS: Record<MovementType, string> = {
  Recrutement: "#421799",
  Attrition: "#FFB1B5",
  "Départ forcé": "#FF3C47",
  "Transfert entrant": "#806659",
  "Transfert sortant": "#A99E9A",
};

const TYPE_ORDER: MovementType[] = [
  "Recrutement",
  "Attrition",
  "Départ forcé",
  "Transfert entrant",
  "Transfert sortant",
];

type WaterfallDatum = {
  label: string;
  /** pied invisible de la barre flottante */
  base: number;
  /** hauteur visible (|delta|) */
  height: number;
  delta: number;
  cumulative: number;
};

type ByTypeDatum = {
  label: string;
  cumulative: number;
  /** Volume signé du type dans le bucket (Recrutement ≥ 0 ; Attrition / Départ forcé ≤ 0 ;
   *  transferts = 0). Les séries stackId="pos" ne prennent que les valeurs ≥ 0, "neg" les < 0
   *  — Recharts empile alors correctement avec baseline 0 et affiche les négatifs vers le bas. */
  Recrutement_pos: number;
  Attrition_neg: number;
  "Départ forcé_neg": number;
  "Transfert entrant_pos": number;
  "Transfert sortant_pos": number;
};

/**
 * Waterfall des effectifs :
 *  - Mode par défaut (`byType=false`) : chaque barre "flotte" entre l'effectif avant et après le
 *    bucket (mois/trimestre/FY), de la baseline vers l'atterrissage. Réductions en corail (vers
 *    le bas), recrutements en bleu (vers le haut), cible en pointillés. Clic → drill-down.
 *  - Mode "OD Monitoring" (`byType=true`) : chaque bucket devient une pile de 5 catégories
 *    signées (positifs empilés vers le haut, négatifs vers le bas depuis 0). Le cumul net
 *    est affiché en ligne pour préserver la lecture waterfall. Aligné sur la vue "Trajectoire
 *    décomposée" de Gooduelle — voir `lib/hrEngine.ts::FteBridgeBucket.byType`.
 */
export function FteWaterfallChart({
  buckets,
  baseline,
  target,
  height = 280,
  unit = "ETP",
  decimals = 0,
  byType = false,
  onBarClick,
}: {
  buckets: (Pick<FteBridgeBucket, "label" | "delta"> & Partial<Pick<FteBridgeBucket, "byType">>)[];
  baseline: number;
  target: number;
  height?: number;
  /** "ETP" ou "€M" — utilisé dans les tooltips et libellés */
  unit?: string;
  decimals?: number;
  /** `true` = décomposition par type (5 séries stackées + ligne cumul), `false` = waterfall net
   *  historique. */
  byType?: boolean;
  onBarClick?: (label: string) => void;
}) {
  if (buckets.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucun mouvement planifié.</p>;
  }

  const fmt = (v: number) =>
    v.toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  if (byType) {
    return (
      <ByTypeWaterfall
        buckets={buckets}
        baseline={baseline}
        target={target}
        height={height}
        unit={unit}
        decimals={decimals}
        onBarClick={onBarClick}
        fmt={fmt}
      />
    );
  }

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
                {onBarClick && (
                  <div className="mt-1 text-[10px] text-tertiary">
                    Cliquer pour le détail par levier
                  </div>
                )}
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
            <Cell
              key={d.label}
              fill={d.delta < 0 ? COLOR_DOWN : d.delta > 0 ? COLOR_UP : "rgba(0,0,0,0.12)"}
            />
          ))}
        </Bar>
        <ReferenceLine
          y={baseline - offset}
          stroke="rgba(0,0,0,0.35)"
          strokeWidth={1}
          label={{
            value: `Baseline ${fmt(baseline)}`,
            fontSize: 10,
            position: "insideTopLeft",
            fill: "#806659",
          }}
        />
        <ReferenceLine
          y={target - offset}
          stroke={COLOR_TARGET}
          strokeDasharray="5 4"
          strokeWidth={1.5}
          label={{
            value: `Cible ${fmt(target)}`,
            fontSize: 10,
            position: "insideBottomLeft",
            fill: COLOR_TARGET,
          }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Mode décomposé par type (`byType=true`) — signé, empilé positifs/négatifs autour de 0, avec
 *  une ligne cumul net. Extrait dans son propre composant pour ne pas encombrer la version
 *  waterfall classique. */
function ByTypeWaterfall({
  buckets,
  baseline,
  target,
  height,
  unit,
  onBarClick,
  fmt,
}: {
  buckets: (Pick<FteBridgeBucket, "label" | "delta"> & Partial<Pick<FteBridgeBucket, "byType">>)[];
  baseline: number;
  target: number;
  height: number;
  unit: string;
  decimals: number;
  onBarClick?: (label: string) => void;
  fmt: (v: number) => string;
}) {
  let cumulative = baseline;
  const data: ByTypeDatum[] = buckets.map((b) => {
    cumulative += b.delta;
    const bt = b.byType;
    return {
      label: b.label,
      cumulative,
      // Séries positives (Recrutement, transferts positifs — 0 en pratique)
      Recrutement_pos: Math.max(0, bt?.Recrutement ?? 0),
      "Transfert entrant_pos": Math.max(0, bt?.["Transfert entrant"] ?? 0),
      "Transfert sortant_pos": Math.max(0, bt?.["Transfert sortant"] ?? 0),
      // Séries négatives (Attrition, Départ forcé)
      Attrition_neg: Math.min(0, bt?.Attrition ?? 0),
      "Départ forcé_neg": Math.min(0, bt?.["Départ forcé"] ?? 0),
    };
  });

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
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload || payload.length === 0) return null;
            const d = payload[0]?.payload as ByTypeDatum | undefined;
            if (!d) return null;
            return (
              <div className="rounded-md border border-border bg-white px-3 py-2 text-xs shadow-sm">
                <div className="mb-1 font-semibold text-primary">{label}</div>
                <div className="space-y-0.5">
                  {TYPE_ORDER.map((t) => {
                    const key = ((): keyof ByTypeDatum | null => {
                      if (t === "Recrutement") return "Recrutement_pos";
                      if (t === "Attrition") return "Attrition_neg";
                      if (t === "Départ forcé") return "Départ forcé_neg";
                      if (t === "Transfert entrant") return "Transfert entrant_pos";
                      if (t === "Transfert sortant") return "Transfert sortant_pos";
                      return null;
                    })();
                    if (!key) return null;
                    const raw = d[key];
                    const value = typeof raw === "number" ? raw : 0;
                    if (value === 0) return null;
                    return (
                      <div key={t} className="flex items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-1.5 text-secondary">
                          <span
                            className="h-2 w-2 rounded-sm"
                            style={{ background: TYPE_COLORS[t] }}
                          />
                          {t}
                        </span>
                        <span className="font-semibold tabular-nums text-primary">
                          {value > 0 ? "+" : ""}
                          {fmt(value)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-1.5 border-t border-border pt-1.5 text-tertiary">
                  Cumul net : {fmt(d.cumulative)} {unit}
                </div>
              </div>
            );
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine yAxisId="left" y={0} stroke="rgba(0,0,0,0.35)" />
        <Bar
          yAxisId="left"
          dataKey="Recrutement_pos"
          name="Recrutement"
          stackId="pos"
          fill={TYPE_COLORS.Recrutement}
          onClick={(d) => {
            const l = (d as { label?: string })?.label;
            if (l) onBarClick?.(l);
          }}
          cursor={onBarClick ? "pointer" : undefined}
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
          dataKey="cumulative"
          name={`Cumul (${unit})`}
          stroke="#320300"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
        <ReferenceLine
          yAxisId="right"
          y={target}
          stroke={COLOR_TARGET}
          strokeDasharray="5 4"
          strokeWidth={1.5}
          label={{
            value: `Cible ${fmt(target)}`,
            fontSize: 10,
            position: "insideBottomLeft",
            fill: COLOR_TARGET,
          }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Légende de polarité affichée sous la waterfall (identité jamais portée par la couleur seule). */
export function FteWaterfallLegend({
  downLabel = "Sorties (départs forcés + attrition)",
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
        <span
          className="inline-block h-0 w-4 border-t-2 border-dashed"
          style={{ borderColor: COLOR_TARGET }}
        />{" "}
        Cible
      </span>
    </div>
  );
}
