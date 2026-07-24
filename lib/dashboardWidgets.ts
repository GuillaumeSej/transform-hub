/**
 * Registre des widgets du dashboard exécutif + modèle de mise en page ("layout") éditable par
 * l'utilisateur. Ceci est une customisation d'affichage PERSONNELLE (par navigateur), pas une
 * donnée d'entreprise : elle vit en localStorage, suivant le même pattern que `lib/storage.ts`
 * (clé préfixée `betrack_`, JSON-sérialisée, lecture/écriture protégées par `isBrowser()`).
 *
 * Décision de scope : la ligne de KPI, l'en-tête (titre, export) et la barre de filtres restent EN
 * DEHORS de ce système — ce sont des éléments de chrome fixes, pas des "graphiques"
 * repositionnables. Tout le reste de l'ancien layout fixe du dashboard (funnel, alertes, S-Curve,
 * bridge, sankey, marimekko, ventilations, table de synthèse, dépendances, P&L) devient un widget
 * de ce registre.
 *
 * Grille de base : 4 colonnes (`grid-cols-4`). Un widget occupe S=1 / M=2 / L=3 / XL=4 colonnes.
 * La grille CSS native reflow automatiquement les widgets suivants sur la ligne suivante dès qu'un
 * widget ne tient plus dans la largeur restante — c'est ce qui donne le "les autres bougent pour
 * faire de la place" sans moteur de grid-layout dédié.
 */

export type WidgetSpan = "S" | "M" | "L" | "XL";

export const WIDGET_SPANS: WidgetSpan[] = ["S", "M", "L", "XL"];

/** Classe Tailwind `col-span-*` pour chaque taille — chaînes littérales (pas de template
 * dynamique) pour que le JIT Tailwind les détecte à la compilation. */
export const SPAN_COL_CLASS: Record<WidgetSpan, string> = {
  S: "col-span-1",
  M: "col-span-2",
  L: "col-span-3",
  XL: "col-span-4",
};

export type DashboardWidgetType =
  | "stage-funnel"
  | "alerts"
  | "s-curve"
  | "bridge"
  | "sankey"
  | "marimekko"
  | "workstream-breakdown"
  | "geo-breakdown"
  | "workstream-table"
  | "dependencies"
  | "pnl";

/** Une option d'indicateur/dimension pour un type de widget "configurable" (voir plus bas) — ex.
 * pour le Marimekko, la paire de dimensions "Fonction × Pays" vs "Workstream × Projet". */
export interface WidgetViewOption {
  key: string;
  /** Clé i18n du libellé (résolue via t() au point de consommation). */
  labelKey: string;
}

/** Une configuration de vue "construite" par l'utilisateur pour un widget du builder générique
 *  métrique × dimension(s) (voir `lib/dashboardPivot.ts` pour `METRIC_REGISTRY`/
 *  `DIMENSION_REGISTRY`) — `dimensions` porte 1 clé (forme barre/donut) ou 2 clés (forme
 *  Marimekko), selon `DashboardWidgetDef.builderDimensionCount` du type de widget concerné.
 *  Distincte de `WidgetViewOption` (catalogue FIGÉ, 2 entrées câblées en dur par type) : une
 *  `CustomViewConfig` est un couple choisi librement par l'utilisateur, stocké sur l'INSTANCE elle-
 *  même plutôt que sur le registre. */
export interface CustomViewConfig {
  id: string;
  metric: string;
  dimensions: string[];
  /** Libellé affiché dans le sélecteur de vue — si omis, généré à l'affichage à partir des
   *  libellés de la métrique et des dimensions (voir `describeCustomView` côté page dashboard). */
  label?: string;
}

