/**
 * Registre des widgets du Dashboard RH + modèle de mise en page éditable — équivalent RH de
 * `lib/dashboardWidgets.ts` (dashboard exécutif). Même principe de personnalisation d'affichage
 * PERSONNELLE (par navigateur, localStorage), avec une clé DISTINCTE (`betrack_hr_dashboard_layout_v1`)
 * pour que personnaliser l'un des deux dashboards n'affecte jamais l'autre.
 *
 * Pourquoi un fichier séparé plutôt qu'une extension de `lib/dashboardWidgets.ts` : ce fichier
 * référence son propre `DashboardWidgetType`, une union FERMÉE de types de widgets du dashboard
 * exécutif — y ajouter les types RH casserait l'exhaustivité voulue de cette union (et le registre
 * associé) pour un domaine qui n'a rien à voir (mouvements RH vs leviers). En revanche, tout ce qui
 * NE référence PAS `DashboardWidgetType` — `WidgetSpan`, `SPAN_COL_CLASS`, `moveWidget` (générique
 * sur `T`), `cycleSpan` (générique sur `WidgetSpan`) — est réimporté tel quel plutôt que dupliqué :
 * ce sont des primitives de mise en page pures, indépendantes du domaine.
 *
 * Décision de scope (même principe que le dashboard exécutif) : la ligne de KPI, l'en-tête (titre,
 * bouton Base ETP) et la bannière d'alertes de réconciliation RH ↔ leviers restent EN DEHORS de ce
 * système — chrome fixe, pas des "graphiques" repositionnables (la bannière d'alertes est un flux
 * d'actions prioritaires, pas un graphique : la garder toujours visible en haut, comme sur le
 * dashboard exécutif où elle EST un widget "alerts", est un choix délibérément différent ici —
 * voir la note dans `app/(app)/hr/page.tsx`). Tout le reste de l'ancien layout fixe RH (waterfall
 * ETP, breakdowns département/pays, waterfall masse salariale, PSE, table des départements) devient
 * un widget de ce registre, plus deux nouveaux widgets couvrant des vues qui existaient dans le
 * moteur (`lib/hrEngine.ts::movementsByType`) sans être exposées sur le dashboard fixe : la
 * ventilation par type de mouvement, et une table de synthèse des mouvements.
 *
 * Contrairement au dashboard exécutif, aucun widget RH du builder générique n'a de forme
 * Marimekko (2 dimensions) — voir `lib/hrDashboardPivot.ts`. `builderEnabled` remplace donc
 * `builderDimensionCount` (toujours 1 dimension quand `true`).
 */

import {
  WIDGET_SPANS,
  SPAN_COL_CLASS,
  moveWidget,
  cycleSpan,
  type WidgetSpan,
} from "@/lib/dashboardWidgets";

export { WIDGET_SPANS, SPAN_COL_CLASS, moveWidget, cycleSpan };
export type { WidgetSpan };

export type HrWidgetType =
  | "fte-waterfall"
  | "staff-cost-waterfall"
  | "savings-period-cumul"
  | "social-cost-enr"
  | "net-economy"
  | "movement-rhythm"
  | "etp-bridge"
  | "department-breakdown"
  | "fte-execution-status"
  | "salary-execution-status"
  | "hr-owner-actions"
  | "pse-summary"
  | "department-table"
  | "movements-table";

/** Une configuration de vue construite par l'utilisateur pour un widget RH du builder générique
 *  (voir `lib/hrDashboardPivot.ts` pour `HR_METRIC_REGISTRY`/`HR_DIMENSION_REGISTRY`) — une seule
 *  clé de dimension (aucun widget RH n'a de forme à 2 dimensions), contrairement à
 *  `CustomViewConfig` du dashboard exécutif dont `dimensions` peut porter 1 ou 2 clés. */
export interface HrCustomViewConfig {
  id: string;
  metric: string;
  dimension: string;
  /** Libellé affiché dans le sélecteur de vue — généré à l'affichage si omis (voir
   *  `describeHrCustomView` côté page RH). */
  label?: string;
}

export interface HrWidgetDef {
  type: HrWidgetType;
  label: string;
  /** Nom d'icône lucide-react (voir `components/shared/icon-registry.tsx`). */
  icon: string;
  defaultSpan: WidgetSpan;
  allowedSpans: WidgetSpan[];
  /** `true` = ce type de widget supporte le builder générique métrique × dimension (voir
   *  `lib/hrDashboardPivot.ts`) EN PLUS de sa vue par défaut câblée en dur (repro exacte de l'ancien
   *  graphique fixe) — `undefined`/`false` = structure intrinsèquement fixe (waterfall, table de
   *  synthèse des départements), pas de builder. */
  builderEnabled?: boolean;
  /** Vue active par défaut à la création d'une instance (id d'un `defaultCustomViews`). */
  defaultView?: string;
  /** Vues pré-câblées à la création du layout par défaut — même rôle que
   *  `DashboardWidgetDef.defaultCustomViews` : matérialiser la vue historique fixe comme
   *  `HrCustomViewConfig` plutôt que de la perdre lors du passage au builder générique. */
  defaultCustomViews?: HrCustomViewConfig[];
}

