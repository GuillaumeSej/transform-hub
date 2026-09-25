"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/shared/Card";
import { ProgressBar } from "@/components/shared/ProgressBar";
import type {
  MyWorkspace,
  WorkspaceItem,
  WorkspacePerimeterEntry,
  WorkspaceSeverity,
} from "@/lib/myWorkspaceTypes";
import {
  categoryLabel,
  filterTodoItems,
  groupBySeverity,
  groupByWeek,
  isLate,
  parseIsoDay,
  weekLabel,
  workspaceBreakdown,
  type CategoryPart,
  type TodoCategory,
  type Translate,
  type WorkspaceCategory,
} from "@/components/workspace/workspaceView";
import {
  EmptyState,
  FilterChip,
  HealthDot,
  RowChevron,
  PlanBadge,
  RowButton,
  SectionHeader,
  SourceIcon,
  shortDate,
} from "@/components/workspace/WorkspaceParts";
import { formatDate } from "@/lib/format";

type Navigate = (href: string) => void;

const fill = (template: string, n: number) => template.replace("{n}", String(n));

// ─── Répartition (barre 100 % empilée + tuiles-légende) ─────────────────────────────────────────

/** Couleur par catégorie (tokens RAG / neutres de la charte). */
const CATEGORY_FILL: Record<WorkspaceCategory, string> = {
  overdue: "bg-rag-red",
  toHandle: "bg-rag-amber",
  upcoming: "bg-info-blue",
  blocked: "bg-neutral-700",
};

/**
 * Bandeau de tête de « Mon espace » : UN total (« N éléments ») et sa répartition en barre 100 %
 * empilée par catégorie DISJOINTE (`workspaceBreakdown` — la somme des segments = le total), puis
 * une tuile-légende par catégorie (libellé · nombre · %). Segment, tuile : même action = filtrer
 * la page sur cette catégorie (re-clic sur la catégorie active = retirer le filtre).
 * « Bloqué chez d'autres » n'existe qu'en vue pilotage.
 */
