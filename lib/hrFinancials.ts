import type { Company, MovementType } from "@/types";
import { daysBetween } from "@/lib/dateUtils";

/**
 * Calcul EUR mécanisme-dépendant des mouvements RH (Vision mouvement / Base ETP).
 *
 * Aligné sur la typologie 5-types Gooduelle (`Recrutement`, `Attrition`, `Départ forcé`,
 * `Transfert entrant`, `Transfert sortant`). Chaque type a sa propre formule de calcul :
 *   - Recrutement : payroll ajouté (+), frais de recrutement + onboarding.
 *   - Attrition : départ volontaire → savings récurrentes = loadedSalary, coût social minime
 *     (préavis court, PAS d'indemnité de rupture).
 *   - Départ forcé : miroir de l'ancienne "Suppression" avec multiplicateur pour refléter la
 *     contrainte (transaction).
 *   - Transfert entrant / sortant : mobilité interne, coût de transition léger (5% par défaut)
 *     ou majoré si `requiresRetraining=true` (reconversion — 15%).
 *
 * ASSUMPTIONS BUSINESS À VALIDER AVEC LE CLIENT (documentées ici faute de politique RH réelle
 * fournie) :
 * - Taux de charges patronales par défaut (`DEFAULT_SOCIAL_CHARGES_RATE`) : ordre de grandeur
 *   France, statut cadre — configurable via `Company.socialChargesRate`.
 * - Formules de coûts sociaux : ESTIMATIONS simplifiées, PAS des règles légales exactes.
 * - `FORCED_DEPARTURE_MULTIPLIER = 1.2` (rupture négociée en contexte contraint) — à ajuster.
 * - `ATTRITION_NOTICE_MONTHS = 0.5` (départ volontaire, préavis souvent réduit) — à ajuster.
 *
 * Toutes les fonctions sont pures — voir lib/__tests__/hrFinancials.test.ts.
 */

/** Taux de charges sociales patronales par défaut si l'entreprise n'a rien configuré. */
export const DEFAULT_SOCIAL_CHARGES_RATE = 0.45;

/** Préavis moyen estimé (mois de salaire chargé) pour un Départ forcé. */
export const NOTICE_PERIOD_MONTHS = 2;

/** Préavis moyen estimé (mois de salaire chargé) pour une Attrition — souvent plus court car
 *  départ volontaire, parfois négocié à la baisse. */
export const ATTRITION_NOTICE_MONTHS = 0.5;

/** Surcoût d'accompagnement (outplacement, cellule de reclassement...) si le mouvement est
 *  inclus dans un PSE, en % de l'indemnité de licenciement estimée. */
export const PSE_OVERHEAD_RATE = 0.2;

/** Multiplicateur appliqué à l'indemnité + préavis d'un Départ forcé pour refléter la
 *  contrainte (rupture conventionnelle négociée en contexte défavorable). */
export const FORCED_DEPARTURE_MULTIPLIER = 1.2;

/** Frais de recrutement (cabinet, sourcing, jobboards...) en % du salaire chargé annuel. */
export const RECRUITMENT_FEE_RATE = 0.15;

/** Coût d'intégration/onboarding estimé (mois de salaire chargé). */
export const ONBOARDING_COST_MONTHS = 0.5;

/** Coût de transition interne (formation courte, changement d'équipe) pour un transfert
 *  interne SANS reconversion. */
export const TRANSFER_TRANSITION_RATE = 0.05;

/** Coût de reconversion (formation lourde, requalification) pour un transfert interne avec
 *  `requiresRetraining=true` — plus élevé qu'un simple transfert. */
export const RETRAINING_TRANSITION_RATE = 0.15;

/** Alias historique pour rétrocompat — pointe sur `TRANSFER_TRANSITION_RATE`. */
export const REDEPLOIEMENT_TRANSITION_RATE = TRANSFER_TRANSITION_RATE;
/** Alias historique pour rétrocompat — pointe sur `RETRAINING_TRANSITION_RATE`. */
export const RECONVERSION_TRANSITION_RATE = RETRAINING_TRANSITION_RATE;

/** Résout le taux de charges sociales patronales à utiliser : celui configuré sur l'entreprise,
 *  ou la valeur par défaut si absent/invalide. */
export function getSocialChargesRate(company?: Pick<Company, "socialChargesRate"> | null): number {
  const rate = company?.socialChargesRate;
  return typeof rate === "number" && Number.isFinite(rate) && rate >= 0
    ? rate
    : DEFAULT_SOCIAL_CHARGES_RATE;
}

/** Salaire chargé annuel = salaire brut annuel × (1 + taux de charges patronales). */
export function loadedAnnualSalary(grossSalary: number, chargesRate: number): number {
  return Math.max(0, grossSalary) * (1 + Math.max(0, chargesRate));
}

