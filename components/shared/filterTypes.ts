/** Types partagés des barres de filtres (`DropdownFilterBar`, `useMultiFilterBarState`) —
 *  anciennement exportés par `FilterBar.tsx` (barre à chips, supprimée car plus utilisée). */

export type FilterDef<T> = {
  key: string;
  label: string;
  getValue: (item: T) => string;
  /** Libellé affiché (traduit) d'une valeur de filtre — la valeur filtrée/persistée reste celle de
   *  `getValue` (ex. `MovementType` en français). Défaut : la valeur elle-même. */
  formatValue?: (value: string) => string;
};

/** État d'un `DropdownFilterBar.tsx` mono-sélection : une valeur active (ou aucune) par dimension. */
export type SingleActiveFilters = Record<string, string | null>;

/** État multi-sélection d'un `DropdownFilterBar` : tableau de valeurs par dimension (absent/vide =
 * pas de filtre). Voir `lib/hooks/useMultiFilterBarState.ts`. */
export type MultiActiveFilters = Record<string, string[]>;
