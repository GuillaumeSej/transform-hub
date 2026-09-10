"use client";

import { cn } from "@/lib/utils";
import { fmtCurr } from "@/lib/engine";
import { useTranslation } from "@/lib/i18n/useTranslation";

/**
 * Jauge de synthèse « Coût social — budgété vs réel ».
 *
 * Lecture immédiate « dans les clous ou pas » : le coût social RÉACTUALISÉ (réel) est comparé au
 * coût social BUDGÉTÉ (plan figé). Un dépassement (réel > budgété) est signalé en corail, une
 * tenue du budget en vert. La barre porte un repère à la position du budget : si la barre le
 * franchit, on dépasse.
 *
 * Alimentée par `hrProgramSummary().socialCost` — `target` = budgété (lockedPlan), `reforecast` =
 * réel (reforecast). Aucun recalcul métier ici : composant purement présentational.
 */
export function SocialCostBudgetGauge({
  budget,
  actual,
}: {
  /** Coût social budgété total (€). */
  budget: number;
  /** Coût social réel / réactualisé total (€). */
  actual: number;
}) {
  const { t } = useTranslation();

  const variance = actual - budget; // > 0 = dépassement de budget (défavorable pour un coût)
  const variancePct = budget > 0 ? Math.round((variance / budget) * 100) : 0;
  const over = variance > 0;

  // Échelle de la barre : la plus grande des deux valeurs occupe toute la piste.
  const denom = Math.max(budget, actual, 1);
  const budgetMarkerPct = (budget / denom) * 100;
  const actualFillPct = (actual / denom) * 100;

  return (
    <div className="flex flex-col gap-4">
      {/* Deux montants côte à côte */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border-l-[3px] border-neutral-300 pl-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-tertiary">
            {t("hr.socialGauge.budget", "Budgété")}
          </div>
          <div className="mt-1 text-[24px] font-bold leading-none tracking-tight text-primary">
            {fmtCurr(budget / 1_000_000)}
          </div>
        </div>
        <div
          className={cn("border-l-[3px] pl-3", over ? "border-bp-coral" : "border-rag-green-dark")}
        >
          <div className="text-[10px] font-bold uppercase tracking-widest text-tertiary">
            {t("hr.socialGauge.actual", "Réel (réactualisé)")}
          </div>
          <div
            className={cn(
              "mt-1 text-[24px] font-bold leading-none tracking-tight",
              over ? "text-bp-coral" : "text-primary"
            )}
          >
            {fmtCurr(actual / 1_000_000)}
          </div>
        </div>
      </div>

      {/* Barre avec repère budget */}
      <div>
        <div className="relative h-3 overflow-visible rounded-full bg-neutral-100">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              over ? "bg-bp-coral" : "bg-rag-green-dark"
            )}
            style={{ width: `${Math.min(100, actualFillPct)}%` }}
          />
          {/* Repère à la position du budget : franchi = dépassement */}
          <div
            className="absolute -top-1 h-5 w-[2px] bg-neutral-800"
            style={{ left: `${Math.min(100, budgetMarkerPct)}%` }}
            title={t("hr.socialGauge.budgetMarker", "Repère budget")}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-tertiary">
          <span>{t("hr.socialGauge.budgetMarker", "Repère budget")}</span>
          <span>{fmtCurr(denom / 1_000_000)}</span>
        </div>
      </div>

      {/* Verdict écart */}
      <div
        className={cn(
          "flex items-baseline justify-between rounded-sm border px-3 py-2",
          over ? "border-bp-coral/40 bg-bp-coral/5" : "border-rag-green-dark/40 bg-rag-green-dark/5"
        )}
      >
        <span className="text-[11px] font-semibold text-secondary">
          {over
            ? t("hr.socialGauge.overrun", "Dépassement du budget")
            : t("hr.socialGauge.onTrack", "Dans les clous")}
        </span>
        <span
          className={cn(
            "text-[18px] font-bold leading-none tracking-tight tabular-nums",
            over ? "text-bp-coral" : "text-rag-green-dark"
          )}
        >
          {over ? "+" : ""}
          {variancePct}% · {variance >= 0 ? "+" : "−"}
          {fmtCurr(Math.abs(variance) / 1_000_000)}
        </span>
      </div>
    </div>
  );
}
