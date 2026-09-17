"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Filter } from "lucide-react";
import { useTranslation } from "@/lib/i18n/useTranslation";

const isBrowser = () => typeof window !== "undefined";

/**
 * État replié/déplié du bouton "Filtres" (page Leviers), persisté en localStorage entre
 * rechargements — extrait de l'ancien `CollapsibleFilterBar` pour que le panneau de filtres
 * déplié puisse être positionné par la page appelante sur une ligne PLEINE LARGEUR sous tout le
 * bandeau d'outils (Filtres / Colonnes / Table-Kanban-Arborescence), plutôt que coincé dans le
 * même conteneur flex que ces boutons (largeur disponible trop réduite avec beaucoup de filtres,
 * d'où l'ancien scroll horizontal — plus nécessaire une fois la ligne pleine largeur disponible).
 */
export function useFilterBarExpanded(storageKey?: string) {
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

  return { expanded, toggle };
}

/** Bouton "Filtres" (+ badge du nombre de filtres actifs) — ne rend QUE le bouton, à placer dans
 *  le bandeau d'outils aux côtés de Colonnes / Table-Kanban-Arborescence ; le panneau de filtres
 *  lui-même (déplié via `expanded`) est à la charge de la page appelante, voir doc-comment
 *  `useFilterBarExpanded` ci-dessus. */
export function FilterToggleButton({
  expanded,
  onToggle,
  activeCount,
  className,
}: {
  expanded: boolean;
  onToggle: () => void;
  activeCount: number;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={`flex flex-shrink-0 items-center gap-1.5 rounded-md border border-border bg-white px-3 py-2 text-xs font-semibold text-secondary transition hover:border-border-strong ${className ?? ""}`}
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
  );
}
