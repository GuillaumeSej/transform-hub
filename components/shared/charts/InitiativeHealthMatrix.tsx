"use client";

import { toggleInSelection } from "@/lib/filterUtils";
import { useState } from "react";
import type { LeverHealthGroup, LeverHealthStatus } from "@/lib/leverHealth";
import { groupBlockWidth, useAdaptiveGroupColumns } from "@/lib/hooks/useAdaptiveGroupColumns";

const HEALTH_STYLE: Record<LeverHealthStatus, string> = {
  onTrack: "bg-rag-green",
  watch: "bg-rag-amber",
  critical: "bg-rag-red",
  cancelled: "bg-neutral-400",
};

/** Bordure gauche + fond léger utilisés pour les rectangles de leviers : la couleur reste
 * immédiatement scannable via la bande de couleur, sans passer tout le bloc en couleur saturée
 * (ce qui rendrait le texte blanc illisible en petite taille). */
const HEALTH_CELL_STYLE: Record<LeverHealthStatus, string> = {
  onTrack: "border-l-rag-green bg-rag-green/10",
  watch: "border-l-rag-amber bg-rag-amber/10",
  critical: "border-l-rag-red bg-rag-red/10",
  cancelled: "border-l-neutral-400 bg-neutral-400/10",
};

const HEALTH_ORDER: LeverHealthStatus[] = ["critical", "watch", "onTrack", "cancelled"];

/** Marqueur carré « contour » (légende en mode filtre, statut non sélectionné). */
const HEALTH_OUTLINE_STYLE: Record<LeverHealthStatus, string> = {
  onTrack: "border-rag-green",
  watch: "border-rag-amber",
  critical: "border-rag-red",
  cancelled: "border-neutral-400",
};

/** Géométrie des rectangles de leviers (largeur fixe). Le nombre de colonnes par bloc s'adapte
 * à la largeur disponible / au nombre de groupes (cf. `computeGroupColumns`) : peu de groupes →
 * blocs élargis sur plusieurs colonnes au lieu d'une longue pile verticale ; beaucoup de
 * groupes → une colonne par bloc (défilement horizontal en dernier recours). */
const GRID = { cellWidth: 186, cellGap: 4, groupGap: 12, groupChrome: 14, minCols: 1, maxCols: 4 };

export function InitiativeHealthMatrix({
  groups,
  labels,
  onLeverClick,
}: {
  groups: LeverHealthGroup[];
  labels: Record<LeverHealthStatus, string> & {
    empty: string;
    showAll: string;
    filterHint: string;
  };
  onLeverClick: (leverId: string) => void;
}) {
  // Filtre de statut géré localement au composant, piloté par la légende sous la matrice
  // (chaque entrée est un bouton bascule) : tableau vide = aucun filtre actif (multi-sélection).
  const [statusFilter, setStatusFilter] = useState<LeverHealthStatus[]>([]);
  // Colonnes calculées sur les groupes non filtrés : la disposition reste stable quand on
  // bascule un statut dans la légende.
  const maxCells = groups.reduce((max, group) => Math.max(max, group.cells.length), 0);
  const { ref, cols } = useAdaptiveGroupColumns({ ...GRID, groupCount: groups.length, maxCells });

  if (groups.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">{labels.empty}</p>;
  }

  const filteredGroups = groups.map((group) => ({
    ...group,
    cells:
      statusFilter.length === 0
        ? group.cells
        : group.cells.filter((cell) => statusFilter.includes(cell.health)),
  }));

  return (
    <div className="space-y-3">
      <div ref={ref} className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-start justify-center gap-3">
          {filteredGroups.map((group, index) => {
            const cells = [...group.cells].sort(
              (a, b) => HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health)
            );
            // Largeur du bloc = ses propres leviers (non filtrés, pour rester stable), plafonnée à `cols`.
            const groupCols = Math.max(GRID.minCols, Math.min(cols, groups[index].cells.length));
            return (
              <div
                key={group.key}
                className="shrink-0"
                style={{ width: groupBlockWidth(groupCols, GRID) }}
              >
                <div
                  className="mb-1.5 line-clamp-2 text-center text-[10.5px] font-semibold text-secondary"
                  title={group.label}
                >
                  {group.label}
                </div>
                <div className="text-center text-[10px] text-tertiary">
                  {group.cells.filter((cell) => cell.health !== "cancelled").length}
                </div>
                <div
                  className="mt-1.5 grid gap-1 rounded-sm border border-info-blue/40 bg-info-blue-light p-1.5"
                  style={{ gridTemplateColumns: `repeat(${groupCols}, minmax(0, 1fr))` }}
                >
                  {cells.map(({ lever, health, computedRisk, activeAlertCount }) => (
                    <button
                      key={lever.id}
                      type="button"
                      onClick={() => onLeverClick(lever.id)}
                      className={`flex flex-col items-start justify-center rounded-[2px] border-l-4 px-1.5 py-1 text-left leading-tight transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-black ${HEALTH_CELL_STYLE[health]}`}
                      title={`${lever.code} · ${lever.name}\n${labels[health]} · Risque ${computedRisk}\n${lever.owner} · ${activeAlertCount} alerte(s) active(s)`}
                      aria-label={`${lever.code} ${lever.name} ${labels[health]}`}
                    >
                      <span className="w-full truncate text-[11px] font-semibold text-primary">
                        {lever.code}{" "}
                        <span className="font-normal text-secondary">· {lever.name}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Légende = filtre : chaque statut est un bouton bascule (aria-pressed). Sans filtre, tous
          les carrés sont pleins (légende classique) ; avec filtre, les statuts retenus gardent un
          carré plein + libellé gras souligné, les autres passent en carré contour atténué. */}
      <div
        role="group"
        aria-label={labels.filterHint}
        title={labels.filterHint}
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-border pt-2 text-[11px] text-secondary"
      >
        {HEALTH_ORDER.map((status) => {
          const isFiltering = statusFilter.length > 0;
          const isActive = statusFilter.includes(status);
          const isDimmed = isFiltering && !isActive;
          return (
            <button
              key={status}
              type="button"
              aria-pressed={isActive}
              onClick={() =>
                setStatusFilter((prev) => toggleInSelection(prev, status) as LeverHealthStatus[])
              }
              className={`inline-flex items-center gap-1.5 rounded-[2px] px-1 py-0.5 transition hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-black ${
                isActive
                  ? "font-semibold text-primary underline underline-offset-2"
                  : isDimmed
                    ? "opacity-50 hover:opacity-100"
                    : ""
              }`}
            >
              <span
                aria-hidden
                className={`h-2.5 w-2.5 rounded-[2px] ${
                  isDimmed ? `border ${HEALTH_OUTLINE_STYLE[status]}` : HEALTH_STYLE[status]
                }`}
              />
              {labels[status]}
            </button>
          );
        })}
        {/* Toujours rendu (invisible sans filtre) pour éviter un saut de mise en page. */}
        <button
          type="button"
          onClick={() => setStatusFilter([])}
          className={`rounded-[2px] px-1 py-0.5 text-[11px] font-semibold text-secondary underline underline-offset-2 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-black ${
            statusFilter.length === 0 ? "invisible" : ""
          }`}
        >
          {labels.showAll}
        </button>
      </div>
    </div>
  );
}
