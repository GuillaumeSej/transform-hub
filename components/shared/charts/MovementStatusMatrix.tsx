"use client";

import { Ban, CalendarDays, Check, Clock, TriangleAlert, type LucideIcon } from "lucide-react";
import type { MovementExecutionStatus, MovementStatusGroup } from "@/lib/hrExecution";
import { EXECUTION_LABELS } from "@/lib/hrExecution";
import { useTranslation } from "@/lib/i18n/useTranslation";

const STYLE: Record<MovementExecutionStatus, string> = {
  realized: "bg-[#421799]",
  overdue: "bg-[#FF3C47]",
  dueSoon: "bg-[#FFB1B5]",
  later: "bg-[#A99E9A]",
  abandoned: "bg-[#806659]",
};
/** Icône affichée DANS chaque tuile pour que le statut se lise sans survol : un triangle
 * d'alerte pour le retard, une horloge pour l'échéance proche (< 90 j) vs un calendrier pour
 * l'échéance lointaine (> 90 j) — deux pictos volontairement distincts bien que les deux statuts
 * soient tous deux « à venir » — un check pour le réalisé, un interdit pour l'abandonné. */
const ICON: Record<MovementExecutionStatus, LucideIcon> = {
  realized: Check,
  overdue: TriangleAlert,
  dueSoon: Clock,
  later: CalendarDays,
  abandoned: Ban,
};
/** Couleur d'icône par statut, câblée en dur (pas de helper de luminance partagé hors de
 * `components/strategic`) : blanc sur les 3 fonds sombres (violet/rouge/brun), teinte sombre sur
 * les 2 fonds clairs (rose pâle/gris moyen) pour rester lisible. */
const ICON_COLOR: Record<MovementExecutionStatus, string> = {
  realized: "text-white",
  overdue: "text-white",
  dueSoon: "text-[#1f1512]",
  later: "text-[#1f1512]",
  abandoned: "text-white",
};
const ORDER: MovementExecutionStatus[] = ["overdue", "dueSoon", "later", "realized", "abandoned"];

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
  if (groups.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("shared.executionStatusChart.noData", "Aucun mouvement à afficher.")}
      </p>
    );
  }
  const maxRows = Math.max(...groups.map((group) => Math.ceil(group.cells.length / 4)));
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-end gap-3">
          {groups.map((group) => {
            const cells = [...group.cells].sort(
              (a, b) => ORDER.indexOf(a.execution) - ORDER.indexOf(b.execution)
            );
            return (
              <div key={group.key} className="w-[144px] shrink-0">
                <div
                  className="flex items-end rounded-sm border border-sky-100 bg-sky-50 p-1.5"
                  style={{ minHeight: `${maxRows * 34 + 12}px` }}
                >
                  <div className="grid w-full grid-cols-4 gap-1.5">
                    {cells.map(({ movement, execution }) => {
                      const StatusIcon = ICON[execution];
                      return (
                        <button
                          key={movement.id}
                          type="button"
                          onClick={() => onMovementClick(movement.id)}
                          className={`flex h-[28px] items-center justify-center rounded-[3px] transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-black ${STYLE[execution]}`}
                          title={`${movement.label} · ${movement.type}\n${EXECUTION_LABELS[execution]} · ${movement.fte} ETP\n${t("shared.movementStatusMatrix.initiativeLabel", "Initiative")} : ${getInitiativeLabel?.(movement.leverId) ?? movement.leverId}\n${t("etp.filter.hrOwnerMovement", "RH Owner")} : ${movement.hrOwner}\n${t("etp.column.plannedDate", "Date prévue")} : ${movement.plannedDate}`}
                          aria-label={`${movement.label} ${EXECUTION_LABELS[execution]}`}
                        >
                          <StatusIcon
                            aria-hidden
                            size={14}
                            strokeWidth={2.5}
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
            {EXECUTION_LABELS[status]}
          </span>
        ))}
      </div>
    </div>
  );
}
