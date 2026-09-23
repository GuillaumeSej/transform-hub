"use client";

import { useMemo, useRef, useState } from "react";
import { CalendarRange, Check, ChevronDown, FolderKanban, History, RotateCcw } from "lucide-react";
import { useDismissable } from "@/lib/hooks/useDismissable";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { summarizeRange } from "@/components/shared/DateRangePicker";
import { cn } from "@/lib/utils";

/** Préréglage de période (plage ISO fermée `YYYY-MM-DD`) affiché comme pastille sélectionnable. */
export type PeriodPreset = { key: string; label: string; fromISO: string; toISO: string };

/** Sélecteur de programme de la barre : liste déroulante (plusieurs programmes), libellé figé
 *  (vue consolidée) ou absent (`undefined`/`null`). */
export type PeriodToolbarProgram =
  | { kind: "consolidated"; label: string }
  | {
      kind: "select";
      value: string;
      options: { value: string; label: string }[];
      onChange: (value: string) => void;
    };

/**
 * Barre transverse "Programme · Préréglages · Période" des tableaux de bord — remplace l'ancienne
 * ligne de `<select>`/boutons carrés. Purement présentationnelle : tout l'état (programme choisi,
 * bornes de la plage) vit chez l'appelant, qui reçoit exactement les mêmes callbacks qu'avant
 * (`onRangeChange({ fromISO, toISO })` à chaque saisie, `program.onChange(id)`), donc aucun
 * changement de comportement ni d'état.
 *
 *  - Pilule "Programme" (menu déroulant) ou badge "Vue consolidée".
 *  - Pilule "Période" : ouvre un panneau avec les deux dates (Du → Au) + le récapitulatif
 *    mois/trimestres/années ; son libellé résume la plage courante.
 *  - Préréglages en pastilles segmentées ; celle dont la plage correspond exactement à la plage
 *    courante est mise en évidence (sinon la pilule Période affiche "Personnalisée").
 *  - "Réinitialiser" (si `onReset` fourni) — désactivé quand la plage est déjà celle par défaut.
 *  - `sticky` : reste visible en haut de la zone de défilement du contenu.
 */
