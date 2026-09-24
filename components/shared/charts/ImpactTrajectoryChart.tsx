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
import { formatMillions } from "@/lib/format";

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
  // Simplifié à 2 barres (gains / coûts), chacune partant de l'axe des abscisses (0) — le détail
  // par catégorie (CAPEX, OPEX, gain récurrent/one-off…) s'obtient au clic (`PeriodDetail`).
  // Invariant visuel : gains toujours ≥ 0 (barre au-dessus de l'axe, vert), coûts toujours ≤ 0
  // (barre sous l'axe, rouge) — jamais l'inverse. Par construction, `p.gains`/`p.oneOffGains` et
  // `p.opexRec`/`p.opexOneOff`/`p.capex` sont des sommes de `imp.amount`, un montant saisi ≥ 0
  // (input `min={0}` dans ImpactsEditor) : les sommes ne peuvent donc pas être négatives. Le
  // clamp ci-dessous est une garde défensive (jamais censée changer la valeur) plutôt qu'un
  // correctif de données : si elle se déclenchait un jour, ce serait le signe d'un vrai bug de
  // données en amont (ex. montant négatif injecté hors UI) à investiguer, pas à masquer.
  const data = traj.points.map((p) => ({
    key: p.periodStart,
    period: p.period,
    gain: Math.max(0, p.gains + p.oneOffGains),
    cost: Math.min(0, -(p.opexRec + p.opexOneOff + p.capex)),
    cumulativeNet: p.cumulativeNet,
    fte: p.fte,
  }));
  const labelOf = new Map(data.map((d) => [d.key, d.period]));
  const todayKey = traj.points[traj.todayIndex]?.periodStart;
  const fmt = (v: number) => (Math.round(v * 100) / 100).toString();

  // Échelle Y explicite (au lieu de l'auto-scale par défaut de recharts) : sans elle, une seule
  // barre/valeur isolée très supérieure aux autres écrase visuellement le détail du reste du
  // graphique ("toujours tassé", retour testeur). On calcule le domaine réel couvert par tout ce
  // qui se trace sur cet axe (barres empilées gain/coût + ligne cumulée en vue "Impact financier",
  // ou la seule ligne ETP en vue "Impact ETP"), avec une marge de ~12 % au-dessus/en-dessous, puis
  // on arrondit à une valeur "ronde" (1/2/5 × 10^n) pour des graduations lisibles. `0` reste
  // toujours dans le domaine (inclus dans les valeurs avant marge) pour que la ligne de référence
  // à 0 (`ReferenceLine y={0}`) reste visible.
  const yDomain = useMemo<[number, number]>(() => {
    if (data.length === 0) return [0, 1];
    const values =
      view === "fte"
        ? data.map((d) => d.fte)
        : data.flatMap((d) => [d.gain, d.cost, d.cumulativeNet]);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    if (min === 0 && max === 0) return [-1, 1];
    const span = max - min;
    const pad = span * 0.12 || Math.max(Math.abs(min), Math.abs(max)) * 0.12 || 1;
    const niceBound = (v: number): number => {
      if (v === 0) return 0;
      const sign = Math.sign(v);
      const abs = Math.abs(v);
      const magnitude = Math.pow(10, Math.floor(Math.log10(abs)));
      const norm = abs / magnitude;
      const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
      return sign * step * magnitude;
    };
    return [niceBound(min - pad), niceBound(max + pad)];
  }, [data, view]);
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
    { key: "gain", label: t("leverDetail.trajectory.legendGains", "Gains"), color: "#3f9d6a" },
    {
      key: "cost",
      label: t("leverDetail.trajectory.legendCosts", "Coûts (OPEX + CAPEX)"),
      color: "#e0655a",
    },
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
          {/* stackOffset="sign" est OBLIGATOIRE ici : sans lui, Recharts empile "gain" et "cost"
              cumulativement dans l'ordre de déclaration (comme un stacked bar classique) au lieu de
              diverger par signe autour de 0 — dès que |cost| < gain sur une période, la barre coût
              se retrouvait rendue entre `gain` et `gain + cost` (donc AU-DESSUS de l'axe, empilée
              sur le vert) au lieu de partir de 0 vers le bas. "sign" force le stack positif à partir
              de 0 vers le haut et le stack négatif à partir de 0 vers le bas, indépendamment. */}
          <ComposedChart
            data={data}
            stackOffset="sign"
            margin={{ top: 16, right: 16, left: 0, bottom: 0 }}
          >
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
              domain={yDomain}
              allowDataOverflow={false}
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
                <Bar dataKey="gain" fill="#806659" {...barProps} />
                <Bar dataKey="cost" fill="#FF3C47" {...barProps} />
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
                stroke="#320300"
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

const fmtAmt = (v: number) => formatMillions(v, 2);

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
                <span
                  className={`shrink-0 font-semibold tabular-nums ${
                    g.sign === "+" ? "text-rag-green-dark" : "text-rag-red"
                  }`}
                >
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
