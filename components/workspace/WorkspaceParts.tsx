"use client";

import type { ReactNode } from "react";
import {
  BadgeCheck,
  Bell,
  ChevronRight,
  FileCheck,
  Flag,
  Gauge,
  Hourglass,
  ListChecks,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import type {
  WorkspaceHealth,
  WorkspaceItemSource,
  WorkspacePlan,
  WorkspaceSeverity,
} from "@/lib/myWorkspaceTypes";
import { parseIsoDay, type Translate } from "@/components/workspace/workspaceView";

/** Icône par famille d'élément (source) — la couleur, elle, porte la gravité. */
export const SOURCE_ICONS: Record<WorkspaceItemSource, LucideIcon> = {
  leverApproval: ShieldCheck,
  realizedApproval: BadgeCheck,
  milestoneApproval: Flag,
  strategicApproval: FileCheck,
  leverAlert: Bell,
  hrMovement: Users,
  chantierAction: ListChecks,
  indicatorMeasurement: Gauge,
  blockedValidation: Hourglass,
};

const SEVERITY_STYLE: Record<WorkspaceSeverity, string> = {
  critical: "bg-rag-red-light text-rag-red",
  warning: "bg-rag-amber-light text-rag-amber",
  info: "bg-info-blue-light text-info-blue",
};

export function SourceIcon({
  source,
  severity,
}: {
  source: WorkspaceItemSource;
  severity: WorkspaceSeverity;
}) {
  const Icon = SOURCE_ICONS[source];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
        SEVERITY_STYLE[severity]
      )}
    >
      <Icon size={14} />
    </span>
  );
}

/** Badge du plan d'origine — mêmes couleurs que `ProgramTypeBadge` (admin programmes). */
export function PlanBadge({ plan, t }: { plan: WorkspacePlan; t: Translate }) {
  return plan === "strategic" ? (
    <span className="shrink-0 rounded-full bg-bp-coral/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-bp-coral">
      {t("me.plan.strategic", "Stratégique")}
    </span>
  ) : (
    <span className="shrink-0 rounded-full bg-info-blue-light px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-info-blue">
      {t("me.plan.performance", "Transfo")}
    </span>
  );
}

const HEALTH_STYLE: Record<WorkspaceHealth, string> = {
  green: "bg-rag-green",
  amber: "bg-rag-amber",
  red: "bg-rag-red",
  neutral: "bg-neutral-300",
};

export function HealthDot({ health, t }: { health: WorkspaceHealth; t: Translate }) {
  const label = {
    green: t("me.health.green", "Sous contrôle"),
    amber: t("me.health.amber", "À surveiller"),
    red: t("me.health.red", "En difficulté"),
    neutral: t("me.health.neutral", "Non évalué"),
  }[health];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", HEALTH_STYLE[health])}
    />
  );
}

/** Date courte localisée (« 3 oct. ») d'une échéance ISO `YYYY-MM-DD`. */
export function shortDate(iso: string | undefined): string {
  const d = parseIsoDay(iso);
  return d ? formatDate(d, { day: "numeric", month: "short" }) : "";
}

/** En-tête de bloc : titre avec filet coral (même style que `CardHeader`) + sous-titre + actions. */
export function SectionHeader({
  title,
  count,
  subtitle,
  actions,
}: {
  title: string;
  count?: number;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:px-[18px]">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 border-l-[3px] border-bp-coral pl-2 text-[14px] font-bold tracking-tight text-primary">
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-neutral-100 px-1.5 py-px text-[11px] font-semibold text-secondary">
              {count}
            </span>
          )}
        </h2>
        {subtitle && <p className="mt-1 pl-[11px] text-[11px] text-tertiary">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-[18px] py-8 text-center">
      <p className="text-[13px] font-semibold text-secondary">{title}</p>
      {hint && <p className="mt-1 text-[11px] text-tertiary">{hint}</p>}
    </div>
  );
}

/** Puce du filtre de catégorie actif (« Filtre : En retard ✕ ») — un clic la retire. */
export function FilterChip({
  label,
  onClear,
  t,
}: {
  label: string;
  onClear: () => void;
  t: Translate;
}) {
  const clear = t("me.filter.clear", "Retirer le filtre");
  return (
    <button
      type="button"
      onClick={onClear}
      title={clear}
      className="inline-flex items-center gap-1.5 border border-bp-coral bg-bp-coral/10 px-2.5 py-1 text-[11px] font-semibold text-bp-coral transition hover:bg-bp-coral/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bp-coral"
    >
      {t("me.filter.active", "Filtre : {label}").replace("{label}", label)}
      <X size={12} aria-label={clear} />
    </button>
  );
}

/** Chevron d'affordance des lignes cliquables (se décale et fonce au survol du parent `group`). */
export function RowChevron() {
  return (
    <ChevronRight
      size={16}
      aria-hidden="true"
      className="shrink-0 self-center text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-bp-coral"
    />
  );
}

/** Ligne cliquable pleine largeur (navigation vers `href` via le callback) : curseur main, fond
 *  et filet coral au survol, chevron à droite. */
export function RowButton({
  onClick,
  children,
  className,
}: {
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition hover:bg-neutral-100 hover:shadow-[inset_3px_0_0_rgb(var(--bp-coral-rgb))] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bp-coral sm:px-[18px]",
        className
      )}
    >
      {children}
      <RowChevron />
    </button>
  );
}
