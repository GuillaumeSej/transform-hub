"use client";

import type { LeverHealthGroup, LeverHealthStatus } from "@/lib/leverHealth";

const HEALTH_STYLE: Record<LeverHealthStatus, string> = {
  onTrack: "bg-[#3f9b62]",
  watch: "bg-[#f59e42]",
  critical: "bg-[#ef4444]",
  cancelled: "bg-neutral-400",
};

const HEALTH_ORDER: LeverHealthStatus[] = ["critical", "watch", "onTrack", "cancelled"];

export function InitiativeHealthMatrix({
  groups,
  labels,
  onLeverClick,
}: {
  groups: LeverHealthGroup[];
  labels: Record<LeverHealthStatus, string> & { empty: string };
  onLeverClick: (leverId: string) => void;
}) {
  if (groups.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">{labels.empty}</p>;
  }

  const maxRows = Math.max(...groups.map((group) => Math.ceil(group.cells.length / 4)));

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-end gap-3">
          {groups.map((group) => {
            const cells = [...group.cells].sort(
              (a, b) => HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health)
            );
            return (
              <div key={group.key} className="w-[108px] shrink-0">
                <div
                  className="flex items-end rounded-sm border border-sky-100 bg-sky-50 p-1.5"
                  style={{ minHeight: `${maxRows * 22 + 12}px` }}
                >
                  <div className="grid w-full grid-cols-4 gap-1">
                    {cells.map(({ lever, health, computedRisk, activeAlertCount }) => (
                      <button
                        key={lever.id}
                        type="button"
                        onClick={() => onLeverClick(lever.id)}
                        className={`h-[18px] rounded-[2px] transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-black ${HEALTH_STYLE[health]}`}
                        title={`${lever.code} · ${lever.name}\n${labels[health]} · Risque ${computedRisk}\n${lever.owner} · ${activeAlertCount} alerte(s) active(s)`}
                        aria-label={`${lever.code} ${lever.name} ${labels[health]}`}
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
        {HEALTH_ORDER.map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-[2px] ${HEALTH_STYLE[status]}`} />
            {labels[status]}
          </span>
        ))}
      </div>
    </div>
  );
}
