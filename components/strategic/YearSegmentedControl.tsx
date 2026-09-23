"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { filterByYear, periodYear, type YearSelection } from "@/lib/kpiHistory";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { IndicatorMeasurement } from "@/types";

/**
 * Sélecteur d'année des KPI — SEUL composant de sélection Année / Historique complet du Plan
 * Stratégique (cartes KPI, vue Tableau, modale d'historique d'un KPI business, fiche d'axe).
 * Contrôle segmenté rectangulaire (groupe bordé, segments joints, actif = plein noir), défilable
 * horizontalement s'il y a beaucoup d'années, navigable au clavier (flèches / Début / Fin, focus
 * itinérant façon `radiogroup`). La logique de filtrage reste `lib/kpiHistory.filterByYear`.
 */

/** Années distinctes présentes dans les mesures, de la plus récente à la plus ancienne. */
export function measurementYears(measurements: Pick<IndicatorMeasurement, "period">[]): number[] {
  const years = new Set<number>();
  for (const m of measurements) {
    const y = periodYear(m.period);
    if (y !== undefined) years.add(y);
  }
  return Array.from(years).sort((a, b) => b - a);
}

/**
 * État + dérivés d'une sélection d'année sur un jeu de mesures. `visible` = le sélecteur a un sens :
 * des mesures sur plusieurs années, ou une année sélectionnée sans donnée alors que d'autres années
 * en ont (sinon l'utilisateur ne pourrait pas en sortir).
 */
export function useYearSelection<T extends Pick<IndicatorMeasurement, "period">>(
  measurements: T[],
  initial: YearSelection | (() => YearSelection) = "all"
) {
  const [year, setYear] = useState<YearSelection>(initial);
  const years = useMemo(() => measurementYears(measurements), [measurements]);
  const options = useMemo(
    () =>
      typeof year === "number" && !years.includes(year)
        ? [...years, year].sort((a, b) => b - a)
        : years,
    [years, year]
  );
  const visible =
    years.length > 1 || (years.length > 0 && typeof year === "number" && !years.includes(year));
  const filtered = useMemo(() => filterByYear(measurements, year), [measurements, year]);
  return { year, setYear, options, visible, filtered };
}

export function YearSegmentedControl({
  years,
  value,
  onChange,
  className,
  showLabel = true,
}: {
  /** Années proposées (ordre d'affichage conservé) — « Historique complet » est ajouté en fin. */
  years: number[];
  value: YearSelection;
  onChange: (value: YearSelection) => void;
  className?: string;
  /** Libellé « Année » à gauche du groupe (visuel) — le groupe garde toujours son `aria-label`. */
  showLabel?: boolean;
}) {
  const { t } = useTranslation();
  const label = t("kpi.year.label", "Année");
  const items: YearSelection[] = [...years, "all"];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(0, items.indexOf(value));

  const select = (index: number) => {
    const next = items[(index + items.length) % items.length];
    onChange(next);
    refs.current[(index + items.length) % items.length]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        select(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        select(index - 1);
        break;
      case "Home":
        e.preventDefault();
        select(0);
        break;
      case "End":
        e.preventDefault();
        select(items.length - 1);
        break;
    }
  };

  return (
    <div className={`flex min-w-0 items-center gap-2 ${className ?? ""}`}>
      {showLabel && (
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-tertiary">
          {label}
        </span>
      )}
      <div className="min-w-0 overflow-x-auto">
        <div
          role="radiogroup"
          aria-label={label}
          className="inline-flex divide-x divide-border overflow-hidden rounded-sm border border-border bg-white"
        >
          {items.map((item, index) => {
            const active = item === value;
            return (
              <button
                key={item}
                ref={(el) => {
                  refs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={index === activeIndex ? 0 : -1}
                onClick={() => onChange(item)}
                onKeyDown={(e) => onKeyDown(e, index)}
                className={`shrink-0 cursor-pointer whitespace-nowrap px-2.5 py-1 text-[11px] font-semibold tabular-nums transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bp-coral ${
                  active
                    ? "bg-black text-white"
                    : "bg-white text-text-secondary hover:bg-bg-surface hover:text-text-primary"
                }`}
              >
                {item === "all" ? t("kpi.chart.fullHistory", "Historique complet") : item}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
