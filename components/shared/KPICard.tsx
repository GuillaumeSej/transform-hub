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
  secondary,
  onClick,
  className,
  hero = false,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  accent?: "default" | "green" | "amber" | "red" | "brown";
  sub?: string;
  barPct?: number;
  barMarkerPct?: number;
  barSegments?: KPIBarSegment[];
  /** Bloc secondaire optionnel, visuellement séparé du contenu principal (filet + fond
   *  légèrement teinté) — pour une métrique liée mais distincte (ex. ambition du programme vs
   *  cible bottom-up déjà affichée en `value`/`sub`), plutôt que de la faire cohabiter dans une
   *  seule phrase dense au sein de `sub`. */
  secondary?: { label: string; value: string; pct: number };
  onClick?: () => void;
  /** Classes additionnelles sur la carte (ex. col-span responsive dans la grille KPI). */
  className?: string;
  /** Mise en avant mobile : chiffre agrandi sous le breakpoint desktop de la grille KPI
   *  (1100px, voir dashboard) — au-dessus, identique aux autres cartes. */
  hero?: boolean;
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
        onClick && "cursor-pointer transition hover:border-border-strong hover:shadow-md",
        className
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
        <div
          className={cn(
            "text-2xl font-bold leading-tight tracking-tight text-primary",
            hero && "text-4xl max-[1100px]:mt-1 min-[1101px]:text-2xl"
          )}
        >
          {value}
        </div>
        {sub && <div className="mt-0.5 text-[11px] text-tertiary">{sub}</div>}
      </div>
      {/* Barre de progression — ancrée en bas du widget via mt-auto (sauf si un bloc `secondary`
          suit : dans ce cas la barre principale n'a plus besoin de pousser jusqu'en bas, le bloc
          secondaire s'en charge). */}
      {barSegments && barSegments.length > 0 ? (
        <div
          className={cn(
            "flex h-1.5 overflow-hidden rounded-full bg-neutral-100 pt-0",
            secondary ? "mt-3" : "mt-auto"
          )}
        >
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
          <div
            className={cn(
              "relative h-1.5 overflow-visible rounded-full bg-neutral-100",
              secondary ? "mt-3" : "mt-auto"
            )}
          >
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
      {/* Bloc secondaire — métrique liée mais distincte (ex. ambition du programme), séparée
          visuellement du contenu principal par un filet + un fond légèrement teinté plutôt que
          noyée dans `sub`. Toujours ancré en bas du widget. */}
      {secondary && (
        <div className="mt-3 -mx-4 -mb-4 border-t border-border bg-neutral-50 px-4 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-tertiary">
              {secondary.label}
            </span>
            <span className="text-xs font-bold text-primary">{secondary.value}</span>
          </div>
          <div className="relative mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full rounded-full bg-neutral-500"
              style={{ width: `${Math.min(100, Math.max(0, secondary.pct))}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
