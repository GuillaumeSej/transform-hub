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

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Multiplicateur d'annualisation d'un coût OPEX récurrent porté par une action : contrairement à
 *  un coût ponctuel (one-off/CAPEX), un OPEX récurrent continue de s'appliquer chaque année
 *  jusqu'à la fin du programme (`fyEnd`) — il doit donc peser dans `netSavings` au prorata du
 *  nombre d'années restantes entre la fin de l'action qui le porte et `fyEnd`, pas être compté une
 *  seule fois comme un coût ponctuel. Toujours ≥ 1 (on compte au moins une année de coût, même si
 *  l'action se termine après ou juste avant `fyEnd`). Repli sur `1` (comportement face-value, pas
 *  d'annualisation) si `fyEnd` est absent ou invalide — ex. appelant qui n'a pas encore accès au
 *  programme du levier. */
export function opexRecMultiplier(actionEnd: string, fyEnd: string | undefined): number {
  if (!fyEnd) return 1;
  const end = new Date(actionEnd).getTime();
  const fy = new Date(fyEnd).getTime();
  if (!Number.isFinite(end) || !Number.isFinite(fy)) return 1;
  return Math.max(1, (fy - end) / MS_PER_YEAR);
}

/** Consolide les KPIs d'un levier depuis ses actions (si elles ont des impacts).
 *  Retourne undefined si le levier n'a pas d'actions avec impacts (= saisie manuelle).
 *
 *  `fyEnd` (optionnel, date de fin d'exercice du programme du levier) sert à annualiser les coûts
 *  OPEX récurrents dans le calcul de `netSavings` (voir `opexRecMultiplier`). Le champ persisté
 *  `opexRec` retourné ici reste la somme face-value (run-rate annuel, affiché "OPEX récurrent
 *  /an" ailleurs dans l'UI) — SEULE l'entrée de `netSavings` est pondérée par la durée restante,
 *  pour ne pas changer la signification du champ affiché par ailleurs (Finance charts, stat
 *  "OPEX récurrent /an" du détail levier). */
export function consolidateLeverFromActions(
  lever: Lever,
  fyEnd?: string
): Partial<Lever> | undefined {
  const actions = lever.actions ?? [];
  if (!actions.some((a) => (a.impacts ?? []).length > 0)) return undefined;

  const savings = sumImpacts(actions, (i) => i.type === "saving");
  const capex = sumImpacts(actions, (i) => i.type === "cost" && i.nature === "capex");
  const opexOneOff = sumImpacts(actions, (i) => i.type === "cost" && i.nature === "oneoff");
  const opexRec = sumImpacts(actions, (i) => i.type === "cost" && i.nature === "opex_rec");
  // Coût OPEX récurrent PONDÉRÉ par sa durée restante — utilisé uniquement pour netSavings (voir
  // doc-comment ci-dessus), calculé action par action puisque chaque action a sa propre `end`.
  const opexRecAnnualized = actions.reduce((sum, action) => {
    const recAmount = (action.impacts ?? [])
      .filter((i) => i.type === "cost" && i.nature === "opex_rec")
      .reduce((s, i) => s + i.amount, 0);
    if (recAmount === 0) return sum;
    return sum + recAmount * opexRecMultiplier(action.end, fyEnd);
  }, 0);
  const totalCosts = capex + opexOneOff + opexRecAnnualized;
  const fteImpact = sumFTE(actions);

  return {
    grossSavings: Math.round(savings * 100) / 100,
    netSavings: Math.round((savings - totalCosts) * 100) / 100,
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

/** Calcule le montant net (savings − coûts) d'une action. */
function actionNetAmount(action: LeverAction): number {
  let net = 0;
  for (const imp of action.impacts ?? []) {
    net += imp.type === "saving" ? imp.amount : -imp.amount;
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

/** Calcule le mois de payback (1er mois où le cumul plan ≥ 0 après avoir été négatif). */
export function leverPayback(jcurve: JCurvePoint[]): string | null {
  let wasNegative = false;
  for (const point of jcurve) {
    if (point.plan < 0) wasNegative = true;
    if (wasNegative && point.plan >= 0) return point.month;
  }
  return null;
}
