"use client";

import { cn } from "@/lib/utils";
import { fmtCurr } from "@/lib/engine";
import type { ActionStatus, LeverAction } from "@/types";

const COLUMNS: { status: ActionStatus; label: string }[] = [
  { status: "todo", label: "À faire" },
  { status: "in_progress", label: "En cours" },
  { status: "done", label: "Fait" },
  { status: "delayed", label: "En retard" },
];

/** Kanban du plan d'action — même langage visuel que components/shared/Kanban.tsx, changement de
 * statut via un petit groupe de boutons sur la carte (pas de drag-and-drop, garde le composant
 * simple et sans nouvelle dépendance). */
export function ActionKanban({
  actions,
  onStatusChange,
  onCardClick,
}: {
  actions: LeverAction[];
  onStatusChange: (actionId: string, status: ActionStatus) => void;
  onCardClick: (action: LeverAction) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2">
      {COLUMNS.map((col) => {
        const list = actions.filter((a) => a.status === col.status);
        return (
          <div
            key={col.status}
            className="min-h-[160px] rounded-lg border border-border bg-neutral-50 p-2.5"
          >
            <div className="flex items-center justify-between px-2 pb-2.5 pt-1">
              <div className="text-[11.5px] font-bold uppercase tracking-wide text-primary">
                {col.label}
              </div>
              <div className="rounded-full border border-border bg-white px-1.5 py-px text-[10px] font-semibold text-secondary">
                {list.length}
              </div>
            </div>
            {list.length === 0 && (
              <div className="py-5 text-center text-[11px] text-tertiary">Aucune action</div>
            )}
            {list.map((a) => (
              <div key={a.id} className="mb-2 rounded-sm border border-border bg-white p-2.5">
                <button
                  onClick={() => onCardClick(a)}
                  className="mb-1.5 block w-full text-left text-xs font-semibold text-primary hover:text-primary hover:underline"
                >
                  {a.name}
                </button>
                <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10.5px] text-tertiary">
                  <span>
                    {a.start} → {a.end}
                  </span>
                  <span className="font-semibold text-secondary">{fmtCurr(a.cost / 1000, 0)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {COLUMNS.map((c) => (
                    <button
                      key={c.status}
                      onClick={() => onStatusChange(a.id, c.status)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[9.5px] font-semibold transition",
                        a.status === c.status
                          ? "border-bp-coral bg-black text-white"
                          : "border-border bg-white text-secondary hover:border-black"
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
