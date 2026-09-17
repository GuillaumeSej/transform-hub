"use client";

import { useState } from "react";
import type { LeverHealthGroup, LeverHealthStatus } from "@/lib/leverHealth";

const HEALTH_STYLE: Record<LeverHealthStatus, string> = {
  onTrack: "bg-[#3f9b62]",
  watch: "bg-[#f59e42]",
  critical: "bg-[#ef4444]",
  cancelled: "bg-neutral-400",
};

/** Bordure gauche + fond léger utilisés pour les rectangles de leviers : la couleur reste
 * immédiatement scannable via la bande de couleur, sans passer tout le bloc en couleur saturée
 * (ce qui rendrait le texte blanc illisible en petite taille). */
const HEALTH_CELL_STYLE: Record<LeverHealthStatus, string> = {
  onTrack: "border-l-[#3f9b62] bg-[#3f9b62]/10",
  watch: "border-l-[#f59e42] bg-[#f59e42]/10",
  critical: "border-l-[#ef4444] bg-[#ef4444]/10",
  cancelled: "border-l-neutral-400 bg-neutral-400/10",
};

const HEALTH_ORDER: LeverHealthStatus[] = ["critical", "watch", "onTrack", "cancelled"];

/** Statuts proposés dans les puces de filtre au-dessus de la matrice — "cancelled" est
 * volontairement exclu (statut résiduel, pas un niveau de santé qu'on cherche à filtrer). */
const FILTERABLE_HEALTH: LeverHealthStatus[] = ["critical", "watch", "onTrack"];

export function InitiativeHealthMatrix({
  groups,
  labels,
  onLeverClick,
}: {
  groups: LeverHealthGroup[];
  labels: Record<LeverHealthStatus, string> & { empty: string };
  onLeverClick: (leverId: string) => void;
}) {
  // Filtre de statut géré localement au composant (chips cliquables, même pattern que les
  // compteurs de sévérité du widget Alertes) : "all" = aucun filtre actif.
  const [statusFilter, setStatusFilter] = useState<LeverHealthStatus | "all">("all");

  if (groups.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">{labels.empty}</p>;
  }

  const filteredGroups = groups.map((group) => ({
    ...group,
    cells:
      statusFilter === "all"
        ? group.cells
        : group.cells.filter((cell) => cell.health === statusFilter),
  }));

  return (
    <div className="space-y-3">
      {/* Puces de filtre par statut — cliquer bascule actif/inactif ; état actif = fond plein. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERABLE_HEALTH.map((status) => {
          const isActive = statusFilter === status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter((prev) => (prev === status ? "all" : status))}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold transition ${
                isActive
                  ? `${HEALTH_STYLE[status]} border-transparent text-white`
                  : "border-border bg-white text-secondary hover:border-black hover:text-primary"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-white" : HEALTH_STYLE[status]}`}
              />
              {labels[status]}
            </button>
          );
        })}
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-start gap-3">
          {filteredGroups.map((group) => {
            const cells = [...group.cells].sort(
              (a, b) => HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health)
            );
            return (
              <div key={group.key} className="w-[200px] shrink-0">
                <div
                  className="mb-1.5 line-clamp-2 text-center text-[10.5px] font-semibold text-secondary"
                  title={group.label}
                >
                  {group.label}
                </div>
                <div className="text-center text-[10px] text-tertiary">{group.cells.length}</div>
                <div className="mt-1.5 flex flex-col gap-1 rounded-sm border border-sky-100 bg-sky-50 p-1.5">
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
