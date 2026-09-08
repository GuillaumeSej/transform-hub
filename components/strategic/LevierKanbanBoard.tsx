"use client";

import { LevierCard, type LevierBoardCard } from "@/components/strategic/LevierMilestoneBoard";
import type { LevierKanbanStatus } from "@/types";

/**
 * Kanban classique (à faire / en cours / terminé) pour les leviers d'UN axe SANS `indicatorId`
 * (round 8) — même esprit visuel que `components/shared/ActionKanban.tsx` (Plan Performance) mais
 * PURE LECTURE : le changement de statut se fait depuis la fiche chantier (`ChantierDetailPanel.tsx`,
 * fondation), ce dashboard est un tableau de pilotage, pas un outil de saisie. Rendu par
 * `StrategicDashboardView.tsx` juste en dessous de la section E0-E4 (`LevierMilestoneBoard`) d'un
 * même axe, UNIQUEMENT si cet axe a au moins un levier sans KPI (l'appelant décide) — ce composant
 * retourne aussi `null` si `items` est vide, en garde-fou défensif.
 *
 * Même couleur de chantier (`chantierColor`, `colorForChantier`) et même carte visuelle
 * (`LevierCard`) que `LevierMilestoneBoard.tsx`, pour que l'œil reconnaisse un chantier identique
 * entre les deux blocs.
 */

const KANBAN_COLUMNS: LevierKanbanStatus[] = ["todo", "in_progress", "done"];

export function LevierKanbanBoard({
  items,
  labels,
  onLevierClick,
}: {
  items: LevierBoardCard[];
  labels: Record<LevierKanbanStatus, string>;
  onLevierClick: (chantierId: string, focusActionId?: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {KANBAN_COLUMNS.map((status) => {
        const list = items.filter((item) => (item.action.kanbanStatus ?? "todo") === status);
        return (
          <div
            key={status}
            className="min-h-[92px] rounded-lg border border-border bg-neutral-50 p-2"
          >
            <div className="mb-2 flex items-center justify-between px-0.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-secondary">
                {labels[status]}
              </span>
              <span className="rounded-full border border-border bg-white px-1.5 py-px text-[10px] font-semibold text-tertiary">
                {list.length}
              </span>
            </div>
            {list.map((item) => (
              <LevierCard
                key={item.action.id}
                action={item.action}
                chantier={item.chantier}
                chantierColor={item.chantierColor}
                onLevierClick={onLevierClick}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
