"use client";

import { useState } from "react";
import { X } from "lucide-react";

export type FilterDef<T> = {
  key: string;
  label: string;
  getValue: (item: T) => string;
};

export type ActiveFilters = Record<string, string>;

/**
 * Barre de filtres générique : "+ Filtre" → choix d'une propriété → choix d'une valeur (options
 * dérivées des valeurs distinctes présentes dans les données). Les filtres actifs s'affichent en
 * chips supprimables. Contrôlé : l'état vit chez l'appelant (URL params sur la page leviers).
 */
export function FilterBar<T>({
  items,
  defs,
  active,
  onChange,
}: {
  items: T[];
  defs: FilterDef<T>[];
  active: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
}) {
  const [pendingKey, setPendingKey] = useState<string>("");

  const availableDefs = defs.filter((d) => !(d.key in active));
  const pendingDef = defs.find((d) => d.key === pendingKey);
  const pendingOptions = pendingDef
    ? Array.from(new Set(items.map((i) => pendingDef.getValue(i)).filter(Boolean))).sort()
    : [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {Object.entries(active).map(([key, value]) => {
        const def = defs.find((d) => d.key === key);
        if (!def) return null;
        return (
          <span
            key={key}
            className="inline-flex items-center gap-1.5 rounded-full border border-bp-coral/40 bg-bp-coral/[0.07] py-1 pl-3 pr-1.5 text-xs font-medium text-primary"
          >
            <span className="text-tertiary">{def.label} :</span> {value}
            <button
              onClick={() => {
                const next = { ...active };
                delete next[key];
                onChange(next);
              }}
              className="rounded-full p-0.5 text-tertiary hover:bg-bp-coral hover:text-white"
              aria-label={`Retirer le filtre ${def.label}`}
            >
              <X size={11} />
            </button>
          </span>
        );
      })}

      {pendingDef ? (
        <span className="inline-flex items-center gap-1.5">
          <select
            autoFocus
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) onChange({ ...active, [pendingKey]: e.target.value });
              setPendingKey("");
            }}
            onBlur={() => setPendingKey("")}
            className="rounded-full border border-bp-coral px-2.5 py-1 text-xs focus:outline-none"
          >
            <option value="">{pendingDef.label} — choisir…</option>
            {pendingOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </span>
      ) : (
        availableDefs.length > 0 && (
          <select
            value=""
            onChange={(e) => setPendingKey(e.target.value)}
            className="rounded-full border border-dashed border-border-strong bg-white px-2.5 py-1 text-xs font-medium text-secondary hover:border-bp-coral hover:text-bp-coral focus:outline-none"
          >
            <option value="">＋ Filtre…</option>
            {availableDefs.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        )
      )}

      {Object.keys(active).length > 0 && (
        <button
          onClick={() => onChange({})}
          className="text-xs font-medium text-bp-coral hover:underline"
        >
          Tout effacer
        </button>
      )}
    </div>
  );
}

