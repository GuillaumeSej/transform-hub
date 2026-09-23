"use client";

import { useCallback, useEffect, useState } from "react";

/** Géométrie d'une matrice « tuiles groupées » (Santé des initiatives, Statut des mouvements) :
 * N blocs côte à côte, chacun contenant une grille de tuiles de largeur fixe. */
export interface GroupGridGeometry {
  /** Nombre de blocs (groupes) affichés côte à côte. */
  groupCount: number;
  /** Nombre de tuiles du plus gros groupe. */
  maxCells: number;
  /** Largeur disponible (px) ; ≤ 0 = pas encore mesurée → `fallbackWidth`. */
  containerWidth: number;
  /** Largeur fixe d'une tuile (px). */
  cellWidth: number;
  /** Écart entre tuiles (px). */
  cellGap: number;
  /** Écart entre blocs (px). */
  groupGap: number;
  /** Padding + bordures horizontales d'un bloc (px). */
  groupChrome: number;
  minCols: number;
  maxCols: number;
  /** Largeur supposée avant la première mesure (SSR / jsdom sans ResizeObserver). */
  fallbackWidth?: number;
}

/**
 * Nombre de colonnes de tuiles par bloc, commun à tous les blocs. Règle :
 * 1. on répartit la largeur disponible à parts égales entre les blocs et on y loge autant de
 *    tuiles (taille fixe) que possible → peu de groupes = blocs larges et bas, beaucoup de
 *    groupes = colonnes compactes ;
 * 2. borné à [minCols, maxCols] et au nombre de tuiles du plus gros groupe (pas de bloc plus
 *    large que son contenu) ;
 * 3. équilibré : pour le nombre de lignes obtenu, on retient le plus petit nombre de colonnes
 *    qui garde ce nombre de lignes (évite une dernière ligne quasi vide).
 */
export function computeGroupColumns({
  groupCount,
  maxCells,
  containerWidth,
  cellWidth,
  cellGap,
  groupGap,
  groupChrome,
  minCols,
  maxCols,
  fallbackWidth = 960,
}: GroupGridGeometry): number {
  if (groupCount <= 0 || maxCells <= 0) return minCols;
  const width = containerWidth > 0 ? containerWidth : fallbackWidth;
  const perGroup = (width - groupGap * (groupCount - 1)) / groupCount - groupChrome;
  const fit = Math.floor((perGroup + cellGap) / (cellWidth + cellGap));
  const capped = Math.min(Math.max(fit, minCols), maxCols, Math.max(maxCells, minCols));
  const rows = Math.ceil(maxCells / capped);
  return Math.max(minCols, Math.ceil(maxCells / rows));
}

/** Largeur (px) d'un bloc de `cols` colonnes. */
export function groupBlockWidth(
  cols: number,
  {
    cellWidth,
    cellGap,
    groupChrome,
  }: Pick<GroupGridGeometry, "cellWidth" | "cellGap" | "groupChrome">
): number {
  return cols * cellWidth + Math.max(0, cols - 1) * cellGap + groupChrome;
}

/**
 * Mesure la largeur du conteneur (ResizeObserver) et renvoie le nombre de colonnes adapté.
 * `ref` est un callback ref à poser sur le conteneur scrollable qui englobe les blocs.
 */
export function useAdaptiveGroupColumns(geometry: Omit<GroupGridGeometry, "containerWidth">) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const ref = useCallback((el: HTMLElement | null) => setNode(el), []);

  useEffect(() => {
    if (!node) return;
    setContainerWidth(node.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setContainerWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { ref, cols: computeGroupColumns({ ...geometry, containerWidth }) };
}
