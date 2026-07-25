import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Brand BearingPoint : le filet d'accent (élément graphique) peut porter la famille
// rouge/taupe ; les icônes restent encre sur fond neutre (jamais colorées).
const ACCENT: Record<string, string> = {
  default: "before:bg-bp-coral",
  green: "before:bg-black",
  amber: "before:bg-bp-warm-brown",
  red: "before:bg-bp-coral",
  brown: "before:bg-bp-warm-taupe",
};

const ICON_STYLE: Record<string, string> = {
  default: "bg-neutral-100 text-primary",
  green: "bg-neutral-100 text-primary",
  amber: "bg-neutral-100 text-primary",
  red: "bg-neutral-100 text-primary",
  brown: "bg-neutral-100 text-primary",
};

/** Segment coloré d'une barre multi-catégories (ex. répartition des leviers à risque
 *  par catégorie : délais / surcoûts / savings réduits). `pct` en % de la largeur totale. */
export type KPIBarSegment = { pct: number; className: string };

/** Carte KPI — porté depuis `.kpi` du prototype legacy (Executive Dashboard).
 *
 *  Barres de progression (exclusives, par ordre de priorité) :
 *  - `barSegments` : barre multi-segments colorés (répartitions par catégorie) ;
 *  - `barPct` : barre de progression simple, avec en option `barMarkerPct` — un trait
 *    vertical matérialisant une valeur de référence (ex. reforecast vs cible). */
export function KPICard({
  label,
  value,
  icon: Icon,
  accent = "default",
  sub,
  barPct,
  barMarkerPct,
  barSegments,
  onClick,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  accent?: "default" | "green" | "amber" | "red" | "brown";
  sub?: string;
  barPct?: number;
  barMarkerPct?: number;
  barSegments?: KPIBarSegment[];
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick();
            }
          : undefined
      }
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border border-border bg-white p-4 shadow-sm before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
        ACCENT[accent],
        onClick && "cursor-pointer transition hover:border-border-strong hover:shadow-md"
      )}
    >
      {/* Contenu textuel — occupe le haut du widget */}
      <div>
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
            {label}
          </span>
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-sm",
              ICON_STYLE[accent]
            )}
          >
            <Icon size={14} />
          </div>
        </div>
        <div className="text-2xl font-bold leading-tight tracking-tight text-primary">{value}</div>
        {sub && <div className="mt-0.5 text-[11px] text-tertiary">{sub}</div>}
      </div>
      {/* Barre de progression — ancrée en bas du widget via mt-auto */}
      {barSegments && barSegments.length > 0 ? (
        <div className="mt-auto flex h-1.5 overflow-hidden rounded-full bg-neutral-100 pt-0">
          {barSegments.map((seg, i) => (
            <div
              key={i}
              className={cn("h-full", seg.className)}
              style={{ width: `${Math.max(0, Math.min(100, seg.pct))}%` }}
            />
          ))}
        </div>
      ) : (
        barPct !== undefined && (
          <div className="relative mt-auto h-1.5 overflow-visible rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-bp-coral"
              style={{ width: `${Math.min(100, Math.max(0, barPct))}%` }}
            />
            {barMarkerPct !== undefined && (
              <div
                className="absolute -top-0.5 h-2.5 w-[2px] bg-neutral-700"
                style={{ left: `${Math.min(100, Math.max(0, barMarkerPct))}%` }}
                title="Reforecast"
              />
            )}
          </div>
        )
      )}
    </div>
  );
}
