"use client";

import { useState } from "react";
import { Ban, CalendarDays, Check, Clock, TriangleAlert, type LucideIcon } from "lucide-react";
import type {
  MovementExecutionStatus,
  MovementStatusCell,
  MovementStatusGroup,
} from "@/lib/hrExecution";
import { executionLabel, movementTypeLabel } from "@/lib/hrMovementLabels";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { groupBlockWidth, useAdaptiveGroupColumns } from "@/lib/hooks/useAdaptiveGroupColumns";
import { formatFte, formatDateShort, formatMillions, formatPct } from "@/lib/format";
import { departmentContributors, executionMovementFte, shareOfTotal } from "@/lib/hrChartPreview";
import { isActiveMovement } from "@/lib/workforceLogic";
import { STATUS_COLORS } from "./HrExecutionCharts";
import { ChartHoverArea, FloatingPreview } from "./HoverPreview";
import { HrChartPreview } from "./HrChartPreview";

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
  dueSoon: "text-[#1A1A1A]/60",
  later: "text-[#1A1A1A]/60",
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
  // Aperçu au survol (retour PO) — remplace l'ancien `title` natif : une tuile survolée prime sur
  // le bloc de groupe qui la contient.
  // Mémorisés par CLÉ (id de mouvement / clé de groupe) puis relus dans `groups` : l'aperçu reflète
  // toujours les données courantes même si la page recalcule les groupes pendant le survol.
  const [hoveredCellId, setHoveredCellId] = useState<string | null>(null);
  const [hoveredGroupKey, setHoveredGroupKey] = useState<string | null>(null);
  const hoveredGroup = groups.find((group) => group.key === hoveredGroupKey) ?? null;
  const hoveredCell: MovementStatusCell | null =
    hoveredCellId === null
      ? null
      : (groups.flatMap((group) => group.cells).find((c) => c.movement.id === hoveredCellId) ??
        null);
  if (groups.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("shared.executionStatusChart.noData", "Aucun mouvement à afficher.")}
      </p>
    );
  }
  const maxRows = Math.max(...groups.map((group) => Math.ceil(group.cells.length / cols)));
  const etp = t("etp.column.fte", "ETP");
  const totalCells = groups.reduce((sum, group) => sum + group.cells.length, 0);

  const cellPreview = ({ movement, execution }: MovementStatusCell) => (
    <HrChartPreview
      title={movement.label}
      badge={movementTypeLabel(t, movement.type)}
      rows={[
        {
          label: t("chart.hrPreview.status", "Statut"),
          value: executionLabel(t, execution),
          marker: { color: STATUS_COLORS[execution] },
        },
        {
          label: etp,
          value: formatFte(executionMovementFte(movement), { unit: etp }),
          strong: true,
        },
        {
          label: t("chart.hrPreview.salaryImpact", "Impact masse salariale"),
          value: formatMillions((movement.salaryImpact || 0) / 1_000_000),
        },
        {
          label: t("chart.hrPreview.socialCost", "Coût social (ENR)"),
          value: formatMillions((movement.cost || 0) / 1_000_000),
        },
        {
          label: t("shared.movementStatusMatrix.initiativeLabel", "Initiative"),
          value: getInitiativeLabel?.(movement.leverId) ?? movement.leverId,
          muted: true,
        },
        {
          label: t("etp.filter.hrOwnerMovement", "Responsable RH"),
          value: movement.hrOwner || "—",
          muted: true,
        },
        {
          label: t("etp.column.plannedDate", "Date prévue"),
          value: formatDateShort(movement.plannedDate) || "—",
          muted: true,
        },
        ...(movement.actualDate
          ? [
              {
                label: t("chart.hrPreview.actualDate", "Date de réalisation"),
                value: formatDateShort(movement.actualDate),
                muted: true,
              },
            ]
          : []),
      ]}
      clickHint
    />
  );

  const groupPreview = (group: MovementStatusGroup) => {
    const active = group.cells.map((c) => c.movement).filter(isActiveMovement);
    const count = (status: MovementExecutionStatus) =>
      group.cells.filter((c) => c.execution === status).length;
    const realizedPct = shareOfTotal(count("realized"), group.cells.length - count("abandoned"));
    const contributors = departmentContributors(active, executionMovementFte, {
      exclude: [group.label],
    });
    return (
      <HrChartPreview
        title={group.label}
        rows={[
          ...ORDER.filter((status) => count(status) > 0).map((status) => ({
            label: executionLabel(t, status),
            value: String(count(status)),
            marker: { color: STATUS_COLORS[status] },
          })),
          {
            label: t("chart.hrPreview.total", "Total"),
            value: String(group.cells.length),
            strong: true,
          },
          {
            label: t("chart.hrPreview.fteExclAbandoned", "ETP (hors abandons)"),
            value: formatFte(
              active.reduce((sum, m) => sum + executionMovementFte(m), 0),
              { unit: etp }
            ),
          },
          {
            label: t("chart.hrPreview.salaryImpact", "Impact masse salariale"),
            value: formatMillions(
              active.reduce((sum, m) => sum + (m.salaryImpact || 0), 0) / 1_000_000
            ),
          },
          ...(realizedPct !== null
            ? [
                {
                  label: t("chart.hrPreview.realizedRate", "Réalisé / prévu (hors abandons)"),
                  value: formatPct(realizedPct),
                  muted: true,
                },
              ]
            : []),
        ]}
        share={{
          label: t("chart.hrPreview.shareOfMovementCount", "Part des mouvements"),
          pct: shareOfTotal(group.cells.length, totalCells),
        }}
        list={{
          title: t("chart.hrPreview.topDepartments", "Principaux départements"),
          items: contributors.map((c) => ({
            key: c.key,
            label: c.label,
            value: formatFte(c.value, { unit: etp }),
          })),
        }}
      />
    );
  };

  return (
    <ChartHoverArea className="space-y-3">
      {hoveredCell ? (
        <FloatingPreview>{cellPreview(hoveredCell)}</FloatingPreview>
      ) : hoveredGroup ? (
        <FloatingPreview>{groupPreview(hoveredGroup)}</FloatingPreview>
      ) : null}
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
                onMouseEnter={() => setHoveredGroupKey(group.key)}
                onMouseLeave={() =>
                  setHoveredGroupKey((current) => (current === group.key ? null : current))
                }
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
                    {cells.map((cell) => {
                      const { movement, execution } = cell;
                      const StatusIcon = ICON[execution];
                      return (
                        <button
                          key={movement.id}
                          type="button"
                          onClick={() => onMovementClick(movement.id)}
                          onMouseEnter={() => setHoveredCellId(movement.id)}
                          onMouseLeave={() =>
                            setHoveredCellId((current) =>
                              current === movement.id ? null : current
                            )
                          }
                          className={`flex h-[21px] items-center justify-center rounded-[2px] transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-black ${STYLE[execution]}`}
                          aria-label={`${movement.label} · ${movementTypeLabel(t, movement.type)} · ${executionLabel(t, execution)}`}
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
                <div className="mt-1.5 truncate text-center text-[10.5px] font-semibold text-secondary">
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
    </ChartHoverArea>
  );
}
