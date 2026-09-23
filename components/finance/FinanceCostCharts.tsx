"use client";

import { useMemo, useState } from "react";
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
import { useTranslation } from "@/lib/i18n/useTranslation";
import { useStableValue } from "@/lib/hooks/useStableChartData";
import * as engine from "@/lib/engine";
import {
  bucketCostsByPeriod,
  bucketInvestVsSavingsByPeriod,
  costRowsForPeriod,
  groupCostsByWorkstream,
  isInvestNature,
  type FinanceGranularity,
} from "@/lib/financeCosts";
import type { BeTrackData } from "@/types";

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
export function CostCommitmentTimelineChart({ data }: { data: BeTrackData }) {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<FinanceGranularity>("quarter");
  // Référence stable tant que le contenu ne change pas (voir lib/hooks/useStableChartData.ts) : un
  // re-rendu de la page avec des données identiques ne relance plus l'animation d'entrée.
  const points = useStableValue(
    useMemo(() => bucketCostsByPeriod(data, granularity, isInvestNature), [data, granularity])
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
  // Pop-up "détail du calcul" : undefined = fermée, null = vue Total, sinon clé de la période.
  const [calcKey, setCalcKey] = useState<string | null | undefined>(undefined);
  // Référence stable tant que le contenu ne change pas (voir lib/hooks/useStableChartData.ts) : un
  // re-rendu de la page avec des données identiques ne relance plus l'animation d'entrée.
  const points = useStableValue(
    useMemo(
      () =>
        bucketInvestVsSavingsByPeriod(data, granularity).map((p) => ({
          ...p,
          negOpex: -p.opexRecStarted,
          negInvest: -p.investCost,
        })),
      [data, granularity]
    )
  );
  const open = (p: { sortKey?: string } | undefined) => {
    if (p?.sortKey) setCalcKey(p.sortKey);
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
        title={t("finance.chart.investVsSavingsTitle", "Coût d'investissement vs Économies")}
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
      <p className="mt-1 text-[10.5px] italic text-tertiary">
        {t("finance.calc.clickHint", "Cliquer pour le détail du calcul")}
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
