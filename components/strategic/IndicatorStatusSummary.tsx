"use client";

import { useMemo, useState } from "react";
import { Activity, Sigma, TrendingDown } from "lucide-react";
import { KPICard } from "@/components/shared/KPICard";
import { Modal } from "@/components/shared/Modal";
import { RadialProgress } from "@/components/shared/RadialProgress";
import { IndicatorChart } from "@/components/strategic/IndicatorChart";
import { IndicatorDeltaStat } from "@/components/strategic/IndicatorDeltaStat";
import { IndicatorStatusBadge } from "@/components/strategic/IndicatorStatusBadge";
import {
  computeIndicatorDelta,
  countOnTrackAtRisk,
  latestMeasurement,
  resolveIndicatorStatus,
  sumLatestQuantitativeValues,
} from "@/lib/axisLogic";
import type { Indicator, IndicatorMeasurement } from "@/types";

/** Teinte "favorable" du gabarit RAG binaire de l'app (voir `IndicatorStatusBadge` /
 *  `IndicatorDeltaStat`) — la charte BearingPoint n'utilise pas un vert littéral : `--green` est
 *  quasi noir, `--green-light` un gris clair. Repris ici en dur (comme la couleur par défaut de
 *  `RadialProgress`) plutôt qu'en `var(--green)`, un attribut SVG `stroke` ne résolvant pas les
 *  variables CSS de façon fiable sur tous les moteurs de rendu. */
