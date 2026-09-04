"use client";

import { IndicatorDeltaStat } from "@/components/strategic/IndicatorDeltaStat";
import type { IndicatorDelta } from "@/lib/axisLogic";
import type { Indicator } from "@/types";

/**
 * Contenu du `Popover` déclenché par un badge "N à risque" — indicateur par indicateur, nom + écart
 * signé (`IndicatorDeltaStat`, rendu compact). Corrige le constat du PO (round 4, point 2) : le
 * badge affichait un nombre sans jamais dire QUELS indicateurs ni de COMBIEN ils dérapent.
 *
 * Extrait en composant partagé (plutôt que dupliqué) car monté à la fois par `StrategicAxesView.tsx`
 * (badge d'axe en vue "cartes"/"chantiers", badge de chantier en vue "chantiers") et par
 * `AxisKanban.tsx` (badge d'axe en vue kanban) — les trois déclencheurs affichent le même contenu,
 * seule la liste d'indicateurs source change (axe entier vs un seul chantier).
 */
export function AtRiskIndicatorPopoverContent({
  items,
  title,
  progressLabel,
  emptyLabel,
}: {
  items: { indicator: Indicator; delta: IndicatorDelta | undefined }[];
  title: string;
  /** Sous-libellé traduit de la barre de progression (`IndicatorDeltaStat`) — repli français. */
  progressLabel?: string;
  emptyLabel?: string;
}) {
  return (
    <div className="w-64 max-w-[70vw]">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-tertiary">
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-[12px] text-tertiary">{emptyLabel ?? "—"}</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map(({ indicator, delta }) => (
            <li
              key={indicator.id}
              className="border-b border-border pb-2.5 last:border-b-0 last:pb-0"
            >
              <div
                className="mb-1 truncate text-[12px] font-semibold text-primary"
                title={indicator.name}
              >
                {indicator.name}
              </div>
              {delta ? (
                <IndicatorDeltaStat
                  delta={delta}
                  unit={indicator.unit}
                  compact
                  labels={{ progress: progressLabel }}
                />
              ) : (
                <span className="text-[11px] text-tertiary">{indicator.objective}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
