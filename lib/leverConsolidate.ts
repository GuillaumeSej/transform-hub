import type { ActionImpact, Lever, LeverAction } from "@/types";
import { MONTH_LABELS } from "@/lib/engine";

// ─── Consolidation des KPIs d'un levier depuis ses actions ──────────────────

/** Somme des montants d'impacts filtrés. */
function sumImpacts(actions: LeverAction[], filter: (imp: ActionImpact) => boolean): number {
  let total = 0;
  for (const a of actions) {
    for (const imp of a.impacts ?? []) {
      if (filter(imp)) total += imp.amount;
    }
  }
  return Math.round(total * 100) / 100;
}

/** Somme des FTE des impacts (tous types confondus). */
function sumFTE(actions: LeverAction[]): number {
  let total = 0;
  for (const a of actions) {
    for (const imp of a.impacts ?? []) {
      if (imp.fteCount) total += imp.fteCount;
    }
  }
  return total;
}

/** Vérifie si le levier a des actions avec des impacts définis. */
export function hasActionImpacts(lever: Lever): boolean {
  return (lever.actions ?? []).some((a) => (a.impacts ?? []).length > 0);
}

/** Consolide les KPIs d'un levier depuis ses actions (si elles ont des impacts).
 *  Retourne undefined si le levier n'a pas d'actions avec impacts (= saisie manuelle).
 *
 *  `netSavings = savings − opexRec` : les montants saisis (savings comme opexRec) sont déjà des
 *  montants annuels par construction dès la saisie (formulaire d'impact d'action), il n'y a donc
 *  aucune pondération temporelle à appliquer. `capex` et `opexOneOff` sont calculés/consolidés à
 *  part (KPI "CAPEX & coûts one-off") mais ne rentrent plus dans `netSavings`. */
export function consolidateLeverFromActions(lever: Lever): Partial<Lever> | undefined {
  const actions = lever.actions ?? [];
  if (!actions.some((a) => (a.impacts ?? []).length > 0)) return undefined;

  const savings = sumImpacts(actions, (i) => i.type === "saving");
  const capex = sumImpacts(actions, (i) => i.type === "cost" && i.nature === "capex");
  const opexOneOff = sumImpacts(actions, (i) => i.type === "cost" && i.nature === "oneoff");
  const opexRec = sumImpacts(actions, (i) => i.type === "cost" && i.nature === "opex_rec");
  const fteImpact = sumFTE(actions);

  return {
    grossSavings: Math.round(savings * 100) / 100,
    netSavings: Math.round((savings - opexRec) * 100) / 100,
    capex: Math.round(capex * 100) / 100,
    opexOneOff: Math.round(opexOneOff * 100) / 100,
    opexRec: Math.round(opexRec * 100) / 100,
    fteImpact,
  };
}

// ─── Courbe en J ────────────────────────────────────────────────────────────

export type JCurvePoint = {
  month: string; // "Jan 2026"
  plan: number; // cumulatif plan (€M)
  reforecast: number; // cumulatif reforecast (€M)
  actual: number | null; // cumulatif réalisé (null si futur)
};

/** Calcule le montant net d'une action : gains bruts − CAPEX uniquement (règle métier explicite —
 *  ni l'OPEX one-off ni l'OPEX récurrent ne réduisent ce "net", contrairement à un calcul naïf qui
 *  soustrairait tous les impacts `type==="cost"` sans distinguer leur `nature`). Root cause d'un
 *  bug remonté : un levier avec seulement un impact OPEX one-off sur une action livrée affichait un
 *  "Réalisé à date (net)" négatif — l'OPEX one-off ne doit JAMAIS apparaître dans ce calcul. */
function actionNetAmount(action: LeverAction): number {
  let net = 0;
  for (const imp of action.impacts ?? []) {
    if (imp.type === "saving") net += imp.amount;
    else if (imp.nature === "capex") net -= imp.amount;
  }
  return net;
}

/** Construit la courbe en J d'un levier : pour chaque mois de l'exercice, le cumul
 *  (savings − coûts) de toutes les actions dont la date de fin tombe avant ou pendant ce mois.
 *
 *  - **Plan** : impacts au timing prévu (action.end)
 *  - **Réalisé** : impacts des actions en "done" à leur deliveredDate (ou end si absent)
 *  - **Reforecast** : même que plan pour l'instant (extensible quand les actions auront un reforecast) */
