"use client";

import { useTranslation } from "@/lib/i18n/useTranslation";

/** Sélecteur mois/trimestre/année générique — extrait du sélecteur mois/trimestre/année propre au
 *  dashboard RH (`app/(app)/hr/page.tsx`, "timeControls") pour être réutilisé tel quel par les
 *  graphiques temporels du module Finance plutôt que de le redupliquer une 3e fois. */
export function GranularityToggle<G extends "month" | "quarter" | "year">({
  value,
  onChange,
  options = ["month", "quarter", "year"] as G[],
}: {
  value: G;
  onChange: (g: G) => void;
  /** Sous-ensemble de granularités proposées — par défaut les 3 (mois/trimestre/année). */
  options?: G[];
}) {
  const { t } = useTranslation();
  const labels: Record<"month" | "quarter" | "year", string> = {
    month: t("hr.granularity.month", "Mois"),
    quarter: t("hr.granularity.quarter", "Trim."),
    year: t("hr.granularity.year", "Année"),
  };
  return (
    <div className="flex overflow-hidden rounded-md border border-border">
      {options.map((g) => (
        <button
          key={g}
          type="button"
          onClick={() => onChange(g)}
          className={`px-2.5 py-1 text-[11px] font-semibold transition ${
            value === g ? "bg-neutral-900 text-white" : "bg-white text-secondary hover:text-primary"
          }`}
        >
          {labels[g]}
        </button>
      ))}
    </div>
  );
}
