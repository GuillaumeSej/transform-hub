"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { BudgetDonutChart } from "@/components/shared/charts/BudgetDonutChart";
import { GranularityToggle } from "@/components/shared/GranularityToggle";
import { InvestVsSavingsModal } from "@/components/finance/InvestVsSavingsModal";
import { CostDrilldownModal } from "@/components/finance/CostDrilldownModal";
import { useTranslation } from "@/lib/i18n/useTranslation";
import * as engine from "@/lib/engine";
import {
  bucketCostsByPeriod,
  bucketInvestVsSavingsByPeriod,
  costRowsForPeriod,
  costsByHierarchyNode,
  investVsSavingsRowsForPeriod,
  groupCostsByWorkstream,
  investCostRowsBySegment,
  isInvestNature,
  sortedHierarchyLevels,
  type FinanceGranularity,
  type HierarchyCostSlice,
} from "@/lib/financeCosts";
import type { BeTrackData, HierarchyLevelDef, HierarchyNode } from "@/types";

/** 4 graphiques de suivi des coûts du module Finance — TOUTES les données proviennent de
 *  `data.levers[].actions[].impacts[]` via `lib/financeCosts.ts` (aucune donnée en dur). CAPEX +
 *  OPEX one-off ("Invest") sont distingués de l'OPEX récurrent partout où c'est pertinent (a/d),
 *  et chaque graphique cliquable ouvre `CostDrilldownModal` (workstream → levier → fiche levier).
 *  Inspirés des patterns déjà en place côté RH (`HrBreakdownCharts.tsx`, sélecteur
 *  mois/trimestre/année) et dashboard exécutif (`QuarterlyBridgeChart`, `BudgetDonutChart`). */

/** #1 — Coûts Invest (CAPEX + OPEX one-off) déjà engagés vs à venir. Même logique de drill-down
 *  en place que `CostByHierarchyChart` ci-dessous : un premier clic (engagé/à venir) redessine LE
 *  MÊME donut en répartition par chantier (workstream), avec un bouton retour ; un second clic sur
 *  un chantier ouvre `CostDrilldownModal` directement sur SES leviers/actions (`initialWsId`), sans
 *  repasser par la liste des chantiers que le donut vient déjà de montrer. */