export function leverJCurve(lever: Lever, fyStart: string, fyEnd: string): JCurvePoint[] {
  const startYear = new Date(fyStart).getFullYear();
  const endYear = new Date(fyEnd).getFullYear();
  const actions = lever.actions ?? [];

  // Génère les mois couverts par l'exercice (+ 1 année au-delà si nécessaire)
  const months: { label: string; date: Date }[] = [];
  for (let y = startYear; y <= endYear + 1; y++) {
    for (let m = 0; m < 12; m++) {
      months.push({
        label: `${MONTH_LABELS[m]} ${y}`,
        date: new Date(y, m, 1),
      });
    }
  }

  // Pour chaque mois, calculer le cumul plan et réalisé
  let cumulPlan = 0;
  let cumulActual = 0;

  // Report d'entrée (audit issue #4, "Réalisé à date" figé à 0) : `months` ne couvre que
  // `fyStart`..`fyEnd+1an`. Une action dont la date de fin (plan) ou de livraison (réalisé) tombe
  // AVANT `fyStart` (ex. delivrée lors d'un exercice antérieur au programme actuellement
  // configuré) ne correspond alors plus à aucun mois itéré ci-dessous : sa contribution était donc
  // purement et simplement perdue, jamais ajoutée à `cumulPlan`/`cumulActual` — d'où un "Réalisé à
  // date" qui restait obstinément à 0€ même pour un levier livré à 100 %, alors que
  // `engine.realizedSavings` (colonne "Savings réalisé" de la liste des leviers) affichait, lui,
  // un montant non nul. On pré-accumule donc ici la contribution de toute action antérieure à
  // `fyStart`, pour que le premier point de la courbe reparte du bon cumul plutôt que de 0.
  const fyStartDate = new Date(fyStart);
  for (const action of actions) {
    const actionEnd = new Date(action.end);
    if (actionEnd < fyStartDate) cumulPlan += actionNetAmount(action);
    if (action.status === "done") {
      const dDate = action.deliveredDate ? new Date(action.deliveredDate) : new Date(action.end);
      if (dDate < fyStartDate) cumulActual += actionNetAmount(action);
    }
  }

  const now = new Date();

  const points: JCurvePoint[] = [];
  for (const { label, date } of months) {
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);

    // Plan : actions dont la date de fin (end) tombe dans ce mois ou avant
    for (const action of actions) {
      const actionEnd = new Date(action.end);
      if (
        actionEnd.getFullYear() === date.getFullYear() &&
        actionEnd.getMonth() === date.getMonth()
      ) {
        cumulPlan += actionNetAmount(action);
      }
    }

    // Réalisé : actions "done" dont la deliveredDate tombe dans ce mois ou avant
    for (const action of actions) {
      if (action.status !== "done") continue;
      const dDate = action.deliveredDate ? new Date(action.deliveredDate) : new Date(action.end);
      if (dDate.getFullYear() === date.getFullYear() && dDate.getMonth() === date.getMonth()) {
        cumulActual += actionNetAmount(action);
      }
    }

    // N'inclure que les mois pertinents (de fyStart à 6 mois après la dernière action)
    const lastActionEnd = actions.reduce(
      (max, a) => Math.max(max, new Date(a.end).getTime()),
      new Date(fyStart).getTime()
    );
    if (date.getTime() > lastActionEnd + 6 * 30 * 24 * 60 * 60 * 1000) break;
    if (date < new Date(fyStart)) continue;

    points.push({
      month: label,
      plan: Math.round(cumulPlan * 100) / 100,
      reforecast: Math.round(cumulPlan * 100) / 100, // même que plan pour v1
      actual: monthEnd <= now ? Math.round(cumulActual * 100) / 100 : null,
    });
  }

  return points;
}

/** Gains BRUTS (avant déduction des coûts) déjà réalisés à date, pour un levier piloté par
 *  actions — somme des impacts de type "saving" des seules actions au statut "done" (même
 *  périmètre que le "Réalisé" net de `leverJCurve`, qui lui soustrait aussi les coûts des actions
 *  déjà livrées). Sert à afficher, sous le "Réalisé à date" (net), le détail "dont X€ de gains
 *  bruts" — utile pour comprendre l'écart quand des coûts (capex/opex) ont déjà été engagés sur
 *  des actions livrées. */
export function leverGrossRealizedToDate(lever: Lever): number {
  const doneActions = (lever.actions ?? []).filter((a) => a.status === "done");
  return sumImpacts(doneActions, (imp) => imp.type === "saving");
}

/** Valeur "Plan initial (net)" affichée pour un levier (audit issue #5 : sur certains leviers,
 *  ce chiffre ne correspondait pas à la somme des lignes d'impact des actions — parfois même
 *  seulement au montant CAPEX). Root cause : `leversLogic.ts::applyPlanLock` fige `lockedPlan`
 *  en copiant les champs bruts du levier (`grossSavings`/`netSavings`/…) au moment du passage à
 *  "qualified" — or pour un levier créé DÉJÀ piloté par un plan d'actions chiffré (import Excel,
 *  seed démo, création directe à un statut avancé), ces champs bruts n'ont pas forcément été
 *  synchronisés avec les impacts d'actions avant ce gel, ce qui fige alors un "Plan initial" faux
 *  et définitif (`updateLever` interdit ensuite toute correction de ces champs une fois figés).
 *  `leversLogic.ts::snapshot` a été corrigé pour figer les montants consolidés dès le PROCHAIN
 *  verrouillage — mais un levier déjà figé avec un snapshot historique incorrect (démo ou
 *  production existante) garde ce mauvais chiffre en base. Cette fonction corrige donc aussi
 *  l'AFFICHAGE : pour un levier piloté par actions, on préfère toujours la somme actuelle des
 *  lignes d'impact au snapshot figé, pour qu'ils ne puissent plus diverger — sans réécrire les
 *  données. `isLocked` reste vrai/faux selon la présence d'un `lockedPlan`, pour ne pas changer la
 *  sémantique visuelle "figé"/"non figé" affichée par `ProvisionalValue`. */
export function resolveLockedPlanNet(lever: Lever): { value: number; isLocked: boolean } {
  const consolidated = consolidateLeverFromActions(lever);
  if (consolidated) {
    return { value: consolidated.netSavings ?? 0, isLocked: !!lever.lockedPlan };
  }
  return lever.lockedPlan
    ? { value: lever.lockedPlan.netSavings, isLocked: true }
    : { value: lever.netSavings, isLocked: false };
}

/** Calcule le mois de payback (1er mois où le cumul plan ≥ 0 après avoir été négatif). */
export function leverPayback(jcurve: JCurvePoint[]): string | null {
  let wasNegative = false;
  for (const point of jcurve) {
    if (point.plan < 0) wasNegative = true;
    if (wasNegative && point.plan >= 0) return point.month;
  }
  return null;
}
