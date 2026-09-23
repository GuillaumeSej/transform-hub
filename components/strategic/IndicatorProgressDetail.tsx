"use client";

import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { formatIndicatorProgress, type IndicatorDelta } from "@/lib/axisLogic";

/**
 * Détail de l'AVANCEMENT d'un indicateur (règle validée PO, voir `IndicatorDelta` dans
 * `lib/axisLogic.ts`) : chiffre principal = avancement vers la CIBLE FINALE depuis la valeur
 * initiale, ligne secondaire = avancement vers la cible du PALIER courant (quand une trajectoire
 * est active), les deux cibles visibles, et une mention "approx." quand le calcul retombe sur
 * l'ancien ratio faute de valeur initiale. Pur habillage — aucun calcul ici.
 *
 * La barre plafonne son remplissage à 100% ; le chiffre affiche la valeur réelle (ex. 112%).
 */
export function IndicatorProgressDetail({
  delta,
  unit,
  compact = false,
  className,
}: {
  /** `undefined` → rien n'est rendu (pas d'objectif chiffré ou pas de mesure exploitable). */
  delta: IndicatorDelta | undefined;
  unit?: string;
  /** Sans barre ni ligne de valeur initiale — pour une carte étroite. */
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!delta) return null;

  const u = unit ? ` ${unit}` : "";
  const fmt = (v: number) => `${Number.isInteger(v) ? v : Number(v.toFixed(2))}${u}`;
  const hasStep = delta.stepPeriod !== undefined;
  const barTone = delta.favorable ? "bg-rag-green" : "bg-rag-amber";
  const trackTone = delta.favorable ? "bg-rag-green-light" : "bg-rag-amber-light";

  return (
    <div className={cn("flex flex-col gap-1 text-[11px] text-tertiary", className)}>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="font-semibold uppercase tracking-wide">
          {t("kpi.progress.label", "Avancement")}
        </span>
        <span className="text-sm font-bold tabular-nums text-primary">
          {formatIndicatorProgress(delta.progressToFinalPct, delta.approximate)}
        </span>
        <span>{t("kpi.progress.toFinalShort", "vers la cible finale")}</span>
      </div>
      {!compact && (
        <div className={cn("h-1 overflow-hidden rounded-full", trackTone)}>
          <div
            className={cn("h-full rounded-full transition-[width]", barTone)}
            style={{ width: `${Math.min(100, delta.progressToFinalPct)}%` }}
          />
        </div>
      )}
      {hasStep && (
        <div className="tabular-nums">
          {t("kpi.progress.step", "Palier")} {delta.stepPeriod} :{" "}
          <span className="font-semibold text-secondary">
            {formatIndicatorProgress(delta.progressToStepPct, delta.stepApproximate)}
          </span>{" "}
          ({t("kpi.progress.targetShort", "cible")} {fmt(delta.stepTarget)})
        </div>
      )}
      {/* En compact sans trajectoire, la carte appelante affiche déjà l'objectif : pas de doublon. */}
      {(!compact || hasStep) && (
        <div className="flex flex-wrap gap-x-2 tabular-nums">
          {hasStep && (
            <span>
              {t("kpi.progress.stepTarget", "Cible palier")} : {fmt(delta.stepTarget)}
            </span>
          )}
          <span>
            {t("kpi.progress.finalTarget", "Cible finale")} : {fmt(delta.finalTarget)}
          </span>
          {!compact && delta.baseline !== undefined && (
            <span>
              {t("kpi.progress.baseline", "Valeur initiale")} : {fmt(delta.baseline)}
            </span>
          )}
        </div>
      )}
      {(delta.approximate || delta.stepApproximate) && (
        <div className="italic">
          {t("kpi.progress.approxNote", "approx. — sans valeur initiale exploitable")}
        </div>
      )}
    </div>
  );
}
