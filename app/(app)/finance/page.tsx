"use client";

import { useMemo } from "react";
import { LineChart } from "lucide-react";
import { useRole } from "@/lib/hooks/useRole";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import * as engine from "@/lib/engine";
import { useTranslation } from "@/lib/i18n/useTranslation";

/**
 * Module Finance — encore un STRETCH (baseline P&L éditable, reforecast, waterfall à venir).
 * Le budget CAPEX de référence a été retiré (voir historique) ; ce module n'affiche pour
 * l'instant que le compte de résultat configuré, consolidé depuis l'arborescence financière.
 */
export default function FinancePage() {
  const { t } = useTranslation();
  const { user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);
  const pnlRows = useMemo(() => engine.pnlImpactDetailed(data), [data]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <LineChart size={22} className="text-bp-coral" />
        <h1 className="text-xl font-bold text-text-primary">
          {t("nav.financeModule", "Finance Module")}
        </h1>
      </div>

      <Card>
        <CardHeader title={t("finance.pnlConfiguredTitle", "Compte de résultat configuré")} />
        <CardBody>
          <p className="mb-4 text-sm text-text-secondary">
            {t(
              "finance.pnlConfiguredHint",
              "Les lignes ci-dessous proviennent directement de l'arborescence financière définie par l'administrateur global. Les impacts des leviers sont consolidés automatiquement."
            )}
          </p>
          <div className="hidden overflow-x-auto rounded-lg border border-border sm:block">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs text-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">{t("finance.pnlLine", "Ligne P&L")}</th>
                  <th className="px-3 py-2 text-right">{t("finance.baseline", "Baseline")}</th>
                  <th className="px-3 py-2 text-right">{t("chart.pnl.plan", "Plan")}</th>
                  <th className="px-3 py-2 text-right">{t("levers.realized", "Réalisé")}</th>
                </tr>
              </thead>
              <tbody>
                {data.pnlAccounts.map((account) => {
                  const impact = pnlRows.find((row) => row.accountId === account.id);
                  return (
                    <tr key={account.id} className="border-t border-border">
                      <td className="px-3 py-2 font-semibold text-primary">
                        {account.name}
                        {account.selectable === false ? (
                          <span className="ml-2 text-[10px] font-normal text-tertiary">
                            {t("finance.notAllocatable", "Non imputable")}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right">{engine.fmtCurr(account.baseline)}</td>
                      <td className="px-3 py-2 text-right">{engine.fmtCurr(impact?.plan ?? 0)}</td>
                      <td className="px-3 py-2 text-right">
                        {engine.fmtCurr(impact?.realized ?? 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 sm:hidden">
            {data.pnlAccounts.map((account) => {
              const impact = pnlRows.find((row) => row.accountId === account.id);
              return (
                <div key={account.id} className="rounded-lg border border-border p-3">
                  <div className="font-semibold text-primary">{account.name}</div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-tertiary">{t("finance.baseline", "Baseline")}</dt>
                      <dd>{engine.fmtCurr(account.baseline)}</dd>
                    </div>
                    <div>
                      <dt className="text-tertiary">{t("chart.pnl.plan", "Plan")}</dt>
                      <dd>{engine.fmtCurr(impact?.plan ?? 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-tertiary">{t("levers.realized", "Réalisé")}</dt>
                      <dd>{engine.fmtCurr(impact?.realized ?? 0)}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