export interface DashboardWidgetDef {
  type: DashboardWidgetType;
  /** Clé i18n du libellé affiché dans le menu "Ajouter un widget" (fallback = libellé FR brut). */
  label: string;
  /** Nom d'icône lucide-react utilisé comme illustration dans le sélecteur de widgets. */
  icon: string;
  defaultSpan: WidgetSpan;
  /** Tailles autorisées pour ce widget — certains graphiques n'ont pas de sens trop étroits. */
  allowedSpans: WidgetSpan[];
  /** Widget "configurable" (legacy) : le TYPE de graphique (ex. Marimekko) est distinct de
   *  l'INDICATEUR/dimension affiché (ex. Fonction×Pays vs Workstream×Projet) — l'utilisateur
   *  choisit d'abord le graphique, puis peut basculer entre les vues possibles via un sélecteur
   *  intégré au widget, sans avoir à ajouter un nouveau bloc. Non configurable = graphique à
   *  contenu fixe (S-Curve, Sankey, alertes...). Conservé pour compat/repli (voir
   *  `resolveCustomViews`) — les widgets `builderDimensionCount` expriment maintenant ces mêmes
   *  vues comme `defaultCustomViews` (builder générique), `viewOptions` ne sert plus qu'à générer
   *  ce repli et à distinguer "configurable" de "fixe" pour l'historique `isValidInstance`. */
  viewOptions?: WidgetViewOption[];
  /** Vue active par défaut à la création d'une instance — première entrée de `viewOptions` si
   *  omis. */
  defaultView?: string;
  /** Nombre EXACT de dimensions requis par le builder générique métrique × dimension(s) pour ce
   *  type de widget : 1 = forme barre/donut (une seule dimension de ventilation), 2 = forme
   *  Marimekko (dimension primaire × secondaire). `undefined` = ce type de widget ne supporte pas
   *  le builder générique (structure intrinsèquement fixe — ex. S-Curve, Sankey, table de
   *  synthèse) ; cliquer dessus dans le sélecteur garde le comportement d'ajout immédiat
   *  historique. */
  builderDimensionCount?: 1 | 2;
  /** Vues pré-câblées à la création du layout par défaut, pour que les utilisateurs existants
   *  retrouvent EXACTEMENT les vues historiques (ex. Fonction×Pays du Marimekko) sous forme de
   *  `CustomViewConfig` plutôt que de perdre ce choix lors de la migration vers le builder
   *  générique. Uniquement pertinent quand `builderDimensionCount` est défini. */
  defaultCustomViews?: CustomViewConfig[];
}

/** Une instance de widget posée sur le dashboard — un même type peut être ajouté plusieurs fois
 * (ex. deux blocs Sankey séparés), d'où l'instanceId distinct du type. `view` porte la vue active
 * — soit une clé de `WidgetViewOption` legacy, soit l'id d'un `CustomViewConfig` du builder
 * générique — elle vit sur l'INSTANCE, pas sur un état de page partagé, pour que deux instances du
 * même type puissent chacune afficher une vue différente sans interférer l'une avec l'autre.
 * `customViews` porte la liste des configurations métrique × dimension(s) que l'utilisateur a
 * construites pour CETTE instance (builder générique, voir `lib/dashboardPivot.ts`) — absente ou
 * vide sur un layout localStorage antérieur à cette fonctionnalité, auquel cas le rendu retombe
 * sur les vues historiques câblées en dur (voir `resolveCustomViews` côté page dashboard). */
export interface DashboardWidgetInstance {
  instanceId: string;
  type: DashboardWidgetType;
  span: WidgetSpan;
  view?: string;
  customViews?: CustomViewConfig[];
}

