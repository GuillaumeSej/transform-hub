import type { Lever, WorkforceMovement } from "@/types";
import { consolidateLeverFromActions } from "@/lib/leverConsolidate";
import { fteEffect } from "@/lib/hrEngine";
import { leverImpactsOf } from "@/lib/engine";
import { isActiveMovement } from "@/lib/workforceLogic";

/**
 * Réconciliation ETP levier ↔ mouvements RH (audit issues #1, #2, #6) — page détail du levier,
 * onglet Impact / bloc "IMPACT RH". Séparé de `lib/hrEngine.ts` (agrégations du dashboard RH,
 * qui ne connaît pas les leviers un par un) et de `lib/leverConsolidate.ts` (consolidation des
 * KPIs financiers/ETP d'un levier depuis SES actions, qui ignore les mouvements RH) : ce module
 * fait le pont entre les deux, uniquement pour la page détail d'un levier.
 *
 * Tolérance ETP en dessous de laquelle un écart "Réalisé RH vs Réalisé levier" n'est pas
 * considéré comme une anomalie (arrondis / demi-ETP saisis différemment de part et d'autre).
 */
const FTE_TOLERANCE = 0.5;

export type LeverMovementReconciliation = {
  leverId: string;
  /** Impact ETP visé du levier (signé) — `consolidateLeverFromActions` si le levier est piloté
   *  par actions chiffrées, sinon repli sur `lever.fteImpact`. */
  leverFteImpact: number;
  /** Tous les mouvements RH actifs (non "Abandonné") liés à ce levier (`leverId` match). */
  movements: WorkforceMovement[];
  /** Somme signée (`fteEffect`) des mouvements au statut "Réalisé". */
  realizedFte: number;
  /** Somme signée (`fteEffect`) de TOUS les mouvements actifs (réalisés + planifiés + à faire). */
  allFte: number;
  /** Mouvements dont le signe (`fteEffect`) contredit le sens global du levier (ex. un
   *  "Recrutement"/"Transfert entrant" — effet positif — lié à un levier dont l'impact ETP visé
   *  est négatif, ou l'inverse). Flagués individuellement, jamais nettés silencieusement. */
  mismatchedMovements: WorkforceMovement[];
  /** Aucun mouvement RH lié à ce levier — couverture nulle. */
  hasNoMovements: boolean;
  /** Le cumul des mouvements RÉALISÉS diverge de plus de `FTE_TOLERANCE` ETP du "Réalisé à date
   *  (ETP)" affiché pour le levier (progression % × impact ETP visé). */
  isRealizedMismatch: boolean;
  /** Résumé : au moins une des anomalies ci-dessus est présente — pilote l'affichage du badge
   *  d'alerte dans le bloc "IMPACT RH". */
  hasWarning: boolean;
};

/** Réconcilie un levier avec les mouvements RH qui lui sont rattachés (`movement.leverId`).
 *  `realizedToDateFte` : le "Réalisé à date (ETP)" déjà affiché pour ce levier côté page détail
 *  (`engine.realizedFte(lever)`), passé en paramètre plutôt que recalculé ici pour ne jamais
 *  diverger de ce que l'utilisateur voit juste au-dessus du panneau de réconciliation. */
export function reconcileLeverMovements(
  lever: Lever,
  allMovements: WorkforceMovement[],
  realizedToDateFte: number
): LeverMovementReconciliation {
  const movements = allMovements.filter((m) => m.leverId === lever.id && isActiveMovement(m));

  const realizedFte =
    Math.round(
      movements.filter((m) => m.status === "Réalisé").reduce((s, m) => s + fteEffect(m), 0) * 10
    ) / 10;
  const allFte = Math.round(movements.reduce((s, m) => s + fteEffect(m), 0) * 10) / 10;

  const consolidated = consolidateLeverFromActions(lever);
  const leverFteImpact = consolidated?.fteImpact ?? lever.fteImpact;
  const direction = Math.sign(leverFteImpact);

  const mismatchedMovements = movements.filter((m) => {
    const effect = fteEffect(m);
    if (effect === 0 || direction === 0) return false;
    return Math.sign(effect) !== direction;
  });

  const hasNoMovements = movements.length === 0;
  const isRealizedMismatch =
    !hasNoMovements && Math.abs(realizedFte - realizedToDateFte) > FTE_TOLERANCE;

  return {
    leverId: lever.id,
    leverFteImpact,
    movements,
    realizedFte,
    allFte,
    mismatchedMovements,
    hasNoMovements,
    isRealizedMismatch,
    hasWarning: hasNoMovements || isRealizedMismatch || mismatchedMovements.length > 0,
  };
}

/** Mots-clés (recrutement/embauche) recherchés dans la description du levier et les libellés de
 *  ses lignes d'impact d'actions — garde-fou générique de l'audit issue #6 : un levier affichant
 *  un ETP visé POSITIF (créations de postes) alors que rien dans son texte ne mentionne un
 *  recrutement doit être signalé comme "à vérifier", plutôt que silencieusement affiché comme
 *  n'importe quelle autre valeur signée. Recherche insensible à la casse/accents basique. */
const HIRING_KEYWORDS = ["recrut", "embauch", "hire", "hiring"];

export function mentionsHiring(lever: Lever): boolean {
  const haystack = [lever.description, ...leverImpactsOf(lever).map((i) => i.label)]
    .filter((s): s is string => !!s)
    .join(" ")
    .toLowerCase();
  return HIRING_KEYWORDS.some((k) => haystack.includes(k));
}
