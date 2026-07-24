/**
 * Registre des widgets du dashboard exécutif + modèle de mise en page ("layout") éditable par
 * l'utilisateur. Ceci est une customisation d'affichage PERSONNELLE (par navigateur), pas une
 * donnée d'entreprise : elle vit en localStorage, suivant le même pattern que `lib/storage.ts`
 * (clé préfixée `betrack_`, JSON-sérialisée, lecture/écriture protégées par `isBrowser()`).
 *
 * Décision de scope : la ligne de KPI, l'en-tête (titre, import/export Excel, sélecteur de
 * scénario) et la barre de filtres restent EN DEHORS de ce système — ce sont des éléments de
 * chrome fixes, pas des "graphiques" repositionnables. Tout le reste de l'ancien layout fixe du
 * dashboard (funnel, alertes, bonnes pratiques, S-Curve, bridge, sankey, marimekko, ventilations,
 * table de synthèse, dépendances, P&L) devient un widget de ce registre.
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
  | "best-practices"
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

export interface DashboardWidgetDef {
  type: DashboardWidgetType;
  /** Clé i18n du libellé affiché dans le menu "Ajouter un widget" (fallback = libellé FR brut). */
  label: string;
  /** Nom d'icône lucide-react utilisé comme illustration dans le sélecteur de widgets. */
  icon: string;
  defaultSpan: WidgetSpan;
  /** Tailles autorisées pour ce widget — certains graphiques n'ont pas de sens trop étroits. */
  allowedSpans: WidgetSpan[];
  /** Widget "configurable" : le TYPE de graphique (ex. Marimekko) est distinct de l'INDICATEUR/
   *  dimension affiché (ex. Fonction×Pays vs Workstream×Projet) — l'utilisateur choisit d'abord le
   *  graphique, puis peut basculer entre les vues possibles via un sélecteur intégré au widget,
   *  sans avoir à ajouter un nouveau bloc. Non configurable = graphique à contenu fixe (S-Curve,
   *  Sankey, alertes...). */
  viewOptions?: WidgetViewOption[];
  /** Vue active par défaut à la création d'une instance — première entrée de `viewOptions` si
   *  omis. */
  defaultView?: string;
}

/** Une instance de widget posée sur le dashboard — un même type peut être ajouté plusieurs fois
 * (ex. deux blocs Sankey séparés), d'où l'instanceId distinct du type. `view` porte la vue active
 * pour les widgets configurables (ex. quelle paire de dimensions du Marimekko) — elle vit sur
 * l'INSTANCE, pas sur un état de page partagé, pour que deux instances du même type puissent
 * chacune afficher une vue différente sans interférer l'une avec l'autre. */
export interface DashboardWidgetInstance {
  instanceId: string;
  type: DashboardWidgetType;
  span: WidgetSpan;
  view?: string;
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
    type: "best-practices",
    label: "Bonnes pratiques",
    icon: "ShieldCheck",
    defaultSpan: "XL",
    allowedSpans: ["M", "L", "XL"],
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
  },
];

export function getWidgetDef(type: string): DashboardWidgetDef | undefined {
  return DASHBOARD_WIDGET_REGISTRY.find((w) => w.type === type);
}

/** Layout par défaut — reproduit exactement l'ordre et les tailles de l'ancien dashboard fixe,
 * pour que les utilisateurs qui n'entrent jamais en mode édition ne voient aucun changement. */
export function buildDefaultLayout(): DashboardWidgetInstance[] {
  return DASHBOARD_WIDGET_REGISTRY.map((def) => ({
    instanceId: def.type,
    type: def.type,
    span: def.defaultSpan,
    ...(def.viewOptions ? { view: def.defaultView ?? def.viewOptions[0].key } : {}),
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
      ...(def.viewOptions ? { view: view ?? def.defaultView ?? def.viewOptions[0].key } : {}),
    },
  ];
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

/** Charge le layout personnalisé depuis localStorage. Retombe sur le layout par défaut si absent,
 * corrompu, ou si son contenu ne correspond plus au registre actuel (ex. widget renommé/retiré). */
export function loadDashboardLayout(): DashboardWidgetInstance[] {
  if (!isBrowser()) return buildDefaultLayout();
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (!raw) return buildDefaultLayout();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isValidInstance)) {
      return buildDefaultLayout();
    }
    return parsed as DashboardWidgetInstance[];
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
