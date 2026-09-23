"use client";

import {
  INDICATOR_STATUS_TONE,
  IndicatorStatusMark,
} from "@/components/strategic/IndicatorStatusBadge";
import { PendingKpiValues } from "@/components/strategic/PendingKpiValues";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Sigma } from "lucide-react";
import { KPICard } from "@/components/shared/KPICard";
import { Modal } from "@/components/shared/Modal";
import { IndicatorDonut } from "@/components/shared/IndicatorDonut";
import { IndicatorProgressDetail } from "@/components/strategic/IndicatorProgressDetail";
import { IndicatorChart } from "@/components/strategic/IndicatorChart";
import {
  computeIndicatorDelta,
  countOnTrackAtRisk,
  latestMeasurement,
  resolveIndicatorStatus,
  sumLatestQuantitativeValues,
} from "@/lib/axisLogic";
import { IndicatorHistoryTable } from "@/components/strategic/IndicatorHistoryTable";
import { IndicatorValueModal } from "@/components/strategic/IndicatorValueModal";
import {
  canFillIndicatorValue,
  isMarketKpi,
  type IndicatorValueInput,
  type YearSelection,
} from "@/lib/kpiHistory";
import { IndicatorMetaLine } from "@/components/strategic/IndicatorMetaLine";
import {
  YearSegmentedControl,
  useYearSelection,
} from "@/components/strategic/YearSegmentedControl";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type {
  AuthUser,
  Indicator,
  IndicatorMeasurement,
  IndicatorRiskStatus,
  StrategicAxis,
} from "@/types";

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
  axes,
  interaction,
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
    title?: string;
    byAxis?: string;
    ofIndicators?: string;
  };
  className?: string;
  /** Axes du programme : si fournis (page KPI), la synthèse ajoute une ventilation PAR AXE
   *  (mini-barre sur la trajectoire / à risque par axe). Absent (fiche d'un axe) = pas de
   *  ventilation, elle n'aurait qu'une ligne. */
  axes?: Pick<StrategicAxis, "id" | "name" | "color">[];
  /**
   * Bandeau `RadialProgress` (jauge de progression, même langage visuel que le Plan Performance,
   * voir `LeverDetailClientPerformance.tsx`) mis en avant AU-DESSUS de la grille de cartes — défaut
   * `false` pour ne rien changer aux appelants existants (page KPI, fiche d'axe) : la grille de
   * `KPICard` en dessous reste identique quoi qu'il arrive, seul ce bandeau est additif. Activé
   * explicitement par le dashboard stratégique (polish round 4, point 1).
   */
  radialHero?: boolean;
  /** Rend la synthèse interactive (page KPI) : lignes « Par axe », compteur à risque de chaque
   *  ligne et légende du bloc héros deviennent des boutons de filtre. Absent (fiche d'axe,
   *  dashboard) = rendu statique inchangé. */
  interaction?: OverviewInteraction;
}) {
  const { t } = useTranslation();
  const { total, onTrack, atRisk } = countOnTrackAtRisk(indicators);
  const cumulative = sumLatestQuantitativeValues(indicators, measurements);
  const onTrackPct = total > 0 ? (onTrack / total) * 100 : 0;
  const atRiskPct = total > 0 ? (atRisk / total) * 100 : 0;

  const l = {
    tracked: labels?.tracked ?? t("kpi.summary.tracked", "Indicateurs suivis"),
    onTrack: labels?.onTrack ?? t("kpi.summary.onTrack", "Sur la trajectoire"),
    atRisk: labels?.atRisk ?? t("kpi.summary.atRisk", "À risque"),
    total: labels?.total ?? t("kpi.summary.total", "Cumul des indicateurs"),
    indicatorsSuffix: labels?.indicatorsSuffix ?? t("kpi.summary.indicatorsSuffix", "indicateurs"),
    title: labels?.title ?? t("kpi.summary.title", "Santé des indicateurs"),
    byAxis: labels?.byAxis ?? t("kpi.summary.byAxis", "Par axe"),
    ofIndicators: labels?.ofIndicators ?? t("kpi.summary.ofIndicators", "des indicateurs"),
  };

  return (
    <>
      {radialHero && total > 0 && (
        // Round 9, point 1 : le bandeau héros devient cliquable → navigue vers la page KPI
        // (`/kpi`, `lib/nav-config.ts`) — un `next/link` enveloppant tout le bloc plutôt qu'un
        // callback remonté au parent : aucun nouveau prop à faire transiter depuis
        // `StrategicDashboardView.tsx`, et aucun élément interactif imbriqué ici (la barre et le
        // paragraphe sont tous deux du contenu statique) donc le bloc entier peut être un seul
        // lien sans conflit d'accessibilité.
        // Round 10, point 1 : le donut circulaire cède la place à un grand chiffre + une barre
        // horizontale à deux segments (`bg-rag-green`/`bg-rag-red`, même convention que
        // `components/shared/ProgressBar.tsx`) — plus lisible et plus dans la charte
        // monochrome + rouge qu'un anneau.
        <Link
          href="/kpi"
          className="mb-3 flex cursor-pointer flex-col gap-3 rounded-lg border border-border bg-neutral-50 p-5 transition hover:border-bp-coral hover:shadow-md"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="text-[42px] font-bold leading-none tracking-tight text-primary">
                {Math.round(onTrackPct)}%
              </span>
              <div className="mt-1.5 text-[11px] font-bold uppercase tracking-wide text-secondary">
                {l.onTrack} · {onTrack}/{total}
              </div>
            </div>
            <p className="max-w-sm flex-1 text-[12px] leading-relaxed text-secondary">
              {atRisk} {l.atRisk.toLowerCase()} · {total} {l.tracked.toLowerCase()}
            </p>
          </div>
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-100"
            role="img"
            aria-label={`${l.onTrack} ${Math.round(onTrackPct)}% · ${l.atRisk} ${Math.round(atRiskPct)}%`}
          >
            {onTrackPct > 0 && (
              <div
                className={`h-full ${INDICATOR_STATUS_TONE.on_track.bar}`}
                style={{ width: `${onTrackPct}%` }}
              />
            )}
            {atRiskPct > 0 && (
              <div
                className={`h-full ${INDICATOR_STATUS_TONE.at_risk.bar}`}
                style={{ width: `${atRiskPct}%` }}
              />
            )}
          </div>
        </Link>
      )}
      {/* Round 8 : en mode `radialHero`, le PO ne veut QUE le bandeau ci-dessus. Hors héros (page
          KPI, fiche d'axe) : panneau de synthèse moderne, voir `IndicatorStatusOverview`. */}
      {!radialHero && (
        <div className={className}>
          <IndicatorStatusOverview
            indicators={indicators}
            axes={axes}
            total={total}
            onTrack={onTrack}
            atRisk={atRisk}
            labels={l}
            interaction={interaction}
          />
          {showTotal && (
            <KPICard
              label={l.total}
              value={totalUnit ? `${cumulative} ${totalUnit}` : String(cumulative)}
              icon={Sigma}
              sub={t("kpi.summary.totalSub", "Somme des dernières valeurs quantitatives")}
              className="mt-3"
            />
          )}
        </div>
      )}
    </>
  );
}