/** Une instance de widget posée sur le Dashboard RH — même rôle que `DashboardWidgetInstance` du
 *  dashboard exécutif (voir ce fichier pour la sémantique détaillée de chaque champ). */
export interface HrWidgetInstance {
  instanceId: string;
  type: HrWidgetType;
  span: WidgetSpan;
  view?: string;
  customViews?: HrCustomViewConfig[];
}

/** Registre de tous les widgets RH disponibles, dans leur ordre d'apparition par défaut. */
export const HR_WIDGET_REGISTRY: HrWidgetDef[] = [
  {
    type: "fte-waterfall",
    label: "Trajectoire ETP",
    icon: "Waypoints",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "fte-execution-status",
    label: "Impacts ETP par statut",
    icon: "BarChart3",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
    defaultView: "function",
  },
  {
    type: "staff-cost-waterfall",
    label: "Trajectoire Masse Salariale (€M, annualisé)",
    icon: "Wallet",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "salary-execution-status",
    label: "Impacts Masse Salariale par statut (€M, annualisé)",
    icon: "BarChart3",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
    defaultView: "function",
  },
  {
    type: "hr-owner-actions",
    label: "Plan d'actions par RH Owner",
    icon: "Users",
    defaultSpan: "XL",
    allowedSpans: ["L", "XL"],
  },
  {
    type: "savings-period-cumul",
    // Nouveau — Économies par période et cumul (Actual + forecast vs Plan) avec double axe Y.
    label: "Économies par période et cumul",
    icon: "LineChart",
    defaultSpan: "XL",
    allowedSpans: ["L", "XL"],
  },
  {
    type: "social-cost-enr",
    // Nouveau — ENR (coûts sociaux exceptionnels) par période + courbe cumul.
    label: "Coûts sociaux exceptionnels et cumul",
    icon: "TrendingDown",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "pse-summary",
    label: "Suivi du PSE (Plan de Sauvegarde de l'Emploi)",
    icon: "ShieldCheck",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "net-economy",
    // Nouveau — Économie nette (savings récurrentes − ENR) barres +/− + courbe cumul.
    label: "Économie nette (savings récurrentes − ENR)",
    icon: "Wallet",
    defaultSpan: "XL",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "department-breakdown",
    label: "Mouvements prévus par dimension",
    icon: "Building2",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
    defaultView: "department",
  },
  {
    type: "department-table",
    label: "Effectifs par dimension — actuel vs cible vs atterrissage",
    icon: "Table2",
    defaultSpan: "XL",
    allowedSpans: ["L", "XL"],
    defaultView: "department",
  },
  {
    type: "movement-rhythm",
    label: "Détail mensuel des mouvements et cumul net",
    icon: "Activity",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "etp-bridge",
    label: "Pont ETP — contribution des mouvements",
    icon: "GitBranch",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "movements-table",
    label: "Synthèse des mouvements",
    icon: "ListChecks",
    defaultSpan: "XL",
    allowedSpans: ["L", "XL"],
  },
];

export function getHrWidgetDef(type: string): HrWidgetDef | undefined {
  return HR_WIDGET_REGISTRY.find((w) => w.type === type);
}

/** Layout par défaut v2 — ordre cockpit validé en Août 2026, avec paires M+M et suppression des
 * widgets pays/type/masse salariale devenus redondants. */
export function buildHrDefaultLayout(): HrWidgetInstance[] {
  return HR_WIDGET_REGISTRY.map((def) => ({
    instanceId: def.type,
    type: def.type,
    span: def.defaultSpan,
    ...(def.defaultView ? { view: def.defaultView } : {}),
    ...(def.defaultCustomViews ? { customViews: def.defaultCustomViews } : {}),
  }));
}

// ─── Helpers purs (ajout, suppression, redimensionnement, vues) ───────────────────────────────
// `moveWidget`/`cycleSpan` sont réimportés tels quels depuis lib/dashboardWidgets.ts (génériques,
// voir en-tête de fichier) — seuls les helpers ci-dessous, typés sur HrWidgetInstance/HrWidgetType,
// sont forkés.

let instanceCounter = 0;

