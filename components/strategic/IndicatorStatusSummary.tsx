"use client";

import { Activity, Sigma, TrendingDown } from "lucide-react";
import { KPICard } from "@/components/shared/KPICard";
import { countOnTrackAtRisk, sumLatestQuantitativeValues } from "@/lib/axisLogic";
import type { Indicator, IndicatorMeasurement } from "@/types";

/**
 * Compteur d'ensemble « N indicateurs suivis · X sur la trajectoire · Y à risque » + cumul des
 * dernières valeurs quantitatives. Affiché en tête de la page KPI ET de la fiche d'un axe (le
 * périmètre passé en `indicators` change, pas le composant).
 *
 * Aucune logique de calcul ici : tout vient de `lib/axisLogic.ts` (seul point de vérité), et le
 * rendu réutilise `KPICard` tel quel — la carte KPI est générique (label/valeur/icône/barre) et
 * ne porte aucune hypothèse financière.
 */
export function IndicatorStatusSummary({
  indicators,
  measurements,
  /** Unité du cumul (ex. "%" n'a aucun sens à cumuler — l'appelant ne passe la carte "cumul" que
   *  quand elle est pertinente, voir `showTotal`). */
  totalUnit,
  showTotal = true,
  labels,
  className,
}: {
  indicators: Indicator[];
  measurements: IndicatorMeasurement[];
  totalUnit?: string;
  showTotal?: boolean;
  /** Libellés traduits fournis par l'appelant (qui a accès à `useTranslation`) — repli français. */
  labels?: {
    tracked?: string;
    onTrack?: string;
    atRisk?: string;
    total?: string;
    indicatorsSuffix?: string;
  };
  className?: string;
}) {
  const { total, onTrack, atRisk } = countOnTrackAtRisk(indicators);
  const cumulative = sumLatestQuantitativeValues(indicators, measurements);
  const onTrackPct = total > 0 ? (onTrack / total) * 100 : 0;
  const atRiskPct = total > 0 ? (atRisk / total) * 100 : 0;

  const l = {
    tracked: labels?.tracked ?? "Indicateurs suivis",
    onTrack: labels?.onTrack ?? "Sur la trajectoire",
    atRisk: labels?.atRisk ?? "À risque",
    total: labels?.total ?? "Cumul des indicateurs",
    indicatorsSuffix: labels?.indicatorsSuffix ?? "indicateurs",
  };

  return (
    <div
      className={
        className ??
        "grid grid-cols-1 gap-3 sm:grid-cols-2 " + (showTotal ? "lg:grid-cols-3" : "lg:grid-cols-2")
      }
    >
      <KPICard
        label={l.onTrack}
        value={`${onTrack} / ${total}`}
        icon={Activity}
        accent="green"
        sub={`${total} ${l.indicatorsSuffix} ${l.tracked.toLowerCase()}`}
        barPct={onTrackPct}
      />
      <KPICard
        label={l.atRisk}
        value={String(atRisk)}
        icon={TrendingDown}
        accent="amber"
        sub={`${Math.round(atRiskPct)}% du portefeuille d'indicateurs`}
        barPct={atRiskPct}
      />
      {showTotal && (
        <KPICard
          label={l.total}
          value={totalUnit ? `${cumulative} ${totalUnit}` : String(cumulative)}
          icon={Sigma}
          sub="Somme des dernières valeurs quantitatives"
        />
      )}
    </div>
  );
}
