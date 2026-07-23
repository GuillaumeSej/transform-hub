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

export interface DashboardWidgetDef {
  type: DashboardWidgetType;
  /** Libellé humain (français) affiché dans le menu "Ajouter un widget". */
  label: string;
  defaultSpan: WidgetSpan;
  /** Tailles autorisées pour ce widget — certains graphiques n'ont pas de sens trop étroits. */
  allowedSpans: WidgetSpan[];
}

/** Une instance de widget posée sur le dashboard — un même type peut être ajouté plusieurs fois
 * (ex. comparer le même graphique Sankey filtré différemment), d'où l'instanceId distinct du
 * type. */
export interface DashboardWidgetInstance {
  instanceId: string;
  type: DashboardWidgetType;
  span: WidgetSpan;
}

/** Registre de tous les widgets disponibles, dans leur ordre d'apparition par défaut. */
export const DASHBOARD_WIDGET_REGISTRY: DashboardWidgetDef[] = [
  {
    type: "stage-funnel",
    label: "Avancement par étape du cycle de vie",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "alerts",
    label: "Alerts & Notifications",
    defaultSpan: "M",
    allowedSpans: ["S", "M", "L", "XL"],
  },
  {
    type: "best-practices",
    label: "Bonnes pratiques",
    defaultSpan: "XL",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "s-curve",
    label: "S-Curve — Plan initial / Réalisé / Réactualisé",
    defaultSpan: "XL",
    allowedSpans: ["L", "XL"],
  },
  {
    type: "bridge",
    label: "Économies par période → cible",
    defaultSpan: "XL",
    allowedSpans: ["L", "XL"],
  },
  {
    type: "sankey",
    label: "Flux des leviers par étape (Sankey)",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "marimekko",
    label: "Savings par fonction (Marimekko)",
    defaultSpan: "M",
    allowedSpans: ["M", "L", "XL"],
  },
  {
    type: "workstream-breakdown",
    label: "Savings par Workstream / Projet",
    defaultSpan: "M",
    allowedSpans: ["S", "M", "L", "XL"],
  },
  {
    type: "geo-breakdown",
    label: "Savings par Pays / Fonction",
    defaultSpan: "M",
    allowedSpans: ["S", "M", "L", "XL"],
  },
  {
    type: "workstream-table",
    label: "Synthèse des Workstreams",
    defaultSpan: "XL",
    allowedSpans: ["L", "XL"],
  },
  {
    type: "dependencies",
    label: "Dépendances inter-leviers",
    defaultSpan: "M",
    allowedSpans: ["S", "M", "L", "XL"],
  },
  {
    type: "pnl",
    label: "Impact P&L par compte",
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
 * (ex. comparer deux fois le même graphique avec des filtres différents), à l'image d'un outil
 * type PowerBI. */
export function addWidget(
  layout: DashboardWidgetInstance[],
  type: DashboardWidgetType
): DashboardWidgetInstance[] {
  const def = getWidgetDef(type);
  if (!def) return layout;
  return [...layout, { instanceId: nextInstanceId(type), type: def.type, span: def.defaultSpan }];
}

export function setWidgetSpan(
  layout: DashboardWidgetInstance[],
  instanceId: string,
  span: WidgetSpan
): DashboardWidgetInstance[] {
  return layout.map((w) => (w.instanceId === instanceId ? { ...w, span } : w));
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
