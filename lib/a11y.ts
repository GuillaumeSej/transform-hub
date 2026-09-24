import type { KeyboardEvent } from "react";

/**
 * Activation clavier d'un élément cliquable non natif (`<div>`, `<tr>`, `<g>` avec `onClick`) :
 * Entrée ou Espace déclenchent `handler`, comme un bouton. À combiner avec `tabIndex={0}` (et
 * `role="button"` hors lignes de tableau). Ignore les touches venant d'un descendant (champ de
 * saisie, bouton imbriqué) pour ne pas détourner leur comportement natif.
 */
export function onActivateKey<E extends Element>(handler: () => void) {
  return (e: KeyboardEvent<E>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handler();
    }
  };
}
