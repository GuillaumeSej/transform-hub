"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { Modal } from "@/components/shared/Modal";
import {
  impactTrajectory,
  type ImpactTrajectoryPoint,
  type TrajectoryGranularity,
  type TrajectoryItem,
} from "@/lib/engine";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Lever } from "@/types";

const toggleBtn = (active: boolean) =>
  `px-3 py-1 text-xs font-semibold ${active ? "bg-black text-white" : "bg-white text-secondary"}`;

/** « Trajectoire des gains » d'un levier : barres par période (gains au-dessus de l'axe, coûts
 *  en dessous ; montants annualisés lissés mois par mois) + cumul net, curseur « Aujourd'hui ».
 *  Pas de tooltip : un clic sur une période ouvre le détail des impacts sources. */
export function ImpactTrajectoryChart({ lever, height = 320 }: { lever: Lever; height?: number }) {
  const { t } = useTranslation();
  const [view, setView] = useState<"financial" | "fte">("financial");
  const [detail, setDetail] = useState<ImpactTrajectoryPoint | null>(null);
  const [picked, setPicked] = useState<TrajectoryGranularity | null>(null);
  // Maille automatique selon la durée totale (lisibilité), modifiable par l'utilisateur.
  const autoGranularity = useMemo<TrajectoryGranularity>(() => {
    const n = impactTrajectory(lever, { view: "financial", granularity: "month" }).points.length;
    return n <= 30 ? "month" : n <= 72 ? "quarter" : "year";
  }, [lever]);
  const granularity = picked ?? autoGranularity;
  const setGranularity = setPicked;

  const traj = useMemo(
    () => impactTrajectory(lever, { view, granularity, today: new Date(), smoothRecurring: true }),
    [lever, view, granularity]
  );

  // Clé d'axe = début de période (unique, triable) ; libellé affiché via tickFormatter : une même
  // période occupe donc toujours la même position pour les barres, les lignes et le curseur.
  const data = traj.points.map((p) => ({
    key: p.periodStart,
    period: p.period,
    gain: p.gains + p.oneOffGains - p.planned.gains - p.planned.oneOffGains,
    opex: -(p.opexRec + p.opexOneOff - p.planned.opexRec - p.planned.opexOneOff),
    capex: -(p.capex - p.planned.capex),
    gainPlanned: p.planned.gains + p.planned.oneOffGains,
    opexPlanned: -(p.planned.opexRec + p.planned.opexOneOff),
    capexPlanned: -p.planned.capex,
    cumulativeNet: p.cumulativeNet,
    fte: p.fte,
  }));
  const labelOf = new Map(data.map((d) => [d.key, d.period]));
  const todayKey = traj.points[traj.todayIndex]?.periodStart;
  const fmt = (v: number) => (Math.round(v * 100) / 100).toString();
  const openDetail = (key?: string) => {
    if (view !== "financial" || !key) return;
    const pt = traj.points.find((p) => p.periodStart === key);
    if (pt) setDetail(pt);
  };
  const barProps = {
    stackId: "s",
    cursor: "pointer",
    isAnimationActive: false,
    onClick: (d: { payload?: { key?: string } }) => openDetail(d?.payload?.key),
  };

  const CATS = [
    { key: "gain", label: t("leverDetail.trajectory.legendGain", "Gain"), color: "#3f9d6a" },
    { key: "opex", label: "OPEX", color: "#e0655a" },
    { key: "capex", label: "CAPEX", color: "#3b82c4" },
  ];

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
        {view === "financial" && (
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-secondary">
            {CATS.map((c) => (
              <span key={c.key} className="flex items-center gap-1">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: c.color }}
                />
                {c.label}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-4 bg-black" />
              {t("leverDetail.trajectory.cumNet", "Net cumulé")}
            </span>
          </div>
        )}
      </div>
      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-tertiary">
          {t("chart.noDataToDisplay", "Aucune donnée à afficher.")}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="key"
              tick={{ fontSize: 10 }}
              minTickGap={16}
              tickFormatter={(k: string) => labelOf.get(k) ?? k}
            />
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
            <ReferenceLine y={0} stroke="#999" />
            {todayKey && (
              <ReferenceLine
                x={todayKey}
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
                <Bar dataKey="gain" fill="#3f9d6a" {...barProps} />
                <Bar dataKey="opex" fill="#e0655a" {...barProps} />
                <Bar dataKey="capex" fill="#3b82c4" {...barProps} />
                <Bar
                  dataKey="gainPlanned"
                  fill="#3f9d6a"
                  fillOpacity={0.3}
                  stroke="#3f9d6a"
                  strokeDasharray="3 2"
                  {...barProps}
                />
                <Bar
                  dataKey="opexPlanned"
                  fill="#e0655a"
                  fillOpacity={0.3}
                  stroke="#e0655a"
                  strokeDasharray="3 2"
                  {...barProps}
                />
                <Bar
                  dataKey="capexPlanned"
                  fill="#3b82c4"
                  fillOpacity={0.3}
                  stroke="#3b82c4"
                  strokeDasharray="3 2"
                  {...barProps}
                />
                <Line
                  type="monotone"
                  dataKey="cumulativeNet"
                  stroke="#111"
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
              </>
            ) : (
              <Line
                type="stepAfter"
                dataKey="fte"
                stroke="#3b82c4"
                strokeWidth={2}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
      {view === "financial" && data.length > 0 && (
        <p className="mt-1 text-[10px] text-tertiary">
          {t(
            "leverDetail.trajectory.clickHint",
            "Cliquez sur une barre pour voir le détail de la période. Montants annualisés lissés mois par mois."
          )}
        </p>
      )}
      <Modal
        open={detail !== null}
        onOpenChange={(o) => !o && setDetail(null)}
        title={`${t("leverDetail.trajectory.detailTitle", "Détail")} — ${detail?.period ?? ""}`}
        maxWidth="560px"
      >
        {detail && <PeriodDetail point={detail} />}
      </Modal>
    </div>
  );
}

const fmtAmt = (v: number) => `${(Math.round(v * 100) / 100).toLocaleString("fr-FR")} €M`;

function PeriodDetail({ point }: { point: ImpactTrajectoryPoint }) {
  const { t } = useTranslation();
  const groups: { title: string; sign: string; items: TrajectoryItem[] }[] = [
    {
      title: t("leverDetail.trajectory.detailGainRec", "Gains récurrents"),
      sign: "+",
      items: point.items.filter((i) => i.category === "gain" && i.recurrence === "recurring"),
    },
    {
      title: t("leverDetail.trajectory.detailGainOneOff", "Gains one-off"),
      sign: "+",
      items: point.items.filter((i) => i.category === "gain" && i.recurrence === "oneoff"),
    },
    {
      title: t("leverDetail.trajectory.detailOpexOneOff", "OPEX one-off"),
      sign: "−",
      items: point.items.filter((i) => i.category === "opex" && i.recurrence === "oneoff"),
    },
    {
      title: t("leverDetail.trajectory.detailOpexRec", "OPEX récurrent"),
      sign: "−",
      items: point.items.filter((i) => i.category === "opex" && i.recurrence === "recurring"),
    },
    { title: "CAPEX", sign: "−", items: point.items.filter((i) => i.category === "capex") },
  ].filter((g) => g.items.length > 0);
  if (groups.length === 0)
    return (
      <p className="text-sm text-tertiary">
        {t("leverDetail.trajectory.detailEmpty", "Aucun impact sur cette période.")}
      </p>
    );
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.title}>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
            {g.title}
          </h4>
          <ul className="divide-y divide-border rounded-sm border border-border">
            {g.items.map((it, i) => (
              <li
                key={`${it.impactId}-${i}`}
                className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs"
              >
                <span className="truncate text-primary">
                  {it.label || t("impactsEditor.untitled", "Impact sans libellé")}
                  {it.planned && (
                    <span className="ml-2 text-[10px] text-tertiary">
                      {t("impactsEditor.statusPlanned", "Planifié")}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {g.sign}
                  {fmtAmt(it.amount)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
