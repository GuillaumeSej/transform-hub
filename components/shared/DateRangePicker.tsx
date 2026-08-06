"use client";

import { useMemo } from "react";

/** Compte les mois, trimestres et années couverts par une plage — sert au libellé indicatif
 *  "N mois · N trimestres · N années" du DateRangePicker. */
export function summarizeRange(
  fromISO: string,
  toISO: string
): { months: number; quarters: number; years: number } {
  if (!fromISO || !toISO || fromISO > toISO) return { months: 0, quarters: 0, years: 0 };
  const from = new Date(`${fromISO}T00:00:00`);
  const to = new Date(`${toISO}T00:00:00`);
  const months =
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1;
  return {
    months: Math.max(0, months),
    quarters: Math.max(0, Math.ceil(months / 3)),
    years: Math.max(0, Math.ceil(months / 12)),
  };
}

/**
 * Sélecteur de plage de dates ISO (YYYY-MM-DD) — inputs `type="date"` natifs, sans dépendance
 * calendrier tierce. Utilisé par le Dashboard RH (Gooduelle "Du → Au"), mais volontairement
 * générique pour être réutilisable ailleurs.
 *
 * L'état vit dans l'appelant — ce composant ne persiste rien.
 */
export function DateRangePicker({
  fromISO,
  toISO,
  onChange,
  minISO,
  maxISO,
  ariaLabelFrom = "Date de début",
  ariaLabelTo = "Date de fin",
  showSummary = true,
}: {
  fromISO: string;
  toISO: string;
  onChange: (next: { fromISO: string; toISO: string }) => void;
  minISO?: string;
  maxISO?: string;
  ariaLabelFrom?: string;
  ariaLabelTo?: string;
  showSummary?: boolean;
}) {
  const summary = useMemo(() => summarizeRange(fromISO, toISO), [fromISO, toISO]);
  const inputClass =
    "rounded-sm border border-border px-2 py-1 text-xs focus:border-black focus:outline-none";

  return (
    <div className="inline-flex flex-col gap-1">
      <div className="inline-flex items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
          Du
          <input
            type="date"
            aria-label={ariaLabelFrom}
            className={inputClass}
            value={fromISO}
            min={minISO}
            max={maxISO}
            onChange={(e) => onChange({ fromISO: e.target.value, toISO })}
          />
        </label>
        <label className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
          Au
          <input
            type="date"
            aria-label={ariaLabelTo}
            className={inputClass}
            value={toISO}
            min={minISO}
            max={maxISO}
            onChange={(e) => onChange({ fromISO, toISO: e.target.value })}
          />
        </label>
      </div>
      {showSummary && summary.months > 0 && (
        <span className="text-[10.5px] text-tertiary">
          {summary.months} mois · {summary.quarters} trimestres · {summary.years}{" "}
          {summary.years > 1 ? "années" : "année"}
        </span>
      )}
    </div>
  );
}
