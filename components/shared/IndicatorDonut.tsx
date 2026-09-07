"use client";

import { RadialProgress } from "@/components/shared/RadialProgress";
import type { IndicatorDelta } from "@/lib/axisLogic";

/**
 * Camembert (jauge circulaire) d'UN indicateur — round 7, point 3 : remplace le trio
 * badge de statut + sparkline + barre de delta par un signal unique, à la fois sur le tableau de
 * bord stratégique (`IndicatorStatusSummary.tsx`) et sur la page KPI (`KpiPageClient.tsx`).
 *
 * Fine enveloppe autour de `RadialProgress` (déjà générique via ses props — AUCUNE modification de
 * ce composant partagé, conformément au plan) :
 *  - taille par défaut (`size=44`) BEAUCOUP plus petite que le "hero" de `IndicatorStatusSummary`
 *    (`size=80`, jauge de PORTEFEUILLE) : ce composant orne une carte INDIVIDUELLE, à côté d'un nom
 *    d'indicateur, pas au-dessus d'une grille de cartes ;
 *  - couleur résolue depuis `IndicatorDelta.favorable`, avec EXACTEMENT les mêmes teintes que
 *    `IndicatorDeltaStat` (rag-green-dark/rag-green-light si favorable, rag-amber/rag-amber-light
 *    sinon) — hex en dur comme `IndicatorStatusSummary.RADIAL_ON_TRACK_COLOR`, un attribut SVG
 *    `stroke` ne résout pas les variables CSS de façon fiable sur tous les moteurs de rendu ;
 *  - repli neutre (gris `--n-300`/`--n-100`, déjà utilisés ailleurs dans l'app comme tons neutres,
 *    anneau à 0%) si `delta` est `undefined` (indicateur sans objectif chiffré ou sans mesure
 *    exploitable, voir `computeIndicatorDelta`) — le pourcentage à 0 reste visuellement neutre
 *    (anneau vide) plutôt qu'un plantage ; `aria-label`/`title` disent explicitement « aucune
 *    donnée » pour ne pas laisser croire à un score réel de 0%.
 *
 * Le pourcentage affiché est TOUJOURS `delta.progressPct`, tel que fourni par l'appelant via
 * `computeIndicatorDelta(indicator, latestMeasurement)` — aucun nouveau calcul ici.
 */

// Mêmes teintes que `IndicatorDeltaStat.tsx` (text-rag-green-dark / bg-rag-green-light pour
// favorable, text-rag-amber / bg-rag-amber-light sinon) — valeurs `app/globals.css` reprises en
// dur pour la même raison que `RADIAL_ON_TRACK_COLOR` (`IndicatorStatusSummary.tsx`).
const FAVORABLE = { color: "#000000", trackColor: "#f0f0f0" };
const UNFAVORABLE = { color: "#806659", trackColor: "#e7dedb" };
// Neutre : tokens gris déjà existants (`--n-300`/`--n-100`), pas de nouvelle couleur inventée.
const NO_DATA = { color: "#c4c4c4", trackColor: "#f0f0f0" };

export function IndicatorDonut({
  delta,
  size = 44,
  strokeWidth = 5,
  labels,
  className,
}: {
  /** `undefined` = pas d'objectif chiffré ou pas de mesure numérique exploitable (voir
   *  `computeIndicatorDelta`) — état neutre plutôt qu'un plantage ou un pourcentage inventé. */
  delta: IndicatorDelta | undefined;
  size?: number;
  strokeWidth?: number;
  /** Libellés traduits pour l'infobulle/`aria-label` — le texte visible ("à risque" / "sur la
   *  trajectoire") disparaît des deux appelants au profit de ce seul camembert. */
  labels?: { onTrack?: string; atRisk?: string; noData?: string };
  className?: string;
}) {
  const l = {
    onTrack: labels?.onTrack ?? "Sur la trajectoire",
    atRisk: labels?.atRisk ?? "À risque",
    noData: labels?.noData ?? "Aucune donnée",
  };

  const tone = !delta ? NO_DATA : delta.favorable ? FAVORABLE : UNFAVORABLE;
  const pct = delta ? delta.progressPct : 0;
  const statusLabel = !delta ? l.noData : delta.favorable ? l.onTrack : l.atRisk;
  const title = delta ? `${statusLabel} · ${Math.round(pct)}%` : statusLabel;

  return (
    <div role="img" aria-label={title} title={title} className={className}>
      <RadialProgress
        pct={pct}
        size={size}
        strokeWidth={strokeWidth}
        color={tone.color}
        trackColor={tone.trackColor}
      />
    </div>
  );
}
