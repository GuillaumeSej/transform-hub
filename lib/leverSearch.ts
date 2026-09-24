/**
 * Recherche plein texte de la bibliothèque des leviers (vue Tableau) — prédicat UNIQUE partagé par
 * le tableau des leviers actifs et celui des leviers abandonnés (et donc par l'export Excel, qui
 * reprend les lignes affichées).
 *
 * Seuls des champs VISIBLES par l'utilisateur sont cherchés : un levier ne doit jamais remonter
 * sur un terme qu'aucune de ses cellules n'affiche (identifiants techniques, id de chantier,
 * valeurs internes de risque/statut...).
 */

/** Champs texte cherchés, tels qu'affichés dans les colonnes du tableau. */
export const LEVER_SEARCH_FIELDS = [
  "code",
  "name",
  "owner",
  "sponsor",
  /** Nom du chantier (pas son id). */
  "wsName",
  "type",
  /** Département. */
  "function",
  "geography",
  "country",
  "entity",
  /** Nom du programme (colonne affichée en vue multi-programmes uniquement). */
  "programName",
] as const;

export type LeverSearchField = (typeof LEVER_SEARCH_FIELDS)[number];
export type LeverSearchable = Partial<Record<LeverSearchField, string | null | undefined>>;

/** Minuscules, sans accents, espaces de bord retirés. */
export function normalizeSearchText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Vrai si `query` (vide = tout) apparaît dans au moins un champ visible du levier. */
export function matchesLeverSearch(row: LeverSearchable, query: string): boolean {
  const q = normalizeSearchText(query);
  if (!q) return true;
  return LEVER_SEARCH_FIELDS.some((f) => {
    const v = row[f];
    return typeof v === "string" && normalizeSearchText(v).includes(q);
  });
}
