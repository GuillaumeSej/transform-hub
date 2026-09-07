"use client";

import { AtRiskCountPill } from "@/components/strategic/AtRiskCountPill";
import { AxisStageBadge } from "@/components/strategic/AxisStageBadge";
import { chantierAtRiskIndicators, milestoneProgressPct } from "@/lib/axisLogic";
import type { Chantier, Indicator, IndicatorMeasurement, MaturityStageConfig } from "@/types";

/**
 * Ligne compacte "chantier" — nom, badge d'étape (`AxisStageBadge`), barre d'avancement dérivée des
 * jalons E0→E4 (`milestoneProgressPct`) et pastille "N à risque" (`AtRiskCountPill`), toute la ligne
 * cliquable. Round 6, point 0 : extraite du bloc identique déjà utilisé par l'onglet "Chantiers" de
 * `StrategicAxesView.tsx` (en-tête + badge + avancement d'une carte de chantier, hors liste d'actions
 * — celle-ci reste spécifique à cette vue-là), pour être réutilisée telle quelle dans le futur Kanban
 * par axe et le futur widget dashboard "Répartition par axe" (round 6, points 3-5).
 *
 * `onOpen` est un simple callback : cette ligne ne décide jamais elle-même de ce que "ouvrir"
 * signifie (navigation, panneau…) — c'est à l'appelant de le câbler.
 */
export function ChantierProgressRow({
  chantier,
  stages,
  indicators,
  measurements,
  onOpen,
  labels,
  className,
}: {
  chantier: Chantier;
  /** Étapes du programme, déjà triées par `order` (voir `useMaturityStages`). */
  stages: MaturityStageConfig[];
  indicators: Indicator[];
  measurements: IndicatorMeasurement[];
  onOpen: (chantierId: string) => void;
  labels?: {
    atRisk?: string;
    atRiskPopoverTitle?: string;
    atRiskTooltip?: string;
    progress?: string;
  };
  className?: string;
}) {
  const progressPct = milestoneProgressPct(chantier);
  const atRiskItems = chantierAtRiskIndicators(chantier.id, indicators, measurements);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(chantier.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(chantier.id);
        }
      }}
      className={
        className ??
        "flex cursor-pointer items-center gap-2 rounded-md border border-border bg-white p-2 text-left transition hover:-translate-y-px hover:border-black hover:shadow-sm"
      }
    >
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[12px] font-semibold text-primary"
          title={chantier.name}
        >
          {chantier.name}
        </span>
        <span className="mt-1 flex items-center gap-1.5">
          <span className="h-1 flex-1 max-w-[120px] overflow-hidden rounded-full bg-neutral-100">
            <span
              className="block h-full rounded-full bg-bp-warm-taupe"
              style={{ width: `${progressPct}%` }}
            />
          </span>
          <span className="shrink-0 text-[10px] font-bold text-secondary">{progressPct}%</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <AxisStageBadge stageId={chantier.stage} stages={stages} />
        <AtRiskCountPill
          count={atRiskItems.length}
          items={atRiskItems}
          title={labels?.atRiskPopoverTitle ?? "Indicateurs à risque"}
          label={labels?.atRisk ?? "à risque"}
          progressLabel={labels?.progress}
          tooltip={labels?.atRiskTooltip}
        />
      </span>
    </div>
  );
}
