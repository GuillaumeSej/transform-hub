"use client";

import { useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { useDismissable } from "@/lib/hooks/useDismissable";
import { toArray, toggleInSelection, type FilterValue } from "@/lib/filterUtils";
import type { DropdownGroup, DropdownOption } from "@/components/shared/Dropdown";

/**
 * Filtre à SÉLECTION MULTIPLE (popover de cases à cocher). Même apparence que `Dropdown`.
 * - `values` : valeurs cochées ; tableau vide = aucun filtre. Accepte aussi une chaîne/null
 *   (ancien format mono-valeur) en lecture.
 * - `onChange(next: string[])` : toujours un tableau.
 * - `options` (plat) OU `groups` (sous en-têtes non cliquables).
 * - Bouton : "Tous" / libellé de l'option / "N sélectionnés" + pastille de compte ("Statut (2)"
 *   dans le titre). "Tout sélectionner" / "Effacer" en tête du panneau.
 * - Fermeture : clic hors composant, Échap.
 */
export function MultiSelect({
  label,
  placeholder,
  values,
  onChange,
  options,
  groups,
}: {
  label: string;
  placeholder?: string;
  values: FilterValue;
  onChange: (values: string[]) => void;
  options?: DropdownOption[];
  groups?: DropdownGroup[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismissable(open, () => setOpen(false), ref);

  const selected = toArray(values);
  const allOptions = options ?? groups?.flatMap((g) => g.options) ?? [];
  const labelOf = (v: string) => allOptions.find((o) => o.value === v)?.label ?? v;
  const allLabel = placeholder ?? t("kpi.filterAll", "Tous");
  const buttonText =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? labelOf(selected[0])
        : `${selected.length} ${t("shared.multiSelect.selected", "sélectionnés")}`;

  const renderOption = (opt: DropdownOption) => {
    const checked = selected.includes(opt.value);
    return (
      <button
        key={opt.value}
        type="button"
        role="menuitemcheckbox"
        aria-checked={checked}
        onClick={() => onChange(toggleInSelection(selected, opt.value))}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium transition hover:bg-neutral-50 ${
          checked ? "font-semibold text-primary" : "text-secondary"
        }`}
      >
        <span
          className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-sm border ${
            checked ? "border-bp-coral bg-bp-coral text-white" : "border-border bg-white"
          }`}
        >
          {checked && <Check size={10} strokeWidth={3} />}
        </span>
        <span className="truncate">{opt.label}</span>
      </button>
    );
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={selected.length > 0 ? `${label} (${selected.length})` : label}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`${label} · ${buttonText}`}
        className={`flex h-[50px] max-w-[200px] items-center justify-between gap-2 rounded-md border bg-white px-3 text-left transition hover:border-border-strong sm:max-w-[240px] ${
          selected.length > 0 ? "border-bp-coral/50" : "border-border"
        }`}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-tertiary">
            {label}
            {selected.length > 0 && ` (${selected.length})`}
          </span>
          <span className="truncate text-xs font-semibold text-primary">{buttonText}</span>
        </span>
        <ChevronDown size={14} className="flex-shrink-0 text-tertiary" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1.5 max-h-[320px] min-w-[240px] overflow-y-auto rounded-md border border-border bg-white py-1.5 shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-3 pb-1.5 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => onChange(allOptions.map((o) => o.value))}
              className="text-bp-coral hover:underline"
            >
              {t("shared.multiSelect.selectAll", "Tout sélectionner")}
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={selected.length === 0}
              className="text-secondary hover:underline disabled:opacity-40"
            >
              {t("shared.multiSelect.clear", "Effacer")}
            </button>
          </div>
          {options && options.map(renderOption)}
          {groups &&
            groups.map((group) => (
              <div key={group.groupLabel}>
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary">
                  {group.groupLabel}
                </div>
                {group.options.map(renderOption)}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
