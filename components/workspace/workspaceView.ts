/**
 * Helpers PURS de présentation du portail « Mon espace » (`/me`) — aucune logique métier ici
 * (l'agrégation vit dans `lib/myWorkspace.ts`) : filtrage par plan, répartition par catégorie
 * (barre 100 % cliquable + filtre de page), compteurs,
 * phrase de synthèse de l'en-tête et regroupement « À venir » par semaine. Testés dans
 * `components/workspace/__tests__/workspaceView.test.ts`.
 */
import type {
  MyWorkspace,
  WorkspaceItem,
  WorkspacePlan,
  WorkspaceSeverity,
} from "@/lib/myWorkspaceTypes";

export type Translate = (key: string, fallback?: string) => string;

export type PlanFilter = "all" | WorkspacePlan;

/** Plans effectivement présents dans le portail (toutes listes confondues) — le filtre par plan
 *  n'est proposé que si les DEUX y figurent. */
export function presentPlans(workspace: MyWorkspace): WorkspacePlan[] {
  const plans = new Set<WorkspacePlan>();
  for (const list of [workspace.todo, workspace.upcoming, workspace.blocked, workspace.perimeter]) {
    for (const entry of list) plans.add(entry.plan);
  }
  return (["strategic", "performance"] as const).filter((p) => plans.has(p));
}

/** Applique le filtre par plan à toutes les listes du portail. */
export function filterWorkspaceByPlan(workspace: MyWorkspace, plan: PlanFilter): MyWorkspace {
  if (plan === "all") return workspace;
  return {
    ...workspace,
    todo: workspace.todo.filter((i) => i.plan === plan),
    upcoming: workspace.upcoming.filter((i) => i.plan === plan),
    blocked: workspace.blocked.filter((i) => i.plan === plan),
    perimeter: workspace.perimeter.filter((p) => p.plan === plan),
  };
}

export function isLate(item: WorkspaceItem): boolean {
  return (item.daysLate ?? 0) > 0;
}

/** « En retard » au sens du portail (bande de répartition, filtre, phrase d'en-tête) : élément
 *  « À faire » dont l'échéance est DÉPASSÉE (`daysLate > 0`) uniquement — même définition que le
 *  texte « en retard de N j » de la ligne, pour que le chiffre rouge et les lignes concordent. Un
 *  élément `critical` sans échéance dépassée (ex. validation en attente > 7 j) reste « À traiter ». */
export function isOverdue(item: WorkspaceItem): boolean {
  return isLate(item);
}

export type WorkspaceCounts = { todo: number; late: number; upcoming: number; blocked: number };

export function workspaceCounts(workspace: MyWorkspace): WorkspaceCounts {
  return {
    todo: workspace.todo.length,
    late: workspace.todo.filter(isOverdue).length,
    upcoming: workspace.upcoming.length,
    blocked: workspace.blocked.length,
  };
}

// ─── Répartition par catégorie (barre 100 % + filtre de page) ────────────────────────────────────

/** Catégories DISJOINTES du portail :
 *  - `overdue`  = « À faire » en retard (`isOverdue`) ;
 *  - `toHandle` = le reste de « À faire » ;
 *  - `upcoming` = « À venir » ;
 *  - `blocked`  = « Bloqué chez d'autres » — vue pilotage uniquement. */
export type WorkspaceCategory = "overdue" | "toHandle" | "upcoming" | "blocked";

export const CATEGORY_ORDER: WorkspaceCategory[] = ["overdue", "toHandle", "upcoming", "blocked"];

/** Catégories proposées pour ce portail (`blocked` n'existe qu'en vue pilotage). */
export function availableCategories(
  workspace: Pick<MyWorkspace, "pilotView">
): WorkspaceCategory[] {
  return workspace.pilotView ? CATEGORY_ORDER : CATEGORY_ORDER.filter((c) => c !== "blocked");
}

export type TodoCategory = Extract<WorkspaceCategory, "overdue" | "toHandle">;

