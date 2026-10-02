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
 * Saisies manuelles au niveau chantier (`Chantier.allocatedBudget`, `Chantier.consumedBudget`) :
 * lues UNIQUEMENT pour un chantier dont AUCUN projet ne porte de budget (pas de projet, ou projets
 * sans budget ni consommé — décision 2026-09-28, audit STR-09 : CH-rpa affichait 0 € au lieu de
 * ses 1,1 M€). Dès qu'un projet du chantier porte un montant, seule la somme des projets compte, et
 * `allocatedBudget` n'est plus qu'une « enveloppe » indicative.
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
  chantiers: (Pick<Chantier, "id" | "axisIds"> &
    Partial<Pick<Chantier, "allocatedBudget" | "consumedBudget">>)[],
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

  // Chantier dont aucun projet ne porte de budget : sa saisie propre (voir doc ci-dessus).
  const withProjects = new Set(
    actions
      .filter((a) => (a.budget ?? 0) > 0 || (a.consumedBudget ?? 0) > 0)
      .map((a) => a.chantierId)
  );
  for (const chantier of chantiers) {
    if (withProjects.has(chantier.id)) continue;
    const figures = {
      allocated: chantier.allocatedBudget ?? 0,
      consumed: chantier.consumedBudget ?? 0,
    };
    if (!figures.allocated && !figures.consumed) continue;
    add(chantierTotals.get(chantier.id)!, figures);
    add(programme, figures);
    const axisId = chantierAxisId.get(chantier.id);
    if (!axisId) add(unattributed, figures);
    else {
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

// ─── Parts AFFICHÉES d'un total (donuts, listes « par axe » / « par chantier ») ──────────────

/** Une part affichable d'un total budgétaire :
 *  - `axis` / `chantier` : entité VISIBLE du lecteur (nom affichable) ;
 *  - `unattributed` : chantiers sans axe connu (« Sans axe ») ;
 *  - `otherAxes` / `otherChantiers` : AGRÉGAT anonyme de tout ce qui est hors du périmètre du
 *    lecteur (confidentialité, ownership) — jamais de nom ni de détail, seulement le montant. */
export type BudgetShare =
  | { kind: "axis"; id: string; figures: BudgetFigures }
  | { kind: "chantier"; id: string; figures: BudgetFigures }
  | { kind: "unattributed"; figures: BudgetFigures }
  | { kind: "otherAxes"; figures: BudgetFigures }
  | { kind: "otherChantiers"; figures: BudgetFigures };

const EPSILON = 1e-9;

function hasAmount(f: BudgetFigures): boolean {
  return f.allocated > EPSILON || f.consumed > EPSILON;
}

/** Reste `total − Σ shown`, borné à 0 (arrondis flottants). */
function remainder(total: BudgetFigures, shown: BudgetFigures[]): BudgetFigures {
  const sum = shown.reduce(
    (acc, f) => ({ allocated: acc.allocated + f.allocated, consumed: acc.consumed + f.consumed }),
    { ...ZERO }
  );
  return {
    allocated: Math.max(0, total.allocated - sum.allocated),
    consumed: Math.max(0, total.consumed - sum.consumed),
  };
}

/**
 * Parts PAR AXE du total programme — SEULE définition partagée par la puce « Budget alloué » du
 * dashboard (liste de sa popover) et le donut « Budget financier alloué » de la page Effectifs
 * (niveau axes). `rollup` doit être calculé sur le programme COMPLET (`useStrategicData().program`)
 * pour que le total et chaque axe soient les MÊMES pour tous les profils ; `visibleAxes` = axes
 * affichables du lecteur (ordre conservé, part à 0 incluse).
 *
 * Invariant : la somme des parts vaut EXACTEMENT `rollup.programme` — axes visibles, puis
 * « Sans axe » (si montant), puis « Autres axes » (reste : axes hors périmètre, si montant).
 */
export function budgetAxisShares(
  rollup: Pick<BudgetRollup, "axes" | "programme" | "unattributed">,
  visibleAxes: Pick<StrategicAxis, "id">[]
): BudgetShare[] {
  const shares: BudgetShare[] = visibleAxes.map((axis) => ({
    kind: "axis" as const,
    id: axis.id,
    figures: { ...(rollup.axes.get(axis.id) ?? ZERO) },
  }));
  if (hasAmount(rollup.unattributed)) {
    shares.push({ kind: "unattributed", figures: { ...rollup.unattributed } });
  }
  const others = remainder(
    rollup.programme,
    shares.map((s) => s.figures)
  );
  if (hasAmount(others)) shares.push({ kind: "otherAxes", figures: others });
  return shares;
}

/**
 * Parts PAR CHANTIER du budget d'UN axe (drill-down du donut Effectifs, donut d'axe de la feuille
 * de route) : chantiers VISIBLES attribués à cet axe (axe primaire, `rollup.chantierAxisId`) ayant
 * un montant, puis « Autres chantiers » (reste anonyme : chantiers hors périmètre). Somme des parts
 * = `rollup.axes.get(axisId)`.
 */
export function budgetChantierShares(
  rollup: Pick<BudgetRollup, "axes" | "chantiers" | "chantierAxisId">,
  axisId: string,
  visibleChantiers: Pick<Chantier, "id">[]
): BudgetShare[] {
  const shares: BudgetShare[] = visibleChantiers
    .filter((c) => rollup.chantierAxisId.get(c.id) === axisId)
    .map((c) => ({
      kind: "chantier" as const,
      id: c.id,
      figures: { ...(rollup.chantiers.get(c.id) ?? ZERO) },
    }))
    .filter((s) => hasAmount(s.figures));
  const others = remainder(
    rollup.axes.get(axisId) ?? ZERO,
    shares.map((s) => s.figures)
  );
  if (hasAmount(others)) shares.push({ kind: "otherChantiers", figures: others });
  return shares;
}
