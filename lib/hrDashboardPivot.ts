/**
 * Moteur de pivot générique du Dashboard RH — équivalent de `lib/dashboardPivot.ts` (dashboard
 * exécutif) mais ancré sur `WorkforceMovement` plutôt que sur `Lever` : les entités sous-jacentes
 * diffèrent (mouvements RH vs leviers), d'où un registre métrique/dimension séparé plutôt qu'une
 * extension du fichier existant (voir la décision de scope dans `lib/hrDashboardWidgets.ts`).
 *
 * Contrairement au dashboard exécutif, aucun widget RH du builder générique n'a de forme
 * Marimekko (2 dimensions) — chaque breakdown RH (département, pays, type de mouvement) est une
 * ventilation simple à 1 dimension (barre/donut). `pivotWorkforceByDimension` ne prend donc
 * qu'UNE SEULE clé de dimension, contrairement à `pivotByDimensions` (1 ou 2). Si un futur widget
 * RH a besoin d'une forme à 2 dimensions, généraliser alors cette fonction plutôt que d'anticiper
 * un besoin qui n'existe pas encore.
 *
 * Réutilise directement le type `PivotRow` de `lib/dashboardPivot.ts` (forme générique
 * `{ key, label, value, count }`, indépendante de Lever) plutôt que de le redéfinir à l'identique.
 */

import type { MovementType, WorkforceMovement } from "@/types";
import type { PivotRow } from "@/lib/dashboardPivot";
import { fteEffect } from "@/lib/hrEngine";

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

/** Indicateurs RH sélectionnables — ancrés sur les champs calculés de `lib/hrFinancials.ts`
 *  (persistés sur `WorkforceMovement` au moment de la saisie via `computeMovementEuros`, voir
 *  `app/(app)/hr/etp/page.tsx`) : `fteImpact` (signé par mécanisme — reprend exactement
 *  `hrEngine.fteEffect`), `salarySavings`/`socialCost` (champs `savings`/`cost` du mouvement, déjà
 *  la sortie de `computeMovementFinancials`), et `netFirstYearImpact` = `salaryImpact + socialCost`
 *  (même formule que `MovementFinancials.netFirstYearImpact`, dérivée des champs persistés plutôt
 *  que recalculée — un Recrutement n'a pas forcément d'`Employee` lié pour retrouver
 *  ancienneté/salaire brut d'origine). `movementCount` est un pur comptage. */
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
    label: "Coût social one-off",
    aggregation: "sum",
    getValue: (m) => m.cost,
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

export interface HrDimensionDef {
  key: string;
  label: string;
  getValue: (m: WorkforceMovement) => string;
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
 *  la date est absente ou mal formée, plutôt que d'afficher "undefined". */
function monthLabel(date: string | null | undefined): string {
  if (!date) return FALLBACK_LABEL;
  const month = Number(date.slice(5, 7)) - 1;
  const year = date.slice(0, 4);
  if (Number.isNaN(month) || month < 0 || month > 11 || !year) return FALLBACK_LABEL;
  return `${MONTH_LABELS[month]} ${year}`;
}

/** Libellé "T<n> <année>" à partir d'une date ISO — même repli que `monthLabel`. */
function quarterLabel(date: string | null | undefined): string {
  if (!date) return FALLBACK_LABEL;
  const month = Number(date.slice(5, 7)) - 1;
  const year = date.slice(0, 4);
  if (Number.isNaN(month) || month < 0 || month > 11 || !year) return FALLBACK_LABEL;
  return `T${Math.floor(month / 3) + 1} ${year}`;
}

/** Dimensions RH sélectionnables — mécanisme (type de mouvement), département source/destination,
 *  pays, owner RH, statut opérationnel, drapeau PSE, et mois/trimestre de la date planifiée (le
 *  seul axe temporel qui a du sens ici : `actualDate` est `null` tant que le mouvement n'est pas
 *  réalisé, ce qui viderait la dimension pour la majorité du plan). */
export const HR_DIMENSION_REGISTRY: HrDimensionDef[] = [
  { key: "type", label: "Type de mouvement (mécanisme)", getValue: (m) => m.type },
  { key: "department", label: "Département", getValue: (m) => m.department || FALLBACK_LABEL },
  {
    key: "toDepartment",
    label: "Département d'arrivée",
    getValue: (m) => m.toDepartment || NOT_APPLICABLE,
  },
  { key: "country", label: "Pays", getValue: (m) => m.country || FALLBACK_LABEL },
  { key: "hrOwner", label: "Owner RH", getValue: (m) => m.hrOwner || FALLBACK_LABEL },
  { key: "status", label: "Statut", getValue: (m) => m.status },
  { key: "pse", label: "PSE", getValue: (m) => (m.inPSE ? "Oui" : "Non") },
  { key: "plannedMonth", label: "Mois (date prévue)", getValue: (m) => monthLabel(m.plannedDate) },
  {
    key: "plannedQuarter",
    label: "Trimestre (date prévue)",
    getValue: (m) => quarterLabel(m.plannedDate),
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
 * Point d'entrée unique du pivot générique RH : étant donné une métrique et une clé de dimension,
 * regroupe les mouvements fournis et retourne une ligne par valeur de dimension rencontrée, triée
 * par valeur décroissante. Métrique/dimension inconnue ou tableau vide → tableau vide (jamais
 * d'exception), pour rester directement utilisable dans le rendu sans garde supplémentaire côté
 * appelant — même contrat que `pivotByDimensions` du dashboard exécutif.
 */
export function pivotWorkforceByDimension(
  movements: WorkforceMovement[],
  metricKey: string,
  dimensionKey: string
): PivotRow[] {
  const metric = getHrMetricDef(metricKey);
  const dim = getHrDimensionDef(dimensionKey);
  if (!metric || !dim) return [];

  const groups = new Map<string, WorkforceMovement[]>();
  for (const m of movements) {
    const raw = dim.getValue(m);
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

/** Utilitaire d'affichage : le type de mouvement en tant que clé de dimension typée, pour les
 *  appelants qui veulent restreindre `MovementType` explicitement plutôt que `string` générique
 *  (ex. filtrage). Non utilisé par le moteur de pivot lui-même (qui reste générique sur `string`). */
export const MOVEMENT_TYPES: MovementType[] = [
  "Suppression",
  "Recrutement",
  "Redéploiement",
  "Reconversion",
];
