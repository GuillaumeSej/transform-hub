/**
 * Moteur de pivot générique du dashboard exécutif : remplace les fonctions d'agrégation
 * mono-usage de `lib/engine.ts` (`byGeo`, `byFunction`, `byCountry`, `byProject`,
 * `marimekko2D`) par un couple registre + fonction, pour que l'utilisateur puisse choisir
 * LUI-MÊME n'importe quelle métrique croisée avec 1 ou 2 dimensions plutôt que de piocher
 * dans une liste figée de vues pré-cablées par type de widget (voir `lib/dashboardWidgets.ts`,
 * qui consomme ce fichier pour les widgets "configurables").
 *
 * - `METRIC_REGISTRY` : les indicateurs numériques sélectionnables, ancrés sur les champs réels
 *   de `Lever` (voir `types/index.ts`).
 * - `DIMENSION_REGISTRY` (+ dimensions de hiérarchie dynamiques, propres à chaque entreprise) :
 *   les axes de ventilation catégoriels sélectionnables.
 * - `pivotByDimensions` : étant donné une métrique + 1 ou 2 clés de dimension, regroupe les
 *   leviers actifs (non annulés, même filtre que l'ancien moteur) et retourne soit une liste
 *   plate (1 dimension — forme barre/donut), soit une répartition à deux niveaux façon
 *   Marimekko (2 dimensions — réutilise directement la forme `Marimekko2DColumn` de
 *   `lib/engine.ts` pour rester compatible avec `MarimekkoChart` sans le modifier).
 */

import type {
  BeTrackData,
  HierarchyLevelDef,
  HierarchyNode,
  Lever,
  LeverStatus,
  PnlAccount,
  Project,
  Workstream,
} from "@/types";
import { realizedSavings, type Marimekko2DColumn, type Marimekko2DSegment } from "@/lib/engine";
import { resolveHierarchyPath } from "@/lib/hierarchyLogic";
import { STATUS_SHORT_LABEL } from "@/lib/status-config";

// ─── Métriques ──────────────────────────────────────────────────────────────────────────────────

export type MetricAggregation = "sum" | "avg" | "count";

export interface MetricDef {
  key: string;
  label: string;
  aggregation: MetricAggregation;
  /** Ignoré pour l'agrégation "count" (chaque levier compte pour 1). */
  getValue: (lever: Lever) => number;
}

/** Indicateurs sélectionnables — ancrés sur les champs financiers/RH réels du levier (voir
 *  `Lever` dans `types/index.ts`). `realizedSavings` réutilise le helper existant
 *  (`lib/engine.ts`) plutôt que de réinventer `netSavings * progress / 100`. `leverCount` est un
 *  pur comptage (utile pour "combien de leviers par pays", par ex.), donc n'a pas de champ
 *  numérique associé. */
export const METRIC_REGISTRY: MetricDef[] = [
  {
    key: "netSavings",
    label: "Économies nettes",
    aggregation: "sum",
    getValue: (l) => l.netSavings,
  },
  {
    key: "grossSavings",
    label: "Économies brutes",
    aggregation: "sum",
    getValue: (l) => l.grossSavings,
  },
  {
    key: "realizedSavings",
    label: "Économies réalisées",
    aggregation: "sum",
    getValue: (l) => realizedSavings(l),
  },
  {
    key: "fteImpact",
    label: "Impact ETP",
    aggregation: "sum",
    getValue: (l) => l.fteImpact,
  },
  {
    key: "progress",
    label: "Avancement moyen (%)",
    aggregation: "avg",
    getValue: (l) => l.progress,
  },
  {
    key: "capex",
    label: "CAPEX",
    aggregation: "sum",
    getValue: (l) => l.capex,
  },
  {
    key: "opexOneOff",
    label: "OPEX ponctuel",
    aggregation: "sum",
    getValue: (l) => l.opexOneOff,
  },
  {
    key: "opexRec",
    label: "OPEX récurrent",
    aggregation: "sum",
    getValue: (l) => l.opexRec,
  },
  {
    key: "leverCount",
    label: "Nombre de leviers",
    aggregation: "count",
    getValue: () => 1,
  },
];

export function getMetricDef(key: string): MetricDef | undefined {
  return METRIC_REGISTRY.find((m) => m.key === key);
}

// ─── Dimensions ─────────────────────────────────────────────────────────────────────────────────

/** Contexte de résolution des dimensions qui ont besoin de données annexes au levier lui-même
 *  (workstreams, projets, comptes P&L, arborescence financière, libellés de cycle de vie
 *  personnalisés). `pivotByDimensions` complète automatiquement `workstreams`/`pnlAccounts`
 *  depuis `data` — l'appelant n'a besoin de fournir que ce qui n'est pas déjà dans `BeTrackData`
 *  (projets, hiérarchie, libellés de statut personnalisés). */
export interface PivotContext {
  workstreams?: Workstream[];
  pnlAccounts?: PnlAccount[];
  projects?: Project[];
  hierarchyNodes?: HierarchyNode[];
  hierarchyLevels?: HierarchyLevelDef[];
  statusLabel?: (status: LeverStatus) => string;
}

