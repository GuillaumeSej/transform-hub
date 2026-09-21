/**
 * Helpers purs pour les filtres multi-sélection (voir `components/shared/MultiSelect.tsx`).
 * Convention : une sélection VIDE = aucun filtre (tout passe).
 */

/** Valeur d'un filtre : tableau (multi), chaîne (ancien format mono-valeur) ou null. */
export type FilterValue = string | string[] | null | undefined;

/** Normalise n'importe quelle valeur de filtre (ancien format compris) en tableau sans doublon/vide. */
export function toArray(value: FilterValue): string[] {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return Array.from(new Set(arr.filter((v) => v !== "" && v != null)));
}

/** Vrai si `itemValue` passe le filtre (sélection vide => vrai). */
export function matchesFilter(
  itemValue: string | null | undefined,
  selected: FilterValue
): boolean {
  const sel = toArray(selected);
  if (sel.length === 0) return true;
  return itemValue != null && sel.includes(itemValue);
}

/** Vrai si au moins une des valeurs d'un item multi-valué passe le filtre. */
export function matchesAnyFilter(
  itemValues: string[] | null | undefined,
  selected: FilterValue
): boolean {
  const sel = toArray(selected);
  if (sel.length === 0) return true;
  return (itemValues ?? []).some((v) => sel.includes(v));
}

export function toggleInSelection(selected: string[], value: string): string[] {
  return selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Sérialise pour URL/localStorage : valeurs encodées (donc sans virgule) séparées par des virgules. */
export function serializeFilterValues(values: string[]): string {
  return values.map((v) => encodeURIComponent(v)).join(",");
}

/**
 * Désérialise. Rétro-compatible : une ancienne valeur simple ("Finance") donne ["Finance"].
 * (Une ancienne valeur simple contenant une virgule serait scindée — cas négligeable.)
 */
export function parseFilterValues(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return toArray(raw.split(",").map(safeDecode));
}

/** Résumé compact pour un bouton de filtre : "Tous", la valeur unique, ou "Statut (2)". */
export function summarizeSelection(
  selected: string[],
  allLabel: string,
  labelOf?: (v: string) => string
): string {
  if (selected.length === 0) return allLabel;
  if (selected.length === 1) return labelOf ? labelOf(selected[0]) : selected[0];
  return `${selected.length} sélectionnés`;
}
