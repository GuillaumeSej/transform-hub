import type { Company, MovementType } from "@/types";
import { daysBetween } from "@/lib/dateUtils";

/**
 * Calcul EUR mécanisme-dépendant des mouvements RH (Vision mouvement / Base ETP).
 *
 * Avant ce module, `WorkforceMovement.salaryImpact` / `savings` / `cost` étaient de purs champs
 * de saisie libre : le formulaire (`MovementForm`) ne préremplissait `salaryImpact`/`savings` que
 * pour une "Suppression" liée à un employé (= -salaire brut / +salaire brut, sans charges
 * sociales), et `cost` n'était JAMAIS calculé — un utilisateur pouvait laisser 0€ de coût social
 * pour un licenciement ou saisir n'importe quoi. Ce module remplace ce vide par une formule
 * dépendante du `MovementType`, appliquée au SALAIRE CHARGÉ (brut + charges patronales) plutôt
 * qu'au seul brut.
 *
 * ASSUMPTIONS BUSINESS À VALIDER AVEC LE CLIENT (documentées ici faute de politique RH réelle
 * fournie) :
 * - Le taux de charges patronales par défaut (`DEFAULT_SOCIAL_CHARGES_RATE`) est un ordre de
 *   grandeur France (statut cadre, hors spécificités sectorielles) — configurable par entreprise
 *   via `Company.socialChargesRate`. Ne pas le traiter comme universel (le taux réel varie selon
 *   pays, statut, convention collective — souvent 1.4x à 1.8x le brut).
 * - Les formules de coûts sociaux (indemnité de licenciement, préavis, PSE, frais de recrutement,
 *   onboarding, formation/transition) sont des ESTIMATIONS simplifiées inspirées d'ordres de
 *   grandeur usuels (ex. barème légal français d'indemnité de licenciement), PAS des règles
 *   légales exactes ni une convention collective précise. Elles servent de valeur par défaut
 *   éditable, pas de calcul définitif.
 *
 * Toutes les fonctions sont pures (aucune I/O, aucun couplage React) pour rester unitairement
 * testables — voir lib/__tests__/hrFinancials.test.ts.
 */

/** Taux de charges sociales patronales par défaut si l'entreprise n'a rien configuré. */
export const DEFAULT_SOCIAL_CHARGES_RATE = 0.45;

/** Préavis moyen estimé (mois de salaire chargé) pour une Suppression. */
export const NOTICE_PERIOD_MONTHS = 2;

/** Surcoût d'accompagnement (outplacement, cellule de reclassement...) si le mouvement est
 *  inclus dans un PSE, en % de l'indemnité de licenciement estimée. */
export const PSE_OVERHEAD_RATE = 0.2;

/** Frais de recrutement (cabinet, sourcing, jobboards...) en % du salaire chargé annuel. */
export const RECRUITMENT_FEE_RATE = 0.15;

/** Coût d'intégration/onboarding estimé (mois de salaire chargé). */
export const ONBOARDING_COST_MONTHS = 0.5;

/** Coût de transition interne (formation courte, changement d'équipe) pour un Redéploiement. */
export const REDEPLOIEMENT_TRANSITION_RATE = 0.05;

/** Coût de reconversion (formation lourde, requalification) — plus élevé qu'un simple
 *  redéploiement. */
export const RECONVERSION_TRANSITION_RATE = 0.15;

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

/** Ancienneté en années pleines (décimales) entre la date d'embauche et une date de référence
 *  (typiquement la date planifiée du mouvement). Retourne 0 si non calculable. */
export function tenureYears(hireDate: string | undefined | null, refDate: string): number {
  if (!hireDate) return 0;
  const days = daysBetween(hireDate, refDate);
  return days > 0 ? days / 365.25 : 0;
}

/** Indemnité de licenciement estimée, barème légal français simplifié (ordre de grandeur) :
 *  1/4 de mois de salaire chargé par année d'ancienneté jusqu'à 10 ans, puis 1/3 de mois
 *  au-delà. Appliqué au salaire CHARGÉ (et non au seul brut, base légale réelle) pour rester
 *  cohérent avec le reste du calcul — majore donc légèrement l'estimation réelle. */