function nextInstanceId(type: HrWidgetType): string {
  instanceCounter += 1;
  return `${type}-${instanceCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextCustomViewId(): string {
  instanceCounter += 1;
  return `hr-cv-${instanceCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function removeHrWidget(layout: HrWidgetInstance[], instanceId: string): HrWidgetInstance[] {
  return layout.filter((w) => w.instanceId !== instanceId);
}

/** Ajoute une nouvelle instance du widget `type` en fin de layout, avec sa vue par défaut — utilisé
 *  pour les types NON builder (ajout immédiat, comme `addWidget` du dashboard exécutif). Pour les
 *  types builder déjà présents, la page RH passe plutôt par le flux "nouveau bloc vs vue sur bloc
 *  existant" (voir `addHrWidgetWithCustomView`/`addCustomViewToHrInstance`). */
export function addHrWidget(layout: HrWidgetInstance[], type: HrWidgetType): HrWidgetInstance[] {
  const def = getHrWidgetDef(type);
  if (!def) return layout;
  return [
    ...layout,
    {
      instanceId: nextInstanceId(type),
      type: def.type,
      span: def.defaultSpan,
      ...(def.defaultView ? { view: def.defaultView } : {}),
      ...(def.defaultCustomViews ? { customViews: def.defaultCustomViews } : {}),
    },
  ];
}

/** Ajoute une nouvelle instance de widget du builder générique avec UNE SEULE vue construite par
 *  l'utilisateur (métrique + dimension choisies à l'ajout) — distinct de `addHrWidget`. */
export function addHrWidgetWithCustomView(
  layout: HrWidgetInstance[],
  type: HrWidgetType,
  config: { metric: string; dimension: string; label?: string }
): HrWidgetInstance[] {
  const def = getHrWidgetDef(type);
  if (!def) return layout;
  const id = nextCustomViewId();
  const customView: HrCustomViewConfig = {
    id,
    metric: config.metric,
    dimension: config.dimension,
    label: config.label,
  };
  return [
    ...layout,
    {
      instanceId: nextInstanceId(type),
      type: def.type,
      span: def.defaultSpan,
      view: id,
      customViews: [customView],
    },
  ];
}

/** Ajoute une nouvelle vue construite à une instance EXISTANTE et bascule immédiatement son
 *  affichage dessus (flux "ajouter une vue à un widget existant") — matérialise d'abord
 *  `def.defaultCustomViews` si l'instance n'en a encore aucune (layout localStorage antérieur à
 *  cette fonctionnalité), même logique défensive que `addCustomViewToInstance` du dashboard
 *  exécutif. */
export function addCustomViewToHrInstance(
  layout: HrWidgetInstance[],
  instanceId: string,
  config: { metric: string; dimension: string; label?: string }
): HrWidgetInstance[] {
  const id = nextCustomViewId();
  const newView: HrCustomViewConfig = {
    id,
    metric: config.metric,
    dimension: config.dimension,
    label: config.label,
  };
  return layout.map((w) => {
    if (w.instanceId !== instanceId) return w;
    const def = getHrWidgetDef(w.type);
    const existing =
      w.customViews && w.customViews.length > 0 ? w.customViews : (def?.defaultCustomViews ?? []);
    return { ...w, customViews: [...existing, newView], view: id };
  });
}

export function setHrWidgetSpan(
  layout: HrWidgetInstance[],
  instanceId: string,
  span: WidgetSpan
): HrWidgetInstance[] {
  return layout.map((w) => (w.instanceId === instanceId ? { ...w, span } : w));
}

export function setHrWidgetView(
  layout: HrWidgetInstance[],
  instanceId: string,
  view: string
): HrWidgetInstance[] {
  return layout.map((w) => (w.instanceId === instanceId ? { ...w, view } : w));
}

/** Vues effectivement disponibles pour une instance du builder générique — celles de l'instance si
 *  elle en a, sinon repli sur `def.defaultCustomViews`. Tableau vide pour un type non builder. */
export function resolveHrCustomViews(instance: HrWidgetInstance): HrCustomViewConfig[] {
  if (instance.customViews && instance.customViews.length > 0) return instance.customViews;
  const def = getHrWidgetDef(instance.type);
  return def?.defaultCustomViews ?? [];
}

/** Vue active d'une instance du builder générique — celle dont l'id correspond à `instance.view`,
 *  sinon la première disponible. */
export function resolveHrActiveCustomView(
  instance: HrWidgetInstance
): HrCustomViewConfig | undefined {
  const views = resolveHrCustomViews(instance);
  if (views.length === 0) return undefined;
  return views.find((v) => v.id === instance.view) ?? views[0];
}

// ─── Persistance localStorage ───────────────────────────────────────────────────────────────────

// v3 : ajout des vues d'exécution ETP/masse salariale et du plan d'actions RH Owner. L'application
// n'étant pas encore utilisée, on repart volontairement du nouveau layout par défaut pour tous.
const HR_LAYOUT_KEY = "betrack_hr_dashboard_layout_v3";

/** Clé séparée pour la migration one-shot des widgets Gooduelle (Août 2026). Voir
 *  `migrateHrGooduelleWidgets` ci-dessous — ajoute les 5 nouveaux widgets aux layouts persistés
 *  antérieurs, une seule fois, en respectant les suppressions ultérieures de l'utilisateur. */
const HR_GOODUELLE_MIGRATION_KEY = "betrack_hr_dashboard_gooduelle_migration_v1";

const NEW_GOODUELLE_WIDGET_TYPES: HrWidgetType[] = [
  "staff-cost-waterfall",
  "savings-period-cumul",
  "social-cost-enr",
  "net-economy",
  "movement-rhythm",
  "etp-bridge",
  "fte-execution-status",
  "salary-execution-status",
  "hr-owner-actions",
];

/** Ajoute les nouveaux widgets Gooduelle une seule fois aux layouts persistés antérieurs. Si
 *  l'utilisateur supprime ensuite un widget, il ne réapparaît pas au chargement suivant. */
export function migrateHrGooduelleWidgets(
  layout: HrWidgetInstance[],
  migrationAlreadyApplied: boolean
): HrWidgetInstance[] {
  if (migrationAlreadyApplied) return layout;
  const presentTypes = new Set(layout.map((w) => w.type));
  const toAdd: HrWidgetInstance[] = [];
  for (const type of NEW_GOODUELLE_WIDGET_TYPES) {
    if (presentTypes.has(type)) continue;
    const def = getHrWidgetDef(type);
    if (!def) continue;
    toAdd.push({
      instanceId: type,
      type,
      span: def.defaultSpan,
      ...(def.defaultView ? { view: def.defaultView } : {}),
    });
  }
  // Retire aussi l'ancien fte-trajectory (remplacé par les nouveaux graphiques Gooduelle).
  const filtered = layout.filter((w) => w.type !== ("fte-trajectory" as HrWidgetType));
  return [...filtered, ...toAdd];
}

const isBrowser = () => typeof window !== "undefined";

function isValidHrInstance(value: unknown): value is HrWidgetInstance {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.instanceId === "string" &&
    typeof v.type === "string" &&
    !!getHrWidgetDef(v.type) &&
    typeof v.span === "string" &&
    (WIDGET_SPANS as string[]).includes(v.span)
  );
}

function isValidHrCustomView(value: unknown): value is HrCustomViewConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.metric === "string" &&
    typeof v.dimension === "string" &&
    (v.label === undefined || typeof v.label === "string")
  );
}