export interface DimensionDef {
  key: string;
  label: string;
  getValue: (lever: Lever, ctx: PivotContext) => string;
}

const FALLBACK_LABEL = "Non renseigné";

/** Dimensions sélectionnables — ancrées sur les champs catégoriels réels du levier, dans le même
 *  esprit que les `FilterDef` de `app/(app)/levers/page.tsx` (paire clé + libellé + accesseur de
 *  valeur), plus quelques résolutions qui nécessitent un lookup annexe (workstream, projet,
 *  compte P&L, statut). */
export const DIMENSION_REGISTRY: DimensionDef[] = [
  { key: "type", label: "Type de levier", getValue: (l) => l.type || FALLBACK_LABEL },
  {
    key: "ws",
    label: "Workstream",
    getValue: (l, ctx) =>
      ctx.workstreams?.find((w) => w.id === l.ws)?.name ?? l.ws ?? FALLBACK_LABEL,
  },
  { key: "owner", label: "Owner", getValue: (l) => l.owner || FALLBACK_LABEL },
  { key: "sponsor", label: "Sponsor", getValue: (l) => l.sponsor || FALLBACK_LABEL },
  { key: "geography", label: "Géographie", getValue: (l) => l.geography || FALLBACK_LABEL },
  { key: "country", label: "Pays", getValue: (l) => l.country || FALLBACK_LABEL },
  { key: "entity", label: "Entité", getValue: (l) => l.entity || FALLBACK_LABEL },
  { key: "function", label: "Fonction", getValue: (l) => l.function || FALLBACK_LABEL },
  { key: "priority", label: "Priorité", getValue: (l) => l.priority || FALLBACK_LABEL },
  { key: "risk", label: "Risque", getValue: (l) => l.risk || FALLBACK_LABEL },
  {
    key: "status",
    label: "Statut",
    getValue: (l, ctx) =>
      ctx.statusLabel ? ctx.statusLabel(l.status) : STATUS_SHORT_LABEL[l.status],
  },
  {
    key: "project",
    label: "Projet",
    getValue: (l, ctx) => ctx.projects?.find((p) => p.id === l.projectId)?.name ?? "Non assigné",
  },
  {
    key: "pnlAccount",
    label: "Compte P&L",
    getValue: (l, ctx) =>
      ctx.pnlAccounts?.find((a) => a.id === l.pnlMap)?.name ?? l.pnlMap ?? FALLBACK_LABEL,
  },
];

/** Préfixe des clés de dimension dynamiques dérivées de `Company.hierarchyLevels` — une entreprise
 *  sans arborescence configurée n'en a simplement aucune (voir `getAvailableDimensions`). */
const HIERARCHY_KEY_PREFIX = "hierarchy:";

function hierarchyDimensionKey(levelKey: string): string {
  return `${HIERARCHY_KEY_PREFIX}${levelKey}`;
}

function buildHierarchyDimensionDef(level: HierarchyLevelDef): DimensionDef {
  return {
    key: hierarchyDimensionKey(level.key),
    label: level.label,
    getValue: (l, ctx) => {
      const path = resolveHierarchyPath(
        l.hierarchyLeafId ?? "",
        ctx.hierarchyNodes ?? [],
        ctx.hierarchyLevels ?? []
      );
      return path.find((p) => p.levelKey === level.key)?.label ?? FALLBACK_LABEL;
    },
  };
}

/** Résout une dimension par clé — dimensions statiques d'abord, puis dimensions de hiérarchie
 *  dynamiques (`hierarchy:<levelKey>`) si `hierarchyLevels` est fourni et contient ce niveau.
 *  Retourne `undefined` pour une clé inconnue (ex. widget legacy pointant vers une dimension
 *  retirée du registre — géré en amont par les appelants, jamais d'exception ici). */
export function getDimensionDef(
  key: string,
  hierarchyLevels: HierarchyLevelDef[] = []
): DimensionDef | undefined {
  const staticDef = DIMENSION_REGISTRY.find((d) => d.key === key);
  if (staticDef) return staticDef;
  if (!key.startsWith(HIERARCHY_KEY_PREFIX)) return undefined;
  const levelKey = key.slice(HIERARCHY_KEY_PREFIX.length);
  const level = hierarchyLevels.find((l) => l.key === levelKey);
  return level ? buildHierarchyDimensionDef(level) : undefined;
}

/** Liste complète des dimensions proposées dans le picker UI pour une entreprise donnée —
 *  dimensions fixes + une par niveau de hiérarchie configuré (macro → fin), absentes si
 *  l'entreprise n'a pas configuré d'arborescence financière. */
export function getAvailableDimensions(hierarchyLevels: HierarchyLevelDef[] = []): DimensionDef[] {
  const hierarchyDefs = [...hierarchyLevels]
    .sort((a, b) => a.order - b.order)
    .map(buildHierarchyDimensionDef);
  return [...DIMENSION_REGISTRY, ...hierarchyDefs];
}

// ─── Pivot générique ────────────────────────────────────────────────────────────────────────────

