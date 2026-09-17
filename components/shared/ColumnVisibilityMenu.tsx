"use client";

import { useState } from "react";
import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "@/lib/i18n/useTranslation";

export type ColumnOption = { key: string; label: string };

/**
 * Bouton + panneau à cases à cocher pour choisir les colonnes visibles d'un tableau. Primitive UI
 * pure (même esprit que `Dropdown.tsx`) : ce composant ne connaît ni l'utilisateur courant ni le
 * stockage — il reflète/notifie seulement l'état `hiddenKeys` qu'on lui passe. La persistance PAR
 * UTILISATEUR (pas par profil) est de la responsabilité de l'appelant (voir
 * `LeversPagePerformance.tsx`, clé localStorage `betrack_levers_columns_${username}`).
 *
 * `hiddenKeys` est volontairement une liste NOIRE (colonnes masquées) plutôt qu'une liste blanche
 * (colonnes visibles) : une future colonne standard ajoutée au tableau apparaît alors visible par
 * défaut pour un utilisateur ayant déjà une préférence enregistrée, sans qu'il ait besoin de la
 * cocher explicitement — seul un masquage explicite est mémorisé.
 */
export function ColumnVisibilityMenu({
  columns,
  hiddenKeys,
  onToggle,
  label,
}: {
  columns: ColumnOption[];
  hiddenKeys: Set<string>;
  onToggle: (key: string) => void;
  label?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const visibleCount = columns.length - hiddenKeys.size;

  return (
    <div
      className="relative flex-shrink-0"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-2 text-xs font-semibold text-secondary transition hover:border-border-strong"
      >
        <SlidersHorizontal size={13} />
        {label ?? t("columns.toggle", "Colonnes")}
        <span className="text-tertiary">
          ({visibleCount}/{columns.length})
        </span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 max-h-[360px] min-w-[220px] overflow-y-auto rounded-md border border-border bg-white py-1.5 shadow-lg">
          {columns.map((col) => {
            const visible = !hiddenKeys.has(col.key);
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => onToggle(col.key)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-secondary transition hover:bg-neutral-50"
              >
                <span
                  className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                    visible ? "border-bp-coral bg-bp-coral text-white" : "border-border bg-white"
                  }`}
                >
                  {visible && <Check size={11} />}
                </span>
                <span className="truncate">{col.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