/** Registre de tous les widgets disponibles, dans leur ordre d'apparition par défaut. */
export const DASHBOARD_WIDGET_REGISTRY: DashboardWidgetDef[] = [
  {
    type: "stage-funnel",
    label: "Avancement par étape du cycle de vie",
    icon: "Workflow",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "alerts",
    label: "Alerts & Notifications",
    icon: "Bell",
    defaultSpan: "M",
    allowedSpans: ["S", "M", "L", "XL"],
  },
  {
    type: "s-curve",
    label: "S-Curve — Plan initial / Réalisé / Réactualisé",
    icon: "TrendingUp",
    defaultSpan: "XL",
    allowedSpans: ["L", "XL"],
  },
  {
    type: "bridge",
    label: "Économies par période → cible",
    icon: "BarChart3",
    defaultSpan: "XL",
    allowedSpans: ["L", "XL"],
  },
  {
    type: "sankey",
    label: "Flux des leviers par étape (Sankey)",
    icon: "GitBranch",
    // XL par défaut : ce flux chronologique a beaucoup plus de colonnes qu'un Sankey classique à
    // 2 niveaux — en dessous de "L" les libellés des différentes étapes se chevauchent.
    defaultSpan: "XL",
    allowedSpans: ["L", "XL"],
  },
  {
    type: "marimekko",
    label: "Marimekko",
    icon: "LayoutGrid",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
    viewOptions: [
      { key: "function-country", labelKey: "dashboard.widgetView.functionCountry" },
      { key: "workstream-project", labelKey: "dashboard.widgetView.workstreamProject" },
    ],
    defaultView: "function-country",
    // Marimekko = forme à 2 dimensions (primaire × secondaire) — le builder générique impose donc
    // exactement 2 dimensions choisies par l'utilisateur (voir lib/dashboardPivot.ts).
    builderDimensionCount: 2,
    defaultCustomViews: [
      {
        id: "function-country",
        metric: "realizedSavings",
        dimensions: ["function", "country"],
        label: "Fonction × Pays",
      },
      {
        id: "workstream-project",
        metric: "realizedSavings",
        dimensions: ["ws", "project"],
        label: "Workstream × Projet",
      },
    ],
  },
  {
    type: "workstream-breakdown",
    label: "Savings par Workstream / Projet",
    icon: "Columns3",
    defaultSpan: "M",
    allowedSpans: ["S", "M", "L", "XL"],
    viewOptions: [
      { key: "workstream", labelKey: "dashboard.workstream" },
      { key: "project", labelKey: "dashboard.project" },
    ],
    defaultView: "workstream",
    builderDimensionCount: 1,
    defaultCustomViews: [
      { id: "workstream", metric: "realizedSavings", dimensions: ["ws"], label: "Workstream" },
      { id: "project", metric: "realizedSavings", dimensions: ["project"], label: "Projet" },
    ],
  },
  {
    type: "geo-breakdown",
    label: "Savings par Pays / Fonction",
    icon: "PieChart",
    defaultSpan: "M",
    allowedSpans: ["S", "M", "L", "XL"],
    viewOptions: [
      { key: "country", labelKey: "dashboard.country" },
      { key: "function", labelKey: "dashboard.function" },
    ],
    defaultView: "country",
    builderDimensionCount: 1,
    defaultCustomViews: [
      { id: "country", metric: "realizedSavings", dimensions: ["country"], label: "Pays" },
      { id: "function", metric: "realizedSavings", dimensions: ["function"], label: "Fonction" },
    ],
  },
  {
    type: "workstream-table",
    label: "Synthèse des Workstreams",
    icon: "Table2",
    defaultSpan: "XL",
    allowedSpans: ["L", "XL"],
  },
  {
    type: "dependencies",
    label: "Dépendances inter-leviers",
    icon: "Link2",
    defaultSpan: "M",
    allowedSpans: ["S", "M", "L", "XL"],
  },
  {
    type: "pnl",
    label: "Impact P&L par compte",
    icon: "LineChart",
    defaultSpan: "M",
    allowedSpans: ["S", "M", "L", "XL"],
    // Pas de viewOptions legacy (ce widget n'avait qu'une seule vue câblée en dur avant ce
    // changement) — seul builderDimensionCount + defaultCustomViews existent, donc "configurable"
    // au sens du builder générique mais pas au sens de l'ancien mécanisme viewOptions.
    builderDimensionCount: 1,
    defaultCustomViews: [
      {
        id: "account",
        metric: "realizedSavings",
        dimensions: ["pnlAccount"],
        label: "Impact réalisé par compte P&L",
      },
    ],
    defaultView: "account",
  },
];

