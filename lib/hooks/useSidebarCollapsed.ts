"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Préférence d'affichage PAR NAVIGATEUR (pas une donnée métier — voir legacyStorageCleanup.ts). */
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "betrack_sidebar_collapsed";

/** Durée de la transition de largeur de la sidebar (classe `duration-200`, voir Sidebar.tsx). */
const SIDEBAR_TRANSITION_MS = 200;

function readStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStoredCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Stockage inaccessible (mode privé strict, quota) : la préférence ne survivra simplement
    // pas au rechargement, sans autre conséquence.
  }
}

/**
 * Sidebar desktop réduite (rail d'icônes) ou dépliée — dépliée par défaut, préférence mémorisée
 * dans le localStorage du navigateur.
 *
 * Restauration sans flash : la valeur est lue dans un effet de montage de l'AppShell, qui ne rend
 * rien (garde d'authentification, `ready` à false) avant ses propres effets — la sidebar n'est donc
 * jamais peinte dépliée puis réduite. Pas de lecture dans l'initialiseur de `useState` pour ne pas
 * risquer d'écart d'hydratation avec le rendu statique.
 *
 * Après une bascule, un événement `resize` est émis une fois la transition de largeur terminée :
 * les graphiques qui mesurent leur conteneur une seule fois (hors ResponsiveContainer, qui observe
 * déjà son conteneur) se recalent ainsi sur la nouvelle largeur disponible.
 */
export function useSidebarCollapsed(): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState(false);
  const toggledByUser = useRef(false);

  useEffect(() => {
    if (readStoredCollapsed()) setCollapsed(true);
  }, []);

  useEffect(() => {
    if (!toggledByUser.current) return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(
      () => window.dispatchEvent(new Event("resize")),
      reduceMotion ? 0 : SIDEBAR_TRANSITION_MS + 50
    );
    return () => window.clearTimeout(timer);
  }, [collapsed]);

  const toggle = useCallback(() => {
    toggledByUser.current = true;
    setCollapsed((prev) => {
      const next = !prev;
      writeStoredCollapsed(next);
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
