"use client";

import type { StageCount } from "@/lib/engine";

/** Avancement des leviers par étape L1-L5 (+ Annulé) — clic pour creuser vers la liste filtrée. */
export function StageFunnel({
  data,
  onStageClick,
}: {
  data: StageCount[];
  onStageClick?: (status: StageCount["status"]) => void;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-2">
      {data.map((d) => (
        <button
          key={d.status}
          onClick={() => onStageClick?.(d.status)}
          className="group flex flex-1 flex-col items-center gap-1.5"
        >
          <span className="text-sm font-bold text-primary">{d.count}</span>
          <div
            className={`w-full rounded-t-sm transition group-hover:opacity-80 ${
              d.status === "cancelled" ? "bg-neutral-300" : "bg-bp-coral"
            }`}
            style={{ height: `${Math.max(6, (d.count / max) * 90)}px` }}
          />
          <span className="text-[13px] font-bold text-secondary">{d.level}</span>
          <span className="text-[10px] uppercase tracking-wide text-tertiary">{d.label}</span>
        </button>
      ))}
    </div>
  );
}
