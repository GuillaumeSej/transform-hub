import type { WorkforceMovement } from "@/types";
import { actualMovementFte, planMovementFte } from "@/lib/hrProgramSummary";

/**
 * Helpers purs des aperçus au survol des graphiques du Dashboard RH (`HrChartPreview`) — aucune
 * formule métier ici : les valeurs (ETP, €M, compteurs) viennent déjà des agrégations
 * `lib/hrEngine.ts` / `lib/hrTimeSeries.ts` / `lib/hrExecution.ts`, ces helpers ne font que
 * calculer une part du total et classer les principaux contributeurs d'un élément survolé.
 */

/** Contributeur d'un élément survolé (département, levier…) — `value` dans l'unité du graphique. */
export type HrPreviewContributor = { key: string; label: string; value: number };

/** Part (en POINTS, 0-100) de `value` dans `total` — `null` si le total est nul ou non fini (pas
 *  de « 0 % » trompeur ni de division par zéro). Les valeurs sont prises en valeur absolue pour
 *  qu'une barre négative (sorties, économie nette négative) garde une part lisible. */
export function shareOfTotal(value: number, total: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(total)) return null;
  const denominator = Math.abs(total);
  if (denominator < 1e-9) return null;
  return (Math.abs(value) / denominator) * 100;
}

/** Somme des valeurs absolues — dénominateur de `shareOfTotal` pour des séries signées (une
 *  période de sorties et une période d'entrées pèsent chacune dans le volume total). */
export function sumAbs(values: number[]): number {
  return values.reduce((sum, v) => sum + (Number.isFinite(v) ? Math.abs(v) : 0), 0);
}

/**
 * Regroupe `items` par clé, somme `valueOf` et renvoie les `limit` plus gros contributeurs en
 * valeur absolue (ordre décroissant, égalité départagée par libellé). Les clés vides retombent
 * sur « Non renseigné » ; `exclude` écarte des clés (ex. le groupe survolé lui-même, pour qu'un
 * département ne soit pas son propre contributeur) ; les contributions nulles sont ignorées.
 */
export function topContributors<T>(
  items: T[],
  keyOf: (item: T) => string | null | undefined,
  valueOf: (item: T) => number,
  options: { limit?: number; exclude?: string[] } = {}
): HrPreviewContributor[] {
  const { limit = 3, exclude = [] } = options;
  const sums = new Map<string, number>();
  for (const item of items) {
    const raw = keyOf(item);
    const key = raw && raw.trim() !== "" ? raw : "Non renseigné";
    const value = valueOf(item);
    if (!Number.isFinite(value)) continue;
    sums.set(key, (sums.get(key) ?? 0) + value);
  }
  return Array.from(sums.entries())
    .filter(([key, value]) => !exclude.includes(key) && Math.abs(value) >= 1e-9)
    .map(([key, value]) => ({ key, label: key, value: Math.round(value * 1000) / 1000 }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.label.localeCompare(b.label, "fr"))
    .slice(0, limit);
}

/** ETP d'un mouvement tel que l'affichent les vues par statut d'exécution
 *  (`executionByDimension`, lib/hrExecution.ts) : ETP constaté si réalisé, sinon ETP du plan
 *  (règle M10, lib/hrProgramSummary.ts). */
export function executionMovementFte(movement: WorkforceMovement): number {
  return movement.status === "Réalisé" ? actualMovementFte(movement) : planMovementFte(movement);
}

/** Principaux départements d'une liste de mouvements — raccourci de `topContributors` groupé par
 *  `movement.department`. */
export function departmentContributors(
  movements: WorkforceMovement[],
  valueOf: (movement: WorkforceMovement) => number,
  options: { limit?: number; exclude?: string[] } = {}
): HrPreviewContributor[] {
  return topContributors(movements, (m) => m.department, valueOf, options);
}

/** Un écart est-il DÉFAVORABLE ? `higherIsBetter` = économies (un écart négatif est défavorable) ;
 *  `false` = coûts (ENR : un dépassement positif est défavorable). Écart nul = jamais défavorable.
 *  Pilote la couleur corail (défavorable) / encre (favorable) de la ligne d'écart. */
export function isUnfavourableGap(gap: number, higherIsBetter = true): boolean {
  if (!Number.isFinite(gap) || Math.abs(gap) < 1e-9) return false;
  return higherIsBetter ? gap < 0 : gap > 0;
}
