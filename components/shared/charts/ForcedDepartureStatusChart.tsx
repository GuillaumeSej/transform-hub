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
import type { ForcedDepartureStatusRow } from "@/lib/hrSocialPlan";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { formatPct } from "@/lib/format";
import { shareOfTotal } from "@/lib/hrChartPreview";
import { ChartHoverArea, FloatingPreview, HIDDEN_TOOLTIP_WRAPPER } from "./HoverPreview";
import { HrChartPreview } from "./HrChartPreview";

type StatusKey = Exclude<keyof ForcedDepartureStatusRow, "scheme">;

export function ForcedDepartureStatusChart({
  data,
  height = 300,
}: {
  data: ForcedDepartureStatusRow[];
  height?: number;
}) {
  const { t } = useTranslation();

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("shared.forcedDepartureStatusChart.noData", "Aucun départ forcé à afficher.")}
      </p>
    );
  }
  const series: { key: StatusKey; label: string; color: string }[] = [
    {
      key: "realized",
      label: t("shared.forcedDepartureStatusChart.realized", "Réalisés"),
      color: "#421799",
    },
    { key: "overdue", label: t("hr.alert.overdue", "En retard"), color: "#FF3C47" },
    {
      key: "dueSoon",
      label: t("shared.forcedDepartureStatusChart.dueSoon", "À venir ≤ 90 j"),
      color: "#FFB1B5",
    },
    {
      key: "later",
      label: t("shared.forcedDepartureStatusChart.later", "À venir > 90 j"),
      color: "#A99E9A",
    },
    {
      key: "abandoned",
      label: t("shared.forcedDepartureStatusChart.abandoned", "Abandonnés"),
      color: "#806659",
    },
  ];
  const rowTotal = (row: ForcedDepartureStatusRow) =>
    series.reduce((sum, s) => sum + row[s.key], 0);
  const grandTotal = data.reduce((sum, row) => sum + rowTotal(row), 0);
  const movementsText = (n: number) =>
    t("shared.forcedDepartureStatusChart.movementsTooltip", "{n} mouvement(s)").replace(
      "{n}",
      String(n)
    );
  const chartHeight = Math.max(height, data.length * 42 + 90);
  return (
    <ChartHoverArea>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 16, left: 12, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="scheme"
            width={92}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          {/* Aperçu au survol (retour PO) : départs par statut, total, taux de réalisation (réalisés
              / prévus hors abandons) et part du total des départs forcés. */}
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            wrapperStyle={HIDDEN_TOOLTIP_WRAPPER}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as ForcedDepartureStatusRow | undefined;
              if (!active || !row) return null;
              const total = rowTotal(row);
              const realizedPct = shareOfTotal(row.realized, total - row.abandoned);
              return (
                <FloatingPreview>
                  <HrChartPreview
                    title={t(
                      "shared.forcedDepartureStatusChart.schemeTooltipLabel",
                      "Dispositif : {scheme}"
                    ).replace("{scheme}", String(row.scheme))}
                    rows={[
                      ...series
                        .filter((s) => row[s.key] > 0)
                        .map((s) => ({
                          label: s.label,
                          value: movementsText(row[s.key]),
                          marker: { color: s.color },
                        })),
                      {
                        label: t("chart.hrPreview.total", "Total"),
                        value: movementsText(total),
                        strong: true,
                      },
                      ...(realizedPct !== null
                        ? [
                            {
                              label: t(
                                "chart.hrPreview.realizedRate",
                                "Réalisé / prévu (hors abandons)"
                              ),
                              value: formatPct(realizedPct),
                              muted: true,
                            },
                          ]
                        : []),
                    ]}
                    share={{
                      label: t("chart.hrPreview.shareOfDepartures", "Part des départs forcés"),
                      pct: shareOfTotal(total, grandTotal),
                    }}
                  />
                </FloatingPreview>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="status" fill={s.color} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartHoverArea>
  );
}
