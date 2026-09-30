"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Largeur (px) d'un élément, tenue à jour par `ResizeObserver`.
 *
 * Utilise un callback ref (l'élément est un état) plutôt qu'un `useRef` + `useEffect([])` : avec
 * ce dernier, si l'élément n'existe pas au premier rendu (état vide pendant le chargement des
 * données, rendu conditionnel…), la mesure n'était jamais faite et restait à 0 — bug du graphique
 * « Réalisation des économies » affiché tout fin à l'ouverture jusqu'à un rafraîchissement.
 * Ici, la mesure repart dès que l'élément est (re)monté.
 *
 * Retourne `[ref, width]` ; `width` vaut `null` tant que l'élément n'est pas mesuré.
 */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const ref = useCallback((node: T | null) => setEl(node), []);

  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      // 0 = élément pas encore mis en page (onglet caché, animation d'entrée…) : on attend la
      // prochaine notification du ResizeObserver plutôt que de figer une largeur nulle.
      if (w > 0) setWidth(w);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  return [ref, width] as const;
}