const RADIAL_ON_TRACK_COLOR = "#1a1a1a";
const RADIAL_ON_TRACK_TRACK = "#f0f0f0";

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
  radialHero = false,
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
  /**
   * Bandeau `RadialProgress` (jauge de progression, même langage visuel que le Plan Performance,
   * voir `LeverDetailClientPerformance.tsx`) mis en avant AU-DESSUS de la grille de cartes — défaut
   * `false` pour ne rien changer aux appelants existants (page KPI, fiche d'axe) : la grille de
   * `KPICard` en dessous reste identique quoi qu'il arrive, seul ce bandeau est additif. Activé
   * explicitement par le dashboard stratégique (polish round 4, point 1).
   */
  radialHero?: boolean;
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
    <>
      {radialHero && total > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-4 rounded-lg border border-border bg-neutral-50 p-3.5">
          <RadialProgress
            pct={onTrackPct}
            size={80}
            strokeWidth={7}
            color={RADIAL_ON_TRACK_COLOR}
            trackColor={RADIAL_ON_TRACK_TRACK}
            label={l.onTrack}
            sublabel={`${onTrack}/${total}`}
          />
          <p className="max-w-sm flex-1 text-[12px] leading-relaxed text-secondary">
            {atRisk} {l.atRisk.toLowerCase()} · {total} {l.indicatorsSuffix}{" "}
            {l.tracked.toLowerCase()}
          </p>
        </div>
      )}
      <div
        className={
          className ??
          "grid grid-cols-1 gap-3 sm:grid-cols-2 " +
            (showTotal ? "lg:grid-cols-3" : "lg:grid-cols-2")
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
    </>
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
 * Chaque carte porte une SPARKLINE (`IndicatorChart` en mode `compact`) sous la valeur courante :
 * le PO ne veut pas d'un chiffre nu mais du chemin parcouru. Un clic sur la carte ouvre
 * l'historique COMPLET depuis le lancement du plan dans une modale — la sparkline, elle, reste
 * volontairement fenêtrée sur les dernières périodes (elle n'a pas la place d'en montrer plus).
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
  labels?: BusinessKpiLabels;
  className?: string;
}) {
  const macro = indicators.filter((indicator) => !!indicator.axisId && !indicator.chantierId);

  const l = resolveBusinessKpiLabels(labels);

  /** Mesures indexées par indicateur : `IndicatorChart` attend l'historique DÉJÀ filtré, et un
   *  `filter` par carte re-parcourrait tout le tableau de mesures du programme à chaque rendu. */
  const measurementsByIndicator = useMemo(() => {
    const map = new Map<string, IndicatorMeasurement[]>();
    for (const m of measurements) {
      const bucket = map.get(m.indicatorId);
      if (bucket) bucket.push(m);
      else map.set(m.indicatorId, [m]);
    }
    return map;
  }, [measurements]);

  if (macro.length === 0) {
    return <p className="text-xs leading-relaxed text-tertiary">{l.empty}</p>;
  }

  return (
    <div className={className ?? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"}>
      {macro.map((indicator) => (
        <BusinessKpiCard
          key={indicator.id}
          indicator={indicator}
          measurements={measurementsByIndicator.get(indicator.id) ?? []}
          labels={l}
        />
      ))}
    </div>
  );
}

type BusinessKpiLabels = {
  empty?: string;
  noValue?: string;
  objective?: string;
  onTrack?: string;
  atRisk?: string;
  /** Titre de la modale d'historique complet (le nom de l'indicateur y est ajouté). */
  fullHistory?: string;
  chartValue?: string;
  chartObjective?: string;
  progressToTarget?: string;
};

function resolveBusinessKpiLabels(labels?: BusinessKpiLabels): Required<BusinessKpiLabels> {
  return {
    empty:
      labels?.empty ??
      "Aucun KPI business défini — ajoutez un indicateur rattaché directement à un axe depuis l'onglet Admin > Indicateurs.",
    noValue: labels?.noValue ?? "Aucune mesure",
    objective: labels?.objective ?? "Objectif",
    onTrack: labels?.onTrack ?? "Sur la trajectoire",
    atRisk: labels?.atRisk ?? "À risque",
    fullHistory: labels?.fullHistory ?? "Historique complet",
    chartValue: labels?.chartValue ?? "Valeur",
    chartObjective: labels?.chartObjective ?? "Objectif",
    progressToTarget: labels?.progressToTarget ?? "Progression vers la cible",
  };
}

/**
 * Une carte « KPI business ». Extraite en composant à part entière parce qu'elle porte désormais
 * un état propre (l'ouverture de sa modale d'historique) : un `useState` ne peut pas vivre dans le
 * `.map()` de `BusinessKpiCards`.
 */
function BusinessKpiCard({
  indicator,
  /** Mesures DE CET indicateur uniquement (déjà filtrées par l'appelant). */
  measurements,
  labels: l,
}: {
  indicator: Indicator;
  measurements: IndicatorMeasurement[];
  labels: Required<BusinessKpiLabels>;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);

  const latest = latestMeasurement(indicator.id, measurements);
  const status = resolveIndicatorStatus(indicator);
  const unitSuffix = indicator.unit ? ` ${indicator.unit}` : "";
  const value =
    latest?.value !== undefined ? `${latest.value}${unitSuffix}` : (latest?.note ?? l.noValue);

  // Écart signé + progression vers la cible (round 4, point 1) : `undefined` (pas d'objectif
  // chiffré, ou dernière mesure sans valeur numérique) → `IndicatorDeltaStat` ne rend rien, la
  // carte retombe sur son seul libellé d'objectif texte déjà affiché plus bas.
  const delta = computeIndicatorDelta(indicator, latest);

  // Une carte sans aucune mesure n'ouvre rien : la modale n'aurait qu'un graphique vide à montrer.
  const hasHistory = measurements.length > 0;

  const content = (
    <>
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
      {/* Sparkline : la tendance des dernières périodes, sans axes ni infobulle — le détail
          chiffré se lit dans la modale d'historique complet. */}
      <div className="mt-1.5">
        <IndicatorChart
          measurements={measurements}
          objectiveValue={indicator.objectiveValue}
          direction={indicator.direction}
          unit={indicator.unit}
          qualitative={indicator.kind === "qualitative"}
          frequency={indicator.frequency}
          compact
        />
      </div>
      {/* Progression vers la cible — la sparkline dit "où on va", ce bloc dit "à quel point on est
          proche" (le constat du PO : 82 % contre une cible à 80 % n'est PAS un grand écart). */}
      {delta && (
        <div className="mt-1.5">
          <IndicatorDeltaStat delta={delta} unit={indicator.unit} compact />
        </div>
      )}
      <div className="mt-auto pt-1 text-[11px] text-tertiary">
        {indicator.objectiveValue !== undefined
          ? `${l.objective} : ${indicator.objectiveValue}${unitSuffix}`
          : indicator.objective}
        {latest ? ` · ${latest.period}` : ""}
      </div>
    </>
  );

  const cardClass = "flex flex-col rounded-lg border border-border bg-white p-3 shadow-sm";

  if (!hasHistory) {
    return <div className={cardClass}>{content}</div>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setHistoryOpen(true)}
        className={`${cardClass} text-left transition hover:border-bp-coral hover:shadow-md`}
        title={`${l.fullHistory} — ${indicator.name}`}
      >
        {content}
      </button>
      <Modal
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title={`${l.fullHistory} — ${indicator.name}`}
        maxWidth="820px"
      >
        <IndicatorChart
          measurements={measurements}
          objectiveValue={indicator.objectiveValue}
          direction={indicator.direction}
          unit={indicator.unit}
          qualitative={indicator.kind === "qualitative"}
          height={360}
          windowMeasurements="all"
          frequency={indicator.frequency}
          labelValue={l.chartValue}
          labelObjective={l.chartObjective}
          emptyLabel={l.noValue}
          labelProgress={l.progressToTarget}
        />
      </Modal>
    </>
  );
}