export function CostEngagedVsUpcomingChart({ data }: { data: BeTrackData }) {
  const { t } = useTranslation();
  const [segment, setSegment] = useState<"engaged" | "upcoming" | null>(null);
  const [selectedWsId, setSelectedWsId] = useState<string | null>(null);

  const split = useMemo(() => {
    const engagedRows = investCostRowsBySegment(data, true).map((r) => ({
      lever: r.lever,
      amount: r.impact.amount,
    }));
    const upcomingRows = investCostRowsBySegment(data, false).map((r) => ({
      lever: r.lever,
      amount: r.impact.amount,
    }));
    const engaged = round2(engagedRows.reduce((s, r) => s + r.amount, 0));
    const upcoming = round2(upcomingRows.reduce((s, r) => s + r.amount, 0));
    return { engagedRows, upcomingRows, engaged, upcoming, total: round2(engaged + upcoming) };
  }, [data]);

  const groups = useMemo(() => {
    if (!segment) return [];
    const rows = segment === "engaged" ? split.engagedRows : split.upcomingRows;
    return groupCostsByWorkstream(rows, data.workstreams);
  }, [segment, split, data.workstreams]);

  const engagedLabel = t("finance.chart.engaged", "Déjà engagé");
  const upcomingLabel = t("finance.chart.upcoming", "À venir");
  const segmentLabel = segment === "engaged" ? engagedLabel : upcomingLabel;
  const segmentAmount = segment === "engaged" ? split.engaged : split.upcoming;

  return (
    <Card>
      <CardHeader
        title={t("finance.chart.engagedTitle", "Coûts engagés vs à venir")}
        actions={
          segment ? (
            <button
              type="button"
              onClick={() => setSegment(null)}
              className="flex items-center gap-1 text-[11px] font-semibold text-secondary hover:text-primary"
            >
              <ChevronLeft size={14} />
              {engagedLabel} / {upcomingLabel}
            </button>
          ) : undefined
        }
      />
      <CardBody>
        {split.total === 0 ? (
          <EmptyState />
        ) : (
          <>
            {segment && (
              <p className="mb-2 text-[12px] font-semibold text-primary">
                {segmentLabel} · {engine.fmtCurr(segmentAmount)}
              </p>
            )}
            {!segment ? (
              <BudgetDonutChart
                data={[
                  { name: engagedLabel, value: split.engaged },
                  { name: upcomingLabel, value: split.upcoming },
                ]}
                formatValue={(v) => engine.fmtCurr(v)}
                centerLabel={t("finance.chart.totalCost", "Coût total")}
                onSliceClick={(name) => setSegment(name === engagedLabel ? "engaged" : "upcoming")}
              />
            ) : groups.length === 0 ? (
              <EmptyState />
            ) : (
              <BudgetDonutChart
                data={groups.map((g) => ({ name: g.wsName, value: g.amount }))}
                formatValue={(v) => engine.fmtCurr(v)}
                centerLabel={t("finance.chart.byWorkstream", "Par chantier")}
                onSliceClick={(name) => {
                  const group = groups.find((g) => g.wsName === name);
                  if (group) setSelectedWsId(group.wsId);
                }}
              />
            )}
          </>
        )}
      </CardBody>
      <CostDrilldownModal
        open={selectedWsId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedWsId(null);
        }}
        title={segmentLabel}
        groups={groups}
        initialWsId={selectedWsId}
        formatValue={(v) => engine.fmtCurr(v)}
      />
    </Card>
  );
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** #2 — Engagement des coûts Invest (CAPEX + OPEX one-off) dans le temps, toggle
 *  mensuel/trimestriel/annuel, barre cliquable (drill-down par workstream/levier). */
export function CostCommitmentTimelineChart({ data }: { data: BeTrackData }) {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<FinanceGranularity>("quarter");
  const points = useMemo(
    () => bucketCostsByPeriod(data, granularity, isInvestNature),
    [data, granularity]
  );
  const [selectedPeriod, setSelectedPeriod] = useState<{ key: string; label: string } | null>(null);

  const groups = useMemo(() => {
    if (!selectedPeriod) return [];
    const rows = costRowsForPeriod(data, granularity, selectedPeriod.key, isInvestNature);
    return groupCostsByWorkstream(rows, data.workstreams);
  }, [selectedPeriod, data, granularity]);

  return (
    <Card>
      <CardHeader
        title={t("finance.chart.timelineTitle", "Engagement des coûts dans le temps (Invest)")}
        actions={<GranularityToggle value={granularity} onChange={setGranularity} />}
      />
      <CardBody>
        {points.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={points} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `€${v}M`}
              />
              <Tooltip formatter={(value) => `€${value}M`} />
              <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="delta"
                name={t("finance.chart.periodCost", "Coût de la période")}
                fill="#FF3C47"
                radius={[3, 3, 0, 0]}
                cursor="pointer"
                onClick={(entry) => {
                  const p = entry as unknown as { sortKey?: string; period?: string };
                  if (p.sortKey)
                    setSelectedPeriod({ key: p.sortKey, label: p.period ?? p.sortKey });
                }}
              />
              <Line
                type="monotone"
                dataKey="cumulative"
                name={t("finance.chart.cumulativeCost", "Coût cumulé")}
                stroke="#806659"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardBody>
      <CostDrilldownModal
        open={selectedPeriod !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedPeriod(null);
        }}
        title={selectedPeriod?.label ?? ""}
        groups={groups}
        formatValue={(v) => engine.fmtCurr(v)}
      />
    </Card>
  );
}

