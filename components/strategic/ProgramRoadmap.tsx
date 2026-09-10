"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  formatTimelineDay,
  timelineColumns,
  timelinePctOf,
  timelineRange,
  timelineTodayPct,
  timelineYearBands,
  TimelineBar,
  TimelineGridColumns,
  TimelineHeaderRow,
  TimelineMarker,
  TimelineScaleToggle,
  TimelineTodayMarker,
  hexToRgb,
  type TimelineScale,
} from "@/components/strategic/TimelineBars";
import { programRoadmap, type ProgramRoadmapRow } from "@/lib/axisLogic";
import type { Chantier, ChantierAction, LevierKanbanStatus, StrategicAxis } from "@/types";

/**
 * Feuille de route PROGRAMME (round 15) — vue Gantt du plan stratégique COMPLET : une ligne par
 * LEVIER, tous axes et tous chantiers confondus, à la différence de `ChantierGantt.tsx` (borné à un
 * seul axe, une ligne par chantier). Répond à la demande PO explicite : « une vue globale (pas
 * seulement par axe/chantier) des livrables à venir, à l'échelle trimestrielle, annuelle et globale,
 * pour le pilotage du plan — ex. ce qui est dû fin S1 2027, fin S2 2027 — avec l'avancement
 * déclaratif existant à côté des livrables à venir ».
 *
 * Composition STRICTEMENT à partir des primitives déjà partagées de `TimelineBars.tsx` (aucun
 * nouveau moteur de rendu) — même patron que `ChantierGantt.tsx` et l'onglet "Timeline" de
 * `ChantierDetailPanel.tsx` : grille de colonnes + `TimelineBar` (barre de levier, remplissage
 * proportionnel à l'avancement) + `TimelineMarker` (losange par livrable à échéance déclarée).
 *
 * Deux différences volontaires avec `ChantierGantt.tsx`, dictées par le changement d'échelle
 * (plusieurs dizaines de leviers sur l'ensemble du programme, pas quelques chantiers d'un seul
 * axe) :
 *  1. les lignes sont groupées AXE → CHANTIER → levier (dans l'ordre d'apparition de `axes`/
 *     `chantiers`, jamais retrié — même convention que `numberIndicators`/`programRoadmap`), avec un
 *     en-tête de section par axe/chantier plutôt qu'une simple liste plate ;
 *  2. la grille défile verticalement dans un conteneur borné en hauteur, sous un en-tête de colonnes
 *     COLLANT (`sticky`) — indispensable dès que le nombre de lignes dépasse l'écran, ce qui n'arrive
 *     jamais sur le Gantt d'un seul axe.
 *
 * Chaque barre est teintée par la couleur de son AXE (pas du chantier, round 8, réservée au Kanban/
 * à la vue E0→E4) — `StrategicAxis.color`, la même couleur affichée partout ailleurs pour identifier
 * un axe (`StrategicAxesView.tsx`, `levierBoardGroups` de `StrategicDashboardView.tsx`).
 *
 * Échelle temporelle : Trimestre / Semestre / Année — PAS de maille "Mois" (beaucoup trop de
 * colonnes sur la largeur d'un programme pluriannuel complet, contrairement au Gantt d'un seul axe).
 * La maille "Année" (`TimelineScale` étendu de façon ADDITIVE dans `TimelineBars.tsx`, round 15) sert
 * la vue "globale" demandée par le PO : à cette maille, la grille couvre déjà TOUT le programme (ce
 * composant n'est jamais scopé à un seul axe/chantier), donc "Année" EST la vue globale — pas besoin
 * d'un quatrième mode dédié qui ferait doublon.
 */

export type ProgramRoadmapLabels = {
  /** Aucun levier daté sur tout le programme. */
  empty?: string;
  scale?: string;
  scaleQuarter?: string;
  scaleSemester?: string;
  scaleYear?: string;
  progress?: string;
  today?: string;
  /** Suffixe "N leviers" affiché sous le nom de chaque chantier. */
  leviersSuffix?: string;
};

const ROW_LABEL_WIDTH = "w-72";