type OverviewLabels = {
  tracked: string;
  onTrack: string;
  atRisk: string;
  indicatorsSuffix: string;
  title: string;
  byAxis: string;
  ofIndicators: string;
};

/** Filtrage piloté depuis la synthèse (page KPI) — l'état vit chez l'appelant (paramètres d'URL),
 *  ce composant ne fait que refléter la sélection et remonter les clics. */
export type OverviewInteraction = {
  /** Axe actuellement filtré (un seul) — sa ligne est mise en avant, les autres estompées. */
  selectedAxisId: string | null;
  selectedStatus: IndicatorRiskStatus | null;
  onAxisClick: (axisId: string) => void;
  /** Clic sur le compteur à risque d'une ligne : axe + statut « à risque ». */
  onAxisAtRiskClick: (axisId: string) => void;
  onStatusClick: (status: IndicatorRiskStatus) => void;
  /** Libellés d'accessibilité — `{name}` / `{status}` sont remplacés à l'affichage. */
  labels: {
    filterAxis: string;
    filterAxisAtRisk: string;
    filterStatus: string;
  };
};

const FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1";

/** Barre segmentée sur la trajectoire / à risque — même rendu que le bandeau héros du dashboard
 *  stratégique (encre + BearingPoint Red, palette partagée `INDICATOR_STATUS_TONE`). */
