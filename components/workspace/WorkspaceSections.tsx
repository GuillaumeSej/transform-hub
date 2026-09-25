"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/shared/Card";
import { ProgressBar } from "@/components/shared/ProgressBar";
import type {
  WorkspaceItem,
  WorkspacePerimeterEntry,
  WorkspaceSeverity,
} from "@/lib/myWorkspaceTypes";
import {
  groupBySeverity,
  groupByWeek,
  isLate,
  parseIsoDay,
  weekLabel,
  type Translate,
  type WorkspaceCounts,
} from "@/components/workspace/workspaceView";
import {
  EmptyState,
  HealthDot,
  PlanBadge,
  RowButton,
  SectionHeader,
  SourceIcon,
  shortDate,
} from "@/components/workspace/WorkspaceParts";
import { formatDate } from "@/lib/format";

type Navigate = (href: string) => void;

const fill = (template: string, n: number) => template.replace("{n}", String(n));

// ─── Bande KPI ──────────────────────────────────────────────────────────────────────────────────

export type KpiTarget = "todo" | "late" | "upcoming" | "blocked";

export function KpiStrip({
  counts,
  pilotView,
  onSelect,
  t,
}: {
  counts: WorkspaceCounts;
  pilotView: boolean;
  onSelect: (target: KpiTarget) => void;
  t: Translate;
}) {
  const tiles: { target: KpiTarget; label: string; value: number; accent: string }[] = [
    {
      target: "todo",
      label: t("me.kpi.todo", "À faire"),
      value: counts.todo,
      accent: "border-black",
    },
    {
      target: "late",
      label: t("me.kpi.late", "En retard"),
      value: counts.late,
      accent: counts.late > 0 ? "border-bp-coral" : "border-neutral-300",
    },
    {
      target: "upcoming",
      label: t("me.kpi.upcoming", "À venir"),
      value: counts.upcoming,
      accent: "border-bp-warm-taupe",
    },
  ];
  if (pilotView) {
    tiles.push({
      target: "blocked",
      label: t("me.kpi.blocked", "Bloqué chez d'autres"),
      value: counts.blocked,
      accent: counts.blocked > 0 ? "border-bp-warm-brown" : "border-neutral-300",
    });
  }
  return (
    <div
      className={cn("mb-5 grid grid-cols-2 gap-3", pilotView ? "lg:grid-cols-4" : "sm:grid-cols-3")}
    >
      {tiles.map((tile) => (
        <button
          key={tile.target}
          type="button"
          onClick={() => onSelect(tile.target)}
          className={cn(
            "flex flex-col rounded-md border border-l-[3px] border-border bg-white px-4 py-3 text-left shadow-sm transition hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bp-coral",
            tile.accent
          )}
        >
          <span className="text-[10px] font-bold uppercase tracking-widest text-tertiary">
            {tile.label}
          </span>
          <span
            className={cn(
              "mt-1 text-[24px] font-bold leading-none tracking-tight",
              tile.target === "late" && tile.value > 0 ? "text-rag-red" : "text-primary"
            )}
          >
            {tile.value}
          </span>
        </button>
      ))}
    </div>
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

export function TodoSection({
  items,
  lateOnly,
  onClearLateOnly,
  navigate,
  t,
}: {
  items: WorkspaceItem[];
  lateOnly: boolean;
  onClearLateOnly: () => void;
  navigate: Navigate;
  t: Translate;
}) {
  const visible = lateOnly ? items.filter(isLate) : items;
  const groups = groupBySeverity(visible);
  return (
    <Card>
      <SectionHeader
        title={t("me.todo.title", "À faire")}
        count={visible.length}
        actions={
          lateOnly && (
            <button
              type="button"
              onClick={onClearLateOnly}
              className="inline-flex items-center gap-1 rounded-full border border-bp-coral bg-bp-coral/10 px-2.5 py-1 text-[11px] font-semibold text-bp-coral transition hover:bg-bp-coral/20"
            >
              {t("me.todo.lateOnly", "En retard uniquement")}
              <X size={12} aria-label={t("me.todo.clearFilter", "Retirer le filtre")} />
            </button>
          )
        }
      />
      {groups.length === 0 ? (
        <EmptyState
          title={
            lateOnly
              ? t("me.todo.emptyLate", "Aucune action en retard.")
              : t("me.todo.empty", "Rien à faire pour le moment.")
          }
          hint={lateOnly ? undefined : t("me.todo.emptyHint", "Vous êtes à jour.")}
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

export function BlockedSection({
  items,
  navigate,
  t,
}: {
  items: WorkspaceItem[];
  navigate: Navigate;
  t: Translate;
}) {
  return (
    <Card>
      <SectionHeader
        title={t("me.blocked.title", "Bloqué chez d'autres")}
        count={items.length}
        subtitle={t(
          "me.blocked.subtitle",
          "Vue par exception : validations en attente chez un autre acteur depuis plus de 7 jours."
        )}
      />
      {items.length === 0 ? (
        <EmptyState title={t("me.blocked.empty", "Aucune validation bloquée.")} />
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
}: {
  items: WorkspaceItem[];
  today: Date;
  navigate: Navigate;
  t: Translate;
}) {
  const groups = groupByWeek(items, today);
  return (
    <Card>
      <SectionHeader
        title={t("me.upcoming.title", "À venir")}
        count={items.length}
        subtitle={t("me.upcoming.subtitle", "Échéances des 4 prochaines semaines")}
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
                        className="flex w-full items-start gap-2.5 rounded-sm py-1.5 pl-3 pr-1 text-left transition hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bp-coral"
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

function SkeletonCard({ rows }: { rows: number }) {
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
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[66px] rounded-md border border-border bg-white" />
        ))}
      </div>
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
