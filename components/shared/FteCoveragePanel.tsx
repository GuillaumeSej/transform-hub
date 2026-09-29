"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { Tooltip } from "@/components/shared/Tooltip";
import { formatFteValue } from "@/lib/hrEngine";
import type { FteCoverage } from "@/lib/fteCoverage";

/** Bandeau « ETP visés par les leviers · couverts par des mouvements · reste à couvrir » du
 *  Dashboard RH — même langage visuel que `HrKPICard` (filet d'accent à gauche, fond blanc).
 *  Calcul : `lib/fteCoverage.ts` (fonction pure testée). `note` : périmètre non applicable aux
 *  leviers (filtres propres aux mouvements, plage de dates…). */
export function FteCoveragePanel({
  coverage,
  note,
  className,
}: {
  coverage: FteCoverage;
  note?: string | null;
  className?: string;
}) {
  const { t, locale } = useTranslation();
  const fmt = (n: number) => formatFteValue(n, locale);
  const signed = (n: number) => (Math.round(n * 10) / 10 > 0 ? `+${fmt(n)}` : fmt(n));

  const gapFigure =
    coverage.status === "exceeded"
      ? {
          label: t("hr.fteCoverage.exceeded", "Couverture dépassée de"),
          value: fmt(coverage.exceeded),
        }
      : {
          label: t("hr.fteCoverage.remaining", "Reste à couvrir"),
          value: fmt(coverage.remaining),
        };

  const figures = [
    {
      label: t("hr.fteCoverage.levers", "Visés par les leviers"),
      value: signed(coverage.leverFte),
    },
    {
      label: t("hr.fteCoverage.movements", "Couverts par des mouvements"),
      value: signed(coverage.movementFte),
    },
    gapFigure,
  ];

  return (
    <div
      className={cn("relative border-l-[3px] border-black bg-white p-4", className)}
      data-testid="fte-coverage-panel"
    >
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-tertiary">
        {t("hr.fteCoverage.title", "Couverture des ETP visés (ETP)")}
        <Tooltip
          text={t(
            "hr.fteCoverage.tooltip",
            "Leviers : ambition ETP déclarée sur les leviers du programme (même chiffre que le Pilotage global). Mouvements : mouvements RH nominatifs (par personne) planifiés ou réalisés. Reste à couvrir : réductions visées par les leviers qui ne sont pas encore affectées à une personne."
          )}
          position="bottom"
        >
          <Info size={11} className="shrink-0 text-tertiary" />
        </Tooltip>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        {figures.map((f, i) => (
          <div key={i} className="flex items-baseline gap-2">
            <span className="text-[12px] text-secondary">{f.label} :</span>
            <span className="text-[20px] font-bold leading-none tracking-tight tabular-nums text-primary">
              {f.value}
            </span>
          </div>
        ))}
      </div>
      {coverage.leverFte !== 0 && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-bp-coral"
            style={{ width: `${coverage.coveragePct}%` }}
          />
        </div>
      )}
      {coverage.status === "noLeverTarget" && (
        <div className="mt-1.5 text-[11px] text-tertiary">
          {t(
            "hr.fteCoverage.noLeverTarget",
            "Aucun ETP n'est visé par les leviers de ce périmètre."
          )}
        </div>
      )}
      {note && <div className="mt-1.5 text-[11px] text-tertiary">{note}</div>}
    </div>
  );
}
