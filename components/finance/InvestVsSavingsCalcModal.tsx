"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/shared/Modal";
import { InvestVsSavingsLeverTable } from "@/components/finance/InvestVsSavingsModal";
import { useTranslation } from "@/lib/i18n/useTranslation";
import * as engine from "@/lib/engine";
import { buildInvestVsSavingsCalc } from "@/lib/investVsSavingsCalc";
import type { FinanceGranularity, InvestVsSavingsPoint } from "@/lib/financeCosts";
import type { BeTrackData } from "@/types";

type CalcLine = {
  key: string;
  sign: "+" | "−" | "=" | "";
  label: string;
  value: string;
  negative?: boolean;
  strong?: boolean;
  formula: string;
};

/** Pop-up "détail du calcul" du graphique "Coût d'investissement vs Savings" : ligne de calcul
 *  complète (gains bruts → OPEX → gains nets → CAPEX/OPEX ponctuels → résultat net → cumul → ROI →
 *  délai de retour) pour une période ou pour l'horizon complet ("Total"), top 5 des leviers
 *  contributeurs (cliquables vers la fiche levier) et détail chantier → levier repliable. Les
 *  montants proviennent de `buildInvestVsSavingsCalc` (lib/investVsSavingsCalc.ts), qui réutilise
 *  les sélecteurs du graphique — aucune formule dupliquée ici. */
