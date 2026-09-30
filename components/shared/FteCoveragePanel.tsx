"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { Tooltip } from "@/components/shared/Tooltip";
import { formatFteValue } from "@/lib/hrEngine";
import type { FteCoverage } from "@/lib/fteCoverage";

/** Bandeau fin « ETP visés par les leviers · couverts par des mouvements · reste à couvrir » du
 *  Dashboard RH — une seule ligne (titre · barre de couverture · chiffres compacts), filet d'accent
 *  à gauche, fond blanc. Les libellés longs restent disponibles en `title`.
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
          short: t("hr.fteCoverage.exceededShort", "Dépassement"),
          full: t("hr.fteCoverage.exceeded", "Couverture dépassée de"),
          value: fmt(coverage.exceeded),
        }
      : {
          short: t("hr.fteCoverage.remainingShort", "Reste"),
          full: t("hr.fteCoverage.remaining", "Reste à couvrir"),
          value: fmt(coverage.remaining),
        };

  const figures = [
    {
      short: t("hr.fteCoverage.leversShort", "Leviers"),
      full: t("hr.fteCoverage.levers", "Visés par les leviers"),
      value: signed(coverage.leverFte),
    },
    {
      short: t("hr.fteCoverage.movementsShort", "Mouvements"),
      full: t("hr.fteCoverage.movements", "Couverts par des mouvements"),
      value: signed(coverage.movementFte),
    },
    gapFigure,
  ];

  const pct = Math.max(0, Math.min(100, coverage.coveragePct));

  return (
    <div
      className={cn("border-l-[3px] border-black bg-white px-4 py-2.5", className)}
      data-testid="fte-coverage-panel"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <div className="flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-tertiary">
          {t("hr.fteCoverage.titleShort", "Couverture des ETP visés")}
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

        {coverage.leverFte !== 0 ? (
          <div className="flex min-w-[120px] flex-1 items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden bg-neutral-100">
              <div className="h-full bg-bp-coral" style={{ width: `${pct}%` }} />
            </div>
            <span className="shrink-0 text-[12px] font-bold tabular-nums text-primary">
              {Math.round(coverage.coveragePct)} %
            </span>
          </div>
        ) : (
          <div className="hidden flex-1 sm:block" />
        )}

        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          {figures.map((f, i) => (
            <span key={i} className="flex items-baseline gap-1.5" title={`${f.full} : ${f.value}`}>
              {i > 0 && (
                <span aria-hidden className="text-tertiary">
                  ·
                </span>
              )}
              <span className="text-[11px] text-tertiary">{f.short}</span>
              <span className="text-[13px] font-semibold tabular-nums text-primary">{f.value}</span>
            </span>
          ))}
        </div>
      </div>

      {coverage.status === "noLeverTarget" && (
        <div className="mt-1 text-[11px] text-tertiary">
          {t(
            "hr.fteCoverage.noLeverTarget",
            "Aucun ETP n'est visé par les leviers de ce périmètre."
          )}
        </div>
      )}
      {note && <div className="mt-1 text-[11px] text-tertiary">{note}</div>}
    </div>
  );
}
