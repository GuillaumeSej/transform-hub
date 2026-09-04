"use client";

import { Activity, Sigma, TrendingDown } from "lucide-react";
import { KPICard } from "@/components/shared/KPICard";
import { IndicatorStatusBadge } from "@/components/strategic/IndicatorStatusBadge";
import {
  countOnTrackAtRisk,
  latestMeasurement,
  resolveIndicatorStatus,
  sumLatestQuantitativeValues,
} from "@/lib/axisLogic";
import type { Indicator, IndicatorMeasurement } from "@/types";

/**
 * Compteur d'ensemble « N indicateurs suivis · X sur la trajectoire · Y à risque ». Affiché en tête
 * de la page KPI ET de la fiche d'un axe (le périmètre passé en `indicators` change, pas le
 * composant).
 *
 * Le cumul des dernières valeurs quantitatives (`showTotal`) est DÉSACTIVÉ PAR DÉFAUT : sommer des
 * indicateurs hétérogènes (taux, délais, volumes…) n'a de sens que sur un plan de type Performance
 * où tout est exprimé en euros économisés — sur un Plan Stratégique le PO a explicitement demandé
 * qu'il n'apparaisse pas. La carte reste disponible pour un appelant qui la demande explicitement
 * sur un périmètre homogène (avec `totalUnit`), mais un oubli n'affiche plus rien.
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
  showTotal = false,
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

/**
 * Rangée de « KPI business » — une petite carte par indicateur MACRO du périmètre, c'est-à-dire
 * rattaché directement à un axe (`axisId` renseigné, `chantierId` absent, voir `types/index.ts`).
 * Dans le modèle 3-5-15 ce sont les indicateurs de niveau vision/axe : les seuls qui ont un sens
 * en lecture transverse, là où les indicateurs de chantier ne parlent qu'à leur chantier.
 *
 * Remplace le cumul des indicateurs retiré de la page KPI et du dashboard stratégique : un chiffre
 * agrégé sans signification y cède la place aux valeurs réelles suivies, chacune avec son statut.
 *
 * Vit dans ce fichier — et non dans un composant partagé dédié — parce qu'il partage exactement le
 * même rôle et les mêmes entrées (`indicators` + `measurements` d'un périmètre) que
 * `IndicatorStatusSummary`, et qu'il est consommé par ses deux mêmes appelants (page KPI et
 * dashboard stratégique) ; le dupliquer dans chacun d'eux ferait diverger deux rendus censés être
 * identiques.
 *
 * Aucun calcul propre : `latestMeasurement` / `resolveIndicatorStatus` (`lib/axisLogic.ts`).
 */
export function BusinessKpiCards({
  indicators,
  measurements,
  labels,
  className,
}: {
  /** Périmètre complet (le filtrage « macro » est fait ici, pour que les deux appelants ne
   *  puissent pas diverger sur la définition d'un KPI business). */
  indicators: Indicator[];
  measurements: IndicatorMeasurement[];
  /** Libellés traduits fournis par l'appelant — repli français. */
  labels?: {
    empty?: string;
    noValue?: string;
    objective?: string;
    onTrack?: string;
    atRisk?: string;
  };
  className?: string;
}) {
  const macro = indicators.filter((indicator) => !!indicator.axisId && !indicator.chantierId);

  const l = {
    empty:
      labels?.empty ??
      "Aucun KPI business défini — ajoutez un indicateur rattaché directement à un axe depuis l'onglet Admin > Indicateurs.",
    noValue: labels?.noValue ?? "Aucune mesure",
    objective: labels?.objective ?? "Objectif",
    onTrack: labels?.onTrack ?? "Sur la trajectoire",
    atRisk: labels?.atRisk ?? "À risque",
  };

  if (macro.length === 0) {
    return <p className="text-xs leading-relaxed text-tertiary">{l.empty}</p>;
  }

  return (
    <div className={className ?? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"}>
      {macro.map((indicator) => {
        const latest = latestMeasurement(indicator.id, measurements);
        const status = resolveIndicatorStatus(indicator);
        const unitSuffix = indicator.unit ? ` ${indicator.unit}` : "";
        const value =
          latest?.value !== undefined
            ? `${latest.value}${unitSuffix}`
            : (latest?.note ?? l.noValue);
        return (
          <div
            key={indicator.id}
            className="flex flex-col rounded-lg border border-border bg-white p-3 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-secondary">
                {indicator.name}
              </span>
              <IndicatorStatusBadge
                status={status}
                label={status === "at_risk" ? l.atRisk : l.onTrack}
                className="flex-shrink-0"
              />
            </div>
            <div className="mt-1.5 truncate text-xl font-bold leading-tight tracking-tight text-primary">
              {value}
            </div>
            <div className="mt-auto pt-1 text-[11px] text-tertiary">
              {indicator.objectiveValue !== undefined
                ? `${l.objective} : ${indicator.objectiveValue}${unitSuffix}`
                : indicator.objective}
              {latest ? ` · ${latest.period}` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
