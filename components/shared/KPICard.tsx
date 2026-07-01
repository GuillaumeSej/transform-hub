import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ACCENT: Record<string, string> = {
  default: "before:bg-bp-coral",
  green: "before:bg-rag-green",
  amber: "before:bg-rag-amber",
  red: "before:bg-rag-red",
  brown: "before:bg-bp-warm-brown",
};

const ICON_STYLE: Record<string, string> = {
  default: "bg-rag-red-light text-bp-coral",
  green: "bg-rag-green-light text-rag-green-dark",
  amber: "bg-rag-amber-light text-rag-amber",
  red: "bg-rag-red-light text-rag-red",
  brown: "bg-neutral-100 text-bp-warm-brown",
};

/** Carte KPI — porté depuis `.kpi` du prototype legacy (Executive Dashboard). */
export function KPICard({
  label,
  value,
  icon: Icon,
  accent = "default",
  sub,
  barPct,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  accent?: "default" | "green" | "amber" | "red" | "brown";
  sub?: string;
  barPct?: number;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border bg-white p-4 shadow-sm before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
        ACCENT[accent]
      )}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
          {label}
        </span>
        <div
          className={cn("flex h-7 w-7 items-center justify-center rounded-sm", ICON_STYLE[accent])}
        >
          <Icon size={14} />
        </div>
      </div>
      <div className="text-2xl font-bold leading-tight tracking-tight text-primary">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-tertiary">{sub}</div>}
      {barPct !== undefined && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-bp-coral"
            style={{ width: `${Math.min(100, barPct)}%` }}
          />
        </div>
      )}
    </div>
  );
}
