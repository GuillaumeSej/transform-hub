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
import { impactTrajectory, type TrajectoryGranularity } from "@/lib/engine";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Lever } from "@/types";

const toggleBtn = (active: boolean) =>
  `px-3 py-1 text-xs font-semibold ${active ? "bg-black text-white" : "bg-white text-secondary"}`;

/** Trajectoire d'impact d'un levier (remplace la « courbe en J ») : barres par période
 *  (un impact récurrent est compté à sa date de début puis à chaque anniversaire) + cumul net,
 *  curseur « Aujourd'hui ». Vue financière ou ETP, maille mois/trimestre/année. */
export function ImpactTrajectoryChart({ lever, height = 320 }: { lever: Lever; height?: number }) {
  const { t } = useTranslation();
  const [view, setView] = useState<"financial" | "fte">("financial");
  const [picked, setPicked] = useState<TrajectoryGranularity | null>(null);
  // Maille automatique selon la durée totale (lisibilité), modifiable par l'utilisateur.
  const autoGranularity = useMemo<TrajectoryGranularity>(() => {
    const n = impactTrajectory(lever, { view: "financial", granularity: "month" }).points.length;
    return n <= 30 ? "month" : n <= 72 ? "quarter" : "year";
  }, [lever]);
  const granularity = picked ?? autoGranularity;
  const setGranularity = setPicked;

  const traj = useMemo(
    () => impactTrajectory(lever, { view, granularity, today: new Date() }),
    [lever, view, granularity]
  );

  const data = traj.points.map((p) => ({
    period: p.period,
    gains: p.gains,
    oneOffGains: p.oneOffGains,
    opexRec: -p.opexRec,
    opexOneOff: -p.opexOneOff,
    capex: -p.capex,
    cumulativeNet: p.cumulativeNet,
    cumulativeNetRecurring: p.cumulativeNetRecurring,
    fte: p.fte,
  }));
  const todayPeriod = traj.points[traj.todayIndex]?.period;
  const fmt = (v: number) => (Math.round(v * 100) / 100).toString();

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-md border border-border">
          <button className={toggleBtn(view === "financial")} onClick={() => setView("financial")}>
            {t("leverDetail.trajectory.financial", "Impact financier")}
          </button>
          <button className={toggleBtn(view === "fte")} onClick={() => setView("fte")}>
            {t("leverDetail.trajectory.fte", "Impact ETP")}
          </button>
        </div>
        <div className="flex overflow-hidden rounded-md border border-border">
          {(
            [
              ["month", t("leverDetail.trajectory.month", "Mois")],
              ["quarter", t("leverDetail.trajectory.quarter", "Trimestre")],
              ["year", t("leverDetail.trajectory.year", "Année")],
            ] as [TrajectoryGranularity, string][]
          ).map(([g, label]) => (
            <button
              key={g}
              className={toggleBtn(granularity === g)}
              onClick={() => setGranularity(g)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-tertiary">
          {t("chart.noDataToDisplay", "Aucune donnée à afficher.")}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 10 }} minTickGap={16} />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={fmt}
              label={{
                value: view === "fte" ? "ETP" : "€M",
                angle: -90,
                position: "insideLeft",
                fontSize: 10,
              }}
            />
            <Tooltip formatter={(v) => fmt(Number(v ?? 0))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#999" />
            {todayPeriod && (
              <ReferenceLine
                x={todayPeriod}
                stroke="#525252"
                strokeDasharray="4 3"
                label={{
                  value: t("shared.actionGantt.today", "Aujourd'hui"),
                  position: "top",
                  fontSize: 10,
                }}
              />
            )}
            {view === "financial" ? (
              <>
                <Bar
                  dataKey="gains"
                  stackId="s"
                  fill="#3f9d6a"
                  name={t(
                    "leverDetail.trajectory.gains",
                    "Gains annualisés (à la date de début, puis chaque anniversaire)"
                  )}
                />
                <Bar
                  dataKey="oneOffGains"
                  stackId="s"
                  fill="#a7d9bd"
                  name={t("leverDetail.trajectory.oneOffGains", "Gains ponctuels (non comptés)")}
                />
                <Bar
                  dataKey="opexRec"
                  stackId="s"
                  fill="#e0655a"
                  name={t(
                    "leverDetail.trajectory.opexRec",
                    "OPEX récurrent (début puis anniversaires)"
                  )}
                />
                <Bar
                  dataKey="opexOneOff"
                  stackId="s"
                  fill="#f0a59d"
                  name={t("leverDetail.trajectory.opexOneOff", "OPEX one-off")}
                />
                <Bar
                  dataKey="capex"
                  stackId="s"
                  fill="#3b82c4"
                  name={t("leverDetail.trajectory.capex", "CAPEX (ponctuel ou lissé)")}
                />
                <Line
                  type="stepAfter"
                  dataKey="cumulativeNet"
                  stroke="#111"
                  strokeWidth={2}
                  dot={false}
                  name={t("leverDetail.trajectory.cumNet", "Net cumulé (avec ponctuels)")}
                />
                <Line
                  type="stepAfter"
                  dataKey="cumulativeNetRecurring"
                  stroke="#111"
                  strokeDasharray="5 4"
                  dot={false}
                  name={t("leverDetail.trajectory.cumNetRec", "Net cumulé (hors ponctuels)")}
                />
              </>
            ) : (
              <Line
                type="stepAfter"
                dataKey="fte"
                stroke="#3b82c4"
                strokeWidth={2}
                dot={false}
                name={t(
                  "leverDetail.trajectory.fteCum",
                  "ETP cumulés (+ recrutements / − départs)"
                )}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
