"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { Tooltip } from "@/components/shared/Tooltip";
import { formatFteValue, formatHeadcount, type HeadcountFigure } from "@/lib/hrEngine";
import type { FteCoverage } from "@/lib/fteCoverage";

/** Onglets de la fiche ETP ouvrables depuis la carte. */
export type HrFteDetailTab = "lever" | "movements" | "coverage";

/** Trajectoire d'effectif absolue du périmètre (null si la baseline n'est pas scopable). */
export type HrFteHeadcount = {
  start: HeadcountFigure;
  now: HeadcountFigure;
  target: number;
  landing: number;
  /** Atterrissage − cible, arrondi au dixième (0 = conforme). */
  landingGap: number;
};

/**
 * Carte ETP unique du Dashboard RH — fusionne ce qui était affiché trois fois (barre « Démarrage →
 * Actuel → Cible », carte « Impact ETP », bandeau « Couverture des ETP visés ») :
 *   - gros chiffre = Impact ETP réalisé, badge = réalisé / planifié ;
 *   - UNE barre à trois niveaux, sur l'échelle de l'ambition des leviers : réalisé (plein),
 *     planifié par les mouvements (clair), visé par les leviers (fond) ;
 *   - légende cliquable = réalisé · planifié · visé · reste à couvrir (chaque élément ouvre l'onglet
 *     correspondant de la fiche `HrKpiDetailModal` via `onOpen`) ;
 *   - ligne d'effectif absolu (démarrage → actuel → cible) en contexte, personnes en infobulle.
 * Calcul de couverture : `lib/fteCoverage.ts`.
 */
