/**
 * Registre des widgets du dashboard STRATÉGIQUE + modèle de mise en page éditable, pendant de
 * `lib/dashboardWidgets.ts` pour le Plan Stratégique.
 *
 * Pourquoi un SECOND registre plutôt qu'une extension du premier : le registre exécutif est
 * intégralement câblé sur les métriques financières (CAPEX/OPEX/savings, S-Curve, bridge, P&L,
 * Marimekko sur les économies) et son builder générique repose sur `lib/dashboardPivot.ts`, lui
 * aussi financier. Aucun de ces widgets n'a de sens pour un plan stratégique, dont les métriques
 * sont d'une autre nature (cumul d'indicateurs, on-track/à risque, répartition par axe). Même
 * politique de duplication que `StageBadge`/`AxisStageBadge` : cloner deux domaines distincts
 * plutôt que génériciser prématurément.
 *
 * Persistance : clé localStorage PROPRE (`betrack_strategic_dashboard_layout_v1`), de sorte qu'un
 * utilisateur qui personnalise les deux dashboards ne voie jamais l'un écraser l'autre. Comme pour
 * l'exécutif, c'est une préférence d'affichage personnelle (par navigateur), pas une donnée
 * d'entreprise.
 *
 * Les types de widgets restent volontairement simples à ce stade : le RENDU est à la charge de
 * `components/strategic/StrategicDashboardView.tsx` (workstream D) ; ce fichier n'expose que le
 * catalogue et les helpers de layout.
 */

import {
  SPAN_COL_CLASS,
  WIDGET_SPANS,
  cycleSpan,
  moveWidget,
  type WidgetSpan,
} from "@/lib/dashboardWidgets";

// Réexportés pour que les consommateurs stratégiques n'aient pas à importer le module exécutif :
// ce sont des primitives de GRILLE (tailles de colonnes, déplacement dans une liste), pas des
// métriques financières — les dupliquer n'apporterait rien qu'une divergence possible.
export { SPAN_COL_CLASS, WIDGET_SPANS, cycleSpan, moveWidget };
export type { WidgetSpan };

export type StrategicDashboardWidgetType =
  /** Cumul des dernières valeurs des indicateurs quantitatifs du programme. */
  | "indicator-total"
  /** Compteur "X sur la trajectoire · Y à risque". */
  | "indicator-status"
  /** Répartition des indicateurs (ou des chantiers) par axe stratégique. */
  | "axis-breakdown"
  /** Liste des indicateurs actuellement à risque. */
  | "indicators-at-risk"
  /** Avancement des axes par étape de maturité (référentiel du programme). */
  | "axis-maturity"
  /** Alertes de cascade de retard entre chantiers (sans montant financier). */
  | "chantier-dependency-alerts";

export interface StrategicDashboardWidgetDef {
  type: StrategicDashboardWidgetType;
  /** Clé i18n du libellé affiché dans le menu "Ajouter un widget". */
  label: string;
  /** Nom d'icône lucide-react utilisé dans le sélecteur de widgets. */
  icon: string;
  defaultSpan: WidgetSpan;
  allowedSpans: WidgetSpan[];
  /** Disponible dans le picker mais absent du layout par défaut. */
  excludeFromDefault?: boolean;
}

export interface StrategicDashboardWidgetInstance {
  instanceId: string;
  type: StrategicDashboardWidgetType;
  span: WidgetSpan;
}

/** Registre de tous les widgets stratégiques disponibles, dans leur ordre d'apparition par
 *  défaut. */
