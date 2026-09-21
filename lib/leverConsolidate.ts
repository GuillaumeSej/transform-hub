import type { Lever, LeverAction } from "@/types";
import {
  MONTH_LABELS,
  impactTrajectory,
  leverImpactTotals,
  leverImpactsOf,
  realizedGrossSavings,
  realizedSavings,
} from "@/lib/engine";

// ─── Consolidation des KPIs d'un levier depuis ses actions ──────────────────

/** Vérifie si le levier a des impacts définis (niveau levier, ou anciens impacts d'actions non
 *  encore migrés). Nom conservé pour compat des appelants. */
export function hasActionImpacts(lever: Lever): boolean {
  return leverImpactsOf(lever).length > 0;
}

/** Consolide les KPIs financiers d'un levier depuis ses impacts (`Lever.impacts`, repli sur
 *  l'ancien `action.impacts`). Retourne undefined si le levier n'a aucun impact (= saisie manuelle
 *  des macro-valeurs conservée).
 *
 *  `netSavings = gains récurrents annuels − CAPEX` (règle métier explicite : NI l'OPEX one-off NI
 *  l'OPEX récurrent ne réduisent le "net"). Les gains one-off sont EXCLUS de grossSavings/netSavings
 *  (voir `engine.leverImpactTotals`). Le salaire des départs ETP compte en gain, celui des
 *  recrutements en OPEX récurrent. */
export function consolidateLeverFromActions(lever: Lever): Partial<Lever> | undefined {
  if (!hasActionImpacts(lever)) return undefined;
  const t = leverImpactTotals(lever);
  return {
    grossSavings: t.grossAnnual,
    netSavings: t.netAnnual,
    capex: t.capex,
    opexOneOff: t.opexOneOff,
    opexRec: t.opexRec,
    fteImpact: t.fteNet,
  };
}

/** Alias explicite du nom courant (les impacts vivent sur le levier). */
export const consolidateLeverFromImpacts = consolidateLeverFromActions;

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
  // Modèle actuel : trajectoire issue des impacts du levier (OPEX/CAPEX/gains datés) ; le réalisé
  // est le plan cumulé au prorata de l'avancement des actions (jamais des gains).
  if (lever.impacts && lever.impacts.length > 0) {
    const { points } = impactTrajectory(lever, { granularity: "month", includeCancelled: true });
    const fyStartDate = new Date(fyStart);
    const now = new Date();
    const ratio = realizedSavings(lever) / (lever.netSavings || 1);
    return points
      .filter(
        (p) =>
          new Date(p.periodStart) >= new Date(fyStartDate.getFullYear(), fyStartDate.getMonth(), 1)
      )
      .map((p) => {
        const d = new Date(p.periodStart);
        const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        return {
          month: p.period,
          plan: Math.round(p.cumulativeNetRecurring * 100) / 100,
          reforecast: Math.round(p.cumulativeNetRecurring * 100) / 100,
          actual:
            monthEnd <= now
              ? Math.round(
                  Math.max(0, p.cumulativeNetRecurring) * Math.min(1, Math.max(0, ratio)) * 100
                ) / 100
              : null,
        };
      });
  }
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
  return Math.round(realizedGrossSavings(lever) * 100) / 100;
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