/** Couleur de repli quand l'axe n'a pas de couleur choisie — même taupe BearingPoint que
 *  `ChantierGantt.tsx` (`FALLBACK_COLOR`), dupliqué ici plutôt qu'exporté depuis ce fichier (pas de
 *  point de partage naturel pour une seule constante, et `ChantierGantt.tsx` n'est pas dans le
 *  périmètre modifiable de ce lot). */
const FALLBACK_COLOR = "#a99e9a";

/** Mêmes 3 couleurs que `PROGRESSION_COLOR_*`/`deliverableStatusColor` de `ChantierDetailPanel.tsx`
 *  (fonction privée, hors périmètre de ce lot — dupliqué ici pour garder EXACTEMENT le même code
 *  couleur todo/rouge, in_progress/ambre, done/vert sur les losanges de livrable). */
const DELIVERABLE_COLOR_RED = "#ff3c47";
const DELIVERABLE_COLOR_AMBER = "#806659";
const DELIVERABLE_COLOR_GREEN = "#1a1a1a";

function deliverableMarkerColor(status: LevierKanbanStatus | undefined): string {
  switch (status) {
    case "done":
      return DELIVERABLE_COLOR_GREEN;
    case "in_progress":
      return DELIVERABLE_COLOR_AMBER;
    default:
      return DELIVERABLE_COLOR_RED;
  }
}

// Hauteurs de ligne compactes (round 15) : le programme complet peut compter plusieurs dizaines de
// leviers, contrairement au Gantt d'un seul chantier — des blocs plus généreux (comme
// `ChantierGantt.tsx`/`ChantierDetailPanel.tsx`) produiraient un mur de barres impraticable.
const LEVIER_BAR_HEIGHT = 18;
const DELIVERABLE_MARKER_LANE_HEIGHT = 14;

type ChantierGroup = { chantier: Chantier; rows: ProgramRoadmapRow[] };
type AxisGroup = { axis: StrategicAxis; chantierGroups: ChantierGroup[] };

/** Regroupe les lignes plates de `programRoadmap` en AXE → CHANTIER, EN PRÉSERVANT leur ordre
 *  d'apparition (`programRoadmap` groupe déjà axe puis chantier puis levier trié par date de début —
 *  ce regroupement ne fait que replier cette liste plate en sections imbriquées pour le rendu, sans
 *  jamais retrier). */
function groupRowsByAxisAndChantier(rows: ProgramRoadmapRow[]): AxisGroup[] {
  const axisGroups: AxisGroup[] = [];
  for (const row of rows) {
    let axisGroup = axisGroups.find((g) => g.axis.id === row.axis.id);
    if (!axisGroup) {
      axisGroup = { axis: row.axis, chantierGroups: [] };
      axisGroups.push(axisGroup);
    }
    let chantierGroup = axisGroup.chantierGroups.find((g) => g.chantier.id === row.chantier.id);
    if (!chantierGroup) {
      chantierGroup = { chantier: row.chantier, rows: [] };
      axisGroup.chantierGroups.push(chantierGroup);
    }
    chantierGroup.rows.push(row);
  }
  return axisGroups;
}

