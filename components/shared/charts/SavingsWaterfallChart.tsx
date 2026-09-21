"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SavingsWaterfall } from "@/lib/engine";
import { waterfallBars, type WaterfallBar } from "@/lib/dashboardSavings";
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

const fmt = (v: number) => `€${Math.round(v * 10) / 10}M`;

/** Cascade des économies ANNUALISÉES : gain brut -> OPEX récurrent (segmenté par
 *  nature) -> net réactualisé = cible (empilé réalisé / reste à faire, = graphe "Réalisation des
 *  économies"). Cliquable : détail par étape. */
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
        return t("chart.waterfall.step.initial", "Planifié initial (annualisé)");
      case "reforecast":
        return t("chart.waterfall.step.reforecast", "Réactualisé (annualisé)");
      case "cancelled":
        return t("chart.waterfall.step.cancelled", "Annulé");
      case "target":
        return t("chart.waterfall.step.target", "Net réactualisé (cible)");
      case "opexRec":
        return t("chart.waterfall.step.opexRec", "OPEX récurrent");
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
    return aggregateSegments(entries);
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
        const row: Record<string, number | string | number[]> = { ...b, anchor: 0 };
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
    if (bar) setOpenStep(bar.key as DrilldownStepKey);
  };

  // Valeur au-dessus de chaque barre : + vert / − rouge pour les variations, neutre pour les totaux.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderLabel = (p: any) => {
    const b = bars[p.index] as WaterfallBar | undefined;
    if (!b) return null;
    let text: string;
    let color: string = WATERFALL_COLORS.total;
    if (b.key === "gross" || b.key === "target") {
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
    return (
      <text
        x={Number(p.x) + Number(p.width) / 2}
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const b = payload[0].payload as WaterfallBar;
    const signed =
      b.key === "gross" || b.key === "target"
        ? fmt(b.value)
        : `${b.value >= 0 ? "+" : "−"}${fmt(Math.abs(b.value))}`;
    return (
      <div className="rounded-md border border-border bg-white px-3 py-2 text-xs shadow-lg">
        <div className="font-semibold text-primary">{b.label}</div>
        <div className="text-secondary">{signed}</div>
        {b.key === "target" && (
          <>
            <div className="text-secondary">
              {t("chart.waterfall.realized", "Réalisé")} : {fmt(b.realized)}
            </div>
            <div className="text-secondary">
              {t("chart.waterfall.remaining", "Reste à faire")} : {fmt(b.remaining)}
            </div>
          </>
        )}
        {b.key === "opexRec" &&
          b.seg.length > 1 &&
          b.seg.map((v, i) => (
            <div key={i} className="text-secondary">
              {segLabel(i)} : −{fmt(v)}
            </div>
          ))}
        {clickable && (
          <div className="mt-1 text-[10px] text-tertiary">
            {t("chart.waterfall.clickHint", "Cliquer pour le détail")}
          </div>
        )}
      </div>
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
          margin={{ top: 22, right: 8, left: -16, bottom: 0 }}
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
          <Tooltip content={tooltip} cursor={clickable ? { fill: "rgba(0,0,0,0.04)" } : false} />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="up" stackId="w" isAnimationActive={false}>
            {bars.map((b) => (
              <Cell
                key={b.key}
                fill={b.key === "gross" ? WATERFALL_COLORS.total : WATERFALL_COLORS.up}
              />
            ))}
          </Bar>
          <Bar dataKey="down" stackId="w" fill={WATERFALL_COLORS.down} isAnimationActive={false} />
          <Bar
            dataKey="realized"
            stackId="w"
            fill={WATERFALL_COLORS.realized}
            isAnimationActive={false}
          />
          <Bar
            dataKey="remaining"
            stackId="w"
            fill={WATERFALL_COLORS.remaining}
            isAnimationActive={false}
          />
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
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-2 text-[11px] text-tertiary">
        {t(
          "chart.waterfall.note",
          "Net annualisé = gain brut − OPEX récurrent (le CAPEX et les coûts ponctuels sont suivis à part). Net réactualisé = réalisé + reste à faire (identique au graphe « Réalisation des économies »). Leviers annulés exclus des totaux."
        )}
        {oneOffGains > 0 &&
          ` ${t("chart.waterfall.oneOff", "Gains ponctuels (hors totaux)")} : ${fmt(oneOffGains)}.`}
        {clickable &&
          ` ${t("chart.waterfall.clickHintLong", "Cliquez sur une barre pour voir le détail.")}`}
      </p>
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
