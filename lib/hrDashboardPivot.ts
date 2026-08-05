/**
 * Moteur de pivot générique du Dashboard RH — équivalent de `lib/dashboardPivot.ts` (dashboard
 * exécutif) mais ancré sur `WorkforceMovement` plutôt que sur `Lever` : les entités sous-jacentes
 * diffèrent (mouvements RH vs leviers), d'où un registre métrique/dimension séparé plutôt qu'une
 * extension du fichier existant (voir la décision de scope dans `lib/hrDashboardWidgets.ts`).
 *
 * Contrairement au dashboard exécutif, aucun widget RH du builder générique n'a de forme
 * Marimekko (2 dimensions) — chaque breakdown RH (département, pays, type, région, FY) est une
 * ventilation simple à 1 dimension (barre/donut). `pivotWorkforceByDimension` ne prend donc
 * qu'UNE SEULE clé de dimension, contrairement à `pivotByDimensions` (1 ou 2).
 *
 * DIMENSIONS AVEC CONTEXTE (nouveauté Août 2026, alignement OD Monitoring) : le getter de
 * dimension prend désormais un second argument `ctx: HrDimensionContext` (employés, hiérarchie
 * géographique, config entreprise). Les dimensions statiques (`type`, `department`, `country`…)
 * ignorent `ctx` ; les dimensions dérivées (`region`, `fiscalYear`) l'utilisent pour résoudre
 * la valeur depuis la config multi-tenant. Un getter qui ignore `ctx` reste 100% compatible.
 *
 * Réutilise directement le type `PivotRow` de `lib/dashboardPivot.ts` (forme générique
 * `{ key, label, value, count }`, indépendante de Lever) plutôt que de le redéfinir à l'identique.
 */

import type {
  Company,
  Employee,
  HierarchyLevelDef,
  HierarchyNode,
  MovementType,
  WorkforceMovement,
} from "@/types";
import type { PivotRow } from "@/lib/dashboardPivot";
import { fteEffect, fiscalYearBucket, resolveMovementRegion } from "@/lib/hrEngine";

export type { PivotRow };

// ─── Métriques ──────────────────────────────────────────────────────────────────────────────────

export type HrMetricAggregation = "sum" | "count";

export interface HrMetricDef {
  key: string;
  label: string;
  aggregation: HrMetricAggregation;
  /** Ignoré pour l'agrégation "count" (chaque mouvement compte pour 1). */
  getValue: (m: WorkforceMovement) => number;
}

/** Indicateurs RH sélectionnables — ancrés sur les champs calculés de `lib/hrFinancials.ts`.
 *  Le libellé "ENR (coût social)" reprend le vocabulaire "OD Monitoring" (Gooduelle) pour
 *  désigner les Éléments Non Récurrents = coûts sociaux one-off ; le champ persisté sur le
 *  mouvement (`WorkforceMovement.cost`) est inchangé. `netEconomy` = savings récurrentes − ENR
 *  (miroir de `netEconomyTotal` de `lib/hrFinancials.ts`, appliqué au niveau du mouvement). */
export const HR_METRIC_REGISTRY: HrMetricDef[] = [
  {
    key: "fteImpact",
    label: "Impact ETP (signé)",
    aggregation: "sum",
    getValue: (m) => fteEffect(m),
  },
  {
    key: "salarySavings",
    label: "Économies salariales (salaire chargé)",
    aggregation: "sum",
    getValue: (m) => m.savings,
  },
  {
    key: "socialCost",
    label: "ENR (coût social one-off)",
    aggregation: "sum",
    getValue: (m) => m.cost,
  },
  {
    key: "netEconomy",
    label: "Économie nette (savings − ENR)",
    aggregation: "sum",
    getValue: (m) => m.savings - m.cost,
  },
  {
    key: "netFirstYearImpact",
    label: "Impact net 1ère année",
    aggregation: "sum",
    getValue: (m) => m.salaryImpact + m.cost,
  },
  {
    key: "movementCount",
    label: "Nombre de mouvements",
    aggregation: "count",
    getValue: () => 1,
  },
];

export function getHrMetricDef(key: string): HrMetricDef | undefined {
  return HR_METRIC_REGISTRY.find((m) => m.key === key);
}

// ─── Dimensions ─────────────────────────────────────────────────────────────────────────────────

/** Contexte transmis aux getters de dimension. Les dimensions statiques l'ignorent, les
 *  dimensions dérivées (région/cluster, exercice fiscal) l'utilisent pour résoudre la valeur
 *  depuis la configuration multi-tenant (hiérarchie géographique, `Company.fyStart`). */
export interface HrDimensionContext {
  employees: Employee[];
  geographyNodes: HierarchyNode[];
  geographyLevels: HierarchyLevelDef[];
  activeCompany: Company | null;
}

export const EMPTY_HR_DIMENSION_CONTEXT: HrDimensionContext = {
  employees: [],
  geographyNodes: [],
  geographyLevels: [],
  activeCompany: null,
};

export interface HrDimensionDef {
  key: string;
  label: string;
  getValue: (m: WorkforceMovement, ctx: HrDimensionContext) => string;
}

const FALLBACK_LABEL = "Non renseigné";
const NOT_APPLICABLE = "Non applicable";

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