export function HrFteCard({
  realized,
  planned,
  reforecast,
  pct,
  coverage,
  headcount,
  note,
  baselineNote,
  infoTooltip,
  className,
  onOpen,
}: {
  /** Impact ETP des mouvements réalisés (signé). */
  realized: number;
  /** Impact ETP de tous les mouvements (réalisés + planifiés), signé. */
  planned: number;
  reforecast: number;
  /** Réalisé / planifié, entier. */
  pct: number;
  coverage: FteCoverage;
  headcount: HrFteHeadcount | null;
  /** Périmètre non applicable aux leviers (filtres propres aux mouvements, plage…). */
  note?: string | null;
  /** Message affiché à la place de l'effectif absolu quand la baseline n'est pas scopable. */
  baselineNote?: string;
  infoTooltip?: string;
  className?: string;
  /** Ouvre la fiche détaillée sur l'onglet voulu (carte entière → « Par levier »). */
  onOpen?: (tab: HrFteDetailTab) => void;
}) {
  const { t, locale } = useTranslation();
  const fmt = (n: number) => formatFteValue(n, locale);
  const signed = (n: number) => (Math.round(n * 10) / 10 > 0 ? `+${fmt(n)}` : fmt(n));

  // Échelle commune : la plus grande des trois ambitions (valeurs absolues, les réductions sont
  // négatives) — le fond de barre représente l'ambition des leviers quand elle domine.
  const scale = Math.max(Math.abs(coverage.leverFte), Math.abs(planned), Math.abs(realized), 1e-9);
  const w = (n: number) => `${Math.min(100, (Math.abs(n) / scale) * 100)}%`;
  const reforecastDiffers = fmt(reforecast) !== fmt(planned);
  const hasLevers = coverage.leverFte !== 0;

  const gap =
    coverage.status === "exceeded"
      ? {
          label: t("hr.fteCoverage.exceeded", "Couverture dépassée de"),
          value: fmt(coverage.exceeded),
        }
      : {
          label: t("hr.fteCoverage.remaining", "Reste à couvrir"),
          value: fmt(coverage.remaining),
        };

  return (
    <div
      className={cn(
        "flex flex-col border-l-[3px] border-black bg-white p-4 tabular-nums",
        onOpen && "cursor-pointer transition hover:shadow-md",
        className
      )}
      data-testid="hr-fte-card"
      onClick={onOpen ? () => onOpen("lever") : undefined}
      title={onOpen ? t("hr.kpi.openDetail", "Voir le détail") : undefined}
    >
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-tertiary">
        {t("hr.kpi.fteImpact", "Impact ETP")}
        {infoTooltip && (
          <Tooltip text={infoTooltip} position="bottom">
            <Info size={11} className="shrink-0 text-tertiary" />
          </Tooltip>
        )}
      </div>

      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="whitespace-nowrap text-[24px] font-bold leading-none tracking-tight text-primary">
          {signed(realized)}
          <span className="ml-1.5 text-[12px] font-medium text-tertiary">
            {t("hr.fteCard.realizedSuffix", "réalisés")}
          </span>
        </span>
        <span
          className="shrink-0 rounded-sm bg-neutral-100 px-1.5 py-0.5 text-[11px] font-bold text-primary"
          title={t("hr.fteCard.pctHint", "Réalisé / planifié par les mouvements")}
        >
          {pct} %
        </span>
      </div>

      {/* Barre à trois niveaux : fond = visé leviers, clair = planifié, plein = réalisé. */}
      <div className="relative mt-2 h-1.5 bg-neutral-100">
        <div className="absolute inset-y-0 left-0 bg-bp-coral/30" style={{ width: w(planned) }} />
        <div className="absolute inset-y-0 left-0 bg-bp-coral" style={{ width: w(realized) }} />
        {reforecastDiffers && (
          <div
            className="absolute -top-0.5 h-2.5 w-[2px] bg-neutral-700"
            style={{ left: w(reforecast) }}
            title={t("hr.kpi.reforecastLabel", "Réactualisé {v}").replace("{v}", fmt(reforecast))}
          />
        )}
      </div>

      {/* Légende cliquable — chaque entrée ouvre l'onglet correspondant de la fiche. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-secondary">
        <LegendItem
          swatch="bg-bp-coral"
          label={t("hr.fteCard.realized", "Réalisé")}
          value={signed(realized)}
          onClick={onOpen && (() => onOpen("movements"))}
        />
        <LegendItem
          swatch="bg-bp-coral/30"
          label={t("hr.fteCard.planned", "Planifié (mouvements)")}
          value={signed(planned)}
          title={
            reforecastDiffers
              ? t("hr.kpi.reforecastLabel", "Réactualisé {v}").replace("{v}", fmt(reforecast))
              : t("hr.kpi.reforecastSameAsTarget", "Réactualisé identique à la cible")
          }
          onClick={onOpen && (() => onOpen("lever"))}
        />
        {hasLevers && (
          <>
            <LegendItem
              swatch="bg-neutral-200"
              label={t("hr.fteCard.levers", "Visé (leviers)")}
              value={signed(coverage.leverFte)}
              onClick={onOpen && (() => onOpen("coverage"))}
            />
            <LegendItem
              label={gap.label}
              value={gap.value}
              title={t(
                "hr.fteCard.coveragePct",
                "{pct} % de l'ambition des leviers couverte"
              ).replace("{pct}", String(Math.round(coverage.coveragePct)))}
              onClick={onOpen && (() => onOpen("coverage"))}
            />
          </>
        )}
      </div>

      <div className="mt-2 border-t border-neutral-100 pt-1.5 text-[11px] text-tertiary">
        {headcount ? (
          <span className="flex flex-wrap items-center gap-x-1.5">
            {t("hr.fteCard.headcount", "Effectif")}
            <span
              title={t("hr.startHeadcountLine", "Effectif au démarrage du programme : {n}").replace(
                "{n}",
                formatHeadcount(headcount.start, t, locale)
              )}
            >
              {fmt(headcount.start.fte)}
            </span>
            →
            <span
              className="font-semibold text-secondary"
              title={`${t("hr.currentHeadcountLabel", "Effectif actuel :")} ${formatHeadcount(headcount.now, t, locale)}`}
            >
              {fmt(headcount.now.fte)}
            </span>
            →
            <span
              title={
                headcount.landingGap === 0
                  ? t("hr.landingOnTarget", "Atterrissage conforme à la cible ({n} ETP)").replace(
                      "{n}",
                      fmt(headcount.landing)
                    )
                  : undefined
              }
            >
              {t("hr.fteCard.targetShort", "cible")} {fmt(headcount.target)}{" "}
              {t("etp.column.fte", "ETP")}
            </span>
            {headcount.landingGap !== 0 && (
              <span>
                ({t("hr.landingPrefix", "Atterrissage")} {fmt(headcount.landing)},{" "}
                {headcount.landingGap > 0 ? "+" : ""}
                {fmt(headcount.landingGap)} {t("hr.vsTarget", "vs cible")})
              </span>
            )}
          </span>
        ) : (
          baselineNote
        )}
        {coverage.status === "noLeverTarget" && (
          <div className="mt-0.5">
            {t(
              "hr.fteCoverage.noLeverTarget",
              "Aucun ETP n'est visé par les leviers de ce périmètre."
            )}
          </div>
        )}
        {/* La couverture ne compte que les mouvements RATTACHÉS aux leviers du périmètre
            (`leverFteCoverage`, même chiffre que le dashboard Performance) : quand des mouvements
            sans levier existent, le « Planifié (mouvements) » diffère — on l'explicite. */}
        {hasLevers && fmt(coverage.movementFte) !== fmt(planned) && (
          <div className="mt-0.5">
            {t(
              "hr.fteCard.coverageBasis",
              "Couverture calculée sur les {n} ETP des seuls mouvements rattachés aux leviers du périmètre, hors leviers abandonnés."
            ).replace("{n}", signed(coverage.movementFte))}
          </div>
        )}
        {note && <div className="mt-0.5">{note}</div>}
      </div>
    </div>
  );
}

/** Entrée de légende : pastille + libellé + valeur ; bouton quand `onClick` est fourni (le clic ne
 *  remonte pas à la carte, qui ouvrirait un autre onglet). */
function LegendItem({
  swatch,
  label,
  value,
  title,
  onClick,
}: {
  swatch?: string;
  label: string;
  value: string;
  title?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      {swatch && <span aria-hidden className={`h-2 w-2 shrink-0 ${swatch}`} />}
      {label} <strong className="text-primary">{value}</strong>
    </>
  );
  if (!onClick) {
    return (
      <span className="flex items-center gap-1" title={title}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex items-center gap-1 hover:text-primary hover:underline"
    >
      {content}
    </button>
  );
}