/** Ancienneté en années pleines (décimales) entre la date d'embauche et une date de référence. */
export function tenureYears(hireDate: string | undefined | null, refDate: string): number {
  if (!hireDate) return 0;
  const days = daysBetween(hireDate, refDate);
  return days > 0 ? days / 365.25 : 0;
}

/** Indemnité de licenciement estimée, barème légal français simplifié : 1/4 mois de salaire
 *  chargé par année d'ancienneté jusqu'à 10 ans, puis 1/3 mois au-delà. */
export function severanceEstimate(loadedSalary: number, tenure: number): number {
  const monthly = loadedSalary / 12;
  const first10 = Math.min(tenure, 10) * 0.25 * monthly;
  const beyond10 = Math.max(tenure - 10, 0) * (1 / 3) * monthly;
  return Math.round(first10 + beyond10);
}

export type MovementFinancialsInput = {
  type: MovementType;
  grossSalary: number;
  chargesRate: number;
  /** Ancienneté en années — utilisée pour les Départs forcés / Attrition. */
  tenure?: number;
  /** Mouvement inclus dans un PSE — majore le coût social d'un Départ forcé. */
  inPSE?: boolean;
  /** Uniquement `Transfert entrant`/`Transfert sortant` : `true` = reconversion (taux majoré). */
  requiresRetraining?: boolean;
};

export type MovementFinancials = {
  loadedSalary: number;
  /** € économie de masse salariale chargée en régime annuel (≥ 0). 0 pour Recrutement et pour
   *  Transfert entrant/sortant (aucune réduction nette d'ETP). */
  salarySavings: number;
  /** € coût social one-off (ENR — Éléments Non Récurrents). */
  socialCost: number;
  /** € impact masse salariale ANNUEL signé (négatif = économie). */
  salaryImpact: number;
  /** € impact net la première année (salaryImpact + socialCost). */
  netFirstYearImpact: number;
};

export function computeMovementFinancials(input: MovementFinancialsInput): MovementFinancials {
  const {
    type,
    grossSalary,
    chargesRate,
    tenure = 0,
    inPSE = false,
    requiresRetraining = false,
  } = input;
  const loadedSalary = Math.round(loadedAnnualSalary(grossSalary, chargesRate));

  switch (type) {
    case "Départ forcé": {
      const severance = severanceEstimate(loadedSalary, tenure);
      const notice = Math.round((NOTICE_PERIOD_MONTHS / 12) * loadedSalary);
      const pseOverhead = inPSE ? Math.round(PSE_OVERHEAD_RATE * severance) : 0;
      const rawCost = severance + notice + pseOverhead;
      const socialCost = Math.round(rawCost * FORCED_DEPARTURE_MULTIPLIER);
      return {
        loadedSalary,
        salarySavings: loadedSalary,
        socialCost,
        salaryImpact: -loadedSalary,
        netFirstYearImpact: -loadedSalary + socialCost,
      };
    }
    case "Attrition": {
      // Départ volontaire : savings intégrales, préavis court, pas d'indemnité, pas de PSE.
      const socialCost = Math.round((ATTRITION_NOTICE_MONTHS / 12) * loadedSalary);
      return {
        loadedSalary,
        salarySavings: loadedSalary,
        socialCost,
        salaryImpact: -loadedSalary,
        netFirstYearImpact: -loadedSalary + socialCost,
      };
    }
    case "Recrutement": {
      const fee = Math.round(RECRUITMENT_FEE_RATE * loadedSalary);
      const onboarding = Math.round((ONBOARDING_COST_MONTHS / 12) * loadedSalary);
      const socialCost = fee + onboarding;
      return {
        loadedSalary,
        salarySavings: 0,
        socialCost,
        salaryImpact: loadedSalary,
        netFirstYearImpact: loadedSalary + socialCost,
      };
    }
    case "Transfert entrant":
    case "Transfert sortant": {
      const rate = requiresRetraining ? RETRAINING_TRANSITION_RATE : TRANSFER_TRANSITION_RATE;
      const socialCost = Math.round(rate * loadedSalary);
      return {
        loadedSalary,
        salarySavings: 0,
        socialCost,
        salaryImpact: 0,
        netFirstYearImpact: socialCost,
      };
    }
  }
}

/** Raccourci pratique : calcule directement les 3 champs persistés sur WorkforceMovement
 *  (salaryImpact/savings/cost). */
export function computeMovementEuros(
  type: MovementType,
  grossSalary: number,
  company: Pick<Company, "socialChargesRate"> | null | undefined,
  opts?: { tenure?: number; inPSE?: boolean; requiresRetraining?: boolean }
): { salaryImpact: number; savings: number; cost: number } {
  const chargesRate = getSocialChargesRate(company);
  const fin = computeMovementFinancials({
    type,
    grossSalary,
    chargesRate,
    tenure: opts?.tenure ?? 0,
    inPSE: opts?.inPSE ?? false,
    requiresRetraining: opts?.requiresRetraining ?? false,
  });
  return { salaryImpact: fin.salaryImpact, savings: fin.salarySavings, cost: fin.socialCost };
}