/** Filtre les éléments « À faire » sur une sous-catégorie (`null` = tous). */
export function filterTodoItems(
  items: WorkspaceItem[],
  category: TodoCategory | null
): WorkspaceItem[] {
  if (category === "overdue") return items.filter(isOverdue);
  if (category === "toHandle") return items.filter((i) => !isOverdue(i));
  return items;
}

/** Éléments d'une catégorie (listes disjointes : un élément n'appartient qu'à une catégorie). */
export function itemsOfCategory(
  workspace: MyWorkspace,
  category: WorkspaceCategory
): WorkspaceItem[] {
  switch (category) {
    case "overdue":
    case "toHandle":
      return filterTodoItems(workspace.todo, category);
    case "upcoming":
      return workspace.upcoming;
    case "blocked":
      return workspace.pilotView ? workspace.blocked : [];
  }
}

export type CategoryPart = { category: WorkspaceCategory; count: number; pct: number };

/** Répartition affichée par la barre : une part par catégorie disponible (zéros inclus, la vue
 *  les masque dans la barre), `total` = somme des parts, `pct` entiers sommant à 100. */
export function workspaceBreakdown(workspace: MyWorkspace): {
  total: number;
  parts: CategoryPart[];
} {
  const categories = availableCategories(workspace);
  const counts = categories.map((c) => itemsOfCategory(workspace, c).length);
  const total = counts.reduce((s, n) => s + n, 0);
  const pcts = roundedPercents(counts, total);
  return {
    total,
    parts: categories.map((category, i) => ({ category, count: counts[i], pct: pcts[i] })),
  };
}

/** Pourcentages entiers sommant à 100 (méthode du plus fort reste) ; tous à 0 si `total` = 0. */
export function roundedPercents(counts: number[], total: number): number[] {
  if (total <= 0) return counts.map(() => 0);
  const raw = counts.map((c) => (c / total) * 100);
  const floors = raw.map(Math.floor);
  let rest = 100 - floors.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i] += 1;
    rest -= 1;
  }
  return floors;
}

/** Filtre de catégorie effectif : `blocked` hors vue pilotage est ignoré. */
export function effectiveCategory(
  category: WorkspaceCategory | null,
  workspace: Pick<MyWorkspace, "pilotView">
): WorkspaceCategory | null {
  if (category === "blocked" && !workspace.pilotView) return null;
  return category;
}

export type WorkspaceSectionKey = "todo" | "upcoming" | "blocked";

/** Blocs de liste affichés selon le filtre de catégorie (`null` = tous ; « Bloqué » seulement en
 *  vue pilotage). Le périmètre, lui, reste toujours affiché. */
export function visibleSections(
  category: WorkspaceCategory | null,
  workspace: Pick<MyWorkspace, "pilotView">
): WorkspaceSectionKey[] {
  const c = effectiveCategory(category, workspace);
  if (c === "overdue" || c === "toHandle") return ["todo"];
  if (c === "upcoming") return ["upcoming"];
  if (c === "blocked") return ["blocked"];
  return workspace.pilotView ? ["todo", "blocked", "upcoming"] : ["todo", "upcoming"];
}

/** Libellé d'une catégorie (légende, info-bulle, puce de filtre). */
export function categoryLabel(category: WorkspaceCategory, t: Translate): string {
  switch (category) {
    case "overdue":
      return t("me.category.overdue", "En retard");
    case "toHandle":
      return t("me.category.toHandle", "À traiter");
    case "upcoming":
      return t("me.category.upcoming", "À venir");
    case "blocked":
      return t("me.category.blocked", "Bloqué chez d'autres");
  }
}

const fill = (template: string, n: number) => template.replace("{n}", String(n));

/** Phrase de synthèse de l'en-tête, ex. « 3 actions à faire, dont 1 en retard · 5 échéances dans
 *  les 4 prochaines semaines ». `t` injecté pour rester pur/testable. */
