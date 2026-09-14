"use client";

import { useMemo, useState } from "react";
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
import { useTranslation } from "@/lib/i18n/useTranslation";
import * as engine from "@/lib/engine";
import {
  bucketCostsByPeriod,
  bucketRecurrentOpexByPeriod,
  splitByNature,
  splitEngagedVsUpcoming,
  type FinanceGranularity,
} from "@/lib/financeCosts";
import type { BeTrackData } from "@/types";

/** 4 graphiques de suivi des coûts du module Finance — TOUTES les données proviennent de
 *  `data.levers[].actions[].impacts[]` via `lib/financeCosts.ts` (aucune donnée en dur), CAPEX et
 *  OPEX (récurrent/one-off) distingués partout où c'est pertinent. Inspirés des patterns déjà en
 *  place côté RH (`HrBreakdownCharts.tsx`, sélecteur mois/trimestre/année) et dashboard exécutif
 *  (`QuarterlyBridgeChart`, `BudgetDonutChart`). */

/** #1 — Coûts déjà engagés vs à venir vs total. */
export function CostEngagedVsUpcomingChart({ data }: { data: BeTrackData }) {
  const { t } = useTranslation();
  const split = useMemo(() => splitEngagedVsUpcoming(data), [data]);

  return (
    <Card>
      <CardHeader title={t("finance.chart.engagedTitle", "Coûts engagés vs à venir")} />
      <CardBody>
        {split.total === 0 ? (
          <EmptyState />
        ) : (
          <BudgetDonutChart
            data={[
              { name: t("finance.chart.engaged", "Déjà engagé"), value: split.engaged },
              { name: t("finance.chart.upcoming", "À venir"), value: split.upcoming },
            ]}
            formatValue={(v) => engine.fmtCurr(v)}
            centerLabel={t("finance.chart.totalCost", "Coût total")}
          />
        )}
      </CardBody>
    </Card>
  );
}

/** #2 — Engagement des coûts dans le temps, avec toggle mensuel/trimestriel/annuel. */
export function CostCommitmentTimelineChart({ data }: { data: BeTrackData }) {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<FinanceGranularity>("quarter");
  const points = useMemo(() => bucketCostsByPeriod(data, granularity), [data, granularity]);

  return (
    <Card>
      <CardHeader
        title={t("finance.chart.timelineTitle", "Engagement des coûts dans le temps")}
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
    </Card>
  );
}

/** #3 — Répartition CAPEX / OPEX récurrent / One-off. */
export function CapexOpexBreakdownChart({ data }: { data: BeTrackData }) {
  const { t } = useTranslation();
  const split = useMemo(() => splitByNature(data), [data]);
  const total = split.capex + split.opexRec + split.oneoff;

  return (
    <Card>
      <CardHeader title={t("finance.chart.natureTitle", "Répartition CAPEX / OPEX")} />
      <CardBody>
        {total === 0 ? (
          <EmptyState />
        ) : (
          <BudgetDonutChart
            data={[
              { name: "CAPEX", value: split.capex },
              { name: t("finance.chart.opexRec", "OPEX récurrent"), value: split.opexRec },
              { name: t("finance.chart.oneoff", "One-off"), value: split.oneoff },
            ]}
            formatValue={(v) => engine.fmtCurr(v)}
            centerLabel={t("finance.chart.totalCost", "Coût total")}
          />
        )}
      </CardBody>
    </Card>
  );
}

/** #4 — Vue dédiée OPEX récurrent, run-rate par période de démarrage de l'action. */
export function OpexRecurrentChart({ data }: { data: BeTrackData }) {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<FinanceGranularity>("year");
  const points = useMemo(() => bucketRecurrentOpexByPeriod(data, granularity), [data, granularity]);

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
