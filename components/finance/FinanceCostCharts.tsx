"use client";

import { useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { BudgetDonutChart } from "@/components/shared/charts/BudgetDonutChart";
import { GranularityToggle } from "@/components/shared/GranularityToggle";
import { CostDrilldownModal } from "@/components/finance/CostDrilldownModal";
import { useTranslation } from "@/lib/i18n/useTranslation";
import * as engine from "@/lib/engine";
import {
  bucketCostsByPeriod,
  bucketInvestVsSavingsByPeriod,
  bucketRecurrentOpexByPeriod,
  costRowsForPeriod,
  costsByHierarchyNode,
  groupCostsByWorkstream,
  investCostRowsBySegment,
  isInvestNature,
  recurrentOpexRowsForPeriod,
  sortedHierarchyLevels,
  type FinanceGranularity,
  type HierarchyCostSlice,
} from "@/lib/financeCosts";
import type { BeTrackData, HierarchyLevelDef, HierarchyNode } from "@/types";

/** 5 graphiques de suivi des coûts du module Finance — TOUTES les données proviennent de
 *  `data.levers[].actions[].impacts[]` via `lib/financeCosts.ts` (aucune donnée en dur). CAPEX +
 *  OPEX one-off ("Invest") sont distingués de l'OPEX récurrent partout où c'est pertinent (a/d),
 *  et chaque graphique cliquable ouvre `CostDrilldownModal` (workstream → levier → fiche levier).
 *  Inspirés des patterns déjà en place côté RH (`HrBreakdownCharts.tsx`, sélecteur
 *  mois/trimestre/année) et dashboard exécutif (`QuarterlyBridgeChart`, `BudgetDonutChart`). */

/** #1 — Coûts Invest (CAPEX + OPEX one-off) déjà engagés vs à venir, cliquable. */
export function CostEngagedVsUpcomingChart({ data }: { data: BeTrackData }) {
  const { t } = useTranslation();
  const [segment, setSegment] = useState<"engaged" | "upcoming" | null>(null);

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

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-col gap-0.5">
            <span>{t("finance.chart.engagedTitle", "Coûts engagés vs à venir (Invest)")}</span>
            <span className="text-[10.5px] font-normal text-tertiary">
              {t("finance.chart.engagedSubtitle", "CAPEX + OPEX one-off — OPEX récurrent exclu")}
            </span>
          </span>
        }
      />
      <CardBody>
        {split.total === 0 ? (
          <EmptyState />
        ) : (
          <BudgetDonutChart
            data={[
              { name: engagedLabel, value: split.engaged },
              { name: upcomingLabel, value: split.upcoming },
            ]}
            formatValue={(v) => engine.fmtCurr(v)}
            centerLabel={t("finance.chart.totalCost", "Coût total")}
            onSliceClick={(name) => setSegment(name === engagedLabel ? "engaged" : "upcoming")}
          />
        )}
      </CardBody>
      <CostDrilldownModal
        open={segment !== null}
        onOpenChange={(open) => {
          if (!open) setSegment(null);
        }}
        title={segment === "engaged" ? engagedLabel : upcomingLabel}
        groups={groups}
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
        title={
          <span className="flex flex-col gap-0.5">
            <span>
              {t("finance.chart.timelineTitle", "Engagement des coûts dans le temps (Invest)")}
            </span>
            <span className="text-[10.5px] font-normal text-tertiary">
              {t(
                "finance.chart.timelineSubtitle",
                "CAPEX + OPEX one-off — voir le graphique Coûts (Invest) vs Savings pour la comparaison aux gains"
              )}
            </span>
          </span>
        }
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

/** #4 — "Coûts (Invest) vs Savings" : compare, sur une fenêtre temporelle choisie, les coûts
 *  d'investissement (CAPEX + OPEX one-off) aux gains — barres empilées gains nets + OPEX récurrent
 *  démarré (= gains bruts), tooltip détaillé au survol. */
export function InvestVsSavingsChart({ data }: { data: BeTrackData }) {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<FinanceGranularity>("quarter");
  const points = useMemo(
    () => bucketInvestVsSavingsByPeriod(data, granularity),
    [data, granularity]
  );

  return (
    <Card>
      <CardHeader
        title={t("finance.chart.investVsSavingsTitle", "Coûts (Invest) vs Savings")}
        actions={<GranularityToggle value={granularity} onChange={setGranularity} />}
      />
      <CardBody>
        {points.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={points} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `€${v}M`}
              />
              <Tooltip content={<InvestVsSavingsTooltip />} />
              <Bar
                dataKey="investCost"
                name={t("finance.chart.investCost", "Coûts (Invest)")}
                fill="#806659"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="netSavings"
                name={t("finance.chart.netSavings", "Gains nets")}
                stackId="savings"
                fill="#FF3C47"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="opexRecStarted"
                name={t("finance.chart.opexRecRunRate", "OPEX récurrent démarré")}
                stackId="savings"
                fill="#991D1F"
                radius={[3, 3, 0, 0]}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardBody>
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
        {t("finance.chart.investCost", "Coûts (Invest)")} : {engine.fmtCurr(d.investCost)}
      </p>
      <p className="mt-0.5 text-[12px] text-secondary">
        {t("finance.chart.grossSavings", "Gains bruts")} : {engine.fmtCurr(d.grossSavings)}
      </p>
      <p className="mt-0.5 text-[12px] text-secondary">
        − {t("finance.chart.opexRecRunRate", "OPEX récurrent démarré")} :{" "}
        {engine.fmtCurr(d.opexRecStarted)}
      </p>
      <p className="mt-0.5 text-[12px] font-semibold text-primary">
        = {t("finance.chart.netSavings", "Gains nets")} : {engine.fmtCurr(d.netSavings)}
      </p>
    </div>
  );
}

/** #5 — Vue dédiée OPEX récurrent, run-rate par période de démarrage de l'action, barre cliquable
 *  (drill-down par workstream/levier). */
export function OpexRecurrentChart({ data }: { data: BeTrackData }) {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<FinanceGranularity>("year");
  const points = useMemo(() => bucketRecurrentOpexByPeriod(data, granularity), [data, granularity]);
  const [selectedPeriod, setSelectedPeriod] = useState<{ key: string; label: string } | null>(null);

  const groups = useMemo(() => {
    if (!selectedPeriod) return [];
    const rows = recurrentOpexRowsForPeriod(data, granularity, selectedPeriod.key);
    return groupCostsByWorkstream(rows, data.workstreams);
  }, [selectedPeriod, data, granularity]);

  return (
    <Card>
      <CardHeader
        title={t("finance.chart.opexRecTitle", "OPEX récurrent par période")}
        actions={<GranularityToggle value={granularity} onChange={setGranularity} />}
      />
      <CardBody>
        {points.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
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
                <Bar
                  dataKey="delta"
                  name={t("finance.chart.opexRecRunRate", "OPEX récurrent démarré")}
                  fill="#991D1F"
                  radius={[3, 3, 0, 0]}
                  cursor="pointer"
                  onClick={(entry) => {
                    const p = entry as unknown as { sortKey?: string; period?: string };
                    if (p.sortKey)
                      setSelectedPeriod({ key: p.sortKey, label: p.period ?? p.sortKey });
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="mt-2 text-[11px] text-tertiary">
              {t(
                "finance.chart.opexRecHint",
                "Chaque ligne OPEX récurrent est affichée sur sa période de démarrage — le modèle actuel n'a pas de date de fin dédiée pour l'OPEX récurrent, donc le montant n'est pas reconduit automatiquement sur les périodes suivantes."
              )}
            </p>
          </>
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

function EmptyState() {
  const { t } = useTranslation();
  return (
    <p className="py-10 text-center text-sm text-tertiary">
      {t("finance.chart.empty", "Aucun coût saisi sur les actions des leviers.")}
    </p>
  );
}
