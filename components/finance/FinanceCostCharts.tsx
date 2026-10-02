"use client";

import { useCallback, useMemo, useState } from "react";
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
import { GranularityToggle } from "@/components/shared/GranularityToggle";
import { InvestVsSavingsCalcModal } from "@/components/finance/InvestVsSavingsCalcModal";
import { CostDrilldownModal } from "@/components/finance/CostDrilldownModal";
import { PreviewTopList } from "@/components/finance/FinancePreviews";
import {
  ChartHoverArea,
  FloatingPreview,
  HIDDEN_TOOLTIP_WRAPPER,
} from "@/components/shared/charts/HoverPreview";
import {
  PreviewBar,
  PreviewCard,
  PreviewRow,
  PreviewSection,
} from "@/components/shared/charts/LeverGroupPreview";
import { topContributors } from "@/lib/chartPreview";
import { leverAmounts } from "@/lib/financePreview";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { useStableValue } from "@/lib/hooks/useStableChartData";
import * as engine from "@/lib/engine";
import {
  bucketCostsByPeriod,
  bucketInvestVsSavingsByPeriod,
  costRowsForPeriod,
  groupCostsByWorkstream,
  investVsSavingsRowsForPeriod,
  isInvestNature,
  type CostPeriodPoint,
  type FinanceGranularity,
} from "@/lib/financeCosts";
import type { BeTrackData } from "@/types";
import { formatMillions } from "@/lib/format";

/** 4 graphiques de suivi des coûts du module Finance — TOUTES les données proviennent de
 *  `data.levers[].actions[].impacts[]` via `lib/financeCosts.ts` (aucune donnée en dur). CAPEX +
 *  OPEX one-off ("Invest") sont distingués de l'OPEX récurrent partout où c'est pertinent (a/d),
 *  et chaque graphique cliquable ouvre `CostDrilldownModal` (workstream → levier → fiche levier).
 *  Inspirés des patterns déjà en place côté RH (`HrBreakdownCharts.tsx`, sélecteur
 *  mois/trimestre/année) et dashboard exécutif (`QuarterlyBridgeChart`, `BudgetDonutChart`). */

/** #1 (engagé vs à venir) et #3 (répartition par centre de coût / P&L) : donuts à drill-down en
 *  place + fil d'Ariane, déplacés dans CostDrillDonuts.tsx — ré-exportés ici pour que la page
 *  continue d'importer depuis ce fichier. */
export {
  CostByHierarchyChart,
  CostEngagedVsUpcomingChart,
} from "@/components/finance/CostDrillDonuts";

/** #2 — Engagement des coûts Invest (CAPEX + OPEX one-off) dans le temps, toggle
 *  mensuel/trimestriel/annuel, barre cliquable (drill-down par workstream/levier). */
