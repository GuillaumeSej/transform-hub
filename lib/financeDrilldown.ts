/**
 * Helpers PURS du drill-down "en place" des donuts du module Finance
 * (`CostEngagedVsUpcomingChart`, `CostByHierarchyChart` — components/finance/FinanceCostCharts.tsx) :
 * un clic sur une part redessine le MÊME graphique au niveau suivant, un fil d'Ariane
 * (`FinanceDrillBreadcrumb`) permet de remonter, et la modale de détail ne s'ouvre qu'au dernier
 * niveau (feuille). Aucune dépendance React — testé dans lib/__tests__/financeDrilldown.test.ts.
 */

/** Une étape du chemin de drill-down : l'élément cliqué (id stable + libellé affiché). */
export type DrillStep = { id: string; label: string };

export type DrillLevelInfo = {
  /** Numéro 1-based du niveau affiché (1 = niveau racine). */
  levelNumber: number;
  /** Nombre total de niveaux cliquables dans la hiérarchie. */
  totalLevels: number;
  /** Niveaux restants SOUS le niveau affiché (0 = on est au dernier niveau). */
  remaining: number;
  /** `true` au dernier niveau : un clic ouvre le détail (modale) au lieu de descendre. */
  isLastLevel: boolean;
};

/** Position du niveau courant dans la hiérarchie, bornée à [1, totalLevels] pour rester robuste
 *  si la config d'arborescence change sous un chemin déjà ouvert (ex. niveau supprimé). */
export function drillLevelInfo(depth: number, totalLevels: number): DrillLevelInfo {
  const total = Math.max(1, totalLevels);
  const levelNumber = Math.min(Math.max(1, depth + 1), total);
  return {
    levelNumber,
    totalLevels: total,
    remaining: total - levelNumber,
    isLastLevel: levelNumber === total,
  };
}

/** Un clic sur une part descend-il d'un niveau (`true`) ou ouvre-t-il le détail (`false`) ?
 *  On descend seulement si l'élément a des enfants ET qu'il reste un niveau sous le niveau courant. */
export function shouldDrillDown(depth: number, totalLevels: number, hasChildren: boolean): boolean {
  return hasChildren && !drillLevelInfo(depth, totalLevels).isLastLevel;
}

/** Chemin après un clic sur la miette `index` du fil d'Ariane : `-1` = racine ("Tous"), sinon on
 *  garde les étapes 0..index incluses (on se replace AU niveau situé sous cette étape). */
export function truncateDrillPath<T>(path: T[], index: number): T[] {
  if (index < 0) return [];
  return path.slice(0, index + 1);
}

/** Chemin après "← Retour" : remonte d'un niveau (sans effet à la racine). */
export function popDrillPath<T>(path: T[]): T[] {
  return path.length === 0 ? path : path.slice(0, -1);
}

/** Chemin nettoyé si un élément n'existe plus dans les données filtrées : on coupe au premier
 *  élément introuvable (ex. filtre de page qui fait disparaître un chantier déjà ouvert). */
export function pruneDrillPath<T extends DrillStep>(
  path: T[],
  existsAtDepth: (step: T, depth: number) => boolean
): T[] {
  const firstMissing = path.findIndex((step, depth) => !existsAtDepth(step, depth));
  return firstMissing === -1 ? path : path.slice(0, firstMissing);
}
