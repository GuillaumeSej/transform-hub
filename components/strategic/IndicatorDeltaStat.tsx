"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IndicatorDelta } from "@/lib/axisLogic";

/**
 * Écart signé d'un indicateur par rapport à sa cible + barre de progression vers cette cible.
 *
 * Corrige le constat du PO (round 4, point 1) : un indicateur à 82 % pour une cible à 80 % *a
 * l'air* énorme quand `IndicatorChart` ne dessine qu'une ligne de valeur + une ligne pointillée
 * d'objectif, sans jamais dire À QUEL POINT l'écart est petit. Ce composant est un pur habillage de
 * rendu — tout le calcul (signe, %, progression bornée) vient de `computeIndicatorDelta`
 * (`lib/axisLogic.ts`), seul point de vérité.
 *
 * Palette : les MÊMES tokens RAG binaires que `IndicatorStatusBadge` (rag-green = favorable,
 * rag-amber = défavorable) — pas de 3ᵉ niveau "rouge" introduit ici, cohérent avec le reste du
 * domaine indicateur qui ne connaît que deux états (sur la trajectoire / à risque). La piste de la
 * barre reprend un pas plus clair de la même teinte que le remplissage (`rag-*-light`), pour que
 * l'état se lise sur toute la largeur de la barre (convention "meter" — voir skill dataviz).
 */
export function IndicatorDeltaStat({
  delta,
  /** Unité de la valeur mesurée (ex. "%", "j", "NPS") — repli "pts" si absente. */
  unit,
  /** Rendu resserré (chip seul, sans le sous-libellé de progression) pour un montage dans une
   *  carte KPI ou l'angle d'un graphique — sinon rendu "confortable" avec le pourcentage relatif
   *  affiché en plus de l'écart absolu. */
  compact = false,
  labels,
  className,
}: {
  /** `undefined` (indicateur sans mesure exploitable ou sans objectif chiffré, voir
   *  `computeIndicatorDelta`) : le composant ne rend RIEN plutôt qu'un écart inventé — c'est à
   *  l'appelant de décider s'il affiche autre chose à la place. */
  delta: IndicatorDelta | undefined;
  unit?: string;
  compact?: boolean;
  /** Libellé traduit du sous-titre de progression — fourni par l'appelant (repli français). */
  labels?: { progress?: string };
  className?: string;
}) {
  if (!delta) return null;

  const { delta: value, deltaPct, progressPct, favorable } = delta;

  // Mêmes classes que IndicatorStatusBadge (bg-rag-*-light + text-rag-*[-dark]) : un écart
  // favorable/défavorable est visuellement le même signal qu'un statut on_track/at_risk.
  const tone = favorable
    ? {
        text: "text-rag-green-dark",
        chip: "bg-rag-green-light",
        bar: "bg-rag-green",
        track: "bg-rag-green-light",
      }
    : {
        text: "text-rag-amber",
        chip: "bg-rag-amber-light",
        bar: "bg-rag-amber",
        track: "bg-rag-amber-light",
      };

  const Icon = favorable ? TrendingUp : TrendingDown;

  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  const absValue = Math.abs(value);
  const formattedValue = `${sign}${Number.isInteger(absValue) ? absValue : absValue.toFixed(1)}${
    unit ? ` ${unit}` : " pts"
  }`;
  const pctSign = deltaPct > 0 ? "+" : deltaPct < 0 ? "−" : "";
  const formattedPct = `(${pctSign}${Math.abs(deltaPct).toFixed(1)}%)`;

  const progressLabel = labels?.progress ?? "Progression vers la cible";
  const roundedProgress = Math.round(progressPct);

  return (
    <div
      className={cn("flex flex-col gap-1", className)}
      title={`${formattedValue} ${formattedPct} · ${progressLabel} : ${roundedProgress}%`}
    >
      <div
        className={cn(
          "inline-flex w-fit items-center gap-1 rounded-full py-0.5",
          compact ? "px-1.5" : "px-2",
          tone.chip
        )}
      >
        <Icon size={compact ? 11 : 12} className={tone.text} aria-hidden />
        <span
          className={cn(
            "font-mono font-bold leading-none tabular-nums",
            tone.text,
            compact ? "text-[11px]" : "text-xs"
          )}
        >
          {formattedValue}
        </span>
        {!compact && (
          <span className="text-[10px] font-medium leading-none text-tertiary">{formattedPct}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <div className={cn("h-1 flex-1 overflow-hidden rounded-full", tone.track)}>
          <div
            className={cn("h-full rounded-full transition-[width]", tone.bar)}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="w-8 flex-shrink-0 text-right text-[10px] font-semibold tabular-nums text-tertiary">
          {roundedProgress}%
        </span>
      </div>
    </div>
  );
}
