import type { Chantier, ChantierAction, StrategicAxis } from "@/types";

/**
 * Agrégation BOTTOM-UP des budgets du Plan Stratégique — SEUL point de vérité pour tout montant
 * « budget alloué » / « budget consommé » affiché (puce et infobulle du dashboard, alerte
 * d'AppShell, donut « Budget financier alloué » de la page Effectifs, en-têtes d'axe de la feuille
 * de route, fiche chantier…). Fonction pure : aucun I/O, aucun état React.
 *
 * Règle PO (doit tenir partout) :
 *  - PROJET (`ChantierAction`) : alloué = `budget`, consommé = `consumedBudget` (absent = 0) ;
 *  - CHANTIER : somme de ses projets ;
 *  - AXE : somme des chantiers qui lui sont ATTRIBUÉS (voir ci-dessous) ;
 *  - PROGRAMME : somme de TOUS les projets distincts (= somme des axes + `unattributed`).
 *
 * Les saisies manuelles au niveau chantier (`Chantier.allocatedBudget`, `Chantier.consumedBudget`)
 * ne sont JAMAIS lues ici : `allocatedBudget` n'est plus qu'une « enveloppe du chantier » (plafond
 * indicatif, comparé à la somme des projets à la création d'un projet), pas un budget alloué.
 *
 * Chantiers multi-axes (`Chantier.axisIds`) — règle d'attribution : le budget COMPLET d'un chantier
 * est attribué à UN SEUL axe, son axe primaire, c'est-à-dire le PREMIER id de `axisIds` présent
 * dans la liste `axes` fournie (en pratique `axisIds[0]`, sauf axe supprimé ou hors périmètre
 * visible). Jamais dupliqué ni réparti au prorata : ainsi la somme des axes est égale au total
 * programme, et le montant d'un chantier est le même quel que soit l'écran. Un chantier dont aucun
 * axe n'est connu reste compté dans le total programme, dans `unattributed`.
 *
 * Un projet dont le chantier n'est pas dans `chantiers` (orphelin, ou autre programme) est ignoré.
 *
 * `attributionAxes` (optionnel) : liste COMPLÈTE des axes du programme, utilisée pour DÉTERMINER
 * l'axe primaire d'un chantier indépendamment de ce que le lecteur voit — sans elle, un utilisateur
 * ne voyant pas l'axe primaire d'un chantier multi-axe l'aurait vu attribué à un autre axe (montant
 * différent selon le lecteur). `axes` reste la liste AFFICHÉE : un chantier attribué à un axe non
 * affiché compte dans le total programme mais dans aucun axe affiché (ni dans `unattributed`).
 */
export type BudgetFigures = { allocated: number; consumed: number };

export type BudgetRollup = {
  projets: Map<string, BudgetFigures>;
  chantiers: Map<string, BudgetFigures>;
  axes: Map<string, BudgetFigures>;
  programme: BudgetFigures;
  /** Part du total programme portée par des chantiers sans axe connu (voir doc ci-dessus). */
  unattributed: BudgetFigures;
  /** Axe d'attribution de chaque chantier (absent = `unattributed`). */
  chantierAxisId: Map<string, string>;
};

const ZERO: BudgetFigures = { allocated: 0, consumed: 0 };

/** Montants vides — pratique pour `rollup.chantiers.get(id) ?? EMPTY_BUDGET`. */
export const EMPTY_BUDGET: Readonly<BudgetFigures> = Object.freeze({ ...ZERO });

/** Axe d'attribution budgétaire d'un chantier — voir la règle multi-axes ci-dessus. */
export function budgetAxisIdOf(
  chantier: Pick<Chantier, "axisIds">,
  knownAxisIds: ReadonlySet<string>
): string | undefined {
  return chantier.axisIds.find((id) => knownAxisIds.has(id));
}

function add(target: BudgetFigures, source: BudgetFigures): void {
  target.allocated += source.allocated;
  target.consumed += source.consumed;
}

export function rollupBudgets(
  axes: Pick<StrategicAxis, "id">[],
  chantiers: Pick<Chantier, "id" | "axisIds">[],
  actions: Pick<ChantierAction, "id" | "chantierId" | "budget" | "consumedBudget">[],
  attributionAxes?: Pick<StrategicAxis, "id">[]
): BudgetRollup {
  const knownAxisIds = new Set([...axes, ...(attributionAxes ?? [])].map((a) => a.id));
  const projets = new Map<string, BudgetFigures>();
  const chantierTotals = new Map<string, BudgetFigures>();
  const axisTotals = new Map<string, BudgetFigures>();
  const chantierAxisId = new Map<string, string>();
  const programme: BudgetFigures = { ...ZERO };
  const unattributed: BudgetFigures = { ...ZERO };

  for (const axis of axes) axisTotals.set(axis.id, { ...ZERO });
  for (const chantier of chantiers) {
    chantierTotals.set(chantier.id, { ...ZERO });
    const axisId = budgetAxisIdOf(chantier, knownAxisIds);
    if (axisId) chantierAxisId.set(chantier.id, axisId);
  }

  for (const action of actions) {
    const chantierTotal = chantierTotals.get(action.chantierId);
    if (!chantierTotal) continue;
    const figures = { allocated: action.budget ?? 0, consumed: action.consumedBudget ?? 0 };
    projets.set(action.id, figures);
    add(chantierTotal, figures);
    add(programme, figures);
    const axisId = chantierAxisId.get(action.chantierId);
    if (!axisId) add(unattributed, figures);
    else {
      // Axe d'attribution non affiché (hors `axes`) : compté au programme seulement.
      const axisTotal = axisTotals.get(axisId);
      if (axisTotal) add(axisTotal, figures);
    }
  }

  return {
    projets,
    chantiers: chantierTotals,
    axes: axisTotals,
    programme,
    unattributed,
    chantierAxisId,
  };
}
