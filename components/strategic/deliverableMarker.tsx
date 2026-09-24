"use client";

import { useCallback } from "react";
import { formatTimelineDay } from "@/components/strategic/TimelineBars";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { DeliverableState } from "@/lib/deliverableState";

/**
 * Code visuel UNIQUE des losanges de livrable (décision PO : livrable = échéance, statut binaire
 * Fait / À faire + retard dérivé) — partagé par `ProgramRoadmap.tsx` (feuille de route programme),
 * `ChantierDetailPanel.tsx` (onglet "Timeline" + liste des livrables) et
 * `AxisChantierProjetAccordion.tsx` (étiquettes de livrable). Remplace les 3 copies de l'ancien code
 * 3 couleurs (todo rouge / en cours ambre / fait noir), devenu sans objet sans l'état « En cours ».
 *
 *  - Fait      : losange PLEIN encre (#1a1a1a)
 *  - À faire   : losange CREUX (fond blanc, contour encre)
 *  - En retard : losange PLEIN rouge corail BearingPoint (#FF3C47) — à faire + échéance dépassée
 */
export const DELIVERABLE_INK = "#1a1a1a";
export const DELIVERABLE_LATE_RED = "#ff3c47";

export const DELIVERABLE_MARKER_STYLE: Record<DeliverableState, { fill: string; border: string }> =
  {
    done: { fill: DELIVERABLE_INK, border: "#ffffff" },
    todo: { fill: "#ffffff", border: DELIVERABLE_INK },
    late: { fill: DELIVERABLE_LATE_RED, border: "#ffffff" },
  };

/** Libellés + infobulle « Nom · Échéance 12 mars 2026 · Fait / À faire / En retard de N j ». */
export function useDeliverableStateText() {
  const { t, locale } = useTranslation();
  const stateLabel = useCallback(
    (state: DeliverableState, lateDays = 0): string => {
      if (state === "done") return t("strategicChantierDetail.deliverableState.done", "Fait");
      if (state === "late") {
        return lateDays > 0
          ? t("strategicChantierDetail.deliverableState.lateDays", "En retard de {n} j").replace(
              "{n}",
              String(lateDays)
            )
          : t("strategicChantierDetail.deliverableState.late", "En retard");
      }
      return t("strategicChantierDetail.deliverableState.todo", "À faire");
    },
    [t]
  );
  const tooltip = useCallback(
    (label: string, dueDate: string | undefined, state: DeliverableState, lateDays = 0): string =>
      [
        label,
        dueDate
          ? `${t("strategicChantierDetail.deliverableModal.dueDate", "Échéance")} ${formatTimelineDay(dueDate, locale)}`
          : undefined,
        stateLabel(state, lateDays),
      ]
        .filter(Boolean)
        .join(" · "),
    [t, locale, stateLabel]
  );
  return { stateLabel, tooltip };
}

/** Petit losange statique (liste, étiquette, légende) — même code visuel que `TimelineMarker`. */
export function DeliverableDiamond({
  state,
  size = 8,
  className = "",
}: {
  state: DeliverableState;
  size?: number;
  className?: string;
}) {
  const style = DELIVERABLE_MARKER_STYLE[state];
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-[1px] ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: style.fill,
        // Contour visible seulement pour le losange creux « à faire » : sur fond blanc/clair, le
        // contour blanc des états pleins disparaît de toute façon.
        border: state === "todo" ? `1.5px solid ${style.border}` : "none",
        transform: "rotate(45deg)",
      }}
    />
  );
}

/** Légende minimale sous un Gantt : « ◆ Fait ◇ À faire ◆ En retard ». */
export function DeliverableMarkerLegend({ className = "" }: { className?: string }) {
  const { stateLabel } = useDeliverableStateText();
  const { t } = useTranslation();
  const states: DeliverableState[] = ["done", "todo", "late"];
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-tertiary ${className}`}
    >
      <span className="font-semibold uppercase tracking-wide">
        {t("strategicChantierDetail.deliverableState.legendTitle", "Livrables")}
      </span>
      {states.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <DeliverableDiamond state={s} size={8} />
          {stateLabel(s)}
        </span>
      ))}
    </div>
  );
}