/** #3 — Répartition des coûts par centre de coût / P&L, branchée sur l'arborescence financière de
 *  l'entreprise (`Company.hierarchyLevels` + `HierarchyNode`, voir lib/financeCosts.ts). Un seul
 *  donut : il affiche d'abord la maille la plus macro (`order` le plus petit), un clic sur une
 *  part descend d'un niveau ; à la maille la plus fine, un clic supplémentaire ouvre la
 *  décomposition par workstream → levier (même `CostDrilldownModal` que les autres graphiques). */
export function CostByHierarchyChart({
  data,
  hierarchyLevels,
  hierarchyNodes,
}: {
  data: BeTrackData;
  hierarchyLevels: HierarchyLevelDef[];
  hierarchyNodes: HierarchyNode[];
}) {
  const { t } = useTranslation();
  const levels = useMemo(() => sortedHierarchyLevels(hierarchyLevels), [hierarchyLevels]);
  const [drillPath, setDrillPath] = useState<
    { levelKey: string; parentId: string | null; label: string }[]
  >([]);
  const [leafSlice, setLeafSlice] = useState<HierarchyCostSlice | null>(null);

  // Réinitialise le drill-down si la config d'arborescence change (ex. changement d'entreprise).
  const currentLevelKey = levels[drillPath.length]?.key ?? levels[0]?.key;
  const currentParentId = drillPath.length > 0 ? drillPath[drillPath.length - 1].parentId : null;

  const slices = useMemo(() => {
    if (!currentLevelKey) return [];
    return costsByHierarchyNode(data, hierarchyNodes, currentLevelKey, currentParentId);
  }, [data, hierarchyNodes, currentLevelKey, currentParentId]);

  const groups = useMemo(() => {
    if (!leafSlice) return [];
    return groupCostsByWorkstream(leafSlice.rows, data.workstreams);
  }, [leafSlice, data.workstreams]);

  if (levels.length === 0) {
    return (
      <Card>
        <CardHeader
          title={t(
            "finance.chart.hierarchyTitle",
            "Répartition des coûts par centre de coût / P&L"
          )}
        />
        <CardBody>
          <p className="py-10 text-center text-sm text-tertiary">
            {t(
              "finance.chart.hierarchyNoConfig",
              "Aucune arborescence financière n'est configurée pour cette entreprise."
            )}
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={t("finance.chart.hierarchyTitle", "Répartition des coûts par centre de coût / P&L")}
        actions={
          drillPath.length > 0 ? (
            <button
              type="button"
              onClick={() => setDrillPath((p) => p.slice(0, -1))}
              className="flex items-center gap-1 text-[11px] font-semibold text-secondary hover:text-primary"
            >
              <ChevronLeft size={14} />
              {drillPath[drillPath.length - 1]?.label}
            </button>
          ) : undefined
        }
      />
      <CardBody>
        <HierarchyLevelBreadcrumb levels={levels} currentIndex={drillPath.length} />
        {slices.length === 0 ? (
          <EmptyState />
        ) : (
          <BudgetDonutChart
            data={slices.map((s) => ({ name: s.node.label, value: s.amount }))}
            formatValue={(v) => engine.fmtCurr(v)}
            centerLabel={levels[drillPath.length]?.label ?? levels[0]?.label}
            onSliceClick={(name) => {
              const slice = slices.find((s) => s.node.label === name);
              if (!slice) return;
              if (slice.hasChildren && drillPath.length < levels.length - 1) {
                setDrillPath((p) => [
                  ...p,
                  { levelKey: currentLevelKey!, parentId: slice.node.id, label: slice.node.label },
                ]);
              } else {
                setLeafSlice(slice);
              }
            }}
          />
        )}
      </CardBody>
      <CostDrilldownModal
        open={leafSlice !== null}
        onOpenChange={(open) => {
          if (!open) setLeafSlice(null);
        }}
        title={leafSlice?.node.label ?? ""}
        groups={groups}
        formatValue={(v) => engine.fmtCurr(v)}
      />
    </Card>
  );
}

/** Repère "à quel niveau de l'arborescence financière suis-je ?" pour le donut de répartition des
 *  coûts ci-dessus : liste tous les niveaux configurés (`HierarchyLevelDef[]`, dans l'ordre),
 *  reliés par des chevrons, avec le niveau courant mis en évidence (pastille sombre) — le reste en
 *  gris neutre. Purement informatif (le drill-down se fait toujours en cliquant une part du donut
 *  ou via le bouton retour du CardHeader) : évite de dupliquer un sélecteur existant. */
function HierarchyLevelBreadcrumb({
  levels,
  currentIndex,
}: {
  levels: HierarchyLevelDef[];
  currentIndex: number;
}) {
  if (levels.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1">
      {levels.map((level, index) => (
        <span key={level.key} className="flex items-center gap-1">
          {index > 0 && <ChevronRight size={12} className="text-tertiary" />}
          <span
            className={
              index === currentIndex
                ? "rounded-full bg-black px-2 py-0.5 text-[10.5px] font-semibold text-white"
                : "rounded-full px-2 py-0.5 text-[10.5px] font-medium text-tertiary"
            }
          >
            {level.label}
          </span>
        </span>
      ))}
    </div>
  );
}

// Palette de marque (voir app/globals.css — "la marque interdit vert/orange/bleu") : le résultat
// net d'une période négative (investissement pas encore compensé) est en rouge BearingPoint,
// positif (gains nets > investissement de la période) en taupe foncé — jamais en vert littéral,
// même si le graphique "économie positive/négative" qui a inspiré cette maquette en utilisait.
const COLOR_NEGATIVE = "#FF3C47";
const COLOR_POSITIVE = "#806659";
const COLOR_CUMULATIVE = "#0a0a0a";

/** #4 — "Coût d'investissement vs Savings" : une barre signée par période (négative tant que le
 *  CAPEX/OPEX one-off de la période domine, positive dès que les gains nets le dépassent) + une
 *  courbe de cumul qui matérialise le breakeven (le point où elle repasse au-dessus de 0),
 *  tooltip détaillé au survol (décomposition investCost/grossSavings/opexRecStarted/netSavings). */
export function InvestVsSavingsChart({ data }: { data: BeTrackData }) {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<FinanceGranularity>("quarter");
  const [selected, setSelected] = useState<{ key: string; label: string } | null>(null);
  const points = useMemo(
    () =>
      bucketInvestVsSavingsByPeriod(data, granularity).map((p) => ({
        ...p,
        negOpex: -p.opexRecStarted,
        negInvest: -p.investCost,
      })),
    [data, granularity]
  );
  const rows = useMemo(
    () => (selected ? investVsSavingsRowsForPeriod(data, granularity, selected.key) : []),
    [selected, data, granularity]
  );
  const open = (p: { sortKey?: string; period?: string } | undefined) => {
    if (p?.sortKey) setSelected({ key: p.sortKey, label: p.period ?? p.sortKey });
  };
  const gainsLabel = t("finance.chart.grossSavings", "Gains bruts");
  const opexLabel = t("finance.chart.opexRecShort", "OPEX récurrent");
  const investLabel = t("finance.chart.investCost", "Coût d'investissement");
  const netNegLabel = t("finance.chart.netNegative", "Économie négative");
  const netLabel = t("finance.chart.netPeriodShort", "Économie nette");
  const cumLabel = t("finance.chart.netCumulative", "Cumul net");

  return (
    <Card>
      <CardHeader
        title={t("finance.chart.investVsSavingsTitle", "Coût d'investissement vs Savings")}
        actions={<GranularityToggle value={granularity} onChange={setGranularity} />}
      />
      <CardBody>
        {points.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart
              data={points}
              stackOffset="sign"
              margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
              style={{ cursor: "pointer" }}
              onClick={(state) => {
                const payload = (
                  state as { activePayload?: { payload: (typeof points)[number] }[] }
                )?.activePayload?.[0]?.payload;
                open(payload);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `€${v}M`}
              />
              <ReferenceLine y={0} stroke="rgba(0,0,0,0.2)" />
              <Tooltip content={<InvestVsSavingsTooltip />} />
              <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="grossSavings" name={gainsLabel} stackId="s" fill={COLOR_POSITIVE} />
              <Bar dataKey="negOpex" name={opexLabel} stackId="s" fill="#B08A75" />
              <Bar dataKey="negInvest" name={investLabel} stackId="s" fill={COLOR_NEGATIVE} />
              <Line
                type="monotone"
                dataKey="netPeriodResult"
                name={netLabel}
                stroke="#a3a3a3"
                strokeWidth={1}
                strokeDasharray="4 3"
                dot={(props: {
                  cx?: number;
                  cy?: number;
                  payload?: { netPeriodResult: number; sortKey: string };
                }) => {
                  const { cx, cy, payload } = props;
                  const neg = (payload?.netPeriodResult ?? 0) < 0;
                  return (
                    <circle
                      key={payload?.sortKey}
                      cx={cx}
                      cy={cy}
                      r={neg ? 6 : 4}
                      fill={neg ? COLOR_NEGATIVE : COLOR_POSITIVE}
                      stroke="#fff"
                      strokeWidth={1.5}
                    />
                  );
                }}
                legendType="none"
              />
              <Line
                type="monotone"
                dataKey="netCumulative"
                name={cumLabel}
                stroke={COLOR_CUMULATIVE}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
        {points.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-[11px] text-secondary">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: COLOR_POSITIVE }}
              />
              {t("finance.chart.netPositive", "Économie positive")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: COLOR_NEGATIVE }}
              />
              {netNegLabel}
            </span>
          </div>
        )}
      </CardBody>
      <InvestVsSavingsModal
        open={selected !== null}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
        title={`${t("finance.chart.investVsSavingsTitle", "Coût d'investissement vs Savings")} — ${selected?.label ?? ""}`}
        rows={rows}
        workstreams={data.workstreams}
        formatValue={(v) => engine.fmtCurr(v)}
      />
    </Card>
  );
}

type InvestVsSavingsTooltipPayload = {
  payload: {
    period: string;
    investCost: number;
    grossSavings: number;
    opexRecStarted: number;
    netSavings: number;
    netPeriodResult: number;
    netCumulative: number;
  };
}[];

function InvestVsSavingsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: InvestVsSavingsTooltipPayload;
}) {
  const { t } = useTranslation();
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-sm">
      <p className="text-[12px] font-semibold text-primary">{d.period}</p>
      <p className="mt-1 text-[12px] text-secondary">
        {t("finance.chart.grossSavings", "Gains bruts")} : {engine.fmtCurr(d.grossSavings)}
      </p>
      <p className="mt-0.5 text-[12px] text-secondary">
        − {t("finance.chart.opexRecRunRate", "OPEX récurrent démarré")} :{" "}
        {engine.fmtCurr(d.opexRecStarted)}
      </p>
      <p className="mt-0.5 text-[12px] text-secondary">
        = {t("finance.chart.netSavings", "Gains nets")} : {engine.fmtCurr(d.netSavings)}
      </p>
      <p className="mt-0.5 text-[12px] text-secondary">
        − {t("finance.chart.investCost", "Coût d'investissement")} : {engine.fmtCurr(d.investCost)}
      </p>
      <p className="mt-0.5 text-[12px] font-semibold text-primary">
        = {t("finance.chart.netPeriodResult", "Résultat net de la période")} :{" "}
        {engine.fmtCurr(d.netPeriodResult)}
      </p>
      <p className="mt-0.5 text-[12px] text-tertiary">
        {t("finance.chart.netCumulative", "Cumul net")} : {engine.fmtCurr(d.netCumulative)}
      </p>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <p className="py-10 text-center text-sm text-tertiary">
      {t("finance.chart.empty", "Aucun coût saisi sur les actions des leviers.")}
    </p>
  );
}
