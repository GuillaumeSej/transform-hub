import {
  baselineMeasurement,
  canFillIndicator,
  compareMeasurements,
  resolveIndicatorTargetForPeriod,
} from "@/lib/axisLogic";
import { samePeriod } from "@/lib/indicatorPeriod";
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

/** Année par défaut d'un sélecteur d'année : la DERNIÈRE année ayant des données (et non l'année
 *  courante, qui afficherait un indicateur vide en début d'année) — à défaut, l'année courante. */
export function defaultYearForMeasurements(
  measurements: Pick<IndicatorMeasurement, "period">[],
  now: Date = new Date()
): number {
  let latest: number | undefined;
  for (const m of measurements) {
    const y = periodYear(m.period);
    if (y !== undefined && (latest === undefined || y > latest)) latest = y;
  }
  return latest ?? now.getFullYear();
}

export function filterByYear<T extends Pick<IndicatorMeasurement, "period">>(
  measurements: T[],
  year: YearSelection
): T[] {
  if (year === "all") return measurements;
  return measurements.filter((m) => periodYear(m.period) === year);
}

export type HistoryRow = {
  measurement: IndicatorMeasurement;
  /** Cible applicable à la période de CETTE ligne (palier de trajectoire, ou cible finale). */
  target?: number;
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

/** Lignes d'historique, plus récente d'abord (`compareMeasurements` : période, puis horodatage de
 *  saisie). `target` : cible FIXE (nombre), ou l'indicateur lui-même — chaque ligne est alors
 *  comparée à la cible APPLICABLE à SA période (`resolveIndicatorTargetForPeriod`, palier de
 *  trajectoire), jamais toujours à la cible finale. */
export function buildHistoryRows(
  measurements: IndicatorMeasurement[],
  target?: number | Pick<Indicator, "objectiveValue" | "targetSchedule">,
  direction: Indicator["direction"] = "up"
): HistoryRow[] {
  const targetFor = (period: string): number | undefined =>
    typeof target === "object" && target !== null
      ? resolveIndicatorTargetForPeriod(target, period)
      : target;
  return [...measurements]
    .sort((a, b) => compareMeasurements(b, a))
    .map((measurement) => {
      const rowTarget = targetFor(measurement.period);
      const gap = measurementGap(measurement.value, rowTarget);
      return {
        measurement,
        target: rowTarget,
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

// ─── Correction d'une mesure déjà publiée ────────────────────────────────────────────────────

/** Correction d'une mesure. `null` (ou commentaire vide) = effacer le champ ; clé absente = inchangé. */
export type MeasurementEditPatch = {
  period?: string;
  value?: number | null;
  note?: string | null;
};

/** Autre mesure DU MÊME indicateur déjà enregistrée sur `period` (hors `excludeId`, la mesure en
 *  cours de correction) — une correction ne doit pas créer de doublon de période. */
export function findPeriodCollision(
  measurements: Pick<IndicatorMeasurement, "id" | "indicatorId" | "period">[],
  indicatorId: string,
  period: string,
  excludeId?: string
): Pick<IndicatorMeasurement, "id" | "indicatorId" | "period"> | undefined {
  // `samePeriod` : "2026-3" et "2026-03" (ou "T1 2026" et "2026-Q1") désignent la même période.
  return measurements.find(
    (m) => m.indicatorId === indicatorId && m.id !== excludeId && samePeriod(m.period, period)
  );
}

/** Erreur levée par `useStrategicData.updateMeasurement` quand la nouvelle période est déjà prise. */
export class MeasurementPeriodCollisionError extends Error {
  constructor(
    public readonly period: string,
    /** Id de la mesure qui occupe déjà la période (si connu) — cible d'un remplacement. */
    public readonly existingId?: string
  ) {
    super(`Une mesure existe déjà pour la période ${period}`);
    this.name = "MeasurementPeriodCollisionError";
  }
}

/**
 * Mesure corrigée : `reportedBy`/`reportedAt` d'origine conservés, `updatedBy`/`updatedAt` posés.
 * Champs vidés OMIS (Firestore rejette `undefined`). `null` si le résultat n'a plus ni valeur ni
 * commentaire (même règle que la saisie).
 */
export function applyMeasurementEdit(
  existing: IndicatorMeasurement,
  patch: MeasurementEditPatch,
  updatedBy: string,
  updatedAt: string
): IndicatorMeasurement | null {
  const period = patch.period !== undefined ? patch.period.trim() : existing.period;
  const value = patch.value === undefined ? existing.value : (patch.value ?? undefined);
  const rawNote = patch.note === undefined ? existing.note : (patch.note ?? undefined);
  const note = rawNote?.trim() ? rawNote.trim() : undefined;
  if (!period || (value === undefined && note === undefined)) return null;
  const { value: _v, note: _n, ...rest } = existing;
  void _v;
  void _n;
  return {
    ...rest,
    period,
    ...(value !== undefined ? { value } : {}),
    ...(note !== undefined ? { note } : {}),
    updatedBy,
    updatedAt,
  };
}

/** `true` si `measurement` est la baseline (1re mesure numérique) de son indicateur — sa
 *  suppression/correction change la valeur de référence de l'avancement. */
export function isBaseline(
  measurement: Pick<IndicatorMeasurement, "id" | "indicatorId">,
  measurements: IndicatorMeasurement[]
): boolean {
  return baselineMeasurement(measurement.indicatorId, measurements)?.id === measurement.id;
}

/** Libellé court d'une mesure pour une confirmation (« 42 % », ou le commentaire). */
export function measurementLabel(
  measurement: Pick<IndicatorMeasurement, "value" | "note">,
  unit?: string
): string {
  if (measurement.value !== undefined) return `${measurement.value}${unit ? ` ${unit}` : ""}`;
  return measurement.note ?? "—";
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
