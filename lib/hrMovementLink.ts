/**
 * Mécanisme UNIQUE "voir ce(s) mouvement(s) précis dans la Base ETP" — réutilisé par tous les
 * points d'entrée cliquables du Dashboard RH (matrice de statut des mouvements, drill-down de la
 * waterfall ETP, et `MovementDrilldownModal` pour les graphiques agrégés sans vue de détail) au
 * lieu de 3 implémentations ad hoc.
 *
 * Construit un lien vers l'onglet "Suivi des mouvements" de la Base ETP
 * (`app/(app)/hr/etp/page.tsx`) filtré sur EXACTEMENT les mouvements demandés via le paramètre
 * d'URL `movementIds` (liste d'ids séparés par des virgules, lu une seule fois au montage — voir
 * l'effet correspondant dans `etp/page.tsx`, PAS un `FilterDef` du `useFilterBarState` existant :
 * un id de mouvement n'est pas une valeur de dimension filtrable comme les autres).
 *
 * Avec un seul id, la Base ETP ouvre en plus directement la modale d'édition de ce mouvement
 * (réutilise le `MovementForm` déjà utilisé pour le clic sur une ligne du tableau des mouvements)
 * pour atteindre le détail complet en un clic, sans plomberie de filtre supplémentaire.
 */
export function etpMovementDeepLink(movementIds: string[]): string {
  const ids = Array.from(new Set(movementIds.filter(Boolean)));
  const params = new URLSearchParams({ tab: "mouvements" });
  if (ids.length > 0) params.set("movementIds", ids.join(","));
  return `/hr/etp?${params.toString()}`;
}
