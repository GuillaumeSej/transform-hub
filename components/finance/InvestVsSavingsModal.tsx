"use client";

import { Fragment } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/shared/Modal";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { InvestVsSavingsLeverRow } from "@/lib/financeCosts";
import type { Workstream } from "@/types";

/** Pop-up de détail d'une période du graphique "Coût d'investissement vs Savings" : par chantier
 *  puis par levier — gains bruts, OPEX, CAPEX, économie nette (négative en rouge). */
export function InvestVsSavingsModal({
  open,
  onOpenChange,
  title,
  rows,
  workstreams,
  formatValue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  rows: InvestVsSavingsLeverRow[];
  workstreams: Workstream[];
  formatValue: (v: number) => string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const wsName = (id: string) => workstreams.find((w) => w.id === id)?.name ?? id;
  const sum = (k: keyof InvestVsSavingsLeverRow, list: InvestVsSavingsLeverRow[]) =>
    list.reduce((s, r) => s + (r[k] as number), 0);
  const wsIds = Array.from(new Set(rows.map((r) => r.wsId)));
  const cols: { key: keyof InvestVsSavingsLeverRow; label: string }[] = [
    { key: "grossSavings", label: t("finance.chart.grossSavings", "Gains bruts") },
    { key: "opexRec", label: t("finance.chart.opexRec", "OPEX récurrent") },
    { key: "opexOneOff", label: t("finance.chart.opexOneOff", "OPEX ponctuel") },
    { key: "capex", label: t("finance.chart.capex", "CAPEX") },
    { key: "net", label: t("finance.chart.netEconomy", "Économie nette") },
  ];
  const cell = (v: number, strong = false) => (
    <td
      className={`px-2 py-1.5 text-right tabular-nums ${strong ? "font-semibold" : ""} ${
        strong && v < 0 ? "text-bp-coral" : ""
      }`}
    >
      {formatValue(v)}
    </td>
  );
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} maxWidth="760px">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-tertiary">
          {t("finance.drilldown.empty", "Aucun levier ne contribue à ce montant.")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-[11px] text-tertiary">
                <th className="px-2 py-1.5 text-left">{t("finance.chart.lever", "Levier")}</th>
                {cols.map((c) => (
                  <th key={c.key} className="px-2 py-1.5 text-right">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wsIds.map((id) => {
                const list = rows.filter((r) => r.wsId === id);
                return (
                  <Fragment key={id}>
                    <tr className="bg-neutral-50 font-semibold text-primary">
                      <td className="px-2 py-1.5">{wsName(id)}</td>
                      {cols.map((c) => (
                        <Fragment key={c.key}>{cell(sum(c.key, list), c.key === "net")}</Fragment>
                      ))}
                    </tr>
                    {list.map((r) => (
                      <tr
                        key={r.leverId}
                        className="cursor-pointer border-b border-border/50 hover:bg-neutral-50"
                        onClick={() => router.push(`/levers/detail?id=${r.leverId}`)}
                      >
                        <td className="px-2 py-1.5 pl-5 text-secondary">
                          {r.leverCode} — {r.leverName}
                        </td>
                        {cols.map((c) => (
                          <Fragment key={c.key}>
                            {cell(r[c.key] as number, c.key === "net")}
                          </Fragment>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
              <tr className="border-t-2 border-border font-bold text-primary">
                <td className="px-2 py-1.5">{t("finance.drilldown.totalLabel", "Total")}</td>
                {cols.map((c) => (
                  <Fragment key={c.key}>{cell(sum(c.key, rows), c.key === "net")}</Fragment>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
