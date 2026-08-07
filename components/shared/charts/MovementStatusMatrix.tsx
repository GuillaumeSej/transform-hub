"use client";

import type { MovementExecutionStatus, MovementStatusGroup } from "@/lib/hrExecution";
import { EXECUTION_LABELS } from "@/lib/hrExecution";

const STYLE: Record<MovementExecutionStatus, string> = {
  realized: "bg-[#421799]",
  overdue: "bg-[#FF3C47]",
  dueSoon: "bg-[#FFB1B5]",
  later: "bg-[#A99E9A]",
  abandoned: "bg-[#806659]",
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
  if (groups.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucun mouvement à afficher.</p>;
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
              <div key={group.key} className="w-[112px] shrink-0">
                <div
                  className="flex items-end rounded-sm border border-sky-100 bg-sky-50 p-1.5"
                  style={{ minHeight: `${maxRows * 22 + 12}px` }}
                >
                  <div className="grid w-full grid-cols-4 gap-1">
                    {cells.map(({ movement, execution }) => (
                      <button
                        key={movement.id}
                        type="button"
                        onClick={() => onMovementClick(movement.id)}
                        className={`h-[18px] rounded-[2px] transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-black ${STYLE[execution]}`}
                        title={`${movement.label} · ${movement.type}\n${EXECUTION_LABELS[execution]} · ${movement.fte} ETP\nInitiative : ${getInitiativeLabel?.(movement.leverId) ?? movement.leverId}\nRH Owner : ${movement.hrOwner}\nDate prévue : ${movement.plannedDate}`}
                        aria-label={`${movement.label} ${EXECUTION_LABELS[execution]}`}
                      />
                    ))}
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
