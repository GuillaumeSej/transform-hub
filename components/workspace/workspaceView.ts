/**
 * Helpers PURS de présentation du portail « Mon espace » (`/me`) — aucune logique métier ici
 * (l'agrégation vit dans `lib/myWorkspace.ts`) : filtrage par plan, compteurs de la bande KPI,
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

export type WorkspaceCounts = { todo: number; late: number; upcoming: number; blocked: number };

export function workspaceCounts(workspace: MyWorkspace): WorkspaceCounts {
  return {
    todo: workspace.todo.length,
    late: workspace.todo.filter(isLate).length,
    upcoming: workspace.upcoming.length,
    blocked: workspace.blocked.length,
  };
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