export function WorkspaceBreakdown({
  workspace,
  active,
  onSelect,
  t,
}: {
  workspace: MyWorkspace;
  active: WorkspaceCategory | null;
  onSelect: (category: WorkspaceCategory | null) => void;
  t: Translate;
}) {
  const { total, parts } = workspaceBreakdown(workspace);
  const shown = parts.filter((p) => p.count > 0);
  const toggle = (c: WorkspaceCategory) => onSelect(active === c ? null : c);
  const tip = (p: CategoryPart) =>
    t("me.breakdown.segmentTip", "{label} : {n} ({pct} %) — cliquer pour filtrer")
      .replace("{label}", categoryLabel(p.category, t))
      .replace("{n}", String(p.count))
      .replace("{pct}", String(p.pct));

  return (
    <section className="mb-5 border border-border bg-white p-4 shadow-sm sm:px-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[24px] font-bold leading-none tracking-tight text-primary tabular-nums">
            {total}
          </span>
          <span className="text-[13px] font-semibold text-primary">
            {total === 1
              ? t("me.breakdown.itemsOne", "élément")
              : t("me.breakdown.itemsMany", "éléments")}
          </span>
          <span className="text-[11px] text-tertiary">
            {t("me.breakdown.hint", "Cliquez sur une catégorie pour filtrer la page.")}
          </span>
        </div>
        {active && (
          <FilterChip label={categoryLabel(active, t)} onClear={() => onSelect(null)} t={t} />
        )}
      </div>

      <div
        className="mt-3 flex h-3.5 w-full gap-px bg-neutral-100"
        role="group"
        aria-label={t("me.breakdown.aria", "Répartition de vos éléments par catégorie")}
      >
        {shown.map((p, i) => {
          const label = tip(p);
          return (
            <button
              key={p.category}
              type="button"
              onClick={() => toggle(p.category)}
              aria-label={label}
              aria-pressed={active === p.category}
              style={{ flexGrow: p.count, flexBasis: 0 }}
              className={cn(
                "group/seg relative min-w-[6px] cursor-pointer transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-black",
                CATEGORY_FILL[p.category],
                active && active !== p.category && "opacity-30"
              )}
            >
              <span
                role="tooltip"
                className={cn(
                  "pointer-events-none absolute bottom-full z-20 mb-2 whitespace-nowrap bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-white opacity-0 shadow-md transition group-hover/seg:opacity-100 group-focus-visible/seg:opacity-100",
                  i === 0
                    ? "left-0"
                    : i === shown.length - 1
                      ? "right-0"
                      : "left-1/2 -translate-x-1/2"
                )}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>

      <ul
        className={cn(
          "mt-3 grid grid-cols-2 gap-2",
          parts.length === 4 ? "lg:grid-cols-4" : "sm:grid-cols-3"
        )}
      >
        {parts.map((p) => {
          const isActive = active === p.category;
          return (
            <li key={p.category}>
              <button
                type="button"
                onClick={() => toggle(p.category)}
                aria-pressed={isActive}
                title={tip(p)}
                className={cn(
                  "group flex w-full cursor-pointer items-center gap-2.5 border px-3 py-2 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-bp-coral",
                  isActive
                    ? "border-bp-coral bg-bp-coral/5"
                    : "border-border hover:border-strong hover:bg-neutral-100"
                )}
              >
                <span aria-hidden className={cn("h-8 w-1.5 shrink-0", CATEGORY_FILL[p.category])} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10px] font-bold uppercase tracking-widest text-tertiary">
                    {categoryLabel(p.category, t)}
                  </span>
                  <span className="mt-0.5 flex items-baseline gap-1.5">
                    <span
                      className={cn(
                        "text-[20px] font-bold leading-none tracking-tight tabular-nums",
                        p.category === "overdue" && p.count > 0 ? "text-rag-red" : "text-primary"
                      )}
                    >
                      {p.count}
                    </span>
                    <span className="text-[11px] tabular-nums text-tertiary">· {p.pct} %</span>
                  </span>
                </span>
                {isActive ? (
                  <X size={14} aria-hidden="true" className="shrink-0 text-bp-coral" />
                ) : (
                  <RowChevron />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── À faire ────────────────────────────────────────────────────────────────────────────────────

function dueLabel(item: WorkspaceItem, t: Translate): { text: string; late: boolean } | null {
  if (isLate(item)) {
    return { text: fill(t("me.due.late", "en retard de {n} j"), item.daysLate ?? 0), late: true };
  }
  if (item.dueDate) {
    return {
      text: t("me.due.on", "échéance {date}").replace("{date}", shortDate(item.dueDate)),
      late: false,
    };
  }
  return null;
}

function severityGroupLabel(severity: WorkspaceSeverity, t: Translate): string {
  if (severity === "critical") return t("me.severity.critical", "Urgent");
  if (severity === "warning") return t("me.severity.warning", "À traiter");
  return t("me.severity.info", "À suivre");
}

/** Props communes aux blocs filtrables : filtre de catégorie actif sur ce bloc (puce + surlignage). */
type FilterProps = {
  /** Libellé du filtre actif ciblant ce bloc, `null` sinon. */
  filterLabel?: string | null;
  onClearFilter?: () => void;
};

function filterActions(
  { filterLabel, onClearFilter }: FilterProps,
  t: Translate
): ReactNode | undefined {
  return filterLabel && onClearFilter ? (
    <FilterChip label={filterLabel} onClear={onClearFilter} t={t} />
  ) : undefined;
}

const HIGHLIGHT = "ring-2 ring-bp-coral";

export function TodoSection({
  items,
  category,
  navigate,
  t,
  ...filter
}: {
  items: WorkspaceItem[];
  /** Sous-catégorie filtrée (« En retard » / « À traiter »), `null` = tout « À faire ». */
  category: TodoCategory | null;
  navigate: Navigate;
  t: Translate;
} & FilterProps) {
  const visible = filterTodoItems(items, category);
  const groups = groupBySeverity(visible);
  return (
    <Card className={cn(filter.filterLabel && HIGHLIGHT)}>
      <SectionHeader
        title={
          category
            ? `${t("me.todo.title", "À faire")} · ${categoryLabel(category, t)}`
            : t("me.todo.title", "À faire")
        }
        count={visible.length}
        actions={filterActions(filter, t)}
      />
      {groups.length === 0 ? (
        <EmptyState
          title={
            category === "overdue"
              ? t("me.todo.emptyLate", "Aucune action en retard.")
              : category === "toHandle"
                ? t("me.todo.emptyToHandle", "Aucune autre action à traiter.")
                : t("me.todo.empty", "Rien à faire pour le moment.")
          }
          hint={category === null ? t("me.todo.emptyHint", "Vous êtes à jour.") : undefined}
        />
      ) : (
        groups.map((group) => (
          <div key={group.severity}>
            <div className="border-b border-border bg-neutral-50 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-tertiary sm:px-[18px]">
              {severityGroupLabel(group.severity, t)}
            </div>
            <ul className="divide-y divide-border">
              {group.items.map((item) => {
                const due = dueLabel(item, t);
                return (
                  <li key={item.id}>
                    <RowButton onClick={() => navigate(item.href)}>
                      <SourceIcon source={item.source} severity={item.severity} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-primary">
                          {item.title}
                        </div>
                        {item.context && (
                          <div className="truncate text-[11px] text-secondary">{item.context}</div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <PlanBadge plan={item.plan} t={t} />
                        {due && (
                          <span
                            className={cn(
                              "whitespace-nowrap text-[11px]",
                              due.late ? "font-semibold text-rag-red" : "text-tertiary"
                            )}
                          >
                            {due.text}
                          </span>
                        )}
                      </div>
                    </RowButton>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </Card>
  );
}

// ─── Bloqué chez d'autres (vue pilotage) ────────────────────────────────────────────────────────

/** Aussi rendu par l'onglet « En attente chez d'autres » de la page Validation
 *  (app/(app)/validation/page.tsx), qui surcharge `title` / `subtitle` / `emptyLabel`. */
export function BlockedSection({
  items,
  navigate,
  t,
  title,
  subtitle,
  emptyLabel,
  ...filter
}: {
  items: WorkspaceItem[];
  navigate: Navigate;
  t: Translate;
  title?: string;
  subtitle?: string;
  emptyLabel?: string;
} & FilterProps) {
  return (
    <Card className={cn(filter.filterLabel && HIGHLIGHT)}>
      <SectionHeader
        title={title ?? t("me.blocked.title", "Bloqué chez d'autres")}
        count={items.length}
        subtitle={
          subtitle ??
          t(
            "me.blocked.subtitle",
            "Vue par exception : validations en attente chez un autre acteur depuis plus de 7 jours."
          )
        }
        actions={filterActions(filter, t)}
      />
      {items.length === 0 ? (
        <EmptyState title={emptyLabel ?? t("me.blocked.empty", "Aucune validation bloquée.")} />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id}>
              <RowButton onClick={() => navigate(item.href)}>
                <SourceIcon source={item.source} severity={item.severity} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-primary">
                    {item.title}
                  </div>
                  <div className="truncate text-[11px] text-secondary">
                    {[
                      item.waitingOn &&
                        t("me.blocked.waitingOn", "chez {who}").replace("{who}", item.waitingOn),
                      item.context,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <PlanBadge plan={item.plan} t={t} />
                  {item.waitingDays !== undefined && (
                    <span className="whitespace-nowrap text-[11px] font-semibold text-bp-warm-brown">
                      {fill(t("me.blocked.since", "depuis {n} j"), item.waitingDays)}
                    </span>
                  )}
                </div>
              </RowButton>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── À venir ────────────────────────────────────────────────────────────────────────────────────

export function UpcomingSection({
  items,
  today,
  navigate,
  t,
  ...filter
}: {
  items: WorkspaceItem[];
  today: Date;
  navigate: Navigate;
  t: Translate;
} & FilterProps) {
  const groups = groupByWeek(items, today);
  return (
    <Card className={cn(filter.filterLabel && HIGHLIGHT)}>
      <SectionHeader
        title={t("me.upcoming.title", "À venir")}
        count={items.length}
        subtitle={t("me.upcoming.subtitle", "Échéances des 4 prochaines semaines")}
        actions={filterActions(filter, t)}
      />
      {groups.length === 0 ? (
        <EmptyState
          title={t("me.upcoming.empty", "Aucune échéance dans les 4 prochaines semaines.")}
        />
      ) : (
        <div className="px-4 py-3 sm:px-[18px]">
          {groups.map((group) => (
            <div key={group.offset ?? "none"} className="mb-3 last:mb-0">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-tertiary">
                {weekLabel(group.offset, t)}
              </div>
              <ol className="border-l border-border">
                {group.items.map((item) => {
                  const d = parseIsoDay(item.dueDate);
                  return (
                    <li key={item.id} className="relative">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute -left-[4px] top-3 h-[7px] w-[7px] rounded-full",
                          item.severity === "critical"
                            ? "bg-rag-red"
                            : item.severity === "warning"
                              ? "bg-rag-amber"
                              : "bg-neutral-400"
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => navigate(item.href)}
                        className="group flex w-full cursor-pointer items-start gap-2.5 py-1.5 pl-3 pr-1 text-left transition hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bp-coral"
                      >
                        <span className="w-12 shrink-0 pt-px text-[11px] font-semibold text-secondary">
                          {d ? formatDate(d, { weekday: "short", day: "numeric" }) : "—"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold text-primary">
                            {item.title}
                          </span>
                          {item.context && (
                            <span className="block truncate text-[11px] text-tertiary">
                              {item.context}
                            </span>
                          )}
                        </span>
                        <PlanBadge plan={item.plan} t={t} />
                        <RowChevron />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Mon périmètre ──────────────────────────────────────────────────────────────────────────────

export function PerimeterSection({
  entries,
  pilotView,
  navigate,
  t,
}: {
  entries: WorkspacePerimeterEntry[];
  pilotView: boolean;
  navigate: Navigate;
  t: Translate;
}) {
  return (
    <Card>
      <SectionHeader
        title={t("me.perimeter.title", "Mon périmètre")}
        count={entries.length}
        subtitle={
          pilotView
            ? t("me.perimeter.subtitlePilot", "Santé de chacun de vos programmes")
            : t("me.perimeter.subtitle", "Les objets sur lesquels vous avez un rôle")
        }
      />
      {entries.length === 0 ? (
        <EmptyState title={t("me.perimeter.empty", "Aucun objet rattaché à votre profil.")} />
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((entry) => (
            <li key={`${entry.kind}:${entry.id}`}>
              <RowButton onClick={() => navigate(entry.href)} className="items-start">
                <span className="pt-1">
                  <HealthDot health={entry.health} t={t} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-primary">
                      {entry.label}
                    </span>
                    <PlanBadge plan={entry.plan} t={t} />
                  </div>
                  <div className="truncate text-[11px] text-tertiary">{entry.role}</div>
                  {entry.progressPct !== undefined && (
                    <ProgressBar pct={Math.round(entry.progressPct)} className="mt-1.5" />
                  )}
                </div>
              </RowButton>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Squelette de chargement ────────────────────────────────────────────────────────────────────

export function SkeletonCard({ rows }: { rows: number }) {
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-border bg-white shadow-sm">
      <div className="border-b border-border px-[18px] py-3.5">
        <div className="h-3.5 w-32 rounded bg-neutral-100" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border px-[18px] py-3 last:border-0"
        >
          <div className="h-7 w-7 rounded-full bg-neutral-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-2/3 rounded bg-neutral-100" />
            <div className="h-2.5 w-1/3 rounded bg-neutral-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkspaceSkeleton({ label }: { label: string }) {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label={label}>
      <div className="mb-5 h-[150px] border border-border bg-white" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SkeletonCard rows={4} />
        </div>
        <div>
          <SkeletonCard rows={3} />
        </div>
      </div>
    </div>
  );
}
