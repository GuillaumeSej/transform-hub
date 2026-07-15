"use client";

import { clampPct, daysBetween } from "@/lib/dateUtils";
import type { ActionStatus, LeverAction } from "@/types";

const STATUS_COLOR: Record<ActionStatus, string> = {
  todo: "bg-neutral-300",
  in_progress: "bg-info-blue",
  done: "bg-rag-green",
  delayed: "bg-rag-red",
};

const STATUS_LABEL: Record<ActionStatus, string> = {
  todo: "À faire",
  in_progress: "En cours",
  done: "Fait",
  delayed: "En retard",
};

/** Gantt léger en CSS pur (pas de librairie graphique) — une ligne par action, barre positionnée
 * proportionnellement à la plage de dates du plan, avec un repère "aujourd'hui". */
export function ActionGantt({
  actions,
  onCardClick,
}: {
  actions: LeverAction[];
  onCardClick: (action: LeverAction) => void;
}) {
  if (actions.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-tertiary">
        Aucune action définie pour ce plan.
      </div>
    );
  }

  const minStart = actions.reduce((min, a) => (a.start < min ? a.start : min), actions[0].start);
  const maxEnd = actions.reduce((max, a) => (a.end > max ? a.end : max), actions[0].end);
  const totalDays = Math.max(1, daysBetween(minStart, maxEnd));
  const todayISO = new Date().toISOString().slice(0, 10);
  const todayPct = clampPct((daysBetween(minStart, todayISO) / totalDays) * 100);
  const showToday = todayISO >= minStart && todayISO <= maxEnd;
  const sorted = [...actions].sort((a, b) => (a.start < b.start ? -1 : 1));

  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="space-y-2.5">
        {sorted.map((a) => {
          const left = clampPct((daysBetween(minStart, a.start) / totalDays) * 100);
          const width = Math.max(2, clampPct((daysBetween(a.start, a.end) / totalDays) * 100));
          return (
            <div key={a.id} className="flex items-center gap-3">
              <button
                onClick={() => onCardClick(a)}
                className="w-40 shrink-0 truncate text-left text-xs font-medium text-primary hover:text-primary hover:underline"
                title={a.name}
              >
                {a.name}
              </button>
              <div className="relative h-5 flex-1 rounded-sm bg-neutral-100">
                {showToday && (
                  <div
                    className="absolute bottom-0 top-0 w-px bg-bp-coral/70"
                    style={{ left: `${todayPct}%` }}
                  />
                )}
                <button
                  onClick={() => onCardClick(a)}
                  className={`absolute bottom-0 top-0 rounded-sm ${STATUS_COLOR[a.status]} transition hover:opacity-80`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${a.name} · ${STATUS_LABEL[a.status]} · ${a.start} → ${a.end}`}
                />
              </div>
            </div>
          );
        })}
      </div>
      {showToday && (
        <div className="mt-3 flex items-center gap-1.5 text-[10.5px] text-tertiary">
          <span className="inline-block h-2.5 w-px bg-bp-coral/70" /> Aujourd&apos;hui
        </div>
      )}
    </div>
  );
}
