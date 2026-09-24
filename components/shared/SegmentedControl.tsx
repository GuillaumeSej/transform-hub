"use client";

import { useRef, type KeyboardEvent } from "react";

/**
 * Contrôle segmenté rectangulaire générique — même rendu que `YearSegmentedControl` (groupe bordé
 * `rounded-sm`, segments joints, actif = plein noir, anneau de focus coral), même navigation
 * clavier (flèches / Début / Fin, focus itinérant façon `radiogroup`). Pour les choix courts à
 * valeur unique (granularité Mois / Trimestre / Semestre / Année, etc.).
 *
 * Contrôle segmenté UNIQUE de l'app (actif = plein noir) : toutes les bascules locales
 * (granularité, dimension, vue, échelle de timeline, type d'impact…) le réutilisent plutôt que de
 * redéfinir leur propre style. `size="xs"` pour les bascules intégrées à une ligne de tableau.
 */
export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
  showLabel = true,
  className,
  size = "sm",
  disabled = false,
}: {
  /** Libellé du groupe (visuel à gauche si `showLabel`, toujours en `aria-label`). */
  label: string;
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  showLabel?: boolean;
  className?: string;
  size?: "sm" | "xs";
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );

  const select = (index: number) => {
    if (disabled) return;
    const i = (index + options.length) % options.length;
    onChange(options[i].value);
    refs.current[i]?.focus();
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
        select(options.length - 1);
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
          {options.map((option, index) => {
            const active = option.value === value;
            return (
              <button
                key={String(option.value)}
                ref={(el) => {
                  refs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={index === activeIndex ? 0 : -1}
                title={option.title}
                disabled={disabled}
                onClick={() => onChange(option.value)}
                onKeyDown={(e) => onKeyDown(e, index)}
                className={`shrink-0 cursor-pointer whitespace-nowrap font-semibold tabular-nums transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bp-coral disabled:cursor-not-allowed disabled:opacity-60 ${
                  size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
                } ${
                  active
                    ? "bg-black text-white"
                    : "bg-white text-text-secondary hover:bg-bg-surface hover:text-text-primary"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
