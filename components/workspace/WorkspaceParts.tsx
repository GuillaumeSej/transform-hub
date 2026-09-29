"use client";

import type { ReactNode } from "react";
import {
  BadgeCheck,
  Bell,
  ChevronRight,
  CircleCheck,
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
import { formatDate, formatDateShort } from "@/lib/format";
import type {
  WorkspaceHealth,
  WorkspaceItemSource,
  WorkspacePlan,
  WorkspaceSeverity,
} from "@/lib/myWorkspaceTypes";
import { parseIsoDay, type Translate } from "@/components/workspace/workspaceView";

/** Icône par famille d'élément (source). */
export const SOURCE_ICONS: Record<WorkspaceItemSource, LucideIcon> = {
  leverApproval: ShieldCheck,
  realizedApproval: BadgeCheck,
  milestoneApproval: Flag,
  strategicApproval: FileCheck,
  leverAlert: Bell,
  hrMovement: Users,
  chantierAction: ListChecks,
  indicatorMeasurement: Gauge,
  staffingOverrun: Users,
  blockedValidation: Hourglass,
};

/** Pastille de gravité posée sur l'icône — seule touche de couleur (charte : icônes à l'encre sur
 *  fond neutre, jamais colorées). `info` : aucune pastille. */
const SEVERITY_DOT: Record<WorkspaceSeverity, string | null> = {
  critical: "bg-rag-red",
  warning: "bg-rag-amber",
  info: null,
};

export function SourceIcon({
  source,
  severity,
}: {
  source: WorkspaceItemSource;
  severity: WorkspaceSeverity;
}) {
  const Icon = SOURCE_ICONS[source];
  const dot = SEVERITY_DOT[severity];
  return (
    <span
      aria-hidden="true"
      className="relative flex h-8 w-8 shrink-0 items-center justify-center bg-neutral-100 text-secondary transition group-hover:bg-white"
    >
      <Icon size={15} strokeWidth={1.75} />
      {dot && (
        <span
          className={cn(
            "absolute -right-[3px] -top-[3px] h-2 w-2 rounded-full ring-2 ring-white",
            dot
          )}
        />
      )}
    </span>
  );
}

/** Plan d'origine — marqueur discret (carré de couleur + libellé), mêmes teintes que
 *  `ProgramTypeBadge` (coral = Stratégique, bleu = Performance), sans pastille pleine. */
export function PlanBadge({ plan, t }: { plan: WorkspacePlan; t: Translate }) {
  const strategic = plan === "strategic";
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-tertiary">
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 shrink-0", strategic ? "bg-bp-coral" : "bg-info-blue")}
      />
      {strategic ? t("me.plan.strategic", "Stratégique") : t("me.plan.performance", "Performance")}
    </span>
  );
}

export const HEALTH_FILL: Record<WorkspaceHealth, string> = {
  green: "bg-rag-green",
  amber: "bg-rag-amber",
  red: "bg-rag-red",
  neutral: "bg-neutral-300",
};

export function healthLabel(health: WorkspaceHealth, t: Translate): string {
  return {
    green: t("me.health.green", "Sous contrôle"),
    amber: t("me.health.amber", "À surveiller"),
    red: t("me.health.red", "En difficulté"),
    neutral: t("me.health.neutral", "Non évalué"),
  }[health];
}

export function HealthDot({ health, t }: { health: WorkspaceHealth; t: Translate }) {
  const label = healthLabel(health, t);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", HEALTH_FILL[health])}
    />
  );
}

/** Date courte numérique (« 03/10/2026 » en fr) d'une échéance ISO `YYYY-MM-DD` — format date
 *  unique de l'app (`formatDateShort`). */
export function shortDate(iso: string | undefined): string {
  const d = parseIsoDay(iso);
  return d ? formatDateShort(d) : "";
}

/** Tampon aligné à droite d'une ligne : jour + mois abrégé (« 3 oct. ») — ou `value` libre
 *  (« 12 j ») — sur la première ligne, mention secondaire (retard, attente…) en dessous.
 *  `tone="late"` passe le tout en rouge, `tone="warn"` en brun (attente). */