export function PeriodToolbar({
  program,
  fromISO,
  toISO,
  minISO,
  maxISO,
  onRangeChange,
  presets,
  onReset,
  isDefault,
  sticky = true,
  className,
}: {
  program?: PeriodToolbarProgram | null;
  fromISO: string;
  toISO: string;
  minISO?: string;
  maxISO?: string;
  onRangeChange: (next: { fromISO: string; toISO: string }) => void;
  presets: PeriodPreset[];
  onReset?: () => void;
  /** `true` quand l'état courant est déjà l'état par défaut (désactive "Réinitialiser"). */
  isDefault?: boolean;
  sticky?: boolean;
  className?: string;
}) {
  const { t, locale } = useTranslation();

  const activePreset = presets.find((p) => p.fromISO === fromISO && p.toISO === toISO) ?? null;
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }),
    [locale]
  );
  const fmt = (iso: string) => {
    if (!iso) return "…";
    const d = new Date(`${iso}T00:00:00`);
    return isNaN(d.getTime()) ? iso : dateFmt.format(d);
  };
  const rangeLabel = `${fmt(fromISO)} → ${fmt(toISO)}`;
  const summary = summarizeRange(fromISO, toISO);

  const programLabel =
    program?.kind === "consolidated"
      ? program.label
      : program?.kind === "select"
        ? (program.options.find((o) => o.value === program.value)?.label ?? "")
        : null;

  return (
    <section
      aria-label={t("shared.periodToolbar.ariaLabel", "Sélection du programme et de la période")}
      className={cn(
        "mb-4 rounded-md border border-border bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85",
        sticky && "sticky top-0 z-20",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {program?.kind === "select" && program.options.length > 1 && (
          <ProgramPill program={program} label={t("dashboard.program", "Programme")} />
        )}
        {program?.kind === "consolidated" && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-neutral-50 pl-2.5 pr-3 text-[12px]">
            <FolderKanban size={14} className="text-tertiary" aria-hidden />
            <span className="text-tertiary">{t("dashboard.program", "Programme")}</span>
            <span className="font-semibold text-primary">{program.label}</span>
          </span>
        )}

        <RangePill
          label={t("hr.period", "Période")}
          valueLabel={rangeLabel}
          badge={
            activePreset ? activePreset.label : t("shared.periodToolbar.custom", "Personnalisée")
          }
          fromISO={fromISO}
          toISO={toISO}
          minISO={minISO}
          maxISO={maxISO}
          onRangeChange={onRangeChange}
          summary={summary}
        />

        {presets.length > 0 && (
          <div
            role="group"
            aria-label={t("hr.presets", "Préréglages")}
            className="flex flex-wrap items-center gap-1 rounded-full bg-neutral-100 p-0.5"
          >
            <History size={13} className="ml-2 mr-0.5 text-tertiary" aria-hidden />
            {presets.map((p) => {
              const active = activePreset?.key === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onRangeChange({ fromISO: p.fromISO, toISO: p.toISO })}
                  className={cn(
                    "h-7 rounded-full px-3 text-[11.5px] font-semibold transition",
                    active
                      ? "bg-black text-white shadow-sm"
                      : "text-secondary hover:bg-white hover:text-primary"
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        )}

        {onReset && (
          <button
            type="button"
            onClick={onReset}
            disabled={isDefault}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-semibold text-secondary transition hover:bg-neutral-100 hover:text-primary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <RotateCcw size={13} aria-hidden />
            {t("shared.periodToolbar.reset", "Réinitialiser")}
          </button>
        )}
      </div>

      {/* Récapitulatif lisible de la sélection courante. */}
      <p className="mt-1.5 truncate text-[11px] text-tertiary" aria-live="polite">
        {programLabel && (
          <>
            {t("dashboard.program", "Programme")} :{" "}
            <span className="font-semibold text-secondary">{programLabel}</span>
            {" · "}
          </>
        )}
        {t("hr.period", "Période")} :{" "}
        <span className="font-semibold text-secondary">{rangeLabel}</span>
        {summary.months > 0 && (
          <>
            {" · "}
            {summary.months} {t("shared.dateRangePicker.monthsUnit", "mois")}
          </>
        )}
      </p>
    </section>
  );
}

function ProgramPill({
  program,
  label,
}: {
  program: Extract<PeriodToolbarProgram, { kind: "select" }>;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismissable(open, () => setOpen(false), ref);
  const current = program.options.find((o) => o.value === program.value);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className={cn(
          "inline-flex h-8 max-w-[280px] items-center gap-1.5 rounded-full border bg-white pl-2.5 pr-2 text-[12px] transition",
          open ? "border-black" : "border-border hover:border-neutral-400"
        )}
      >
        <FolderKanban size={14} className="shrink-0 text-tertiary" aria-hidden />
        <span className="text-tertiary">{label}</span>
        <span className="truncate font-semibold text-primary">{current?.label ?? "—"}</span>
        <ChevronDown
          size={14}
          className={cn("shrink-0 text-tertiary transition", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={label}
          className="absolute left-0 top-full z-40 mt-1.5 max-h-[320px] min-w-[240px] overflow-y-auto rounded-md border border-border bg-white py-1 shadow-lg"
        >
          {program.options.map((o) => {
            const active = o.value === program.value;
            return (
              <li key={o.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    program.onChange(o.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12px] transition hover:bg-neutral-50",
                    active ? "font-semibold text-primary" : "text-secondary"
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {active && <Check size={13} className="shrink-0 text-bp-coral" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RangePill({
  label,
  valueLabel,
  badge,
  fromISO,
  toISO,
  minISO,
  maxISO,
  onRangeChange,
  summary,
}: {
  label: string;
  valueLabel: string;
  badge: string;
  fromISO: string;
  toISO: string;
  minISO?: string;
  maxISO?: string;
  onRangeChange: (next: { fromISO: string; toISO: string }) => void;
  summary: { months: number; quarters: number; years: number };
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismissable(open, () => setOpen(false), ref);
  const inputClass =
    "h-8 w-full rounded-md border border-border bg-white px-2 text-[12px] text-primary focus:border-black focus:outline-none";
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border bg-white pl-2.5 pr-2 text-[12px] transition",
          open ? "border-black" : "border-border hover:border-neutral-400"
        )}
      >
        <CalendarRange size={14} className="shrink-0 text-tertiary" aria-hidden />
        <span className="text-tertiary">{label}</span>
        <span className="font-semibold tabular-nums text-primary">{valueLabel}</span>
        <span className="hidden rounded-full bg-neutral-100 px-1.5 py-px text-[10.5px] font-semibold text-secondary sm:inline">
          {badge}
        </span>
        <ChevronDown
          size={14}
          className={cn("shrink-0 text-tertiary transition", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-40 mt-1.5 w-[300px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-white p-3 shadow-lg"
        >
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
            {t("shared.periodToolbar.customRange", "Plage personnalisée")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px] font-medium text-secondary">
              {t("dashboard.widgets.dateFrom", "Du")}
              <input
                type="date"
                aria-label={t("shared.dateRangePicker.fromLabel", "Date de début")}
                className={inputClass}
                value={fromISO}
                min={minISO}
                max={maxISO}
                onChange={(e) => onRangeChange({ fromISO: e.target.value, toISO })}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-secondary">
              {t("dashboard.widgets.dateTo", "Au")}
              <input
                type="date"
                aria-label={t("shared.dateRangePicker.toLabel", "Date de fin")}
                className={inputClass}
                value={toISO}
                min={minISO}
                max={maxISO}
                onChange={(e) => onRangeChange({ fromISO, toISO: e.target.value })}
              />
            </label>
          </div>
          {summary.months > 0 && (
            <p className="mt-2.5 border-t border-border pt-2 text-[11px] text-tertiary">
              {summary.months} {t("shared.dateRangePicker.monthsUnit", "mois")} · {summary.quarters}{" "}
              {t("shared.dateRangePicker.quartersUnit", "trimestres")} · {summary.years}{" "}
              {summary.years > 1
                ? t("shared.dateRangePicker.yearsUnit", "années")
                : t("shared.dateRangePicker.yearUnit", "année")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