export type PivotRow = { key: string; label: string; value: number; count: number };

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function aggregate(levers: Lever[], metric: MetricDef): number {
  if (levers.length === 0) return 0;
  if (metric.aggregation === "count") return levers.length;
  const total = levers.reduce((s, l) => s + metric.getValue(l), 0);
  return round2(metric.aggregation === "avg" ? total / levers.length : total);
}

function groupByDimension(
  levers: Lever[],
  dim: DimensionDef,
  ctx: PivotContext
): Map<string, Lever[]> {
  const map = new Map<string, Lever[]>();
  levers.forEach((l) => {
    const raw = dim.getValue(l, ctx);
    const key = raw && raw.trim() !== "" ? raw : FALLBACK_LABEL;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(l);
  });
  return map;
}

function pivot1D(
  levers: Lever[],
  metric: MetricDef,
  dim: DimensionDef,
  ctx: PivotContext
): PivotRow[] {
  const groups = groupByDimension(levers, dim, ctx);
  return Array.from(groups.entries())
    .map(([key, group]) => ({
      key,
      label: key,
      value: aggregate(group, metric),
      count: group.length,
    }))
    .sort((a, b) => b.value - a.value);
}

/** Poids d'un levier pour le dimensionnement des colonnes/segments Marimekko : pour une métrique
 *  "sum" (montants financiers), le poids naturel est la valeur absolue du champ — pour "avg"
 *  (ex. progression moyenne) ou "count" (ex. nombre de leviers), une somme de valeurs n'a pas de
 *  sens comme poids visuel, donc chaque levier pèse 1 (poids = nombre de leviers du groupe). */
function weightOf(lever: Lever, metric: MetricDef): number {
  return metric.aggregation === "sum" ? Math.abs(metric.getValue(lever)) : 1;
}

/** Généralise l'algorithme de `marimekko2D` (ex-`lib/engine.ts`) à une métrique et une paire de
 *  dimensions arbitraires : largeur des colonnes = poids de la dimension primaire dans le total,
 *  chaque colonne se décompose en segments empilés selon la dimension secondaire. Réutilise le
 *  type `Marimekko2DColumn` existant pour rester compatible avec `MarimekkoChart` tel quel. */
function pivot2D(
  levers: Lever[],
  metric: MetricDef,
  dim1: DimensionDef,
  dim2: DimensionDef,
  ctx: PivotContext
): Marimekko2DColumn[] {
  const totalWeight = levers.reduce((s, l) => s + weightOf(l, metric), 0) || 1;
  const byPrimary = groupByDimension(levers, dim1, ctx);

  return Array.from(byPrimary.entries())
    .map(([primaryKey, group]) => {
      const colWeight = group.reduce((s, l) => s + weightOf(l, metric), 0) || 1;
      const bySecondary = groupByDimension(group, dim2, ctx);

      const segments: Marimekko2DSegment[] = Array.from(bySecondary.entries())
        .map(([secondaryKey, segGroup]) => {
          const segWeight = segGroup.reduce((s, l) => s + weightOf(l, metric), 0);
          return {
            key: secondaryKey,
            label: secondaryKey,
            heightPct: Math.round((segWeight / colWeight) * 1000) / 10,
            value: aggregate(segGroup, metric),
            count: segGroup.length,
          };
        })
        .sort((a, b) => b.value - a.value);

      return {
        key: primaryKey,
        label: primaryKey,
        widthPct: Math.round((colWeight / totalWeight) * 1000) / 10,
        totalSavings: aggregate(group, metric),
        segments,
      };
    })
    .sort((a, b) => b.totalSavings - a.totalSavings);
}

/**
 * Point d'entrée unique du pivot générique : étant donné une métrique et 1 ou 2 clés de
 * dimension, regroupe les leviers ACTIFS (non annulés — même filtre que l'ancien
 * `byGeo`/`byFunction`/`marimekko2D`) et retourne la forme adaptée au nombre de dimensions.
 * Clé/dimension inconnue ou tableau de données vide → tableau vide (jamais d'exception), pour
 * rester directement utilisable dans le rendu sans garde supplémentaire côté appelant.
 */
export function pivotByDimensions(
  data: BeTrackData,
  metricKey: string,
  dimensionKeys: string[],
  context: PivotContext = {}
): PivotRow[] | Marimekko2DColumn[] {
  const metric = getMetricDef(metricKey);
  if (!metric || dimensionKeys.length === 0) return [];

  const fullCtx: PivotContext = {
    ...context,
    workstreams: context.workstreams ?? data.workstreams,
    pnlAccounts: context.pnlAccounts ?? data.pnlAccounts,
  };

  const dim1 = getDimensionDef(dimensionKeys[0], context.hierarchyLevels);
  if (!dim1) return [];

  const active = data.levers.filter((l) => l.status !== "cancelled");

  if (dimensionKeys.length === 1) {
    return pivot1D(active, metric, dim1, fullCtx);
  }

  const dim2 = getDimensionDef(dimensionKeys[1], context.hierarchyLevels);
  if (!dim2) return pivot1D(active, metric, dim1, fullCtx);
  return pivot2D(active, metric, dim1, dim2, fullCtx);
}