function withoutHrCustomViews(instance: HrWidgetInstance): HrWidgetInstance {
  const rest: HrWidgetInstance = { ...instance };
  delete rest.customViews;
  return rest;
}

function sanitizeHrInstance(instance: HrWidgetInstance): HrWidgetInstance {
  const raw = (instance as { customViews?: unknown }).customViews;
  if (!Array.isArray(raw)) {
    return raw === undefined ? instance : withoutHrCustomViews(instance);
  }
  const cleaned = raw.filter(isValidHrCustomView);
  return cleaned.length === 0
    ? withoutHrCustomViews(instance)
    : { ...instance, customViews: cleaned };
}

/** Charge le layout RH personnalisé depuis localStorage — mêmes garanties défensives que
 *  `loadDashboardLayout` (retombe sur le layout par défaut si absent/corrompu/obsolète). */
export function loadHrDashboardLayout(): HrWidgetInstance[] {
  if (!isBrowser()) return buildHrDefaultLayout();
  try {
    const raw = window.localStorage.getItem(HR_LAYOUT_KEY);
    if (!raw) {
      window.localStorage.setItem(HR_GOODUELLE_MIGRATION_KEY, "1");
      return buildHrDefaultLayout();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isValidHrInstance)) {
      window.localStorage.setItem(HR_GOODUELLE_MIGRATION_KEY, "1");
      return buildHrDefaultLayout();
    }
    const migrationAlreadyApplied = window.localStorage.getItem(HR_GOODUELLE_MIGRATION_KEY) === "1";
    const sanitized = (parsed as HrWidgetInstance[]).map(sanitizeHrInstance);
    const migrated = migrateHrGooduelleWidgets(sanitized, migrationAlreadyApplied);
    if (!migrationAlreadyApplied) {
      window.localStorage.setItem(HR_LAYOUT_KEY, JSON.stringify(migrated));
    }
    window.localStorage.setItem(HR_GOODUELLE_MIGRATION_KEY, "1");
    return migrated;
  } catch {
    return buildHrDefaultLayout();
  }
}

export function saveHrDashboardLayout(layout: HrWidgetInstance[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(HR_LAYOUT_KEY, JSON.stringify(layout));
    window.localStorage.setItem(HR_GOODUELLE_MIGRATION_KEY, "1");
  } catch (err) {
    console.error(
      "[betrack storage] échec d'écriture localStorage pour le layout dashboard RH :",
      err
    );
  }
}