export function summarySentence(counts: WorkspaceCounts, t: Translate): string {
  if (counts.todo === 0 && counts.upcoming === 0) {
    return t("me.summary.nothing", "Aucune action en attente ni échéance proche.");
  }
  const todoPart =
    counts.todo === 0
      ? t("me.summary.todoNone", "Aucune action à faire")
      : fill(
          counts.todo === 1
            ? t("me.summary.todoOne", "{n} action à faire")
            : t("me.summary.todoMany", "{n} actions à faire"),
          counts.todo
        ) +
        (counts.late > 0 ? fill(t("me.summary.late", ", dont {n} en retard"), counts.late) : "");
  const upcomingPart =
    counts.upcoming === 0
      ? t("me.summary.upcomingNone", "aucune échéance dans les 4 prochaines semaines")
      : fill(
          counts.upcoming === 1
            ? t("me.summary.upcomingOne", "{n} échéance dans les 4 prochaines semaines")
            : t("me.summary.upcomingMany", "{n} échéances dans les 4 prochaines semaines"),
          counts.upcoming
        );
  return `${todoPart} · ${upcomingPart}`;
}

/** Prénom à afficher dans le message d'accueil : `firstName`, sinon 1er mot de `name`. */
export function greetingName(
  user: { firstName?: string | null; name?: string | null } | null | undefined
): string {
  const first = user?.firstName?.trim();
  if (first) return first;
  return user?.name?.trim().split(/\s+/)[0] ?? "";
}

export const SEVERITY_ORDER: WorkspaceSeverity[] = ["critical", "warning", "info"];

/** Regroupe les éléments « À faire » par gravité, en conservant l'ordre du moteur dans chaque
 *  groupe ; les groupes vides sont omis. */
export function groupBySeverity(
  items: WorkspaceItem[]
): { severity: WorkspaceSeverity; items: WorkspaceItem[] }[] {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    items: items.filter((i) => i.severity === severity),
  })).filter((g) => g.items.length > 0);
}

/** Parse `YYYY-MM-DD` en date LOCALE (minuit), `null` si invalide. */
export function parseIsoDay(iso: string | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Lundi (minuit local) de la semaine de `d`. */
function mondayOf(d: Date): Date {
  const day = (d.getDay() + 6) % 7; // 0 = lundi
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
}

const DAY_MS = 86_400_000;

/** Nombre de semaines calendaires (lundi → dimanche) entre `today` et `date` : 0 = cette semaine,
 *  1 = semaine prochaine… Négatif si la date est dans une semaine passée. */
export function weekOffset(date: Date, today: Date): number {
  // Math.round absorbe le décalage d'une heure des changements d'heure (DST).
  return Math.round((mondayOf(date).getTime() - mondayOf(today).getTime()) / (7 * DAY_MS));
}

export type WeekGroup = {
  /** Décalage en semaines (0 = cette semaine) ; `null` = sans échéance exploitable. */
  offset: number | null;
  items: WorkspaceItem[];
};

/** Regroupe « À venir » par semaine calendaire, groupes triés chronologiquement (les éléments
 *  en semaine passée sont rattachés à « cette semaine » ; sans date valide → dernier groupe). */
export function groupByWeek(items: WorkspaceItem[], today: Date): WeekGroup[] {
  const byOffset = new Map<number | null, WorkspaceItem[]>();
  for (const item of items) {
    const d = parseIsoDay(item.dueDate);
    const offset = d ? Math.max(0, weekOffset(d, today)) : null;
    const bucket = byOffset.get(offset) ?? [];
    bucket.push(item);
    byOffset.set(offset, bucket);
  }
  return Array.from(byOffset.entries())
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b))
    .map(([offset, list]) => ({
      offset,
      items: [...list].sort((x, y) => (x.dueDate ?? "").localeCompare(y.dueDate ?? "")),
    }));
}

/** Libellé d'un groupe de semaines. */
export function weekLabel(offset: number | null, t: Translate): string {
  if (offset === null) return t("me.week.noDate", "Sans échéance");
  if (offset === 0) return t("me.week.this", "Cette semaine");
  if (offset === 1) return t("me.week.next", "Semaine prochaine");
  return fill(t("me.week.inN", "Dans {n} semaines"), offset);
}
