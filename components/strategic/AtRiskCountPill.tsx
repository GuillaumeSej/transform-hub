"use client";

import { Popover } from "@/components/shared/Popover";
import { AtRiskIndicatorPopoverContent } from "@/components/strategic/AtRiskIndicatorPopoverContent";
import type { IndicatorDelta } from "@/lib/axisLogic";
import type { Indicator } from "@/types";

/**
 * Pastille "N à risque" + `Popover` déclencheur d'`AtRiskIndicatorPopoverContent` — round 6, point 0.
 * Extrait de la markup identique dupliquée trois fois avant ce round : `StrategicAxesView.tsx` (vue
 * "cartes", badge d'axe ; vue "chantiers", badge de chantier) et `AxisKanban.tsx` (badge d'axe). Les
 * trois déclencheurs n'affichaient que le même bouton `bg-rag-amber-light` ouvrant le même popover,
 * seule la liste d'indicateurs source changeait (axe entier vs un seul chantier) — désormais un
 * unique composant, `items`/`title`/`label` restant à la charge de l'appelant.
 *
 * Round 6, point 4 (clarté) : porte en plus un `tooltip` explicatif sur la pastille elle-même (via
 * l'attribut `title` natif) — le badge affichait un nombre sans jamais dire à quoi correspond
 * l'écart avant l'ouverture du popover.
 *
 * Ne rend rien si `count` est nul ou négatif : l'appelant n'a plus besoin d'entourer le composant
 * d'un `{count > 0 && (...)}`, contrairement aux trois blocs dupliqués remplacés.
 */
export function AtRiskCountPill({
  count,
  items,
  title,
  label,
  progressLabel,
  emptyLabel,
  tooltip,
  className,
}: {
  count: number;
  /** Indicateurs à risque source du popover — voir `chantierAtRiskIndicators`/`axisAtRiskIndicators`
   *  (lib/axisLogic.ts et StrategicAxesView.tsx respectivement), au choix de l'appelant. */
  items: { indicator: Indicator; delta: IndicatorDelta | undefined }[];
  /** Titre du contenu du popover (ex. "Indicateurs à risque"). */
  title: string;
  /** Libellé affiché après le nombre sur la pastille elle-même (ex. "à risque"). */
  label: string;
  /** Sous-libellé traduit de la barre de progression dans le popover (`IndicatorDeltaStat`). */
  progressLabel?: string;
  emptyLabel?: string;
  /** Infobulle native (`title` HTML) sur la pastille — explique ce que "à risque" signifie avant
   *  même l'ouverture du popover (round 6, point 4). */
  tooltip?: string;
  className?: string;
}) {
  if (count <= 0) return null;

  return (
    <Popover
      trigger={({ toggle }) => (
        <button
          type="button"
          title={tooltip}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          className={
            className ??
            "rounded-full bg-rag-amber-light px-2 py-0.5 text-[10.5px] font-semibold text-rag-amber hover:brightness-95"
          }
        >
          {count} {label}
        </button>
      )}
    >
      <AtRiskIndicatorPopoverContent
        items={items}
        title={title}
        progressLabel={progressLabel}
        emptyLabel={emptyLabel}
      />
    </Popover>
  );
}
