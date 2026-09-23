/**
 * Confidentialité HIÉRARCHIQUE.
 *
 * `Company.confidentialityLevels` est ordonnée du niveau le MOINS restreint (index 0, ex. "Public")
 * au PLUS restreint (dernier index, ex. "Secret"). Une habilitation est désormais UN SEUL niveau :
 * détenir le niveau d'index i donne accès à tous les niveaux d'index <= i (les niveaux inférieurs).
 * Le niveau le plus restreint (dernier de la liste) est donc celui qui « voit le plus ».
 *
 * Rétro-compatibilité : les données historiques stockaient une LISTE de niveaux cochés
 * (`Company.roleClearance[role]: string[]`, `AuthUser.confidentialityClearance: string[]`). À la
 * lecture, une liste est normalisée vers son niveau de plus haut accès (voir
 * `normalizeClearanceLevel`) — aucune migration Firestore n'est nécessaire.
 */

/** Valeur d'habilitation telle que lue en base : un niveau (nouveau format) ou une liste (legacy). */
export type StoredClearanceLevel = string | string[] | null | undefined;

/** Rang d'un niveau dans l'échelle ordonnée (-1 si inconnu / non défini). */
export function levelRank(level: string | null | undefined, orderedLevels: string[]): number {
  if (!level) return -1;
  return orderedLevels.indexOf(level);
}

/**
 * Normalise une habilitation stockée vers UN niveau unique :
 *  - string (nouveau format) -> ce niveau s'il fait partie de l'échelle, sinon undefined ;
 *  - string[] (legacy)       -> le niveau de plus haut accès (rang max) parmi ceux connus ;
 *  - vide / null / undefined -> undefined (aucun niveau).
 */
export function normalizeClearanceLevel(
  value: StoredClearanceLevel,
  orderedLevels: string[]
): string | undefined {
  if (value == null) return undefined;
  const candidates = Array.isArray(value) ? value : [value];
  let best = -1;
  for (const level of candidates) best = Math.max(best, levelRank(level, orderedLevels));
  return best >= 0 ? orderedLevels[best] : undefined;
}

/** Liste des niveaux accessibles avec l'habilitation `level` (lui-même + tous les inférieurs). */
export function accessibleLevels(level: string | undefined, orderedLevels: string[]): string[] {
  const rank = levelRank(level, orderedLevels);
  return rank >= 0 ? orderedLevels.slice(0, rank + 1) : [];
}

/** Un élément de niveau `itemLevel` est-il accessible avec l'habilitation `clearanceLevel` ?
 *  Un élément sans niveau est toujours accessible ; un niveau inconnu de l'échelle ne l'est pas. */
export function isLevelAccessible(
  itemLevel: string | null | undefined,
  clearanceLevel: string | undefined,
  orderedLevels: string[]
): boolean {
  if (!itemLevel) return true;
  const itemRank = levelRank(itemLevel, orderedLevels);
  if (itemRank < 0) return false;
  return itemRank <= levelRank(clearanceLevel, orderedLevels);
}

/** Niveau immédiatement inférieur à `level` (undefined s'il n'y en a pas) — sert à rétrograder une
 *  habilitation quand l'admin supprime le niveau qu'elle référence. */
export function levelBelow(level: string, orderedLevels: string[]): string | undefined {
  const rank = levelRank(level, orderedLevels);
  return rank > 0 ? orderedLevels[rank - 1] : undefined;
}

/** Normalise toute une matrice `Company.roleClearance` (legacy tableaux -> niveau unique). Les
 *  rôles sans niveau valide sont omis (= aucun accès aux éléments confidentiels). */
export function normalizeRoleClearance<K extends string>(
  roleClearance: Partial<Record<K, StoredClearanceLevel>> | null | undefined,
  orderedLevels: string[]
): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  if (!roleClearance) return out;
  for (const role of Object.keys(roleClearance) as K[]) {
    const level = normalizeClearanceLevel(roleClearance[role], orderedLevels);
    if (level) out[role] = level;
  }
  return out;
}
