"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

export type DropdownOption = { value: string; label: string };
export type DropdownGroup = { groupLabel: string; options: DropdownOption[] };

/**
 * Dropdown générique à sélection UNIQUE — même motif d'interaction que
 * `components/shared/ProgramSwitcher.tsx` (bouton + panneau positionné en absolu, fermeture au
 * `onBlur` du conteneur quand le focus quitte le composant). Primitive UI pure : contrairement à
 * `FilterBar.tsx` (multi-select, choix par cases à cocher), celui-ci ne gère qu'une seule valeur
 * sélectionnée à la fois — le libellé et le placeholder sont fournis par l'appelant en chaînes déjà
 * traduites, aucun appel à `t()` ici (round 13, page KPI).
 *
 * `options` (liste plate) et `groups` (options regroupées sous un en-tête de groupe non cliquable,
 * ex. chantiers regroupés par axe parent) sont mutuellement exclusifs — l'appelant ne fournit que
 * l'un des deux selon le filtre représenté.
 *
 * Round 14 : redesign visuel uniquement — API de props INCHANGÉE (5 agents parallèles consomment
 * ce composant, dont `KpiPageClient.tsx`, non touché). Bouton "carte" bordée (`rounded-md`, jamais
 * une pilule) plutôt qu'arrondi complet, avec le `label` en petite légende MAJUSCULE au-dessus de
 * la valeur courante (au lieu d'un préfixe inline "Label : valeur") — même esprit que les légendes
 * de `KPICard.tsx`/`Card.tsx`. Rayon/bordure/ombre réutilisent les mêmes tokens que ces deux
 * composants (`border-border`, `shadow-sm`/`shadow-lg`) plutôt que d'en inventer de nouveaux.
 */
export function Dropdown({
  label,
  placeholder,
  value,
  onChange,
  options,
  groups,
  allowClear,
}: {
  label: string;
  placeholder?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  options?: DropdownOption[];
  groups?: DropdownGroup[];
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const allOptions = options ?? groups?.flatMap((g) => g.options) ?? [];
  const selected = value !== null ? allOptions.find((o) => o.value === value) : undefined;
  const buttonText = selected?.label ?? placeholder ?? label;

  const select = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        title={`${label} · ${buttonText}`}
        className="flex h-[50px] max-w-[200px] items-center justify-between gap-2 rounded-md border border-border bg-white px-3 text-left transition hover:border-border-strong sm:max-w-[240px]"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-tertiary">
            {label}
          </span>
          <span className="truncate text-xs font-semibold text-primary">{buttonText}</span>
        </span>
        <ChevronDown size={14} className="flex-shrink-0 text-tertiary" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 max-h-[320px] min-w-[240px] overflow-y-auto rounded-md border border-border bg-white py-1.5 shadow-lg">
          {allowClear && (
            <button
              type="button"
              onClick={() => select(null)}
              className={`flex w-full items-center px-3 py-2 text-left text-xs font-medium transition hover:bg-neutral-50 ${
                value === null ? "font-semibold text-primary" : "text-secondary"
              }`}
            >
              {placeholder ?? label}
            </button>
          )}
          {options &&
            options.map((opt) => {
              const active = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => select(opt.value)}
                  className={`flex w-full items-center px-3 py-2 text-left text-xs font-medium transition hover:bg-neutral-50 ${
                    active ? "font-semibold text-primary" : "text-secondary"
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })}
          {groups &&
            groups.map((group) => (
              <div key={group.groupLabel}>
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary">
                  {group.groupLabel}
                </div>
                {group.options.map((opt) => {
                  const active = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => select(opt.value)}
                      className={`flex w-full items-center px-3 py-2 text-left text-xs font-medium transition hover:bg-neutral-50 ${
                        active ? "font-semibold text-primary" : "text-secondary"
                      }`}
                    >
                      <span className="truncate">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
