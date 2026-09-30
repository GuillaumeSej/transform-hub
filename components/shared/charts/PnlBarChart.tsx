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
import { PnlAccountPreview } from "@/components/finance/FinancePreviews";
import type { PnlLeverContribution } from "@/lib/financePreview";
import { ChartHoverArea, FloatingPreview, HIDDEN_TOOLTIP_WRAPPER } from "./HoverPreview";

/** `plan` = planifié initial, `reforecast` = réactualisé (optionnel), `realized` = réalisé — mêmes
 *  définitions que les totaux par levier (voir `engine.pnlImpactDetailed`). */
export type PnlBarPoint = {
  account: string;
  plan: number;
  realized: number;
  reforecast?: number;
  /** Identifiant du compte (`PnlDetailedPoint.accountId`) — clé des contributeurs de l'aperçu. */
  id?: string;
};

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
 *  Si les points portent un `reforecast`, une barre fine « Réactualisé » est affichée à côté.
 *
 *  Aperçu au survol (retour PO, même carte que la Trajectoire des économies) : planifié /
 *  réactualisé / réalisé du compte sur la période et la base de la page (`previewSubtitle`), écart
 *  réalisé − plan et 3 principaux leviers en écart (`contributors`). Rendu en portail
 *  (`FloatingPreview`) : jamais rogné par la carte ni recouvert par le widget suivant. */
export function PnlBarChart({
  data,
  labelPlan,
  labelRealized,
  labelReforecast,
  previewSubtitle,
  contributors,
}: {
  data: PnlBarPoint[];
  labelPlan?: string;
  labelRealized?: string;
  labelReforecast?: string;
  /** Sous-titre de l'aperçu (ex. « 2026 · Q1 — Effet sur la période »). */
  previewSubtitle?: string;
  /** Leviers contribuant à un compte, triés par |écart| (3 premiers affichés). */
  contributors?: (point: PnlBarPoint) => PnlLeverContribution[];
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
      // Précision fine : sur un mois / trimestre les montants sont proratisés (ex. 83 k€).
      remaining: Math.max(0, Math.round((d.plan - d.realized) * 10_000) / 10_000),
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
    <ChartHoverArea>
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
          {/* Aperçu au survol : le PLAN lui-même (pas la série empilée « reste à réaliser »). */}
          <Tooltip
            cursor={{ fill: "rgba(169,158,154,0.12)" }}
            wrapperStyle={HIDDEN_TOOLTIP_WRAPPER}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as PnlBarPoint | undefined;
              if (!active || !point) return null;
              return (
                <FloatingPreview>
                  <PnlAccountPreview
                    account={point.account}
                    subtitle={previewSubtitle}
                    plan={point.plan}
                    reforecast={hasReforecast ? (point.reforecast ?? 0) : undefined}
                    realized={point.realized}
                    contributors={contributors?.(point)}
                    labels={{
                      plan: resolvedLabelPlan,
                      reforecast: resolvedLabelReforecast,
                      realized: resolvedLabelRealized,
                    }}
                  />
                </FloatingPreview>
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
            name={resolvedLabelPlan}
            stackId="a"
            fill="rgba(169,158,154,0.3)"
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
    </ChartHoverArea>
  );
}