export const STRATEGIC_DASHBOARD_WIDGET_REGISTRY: StrategicDashboardWidgetDef[] = [
  {
    type: "indicator-status",
    label: "strategicDashboard.widget.indicatorStatus",
    icon: "Gauge",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "indicator-total",
    label: "strategicDashboard.widget.indicatorTotal",
    icon: "Sigma",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "axis-breakdown",
    label: "strategicDashboard.widget.axisBreakdown",
    icon: "Columns3",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "indicators-at-risk",
    label: "strategicDashboard.widget.indicatorsAtRisk",
    icon: "TrendingDown",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "axis-maturity",
    label: "strategicDashboard.widget.axisMaturity",
    icon: "Workflow",
    defaultSpan: "XL",
    allowedSpans: ["L", "XL"],
  },
  {
    type: "chantier-dependency-alerts",
    label: "strategicDashboard.widget.chantierDependencyAlerts",
    icon: "Unlink",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
  },
];

export function getStrategicWidgetDef(type: string): StrategicDashboardWidgetDef | undefined {
  return STRATEGIC_DASHBOARD_WIDGET_REGISTRY.find((w) => w.type === type);
}

export function buildDefaultLayout(): StrategicDashboardWidgetInstance[] {
  return STRATEGIC_DASHBOARD_WIDGET_REGISTRY.filter((def) => !def.excludeFromDefault).map(
    (def) => ({
      instanceId: def.type,
      type: def.type,
      span: def.defaultSpan,
    })
  );
}

// ─── Helpers purs (ajout, suppression, redimensionnement) ──────────────────────────────────────

let instanceCounter = 0;

/** Plusieurs instances d'un même type sont autorisées (ex. deux répartitions par axe côte à
 *  côte), d'où un instanceId distinct du type. */
function nextInstanceId(type: StrategicDashboardWidgetType): string {
  instanceCounter += 1;
  return `${type}-${instanceCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addWidget(
  layout: StrategicDashboardWidgetInstance[],
  type: StrategicDashboardWidgetType
): StrategicDashboardWidgetInstance[] {
  const def = getStrategicWidgetDef(type);
  if (!def) return layout;
  return [...layout, { instanceId: nextInstanceId(type), type: def.type, span: def.defaultSpan }];
}

export function removeWidget(
  layout: StrategicDashboardWidgetInstance[],
  instanceId: string
): StrategicDashboardWidgetInstance[] {
  return layout.filter((w) => w.instanceId !== instanceId);
}

export function setWidgetSpan(
  layout: StrategicDashboardWidgetInstance[],
  instanceId: string,
  span: WidgetSpan
): StrategicDashboardWidgetInstance[] {
  return layout.map((w) => (w.instanceId === instanceId ? { ...w, span } : w));
}

// ─── Persistance localStorage ──────────────────────────────────────────────────────────────────

/** Clé DÉDIÉE, distincte de `betrack_dashboard_layout_v10` (dashboard exécutif) : les deux
 *  dashboards ont des registres disjoints, partager la clé réinitialiserait l'un à chaque
 *  personnalisation de l'autre. */
const LAYOUT_KEY = "betrack_strategic_dashboard_layout_v1";

const isBrowser = () => typeof window !== "undefined";

function isValidInstance(value: unknown): value is StrategicDashboardWidgetInstance {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.instanceId === "string" &&
    typeof v.type === "string" &&
    !!getStrategicWidgetDef(v.type) &&
    typeof v.span === "string" &&
    (WIDGET_SPANS as string[]).includes(v.span)
  );
}

/** Charge le layout personnalisé. Retombe sur le layout par défaut si absent, corrompu, ou si son
 *  contenu ne correspond plus au registre courant (widget renommé/retiré). */
export function loadStrategicDashboardLayout(): StrategicDashboardWidgetInstance[] {
  if (!isBrowser()) return buildDefaultLayout();
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (!raw) return buildDefaultLayout();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isValidInstance)) {
      return buildDefaultLayout();
    }
    return parsed as StrategicDashboardWidgetInstance[];
  } catch {
    return buildDefaultLayout();
  }
}

export function saveStrategicDashboardLayout(layout: StrategicDashboardWidgetInstance[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch (err) {
    console.error(
      "[betrack storage] échec d'écriture localStorage pour le layout dashboard stratégique :",
      err
    );
  }
}
