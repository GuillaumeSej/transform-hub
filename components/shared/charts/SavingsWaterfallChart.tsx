"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Customized,
  useXAxisScale,
  useYAxisScale,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SavingsWaterfall } from "@/lib/engine";
import { limitSegments, waterfallBars, type WaterfallBar } from "@/lib/dashboardSavings";
import {
  aggregateSegments,
  buildDrilldownEntries,
  type DrilldownStepKey,
} from "@/lib/savingsDrilldown";
import { SavingsStepDrilldownModal } from "@/components/shared/SavingsStepDrilldownModal";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { HierarchyLevelDef, HierarchyNode, ImpactNatureDef, Lever, Workstream } from "@/types";

export const WATERFALL_COLORS = {
  total: "#806659",
  up: "#2E9E6B",
  down: "#D64545",
  realized: "#FF3C47",
  remaining: "rgba(168,154,147,0.45)",
};
/** Teintes des segments d'OPEX récurrent (par nature d'impact) — famille "coût" défavorable. */
export const OPEX_SEGMENT_COLORS = [
  "#B23A48",
  "#E0707A",
  "#D9822B",
  "#8C4A5A",
  "#C9A227",
  "#9C6B6B",
];

/** Écart entre catégories (part de la bande) — sert aussi au calcul des traits de liaison. */
const BAR_GAP = 0.25;
const fmt = (v: number) => `€${Math.round(v * 10) / 10}M`;

const TOTAL_KEYS = ["initial", "target", "gross", "net"];
const MAX_LEGEND = 6;
/** Étape de détail (pop-up) associée à une barre : "net" = même détail que la cible. */
const drillStepOf = (key: string): DrilldownStepKey | null =>
  key === "gap" ? null : key === "net" ? "target" : (key as DrilldownStepKey);

/** Cascade des économies ANNUALISÉES (net) en deux groupes : planifié initial ± réactualisé −
 *  annulé = cible réactualisée (empilée réalisé / reste à faire, = graphe "Réalisation des
 *  économies"), puis sa décomposition : gain brut − OPEX récurrent (segmenté par nature) = net.
 *  Cliquable : détail par étape. */