export function DateStamp({
  iso,
  value,
  note,
  tone = "default",
}: {
  iso?: string;
  value?: string;
  note?: string;
  tone?: "default" | "late" | "warn";
}) {
  const d = parseIsoDay(iso);
  const top = value ?? (d ? formatDate(d, { day: "numeric", month: "short" }) : null);
  if (!top && !note) return null;
  const topClass = cn(
    "whitespace-nowrap text-[12px] font-semibold tabular-nums",
    tone === "late" ? "text-rag-red" : tone === "warn" ? "text-bp-warm-brown" : "text-primary"
  );
  return (
    <span className="flex min-w-[72px] shrink-0 flex-col items-end text-right leading-tight">
      {top &&
        (d && value === undefined ? (
          <time dateTime={iso} title={formatDateShort(d)} className={topClass}>
            {top}
          </time>
        ) : (
          <span className={topClass}>{top}</span>
        ))}
      {note && (
        <span
          className={cn(
            "mt-0.5 whitespace-nowrap text-[11px] tabular-nums",
            tone === "late" ? "text-rag-red" : "text-tertiary"
          )}
        >
          {note}
        </span>
      )}
    </span>
  );
}

/** En-tête de bloc, sobre : titre avec filet coral (signature de `CardHeader`), compteur en
 *  chiffres discrets, sous-titre en gris clair, actions à droite. */
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
    <div className="flex flex-col gap-2 border-b border-border px-4 pb-3 pt-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
      <div className="min-w-0">
        <h2 className="flex items-baseline gap-2 border-l-[3px] border-bp-coral pl-2.5 text-[14px] font-bold leading-5 tracking-tight text-primary">
          {title}
          {count !== undefined && (
            <span className="text-[13px] font-medium tabular-nums text-tertiary">{count}</span>
          )}
        </h2>
        {subtitle && (
          <p className="mt-1 pl-[13px] text-[12px] leading-snug text-tertiary">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/** Intitulé de sous-groupe dans un bloc (« En retard · 3 », « Cette semaine ») : petites
 *  capitales grises, compteur aligné à droite, sans bandeau de fond. */
export function GroupLabel({
  label,
  count,
  tone = "default",
  className,
}: {
  label: string;
  count?: number;
  tone?: "default" | "late";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 pb-1.5 pt-4 text-[10px] font-bold uppercase tracking-widest sm:px-5",
        tone === "late" ? "text-rag-red" : "text-tertiary",
        className
      )}
    >
      <span>{label}</span>
      <span aria-hidden className="h-px flex-1 bg-border" />
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </div>
  );
}

/** État vide accueillant : pictogramme au trait sur fond neutre, message, conseil optionnel. */
export function EmptyState({
  title,
  hint,
  icon: Icon = CircleCheck,
}: {
  title: string;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center px-5 py-9 text-center">
      <span
        aria-hidden
        className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-tertiary"
      >
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <p className="text-[13px] font-semibold text-primary">{title}</p>
      {hint && <p className="mt-1 max-w-[280px] text-[12px] text-tertiary">{hint}</p>}
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
      className="inline-flex items-center gap-1.5 rounded-full border border-bp-coral/40 bg-bp-coral/5 py-1 pl-3 pr-2 text-[11px] font-semibold text-bp-coral transition hover:border-bp-coral hover:bg-bp-coral/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bp-coral"
    >
      {t("me.filter.active", "Filtre : {label}").replace("{label}", label)}
      <X size={12} aria-label={clear} />
    </button>
  );
}

/** Chevron d'affordance des lignes cliquables : discret au repos, se décale et passe au coral
 *  au survol du parent `group`. */
export function RowChevron() {
  return (
    <ChevronRight
      size={16}
      aria-hidden="true"
      className="-mr-1 shrink-0 self-center text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-bp-coral group-focus-visible:text-bp-coral"
    />
  );
}

/** Ligne cliquable pleine largeur (navigation vers `href` via le callback) : curseur main, fond
 *  léger et filet coral au survol, chevron à droite. Sans `onClick` (aucune page ouvrable pour
 *  l'objet, voir `WorkspaceItem.href`) : même mise en page, ni curseur main, ni survol, ni chevron
 *  (un espace réservé garde l'alignement des dates avec les lignes cliquables). */
export function RowButton({
  onClick,
  children,
  className,
}: {
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  const base = "flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5";
  if (!onClick) {
    return (
      <div className={cn(base, className)}>
        {children}
        <span aria-hidden className="-mr-1 w-4 shrink-0" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        base,
        "group cursor-pointer transition-colors hover:bg-neutral-50 hover:shadow-[inset_3px_0_0_rgb(var(--bp-coral-rgb))] focus-visible:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bp-coral",
        className
      )}
    >
      {children}
      <RowChevron />
    </button>
  );
}
