"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/shared/Card";
import type { MyWorkspace, WorkspaceItem, WorkspacePerimeterEntry } from "@/lib/myWorkspaceTypes";
import {
  categoryLabel,
  filterTodoItems,
  groupTodoByCategory,
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
  DateStamp,
  GroupLabel,
  healthLabel,
} from "@/components/workspace/WorkspaceParts";
import { CalendarCheck, Compass, Hourglass } from "lucide-react";
import { formatDate } from "@/lib/format";

/** Suit un lien du portail ; `programId` (programme de l'élément) est activé comme programme actif
 *  global avant la navigation quand il diffère (voir app/(app)/me/page.tsx). */
type Navigate = (href: string, programId?: string) => void;

/** Callback de navigation d'une ligne, ou `undefined` quand l'objet n'a aucune page ouvrable
 *  (`href` absent, voir `reachableHref` dans lib/myWorkspace.ts) — ligne alors non cliquable. */
function linkTo(
  navigate: Navigate,
  target: { href?: string; programId?: string }
): (() => void) | undefined {
  const { href, programId } = target;
  return href ? () => navigate(href, programId) : undefined;
}

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
 * empilée (fine, en accent) par catégorie DISJOINTE (`workspaceBreakdown` — la somme des segments
 * = le total), puis une tuile-statistique par catégorie (pastille + libellé, nombre, %), séparées
 * par des filets façon cartes KPI. Segment, tuile : même action = filtrer
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
    <section className="mb-6 border border-border bg-white shadow-sm">
      {/* Ligne de tête : total à gauche ; à droite, l'aide (sans filtre) ou la puce de filtre. */}
      <div className="flex min-h-[28px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5">
        <p className="text-[13px] text-secondary">
          <span className="font-bold tabular-nums text-primary">{total}</span>{" "}
          {total === 1
            ? t("me.breakdown.itemsOne", "élément")
            : t("me.breakdown.itemsMany", "éléments")}
        </p>
        {active ? (
          <FilterChip label={categoryLabel(active, t)} onClear={() => onSelect(null)} t={t} />
        ) : (
          <p className="hidden text-[11px] text-tertiary sm:block">
            {t("me.breakdown.hint", "Cliquez sur une catégorie pour filtrer la page.")}
          </p>
        )}
      </div>

      {/* Barre 100 % empilée, fine : l'accent visuel de la répartition (segments cliquables). */}
      <div className="px-4 pt-3 sm:px-5">
        <div
          className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-neutral-100"
          role="group"
          aria-label={t("me.breakdown.aria", "Répartition de vos éléments par catégorie")}
        >
          {shown.map((p) => {
            const label = tip(p);
            return (
              <button
                key={p.category}
                type="button"
                onClick={() => toggle(p.category)}
                aria-label={label}
                aria-pressed={active === p.category}
                title={label}
                style={{ flexGrow: p.count, flexBasis: 0 }}
                className={cn(
                  "min-w-[6px] cursor-pointer transition-opacity duration-200 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-coral",
                  CATEGORY_FILL[p.category],
                  active && active !== p.category && "opacity-25"
                )}
              />
            );
          })}
        </div>
      </div>

      {/* Tuiles-statistiques, séparées par de simples filets (pas de bordure par tuile). */}
      <ul
        className={cn(
          "mt-4 grid gap-px border-t border-border bg-border",
          parts.length === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-3"
        )}
      >
        {parts.map((p) => {
          const isActive = active === p.category;
          const dimmed = active !== null && !isActive;
          const empty = p.count === 0;
          return (
            <li key={p.category} className="bg-white">
              <button
                type="button"
                onClick={() => toggle(p.category)}
                aria-pressed={isActive}
                title={tip(p)}
                className={cn(
                  "relative flex h-full w-full cursor-pointer flex-col px-4 pb-4 pt-3.5 text-left transition-colors before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bp-coral sm:px-5",
                  isActive
                    ? "bg-bp-coral/[0.04] before:bg-bp-coral"
                    : "before:bg-transparent hover:bg-neutral-50"
                )}
              >
                <span
                  className={cn(
                    "flex w-full items-center gap-2 transition-opacity",
                    dimmed && "opacity-50"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("h-2 w-2 shrink-0 rounded-full", CATEGORY_FILL[p.category])}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-secondary">
                    {categoryLabel(p.category, t)}
                  </span>
                  {isActive && (
                    <X size={13} aria-hidden="true" className="shrink-0 text-bp-coral" />
                  )}
                </span>
                <span
                  className={cn(
                    "mt-2.5 flex items-baseline gap-2 transition-opacity",
                    dimmed && "opacity-50"
                  )}
                >
                  <span
                    className={cn(
                      "text-[26px] font-bold leading-none tracking-tight tabular-nums",
                      empty
                        ? "text-tertiary"
                        : p.category === "overdue"
                          ? "text-rag-red"
                          : "text-primary"
                    )}
                  >
                    {p.count}
                  </span>
                  {!empty && (
                    <span className="text-[11px] tabular-nums text-tertiary">{p.pct} %</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── À faire ────────────────────────────────────────────────────────────────────────────────────

/** Bloc texte d'une ligne : titre en gras (tronqué), puis UNE ligne de méta discrète
 *  (contexte(s) · plan d'origine). */
function ItemText({
  title,
  meta,
  plan,
  t,
}: {
  title: string;
  meta: (string | undefined | false)[];
  plan: WorkspaceItem["plan"];
  t: Translate;
}) {
  const metaText = meta.filter(Boolean).join(" · ");
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-[13px] font-semibold leading-5 text-primary">{title}</div>
      <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] leading-4 text-tertiary">
        {metaText && <span className="min-w-0 truncate">{metaText}</span>}
        {metaText && (
          <span aria-hidden className="text-neutral-300">
            ·
          </span>
        )}
        <PlanBadge plan={plan} t={t} />
      </div>
    </div>
  );
}

/** Tampon de droite d'une ligne « À faire » : date d'échéance, et le retard en rouge dessous. */
function DueStamp({ item, t }: { item: WorkspaceItem; t: Translate }) {
  const late = isLate(item);
  return (
    <DateStamp
      iso={item.dueDate}
      note={late ? fill(t("me.due.late", "en retard de {n} j"), item.daysLate ?? 0) : undefined}
      tone={late ? "late" : "default"}
    />
  );
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

/** Bloc ciblé par le filtre actif : liseré coral fin autour de la carte. */
const HIGHLIGHT = "ring-1 ring-bp-coral";

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
  // Mêmes catégories / comptes / ordre que la barre de répartition (« En retard », « À traiter ») ;
  // la gravité n'est qu'un marqueur visuel (icône) dans la ligne.
  const groups = groupTodoByCategory(visible);
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
        <div className={cn("pb-1.5", category !== null && "pt-1.5")}>
          {groups.map((group) => (
            <section key={group.category} aria-label={categoryLabel(group.category, t)}>
              {category === null && (
                <GroupLabel
                  label={categoryLabel(group.category, t)}
                  count={group.items.length}
                  tone={group.category === "overdue" ? "late" : "default"}
                />
              )}
              <ul className="divide-y divide-border">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <RowButton onClick={linkTo(navigate, item)}>
                      <SourceIcon source={item.source} severity={item.severity} />
                      <ItemText title={item.title} meta={[item.context]} plan={item.plan} t={t} />
                      <DueStamp item={item} t={t} />
                    </RowButton>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
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
        <EmptyState
          icon={Hourglass}
          title={emptyLabel ?? t("me.blocked.empty", "Aucune validation bloquée.")}
          hint={t("me.blocked.emptyHint", "Les circuits de validation avancent normalement.")}
        />
      ) : (
        <ul className="divide-y divide-border py-1">
          {items.map((item) => (
            <li key={item.id}>
              <RowButton onClick={linkTo(navigate, item)}>
                <SourceIcon source={item.source} severity={item.severity} />
                <ItemText
                  title={item.title}
                  meta={[
                    item.waitingOn &&
                      t("me.blocked.waitingOn", "chez {who}").replace("{who}", item.waitingOn),
                    item.context,
                  ]}
                  plan={item.plan}
                  t={t}
                />
                {item.waitingDays !== undefined && (
                  <DateStamp
                    value={fill(t("me.blocked.days", "{n} j"), item.waitingDays)}
                    note={t("me.blocked.waiting", "en attente")}
                    tone="warn"
                  />
                )}
              </RowButton>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── À venir ────────────────────────────────────────────────────────────────────────────────────

/** Liseré haut du pavé-date selon la gravité (neutre pour une simple échéance à venir). */
const DAY_TILE_ACCENT: Record<WorkspaceItem["severity"], string> = {
  critical: "border-t-rag-red",
  warning: "border-t-rag-amber",
  info: "border-t-neutral-300",
};

/** Pavé-date façon éphéméride (« MAR. » / « 30 ») posé sur la frise ; « — » sans date. */
function DayTile({ iso, severity }: { iso?: string; severity: WorkspaceItem["severity"] }) {
  const d = parseIsoDay(iso);
  return (
    <span
      title={d ? shortDate(iso) : undefined}
      className={cn(
        "relative flex h-10 w-10 shrink-0 flex-col items-center justify-center border border-t-2 border-border bg-white leading-none",
        DAY_TILE_ACCENT[severity]
      )}
    >
      {d ? (
        <>
          <span className="text-[9px] font-semibold uppercase tracking-wide text-tertiary">
            {formatDate(d, { weekday: "short" }).replace(".", "")}
          </span>
          <span className="mt-0.5 text-[15px] font-bold tabular-nums text-primary">
            {d.getDate()}
          </span>
        </>
      ) : (
        <span className="text-[13px] text-tertiary">—</span>
      )}
    </span>
  );
}

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
          icon={CalendarCheck}
          title={t("me.upcoming.empty", "Aucune échéance dans les 4 prochaines semaines.")}
          hint={t("me.upcoming.emptyHint", "Votre agenda est dégagé pour le mois à venir.")}
        />
      ) : (
        <div className="pb-2">
          {groups.map((group) => (
            <section key={group.offset ?? "none"} aria-label={weekLabel(group.offset, t)}>
              <GroupLabel label={weekLabel(group.offset, t)} count={group.items.length} />
              {/* Frise : un filet vertical relie les pavés-dates de la semaine (centré sur la
                  colonne des pavés : gouttière 16/20 px + moitié du pavé de 40 px). */}
              <ol className="relative before:absolute before:bottom-4 before:left-[36px] before:top-4 before:w-px before:bg-border sm:before:left-[40px]">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <RowButton onClick={linkTo(navigate, item)} className="py-2">
                      <DayTile iso={item.dueDate} severity={item.severity} />
                      <ItemText title={item.title} meta={[item.context]} plan={item.plan} t={t} />
                    </RowButton>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Mon périmètre ──────────────────────────────────────────────────────────────────────────────

/** Liseré gauche de la tuile = santé de l'objet (même principe que l'accent des `KPICard`). */
const HEALTH_ACCENT: Record<WorkspacePerimeterEntry["health"], string> = {
  green: "before:bg-rag-green",
  amber: "before:bg-rag-amber",
  red: "before:bg-rag-red",
  neutral: "before:bg-neutral-300",
};

/** Tuile compacte d'un objet du périmètre : libellé, rôle · plan, santé (liseré + libellé) et
 *  avancement optionnel. Cliquable quand l'objet a une page ouvrable, statique sinon. */
function PerimeterTile({
  entry,
  onClick,
  t,
}: {
  entry: WorkspacePerimeterEntry;
  onClick?: () => void;
  t: Translate;
}) {
  const pct =
    entry.progressPct !== undefined ? Math.max(0, Math.min(100, entry.progressPct)) : undefined;
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-5 text-primary">
          {entry.label}
        </span>
        {onClick && <RowChevron />}
      </span>
      <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] leading-4 text-tertiary">
        <span className="min-w-0 truncate">{entry.role}</span>
        <span aria-hidden className="text-neutral-300">
          ·
        </span>
        <PlanBadge plan={entry.plan} t={t} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-secondary">
          <HealthDot health={entry.health} t={t} />
          <span aria-hidden className="whitespace-nowrap">
            {healthLabel(entry.health, t)}
          </span>
        </span>
      </span>
      {pct !== undefined && entry.progressPct !== undefined && (
        <span className="mt-2.5 flex items-center gap-2.5">
          <span
            role="progressbar"
            aria-label={t("me.perimeter.progress", "Avancement")}
            aria-valuenow={Math.round(entry.progressPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-100"
          >
            <span
              className="block h-full rounded-full bg-neutral-700 transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="min-w-[32px] text-right text-[11px] font-semibold tabular-nums text-secondary">
            {Math.round(entry.progressPct)} %
          </span>
        </span>
      )}
    </>
  );
  const tile = cn(
    "relative flex w-full flex-col border border-border bg-white py-2.5 pl-4 pr-3 text-left before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
    HEALTH_ACCENT[entry.health]
  );
  if (!onClick) return <div className={tile}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        tile,
        "group cursor-pointer transition hover:border-neutral-300 hover:bg-neutral-50 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bp-coral"
      )}
    >
      {body}
    </button>
  );
}

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
        <EmptyState
          icon={Compass}
          title={t("me.perimeter.empty", "Aucun objet rattaché à votre profil.")}
          hint={t(
            "me.perimeter.emptyHint",
            "Les programmes, leviers et chantiers dont vous avez la charge apparaîtront ici."
          )}
        />
      ) : (
        <ul className="space-y-2 p-3 sm:p-4">
          {entries.map((entry) => (
            <li key={`${entry.kind}:${entry.id}`}>
              <PerimeterTile entry={entry} onClick={linkTo(navigate, entry)} t={t} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Squelette de chargement ────────────────────────────────────────────────────────────────────

/** Barre grise de squelette. */
function Bone({ className }: { className?: string }) {
  return <div className={cn("bg-neutral-100", className)} />;
}

/** Carte-squelette calquée sur les blocs du portail : en-tête (filet coral + titre), puis
 *  `rows` lignes au gabarit choisi — `list` (icône · titre/méta · date, « À faire » / « Bloqué »),
 *  `timeline` (pavé-date · titre/méta, « À venir »), `tiles` (tuiles du périmètre). */
export function SkeletonCard({
  rows,
  variant = "list",
}: {
  rows: number;
  variant?: "list" | "timeline" | "tiles";
}) {
  const widths = ["w-3/5", "w-2/3", "w-1/2", "w-3/4"];
  return (
    <div className="mb-4 overflow-hidden border border-border bg-white shadow-sm">
      <div className="border-b border-border px-4 pb-3 pt-4 sm:px-5">
        <div className="flex items-center gap-2 border-l-[3px] border-bp-coral/40 pl-2.5">
          <Bone className="h-3.5 w-28" />
          <Bone className="h-3 w-4" />
        </div>
      </div>
      {variant === "tiles" ? (
        <div className="space-y-2 p-3 sm:p-4">
          {Array.from({ length: rows }, (_, i) => (
            <div
              key={i}
              className="border border-border py-2.5 pl-4 pr-3 shadow-[inset_3px_0_0_rgb(var(--n-200-rgb))]"
            >
              <Bone className={cn("h-3 max-w-full", widths[i % widths.length])} />
              <Bone className="mt-2 h-2.5 w-2/5" />
              <Bone className="mt-3 h-1 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border py-1">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <Bone className={variant === "timeline" ? "h-10 w-10" : "h-8 w-8"} />
              <div className="min-w-0 flex-1">
                <Bone className={cn("h-3", widths[i % widths.length])} />
                <Bone className="mt-2 h-2.5 w-1/3" />
              </div>
              {variant === "list" && (
                <div className="flex flex-col items-end">
                  <Bone className="h-3 w-12" />
                  <Bone className="mt-1.5 h-2.5 w-16" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkspaceSkeleton({ label }: { label: string }) {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label={label}>
      <div className="mb-5 h-[150px] border border-border bg-white shadow-sm" />
      <div className="grid gap-x-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <SkeletonCard rows={5} />
        </div>
        <div className="min-w-0">
          <SkeletonCard rows={3} variant="timeline" />
          <SkeletonCard rows={2} variant="tiles" />
        </div>
      </div>
    </div>
  );
}