export function InvestVsSavingsCalcModal({
  data,
  granularity,
  points,
  periodKey,
  onPeriodChange,
  onClose,
}: {
  data: BeTrackData;
  granularity: FinanceGranularity;
  points: InvestVsSavingsPoint[];
  /** `undefined` = fermé, `null` = vue Total, sinon clé de la période affichée. */
  periodKey: string | null | undefined;
  onPeriodChange: (key: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const open = periodKey !== undefined;
  const calc = useMemo(
    () =>
      periodKey === undefined
        ? null
        : buildInvestVsSavingsCalc(data, granularity, periodKey, points),
    [data, granularity, periodKey, points]
  );
  const fmt = (v: number) => engine.fmtCurr(v);
  const wsName = (id: string) => data.workstreams.find((w) => w.id === id)?.name ?? id;
  const isTotal = periodKey === null;

  const lines: CalcLine[] = calc
    ? [
        {
          key: "gross",
          sign: "+",
          label: t("finance.chart.grossSavings", "Gains bruts"),
          value: fmt(calc.grossSavings),
          formula: t(
            "finance.calc.formula.gross",
            "Σ des gains récurrents datés sur la période (date de gain, sinon début du levier)"
          ),
        },
        {
          key: "opexRec",
          sign: "−",
          label: t("finance.calc.opexRec", "OPEX récurrents"),
          value: fmt(calc.opexRec),
          formula: t(
            "finance.calc.formula.opexRec",
            "Run-rate annuel des OPEX récurrents démarrés sur la période (début du levier)"
          ),
        },
        {
          key: "net",
          sign: "=",
          label: t("finance.chart.netSavings", "Gains nets"),
          value: fmt(calc.netSavings),
          negative: calc.netSavings < 0,
          strong: true,
          formula: t("finance.calc.formula.net", "Gains nets = Gains bruts − OPEX récurrents"),
        },
        {
          key: "capex",
          sign: "−",
          label: t("finance.chart.capex", "CAPEX"),
          value: fmt(calc.capex),
          formula: t(
            "finance.calc.formula.capex",
            "À la date de déploiement, ou lissé au prorata des mois de la période de lissage"
          ),
        },
        {
          key: "oneoff",
          sign: "−",
          label: t("finance.calc.opexOneOff", "OPEX ponctuels"),
          value: fmt(calc.opexOneOff),
          formula: t("finance.calc.formula.oneoff", "Coûts one-off, à la date de début du levier"),
        },
        {
          key: "invest",
          sign: "",
          label: t("finance.chart.investCost", "Coût d'investissement"),
          value: fmt(calc.investCost),
          formula: t(
            "finance.calc.formula.invest",
            "Coût d'investissement = CAPEX + OPEX ponctuels"
          ),
        },
        {
          key: "result",
          sign: "=",
          label: isTotal
            ? t("finance.calc.netResultTotal", "Résultat net de l'horizon")
            : t("finance.chart.netPeriodResult", "Résultat net de la période"),
          value: fmt(calc.netResult),
          negative: calc.netResult < 0,
          strong: true,
          formula: t(
            "finance.calc.formula.result",
            "Résultat net = Gains nets − CAPEX − OPEX ponctuels (barre du graphique)"
          ),
        },
        {
          key: "cumul",
          sign: "",
          label: t("finance.chart.netCumulative", "Cumul net"),
          value: fmt(calc.cumulative),
          negative: calc.cumulative < 0,
          formula: isTotal
            ? t("finance.calc.formula.cumulTotal", "Cumul des résultats nets à la fin de l'horizon")
            : t(
                "finance.calc.formula.cumul",
                "Cumul = Σ des résultats nets depuis la 1re période jusqu'à celle-ci"
              ),
        },
        {
          key: "roi",
          sign: "",
          label: t("finance.calc.roi", "ROI"),
          value:
            calc.roiPct === null
              ? t("finance.calc.notApplicable", "n/a (aucun investissement)")
              : `${calc.roiPct.toLocaleString()} %`,
          negative: (calc.roiPct ?? 0) < 0,
          formula: t("finance.calc.formula.roi", "ROI = Résultat net ÷ Coût d'investissement"),
        },
        {
          key: "payback",
          sign: "",
          label: t("lever.payback", "Délai de retour"),
          value: calc.paybackLabel
            ? `${calc.paybackLabel} (${t("finance.calc.periodsCount", "{n} périodes").replace(
                "{n}",
                String(calc.paybackPeriods)
              )})`
            : t("finance.calc.notReached", "Non atteint"),
          formula: t(
            "finance.calc.formula.payback",
            "1re période où le cumul net repasse ≥ 0 après avoir été négatif (tout l'horizon)"
          ),
        },
      ]
    : [];

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`${t("finance.calc.title", "Détail du calcul")} — ${calc?.periodLabel ?? ""}`}
      maxWidth="820px"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
        <label htmlFor="ivs-calc-period" className="text-tertiary">
          {t("finance.calc.scope", "Période")}
        </label>
        <select
          id="ivs-calc-period"
          className="rounded-md border border-border bg-white px-2 py-1 text-[12px] text-primary"
          value={periodKey ?? "__total__"}
          onChange={(e) => onPeriodChange(e.target.value === "__total__" ? null : e.target.value)}
        >
          <option value="__total__">{t("finance.calc.totalView", "Total (tout l'horizon)")}</option>
          {points.map((p) => (
            <option key={p.sortKey} value={p.sortKey}>
              {p.period}
            </option>
          ))}
        </select>
      </div>

      {!calc ? (
        <p className="py-6 text-center text-sm text-tertiary">
          {t("finance.drilldown.empty", "Aucun levier ne contribue à ce montant.")}
        </p>
      ) : (
        <div className="space-y-5">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border text-[11px] text-tertiary">
                  <th className="w-6 px-2 py-1.5 text-center" />
                  <th className="px-2 py-1.5 text-left">{t("finance.calc.line", "Ligne")}</th>
                  <th className="px-2 py-1.5 text-right">{t("finance.calc.value", "Valeur")}</th>
                  <th className="px-2 py-1.5 text-left">{t("finance.calc.formula", "Calcul")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr
                    key={l.key}
                    className={`border-b border-border/50 ${l.strong ? "bg-neutral-50 font-semibold text-primary" : ""}`}
                  >
                    <td className="px-2 py-1.5 text-center font-semibold text-tertiary">
                      {l.sign}
                    </td>
                    <td className="px-2 py-1.5">{l.label}</td>
                    <td
                      className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${
                        l.negative ? "text-bp-coral" : ""
                      }`}
                    >
                      {l.value}
                    </td>
                    <td className="px-2 py-1.5 text-[11px] font-normal text-tertiary">
                      {l.formula}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {calc.topLevers.length > 0 && (
            <div>
              <p className="mb-1.5 text-[12px] font-semibold text-primary">
                {t("finance.calc.topLevers", "Top 5 des leviers contributeurs")}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border text-[11px] text-tertiary">
                      <th className="px-2 py-1.5 text-left">
                        {t("finance.chart.lever", "Levier")}
                      </th>
                      <th className="px-2 py-1.5 text-left">
                        {t("finance.chart.byWorkstream", "Par chantier")}
                      </th>
                      <th className="px-2 py-1.5 text-right">
                        {t("finance.chart.grossSavings", "Gains bruts")}
                      </th>
                      <th className="px-2 py-1.5 text-right">
                        {t("finance.calc.costs", "Coûts (OPEX + CAPEX)")}
                      </th>
                      <th className="px-2 py-1.5 text-right">
                        {t("finance.chart.netEconomy", "Économie nette")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {calc.topLevers.map((r) => (
                      <tr
                        key={r.leverId}
                        className="cursor-pointer border-b border-border/50 hover:bg-neutral-50"
                        onClick={() => router.push(`/levers/detail?id=${r.leverId}`)}
                        title={t("finance.calc.openLever", "Ouvrir la fiche levier")}
                      >
                        <td className="px-2 py-1.5 text-secondary underline-offset-2 hover:underline">
                          {r.leverCode} — {r.leverName}
                        </td>
                        <td className="px-2 py-1.5 text-tertiary">{wsName(r.wsId)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {fmt(r.grossSavings)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {fmt(r.opexRec + r.opexOneOff + r.capex)}
                        </td>
                        <td
                          className={`px-2 py-1.5 text-right font-semibold tabular-nums ${
                            r.net < 0 ? "text-bp-coral" : ""
                          }`}
                        >
                          {fmt(r.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <details>
            <summary className="cursor-pointer text-[12px] font-semibold text-primary">
              {t("finance.calc.fullBreakdown", "Détail complet par chantier et levier")}
            </summary>
            <div className="mt-2">
              <InvestVsSavingsLeverTable
                rows={calc.rows}
                workstreams={data.workstreams}
                formatValue={fmt}
              />
            </div>
          </details>
        </div>
      )}
    </Modal>
  );
}
