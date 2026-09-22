"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Layers, TriangleAlert } from "lucide-react";
import {
  axisSponsorLabel,
  displayMilestoneId,
  isProjetLate,
  programRoadmap,
  type ProgramRoadmapRow,
} from "@/lib/axisLogic";
import { Tooltip } from "@/components/shared/Tooltip";
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
  hexToRgb,
  withAlpha,
  type TimelineScale,
} from "@/components/strategic/TimelineBars";
import type { Chantier, ChantierAction, ProjetKanbanStatus, StrategicAxis } from "@/types";

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
 * un axe (`StrategicAxesView.tsx`, `projetBoardGroups` de `StrategicDashboardView.tsx`).
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
  /** Round 20, point 3 : titre/tooltip de l'icône d'alerte discrète d'un levier/chantier en
   *  retard (`isProjetLate`/`isChantierLate`, lib/axisLogic.ts). */
  late?: string;
  /** Round 21 (retour PO) : tooltip de la pastille de comptage "N/total en retard" au niveau
   *  chantier — gabarit avec jetons `{n}` (leviers en retard) et `{total}` (leviers du chantier),
   *  cf. usage ci-dessous. Remplace l'icône seule (`late`), jugée ambiguë sur un chantier à
   *  plusieurs leviers : impossible de distinguer "1 en retard sur 2" de "tout le chantier est en
   *  retard" sans ce comptage explicite. */
  lateCount?: string;
  /** Round 28 : préfixe de l'infobulle du badge "jalon courant" posé sur chaque ligne de levier
   *  (ex. "Jalon actuel : J2") — voir `displayMilestoneId`, lib/axisLogic.ts. */
  currentMilestone?: string;
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

function deliverableMarkerColor(status: ProjetKanbanStatus | undefined): string {
  switch (status) {
    case "done":
      return DELIVERABLE_COLOR_GREEN;
    case "in_progress":
      return DELIVERABLE_COLOR_AMBER;
    default:
      return DELIVERABLE_COLOR_RED;
  }
}