export function CostCommitmentTimelineChart({
  data,
  fyStartMonth = 0,
}: {
  data: BeTrackData;
  /** Mois (0-11) de début d'exercice du programme : années / trimestres = exercices fiscaux, comme
   *  le P&L et le tableau de la page (audit lot 2). */
  fyStartMonth?: number;
}) {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<FinanceGranularity>("quarter");
  // Référence stable tant que le contenu ne change pas (voir lib/hooks/useStableChartData.ts) : un
  // re-rendu de la page avec des données identiques ne relance plus l'animation d'entrée.
  const points = useStableValue(
    useMemo(
      () => bucketCostsByPeriod(data, granularity, isInvestNature, fyStartMonth),
      [data, granularity, fyStartMonth]
    )
  );
  const [selectedPeriod, setSelectedPeriod] = useState<{ key: string; label: string } | null>(null);

  const groups = useMemo(() => {
    if (!selectedPeriod) return [];
    const rows = costRowsForPeriod(
      data,
      granularity,
      selectedPeriod.key,
      isInvestNature,
      fyStartMonth
    );
    return groupCostsByWorkstream(rows, data.workstreams);
  }, [selectedPeriod, data, granularity, fyStartMonth]);

  // Aperçu au survol (retour PO) : 3 principaux leviers de la période survolée — mêmes lignes que
  // le détail ouvert au clic (`costRowsForPeriod`), calculées à la demande et mises en cache.
  const topLeversOf = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof leverAmounts>>();
    return (periodKey: string) => {
      let top = cache.get(periodKey);
      if (!top) {
        top = topContributors(
          leverAmounts(
            costRowsForPeriod(data, granularity, periodKey, isInvestNature, fyStartMonth)
          ),
          3,
          0.005
        );
        cache.set(periodKey, top);
      }
      return top;
    };
  }, [data, granularity, fyStartMonth]);
  const maxDelta = Math.max(1e-9, ...points.map((p) => Math.abs(p.delta)));
  const totalCost = points.length > 0 ? points[points.length - 1].cumulative : 0;
  const openPeriod = (p: { sortKey?: string; period?: string } | undefined) => {
    if (p?.sortKey) setSelectedPeriod({ key: p.sortKey, label: p.period ?? p.sortKey });
  };

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
          <ChartHoverArea>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart
                data={points}
                margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                style={{ cursor: "pointer" }}
                onClick={(state) => {
                  const label = (state as { activeLabel?: string | number } | undefined)
                    ?.activeLabel;
                  openPeriod(points.find((p) => p.period === label));
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatMillions(Number(v))}
                />
                {/* Aperçu au survol (portail, toujours visible) ; clic = détail de la période. */}
                <Tooltip
                  cursor={{ fill: "rgba(169,158,154,0.12)" }}
                  wrapperStyle={HIDDEN_TOOLTIP_WRAPPER}
                  content={({ active, payload }) => {
                    const p = payload?.[0]?.payload as CostPeriodPoint | undefined;
                    if (!active || !p) return null;
                    return (
                      <FloatingPreview>
                        <PreviewCard
                          title={p.period}
                          subtitle={t(
                            "finance.preview.investScope",
                            "Coûts Invest (CAPEX + OPEX ponctuel)"
                          )}
                          clickHint={t("finance.preview.clickDetail", "Cliquer pour le détail →")}
                        >
                          <div className="space-y-1">
                            <PreviewRow
                              color="#FF3C47"
                              label={t("finance.chart.periodCost", "Coût de la période")}
                              value={formatMillions(p.delta)}
                              strong
                            />
                            <PreviewRow
                              color="#806659"
                              label={t("finance.chart.cumulativeCost", "Coût cumulé")}
                              value={formatMillions(p.cumulative)}
                            />
                          </div>
                          <div className="mt-2 space-y-1">
                            <PreviewBar pct={(Math.abs(p.delta) / maxDelta) * 100} />
                            <PreviewBar
                              pct={totalCost > 0 ? (p.cumulative / totalCost) * 100 : 0}
                              className="bg-bp-warm-brown/60"
                            />
                          </div>
                          <PreviewTopList
                            title={t("finance.preview.topLevers", "Principaux leviers")}
                            items={topLeversOf(p.sortKey)}
                          />
                        </PreviewCard>
                      </FloatingPreview>
                    );
                  }}
                />
                <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="delta"
                  name={t("finance.chart.periodCost", "Coût de la période")}
                  fill="#FF3C47"
                  radius={[3, 3, 0, 0]}
                  cursor="pointer"
                  onClick={(entry) => openPeriod(entry as unknown as CostPeriodPoint)}
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
          </ChartHoverArea>
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
export function InvestVsSavingsChart({
  data,
  fyStartMonth = 0,
}: {
  data: BeTrackData;
  /** Mois (0-11) de début d'exercice : années / trimestres = exercices fiscaux (audit lot 2). */
  fyStartMonth?: number;
}) {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<FinanceGranularity>("quarter");
  // Pop-up "détail du calcul" : undefined = fermée, null = vue Total, sinon clé de la période.
  const [calcKey, setCalcKey] = useState<string | null | undefined>(undefined);
  // Référence stable tant que le contenu ne change pas (voir lib/hooks/useStableChartData.ts) : un
  // re-rendu de la page avec des données identiques ne relance plus l'animation d'entrée.
  const points = useStableValue(
    useMemo(
      () =>
        bucketInvestVsSavingsByPeriod(data, granularity, fyStartMonth).map((p) => ({
          ...p,
          negOpex: -p.opexRecStarted,
          negInvest: -p.investCost,
        })),
      [data, granularity, fyStartMonth]
    )
  );
  const open = (p: { sortKey?: string } | undefined) => {
    if (p?.sortKey) setCalcKey(p.sortKey);
  };
  // Aperçu au survol : 3 leviers au résultat net le plus marqué sur la période (mêmes flux que le
  // détail du calcul ouvert au clic, `investVsSavingsRowsForPeriod`), calculés à la demande.
  const topLeversOf = useMemo(() => {
    const cache = new Map<string, { id: string; code: string; name: string; value: number }[]>();
    return (periodKey: string) => {
      let top = cache.get(periodKey);
      if (!top) {
        top = topContributors(
          investVsSavingsRowsForPeriod(data, granularity, periodKey, fyStartMonth).map((r) => ({
            id: r.leverId,
            code: r.leverCode,
            name: r.leverName,
            value: r.net,
          })),
          3,
          0.005
        );
        cache.set(periodKey, top);
      }
      return top;
    };
  }, [data, granularity, fyStartMonth]);
  const tooltipContent = useCallback(
    (props: { active?: boolean; payload?: InvestVsSavingsTooltipPayload }) => (
      <InvestVsSavingsTooltip {...props} topLeversOf={topLeversOf} />
    ),
    [topLeversOf]
  );
  const gainsLabel = t("finance.chart.grossSavings", "Gains bruts");
  const opexLabel = t("finance.chart.opexRecShort", "OPEX récurrent");
  const investLabel = t("finance.chart.investCost", "Coût d'investissement");
  const netNegLabel = t("finance.chart.netNegative", "Économie négative");
  const netLabel = t("finance.chart.netPeriodShort", "Économie nette");
  const cumLabel = t("finance.chart.netCumulative", "Cumul net");

  return (
    <Card>
      <CardHeader
        title={t("finance.chart.investVsSavingsTitle", "Coût d'investissement vs Économies")}
        actions={<GranularityToggle value={granularity} onChange={setGranularity} />}
      />
      <CardBody>
        {points.length === 0 ? (
          <EmptyState />
        ) : (
          <ChartHoverArea>
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
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 11, cursor: "pointer" }}
                  axisLine={false}
                  tickLine={false}
                  onClick={(tick: unknown) => {
                    const label = (tick as { value?: string } | undefined)?.value;
                    open(points.find((p) => p.period === label));
                  }}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatMillions(Number(v))}
                />
                <ReferenceLine y={0} stroke="rgba(0,0,0,0.2)" />
                <Tooltip
                  cursor={{ fill: "rgba(169,158,154,0.12)" }}
                  wrapperStyle={HIDDEN_TOOLTIP_WRAPPER}
                  content={tooltipContent as never}
                />
                <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="grossSavings" name={gainsLabel} stackId="s" fill={COLOR_POSITIVE} />
                <Bar dataKey="negOpex" name={opexLabel} stackId="s" fill="#A99E9A" />
                <Bar dataKey="negInvest" name={investLabel} stackId="s" fill={COLOR_NEGATIVE} />
                <Line
                  type="monotone"
                  dataKey="netPeriodResult"
                  name={netLabel}
                  stroke="#969696"
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
          </ChartHoverArea>
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
            <button
              type="button"
              className="text-[11px] font-medium text-primary underline underline-offset-2 hover:text-bp-coral"
              onClick={() => setCalcKey(null)}
            >
              {t("finance.calc.seeDetail", "Voir le détail du calcul")}
            </button>
          </div>
        )}
      </CardBody>
      <InvestVsSavingsCalcModal
        data={data}
        granularity={granularity}
        fyStartMonth={fyStartMonth}
        points={points}
        periodKey={calcKey}
        onPeriodChange={setCalcKey}
        onClose={() => setCalcKey(undefined)}
      />
    </Card>
  );
}

