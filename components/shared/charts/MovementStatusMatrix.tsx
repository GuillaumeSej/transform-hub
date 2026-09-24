"use client";

import { Ban, CalendarDays, Check, Clock, TriangleAlert, type LucideIcon } from "lucide-react";
import type { MovementExecutionStatus, MovementStatusGroup } from "@/lib/hrExecution";
import { executionLabel, movementTypeLabel } from "@/lib/hrMovementLabels";
import { actualMovementFte, planMovementFte } from "@/lib/hrProgramSummary";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { groupBlockWidth, useAdaptiveGroupColumns } from "@/lib/hooks/useAdaptiveGroupColumns";

const STYLE: Record<MovementExecutionStatus, string> = {
  realized: "bg-[#421799]",
  overdue: "bg-[#FF3C47]",
  dueSoon: "bg-[#FF797B]",
  later: "bg-[#FFB1B5]",
  abandoned: "bg-[#806659]",
};
/** Icône affichée DANS chaque tuile pour que le statut se lise sans survol : un triangle
 * d'alerte pour le retard, une horloge pour l'échéance proche (≤ 90 j) vs un calendrier pour
 * l'échéance lointaine (> 90 j) — deux pictos volontairement distincts bien que les deux statuts
 * soient tous deux « à venir » — un check pour le réalisé, un interdit pour l'abandonné.
 * Volontairement petite et fine (9px, trait 1.5) plutôt qu'un gros picto centré façon badge —
 * la tuile doit d'abord se lire comme une pastille de couleur (scan rapide), l'icône n'étant
 * qu'un repère fin pour lever l'ambiguïté sans dépendre du survol. */
const ICON: Record<MovementExecutionStatus, LucideIcon> = {
  realized: Check,
  overdue: TriangleAlert,
  dueSoon: Clock,
  later: CalendarDays,
  abandoned: Ban,
};
/** Couleur d'icône par statut, câblée en dur (pas de helper de luminance partagé hors de
 * `components/strategic`) : blanc semi-transparent sur les 3 fonds sombres (violet/rouge/brun),
 * teinte sombre semi-transparente sur les 2 fonds clairs (rose corail/rose pâle) — l'opacité
 * réduite (vs. un blanc/noir plein) évite l'effet "pictogramme app mobile" et laisse la couleur
 * de fond porter l'essentiel de la lecture. */
const ICON_COLOR: Record<MovementExecutionStatus, string> = {
  realized: "text-white/80",
  overdue: "text-white/80",
  dueSoon: "text-[#1f1512]/60",
  later: "text-[#1f1512]/60",
  abandoned: "text-white/80",
};
const ORDER: MovementExecutionStatus[] = ["overdue", "dueSoon", "later", "realized", "abandoned"];

/** Géométrie fixe des tuiles (taille constante quel que soit le nombre de colonnes). Le nombre
 * de colonnes par bloc s'adapte à la largeur disponible / au nombre de groupes (cf.
 * `computeGroupColumns`) : peu de groupes (ex. vue Programme) → blocs larges et bas au lieu
 * d'une haute colonne collée à gauche ; beaucoup de groupes → colonnes compactes (4 tuiles). */
const GRID = { cellWidth: 20, cellGap: 4, groupGap: 12, groupChrome: 14, minCols: 4, maxCols: 20 };
const CELL_HEIGHT = 21;
/** Largeur mini d'un bloc pour garder le libellé du groupe lisible. */
const MIN_BLOCK_WIDTH = 104;

/** Matrice proche du widget Santé des initiatives : une tuile par mouvement, groupée selon la
 * dimension choisie, avec statut temporel dérivé et drill-down direct. */
export function MovementStatusMatrix({
  groups,
  onMovementClick,
  getInitiativeLabel,
}: {
  groups: MovementStatusGroup[];
  onMovementClick: (movementId: string) => void;
  getInitiativeLabel?: (leverId: string) => string;
}) {
  const { t } = useTranslation();
  const maxCells = groups.reduce((max, group) => Math.max(max, group.cells.length), 0);
  const { ref, cols } = useAdaptiveGroupColumns({ ...GRID, groupCount: groups.length, maxCells });
  if (groups.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("shared.executionStatusChart.noData", "Aucun mouvement à afficher.")}
      </p>
    );
  }
  const maxRows = Math.max(...groups.map((group) => Math.ceil(group.cells.length / cols)));
  return (
    <div className="space-y-3">
      <div ref={ref} className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-end justify-center gap-3">
          {groups.map((group) => {
            const cells = [...group.cells].sort(
              (a, b) => ORDER.indexOf(a.execution) - ORDER.indexOf(b.execution)
            );
            // Chaque bloc prend juste la largeur de ses tuiles (plafonnée à `cols`) : un petit
            // groupe reste étroit plutôt qu'un grand bloc vide ; hauteur commune (maxRows).
            const groupCols = Math.max(GRID.minCols, Math.min(cols, cells.length));
            return (
              <div
                key={group.key}
                className="shrink-0"
                style={{ width: Math.max(MIN_BLOCK_WIDTH, groupBlockWidth(groupCols, GRID)) }}
              >
                <div
                  className="flex items-end justify-center rounded-sm border border-info-blue/40 bg-info-blue-light p-1.5"
                  style={{
                    minHeight: `${maxRows * (CELL_HEIGHT + GRID.cellGap) - GRID.cellGap + 12 + 2}px`,
                  }}
                >
                  <div
                    className="grid gap-1"
                    style={{ gridTemplateColumns: `repeat(${groupCols}, ${GRID.cellWidth}px)` }}
                  >
                    {cells.map(({ movement, execution }) => {
                      const StatusIcon = ICON[execution];
                      return (
                        <button
                          key={movement.id}
                          type="button"
                          onClick={() => onMovementClick(movement.id)}
                          className={`flex h-[21px] items-center justify-center rounded-[2px] transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-black ${STYLE[execution]}`}
                          title={`${movement.label} · ${movementTypeLabel(t, movement.type)}\n${executionLabel(t, execution)} · ${execution === "realized" ? actualMovementFte(movement) : planMovementFte(movement)} ${t("etp.column.fte", "ETP")}\n${t("shared.movementStatusMatrix.initiativeLabel", "Initiative")} : ${getInitiativeLabel?.(movement.leverId) ?? movement.leverId}\n${t("etp.filter.hrOwnerMovement", "Responsable RH")} : ${movement.hrOwner}\n${t("etp.column.plannedDate", "Date prévue")} : ${movement.plannedDate}`}
                          aria-label={`${movement.label} ${executionLabel(t, execution)}`}
                        >
                          <StatusIcon
                            aria-hidden
                            size={9}
                            strokeWidth={1.75}
                            className={ICON_COLOR[execution]}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div
                  className="mt-1.5 truncate text-center text-[10.5px] font-semibold text-secondary"
                  title={group.label}
                >
                  {group.label}
                </div>
                <div className="text-center text-[10px] text-tertiary">{group.cells.length}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-border pt-2 text-[11px] text-secondary">
        {ORDER.map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-[2px] ${STYLE[status]}`} />
            {executionLabel(t, status)}
          </span>
        ))}
      </div>
    </div>
  );
}
