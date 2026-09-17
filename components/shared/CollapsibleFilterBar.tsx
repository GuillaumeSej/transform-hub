"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Filter } from "lucide-react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { DropdownFilterBar } from "@/components/shared/DropdownFilterBar";
import type { FilterDef, SingleActiveFilters } from "@/components/shared/FilterBar";

const isBrowser = () => typeof window !== "undefined";

/**
 * Enrobage repliable de `DropdownFilterBar` (NE PAS modifier ce dernier, partagé par d'autres
 * pages) — demande produit explicite (page Leviers) : avec beaucoup de filtres actifs (arborescence
 * financière + géographique configurables, en plus des filtres fixes), le `flex-wrap` de
 * `DropdownFilterBar` étalait la barre sur plusieurs rangées, jugé peu lisible.
 *
 * Ici : repliée par défaut derrière un bouton "Filtres" (+ badge du nombre de filtres actifs), et
 * quand dépliée, les dropdowns tiennent sur UNE SEULE ligne scrollable horizontalement — obtenu en
 * laissant le conteneur interne prendre sa largeur de contenu (`w-max`, donc jamais de contrainte
 * qui déclencherait le `flex-wrap` hérité de `DropdownFilterBar`) à l'intérieur d'un parent
 * `overflow-x-auto`, plutôt qu'en tentant de surcharger `flex-wrap` par une classe Tailwind
 * conflictuelle (ordre de génération non garanti, donc pas fiable).
 */
export function CollapsibleFilterBar<T>({
  items,
  defs,
  active,
  onChange,
  storageKey,
  className,
}: {
  items: T[];
  defs: FilterDef<T>[];
  active: SingleActiveFilters;
  onChange: (next: SingleActiveFilters) => void;
  /** Clé localStorage pour mémoriser l'état replié/déplié entre rechargements. Facultative — sans
   *  elle, la barre repart repliée à chaque chargement de page (comportement de repli acceptable). */
  storageKey?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // Lecture localStorage isolée dans un effet (jamais dans l'initialiseur de useState, qui
  // s'exécuterait aussi côté serveur où `localStorage` n'existe pas — même précaution que
  // useActiveProgram.tsx).
  useEffect(() => {
    if (!storageKey || !isBrowser()) return;
    try {
      setExpanded(window.localStorage.getItem(storageKey) === "1");
    } catch {
      // Stockage indisponible — repli silencieux sur l'état replié par défaut.
    }
  }, [storageKey]);

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      if (storageKey && isBrowser()) {
        try {
          window.localStorage.setItem(storageKey, next ? "1" : "0");
        } catch {
          // L'état reste effectif pour la session en cours via le state React ; il ne survivra
          // simplement pas à un rechargement.
        }
      }
      return next;
    });
  };

  const activeCount = Object.values(active).filter((v) => v != null).length;

  return (
    <div className={`flex min-w-0 items-center gap-2 ${className ?? ""}`}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex flex-shrink-0 items-center gap-1.5 rounded-md border border-border bg-white px-3 py-2 text-xs font-semibold text-secondary transition hover:border-border-strong"
      >
        <Filter size={13} />
        {t("filters.toggle", "Filtres")}
        {activeCount > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-bp-coral px-1 text-[10px] font-bold text-white">
            {activeCount}
          </span>
        )}
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {expanded && (
        <div className="min-w-0 overflow-x-auto pb-1">
          <DropdownFilterBar
            items={items}
            defs={defs}
            active={active}
            onChange={onChange}
            className="w-max flex-nowrap"
          />
        </div>
      )}
    </div>
  );
}