export function getWidgetDef(type: string): DashboardWidgetDef | undefined {
  return DASHBOARD_WIDGET_REGISTRY.find((w) => w.type === type);
}

/** Layout par défaut — reproduit exactement l'ordre et les tailles de l'ancien dashboard fixe,
 * pour que les utilisateurs qui n'entrent jamais en mode édition ne voient aucun changement. Les
 * widgets du builder générique (`builderDimensionCount` défini) reçoivent en plus leurs
 * `defaultCustomViews` pré-câblées (ex. Fonction×Pays du Marimekko) — mêmes vues qu'avant,
 * exprimées comme configurations métrique × dimension(s) plutôt que comme clés figées. */
export function buildDefaultLayout(): DashboardWidgetInstance[] {
  return DASHBOARD_WIDGET_REGISTRY.map((def) => ({
    instanceId: def.type,
    type: def.type,
    span: def.defaultSpan,
    ...(def.viewOptions
      ? { view: def.defaultView ?? def.viewOptions[0].key }
      : def.defaultView
        ? { view: def.defaultView }
        : {}),
    ...(def.defaultCustomViews ? { customViews: def.defaultCustomViews } : {}),
  }));
}

// ─── Helpers purs (déplacement, redimensionnement, ajout, suppression) ─────────────────────────

/** Déplace l'élément d'index `fromIndex` à la position `toIndex` (insertion avant cet index dans
 * le tableau résultant), sans muter le tableau d'origine. */
export function moveWidget<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    fromIndex >= list.length ||
    toIndex < 0 ||
    toIndex > list.length
  ) {
    return list;
  }
  const next = list.slice();
  const [moved] = next.splice(fromIndex, 1);
  const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
  next.splice(insertAt, 0, moved);
  return next;
}

/** Fait cycler une taille S -> M -> L -> XL -> S, en restant dans la liste `allowed` fournie
 * (saute les tailles non autorisées pour ce type de widget). */
export function cycleSpan(current: WidgetSpan, allowed: WidgetSpan[]): WidgetSpan {
  const pool = allowed.length > 0 ? allowed : WIDGET_SPANS;
  const order = WIDGET_SPANS;
  const startIdx = order.indexOf(current);
  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(startIdx + step) % order.length];
    if (pool.includes(candidate)) return candidate;
  }
  return current;
}

export function removeWidget(
  layout: DashboardWidgetInstance[],
  instanceId: string
): DashboardWidgetInstance[] {
  return layout.filter((w) => w.instanceId !== instanceId);
}

let instanceCounter = 0;

/** Génère un instanceId unique pour une nouvelle instance de widget — plusieurs instances du même
 * type doivent rester distinguables (déplacement, redimensionnement, suppression individuels). */
