"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatMillions } from "@/lib/format";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { sharePct, type LeverGroupSummary } from "@/lib/chartHoverPreview";
import { ChartHoverArea, FloatingPreview, HIDDEN_TOOLTIP_WRAPPER } from "./HoverPreview";
import {
  PreviewBar,
  PreviewCard,
  PreviewRealizedBlock,
  PreviewRow,
  PreviewSection,
  PreviewTopLevers,
  fmtShare,
} from "./LeverGroupPreview";

const COLORS = ["#FF3C47", "#991D1F", "#FF797B", "#806659", "#A99E9A", "#320300"];

export type GeoDonutPoint = { name: string; value: number };

/** Répartition des savings par géographie — porté depuis le donut Chart.js `ch-geo` du prototype legacy.
 *
 * Aperçu au survol (retour PO, même carte que la Trajectoire des économies) : part survolée →
 * montant, part du total, réalisé vs plan initial, nombre de leviers et 3 principaux leviers.
 * Rendu en portail (`FloatingPreview`) : jamais rogné par la carte. */
export function GeoDonutChart({
  data,
  details,
  formatValue = (v: number) => formatMillions(v),
  formatLeverValue,
}: {
  data: GeoDonutPoint[];
  /** Synthèse des leviers d'une part (aperçu au survol) ; absent = aperçu montant/part seul. */
  details?: (name: string) => LeverGroupSummary | null;
  formatValue?: (v: number) => string;
  /** Format des valeurs des « principaux leviers » (défaut : `formatValue`) — ex. montant quand la
   *  métrique est un nombre de leviers. */
  formatLeverValue?: (v: number) => string;
}) {
  const { t } = useTranslation();
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ChartHoverArea>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={55}
            outerRadius={90}
            paddingAngle={1}
          >
            {data.map((entry, i) => (
              <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            wrapperStyle={HIDDEN_TOOLTIP_WRAPPER}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as GeoDonutPoint | undefined;
              if (!active || !point) return null;
              const idx = data.findIndex((d) => d.name === point.name);
              const share = sharePct(point.value, total);
              const summary = details?.(point.name) ?? null;
              return (
                <FloatingPreview>
                  <PreviewCard
                    title={point.name}
                    subtitle={
                      summary
                        ? `${summary.count} ${
                            summary.count > 1
                              ? t("levers.count", "leviers")
                              : t("shared.marimekkoChart.leverSingular", "levier")
                          }`
                        : undefined
                    }
                  >
                    <div className="space-y-1">
                      <PreviewRow
                        color={idx >= 0 ? COLORS[idx % COLORS.length] : undefined}
                        label={t("chart.groupPreview.amount", "Montant")}
                        value={formatValue(point.value)}
                        strong
                      />
                      <PreviewRow
                        label={t("chart.groupPreview.shareOfTotal", "Part du total")}
                        value={fmtShare(share)}
                      />
                    </div>
                    <div className="mt-2">
                      <PreviewBar pct={share ?? 0} />
                    </div>
                    {summary && (
                      <>
                        <PreviewSection>
                          <PreviewRealizedBlock summary={summary} showPlanned compareTo="planned" />
                        </PreviewSection>
                        <PreviewTopLevers
                          levers={summary.top}
                          format={formatLeverValue ?? formatValue}
                        />
                      </>
                    )}
                  </PreviewCard>
                </FloatingPreview>
              );
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            layout="vertical"
            verticalAlign="middle"
            align="right"
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartHoverArea>
  );
}