export function SavingsWaterfallChart({
  waterfall,
  height = 340,
  oneOffGains = 0,
  levers = [],
  workstreams = [],
  geographyLevels = [],
  geographyNodes = [],
  impactNatures = [],
}: {
  waterfall: SavingsWaterfall;
  height?: number;
  /** Gains one-off (affichés à part, jamais inclus dans la cascade). */
  oneOffGains?: number;
  /** Leviers du périmètre affiché (mêmes que ceux de `waterfall`) — active le détail au clic. */
  levers?: Lever[];
  workstreams?: Pick<Workstream, "id" | "name">[];
  geographyLevels?: HierarchyLevelDef[];
  geographyNodes?: HierarchyNode[];
  impactNatures?: ImpactNatureDef[];
}) {
  const { t } = useTranslation();
  const [openStep, setOpenStep] = useState<DrilldownStepKey | null>(null);

  const labelOf = (key: string, fallback: string) => {
    switch (key) {
      case "gross":
        return t("chart.waterfall.step.gross", "Gain brut annualisé");
      case "initial":
        return t("chart.waterfall.step.initial", "Planifié initial");
      case "reforecast":
        return t("chart.waterfall.step.reforecast", "± Réactualisé");
      case "cancelled":
        return t("chart.waterfall.step.cancelled", "− Annulé");
      case "target":
        return t("chart.waterfall.step.target", "= Cible réactualisée");
      case "opexRec":
        return t("chart.waterfall.step.opexRec", "− OPEX récurrent");
      case "net":
        return t("chart.waterfall.step.net", "= Net annualisé");
      case "gap":
        return " ";
      default:
        return fallback;
    }
  };

  const natureLabels = useMemo(
    () => new Map(impactNatures.map((n) => [n.id, n.label])),
    [impactNatures]
  );
  const segments = useMemo(() => {
    const entries = buildDrilldownEntries("opexRec", levers, {
      natureLabel: (id) =>
        (id && natureLabels.get(id)) ||
        t("chart.waterfall.opex.unspecified", "Nature non précisée"),
      labels: {
        fte: t("chart.waterfall.opex.fte", "Recrutements (ETP)"),
        other: t("chart.waterfall.opex.other", "Non détaillé"),
      },
    });
    return limitSegments(
      aggregateSegments(entries),
      MAX_LEGEND,
      t("chart.waterfall.opex.others", "Autres")
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levers, natureLabels]);

  const bars = useMemo(
    () => waterfallBars(waterfall, segments).map((b) => ({ ...b, label: labelOf(b.key, b.label) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [waterfall, segments, t]
  );
  const data = useMemo(
    () =>
      bars.map((b) => {
        const row: Record<string, number | string | number[]> = { ...b, anchor: 0.001 };
        b.seg.forEach((v, i) => (row[`s${i}`] = v));
        return row;
      }),
    [bars]
  );
  const segCount = bars.find((b) => b.key === "opexRec")?.seg.length ?? 0;
  const segLabel = (i: number) =>
    segments[i]?.label ?? t("chart.waterfall.step.opexRec", "OPEX récurrent");

  if (bars.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("chart.emptyLevers", "Aucun levier à représenter.")}
      </p>
    );
  }

  const clickable = levers.length > 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onChartClick = (state: any) => {
    if (!clickable) return;
    const raw = state?.activeTooltipIndex ?? state?.activeIndex;
    const idx = typeof raw === "string" ? Number(raw) : raw;
    const bar = typeof idx === "number" && !Number.isNaN(idx) ? bars[idx] : undefined;
    const step = bar ? drillStepOf(bar.key) : null;
    if (step) setOpenStep(step);
  };

  // Valeur au-dessus de chaque barre : + vert / − rouge pour les variations, neutre pour les totaux.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderLabel = (p: any) => {
    const b = bars[p.index] as WaterfallBar | undefined;
    if (!b || b.key === "gap") return null;
    let text: string;
    let color: string = WATERFALL_COLORS.total;
    if (TOTAL_KEYS.includes(b.key)) {
      text = fmt(b.value);
    } else if (b.value === 0) {
      text = fmt(0);
    } else if (b.value > 0) {
      text = `+${fmt(b.value)}`;
      color = WATERFALL_COLORS.up;
    } else {
      text = `−${fmt(Math.abs(b.value))}`;
      color = WATERFALL_COLORS.down;
    }
    const cx = Number(p.x) + Number(p.width) / 2;
    if (b.key === "opexRec") {
      // OPEX récurrent : montant en pastille (fond blanc, contour rouge) bien lisible.
      const w = text.length * 8 + 14;
      return (
        <g>
          <rect
            x={cx - w / 2}
            y={Number(p.y) - 26}
            width={w}
            height={20}
            rx={4}
            fill="#fff"
            stroke={WATERFALL_COLORS.down}
            strokeWidth={1.5}
          />
          <text
            x={cx}
            y={Number(p.y) - 12}
            textAnchor="middle"
            fontSize={13}
            fontWeight={800}
            fill={WATERFALL_COLORS.down}
          >
            {text}
          </text>
        </g>
      );
    }
    return (
      <text
        x={cx}
        y={Number(p.y) - 6}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        fill={color}
      >
        {text}
      </text>
    );
  };

  // Traits de liaison entre barres consécutives : niveau cumulé en sortie de la barre i = niveau
  // de départ de la barre i+1 (bas de la barre pour une baisse / l'OPEX, sommet sinon). Pas de
  // liaison à travers le séparateur entre les deux groupes.
  const endLevel = (b: WaterfallBar) =>
    b.key === "opexRec" || b.down > 0 ? b.base : b.base + b.up + b.realized + b.remaining;
  const Connectors = () => {
    const xScale = useXAxisScale();
    const yScale = useYAxisScale();
    if (!xScale || !yScale) return null;
    const bw = (xScale as unknown as { bandwidth?: () => number }).bandwidth;
    const band = typeof bw === "function" ? bw.call(xScale) : 0;
    const half = band * (1 - BAR_GAP) * 0.5;
    return (
      <g>
        {bars.slice(0, -1).map((b, i) => {
          const next = bars[i + 1];
          if (b.key === "gap" || next.key === "gap") return null;
          const y = (yScale(endLevel(b)) as number) ?? 0;
          const x1 = ((xScale(b.label) as number) ?? 0) + band / 2 + half;
          const x2 = ((xScale(next.label) as number) ?? 0) + band / 2 - half;
          return (
            <line
              key={`${b.key}-${i}`}
              x1={x1}
              x2={x2}
              y1={y}
              y2={y}
              stroke="rgba(0,0,0,0.35)"
              strokeWidth={1}
              strokeDasharray="3 2"
            />
          );
        })}
      </g>
    );
  };

  // Montant à l'intérieur d'un segment de la cible (réalisé / reste à faire), si assez haut.
  const segLabel2 = (_kind: "realized" | "remaining", color: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function SegLabel(p: any) {
      // Recharts 3 : `p.index` ne pointe plus vers `bars` ; seule la barre "cible" porte un réalisé /
      // reste à faire > 0, on s'appuie donc sur la valeur du label.
      const v = Number(p.value);
      const h = Number(p.height);
      if (!(h >= 14) || !(v > 0)) return null;
      return (
        <text
          x={Number(p.x) + Number(p.width) / 2}
          y={Number(p.y) + h / 2 + 4}
          textAnchor="middle"
          fontSize={11}
          fontWeight={700}
          fill={color}
        >
          {fmt(v)}
        </text>
      );
    };

  return (
    <div>
      <div className="mb-2 flex flex-wrap justify-end gap-x-3 gap-y-1 text-[11px] text-secondary">
        {(
          [
            [WATERFALL_COLORS.realized, t("chart.waterfall.realized", "Réalisé")],
            [WATERFALL_COLORS.remaining, t("chart.waterfall.remaining", "Reste à faire")],
          ] as const
        ).map(([color, label]) => (
          <span key={label} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
            {label}
          </span>
        ))}
        <span
          className="inline-flex items-center gap-1 font-semibold"
          style={{ color: WATERFALL_COLORS.up }}
        >
          +
          <span className="font-normal text-secondary">
            {t("chart.waterfall.favorable", "Favorable")}
          </span>
        </span>
        <span
          className="inline-flex items-center gap-1 font-semibold"
          style={{ color: WATERFALL_COLORS.down }}
        >
          −
          <span className="font-normal text-secondary">
            {t("chart.waterfall.unfavorable", "Défavorable")}
          </span>
        </span>
        {Array.from({ length: segCount }).map((_, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: OPEX_SEGMENT_COLORS[i % OPEX_SEGMENT_COLORS.length] }}
            />
            {segCount > 1 ? `OPEX · ${segLabel(i)}` : segLabel(i)}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          barCategoryGap={`${BAR_GAP * 100}%`}
          margin={{ top: 34, right: 8, left: -16, bottom: 0 }}
          onClick={onChartClick}
          style={clickable ? { cursor: "pointer" } : undefined}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `€${v}M`}
          />
          {/* Tooltip vide : pas d'infobulle au survol, mais fournit l'index actif pour le clic. */}
          <Tooltip content={() => null} cursor={false} />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <ReferenceLine x=" " stroke="rgba(0,0,0,0.25)" strokeDasharray="4 4" />
          <Bar dataKey="up" stackId="w" isAnimationActive={false}>
            {bars.map((b, i) => (
              <Cell
                key={`${b.key}-${i}`}
                fill={TOTAL_KEYS.includes(b.key) ? WATERFALL_COLORS.total : WATERFALL_COLORS.up}
              />
            ))}
          </Bar>
          <Bar dataKey="down" stackId="w" fill={WATERFALL_COLORS.down} isAnimationActive={false} />
          <Bar
            dataKey="realized"
            stackId="w"
            fill={WATERFALL_COLORS.realized}
            isAnimationActive={false}
          >
            <LabelList dataKey="realized" content={segLabel2("realized", "#fff")} />
          </Bar>
          <Bar
            dataKey="remaining"
            stackId="w"
            fill={WATERFALL_COLORS.remaining}
            isAnimationActive={false}
          >
            <LabelList dataKey="remaining" content={segLabel2("remaining", "#1A1A1A")} />
          </Bar>
          {Array.from({ length: segCount }).map((_, i) => (
            <Bar
              key={i}
              dataKey={`s${i}`}
              stackId="w"
              fill={OPEX_SEGMENT_COLORS[i % OPEX_SEGMENT_COLORS.length]}
              isAnimationActive={false}
            />
          ))}
          {/* Ancre de hauteur nulle au sommet de chaque pile : porte l'étiquette de valeur. */}
          <Bar dataKey="anchor" stackId="w" fill="transparent" isAnimationActive={false}>
            <LabelList dataKey="anchor" content={renderLabel} />
          </Bar>
          <Customized component={Connectors} />
        </BarChart>
      </ResponsiveContainer>
      {(oneOffGains > 0 || clickable) && (
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] text-tertiary">
          <span>
            {oneOffGains > 0 &&
              `${t("chart.waterfall.oneOff", "Gains ponctuels (hors totaux)")} : ${fmt(oneOffGains)}`}
          </span>
          {clickable && <span>{t("chart.clickForDetails", "Cliquer pour plus de détails")}</span>}
        </div>
      )}
      {openStep && (
        <SavingsStepDrilldownModal
          step={openStep}
          stepLabel={labelOf(openStep, openStep)}
          onClose={() => setOpenStep(null)}
          levers={levers}
          workstreams={workstreams}
          geographyLevels={geographyLevels}
          geographyNodes={geographyNodes}
          natureLabels={natureLabels}
          opexColors={OPEX_SEGMENT_COLORS}
        />
      )}
    </div>
  );
}