// Hauteurs de ligne (round 17) : agrandies par rapport au round 15 (le PO trouvait la vue trop
// plate/compacte) tout en restant plus resserrées que `ChantierGantt.tsx`/`ChantierDetailPanel.tsx`
// — ce composant affiche l'ensemble du programme (potentiellement plusieurs dizaines de leviers)
// alors que ceux-là se bornent à un seul axe/chantier.
const LEVIER_BAR_HEIGHT = 30;
// Round 25 (retour PO) : les losanges de livrable sont désormais posés DIRECTEMENT sur la barre du
// levier (même centre vertical qu'elle) plutôt que dans une piste séparée en dessous — la piste
// dédiée `DELIVERABLE_MARKER_LANE_HEIGHT` (et la hauteur de ligne conditionnelle qui l'accompagnait,
// `trackHeight = hasDeliverables ? ... : LEVIER_BAR_HEIGHT`) disparaît donc : chaque ligne mesure
// simplement `LEVIER_BAR_HEIGHT`, qu'elle ait des livrables ou non.
//
// Round 26 (retour PO — "le 24% est en dessous du losange") : l'échéance d'un livrable tombe très
// souvent près (ou pile) de la date de fin du levier, donc le losange atterrit quasiment à la même
// position horizontale que le "N%"/triangle "en retard" posés juste après la barre — et comme les
// DEUX étaient centrés verticalement sur la même barre (`top = LEVIER_BAR_HEIGHT / 2`), ils se
// chevauchaient. Plutôt que de compter sur un agrandissement pour éviter la collision, le "N%"/
// triangle est déplacé dans une bande verticale dédiée AU-DESSUS de la barre (jamais partagée avec
// les losanges, qui restent centrés sur la barre) : collision impossible par construction, quelle
// que soit la coïncidence horizontale. `LEVIER_LABEL_HEIGHT` réserve cette bande DANS le conteneur
// de la ligne (plutôt qu'un `top` négatif qui déborderait du conteneur) : la ligne mesure désormais
// `LEVIER_LABEL_HEIGHT + LEVIER_BAR_HEIGHT`, la barre est décalée de `LEVIER_LABEL_HEIGHT` vers le
// bas — pas de recadrage/chevauchement avec la ligne précédente.
const LEVIER_LABEL_HEIGHT = 14;

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
  onProjetClick,
  onChantierClick,
  renderAxisHeader,
  labels,
  clickableActionIds = "all",
  users,
}: {
  /** Pour afficher le nom complet du sponsor d'axe dans l'en-tête par défaut. */
  users?: { username: string; name: string }[];
  axes: StrategicAxis[];
  chantiers: Chantier[];
  /** Tous les leviers du programme actif (toutes les actions, pas filtrées par axe/chantier — voir
   *  `axisLogic.programRoadmap`). */
  actions: ChantierAction[];
  /** Clic sur une barre de levier ou un losange de livrable — l'appelant ouvre le panneau du
   *  CHANTIER parent, focalisé sur ce levier (même contrat que `openChantierPanel` de
   *  `StrategicDashboardView.tsx`). */
  onProjetClick?: (chantierId: string, actionId: string) => void;
  /** Clic sur l'en-tête de chantier (round 16) — même contrat que `onProjetClick` mais sans levier
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
  /** Round 25 (RBAC `chantier_contributor`) — voir `StrategicData.clickableActionIds`,
   *  lib/hooks/useStrategicData.ts. Un levier dont l'id n'est PAS dans cet ensemble reste rendu
   *  normalement (ligne, barre, losanges de livrable) mais devient INERTE au clic : `onProjetClick`
   *  n'est jamais invoqué pour lui, quel que soit le prop `onProjetClick` fourni. Défaut `"all"`
   *  (comportement historique inchangé) : tous les autres appelants restent inutilement affectés. */
  clickableActionIds?: Set<string> | "all";
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
    late: labels?.late ?? "En retard",
    lateCount: labels?.lateCount,
    currentMilestone: labels?.currentMilestone ?? "Jalon actuel",
  };

  // Semestre par défaut : le programme complet s'étend typiquement sur plusieurs années, la maille
  // trimestrielle y produirait déjà beaucoup de colonnes — meilleur compromis lisibilité/détail pour
  // une vue "globale" par défaut (l'utilisateur affine vers Trimestre s'il pilote une échéance
  // précise, ou vers Année pour l'aperçu le plus large).
  const [scale, setScale] = useState<TimelineScale>("semester");

  const rows = useMemo(() => programRoadmap(axes, chantiers, actions), [axes, chantiers, actions]);
  const grouped = useMemo(() => groupRowsByAxisAndChantier(rows), [rows]);

  /** Round 25 : un levier est cliquable si `onProjetClick` est fourni ET (`clickableActionIds`
   *  vaut `"all"` OU liste explicitement son id) — voir le doc-comment du prop ci-dessus. */
  const isActionClickable = (actionId: string) =>
    !!onProjetClick && (clickableActionIds === "all" || clickableActionIds.has(actionId));

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
                <div
                  key={axisGroup.axis.id}
                  className="mb-4 overflow-hidden rounded-lg border border-border"
                  style={{
                    borderLeft: `4px solid ${axisColor}`,
                    backgroundColor: withAlpha(axisColor, 0.05),
                  }}
                >
                  {/* En-tête d'axe — volontairement PAS collant (contrairement à l'en-tête de
                      colonnes ci-dessus) : sa hauteur variant avec le nombre de chantiers/leviers
                      qu'il précède, l'empiler proprement sous l'en-tête de colonnes demanderait de
                      recalculer un offset dynamique par section, pour un bénéfice de lisibilité
                      marginal une fois l'en-tête de colonnes déjà fixe.
                      Round 17 : le fond/bordure "carte" de la section vient désormais du conteneur
                      englobant ci-dessus (`axisColor` en wash + bordure gauche 4px), plus seulement
                      d'un liséré sur cette seule ligne d'en-tête — pastille + trait de séparation
                      conservés pour que l'en-tête reste identifiable même sans `renderAxisHeader`. */}
                  {renderAxisHeader ? (
                    renderAxisHeader(axisGroup.axis)
                  ) : (
                    <div className="flex items-center gap-1.5 border-b border-border-strong px-2.5 py-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: axisColor }}
                      />
                      <span className="truncate text-[11.5px] font-bold uppercase tracking-wide text-primary">
                        {axisGroup.axis.name}
                      </span>
                      {axisGroup.axis.owner && (
                        <span className="truncate text-[10.5px] text-tertiary">
                          · Sponsor : {axisSponsorLabel(axisGroup.axis, users)}
                        </span>
                      )}
                    </div>
                  )}

                  {axisGroup.chantierGroups.map((chantierGroup) => {
                    // Round 20, point 3 : indicateur discret près du nom du chantier dès qu'au
                    // moins un de ses leviers est en retard (`isChantierLate`, lib/axisLogic.ts)
                    // — pas de contour rouge complet, demande PO explicite.
                    //
                    // Round 21 (retour PO) : une icône seule ne dit pas COMBIEN de leviers sont en
                    // retard — sur un chantier à 2 leviers, ça se lisait comme "tout le chantier
                    // est en retard" alors qu'un seul pouvait l'être. On calcule donc le compte
                    // réel (leviers en retard / total du chantier) et on l'affiche dans la pastille
                    // ci-dessous plutôt que la seule icône.
                    const lateLevierCount = chantierGroup.rows.filter((r) =>
                      isProjetLate(r.action, r.progressPct)
                    ).length;
                    const totalLevierCount = chantierGroup.rows.length;
                    // Round 27 (retour PO — l'en-tête de chantier "flotte" au-dessus des lignes de
                    // levier sans porter le même accent qu'elles, ce qui se lit comme une "double
                    // barre" incohérente à côté du liséré 4px de la carte d'axe) : avancement AGRÉGÉ
                    // du chantier affiché dans l'en-tête, moyenne du `progressPct` de ses leviers —
                    // déjà porté par `chantierGroup.rows`, aucune donnée supplémentaire à charger.
                    // Même convention d'agrégation que `chantierMilestoneProgressPct`
                    // (lib/axisLogic.ts, "agrégation chantier = moyenne des leviers"), recalculée ici
                    // plutôt qu'importée pour rester cohérente avec le `progressPct` par LEVIER déjà
                    // affiché sur chaque ligne ci-dessous (même parti pris que `ProgramRoadmapRow.
                    // progressPct` lui-même, voir son doc-comment dans lib/axisLogic.ts).
                    const chantierProgressPct =
                      totalLevierCount === 0
                        ? 0
                        : Math.round(
                            chantierGroup.rows.reduce((sum, r) => sum + r.progressPct, 0) /
                              totalLevierCount
                          );
                    return (
                      <div key={chantierGroup.chantier.id}>
                        {/* En-tête de chantier — round 27 : même traitement de bordure gauche
                          accentuée (`border-l-[3px]`, couleur de l'axe) que les lignes de levier
                          juste en dessous (patron d'identité de `ChantierGantt.tsx` : nom + méta +
                          mini barre de progression, adapté ici pour rester un en-tête de GROUPE
                          au-dessus de plusieurs lignes plutôt qu'un bloc par chantier isolé).
                          Bouton (round 16) cliquable si `onChantierClick` est fourni, sinon reste un
                          simple texte non interactif (comportement historique inchangé).
                          Round 29 (retour PO — « on ne distingue pas assez une ligne chantier d'une
                          ligne projet ») : le round 27 faisait PARTAGER le même liséré accentué
                          couleur d'axe à l'en-tête et aux lignes de levier pour former "une seule
                          colonne continue" — exactement ce qui les rendait indiscernables. Le liséré
                          couleur d'axe (`border-l-[3px]`) devient désormais l'apanage EXCLUSIF de cet
                          en-tête (les lignes de levier ci-dessous passent à un liséré neutre fin,
                          voir plus bas) ; un fond gris très léger (`bg-neutral-100/70`, indépendant
                          de la couleur d'axe pour rester lisible quelle que soit sa teinte), une
                          icône `Layers` et un nom en gras plus grand achèvent de marquer cet en-tête
                          comme le PARENT du groupe plutôt qu'une ligne de plus dans la même colonne. */}
                        <button
                          type="button"
                          disabled={!onChantierClick}
                          onClick={
                            onChantierClick
                              ? () => onChantierClick(chantierGroup.chantier.id)
                              : undefined
                          }
                          className={`${ROW_LABEL_WIDTH} flex shrink-0 flex-col gap-1 rounded-r border-l-[3px] bg-neutral-100/70 py-1.5 pl-2 pr-2 text-left transition ${
                            onChantierClick ? "hover:bg-neutral-100" : ""
                          }`}
                          style={{ borderColor: axisColor }}
                        >
                          <div className="flex items-center gap-1">
                            <Layers size={12} className="shrink-0 text-secondary" aria-hidden />
                            <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-primary">
                              {chantierGroup.chantier.name}
                              <span className="ml-1 font-normal text-tertiary">
                                · {chantierGroup.rows.length} {l.leviersSuffix}
                              </span>
                            </span>
                            {lateLevierCount > 0 && (
                              <span
                                className="flex shrink-0 items-center gap-1 rounded-full bg-rag-red-light px-1.5 py-0.5 text-[10px] font-bold text-rag-red"
                                title={
                                  l.lateCount
                                    ? l.lateCount
                                        .replace("{n}", String(lateLevierCount))
                                        .replace("{total}", String(totalLevierCount))
                                    : undefined
                                }
                              >
                                <TriangleAlert size={11} aria-hidden />
                                {lateLevierCount}/{totalLevierCount}
                              </span>
                            )}
                          </div>
                          {/* Round 27 : mini barre de progression + pourcentage — même composition
                              visuelle que la colonne d'identité de `ChantierGantt.tsx` (barre `h-1`
                              arrondie + libellé `text-[9.5px] font-bold`), pour que l'en-tête porte
                              une information utile au premier coup d'œil plutôt qu'un simple nom +
                              compteur. */}
                          <div className="flex items-center gap-1.5">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-100">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${chantierProgressPct}%`,
                                  backgroundColor: axisColor,
                                }}
                              />
                            </div>
                            <span className="shrink-0 text-[9.5px] font-bold text-secondary">
                              {chantierProgressPct}%
                            </span>
                          </div>
                        </button>

                        {chantierGroup.rows.map((row) => {
                          const startPct = pctOf(row.start);
                          const widthPct = Math.max(1.2, pctOf(row.end) - startPct);
                          // Round 20, point 3 : icône d'alerte discrète juste après la barre d'un
                          // levier en retard (`isProjetLate`, lib/axisLogic.ts).
                          const levierLate = isProjetLate(row.action, row.progressPct);
                          // Round 25 : position "juste après la fin de la barre" partagée par le
                          // pourcentage d'avancement ET le triangle "en retard" — regroupés dans un
                          // même repère (voir bloc `absolute` ci-dessous) pour qu'ils ne se
                          // chevauchent jamais entre eux, plutôt que deux éléments positionnés
                          // indépendamment au même endroit.
                          const afterBarLeftPct = Math.min(startPct + widthPct, 95);
                          // Round 25 (RBAC `chantier_contributor`) : ce levier précis est-il
                          // cliquable pour l'utilisateur courant ? Voir `isActionClickable`
                          // ci-dessus — remplace TOUTES les conditions `onProjetClick ? … :
                          // undefined` de cette ligne (label, barre, triangle "en retard",
                          // losanges de livrable), qui ne testaient jusqu'ici que la présence du
                          // callback, jamais le droit sur CE levier précis.
                          const rowClickable = isActionClickable(row.action.id);

                          return (
                            <div
                              key={row.action.id}
                              // Round 27 : `pl-2.5` retiré — c'était une couche de retrait
                              // redondante avec le `pl-2` déjà porté par la colonne d'identité
                              // ci-dessous. Même patron que `ChantierGantt.tsx`, dont la ligne
                              // équivalente n'a pas ce `pl-*` supplémentaire non plus.
                              //
                              // Round 29 (retour PO — distinguer chantier/projet) : le liséré
                              // gauche couleur d'axe (`border-l-[3px]`) de cette colonne
                              // d'identité, PARTAGÉ jusqu'ici avec l'en-tête de chantier ci-dessus
                              // pour former "une seule colonne continue", est remplacé par un
                              // liséré neutre plus fin (`border-l-2 border-border`) — la couleur
                              // d'axe reste l'apanage exclusif de l'en-tête (voir son doc-comment).
                              // `pl-3` (au lieu de `pl-2`) accentue en plus le retrait de ce nom de
                              // projet par rapport au nom de chantier ci-dessus, pour qu'il se lise
                              // comme un enfant indenté sous son parent plutôt qu'une ligne au même
                              // niveau. Purement visuel : ni `ROW_LABEL_WIDTH` ni l'alignement avec
                              // les barres du Gantt à droite ne changent.
                              className="flex items-stretch gap-2 border-b border-border/60 py-1.5 last:border-b-0"
                            >
                              <div
                                className={`${ROW_LABEL_WIDTH} shrink-0 border-l-2 border-border pl-3`}
                              >
                                {/* Round 20, point 2 : nom du levier cliquable (même destination que
                                  la barre ci-dessous, `onProjetClick`) et centré verticalement dans
                                  sa colonne — la ligne parente est `flex items-stretch`, ce label
                                  collait donc en haut sans ce centrage propre.
                                  Round 28 : badge "jalon courant" (ex. "J2", `displayMilestoneId`)
                                  ajouté À L'INTÉRIEUR de ce même élément cliquable — remplace la
                                  fraction "N/5" jugée confuse par le PO (« ça ne dit pas si je suis
                                  à J1 ou J2 ») par un repère direct, sans second gestionnaire de
                                  clic : le badge profite du même `onClick` que le nom du levier.
                                  Round 29 : ce badge est désormais le SEUL repère de progression
                                  visible sur la ligne projet — le "N%" jumeau qui vivait à côté de la
                                  barre (plus bas) a été retiré (même info, juste réexprimée en %,
                                  ce qui lisait comme une incohérence pour le PO). Taille de texte
                                  légèrement réduite (`text-[10px]`, au lieu de `text-[10.5px]`) pour
                                  accentuer l'écart avec le nom de chantier ci-dessus (`text-[12.5px]
                                  font-bold`). */}
                                <div
                                  className={`flex h-full items-center gap-1.5 text-[10px] font-medium text-primary ${
                                    rowClickable
                                      ? "cursor-pointer hover:text-bp-coral hover:underline"
                                      : ""
                                  }`}
                                  title={row.action.name}
                                  onClick={
                                    rowClickable
                                      ? () => onProjetClick!(row.chantier.id, row.action.id)
                                      : undefined
                                  }
                                >
                                  <span className="min-w-0 flex-1 truncate">{row.action.name}</span>
                                  <span
                                    className="shrink-0 rounded-full border border-border bg-neutral-50 px-1.5 py-0.5 text-[9.5px] font-bold text-secondary"
                                    title={`${l.currentMilestone} : ${displayMilestoneId(
                                      row.action.milestones?.currentMilestone ?? "E0"
                                    )}`}
                                  >
                                    {displayMilestoneId(
                                      row.action.milestones?.currentMilestone ?? "E0"
                                    )}
                                  </span>
                                </div>
                              </div>

                              <div
                                className="relative flex-1"
                                style={{ height: LEVIER_LABEL_HEIGHT + LEVIER_BAR_HEIGHT }}
                              >
                                <TimelineGridColumns columns={columns} />

                                <TimelineBar
                                  left={startPct}
                                  width={widthPct}
                                  top={LEVIER_LABEL_HEIGHT}
                                  height={LEVIER_BAR_HEIGHT}
                                  color={axisColor}
                                  variant="solid"
                                  progressPct={row.progressPct}
                                  onClick={
                                    rowClickable
                                      ? () => onProjetClick!(row.chantier.id, row.action.id)
                                      : undefined
                                  }
                                  ariaLabel={row.action.name}
                                  tooltipText={`${row.action.name} · ${formatTimelineDay(row.start)} → ${formatTimelineDay(
                                    row.end
                                  )} · ${l.progress} ${row.progressPct}%`}
                                  label={row.action.name}
                                  labelClassName="min-w-0 flex-1 truncate text-[9.5px] font-semibold"
                                  inlineMinWidthPct={10}
                                />

                                {/* Round 25/26 (retour PO) : bande réservée à côté de la barre, dans
                                    `LEVIER_LABEL_HEIGHT` (AU-DESSUS de la barre, jamais dans la bande
                                    des losanges de livrable — voir historique round 25/26 pour le
                                    détail du repositionnement). Round 29 (retour PO — "tantôt un %,
                                    tantôt un badge J1/J2, ce n'est pas cohérent") : le "N%" qui vivait
                                    ici a été RETIRÉ pour les lignes PROJET — le badge "jalon courant"
                                    posé sur le libellé (ci-dessus, colonne d'identité) porte déjà
                                    exactement la même information (`milestoneProgressPct` dérive du
                                    même `passedMilestones`), le répéter en pourcentage juste à côté
                                    lisait comme deux indicateurs contradictoires. Le pourcentage reste
                                    disponible dans `tooltipText` de la barre ci-dessus (survol) et
                                    dans l'en-tête de chantier (`chantierProgressPct`, une moyenne
                                    distincte, INCHANGÉE). Ce bloc ne porte donc plus que le triangle
                                    "en retard" ci-dessous. */}
                                <div
                                  className="pointer-events-none absolute flex items-center gap-1"
                                  style={{
                                    left: `${afterBarLeftPct}%`,
                                    top: 0,
                                    height: LEVIER_LABEL_HEIGHT,
                                    marginLeft: 4,
                                  }}
                                >
                                  {/* Round 25 (retour PO) : l'icône d'alerte "en retard" n'avait
                                      qu'un `title` HTML natif (pas de survol stylé, pas de nom de
                                      levier dans le message) et n'était pas cliquable. Remplacée par
                                      le `Tooltip` partagé (même patron que `tooltipText` de la barre
                                      ci-dessus) et rendue cliquable — même destination
                                      (`onProjetClick`) que la barre et le libellé de la ligne. PAS
                                      de contour rouge complet (demande PO explicite, voir plan round
                                      20). */}
                                  {levierLate && (
                                    <Tooltip
                                      text={`${row.action.name} · ${l.late}`}
                                      className="pointer-events-auto"
                                    >
                                      <button
                                        type="button"
                                        disabled={!rowClickable}
                                        onClick={
                                          rowClickable
                                            ? () => onProjetClick!(row.chantier.id, row.action.id)
                                            : undefined
                                        }
                                        aria-label={`${row.action.name} · ${l.late}`}
                                        className={`flex text-rag-red ${rowClickable ? "cursor-pointer hover:brightness-110" : ""}`}
                                      >
                                        <TriangleAlert size={12} aria-hidden />
                                      </button>
                                    </Tooltip>
                                  )}
                                </div>

                                {/* Round 25 (retour PO) : losanges de livrable posés DIRECTEMENT sur
                                    la barre du levier (même centre vertical qu'elle) — plus dans une
                                    piste séparée en dessous. Round 26 : le centre vertical de la barre
                                    est désormais décalé de `LEVIER_LABEL_HEIGHT` (la bande du "N%"
                                    ci-dessus) — `top` en tient compte pour rester centré SUR la barre,
                                    qui reste la bande dédiée aux losanges (jamais celle du "N%"). */}
                                {row.deliverables.map((deliverable) => (
                                  <TimelineMarker
                                    key={deliverable.id}
                                    leftPct={pctOf(deliverable.dueDate!)}
                                    top={LEVIER_LABEL_HEIGHT + LEVIER_BAR_HEIGHT / 2}
                                    color={deliverableMarkerColor(deliverable.status)}
                                    onClick={
                                      rowClickable
                                        ? () => onProjetClick!(row.chantier.id, row.action.id)
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
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
