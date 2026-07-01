"use client";

import { cn } from "@/lib/utils";
import { Avatar } from "@/components/shared/Avatar";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { fmtCurr } from "@/lib/engine";
import type { Lever, LeverStatus } from "@/types";

const COLUMNS: { status: LeverStatus; label: string }[] = [
  { status: "idea", label: "Idea" },
  { status: "qualified", label: "Qualified" },
  { status: "validated", label: "Validated" },
  { status: "in_progress", label: "In Progress" },
  { status: "delivered", label: "Delivered" },
];

/** Vue kanban du pipeline de leviers par statut — porté depuis `.kanban`/`.kcard` du prototype legacy. */
export function Kanban({
  levers,
  onCardClick,
}: {
  levers: Lever[];
  onCardClick: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-3 max-[1100px]:grid-cols-2">
      {COLUMNS.map((col) => {
        const list = levers.filter((l) => l.status === col.status);
        return (
          <div
            key={col.status}
            className="min-h-[200px] rounded-lg border border-border bg-neutral-50 p-2.5"
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
              <div className="py-5 text-center text-[11px] text-tertiary">Aucun</div>
            )}
            {list.map((l) => (
              <button
                key={l.id}
                onClick={() => onCardClick(l.id)}
                className={cn(
                  "mb-2 block w-full rounded-sm border border-border bg-white p-2.5 text-left transition hover:-translate-y-px hover:border-bp-coral hover:shadow-sm"
                )}
              >
                <div className="mb-1.5 text-xs font-semibold text-primary">{l.name}</div>
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-secondary">
                    {l.code}
                  </span>
                  <span className="text-[12.5px] font-bold text-bp-coral">
                    {fmtCurr(l.netSavings)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <ProgressBar pct={l.progress} showLabel={false} className="flex-1" />
                  <Avatar initials={l.ownerInit} size="sm" />
                </div>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
