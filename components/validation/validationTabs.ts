/**
 * Onglets de la page Validation (vue pilotage uniquement — `isPilotProfile`, lib/myWorkspace.ts) :
 * « Mes décisions » (contenu historique, défaut) et « En attente chez d'autres » (le bloc
 * `MyWorkspace.blocked`, déplacé depuis « Mon espace »). Synchronisé avec `?tab=blocked`.
 */
export type ValidationTab = "mine" | "blocked";

export const VALIDATION_TAB_PARAM = "tab";

/** `?tab=` → onglet ; toute valeur inconnue / absente retombe sur « Mes décisions ». */
export function parseValidationTab(value: string | null | undefined): ValidationTab {
  return value === "blocked" ? "blocked" : "mine";
}

/** Query string à poser pour un onglet (l'onglet par défaut retire le paramètre), en conservant
 *  les autres paramètres. Renvoie la chaîne SANS `?` (vide si aucun paramètre). */
export function validationTabQuery(current: string, tab: ValidationTab): string {
  const params = new URLSearchParams(current);
  if (tab === "mine") params.delete(VALIDATION_TAB_PARAM);
  else params.set(VALIDATION_TAB_PARAM, tab);
  return params.toString();
}