/** Libellé "<mois> <année>" à partir d'une date ISO (YYYY-MM-DD) — retourne le libellé de repli si
 *  la date est absente ou mal formée. */
function monthLabel(date: string | null | undefined): string {
  if (!date) return FALLBACK_LABEL;
  const month = Number(date.slice(5, 7)) - 1;
  const year = date.slice(0, 4);
  if (Number.isNaN(month) || month < 0 || month > 11 || !year) return FALLBACK_LABEL;
  return `${MONTH_LABELS[month]} ${year}`;
}

function quarterLabel(date: string | null | undefined): string {
  if (!date) return FALLBACK_LABEL;
  const month = Number(date.slice(5, 7)) - 1;
  const year = date.slice(0, 4);
  if (Number.isNaN(month) || month < 0 || month > 11 || !year) return FALLBACK_LABEL;
  return `T${Math.floor(month / 3) + 1} ${year}`;
}

/** Dimensions RH sélectionnables. Nouveautés Août 2026 (alignement OD Monitoring) :
 *  - `region` : cluster géographique dérivé de `Company.geographyHierarchyLevels` — le libellé
 *    dépend de la config de l'entreprise, jamais d'une liste figée.
 *  - `fiscalYear` : exercice fiscal configurable — dépend de `Company.fyStart`. */
export const HR_DIMENSION_REGISTRY: HrDimensionDef[] = [
  { key: "type", label: "Type de mouvement (mécanisme)", getValue: (m) => m.type },
  { key: "department", label: "Département", getValue: (m) => m.department || FALLBACK_LABEL },
  {
    key: "toDepartment",
    label: "Département d'arrivée",
    getValue: (m) => m.toDepartment || NOT_APPLICABLE,
  },
  { key: "country", label: "Pays", getValue: (m) => m.country || FALLBACK_LABEL },
  {
    key: "region",
    label: "Région / Cluster",
    getValue: (m, ctx) =>
      resolveMovementRegion(m, {
        employees: ctx.employees,
        geographyNodes: ctx.geographyNodes,
        geographyLevels: ctx.geographyLevels,
      }) || FALLBACK_LABEL,
  },
  { key: "hrOwner", label: "Owner RH", getValue: (m) => m.hrOwner || FALLBACK_LABEL },
  { key: "status", label: "Statut", getValue: (m) => m.status },
  { key: "pse", label: "PSE", getValue: (m) => (m.inPSE ? "Oui" : "Non") },
  { key: "plannedMonth", label: "Mois (date prévue)", getValue: (m) => monthLabel(m.plannedDate) },
  {
    key: "plannedQuarter",
    label: "Trimestre (date prévue)",
    getValue: (m) => quarterLabel(m.plannedDate),
  },
  {
    key: "fiscalYear",
    label: "Exercice fiscal (date prévue)",
    getValue: (m, ctx) =>
      fiscalYearBucket(m.plannedDate, ctx.activeCompany?.fyStart) ?? FALLBACK_LABEL,
  },
];

export function getHrDimensionDef(key: string): HrDimensionDef | undefined {
  return HR_DIMENSION_REGISTRY.find((d) => d.key === key);
}

// ─── Pivot générique (1 dimension) ─────────────────────────────────────────────────────────────

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function aggregate(movements: WorkforceMovement[], metric: HrMetricDef): number {
  if (movements.length === 0) return 0;
  if (metric.aggregation === "count") return movements.length;
  return round2(movements.reduce((s, m) => s + metric.getValue(m), 0));
}

/**
 * Point d'entrée unique du pivot générique RH. Regroupe les mouvements par valeur de dimension
 * et retourne une ligne par valeur rencontrée, triée par valeur décroissante. Métrique/
 * dimension inconnue ou tableau vide → tableau vide (jamais d'exception).
 *
 * `ctx` fournit le contexte multi-tenant (employés, hiérarchie géographique, entreprise
 * active) — obligatoire pour les dimensions dérivées `region`/`fiscalYear`. Les dimensions
 * statiques ignorent `ctx` ; les appelants qui ne se soucient pas des dimensions dérivées
 * peuvent passer `EMPTY_HR_DIMENSION_CONTEXT`.
 */
export function pivotWorkforceByDimension(
  movements: WorkforceMovement[],
  metricKey: string,
  dimensionKey: string,
  ctx: HrDimensionContext = EMPTY_HR_DIMENSION_CONTEXT
): PivotRow[] {
  const metric = getHrMetricDef(metricKey);
  const dim = getHrDimensionDef(dimensionKey);
  if (!metric || !dim) return [];

  const groups = new Map<string, WorkforceMovement[]>();
  for (const m of movements) {
    const raw = dim.getValue(m, ctx);
    const key = raw && raw.trim() !== "" ? raw : FALLBACK_LABEL;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => ({
      key,
      label: key,
      value: aggregate(group, metric),
      count: group.length,
    }))
    .sort((a, b) => b.value - a.value);
}

/** Utilitaire d'affichage : liste des 5 types Gooduelle en tant que clés typées. */
export const MOVEMENT_TYPES: MovementType[] = [
  "Recrutement",
  "Attrition",
  "Départ forcé",
  "Transfert entrant",
  "Transfert sortant",
];
