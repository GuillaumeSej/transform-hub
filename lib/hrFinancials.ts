import type { Company, MovementType, WorkforceMovement } from "@/types";
import { daysBetween } from "@/lib/dateUtils";
import { fiscalYearBucket } from "@/lib/hrEngine";

/**
 * Calcul EUR mécanisme-dépendant des mouvements RH (Vision mouvement / Base ETP).
 *
 * Aligné sur la typologie 5-types de "OD Monitoring" (Gooduelle) :
 *  - `Recrutement` : payroll ajouté, coût d'onboarding + frais de recrutement.
 *  - `Attrition` : départ volontaire → savings récurrentes = loadedSalary, coût social minime
 *    (préavis court, PAS d'indemnité de rupture — c'est la différence clé avec `Départ forcé`).
 *  - `Départ forcé` : miroir de l'ancienne `Suppression` avec un multiplicateur
 *    `FORCED_DEPARTURE_MULTIPLIER` sur l'indemnité pour refléter la contrainte (transaction).
 *  - `Transfert entrant` / `Transfert sortant` : mobilité interne, savings 0, coût de transition
 *    léger (5% par défaut) sauf si `requiresRetraining=true` (reconversion — 15%).
 *
 * ASSUMPTIONS BUSINESS À VALIDER AVEC LE CLIENT (documentées ici faute de politique RH réelle
 * fournie) :
 * - Le taux de charges patronales par défaut (`DEFAULT_SOCIAL_CHARGES_RATE`) est un ordre de
 *   grandeur France (statut cadre) — configurable via `Company.socialChargesRate`.
 * - Les formules de coûts sociaux sont des ESTIMATIONS simplifiées inspirées d'ordres de
 *   grandeur usuels, PAS des règles légales exactes.
 * - `FORCED_DEPARTURE_MULTIPLIER = 1.2` (rupture négociée en contexte contraint) — à ajuster.
 * - `ATTRITION_NOTICE_MONTHS = 0.5` (départ volontaire, préavis souvent réduit) — à ajuster.
 *
 * Toutes les fonctions sont pures (aucune I/O, aucun couplage React).
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
 *  contrainte (rupture conventionnelle négociée en contexte défavorable, ordre de grandeur
 *  généralement observé au-delà du barème strict). */
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
 *  au-delà. Appliqué au salaire CHARGÉ (et non au seul brut, base légale réelle). */
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
  /** Ancienneté en années — utilisée pour les Départs forcés / Attrition. */
  tenure?: number;
  /** Mouvement inclus dans un PSE — majore le coût social d'un Départ forcé. */
  inPSE?: boolean;
  /** Uniquement `Transfert entrant`/`Transfert sortant` : `true` = reconversion (taux majoré). */
  requiresRetraining?: boolean;
};

export type MovementFinancials = {
  /** € salaire chargé annuel — base du calcul. */
  loadedSalary: number;
  /** € économie de masse salariale chargée en régime annuel (>= 0). 0 pour Recrutement et pour
   *  Transfert entrant/Transfert sortant (aucune réduction nette d'ETP). */
  salarySavings: number;
  /** € coût social one-off = ENR (Éléments Non Récurrents) associé au mécanisme. */
  socialCost: number;
  /** € impact masse salariale ANNUEL signé (négatif = économie), destiné à
   *  WorkforceMovement.salaryImpact. */
  salaryImpact: number;
  /** € impact net la première année (salaryImpact + socialCost). */
  netFirstYearImpact: number;
};

/**
 * Calcule les composantes EUR d'un mouvement RH selon son mécanisme (`MovementType`). Fonction
 * pure — ne lit ni n'écrit rien, à appeler depuis le formulaire (préremplissage éditable) ou
 * l'affichage (recalcul de contrôle).
 */
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
      // Départ volontaire : savings intégrales, coût social limité au préavis (pas d'indemnité
      // de rupture, pas de PSE).
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
 *  (salaryImpact/savings/cost) à partir d'un salaire brut, d'une entreprise et d'options
 *  mécanisme-dépendantes. */
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

// ---------- Économie nette (Gooduelle-style) ----------

export type NetEconomyBucket = {
  label: string;
  /** € savings salariales récurrentes annualisées portées par ce bucket (Σ savings). */
  grossSavings: number;
  /** € ENR (Éléments Non Récurrents) = coût social one-off (Σ cost). */
  enr: number;
  /** € économie nette = grossSavings − enr — vue "Économie nette" du Gooduelle. */
  net: number;
};

export type NetEconomyGranularity = "month" | "quarter" | "year";

const MONTH_LABELS = [
  "Jan",
  "Fév",
  "Mar",
  "Avr",
  "Mai",
  "Juin",
  "Juil",
  "Août",
  "Sep",
  "Oct",
  "Nov",
  "Déc",
];

function granularityLabel(
  dateISO: string,
  granularity: NetEconomyGranularity,
  fyStart: string | null | undefined
): string {
  if (granularity === "year")
    return fiscalYearBucket(dateISO, fyStart ?? null) ?? dateISO.slice(0, 4);
  const month = Number(dateISO.slice(5, 7)) - 1;
  const year = dateISO.slice(0, 4);
  if (Number.isNaN(month) || month < 0 || month > 11) return dateISO;
  if (granularity === "month") return `${MONTH_LABELS[month]} ${year}`;
  return `T${Math.floor(month / 3) + 1} ${year}`;
}

/**
 * Économie nette = savings récurrentes annualisées − ENR (coûts sociaux one-off), ventilée par
 * granularité temporelle. Reprend exactement les deux lignes de synthèse "Économie nette" de
 * "OD Monitoring" (Gooduelle) : la barre verte (savings) diminuée de la barre rouge (ENR).
 *
 * Prend les `WorkforceMovement` déjà filtrés (par la barre de filtres, la sélection de FY,
 * etc.) — la responsabilité du filtrage vit dans l'appelant, cette fonction ne fait qu'agréger.
 */
export function netEconomy(
  movements: WorkforceMovement[],
  granularity: NetEconomyGranularity,
  fyStart?: string | null
): NetEconomyBucket[] {
  const groups = new Map<string, { grossSavings: number; enr: number }>();
  for (const m of movements) {
    if (!m.plannedDate) continue;
    const label = granularityLabel(m.plannedDate, granularity, fyStart);
    const cur = groups.get(label) ?? { grossSavings: 0, enr: 0 };
    // savings = économies annualisées récurrentes attendues (déjà signées >= 0 par
    // computeMovementFinancials).
    cur.grossSavings += m.savings;
    cur.enr += m.cost;
    groups.set(label, cur);
  }
  return Array.from(groups.entries()).map(([label, v]) => ({
    label,
    grossSavings: Math.round(v.grossSavings),
    enr: Math.round(v.enr),
    net: Math.round(v.grossSavings - v.enr),
  }));
}

/** Résumé mono-ligne (pour KPI Card) — totaux tous mouvements confondus. */
export function netEconomyTotal(movements: WorkforceMovement[]): {
  grossSavings: number;
  enr: number;
  net: number;
} {
  const grossSavings = movements.reduce((s, m) => s + m.savings, 0);
  const enr = movements.reduce((s, m) => s + m.cost, 0);
  return {
    grossSavings: Math.round(grossSavings),
    enr: Math.round(enr),
    net: Math.round(grossSavings - enr),
  };
}
