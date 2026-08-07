import type { WorkforceMovement } from "@/types";
import { isActiveMovement } from "@/lib/workforceLogic";

/**
 * Synthèse RH programme — équivalent RH du `programSummary` du dashboard exécutif.
 * Retourne les 4 KPI du bandeau supérieur du Dashboard RH (Impact ETP, Économies salariales
 * annuelles, Coûts sociaux consommés, Économies nettes), chacun en trois vues :
 *   - `realized` : agrégation sur les mouvements dont `status === "Réalisé"` (valeurs constatées).
 *   - `target` : agrégation "cible bottom-up" — utilise `lockedPlan` si présent, sinon les
 *     valeurs brutes du mouvement.
 *   - `reforecast` : agrégation "prévision réactualisée" — utilise `reforecast` si présent,
 *     sinon repli sur `lockedPlan`, sinon repli sur les valeurs brutes.
 *
 * La progressPct est calculée : realized / target (borné à 100). Une target à 0 → 0%.
 *
 * Fonction pure — les mouvements sont pré-filtrés par l'appelant (filtres transverses de la
 * page RH).
 */

export type HrKpi = {
  realized: number;
  target: number;
  reforecast: number;
  /** realized / target × 100, borné à [0, 100]. */
  progressPct: number;
};

export type HrProgramSummary = {
  /** Impact ETP — signé, réductions négatives. */
  fte: HrKpi;
  /** € économies salariales annualisées — positives. */
  salarySavings: HrKpi;
  /** € coûts sociaux one-off (ENR) — positives. */
  socialCost: HrKpi;
  /** € économies nettes = salarySavings − socialCost. */
  netEconomy: HrKpi;
};

/** Cible d'effectif absolue dérivée du plan bottom-up des mouvements : baseline + impact ETP
 * cible. Centralisé ici pour que le même résultat puisse alimenter le dashboard, un export Excel
 * ou un autre widget sans recalcul métier dans React. */
export function targetFteFromBaseline(totalFTE: number, targetImpact: number): number {
  const baseline = Number.isFinite(totalFTE) ? totalFTE : 0;
  const impact = Number.isFinite(targetImpact) ? targetImpact : 0;
  return Math.round((baseline + impact) * 10) / 10;
}

function safePct(realized: number, target: number): number {
  if (target === 0) return 0;
  const pct = Math.round((realized / target) * 100);
  return Math.max(-100, Math.min(100, pct));
}

/** Résout la valeur d'une composante financière pour la vue "target" (bottom-up = lockedPlan). */
function targetValue(
  m: WorkforceMovement,
  field: "fte" | "savings" | "cost" | "salaryImpact"
): number {
  if (m.lockedPlan) {
    if (field === "fte") return m.lockedPlan.fte;
    return m.lockedPlan[field];
  }
  if (field === "fte") return m.fte;
  return m[field];
}

/** Résout la valeur d'une composante pour la vue "reforecast" (repli lockedPlan → brut). */
function reforecastValue(
  m: WorkforceMovement,
  field: "fte" | "savings" | "cost" | "salaryImpact"
): number {
  if (m.reforecast) {
    if (field === "fte") return m.reforecast.fte;
    return m.reforecast[field];
  }
  return targetValue(m, field);
}

/** Signe d'un mouvement pour l'ETP (idem `fteEffect` mais avec une valeur FTE arbitraire au lieu
 *  de `m.fte`) — utilisé pour appliquer le signe aux valeurs de `lockedPlan.fte` / `reforecast.fte`. */
function fteSign(m: WorkforceMovement): number {
  switch (m.type) {
    case "Recrutement":
      return +1;
    case "Attrition":
    case "Départ forcé":
      return -1;
    case "Transfert entrant":
    case "Transfert sortant":
      return 0;
  }
}

/** Impact ETP cible d'un mouvement, source unique du KPI et des séries temporelles.
 * Les transferts restent visibles comme flux bruts dans les graphiques mais sont neutres sur
 * l'effectif total. Les abandonnés sont exclus de la cible. */
export function targetMovementFteImpact(movement: WorkforceMovement): number {
  if (!isActiveMovement(movement)) return 0;
  return fteSign(movement) * targetValue(movement, "fte");
}

export function hrProgramSummary(movements: WorkforceMovement[]): HrProgramSummary {
  let fteRealized = 0;
  let fteTarget = 0;
  let fteReforecast = 0;

  let salarySavingsRealized = 0;
  let salarySavingsTarget = 0;
  let salarySavingsReforecast = 0;

  let socialCostRealized = 0;
  let socialCostTarget = 0;
  let socialCostReforecast = 0;

  for (const m of movements) {
    if (!isActiveMovement(m)) continue;
    const sign = fteSign(m);
    const isRealized = m.status === "Réalisé";

    // Impact ETP
    if (isRealized) fteRealized += sign * m.fte;
    fteTarget += targetMovementFteImpact(m);
    fteReforecast += sign * reforecastValue(m, "fte");

    // Économies salariales — on prend `savings` (déjà ≥ 0 par construction, voir hrFinancials).
    if (isRealized) salarySavingsRealized += m.savings;
    salarySavingsTarget += targetValue(m, "savings");
    salarySavingsReforecast += reforecastValue(m, "savings");

    // ENR — `cost` (≥ 0).
    if (isRealized) socialCostRealized += m.cost;
    socialCostTarget += targetValue(m, "cost");
    socialCostReforecast += reforecastValue(m, "cost");
  }

  const netRealized = salarySavingsRealized - socialCostRealized;
  const netTarget = salarySavingsTarget - socialCostTarget;
  const netReforecast = salarySavingsReforecast - socialCostReforecast;

  return {
    fte: {
      realized: Math.round(fteRealized * 10) / 10,
      target: Math.round(fteTarget * 10) / 10,
      reforecast: Math.round(fteReforecast * 10) / 10,
      progressPct: safePct(Math.abs(fteRealized), Math.abs(fteTarget)),
    },
    salarySavings: {
      realized: Math.round(salarySavingsRealized),
      target: Math.round(salarySavingsTarget),
      reforecast: Math.round(salarySavingsReforecast),
      progressPct: safePct(salarySavingsRealized, salarySavingsTarget),
    },
    socialCost: {
      realized: Math.round(socialCostRealized),
      target: Math.round(socialCostTarget),
      reforecast: Math.round(socialCostReforecast),
      progressPct: safePct(socialCostRealized, socialCostTarget),
    },
    netEconomy: {
      realized: Math.round(netRealized),
      target: Math.round(netTarget),
      reforecast: Math.round(netReforecast),
      progressPct: safePct(netRealized, netTarget),
    },
  };
}