export function severanceEstimate(loadedSalary: number, tenure: number): number {
  const monthly = loadedSalary / 12;
  const first10 = Math.min(tenure, 10) * 0.25 * monthly;
  const beyond10 = Math.max(tenure - 10, 0) * (1 / 3) * monthly;
  return Math.round(first10 + beyond10);
}

export type MovementFinancialsInput = {
  type: MovementType;
  /** Salaire brut annuel de référence : celui de l'employé lié, ou une valeur saisie
   *  manuellement pour un Recrutement (poste pas encore pourvu, pas d'Employee). */
  grossSalary: number;
  /** Taux de charges patronales (voir getSocialChargesRate). */
  chargesRate: number;
  /** Ancienneté en années — utilisée uniquement pour une Suppression. */
  tenure?: number;
  /** Mouvement inclus dans un PSE — majore le coût social d'une Suppression. */
  inPSE?: boolean;
};

export type MovementFinancials = {
  /** € salaire chargé annuel — base du calcul. */
  loadedSalary: number;
  /** € économie de masse salariale chargée en régime annuel (>= 0). 0 pour Recrutement et pour
   *  Redéploiement/Reconversion (aucune réduction nette d'ETP — voir MovementType, transfert
   *  interne uniquement, pas d'économie). */
  salarySavings: number;
  /** € coût social one-off associé au mécanisme (indemnités + préavis + PSE, ou frais de
   *  recrutement + onboarding, ou formation/transition selon le type). */
  socialCost: number;
  /** € impact masse salariale ANNUEL signé (négatif = économie), destiné à
   *  WorkforceMovement.salaryImpact : -salarySavings pour une Suppression, +loadedSalary pour un
   *  Recrutement, 0 pour un transfert interne (Redéploiement/Reconversion). */
  salaryImpact: number;
  /** € impact net la première année (salaryImpact + socialCost) — vision cash court terme,
   *  utile pour situer l'effort de trésorerie au-delà du seul run-rate annualisé. */
  netFirstYearImpact: number;
};

/**
 * Calcule les composantes EUR d'un mouvement RH selon son mécanisme (`MovementType`). Fonction
 * pure — ne lit ni n'écrit rien, à appeler depuis le formulaire (préremplissage éditable) ou
 * l'affichage (recalcul de contrôle).
 */
export function computeMovementFinancials(input: MovementFinancialsInput): MovementFinancials {
  const { type, grossSalary, chargesRate, tenure = 0, inPSE = false } = input;
  const loadedSalary = Math.round(loadedAnnualSalary(grossSalary, chargesRate));

  switch (type) {
    case "Suppression": {
      const severance = severanceEstimate(loadedSalary, tenure);
      const notice = Math.round((NOTICE_PERIOD_MONTHS / 12) * loadedSalary);
      const pseOverhead = inPSE ? Math.round(PSE_OVERHEAD_RATE * severance) : 0;
      const socialCost = severance + notice + pseOverhead;
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
    case "Redéploiement":
    case "Reconversion": {
      const rate =
        type === "Reconversion" ? RECONVERSION_TRANSITION_RATE : REDEPLOIEMENT_TRANSITION_RATE;
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
 *  (salaryImpact/savings/cost) à partir d'un salaire brut, d'une entreprise (pour le taux de
 *  charges) et d'options mécanisme-dépendantes. */
export function computeMovementEuros(
  type: MovementType,
  grossSalary: number,
  company: Pick<Company, "socialChargesRate"> | null | undefined,
  opts?: { tenure?: number; inPSE?: boolean }
): { salaryImpact: number; savings: number; cost: number } {
  const chargesRate = getSocialChargesRate(company);
  const fin = computeMovementFinancials({
    type,
    grossSalary,
    chargesRate,
    tenure: opts?.tenure ?? 0,
    inPSE: opts?.inPSE ?? false,
  });
  return { salaryImpact: fin.salaryImpact, savings: fin.salarySavings, cost: fin.socialCost };
}
