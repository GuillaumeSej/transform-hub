"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Bar,
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
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { BudgetDonutChart } from "@/components/shared/charts/BudgetDonutChart";
import { GranularityToggle } from "@/components/shared/GranularityToggle";
import { CostDrilldownModal } from "@/components/finance/CostDrilldownModal";
import { useTranslation } from "@/lib/i18n/useTranslation";
import * as engine from "@/lib/engine";
import {
  bucketCostsByPeriod,
  bucketInvestVsSavingsByPeriod,
  costRowsForPeriod,
  costsByHierarchyNode,
  groupCostsByWorkstream,
  investCostRowsBySegment,
  isInvestNature,
  leversWithUndetailedCosts,
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
            <span>{t("finance.chart.engagedTitle", "Coûts engagés vs à venir")}</span>
            <span className="text-[10.5px] font-normal text-tertiary">
              {t(
                "finance.chart.engagedSubtitle",
                'Périmètre Invest (CAPEX + OPEX one-off), OPEX récurrent exclu — à ne pas comparer directement au total "Répartition par centre de coût / P&L", qui inclut aussi l\'OPEX récurrent. "Déjà engagé" (date/statut déjà passé) est une notion différente du CAPEX "Réalisé" du KPI Pilotage global (pondéré par la progression % du levier) : les deux chiffres ne sont pas censés coïncider.'
              )}
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
                "CAPEX + OPEX one-off — voir le graphique Coût d'investissement vs Savings pour la comparaison aux gains"
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

  // Leviers avec un CAPEX/OPEX chiffré au niveau du levier mais sans plan d'action détaillé — ils
  // ne contribuent à AUCUN graphique de coûts (tous basés sur `flattenCostImpacts`, donc sur les
  // impacts d'action), pas seulement celui-ci. Voir `leversWithUndetailedCosts`. Affiché comme note
  // explicite plutôt que de laisser le lecteur croire à tort que ces leviers n'ont "aucun coût".
  const undetailedLevers = useMemo(() => leversWithUndetailedCosts(data), [data]);

  const hierarchySubtitle = t(
    "finance.chart.hierarchySubtitle",
    'Tous types de coûts confondus (CAPEX + OPEX one-off + OPEX récurrent) — périmètre plus large que "Coûts engagés vs à venir" (Invest uniquement).'
  );
  const undetailedNote =
    undetailedLevers.length > 0
      ? t(
          "finance.chart.undetailedCostsNote",
          "{n} levier(s) avec un CAPEX/OPEX saisi au niveau du levier mais sans plan d'action détaillé, non inclus dans ce graphique (ni dans les autres graphiques Finance) : {names}."
        )
          .replace("{n}", String(undetailedLevers.length))
          .replace("{names}", undetailedLevers.map((l) => l.name).join(", "))
      : null;

  if (levels.length === 0) {
    return (
      <Card>
        <CardHeader
          title={
            <span className="flex flex-col gap-0.5">
              <span>
                {t(
                  "finance.chart.hierarchyTitle",
                  "Répartition des coûts par centre de coût / P&L"
                )}
              </span>
              <span className="text-[10.5px] font-normal text-tertiary">{hierarchySubtitle}</span>
            </span>
          }
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
        title={
          <span className="flex flex-col gap-0.5">
            <span>
              {t("finance.chart.hierarchyTitle", "Répartition des coûts par centre de coût / P&L")}
            </span>
            <span className="text-[10.5px] font-normal text-tertiary">{hierarchySubtitle}</span>
          </span>
        }
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
        {undetailedNote && (
          <p className="mt-3 rounded-md bg-neutral-50 px-2.5 py-2 text-[11px] text-tertiary">
            {undetailedNote}
          </p>
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
  const points = useMemo(
    () => bucketInvestVsSavingsByPeriod(data, granularity),
    [data, granularity]
  );

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
              <ReferenceLine y={0} stroke="rgba(0,0,0,0.2)" />
              <Tooltip content={<InvestVsSavingsTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                content={() => (
                  <div className="mb-1 flex flex-wrap items-center justify-end gap-4 text-[11px] text-secondary">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-[1.5px]"
                        style={{ background: COLOR_POSITIVE }}
                      />
                      {t("finance.chart.netPositive", "Économie positive")}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-[1.5px]"
                        style={{ background: COLOR_NEGATIVE }}
                      />
                      {t("finance.chart.netNegative", "Économie négative")}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-0 w-4 border-t-2"
                        style={{ borderColor: COLOR_CUMULATIVE }}
                      />
                      {t("finance.chart.netCumulative", "Cumul net")}
                    </span>
                  </div>
                )}
              />
              <Bar dataKey="netPeriodResult" radius={[3, 3, 3, 3]} isAnimationActive={false}>
                {points.map((p) => (
                  <Cell
                    key={p.sortKey}
                    fill={p.netPeriodResult >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE}
                  />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="netCumulative"
                stroke={COLOR_CUMULATIVE}
                strokeWidth={2}
                dot={{ r: 3 }}
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