function StatusSplitBar({
  onTrack,
  atRisk,
  total,
  height = "h-3",
  ariaLabel,
  color,
}: {
  onTrack: number;
  atRisk: number;
  total: number;
  height?: string;
  ariaLabel: string;
  /** Couleur d'axe (ventilation par axe) : segment "sur la trajectoire" plein, segment "à risque"
   *  en teinte claire de la même couleur — le risque reste signalé par le triangle rouge à droite. */
  color?: string;
}) {
  const onTrackPct = total > 0 ? (onTrack / total) * 100 : 0;
  const atRiskPct = total > 0 ? (atRisk / total) * 100 : 0;
  return (
    <div
      className={`flex w-full gap-[2px] overflow-hidden rounded-full bg-neutral-100 ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      {onTrackPct > 0 && (
        <div
          className={`h-full ${color ? "" : INDICATOR_STATUS_TONE.on_track.bar}`}
          style={{ width: `${onTrackPct}%`, ...(color ? { backgroundColor: color } : {}) }}
        />
      )}
      {atRiskPct > 0 && (
        <div
          className={`h-full ${color ? "" : INDICATOR_STATUS_TONE.at_risk.bar}`}
          style={{
            width: `${atRiskPct}%`,
            ...(color ? { backgroundColor: color, opacity: 0.28 } : {}),
          }}
        />
      )}
    </div>
  );
}

/**
 * Synthèse des statuts d'indicateur de la page KPI (et de la fiche d'axe) — refonte (retour PO :
 * l'ancienne tuile « Sur la trajectoire 5/13 » faisait daté à côté du tableau de bord
 * stratégique). Même langage visuel que le bandeau héros du dashboard : grand pourcentage, barre
 * segmentée encre / BearingPoint Red, puis deux tuiles de compte (rond plein vs triangle d'alerte,
 * jamais la couleur seule) et, si `axes` est fourni, une ventilation par axe.
 *
 * Aucun calcul métier propre : comptes issus de `countOnTrackAtRisk` (passés par le parent) et
 * statut par indicateur via `resolveIndicatorStatus` (`lib/axisLogic.ts`).
 */
function IndicatorStatusOverview({
  indicators,
  axes,
  total,
  onTrack,
  atRisk,
  labels: l,
  interaction,
}: {
  indicators: Indicator[];
  axes?: Pick<StrategicAxis, "id" | "name" | "color">[];
  total: number;
  onTrack: number;
  atRisk: number;
  labels: OverviewLabels;
  interaction?: OverviewInteraction;
}) {
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  const perAxis = useMemo(() => {
    if (!axes || axes.length === 0) return [];
    return axes
      .map((axis) => {
        let axisOnTrack = 0;
        let axisAtRisk = 0;
        for (const indicator of indicators) {
          if (indicator.axisId !== axis.id) continue;
          if (resolveIndicatorStatus(indicator) === "at_risk") axisAtRisk += 1;
          else axisOnTrack += 1;
        }
        return { axis, onTrack: axisOnTrack, atRisk: axisAtRisk, total: axisOnTrack + axisAtRisk };
      })
      .filter((row) => row.total > 0);
  }, [axes, indicators]);

  const tiles: { status: IndicatorRiskStatus; label: string; count: number }[] = [
    { status: "on_track", label: l.onTrack, count: onTrack },
    { status: "at_risk", label: l.atRisk, count: atRisk },
  ];

  return (
    <section className="rounded-lg border border-border bg-white shadow-sm">
      <div
        className={`grid grid-cols-1 gap-5 p-5 ${
          perAxis.length > 0 ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:gap-8" : ""
        }`}
      >
        {/* Bloc héros : taux sur la trajectoire + barre segmentée + légende chiffrée */}
        <div className="flex min-w-0 flex-col justify-between gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="border-l-[3px] border-bp-coral pl-2 text-[13px] font-bold tracking-tight text-primary">
              {l.title}
            </h3>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
              {total} {l.tracked.toLowerCase()}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <span className="text-[44px] font-bold leading-none tracking-tight text-primary tabular-nums">
              {pct(onTrack)}%
            </span>
            <span className="pb-1 text-[11px] font-bold uppercase tracking-wide text-secondary">
              {l.onTrack} · {onTrack}/{total}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <StatusSplitBar
              onTrack={onTrack}
              atRisk={atRisk}
              total={total}
              ariaLabel={`${l.onTrack} ${pct(onTrack)}% · ${l.atRisk} ${pct(atRisk)}%`}
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-secondary">
              {tiles.map((tile) => {
                const inner = (
                  <>
                    <IndicatorStatusMark status={tile.status} size={8} />
                    <span className="font-semibold text-primary">{tile.label}</span>
                    <span className="tabular-nums">{pct(tile.count)}%</span>
                  </>
                );
                if (!interaction) {
                  return (
                    <span key={tile.status} className="inline-flex items-center gap-1.5">
                      {inner}
                    </span>
                  );
                }
                const active = interaction.selectedStatus === tile.status;
                return (
                  <button
                    key={tile.status}
                    type="button"
                    onClick={() => interaction.onStatusClick(tile.status)}
                    aria-pressed={active}
                    aria-label={interaction.labels.filterStatus.replace("{status}", tile.label)}
                    className={`-mx-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-1.5 py-0.5 transition ${FOCUS_RING} ${
                      active
                        ? "border-primary bg-neutral-100"
                        : "border-transparent hover:border-border hover:bg-neutral-50"
                    }`}
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Ventilation par axe (page KPI uniquement), dans la couleur de chaque axe — remplace
            les deux tuiles de compte, qui répétaient le bloc héros (retour PO). */}
        {perAxis.length > 0 && (
          <div className="min-w-0 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-wide text-tertiary">
              {l.byAxis}
            </div>
            <ul className={`flex flex-col ${interaction ? "gap-1" : "gap-2.5"}`}>
              {perAxis.map((row) => {
                const axisColor = row.axis.color ?? "var(--bp-warm-taupe)";
                const rowSummary = `${row.axis.name} — ${l.onTrack} ${row.onTrack}/${row.total} · ${l.atRisk} ${row.atRisk}`;
                const selected = interaction?.selectedAxisId === row.axis.id;
                const dimmed = !!interaction?.selectedAxisId && !selected;
                const atRiskFilterActive = selected && interaction?.selectedStatus === "at_risk";

                const main = (
                  <>
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: axisColor }}
                    />
                    <span
                      className="w-[38%] min-w-0 shrink-0 truncate font-semibold text-primary"
                      title={row.axis.name}
                    >
                      {row.axis.name}
                    </span>
                    <span className="min-w-0 flex-1">
                      <StatusSplitBar
                        onTrack={row.onTrack}
                        atRisk={row.atRisk}
                        total={row.total}
                        height="h-2"
                        color={axisColor}
                        ariaLabel={rowSummary}
                      />
                    </span>
                    <span className="w-9 shrink-0 text-right font-semibold text-primary tabular-nums">
                      {row.onTrack}/{row.total}
                    </span>
                  </>
                );

                const atRiskContent =
                  row.atRisk > 0 ? (
                    <>
                      <IndicatorStatusMark status="at_risk" size={7} />
                      {row.atRisk}
                    </>
                  ) : (
                    "—"
                  );
                const atRiskTone =
                  row.atRisk > 0
                    ? `font-bold ${INDICATOR_STATUS_TONE.at_risk.text}`
                    : "text-tertiary";

                if (!interaction) {
                  return (
                    <li key={row.axis.id} className="flex min-w-0 items-center gap-2.5 text-[12px]">
                      {main}
                      <span
                        className={`inline-flex w-8 shrink-0 items-center justify-end gap-0.5 tabular-nums ${atRiskTone}`}
                        title={`${l.atRisk} : ${row.atRisk}`}
                      >
                        {atRiskContent}
                      </span>
                    </li>
                  );
                }

                return (
                  <li
                    key={row.axis.id}
                    className={`flex min-w-0 items-center gap-1 rounded-md text-[12px] transition-opacity ${
                      dimmed ? "opacity-50 hover:opacity-100 focus-within:opacity-100" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => interaction.onAxisClick(row.axis.id)}
                      aria-pressed={selected}
                      aria-label={`${interaction.labels.filterAxis.replace("{name}", row.axis.name)} — ${rowSummary}`}
                      title={interaction.labels.filterAxis.replace("{name}", row.axis.name)}
                      className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md border px-1.5 py-1 text-left transition ${FOCUS_RING} ${
                        selected
                          ? "border-border bg-neutral-100 shadow-sm"
                          : "border-transparent hover:border-border hover:bg-neutral-50"
                      }`}
                      style={selected ? { boxShadow: `inset 3px 0 0 ${axisColor}` } : undefined}
                    >
                      {main}
                    </button>
                    {row.atRisk > 0 ? (
                      <button
                        type="button"
                        onClick={() => interaction.onAxisAtRiskClick(row.axis.id)}
                        aria-pressed={atRiskFilterActive}
                        aria-label={interaction.labels.filterAxisAtRisk.replace(
                          "{name}",
                          row.axis.name
                        )}
                        title={interaction.labels.filterAxisAtRisk.replace("{name}", row.axis.name)}
                        className={`inline-flex w-10 shrink-0 cursor-pointer items-center justify-end gap-0.5 rounded-md border px-1 py-1 tabular-nums transition ${FOCUS_RING} ${atRiskTone} ${
                          atRiskFilterActive
                            ? "border-current bg-red-50"
                            : "border-transparent hover:border-current hover:bg-red-50"
                        }`}
                      >
                        {atRiskContent}
                      </button>
                    ) : (
                      <span
                        className={`inline-flex w-10 shrink-0 items-center justify-end gap-0.5 px-1 tabular-nums ${atRiskTone}`}
                        title={`${l.atRisk} : ${row.atRisk}`}
                      >
                        {atRiskContent}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
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
  user,
  addMeasurement,
  year = "all",
}: {
  /** Saisie de valeur (KPI marché, responsabilité CTO) : bouton affiché seulement si `user` ET
   *  `addMeasurement` sont fournis et que `canFillIndicatorValue` l'autorise. */
  user?: AuthUser | null;
  addMeasurement?: (input: IndicatorValueInput) => Promise<unknown>;
  /** Année affichée (défaut : tout l'historique, comportement historique). */
  year?: YearSelection;
  /** Périmètre complet (le filtrage « macro » est fait ici, pour que les deux appelants ne
   *  puissent pas diverger sur la définition d'un KPI business). */
  indicators: Indicator[];
  measurements: IndicatorMeasurement[];
  /** Libellés traduits fournis par l'appelant — repli français. */
  labels?: BusinessKpiLabels;
  className?: string;
}) {
  const { t } = useTranslation();
  const macro = indicators.filter(isMarketKpi);

  const l = resolveBusinessKpiLabels(labels, t);

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
          user={user}
          addMeasurement={addMeasurement}
          year={year}
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
  /** Round 6, point 2 : infobulle explicative portée par `IndicatorStatusBadge` sur l'état "à
   *  risque" (ex. `strategicAxes.atRiskTooltip`) — absente par défaut plutôt qu'un repli français
   *  en dur, cohérent avec le reste de ce composant (labels optionnels fournis par l'appelant). */
  atRiskTooltip?: string;
  /** Titre de la modale d'historique complet (le nom de l'indicateur y est ajouté). */
  fullHistory?: string;
  chartValue?: string;
  chartObjective?: string;
  progressToTarget?: string;
};

function resolveBusinessKpiLabels(
  labels: BusinessKpiLabels | undefined,
  t: (key: string, fallback?: string) => string
): Required<BusinessKpiLabels> {
  return {
    empty:
      labels?.empty ??
      t(
        "businessKpis.empty",
        "Aucun KPI business défini — ajoutez un indicateur rattaché directement à un axe depuis l'onglet Admin > Indicateurs."
      ),
    noValue: labels?.noValue ?? t("businessKpis.noValue", "Aucune mesure"),
    objective: labels?.objective ?? t("kpi.objectiveValue", "Objectif"),
    onTrack: labels?.onTrack ?? t("indicatorStatus.onTrack", "Sur la trajectoire"),
    atRisk: labels?.atRisk ?? t("indicatorStatus.atRisk", "À risque"),
    atRiskTooltip: labels?.atRiskTooltip ?? "",
    fullHistory: labels?.fullHistory ?? t("kpi.chart.fullHistory", "Historique complet"),
    chartValue: labels?.chartValue ?? t("kpi.chart.value", "Valeur"),
    chartObjective: labels?.chartObjective ?? t("kpi.chart.objective", "Objectif"),
    progressToTarget:
      labels?.progressToTarget ?? t("kpi.chart.progressToTarget", "Progression vers la cible"),
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
  user,
  addMeasurement,
  year,
}: {
  indicator: Indicator;
  measurements: IndicatorMeasurement[];
  labels: Required<BusinessKpiLabels>;
  user?: AuthUser | null;
  addMeasurement?: (input: IndicatorValueInput) => Promise<unknown>;
  year: YearSelection;
}) {
  const { t } = useTranslation();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const canFill = !!user && !!addMeasurement && canFillIndicatorValue(indicator, user);
  // Année de la modale d'historique (sélecteur partagé `YearSegmentedControl`) — initialisée sur
  // l'année fournie par l'appelant (défaut : historique complet).
  const modalYear = useYearSelection(measurements, year);
  const yearMeasurements = modalYear.filtered;

  const latest = latestMeasurement(indicator.id, measurements);
  const unitSuffix = indicator.unit ? ` ${indicator.unit}` : "";
  const value =
    latest?.value !== undefined ? `${latest.value}${unitSuffix}` : (latest?.note ?? l.noValue);

  // Écart signé + progression vers la cible (round 4, point 1) : `undefined` (pas d'objectif
  // chiffré, ou dernière mesure sans valeur numérique) → `IndicatorDeltaStat` ne rend rien, la
  // carte retombe sur son seul libellé d'objectif texte déjà affiché plus bas.
  const delta = computeIndicatorDelta(indicator, latest, measurements);

  // Une carte sans aucune mesure n'ouvre rien : la modale n'aurait qu'un graphique vide à montrer.
  const hasHistory = measurements.length > 0;

  const content = (
    <>
      {/* Round 7, point 3 : un seul camembert remplace le badge de statut + la sparkline + la
          barre de delta — signal unique (statut ET progression vers la cible en un coup d'œil).
          Le texte visible ("à risque"/"sur la trajectoire") disparaît au profit de l'`aria-label`/
          `title` du camembert lui-même. */}
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-secondary">
          {indicator.name}
        </span>
        <IndicatorDonut
          delta={delta}
          labels={{ onTrack: l.onTrack, atRisk: l.atRisk, noData: l.noValue }}
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
      {/* Avancement vers la cible finale + palier courant (les deux cibles visibles). */}
      <IndicatorProgressDetail delta={delta} unit={indicator.unit} compact className="mt-1" />
    </>
  );

  const cardClass = "flex flex-col rounded-lg border border-border bg-white p-3 shadow-sm";

  const fillButton = canFill ? (
    <button
      type="button"
      onClick={() => setFillOpen(true)}
      className="cursor-pointer rounded-md border border-bp-coral/40 px-2 py-1 text-[11px] font-semibold text-bp-coral transition hover:bg-bp-coral/10"
    >
      {t("kpi.fillValue", "Renseigner la valeur")}
    </button>
  ) : null;

  return (
    <div className="flex flex-col gap-1.5">
      {hasHistory ? (
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className={`${cardClass} flex-1 text-left transition hover:border-bp-coral hover:shadow-md`}
          title={`${l.fullHistory} — ${indicator.name}`}
        >
          {content}
        </button>
      ) : (
        <div className={`${cardClass} flex-1`}>{content}</div>
      )}
      <p className="text-[10px] text-tertiary">{t("kpi.market.owner", "Saisie : CTO")}</p>
      <PendingKpiValues indicatorId={indicator.id} unit={indicator.unit} compact />
      {fillButton}
      {canFill && user && addMeasurement && (
        <IndicatorValueModal
          indicator={indicator}
          user={user}
          addMeasurement={addMeasurement}
          open={fillOpen}
          onOpenChange={setFillOpen}
        />
      )}
      {hasHistory && (
        <Modal
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          title={`${l.fullHistory} — ${indicator.name}`}
          maxWidth="820px"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <IndicatorMetaLine indicator={indicator} />
            {modalYear.visible && (
              <YearSegmentedControl
                years={modalYear.options}
                value={modalYear.year}
                onChange={modalYear.setYear}
              />
            )}
          </div>
          <IndicatorChart
            measurements={yearMeasurements}
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
            targetSchedule={indicator.targetSchedule}
            baselineMeasurements={measurements}
          />
          <IndicatorHistoryTable indicator={indicator} measurements={yearMeasurements} />
        </Modal>
      )}
    </div>
  );
}
