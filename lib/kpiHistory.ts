import { canFillIndicator } from "@/lib/axisLogic";
import type { AuthUser, Indicator, IndicatorFrequency, IndicatorMeasurement, Role } from "@/types";

/**
 * Logique pure de la page KPI : historique chronologique, filtre par année, KPI marché (CTO) et
 * point d'enregistrement unique d'une valeur (`submitIndicatorValue`).
 */

/** Un KPI « marché » = indicateur macro (rattaché directement à un axe, sans chantier). */
export function isMarketKpi(indicator: Pick<Indicator, "axisId" | "chantierId">): boolean {
  return !!indicator.axisId && !indicator.chantierId;
}

/** Rôle responsable de la saisie des KPI marché. */
export const MARKET_KPI_OWNER_ROLE: Role = "cto";

/** Rôles de saisie effectifs : ceux de l'indicateur, + le CTO pour un KPI marché. */
export function effectiveResponsibleRoles(
  indicator: Pick<Indicator, "axisId" | "chantierId" | "responsibleRoles">
): Role[] {
  if (!isMarketKpi(indicator) || indicator.responsibleRoles.includes(MARKET_KPI_OWNER_ROLE)) {
    return indicator.responsibleRoles;
  }
  return [...indicator.responsibleRoles, MARKET_KPI_OWNER_ROLE];
}

/** Droit de saisie : `canFillIndicator` évalué avec le CTO ajouté aux rôles d'un KPI marché. */
export function canFillIndicatorValue(
  indicator: Pick<
    Indicator,
    "axisId" | "chantierId" | "responsibleRoles" | "additionalAuthorizedUserIds" | "programId"
  >,
  user: Parameters<typeof canFillIndicator>[1]
): boolean {
  return canFillIndicator(
    { ...indicator, responsibleRoles: effectiveResponsibleRoles(indicator) },
    user
  );
}

/** Année d'une période ("2026-03", "2026-Q1", "2026") ; `undefined` si non reconnue. */
export function periodYear(period: string): number | undefined {
  const match = /^(\d{4})/.exec(period.trim());
  return match ? Number(match[1]) : undefined;
}

/** Années présentes dans les mesures + année courante, de la plus récente à la plus ancienne. */
export function availableYears(
  measurements: Pick<IndicatorMeasurement, "period">[],
  now: Date = new Date()
): number[] {
  const years = new Set<number>([now.getFullYear()]);
  for (const m of measurements) {
    const y = periodYear(m.period);
    if (y !== undefined) years.add(y);
  }
  return Array.from(years).sort((a, b) => b - a);
}

export type YearSelection = number | "all";

export function filterByYear<T extends Pick<IndicatorMeasurement, "period">>(
  measurements: T[],
  year: YearSelection
): T[] {
  if (year === "all") return measurements;
  return measurements.filter((m) => periodYear(m.period) === year);
}

export type HistoryRow = {
  measurement: IndicatorMeasurement;
  /** Écart signé valeur - cible ; `undefined` sans cible ou sans valeur. */
  gap?: number;
  /** true = écart dans le bon sens (selon `direction`). */
  favorable?: boolean;
};

/** Écart à la cible d'une valeur. */
export function measurementGap(
  value: number | undefined,
  objectiveValue: number | undefined
): number | undefined {
  if (value === undefined || objectiveValue === undefined) return undefined;
  return Math.round((value - objectiveValue) * 1e6) / 1e6;
}

/** Lignes d'historique, plus récente d'abord (période, puis horodatage de saisie). */
export function buildHistoryRows(
  measurements: IndicatorMeasurement[],
  objectiveValue?: number,
  direction: Indicator["direction"] = "up"
): HistoryRow[] {
  return [...measurements]
    .sort((a, b) =>
      a.period === b.period
        ? b.reportedAt.localeCompare(a.reportedAt)
        : b.period.localeCompare(a.period)
    )
    .map((measurement) => {
      const gap = measurementGap(measurement.value, objectiveValue);
      return {
        measurement,
        gap,
        favorable: gap === undefined ? undefined : direction === "down" ? gap <= 0 : gap >= 0,
      };
    });
}

export type IndicatorValueInput = {
  indicatorId: string;
  period: string;
  reportedBy: string;
  value?: number;
  note?: string;
};

/**
 * POINT D'ENREGISTREMENT UNIQUE d'une valeur de KPI (page KPI + KPI marché). Aujourd'hui : écriture
 * directe de la mesure. L'agent d'intégration branchera ici la demande de validation
 * (`lib/strategicApprovals.ts`, kind "kpi_value"). Champs optionnels omis (Firestore rejette
 * `undefined`), commentaire vide = absent.
 */
export async function submitIndicatorValue<M>(
  addMeasurement: (input: IndicatorValueInput) => Promise<M>,
  input: IndicatorValueInput
): Promise<M> {
  const note = input.note?.trim();
  return addMeasurement({
    indicatorId: input.indicatorId,
    period: input.period,
    reportedBy: input.reportedBy,
    ...(input.value !== undefined ? { value: input.value } : {}),
    ...(note ? { note } : {}),
  });
}

export type UserForFill = Pick<
  AuthUser,
  "profiles" | "isGlobalAdmin" | "isCompanyAdmin" | "username"
>;

/** Période de reporting courante selon la fréquence (format ordonnable lexicographiquement). */
export function currentPeriod(frequency: IndicatorFrequency, now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  switch (frequency) {
    case "monthly":
      return `${year}-${String(month).padStart(2, "0")}`;
    case "quarterly":
      return `${year}-Q${Math.ceil(month / 3)}`;
    case "semiannual":
      return `${year}-S${month <= 6 ? 1 : 2}`;
    case "annual":
      return String(year);
  }
}

/** Saisie numérique tolérante à la virgule. `null` = invalide, `undefined` = vide. */
export function parseNumber(raw: string): number | undefined | null {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}
