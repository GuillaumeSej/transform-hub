"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SavingsWaterfall } from "@/lib/engine";
import { waterfallBars, type WaterfallBar } from "@/lib/dashboardSavings";
import { useTranslation } from "@/lib/i18n/useTranslation";

const COLORS = {
  total: "#806659",
  up: "#2E9E6B",
  down: "#D64545",
  realized: "#FF3C47",
  remaining: "rgba(168,154,147,0.45)",
};

const fmt = (v: number) => `€${Math.round(v * 10) / 10}M`;

/** Cascade des économies : planifié initial -> réactualisé -> annulé -> en retard -> coûts ->
 *  "Total attendu" (empilé réalisé / reste à faire). Leviers annulés exclus des totaux. */
export function SavingsWaterfallChart({
  waterfall,
  height = 340,
  oneOffGains = 0,
}: {
  waterfall: SavingsWaterfall;
  height?: number;
  /** Gains one-off (affichés à part, jamais inclus dans la cascade). */
  oneOffGains?: number;
}) {
  const { t } = useTranslation();
  const bars = waterfallBars(waterfall);
  if (bars.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("chart.emptyLevers", "Aucun levier à représenter.")}
      </p>
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const b = payload[0].payload as WaterfallBar;
    return (
      <div className="rounded-md border border-border bg-white px-3 py-2 text-xs shadow-lg">
        <div className="font-semibold text-primary">{b.label}</div>
        <div className="text-secondary">{fmt(b.value)}</div>
        {b.key === "expected" && (
          <>
            <div className="text-secondary">
              {t("chart.waterfall.realized", "Réalisé")} : {fmt(b.realized)}
            </div>
            <div className="text-secondary">
              {t("chart.waterfall.remaining", "Reste à faire")} : {fmt(b.remaining)}
            </div>
          </>
        )}
      </div>
    );
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap justify-end gap-3 text-[11px] text-secondary">
        {(
          [
            ["realized", t("chart.waterfall.realized", "Réalisé")],
            ["remaining", t("chart.waterfall.remaining", "Reste à faire")],
            ["up", t("chart.waterfall.increase", "Hausse")],
            ["down", t("chart.waterfall.decrease", "Baisse")],
          ] as const
        ).map(([k, label]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: COLORS[k] }}
            />
            {label}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={bars} margin={{ top: 20, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `€${v}M`}
          />
          <Tooltip content={tooltip} cursor={false} />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="up" stackId="w" isAnimationActive={false}>
            {bars.map((b) => (
              <Cell key={b.key} fill={b.key === "initial" ? COLORS.total : COLORS.up} />
            ))}
            <LabelList
              dataKey="up"
              position="top"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(v: any) => (typeof v === "number" && v > 0 ? fmt(v) : "")}
              style={{ fontSize: 10, fontWeight: 600 }}
            />
          </Bar>
          <Bar dataKey="down" stackId="w" fill={COLORS.down} isAnimationActive={false}>
            <LabelList
              dataKey="down"
              position="top"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(v: any) => (typeof v === "number" && v > 0 ? `−${fmt(v)}` : "")}
              style={{ fontSize: 10, fontWeight: 600 }}
            />
          </Bar>
          <Bar dataKey="realized" stackId="w" fill={COLORS.realized} isAnimationActive={false} />
          <Bar dataKey="remaining" stackId="w" fill={COLORS.remaining} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-2 text-[11px] text-tertiary">
        {t(
          "chart.waterfall.note",
          "Total attendu = réactualisé − retards − coûts. Leviers annulés exclus des totaux."
        )}
        {oneOffGains > 0 &&
          ` ${t("chart.waterfall.oneOff", "Gains ponctuels (hors totaux)")} : ${fmt(oneOffGains)}.`}
      </p>
    </div>
  );
}
