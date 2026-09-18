"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FteBridgeBucket } from "@/lib/hrEngine";
import { useTranslation } from "@/lib/i18n/useTranslation";

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
  unit,
  decimals = 0,
  targetLabel,
  onBarClick,
}: {
  buckets: Pick<FteBridgeBucket, "label" | "delta">[];
  baseline: number;
  target: number;
  height?: number;
  /** "ETP" ou "€M" — utilisé dans les tooltips et libellés */
  unit?: string;
  decimals?: number;
  targetLabel?: string;
  onBarClick?: (label: string) => void;
}) {
  const { t } = useTranslation();
  const resolvedUnit = unit ?? t("etp.column.fte", "ETP");
  const resolvedTargetLabel = targetLabel ?? t("chart.bar.target", "Cible");

  if (buckets.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("shared.fteWaterfallChart.noMovements", "Aucun mouvement planifié.")}
      </p>
    );
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

  // Filet défensif (Août 2026) : si un delta legacy a produit un NaN en cascade (typologie
  // Firestore antérieure à la migration 5-types Gooduelle), on n'affiche pas un canvas vide
  // muet — on avertit explicitement pour que l'incident soit identifiable en support.
  const values = [baseline, target, ...raw.map((d) => d.cumulative)].filter((v): v is number =>
    Number.isFinite(v)
  );
  if (values.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t(
          "shared.fteWaterfallChart.dataUnavailable",
          "Données ETP indisponibles — vérifier les types de mouvements RH (typologie 5-types Gooduelle attendue)."
        )}
      </p>
    );
  }
  const range = Math.max(...values) - Math.min(...values);
  const pad = Math.max(range * 0.15, decimals > 0 ? 0.5 : 10);
  // Les barres empilées de recharts partent toujours de 0 : pour zoomer sur la plage utile
  // (ex. 2 550-2 850 ETP), on translate toutes les valeurs de `offset` et on ré-ajoute l'offset
  // dans les libellés d'axe/tooltips.
  const offset = Math.min(...values) - pad;
  const domainMax = Math.max(...values) + pad - offset;
  const data: WaterfallDatum[] = raw.map((d) => ({ ...d, base: d.base - offset }));

  // Bulle de valeur affichée au-dessus de chaque barre (round 4 RH dashboard clarity) : la
  // valeur du delta n'était visible qu'au survol (Tooltip), pas assez lisible en un coup d'œil.
  // Rendu SVG custom (même convention que `renderRemainingLabels` dans WorkstreamBarChart.tsx) :
  // un <LabelList content={...}> plutôt qu'un simple `label` string, pour pouvoir dessiner un
  // pastille colorée + texte. Le clic sur la bulle doit déclencher le même drill-down que le
  // clic sur la barre : un <g> SVG peut intercepter le pointeur avant qu'il n'atteigne la barre
  // sous-jacente, donc on lui donne son propre onClick plutôt que de compter sur un click-through.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderDeltaBubble = (props: any) => {
    const { x = 0, y = 0, width = 0, index } = props;
    const d = data[index];
    if (!d) return null;
    const text = `${d.delta > 0 ? "+" : ""}${fmt(d.delta)}`;
    const fill = d.delta < 0 ? COLOR_DOWN : d.delta > 0 ? COLOR_UP : "rgba(0,0,0,0.45)";
    const bubbleWidth = Math.max(text.length * 6.5 + 12, 28);
    const bubbleHeight = 16;
    const cx = x + width / 2;
    const cy = y - bubbleHeight / 2 - 4;
    return (
      <g
        onClick={() => onBarClick?.(d.label)}
        style={{ cursor: onBarClick ? "pointer" : undefined }}
      >
        <rect
          x={cx - bubbleWidth / 2}
          y={cy - bubbleHeight / 2}
          width={bubbleWidth}
          height={bubbleHeight}
          rx={8}
          ry={8}
          fill={fill}
        />
        <text
          x={cx}
          y={cy + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={10}
          fontWeight={600}
          fill="#fff"
        >
          {text}
        </text>
      </g>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 22, right: 8, left: 4, bottom: 0 }}>
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
          cursor={false}
          content={({ active, payload }) => {
            const d = payload?.[1]?.payload as WaterfallDatum | undefined;
            if (!active || !d) return null;
            return (
              <div className="rounded-md border border-border bg-white px-3 py-2 text-xs shadow-sm">
                <div className="font-semibold text-primary">{d.label}</div>
                <div className="font-semibold text-primary">
                  {d.delta > 0 ? "+" : ""}
                  {fmt(d.delta)} {resolvedUnit}
                </div>
                <div className="text-tertiary">
                  {t("shared.fteWaterfallChart.endOfPeriod", "Fin de période")} :{" "}
                  {fmt(d.cumulative)} {resolvedUnit}
                </div>
                {onBarClick && (
                  <div className="mt-1 text-[10px] text-tertiary">
                    {t(
                      "shared.fteWaterfallChart.clickForDetail",
                      "Cliquer pour le détail par levier"
                    )}
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
          // Le highlight par défaut de Recharts (cursor du Tooltip désactivé ci-dessus + cette
          // forme active) pouvait couvrir toute la hauteur du plot (0→domainMax) au lieu de la
          // seule barre survolée/cliquée — incohérence visuelle "parfois tout le graphe, parfois
          // juste un bout" selon où le pointeur atterrissait (y compris sur la barre `base`
          // invisible). On désactive la forme active par défaut : la couleur par `<Cell>`, le
          // curseur pointer et la bulle de valeur au-dessus de la barre suffisent comme affordance.
          activeBar={false}
        >
          {data.map((d) => (
            <Cell
              key={d.label}
              fill={d.delta < 0 ? COLOR_DOWN : d.delta > 0 ? COLOR_UP : "rgba(0,0,0,0.12)"}
            />
          ))}
          <LabelList dataKey="height" content={renderDeltaBubble} />
        </Bar>
        <ReferenceLine
          y={baseline - offset}
          stroke="rgba(0,0,0,0.35)"
          strokeWidth={1}
          label={{
            value: `${t("finance.baseline", "Baseline")} ${fmt(baseline)}`,
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
            value: `${resolvedTargetLabel} ${fmt(target)}`,
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
  downLabel,
  upLabel,
}: {
  downLabel?: string;
  upLabel?: string;
}) {
  const { t } = useTranslation();
  const resolvedDownLabel =
    downLabel ?? t("shared.fteWaterfallChart.reductionsLabel", "Réductions (suppressions)");
  const resolvedUpLabel = upLabel ?? t("chart.movementType.recruitments", "Recrutements");

  return (
    <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-secondary">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_DOWN }} />{" "}
        {resolvedDownLabel}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_UP }} />{" "}
        {resolvedUpLabel}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-0 w-4 border-t-2 border-dashed"
          style={{ borderColor: COLOR_TARGET }}
        />{" "}
        {t("chart.bar.target", "Cible")}
      </span>
    </div>
  );
}