export function ProgramRoadmap({
  axes,
  chantiers,
  actions,
  onLevierClick,
  onChantierClick,
  renderAxisHeader,
  labels,
}: {
  axes: StrategicAxis[];
  chantiers: Chantier[];
  /** Tous les leviers du programme actif (toutes les actions, pas filtrées par axe/chantier — voir
   *  `axisLogic.programRoadmap`). */
  actions: ChantierAction[];
  /** Clic sur une barre de levier ou un losange de livrable — l'appelant ouvre le panneau du
   *  CHANTIER parent, focalisé sur ce levier (même contrat que `openChantierPanel` de
   *  `StrategicDashboardView.tsx`). */
  onLevierClick?: (chantierId: string, actionId: string) => void;
  /** Clic sur l'en-tête de chantier (round 16) — même contrat que `onLevierClick` mais sans levier
   *  ciblé : l'appelant ouvre le panneau du chantier sans le focaliser sur une action précise.
   *  Omis = l'en-tête de chantier reste un texte non interactif (comportement historique). */
  onChantierClick?: (chantierId: string) => void;
  /** Rendu personnalisé de l'en-tête d'axe (round 16) — remplace l'en-tête par défaut (pastille de
   *  couleur + nom en majuscules) par le contenu fourni par l'appelant (ex. `StrategicAxesView.tsx`
   *  y réinjecte l'en-tête riche de l'ancienne vue "cartes" : owner, description, puces
   *  d'indicateur, budget). Omis = en-tête par défaut inchangé, pour que tout autre appelant futur
   *  sans ce prop continue de fonctionner à l'identique. */
  renderAxisHeader?: (axis: StrategicAxis) => ReactNode;
  labels?: ProgramRoadmapLabels;
}) {
  const l = {
    empty: labels?.empty ?? "Aucun levier daté sur le programme.",
    scale: labels?.scale ?? "Échelle",
    scaleQuarter: labels?.scaleQuarter ?? "Trimestre",
    scaleSemester: labels?.scaleSemester ?? "Semestre",
    scaleYear: labels?.scaleYear ?? "Année",
    progress: labels?.progress ?? "Avancement",
    today: labels?.today ?? "Aujourd'hui",
    leviersSuffix: labels?.leviersSuffix ?? "leviers",
  };

  // Semestre par défaut : le programme complet s'étend typiquement sur plusieurs années, la maille
  // trimestrielle y produirait déjà beaucoup de colonnes — meilleur compromis lisibilité/détail pour
  // une vue "globale" par défaut (l'utilisateur affine vers Trimestre s'il pilote une échéance
  // précise, ou vers Année pour l'aperçu le plus large).
  const [scale, setScale] = useState<TimelineScale>("semester");

  const rows = useMemo(() => programRoadmap(axes, chantiers, actions), [axes, chantiers, actions]);
  const grouped = useMemo(() => groupRowsByAxisAndChantier(rows), [rows]);

  const { minTime, maxTime } = useMemo(() => timelineRange(rows, scale), [rows, scale]);
  const pctOf = useMemo(() => timelinePctOf(minTime, maxTime), [minTime, maxTime]);
  const columns = useMemo(
    () => (rows.length === 0 ? [] : timelineColumns(minTime, maxTime, scale)),
    [minTime, maxTime, scale, rows.length]
  );
  const yearBands = useMemo(() => timelineYearBands(columns), [columns]);
  const todayPct = useMemo(
    () => (rows.length === 0 ? null : timelineTodayPct(minTime, maxTime)),
    [minTime, maxTime, rows.length]
  );

  const scaleOptions: { value: TimelineScale; label: string }[] = [
    { value: "quarter", label: l.scaleQuarter },
    { value: "semester", label: l.scaleSemester },
    { value: "year", label: l.scaleYear },
  ];

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-tertiary">{l.empty}</p>;
  }

  return (
    <div className="w-full">
      {/* ── Bascule d'échelle temporelle ─────────────────────────────────────────────────────── */}
      <div className="mb-2.5 flex flex-wrap items-center justify-end gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
          {l.scale}
        </span>
        <TimelineScaleToggle value={scale} onChange={setScale} options={scaleOptions} />
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          {/* ── Conteneur défilant verticalement, en-tête de colonnes COLLANT ─────────────────── */}
          <div className="max-h-[560px] overflow-y-auto">
            <div className="sticky top-0 z-[2] bg-white">
              <TimelineHeaderRow
                columns={columns}
                yearBands={yearBands}
                labelWidthClassName={ROW_LABEL_WIDTH}
                todayPct={todayPct}
                todayLabel={l.today}
              />
            </div>

            {grouped.map((axisGroup) => {
              const axisColor =
                axisGroup.axis.color && hexToRgb(axisGroup.axis.color)
                  ? axisGroup.axis.color
                  : FALLBACK_COLOR;

              return (
                <div key={axisGroup.axis.id} className="mb-2">
                  {/* En-tête d'axe — volontairement PAS collant (contrairement à l'en-tête de
                      colonnes ci-dessus) : sa hauteur variant avec le nombre de chantiers/leviers
                      qu'il précède, l'empiler proprement sous l'en-tête de colonnes demanderait de
                      recalculer un offset dynamique par section, pour un bénéfice de lisibilité
                      marginal une fois l'en-tête de colonnes déjà fixe. */}
                  {renderAxisHeader ? (
                    renderAxisHeader(axisGroup.axis)
                  ) : (
                    <div
                      className="flex items-center gap-1.5 border-b border-border-strong bg-neutral-50 py-1 pl-1"
                      style={{ borderLeft: `3px solid ${axisColor}` }}
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: axisColor }}
                      />
                      <span className="truncate text-[11.5px] font-bold uppercase tracking-wide text-primary">
                        {axisGroup.axis.name}
                      </span>
                    </div>
                  )}

                  {axisGroup.chantierGroups.map((chantierGroup) => (
                    <div key={chantierGroup.chantier.id}>
                      {/* En-tête de chantier — bouton (round 16) cliquable si `onChantierClick` est
                          fourni, sinon reste un simple texte non interactif (comportement
                          historique). */}
                      <button
                        type="button"
                        disabled={!onChantierClick}
                        onClick={
                          onChantierClick
                            ? () => onChantierClick(chantierGroup.chantier.id)
                            : undefined
                        }
                        className={`${ROW_LABEL_WIDTH} truncate pl-2.5 pt-1.5 text-left text-[10.5px] font-semibold text-secondary transition ${
                          onChantierClick ? "hover:bg-neutral-50 hover:text-primary" : ""
                        }`}
                      >
                        {chantierGroup.chantier.name}
                        <span className="ml-1 font-normal text-tertiary">
                          · {chantierGroup.rows.length} {l.leviersSuffix}
                        </span>
                      </button>

                      {chantierGroup.rows.map((row) => {
                        const startPct = pctOf(row.start);
                        const widthPct = Math.max(1.2, pctOf(row.end) - startPct);
                        const hasDeliverables = row.deliverables.length > 0;
                        const trackHeight = hasDeliverables
                          ? LEVIER_BAR_HEIGHT + DELIVERABLE_MARKER_LANE_HEIGHT
                          : LEVIER_BAR_HEIGHT;

                        return (
                          <div
                            key={row.action.id}
                            className="flex items-stretch gap-2 border-b border-border/60 py-1 pl-2.5 last:border-b-0"
                          >
                            <div className={`${ROW_LABEL_WIDTH} shrink-0`}>
                              <div
                                className="truncate text-[10.5px] font-medium text-primary"
                                title={row.action.name}
                              >
                                {row.action.name}
                              </div>
                            </div>

                            <div className="relative flex-1" style={{ height: trackHeight }}>
                              <TimelineGridColumns columns={columns} />
                              {todayPct != null && <TimelineTodayMarker leftPct={todayPct} />}

                              <TimelineBar
                                left={startPct}
                                width={widthPct}
                                top={0}
                                height={LEVIER_BAR_HEIGHT}
                                color={axisColor}
                                variant="outline"
                                progressPct={row.progressPct}
                                onClick={
                                  onLevierClick
                                    ? () => onLevierClick(row.chantier.id, row.action.id)
                                    : undefined
                                }
                                ariaLabel={row.action.name}
                                tooltipText={`${row.action.name} · ${formatTimelineDay(row.start)} → ${formatTimelineDay(
                                  row.end
                                )} · ${l.progress} ${row.progressPct}%`}
                                label={row.action.name}
                                labelClassName="min-w-0 flex-1 truncate text-[9.5px] font-semibold text-primary"
                                inlineMinWidthPct={10}
                                trailing={
                                  <span className="shrink-0 text-[9.5px] font-bold text-primary">
                                    {row.progressPct}%
                                  </span>
                                }
                              />

                              {row.deliverables.map((deliverable) => (
                                <TimelineMarker
                                  key={deliverable.id}
                                  leftPct={pctOf(deliverable.dueDate!)}
                                  top={LEVIER_BAR_HEIGHT + DELIVERABLE_MARKER_LANE_HEIGHT / 2}
                                  size={9}
                                  color={deliverableMarkerColor(deliverable.status)}
                                  onClick={
                                    onLevierClick
                                      ? () => onLevierClick(row.chantier.id, row.action.id)
                                      : undefined
                                  }
                                  ariaLabel={deliverable.label}
                                  tooltipText={`${deliverable.label} · ${formatTimelineDay(deliverable.dueDate!)}`}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