type InvestVsSavingsTooltipPayload = {
  payload: {
    period: string;
    sortKey: string;
    investCost: number;
    grossSavings: number;
    opexRecStarted: number;
    netSavings: number;
    netPeriodResult: number;
    netCumulative: number;
  };
}[];

/** Aperçu au survol d'une période (retour PO, même carte que la Trajectoire des économies) :
 *  décomposition gains bruts → gains nets → résultat net de la période, cumul, 3 principaux
 *  leviers ; rendu en portail (`FloatingPreview`), jamais rogné par la carte. */
function InvestVsSavingsTooltip({
  active,
  payload,
  topLeversOf,
}: {
  active?: boolean;
  payload?: InvestVsSavingsTooltipPayload;
  topLeversOf: (periodKey: string) => { id: string; code: string; name: string; value: number }[];
}) {
  const { t } = useTranslation();
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  const fmt = (v: number) => engine.fmtCurr(v);
  const net = d.netPeriodResult;
  const max = Math.max(Math.abs(d.grossSavings), Math.abs(d.opexRecStarted + d.investCost), 1e-9);
  return (
    <FloatingPreview>
      <PreviewCard
        title={d.period}
        clickHint={t("finance.preview.clickCalc", "Cliquer pour le détail du calcul →")}
      >
        <div className="space-y-1">
          <PreviewRow
            color={COLOR_POSITIVE}
            label={t("finance.chart.grossSavings", "Gains bruts")}
            value={fmt(d.grossSavings)}
          />
          <PreviewRow
            color="#A99E9A"
            label={`− ${t("finance.chart.opexRecRunRate", "OPEX récurrent démarré")}`}
            value={fmt(d.opexRecStarted)}
          />
          <PreviewRow
            label={`= ${t("finance.chart.netSavings", "Gains nets")}`}
            value={fmt(d.netSavings)}
          />
          <PreviewRow
            color={COLOR_NEGATIVE}
            label={`− ${t("finance.chart.investCost", "Coût d'investissement")}`}
            value={fmt(d.investCost)}
          />
        </div>
        {/* Mini-comparaison : gains bruts vs coûts de la période (OPEX récurrent + Invest). */}
        <div className="mt-2 space-y-1">
          <PreviewBar
            pct={(Math.abs(d.grossSavings) / max) * 100}
            className="bg-bp-warm-brown/60"
          />
          <PreviewBar pct={(Math.abs(d.opexRecStarted + d.investCost) / max) * 100} />
        </div>
        <PreviewSection>
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-primary">
              {t("finance.chart.netPeriodResult", "Résultat net de la période")}
            </span>
            <span
              className={
                net < 0
                  ? "font-bold tabular-nums text-bp-coral"
                  : "font-bold tabular-nums text-primary"
              }
            >
              {net > 0 ? "+" : ""}
              {fmt(net)}
            </span>
          </div>
          <div className="mt-1 flex justify-between gap-3 text-[11px] text-secondary">
            <span>{t("finance.chart.netCumulative", "Cumul net")}</span>
            <span className={d.netCumulative < 0 ? "tabular-nums text-bp-coral" : "tabular-nums"}>
              {fmt(d.netCumulative)}
            </span>
          </div>
        </PreviewSection>
        <PreviewTopList
          title={t("finance.preview.topLeversNet", "Principaux leviers (résultat net)")}
          items={topLeversOf(d.sortKey)}
          format={fmt}
        />
      </PreviewCard>
    </FloatingPreview>
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
