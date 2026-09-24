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
import { formatMillions } from "@/lib/format";

/** `plan` = planifié initial, `reforecast` = réactualisé (optionnel), `realized` = réalisé — mêmes
 *  définitions que les totaux par levier (voir `engine.pnlImpactDetailed`). */
export type PnlBarPoint = { account: string; plan: number; realized: number; reforecast?: number };

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
 *  sur le plan (gris). La portion grise visible = ce qui reste à réaliser pour atteindre le plan.
 *  Si les points portent un `reforecast`, une barre fine « Réactualisé » est affichée à côté. */
export function PnlBarChart({
  data,
  labelPlan,
  labelRealized,
  labelReforecast,
}: {
  data: PnlBarPoint[];
  labelPlan?: string;
  labelRealized?: string;
  labelReforecast?: string;
}) {
  const { t } = useTranslation();
  const resolvedLabelPlan = labelPlan ?? t("chart.pnl.plan", "Plan");
  const resolvedLabelRealized = labelRealized ?? t("chart.pnl.realized", "Réalisé");
  const resolvedLabelReforecast = labelReforecast ?? t("chart.pnl.reforecast", "Réactualisé");
  const hasReforecast = data.some((d) => typeof d.reforecast === "number");
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

  const hasNegativeValues = chartData.some(
    (d) => d.plan < 0 || d.realized < 0 || (d.reforecast ?? 0) < 0
  );
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
          tickFormatter={(v) => formatMillions(Number(v))}
        />
        <YAxis
          type="category"
          dataKey="account"
          tick={TruncatedYTick}
          axisLine={false}
          tickLine={false}
          width={yAxisWidth}
        />
        {/* La série empilée « reste à réaliser » porte le libellé Plan : le survol affiche le PLAN
            lui-même, pas le reste (qui laissait croire à un plan plus faible). */}
        <Tooltip
          formatter={(value, _name, item) =>
            item?.dataKey === "remaining"
              ? formatMillions(Number((item.payload as { plan?: number })?.plan ?? value))
              : formatMillions(Number(value))
          }
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
          name={resolvedLabelPlan}
          stackId="a"
          fill="rgba(168,154,147,0.3)"
          radius={[0, 4, 4, 0]}
        />
        {hasReforecast && (
          <Bar
            dataKey="reforecast"
            name={resolvedLabelReforecast}
            stackId="b"
            fill="#320300"
            barSize={6}
            radius={[0, 3, 3, 0]}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