function nextInstanceId(type: DashboardWidgetType): string {
  instanceCounter += 1;
  return `${type}-${instanceCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Ajoute une nouvelle instance du widget `type` en fin de layout — les doublons sont autorisés
 * (ex. deux blocs Sankey séparés), à l'image d'un outil type PowerBI. `view` force la vue initiale
 * d'un widget configurable (ex. l'autre paire de dimensions du Marimekko, pour la distinguer visuellement
 * d'un doublon déjà présent) — sinon retombe sur `defaultView`. */
export function addWidget(
  layout: DashboardWidgetInstance[],
  type: DashboardWidgetType,
  view?: string
): DashboardWidgetInstance[] {
  const def = getWidgetDef(type);
  if (!def) return layout;
  return [
    ...layout,
    {
      instanceId: nextInstanceId(type),
      type: def.type,
      span: def.defaultSpan,
      ...(def.viewOptions
        ? { view: view ?? def.defaultView ?? def.viewOptions[0].key }
        : def.defaultView
          ? { view: view ?? def.defaultView }
          : {}),
      ...(def.defaultCustomViews ? { customViews: def.defaultCustomViews } : {}),
    },
  ];
}

function nextCustomViewId(): string {
  instanceCounter += 1;
  return `cv-${instanceCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Ajoute une nouvelle instance de widget du builder générique avec UNE SEULE vue construite par
 * l'utilisateur (métrique + dimension(s) choisies au moment de l'ajout — voir le flux "Ajouter
 * comme nouveau widget" de la page dashboard) — distinct de `addWidget`, qui n'ajoute que des
 * instances avec les vues pré-câblées du registre. */
export function addWidgetWithCustomView(
  layout: DashboardWidgetInstance[],
  type: DashboardWidgetType,
  config: { metric: string; dimensions: string[]; label?: string }
): DashboardWidgetInstance[] {
  const def = getWidgetDef(type);
  if (!def) return layout;
  const id = nextCustomViewId();
  const customView: CustomViewConfig = {
    id,
    metric: config.metric,
    dimensions: config.dimensions,
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

/** Ajoute une nouvelle vue construite (builder générique) à une instance EXISTANTE et bascule
 * immédiatement son affichage dessus — c'est le flux "Ajouter une vue à un widget existant"
 * (au lieu de dupliquer un nouveau bloc). Si l'instance n'a encore aucune `customViews` (layout
 * localStorage antérieur à cette fonctionnalité, ou widget dont les vues n'ont jamais été
 * matérialisées), les vues historiques `def.defaultCustomViews` sont d'abord matérialisées, pour
 * que le sélecteur continue de proposer les vues d'origine EN PLUS de la nouvelle plutôt que de
 * les perdre silencieusement. */
export function addCustomViewToInstance(
  layout: DashboardWidgetInstance[],
  instanceId: string,
  config: { metric: string; dimensions: string[]; label?: string }
): DashboardWidgetInstance[] {
  const id = nextCustomViewId();
  const newView: CustomViewConfig = {
    id,
    metric: config.metric,
    dimensions: config.dimensions,
    label: config.label,
  };
  return layout.map((w) => {
    if (w.instanceId !== instanceId) return w;
    const def = getWidgetDef(w.type);
    const existing =
      w.customViews && w.customViews.length > 0 ? w.customViews : (def?.defaultCustomViews ?? []);
    return { ...w, customViews: [...existing, newView], view: id };
  });
}

export function setWidgetSpan(
  layout: DashboardWidgetInstance[],
  instanceId: string,
  span: WidgetSpan
): DashboardWidgetInstance[] {
  return layout.map((w) => (w.instanceId === instanceId ? { ...w, span } : w));
}

/** Change la vue active d'une instance de widget configurable (ex. bascule Fonction×Pays <->
 * Workstream×Projet sur un Marimekko) — n'affecte que cette instance, jamais les autres du même
 * type. */
export function setWidgetView(
  layout: DashboardWidgetInstance[],
  instanceId: string,
  view: string
): DashboardWidgetInstance[] {
  return layout.map((w) => (w.instanceId === instanceId ? { ...w, view } : w));
}

// ─── Builder générique — résolution des vues effectives ────────────────────────────────────────

/** Vues effectivement disponibles pour une instance du builder générique : celles de l'instance
 * elle-même si elle en a (utilisateur les a construites, ou layout créé après cette
 * fonctionnalité), sinon repli sur `def.defaultCustomViews` (layout localStorage antérieur à
 * cette fonctionnalité — `view` legacy pointe alors directement vers l'une de ces clés, ex.
 * "function-country"). Tableau vide pour un type de widget hors builder générique. */
export function resolveCustomViews(instance: DashboardWidgetInstance): CustomViewConfig[] {
  if (instance.customViews && instance.customViews.length > 0) return instance.customViews;
  const def = getWidgetDef(instance.type);
  return def?.defaultCustomViews ?? [];
}

/** Vue active d'une instance du builder générique — celle dont l'id correspond à `instance.view`,
 * sinon la première vue disponible (jamais `undefined` tant qu'au moins une vue existe, pour
 * rester directement utilisable dans le rendu). */
export function resolveActiveCustomView(
  instance: DashboardWidgetInstance
): CustomViewConfig | undefined {
  const views = resolveCustomViews(instance);
  if (views.length === 0) return undefined;
  return views.find((v) => v.id === instance.view) ?? views[0];
}

// ─── Persistance localStorage ───────────────────────────────────────────────────────────────────

const LAYOUT_KEY = "betrack_dashboard_layout_v1";

const isBrowser = () => typeof window !== "undefined";

function isValidInstance(value: unknown): value is DashboardWidgetInstance {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.instanceId === "string" &&
    typeof v.type === "string" &&
    !!getWidgetDef(v.type) &&
    typeof v.span === "string" &&
    (WIDGET_SPANS as string[]).includes(v.span)
  );
}

function isValidCustomView(value: unknown): value is CustomViewConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.metric === "string" &&
    Array.isArray(v.dimensions) &&
    v.dimensions.length >= 1 &&
    v.dimensions.length <= 2 &&
    v.dimensions.every((d) => typeof d === "string") &&
    (v.label === undefined || typeof v.label === "string")
  );
}

/** Nettoie `customViews` d'une instance déjà validée par `isValidInstance` : un layout persisté
 * peut avoir été écrit par une version antérieure de l'app (champ absent, ce qui est le cas
 * normal — voir `resolveCustomViews` côté page dashboard pour le repli), ou contenir des entrées
 * mal formées suite à une corruption partielle. Plutôt que de rejeter l'INSTANCE entière (et donc
 * réinitialiser tout le layout de l'utilisateur) pour un souci localisé à `customViews`, on ne
 * filtre que les entrées invalides — traite les champs non reconnus comme absents, dans le même
 * esprit défensif que le reste de cette fonction. */
function withoutCustomViews(instance: DashboardWidgetInstance): DashboardWidgetInstance {
  const rest: DashboardWidgetInstance = { ...instance };
  delete rest.customViews;
  return rest;
}

function sanitizeInstance(instance: DashboardWidgetInstance): DashboardWidgetInstance {
  const raw = (instance as { customViews?: unknown }).customViews;
  if (!Array.isArray(raw)) {
    return raw === undefined ? instance : withoutCustomViews(instance);
  }
  const cleaned = raw.filter(isValidCustomView);
  return cleaned.length === 0
    ? withoutCustomViews(instance)
    : { ...instance, customViews: cleaned };
}

/** Charge le layout personnalisé depuis localStorage. Retombe sur le layout par défaut si absent,
 * corrompu, ou si son contenu ne correspond plus au registre actuel (ex. widget renommé/retiré).
 * `customViews` de chaque instance est en plus assaini (voir `sanitizeInstance`) — un layout
 * antérieur à cette fonctionnalité (champ absent) ou une entrée `customViews` mal formée ne fait
 * jamais échouer le chargement global. */
export function loadDashboardLayout(): DashboardWidgetInstance[] {
  if (!isBrowser()) return buildDefaultLayout();
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (!raw) return buildDefaultLayout();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isValidInstance)) {
      return buildDefaultLayout();
    }
    return (parsed as DashboardWidgetInstance[]).map(sanitizeInstance);
  } catch {
    return buildDefaultLayout();
  }
}

export function saveDashboardLayout(layout: DashboardWidgetInstance[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch (err) {
    console.error(
      "[betrack storage] échec d'écriture localStorage pour le layout dashboard :",
      err
    );
  }
}
