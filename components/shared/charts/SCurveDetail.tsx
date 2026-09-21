"use client";

import { useState } from "react";
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
import { hexForChantier } from "@/lib/axisLogic";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { WorkstreamSeries } from "@/lib/scurveDetail";
import type { SCurvePoint } from "./SCurveChart";

const fmtM = (v: number) => `€${Math.round(v * 10) / 10}M`;

/** Détail de la trajectoire (contenu de la pop-up ouverte au clic sur la courbe en S) :
 *  barres empilées par chantier (réalisé de la période ou réactualisé cumulé) + tableau
 *  planifié / réactualisé / réalisé / écart par période. */
export function SCurveDetail({
  points,
  byWorkstream,
  onSeeLevers,
}: {
  points: SCurvePoint[];
  byWorkstream: WorkstreamSeries[];
  onSeeLevers?: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"realized" | "reforecast">("realized");
  const chartData = points.map((p, i) => {
    const row: Record<string, number | string> = { month: p.month };
    for (const ws of byWorkstream) {
      row[ws.name] = mode === "realized" ? (ws.actualDelta[i] ?? 0) : (ws.reforecast[i] ?? 0);
    }
    return row;
  });
  const btn = (active: boolean) =>
    `rounded-sm border px-2 py-1 text-[11px] font-semibold ${
      active ? "border-bp-coral bg-bp-coral text-white" : "border-border bg-white text-secondary"
    }`;
  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-primary">
            {t("chart.scurveDetail.byWorkstream", "D'où viennent les économies (par chantier)")}
          </h3>
          <div className="flex gap-1">
            <button
              type="button"
              className={btn(mode === "realized")}
              onClick={() => setMode("realized")}
            >
              {t("chart.scurveDetail.modeRealized", "Réalisé de la période")}
            </button>
            <button
              type="button"
              className={btn(mode === "reforecast")}
              onClick={() => setMode("reforecast")}
            >
              {t("chart.scurveDetail.modeReforecast", "Réactualisé cumulé")}
            </button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `€${v}M`}
            />
            <Tooltip formatter={(v) => fmtM(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {byWorkstream.map((ws) => (
              <Bar key={ws.wsId} dataKey={ws.name} stackId="ws" fill={hexForChantier(ws.name)} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </section>
      <section className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wide text-secondary">
              {[
                t("chart.scurveDetail.period", "Période"),
                t("chart.scurve.planned", "Plan initial"),
                t("chart.scurve.reforecast", "Réactualisé"),
                t("chart.scurve.actual", "Réalisé"),
                t("chart.scurve.gapTotal", "Écart réactualisé − réalisé"),
              ].map((h, i) => (
                <th
                  key={h}
                  className={`border-b border-border bg-neutral-50 px-2 py-2 ${i ? "text-right" : ""}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.month} className="border-b border-border last:border-b-0">
                <td className="px-2 py-1.5 font-semibold text-primary">{p.month}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtM(p.planned)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtM(p.reforecast)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {p.actual === null ? "—" : fmtM(p.actual)}
                </td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                  {p.actual === null ? "—" : fmtM(Math.round((p.reforecast - p.actual) * 10) / 10)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {onSeeLevers && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onSeeLevers}
            className="rounded-sm border border-border bg-white px-3 py-1.5 text-xs font-semibold text-primary hover:bg-neutral-50"
          >
            {t("chart.scurveDetail.seeLevers", "Voir les leviers")}
          </button>
        </div>
      )}
    </div>
  );
}
