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
  const chartHeight = Math.max(height, data.length * 42 + 90);
  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 12, bottom: 20 }}>
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
        <Tooltip
          formatter={(value, name) => [
            t("shared.forcedDepartureStatusChart.movementsTooltip", "{n} mouvement(s)").replace(
              "{n}",
              String(Number(value))
            ),
            String(name),
          ]}
          labelFormatter={(label) =>
            t(
              "shared.forcedDepartureStatusChart.schemeTooltipLabel",
              "Dispositif : {scheme}"
            ).replace("{scheme}", String(label))
          }
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar
          dataKey="realized"
          name={t("shared.forcedDepartureStatusChart.realized", "Réalisés")}
          stackId="status"
          fill="#421799"
        />
        <Bar
          dataKey="overdue"
          name={t("hr.alert.overdue", "En retard")}
          stackId="status"
          fill="#FF3C47"
        />
        <Bar
          dataKey="dueSoon"
          name={t("shared.forcedDepartureStatusChart.dueSoon", "À venir < 90 j")}
          stackId="status"
          fill="#FFB1B5"
        />
        <Bar
          dataKey="later"
          name={t("shared.forcedDepartureStatusChart.later", "À venir > 90 j")}
          stackId="status"
          fill="#A99E9A"
        />
        <Bar
          dataKey="abandoned"
          name={t("shared.forcedDepartureStatusChart.abandoned", "Abandonnés")}
          stackId="status"
          fill="#806659"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
