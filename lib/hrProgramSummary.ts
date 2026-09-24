import type { WorkforceMovement } from "@/types";
import { isActiveMovement } from "@/lib/workforceLogic";

/**
 * Synthèse RH programme — équivalent RH du `programSummary` du dashboard exécutif.
 * Retourne les 4 KPI du bandeau supérieur du Dashboard RH (Impact ETP, Économies nettes de masse
 * salariale, Coûts sociaux consommés, Économies nettes), chacun en trois vues :
 *   - `realized` : agrégation sur les mouvements dont `status === "Réalisé"` (valeurs constatées).
 *   - `target` : agrégation "cible bottom-up" — utilise `lockedPlan` si présent, sinon les
 *     valeurs brutes du mouvement.
 *   - `reforecast` : agrégation "prévision réactualisée" — utilise `reforecast` si présent,
 *     sinon repli sur `lockedPlan`, sinon repli sur les valeurs brutes.
 *
 * La progressPct est calculée : realized / target (borné à 100). Une target à 0 → 0%.
 *
 * ── Règle UNIQUE de l'ETP d'un mouvement (M10) ───────────────────────────────────────────────
 *   - Vues PLAN / CIBLE (KPI cible, rythme des mouvements, ventilation « mouvements prévus »,
 *     bilans nets des infobulles et drill-downs, positions cibles) : `planMovementFte` =
 *     `lockedPlan.fte ?? fte`.
 *   - Vues RÉALISÉ / ACTUEL (KPI réalisé, effectif actuel, réalisé par dimension) :
 *     `actualMovementFte` = `fte` (valeur constatée, tenue à jour après la validation).
 *
 * ── Définition UNIQUE des économies de masse salariale (M7) ──────────────────────────────────
 *   `movementSalarySavings` = −salaryImpact : économies NETTES des recrutements (un recrutement
 *   compte négativement). Utilisée à la fois par le KPI « Économies nettes de masse salariale » et
 *   par le graphique « Économies par période et cumul » (lib/hrTimeSeries.ts).
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
  /** € économies nettes de masse salariale annualisées (−salaryImpact) — nettes des recrutements
   *  (un recrutement les réduit), voir `movementSalarySavings`. */
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

/** ETP d'un mouvement pour les vues PLAN / CIBLE (voir la règle M10 en tête de fichier). */
export function planMovementFte(m: WorkforceMovement): number {
  return m.lockedPlan?.fte ?? m.fte;
}

/** ETP d'un mouvement pour les vues RÉALISÉ / ACTUEL (voir la règle M10 en tête de fichier). */
export function actualMovementFte(m: WorkforceMovement): number {
  return m.fte;
}

export type MovementValueView = "actual" | "target" | "reforecast";

/** Économie annuelle de masse salariale d'un mouvement, NETTE des recrutements : −salaryImpact
 *  (positive pour une sortie, négative pour un recrutement). Définition unique partagée par le
 *  KPI et les séries temporelles (M7). `view` choisit la valeur brute, le plan figé ou le
 *  reforecast. */
export function movementSalarySavings(
  m: WorkforceMovement,
  view: MovementValueView = "actual"
): number {
  const impact =
    view === "target"
      ? targetValue(m, "salaryImpact")
      : view === "reforecast"
        ? reforecastValue(m, "salaryImpact")
        : m.salaryImpact;
  return -(Number.isFinite(impact) ? impact : 0);
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
    default:
      // Type legacy inconnu : neutre (même filet défensif que `hrEngine.fteEffect`).
      return 0;
  }
}

/** Impact ETP cible d'un mouvement, source unique du KPI et des séries temporelles.
 * Les transferts restent visibles comme flux bruts dans les graphiques mais sont neutres sur
 * l'effectif total. Les abandonnés sont exclus de la cible. */
export function targetMovementFteImpact(movement: WorkforceMovement): number {
  if (!isActiveMovement(movement)) return 0;
  return fteSign(movement) * planMovementFte(movement);
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
    if (isRealized) fteRealized += sign * actualMovementFte(m);
    fteTarget += targetMovementFteImpact(m);
    fteReforecast += sign * reforecastValue(m, "fte");

    // Économies nettes de masse salariale — définition unique −salaryImpact (M7) : un
    // recrutement les réduit, au lieu d'un `savings` à 0 qui l'ignorait.
    if (isRealized) salarySavingsRealized += movementSalarySavings(m, "actual");
    salarySavingsTarget += movementSalarySavings(m, "target");
    salarySavingsReforecast += movementSalarySavings(m, "reforecast");

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
