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
import { ChartHoverArea, FloatingPreview, HIDDEN_TOOLTIP_WRAPPER } from "./HoverPreview";
import { topContributors, waterfallStepSummary, type PreviewContributor } from "@/lib/chartPreview";
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
import { formatMillions } from "@/lib/format";

export const WATERFALL_COLORS = {
  total: "#806659",
  // Charte : hausse = violet (même convention que les waterfalls ETP `FteWaterfallChart`), baisse =
  // rouge brique (distinct du corail "réalisé"), reste à faire = taupe chaud translucide.
  up: "#421799",
  down: "#991D1F",
  realized: "#FF3C47",
  remaining: "rgba(169,158,154,0.45)",
};
/** Teintes des segments d'OPEX récurrent (par nature d'impact) — famille "coût" défavorable. */
export const OPEX_SEGMENT_COLORS = [
  "#991D1F",
  "#FF797B",
  "#320300",
  "#FFB1B5",
  "#806659",
  "#A99E9A",
];

/** Écart entre catégories (part de la bande) — sert aussi au calcul des traits de liaison. */
const BAR_GAP = 0.15;
const fmt = (v: number) => formatMillions(v);

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
        return t("chart.waterfall.step.opexRec", "− OPEX récurrent annuel");
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
        // Barre "OPEX récurrent" : un seul bloc uni (montant total), pas de détail par nature —
        // ce détail reste disponible dans le popup au clic (SavingsStepDrilldownModal).
        row.opexTotal = b.seg.reduce((s, v) => s + v, 0);
        return row;
      }),
    [bars]
  );

  // Aperçu au survol : principaux leviers de chaque étape, MÊMES entrées que le détail au clic
  // (`buildDrilldownEntries`, SavingsStepDrilldownModal), calculées à la demande et mises en cache.
  const stepContributors = useMemo(() => {
    const cache = new Map<DrilldownStepKey, PreviewContributor[]>();
    return (step: DrilldownStepKey) => {
      const hit = cache.get(step);
      if (hit) return hit;
      const list = topContributors(
        buildDrilldownEntries(step, levers).map((e) => ({
          id: e.leverId,
          name: e.name,
          value: e.value,
        }))
      );
      cache.set(step, list);
      return list;
    };
  }, [levers]);

  if (bars.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("chart.emptyLevers", "Aucun levier à représenter.")}
      </p>
    );
  }

  const clickable = levers.length > 0;
  // Liseré discret permanent : signale les barres cliquables.
  const outline = clickable ? { stroke: "rgba(0,0,0,0.22)", strokeWidth: 1 } : {};
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
    // Recharts 3 : `useXAxisScale` ne renvoie que `scale.map` (une fonction nue), sans
    // `.bandwidth()` — on dérive donc la largeur de bande de l'écart entre deux catégories
    // consécutives (espacement uniforme), seule façon fiable d'obtenir la vraie largeur de bande.
    const positions = bars.map((b) => (xScale(b.label) as number) ?? 0);
    const band = bars.length > 1 ? Math.abs(positions[1] - positions[0]) : 0;
    // Recharts : marge de `BAR_GAP` × bande de chaque côté de la barre.
    const half = band * (1 - 2 * BAR_GAP) * 0.5;
    return (
      <g>
        {bars.slice(0, -1).map((b, i) => {
          const next = bars[i + 1];
          if (b.key === "gap" || next.key === "gap") return null;
          const y = (yScale(endLevel(b)) as number) ?? 0;
          const x1 = positions[i] + band / 2 + half;
          const x2 = positions[i + 1] + band / 2 - half;
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
    <div className={clickable ? "wf-clickable" : undefined}>
      {clickable && (
        <style>{`
          .wf-clickable .recharts-bar-rectangle { cursor: pointer; transition: filter .12s; }
          .wf-clickable .recharts-bar-rectangle:hover { filter: brightness(1.15) saturate(1.1); }
        `}</style>
      )}
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
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: WATERFALL_COLORS.down }}
          />
          {t("chart.waterfall.step.opexRec", "− OPEX récurrent annuel")}
        </span>
      </div>
      <ChartHoverArea>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={data}
            barCategoryGap={`${BAR_GAP * 100}%`}
            margin={{ top: 34, right: 8, left: -16, bottom: 0 }}
            onClick={onChartClick}
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
              tickFormatter={(v) => formatMillions(Number(v))}
            />
            {/* Aperçu au survol (retour PO) : montant, part, cumul avant → après et principaux
                leviers de l'étape ; fournit aussi l'index actif pour le clic (détail). */}
            <Tooltip
              cursor={false}
              wrapperStyle={HIDDEN_TOOLTIP_WRAPPER}
              content={({ active, payload }) => {
                const key = (payload?.[0]?.payload as WaterfallBar | undefined)?.key;
                const bar = key ? bars.find((b) => b.key === key) : undefined;
                if (!active || !bar || bar.key === "gap") return null;
                const step = drillStepOf(bar.key);
                return (
                  <FloatingPreview>
                    <WaterfallStepPreview
                      label={bar.label.replace(/^[=±−+]\s*/, "")}
                      stepKey={bar.key}
                      waterfall={waterfall}
                      contributors={clickable && step ? stepContributors(step) : []}
                      clickable={clickable && !!step}
                    />
                  </FloatingPreview>
                );
              }}
            />
            <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
            <ReferenceLine x=" " stroke="rgba(0,0,0,0.25)" strokeDasharray="4 4" />
            <Bar dataKey="up" stackId="w" isAnimationActive={false} {...outline}>
              {bars.map((b, i) => (
                <Cell
                  key={`${b.key}-${i}`}
                  fill={TOTAL_KEYS.includes(b.key) ? WATERFALL_COLORS.total : WATERFALL_COLORS.up}
                />
              ))}
            </Bar>
            <Bar
              dataKey="down"
              stackId="w"
              fill={WATERFALL_COLORS.down}
              isAnimationActive={false}
              {...outline}
            />
            <Bar
              dataKey="realized"
              stackId="w"
              fill={WATERFALL_COLORS.realized}
              isAnimationActive={false}
              {...outline}
            >
              <LabelList dataKey="realized" content={segLabel2("realized", "#fff")} />
            </Bar>
            <Bar
              dataKey="remaining"
              stackId="w"
              fill={WATERFALL_COLORS.remaining}
              isAnimationActive={false}
              {...outline}
            >
              <LabelList dataKey="remaining" content={segLabel2("remaining", "#1A1A1A")} />
            </Bar>
            {/* OPEX récurrent : un seul bloc uni dans le graphique (le détail par nature reste
                disponible dans le popup au clic, cf. SavingsStepDrilldownModal). */}
            <Bar
              dataKey="opexTotal"
              stackId="w"
              fill={WATERFALL_COLORS.down}
              isAnimationActive={false}
              {...outline}
            />
            {/* Ancre de hauteur nulle au sommet de chaque pile : porte l'étiquette de valeur. */}
            <Bar dataKey="anchor" stackId="w" fill="transparent" isAnimationActive={false}>
              <LabelList dataKey="anchor" content={renderLabel} />
            </Bar>
            <Customized component={Connectors} />
          </BarChart>
        </ResponsiveContainer>
      </ChartHoverArea>
      {oneOffGains > 0 && (
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] text-tertiary">
          <span>
            {oneOffGains > 0 &&
              `${t("chart.waterfall.oneOff", "Gains ponctuels (hors totaux)")} : ${fmt(oneOffGains)}`}
          </span>
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

const signedM = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v))}`;

/** Aperçu au survol d'une étape de la cascade (même carte que `SCurvePreview`) : montant, part du
 *  total de référence du groupe, cumul avant → après (étapes de variation) ou réalisé / reste à
 *  faire (cible), mini-comparaison et principaux leviers de l'étape. Le clic ouvre le détail. */
function WaterfallStepPreview({
  label,
  stepKey,
  waterfall,
  contributors,
  clickable,
}: {
  label: string;
  stepKey: string;
  waterfall: SavingsWaterfall;
  contributors: PreviewContributor[];
  clickable: boolean;
}) {
  const { t } = useTranslation();
  const s = waterfallStepSummary(waterfall, stepKey);
  if (!s) return null;
  const isTarget = stepKey === "target" || stepKey === "net";
  const valueClass = (v: number) =>
    v < 0 ? "font-semibold tabular-nums text-bp-coral" : "font-semibold tabular-nums text-primary";
  const row = (swatch: string, text: string, value: string, cls = valueClass(0)) => (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-secondary">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: swatch }} />
        {text}
      </span>
      <span className={cls}>{value}</span>
    </div>
  );
  const pct = (v: number) => `${v < 0 ? "−" : ""}${Math.round(Math.abs(v) * 1000) / 10} %`;
  const max = Math.max(Math.abs(s.before ?? 0), Math.abs(s.after), 1e-9);
  const width = (v: number, m = max) => `${Math.max(2, Math.min(100, (Math.abs(v) / m) * 100))}%`;
  return (
    <div className="w-[260px] border border-border bg-white p-3 text-[11.5px] shadow-lg">
      <div className="mb-2 text-[12.5px] font-bold text-primary">{label}</div>
      <div className="space-y-1">
        {row(
          s.kind === "total"
            ? WATERFALL_COLORS.total
            : s.value < 0
              ? WATERFALL_COLORS.down
              : WATERFALL_COLORS.up,
          s.kind === "total"
            ? t("chart.waterfallPreview.amount", "Montant")
            : t("chart.waterfallPreview.variation", "Variation"),
          s.kind === "total" ? fmt(s.value) : signedM(s.value),
          s.kind === "total" ? valueClass(0) : valueClass(s.value)
        )}
        {s.share !== null && (
          <div className="flex items-center justify-between gap-4 text-secondary">
            <span>
              {s.shareBase === "gross"
                ? t("chart.waterfallPreview.shareGross", "Part du gain brut")
                : t("chart.waterfallPreview.shareInitial", "Part du planifié initial")}
            </span>
            <span className="tabular-nums">{pct(s.share)}</span>
          </div>
        )}
      </div>
      {s.before !== null ? (
        <div className="mt-2.5 border-t border-border pt-2">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-primary">
              {t("chart.waterfallPreview.cumulative", "Cumul avant → après")}
            </span>
            <span className="font-semibold tabular-nums text-primary">
              {fmt(s.before)} → {fmt(s.after)}
            </span>
          </div>
          <div className="mt-1.5 space-y-1">
            <div className="h-1.5 bg-neutral-100">
              <div className="h-full bg-bp-warm-brown/60" style={{ width: width(s.before) }} />
            </div>
            <div className="h-1.5 bg-neutral-100">
              <div
                className={s.value < 0 ? "h-full bg-bp-coral" : "h-full bg-bp-deep-red/70"}
                style={{ width: width(s.after) }}
              />
            </div>
          </div>
        </div>
      ) : isTarget && waterfall.target > 0 ? (
        <div className="mt-2.5 space-y-1 border-t border-border pt-2">
          {row(
            WATERFALL_COLORS.realized,
            t("chart.waterfall.realized", "Réalisé"),
            fmt(waterfall.realized)
          )}
          {row(
            WATERFALL_COLORS.remaining,
            t("chart.waterfall.remaining", "Reste à faire"),
            fmt(waterfall.remaining)
          )}
          <div className="h-1.5 bg-neutral-100">
            <div
              className="h-full bg-bp-coral"
              style={{ width: width(waterfall.realized, Math.abs(waterfall.target)) }}
            />
          </div>
        </div>
      ) : null}
      {contributors.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
            {t("chart.waterfallPreview.topLevers", "Principaux leviers")}
          </div>
          <div className="space-y-0.5">
            {contributors.map((c) => (
              <div key={c.id} className="flex justify-between gap-3">
                <span className="truncate text-secondary">{c.name}</span>
                <span
                  className={
                    c.value < 0 ? "tabular-nums text-bp-coral" : "tabular-nums text-primary"
                  }
                >
                  {s.kind === "total" ? fmt(c.value) : signedM(c.value)}
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
