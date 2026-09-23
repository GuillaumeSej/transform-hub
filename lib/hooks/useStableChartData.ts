"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Stabilité référentielle pour les graphiques Recharts (v3).
 *
 * Pourquoi : Recharts 3 relance l'animation d'un élément graphique dès que son "entrée
 * d'animation" change de RÉFÉRENCE (`useAnimationId`, recharts/es6/util/useAnimationId.js) —
 * `data` pour `Bar`, les points calculés pour `Line`, et carrément l'objet `props` complet pour
 * `Pie`/`Scatter`. Un re-render du composant parent pendant l'animation d'entrée (typiquement un
 * état de survol local, ou un tableau `data={rows.map(...)}` recréé à chaque rendu) produit donc
 * un nouvel identifiant d'animation : l'animation en cours est abandonnée et redémarre depuis
 * l'état intermédiaire, après un nouveau délai `animationBegin` — visuellement, elle "se fige"
 * au survol. Ces helpers gardent les entrées stables tant que leur CONTENU ne change pas.
 */

/** Renvoie la même référence tant que `value` est structurellement égal (JSON) à la précédente.
 *  Réservé à des données de graphique sérialisables (tableaux d'objets simples). */
export function useStableValue<T>(value: T): T {
  const ref = useRef<{ key: string; value: T } | null>(null);
  let key: string;
  try {
    key = JSON.stringify(value) ?? "";
  } catch {
    // Non sérialisable (cycle…) : pas de stabilisation possible, on retombe sur la référence.
    return value;
  }
  if (ref.current === null || ref.current.key !== key) {
    ref.current = { key, value };
  }
  return ref.current.value;
}

/** Callback à identité STABLE qui appelle toujours la dernière version de `fn` — permet de passer
 *  des handlers inline de l'appelant à un sous-arbre de graphique mémoïsé sans le re-rendre. */
export function useLatestCallback<A extends unknown[], R>(
  fn: ((...args: A) => R) | undefined
): (...args: A) => R | undefined {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current?.(...args), []);
}
