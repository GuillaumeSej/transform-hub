"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { useStableValue } from "@/lib/hooks/useStableChartData";

export type PnlBarPoint = { account: string; plan: number; realized: number };

/** Tick custom pour l'axe Y : label tronqué avec tooltip SVG natif au hover. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TruncatedYTick(props: any) {
  const { x = 0, y = 0, payload } = props;
  const label = (payload?.value as string) ?? "";
  const maxLen = 18;
  const truncated = label.length > maxLen ? label.slice(0, maxLen) + "…" : label;
  return (
    <g>
      <title>{label}</title>
      <text x={x - 4} y={y} dy={4} textAnchor="end" fontSize={10} fill="#1A1A1A">
        {truncated}
      </text>
    </g>
  );
}

/** Impact P&L par compte — barres horizontales empilées : le réalisé (coral) est superposé
 *  sur le plan (gris). La portion grise visible = ce qui reste à réaliser pour atteindre le plan. */
export function PnlBarChart({
  data,
  labelPlan,
  labelRealized,
}: {
  data: PnlBarPoint[];
  labelPlan?: string;
  labelRealized?: string;
}) {
  const { t } = useTranslation();
  const resolvedLabelPlan = labelPlan ?? t("chart.pnl.plan", "Plan");
  const resolvedLabelRealized = labelRealized ?? t("chart.pnl.realized", "Réalisé");
  const resolvedLabelRemaining = t("chart.pnl.remaining", "Reste à faire");
  // Référence stable tant que le contenu ne change pas : un tableau recréé à chaque rendu relançait
  // l'animation d'entrée des barres (Recharts 3 anime sur changement de référence de `data`).
  const chartData = useStableValue(
    data.map((d) => ({
      ...d,
      remaining: Math.max(0, Math.round((d.plan - d.realized) * 10) / 10),
    }))
  );

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("shared.pnlBarChart.empty", "Aucun impact à afficher.")}
      </p>
    );
  }

  const hasNegativeValues = chartData.some((d) => d.plan < 0 || d.realized < 0);
  // Largeur de l'axe Y adaptée aux libellés RÉELS (au lieu d'une largeur fixe de 140px pensée pour
  // le pire cas à 18 caractères) : la plupart des comptes P&L sont bien plus courts, ce qui
  // laissait un grand vide entre les libellés (alignés à droite, donc collés à ce vide) et le
  // début des barres. ~6px/caractère à fontSize 10, plafonné à 140px (troncature `TruncatedYTick`
  // toujours à 18 caractères) et jamais sous 56px.
  const longestLabelLen = Math.max(4, ...chartData.map((d) => d.account.length));
  const yAxisWidth = Math.min(140, Math.max(56, longestLabelLen * 6 + 16));

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 36 + 40)}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" horizontal={false} />
        <XAxis
          type="number"
          domain={hasNegativeValues ? ["auto", "auto"] : [0, "auto"]}
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `€${v}M`}
        />
        <YAxis
          type="category"
          dataKey="account"
          tick={TruncatedYTick}
          axisLine={false}
          tickLine={false}
          width={yAxisWidth}
        />
        {/* Infobulle explicite : la barre grise est le RESTE À FAIRE (plan − réalisé), pas le plan
            lui-même — l'ancienne infobulle l'affichait sous le libellé « Plan » (audit FIN-10). */}
        <Tooltip
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as
              (PnlBarPoint & { remaining: number }) | undefined;
            if (!active || !point) return null;
            const fmt = (v: number) => `€${v.toFixed(1)}M`;
            return (
              <div className="rounded-md border border-border bg-white px-3 py-2 text-xs shadow-sm">
                <div className="mb-1 font-semibold text-primary">{point.account}</div>
                <div>
                  {resolvedLabelPlan} : {fmt(point.plan)}
                </div>
                <div>
                  {resolvedLabelRealized} : {fmt(point.realized)}
                </div>
                <div className="text-tertiary">
                  {resolvedLabelRemaining} : {fmt(point.remaining)}
                </div>
              </div>
            );
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar
          dataKey="realized"
          name={resolvedLabelRealized}
          stackId="a"
          fill="#FF3C47"
          radius={[0, 0, 0, 0]}
        />
        <Bar
          dataKey="remaining"
          name={resolvedLabelRemaining}
          stackId="a"
          fill="rgba(168,154,147,0.3)"
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
