import { serializeFilterValues } from "@/lib/filterUtils";
import type { MovementAlertKind } from "@/lib/hrEngine";

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

/**
 * Lien vers l'onglet "Suivi des mouvements" de la Base ETP avec des filtres de la barre
 * "mouvements" pré-appliqués (visibles et modifiables). Les clés sont celles des `FilterDef` de
 * `app/(app)/hr/etp/page.tsx` (`f_lever`, `f_hrOwner`, `f_execution`…) : elles sont préfixées par
 * le namespace `mov_` de `useMultiFilterBarState` — un paramètre non préfixé (`f_lever=…`) était
 * silencieusement ignoré par la page (M5/M6). Valeurs = valeurs brutes comparées par
 * `FilterDef.getValue` (ex. code levier, libellé `EXECUTION_LABELS`).
 */
export function etpMovementFilterLink(filters: Record<string, string[]>): string {
  const params = new URLSearchParams({ tab: "mouvements" });
  for (const [key, raw] of Object.entries(filters)) {
    const values = Array.from(new Set(raw.filter(Boolean)));
    if (values.length > 0) params.set(`mov_${key}`, serializeFilterValues(values));
  }
  return `/hr/etp?${params.toString()}`;
}

/**
 * Lien vers l'onglet "Suivi des mouvements" de la Base ETP filtré sur une ou plusieurs catégories
 * d'alerte (filtre `f_alert` de la barre de filtres "mouvements"). Le paramètre est préfixé par le
 * namespace `mov_` et sérialisé comme le fait `useMultiFilterBarState` (valeurs encodées, séparées
 * par des virgules). `kinds` sont les CODES STABLES d'alerte (`MovementAlertKind`, ou `"none"`) :
 * la Base ETP stocke ces codes dans l'URL, indépendants de la langue (voir `ALERT_LABEL_KEYS` dans
 * `app/(app)/hr/etp/page.tsx`) — un lien construit avec les libellés traduits cessait de filtrer
 * dès qu'on changeait de langue. Contrairement à `etpMovementDeepLink`, le filtre reste visible et
 * modifiable dans la barre de filtres.
 */
export function etpAlertFilterLink(kinds: (MovementAlertKind | "none")[]): string {
  const values = Array.from(new Set(kinds.filter(Boolean)));
  const params = new URLSearchParams({ tab: "mouvements" });
  if (values.length > 0) params.set("mov_f_alert", serializeFilterValues(values));
  return `/hr/etp?${params.toString()}`;
}
