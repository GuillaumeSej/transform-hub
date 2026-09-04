"use client";

import { useMemo, useState } from "react";
import { Lock, TriangleAlert } from "lucide-react";
import {
  formatTimelineDay,
  packTimelineLanes,
  timelineColumns,
  timelinePctOf,
  timelineRange,
  timelineYearBands,
  TimelineBar,
  TimelineGridColumns,
  TimelineHeaderRow,
  TimelineScaleToggle,
  hexToRgb,
  withAlpha,
  type TimelineScale,
} from "@/components/strategic/TimelineBars";
import {
  canStartAction,
  chantierBounds,
  chantierProgress,
  type ChantierDependencyAlert,
} from "@/lib/axisLogic";
import { resolveMaturityStageLabel } from "@/lib/hooks/useMaturityStages";
import type { Chantier, ChantierAction, MaturityStageConfig } from "@/types";

/**
 * Gantt simplifié d'un axe stratégique : UN BLOC = UN CHANTIER, borné par la première et la
 * dernière action du chantier (`axisLogic.chantierBounds`), avec les actions individuelles
 * rendues en sous-barres NOMMÉES à l'intérieur de la même ligne (les « deux mailles de lecture »
 * demandées : macro pour la vue exécutive, fine au survol/clic).
 *
 * CLONE ALLÉGÉ de `components/shared/charts/ActionGantt.tsx`, volontairement PAS une
 * généricisation de celui-ci (même convention que `StageBadge` → `AxisStageBadge`) : le Gantt
 * levier est entièrement structuré par la dimension financière (couleur = gain/coût net, montant
 * affiché en bout de barre, marqueurs de milestone CAPEX et de date d'encaissement des gains),
 * dimension qui n'existe PAS au niveau chantier/action stratégique. Il ne reste, une fois cette
 * dimension retirée, que le squelette temporel — d'où un composant neuf plutôt qu'un composant
 * commun criblé d'options.
 *
 * Trois partis pris de lisibilité, demandés par le PO qui suit les CHANTIERS au quotidien :
 *  1. les blocs sont REMPLIS de la couleur de l'axe (et non de simples contours), avec un
 *     remplissage plus soutenu proportionnel à l'avancement (`axisLogic.chantierProgress`) ;
 *  2. le nom de chaque action est écrit DANS sa barre (rabattu à droite de la barre quand elle est
 *     trop étroite, et toujours repris dans l'infobulle) ;
 *  3. l'échelle temporelle est réglable Mois / Trimestre / Semestre — sur un plan de 2-3 ans,
 *     l'échelle mensuelle produisait ~30 colonnes vides et illisibles, d'où le TRIMESTRE par
 *     défaut.
 *
 * Round 4, point 9 : le calcul de grille de colonnes + le rendu d'une barre colorée sont EXTRAITS
 * dans `components/strategic/TimelineBars.tsx` (partagés avec la timeline de livrables de la fiche
 * chantier dédiée) — seule la mise en page PROPRE à ce Gantt (colonne d'identité du chantier avec
 * avancement, couloirs d'actions nommées, badge cadenas de prérequis) reste ici.
 *
 * Aucune donnée n'est chargée ni écrite ici : les clics remontent à l'appelant
 * (`AxisDetailClient`), qui navigue vers la fiche chantier dédiée dans les deux cas (clic sur le
 * bloc chantier OU sur une action).
 */

export type ChantierGanttLabels = {
  /** Aucun chantier du tout sur l'axe. */
  empty?: string;
  /** Titre du bloc listant les chantiers sans action (donc sans bornes exploitables). */
  unplannedTitle?: string;
  noDates?: string;
  actionsSuffix?: string;
  /** Bascule d'échelle temporelle. */
  scale?: string;
  scaleMonth?: string;
  scaleQuarter?: string;
  scaleSemester?: string;
  progress?: string;
  alerted?: string;
  /** Préfixe affiché devant la liste des raisons de blocage dans l'infobulle d'une action bloquée
   *  (round 4, point 5 — prérequis go/no-go). */
  blockedBy?: string;
};

type Row = {
  chantier: Chantier;
  bounds: { start: string; end: string } | undefined;
  items: ChantierAction[];
};

type PlannedRow = Row & { bounds: { start: string; end: string } };

const ROW_LABEL_WIDTH = "w-64";

/** Couleur de repli quand l'axe n'a pas de couleur choisie — le taupe de la palette BearingPoint
 *  (`--bp-warm-taupe`), en dur parce qu'on a besoin de la composante hex pour calculer les
 *  transparences ci-dessous. */
const FALLBACK_COLOR = "#a99e9a";

const ALERT_COLOR = "#f5a623";

// Round 4, point 9 : blocs de chantier/action agrandis pour que les livrables/actions restent
// lisibles à l'intérieur (demande PO explicite, format PERIAL).
const CHANTIER_BAR_HEIGHT = 40;
const ACTION_LANE_HEIGHT = 32;
/** Hauteur réelle d'une barre d'action DANS son couloir (le couloir laisse un peu d'air
 *  au-dessus/en dessous, comme l'espacement `LANES_TOP` ci-dessous). */
const ACTION_BAR_HEIGHT = 24;
const LANES_TOP = CHANTIER_BAR_HEIGHT + 6;

export function ChantierGantt({
  chantiers,
  actions,
  allActions,
  stages,
  axisColor,
  onChantierClick,
  onActionClick,
  alerts,
  labels,
}: {
  chantiers: Chantier[];
  /** Toutes les actions du programme — filtrées par chantier ici (les bornes d'un chantier ne
   *  sont pas stockées, elles se dérivent de ses actions). */
  actions: ChantierAction[];
  /** Univers complet des actions du programme, utilisé pour résoudre les prérequis "action"
   *  (`canStartAction`) — une action prérequise peut appartenir à un autre chantier que celui de
   *  l'action qui la référence. Repli sur `actions` si absent (couvre le cas où l'appelant n'a que
   *  les actions de cet axe sous la main). */
  allActions?: ChantierAction[];
  /** Référentiel d'étapes du programme, pour afficher le libellé d'étape sous le nom du chantier
   *  et calculer l'avancement (`chantierProgress`), ainsi que la satisfaction des prérequis
   *  (`canStartAction`). */
  stages: MaturityStageConfig[];
  /** Couleur de l'axe (`StrategicAxis.color`) — teinte de tous les blocs de ce Gantt. */
  axisColor?: string;
  onChantierClick?: (chantier: Chantier) => void;
  /** Clic sur une action : l'appelant ouvre la MÊME pop-up que pour son chantier, focalisée sur
   *  l'action cliquée. */
  onActionClick?: (action: ChantierAction, chantier: Chantier) => void;
  /** Alertes de cascade de dépendance entre chantiers (`chantierDependencyAlerts`, tableau complet
   *  — round 4, point 2) : les chantiers concernés sont teintés en ambre et marqués d'un triangle,
   *  et l'infobulle du bloc chantier détaille le(s) message(s) précis plutôt qu'un texte générique. */
  alerts?: ChantierDependencyAlert[];
  labels?: ChantierGanttLabels;
}) {
  const l = {
    empty: labels?.empty ?? "Aucun chantier sur cet axe.",
    unplannedTitle: labels?.unplannedTitle ?? "Chantiers sans action planifiée",
    noDates: labels?.noDates ?? "Pas encore de date — ajoutez une action",
    actionsSuffix: labels?.actionsSuffix ?? "actions",
    scale: labels?.scale ?? "Échelle",
    scaleMonth: labels?.scaleMonth ?? "Mois",
    scaleQuarter: labels?.scaleQuarter ?? "Trimestre",
    scaleSemester: labels?.scaleSemester ?? "Semestre",
    progress: labels?.progress ?? "Avancement",
    alerted: labels?.alerted ?? "Dépendance en alerte",
    blockedBy: labels?.blockedBy ?? "Bloqué par :",
  };

  const effectiveAllActions = allActions ?? actions;

  // Dérivé de `alerts` : ensemble rapide des chantiers concernés (teinte ambre) + détail par
  // chantier (message(s) précis affichés dans l'infobulle, voir round 4 point 2).
  const alertedChantierIds = useMemo(
    () => new Set((alerts ?? []).flatMap((a) => [a.sourceId, a.targetId])),
    [alerts]
  );
  const alertsByChantier = useMemo(() => {
    const map = new Map<string, ChantierDependencyAlert[]>();
    for (const alert of alerts ?? []) {
      for (const chantierId of [alert.sourceId, alert.targetId]) {
        const list = map.get(chantierId);
        if (list) list.push(alert);
        else map.set(chantierId, [alert]);
      }
    }
    return map;
  }, [alerts]);

  // Trimestre par défaut : meilleur compromis lisibilité/détail sur un plan de 2-3 ans.
  const [scale, setScale] = useState<TimelineScale>("quarter");

  const color = axisColor && hexToRgb(axisColor) ? axisColor : FALLBACK_COLOR;

  const rows = useMemo<Row[]>(
    () =>
      chantiers.map((chantier) => ({
        chantier,
        bounds: chantierBounds(chantier.id, actions),
        items: actions
          .filter((a) => a.chantierId === chantier.id)
          .sort((a, b) => a.start.localeCompare(b.start)),
      })),
    [chantiers, actions]
  );

  const planned = rows.filter((r): r is PlannedRow => r.bounds !== undefined);
  const unplanned = rows.filter((r) => r.bounds === undefined);

  const { minTime, maxTime } = useMemo(
    () =>
      timelineRange(
        planned.map((r) => r.bounds),
        scale
      ),
    [planned, scale]
  );

  const pctOf = useMemo(() => timelinePctOf(minTime, maxTime), [minTime, maxTime]);

  const columns = useMemo(
    () => (planned.length === 0 ? [] : timelineColumns(minTime, maxTime, scale)),
    [minTime, maxTime, scale, planned.length]
  );

  const yearBands = useMemo(() => timelineYearBands(columns), [columns]);

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-tertiary">{l.empty}</p>;
  }

  const openChantier = (chantier: Chantier) => onChantierClick?.(chantier);

  const scaleOptions: { value: TimelineScale; label: string }[] = [
    { value: "month", label: l.scaleMonth },
    { value: "quarter", label: l.scaleQuarter },
    { value: "semester", label: l.scaleSemester },
  ];

  return (
    <div className="w-full">
      {planned.length > 0 && (
        <>
          {/* ── Bascule d'échelle temporelle ───────────────────────────────────────────────── */}
          <div className="mb-2.5 flex flex-wrap items-center justify-end gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
              {l.scale}
            </span>
            <TimelineScaleToggle value={scale} onChange={setScale} options={scaleOptions} />
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              {/* ── En-tête : années puis colonnes de la maille ──────────────────────────── */}
              <TimelineHeaderRow
                columns={columns}
                yearBands={yearBands}
                labelWidthClassName={ROW_LABEL_WIDTH}
              />

              {/* ── Une ligne par chantier ───────────────────────────────────────────────── */}
              {planned.map(({ chantier, bounds, items }) => {
                const startPct = pctOf(bounds.start);
                const widthPct = Math.max(1.5, pctOf(bounds.end) - startPct);
                const isAlerted = alertedChantierIds.has(chantier.id);
                const chantierAlerts = alertsByChantier.get(chantier.id) ?? [];
                const progress = chantierProgress(chantier.id, actions, stages);
                const lanes = packTimelineLanes(items);
                const trackHeight = LANES_TOP + Math.max(1, lanes.length) * ACTION_LANE_HEIGHT;
                const blockColor = isAlerted ? ALERT_COLOR : color;

                return (
                  <div
                    key={chantier.id}
                    className="flex items-stretch gap-2 border-b border-border py-1.5 last:border-b-0"
                  >
                    {/* Colonne d'identité du chantier */}
                    <div
                      className={`${ROW_LABEL_WIDTH} shrink-0 border-l-[3px] pl-2`}
                      style={{ borderColor: blockColor }}
                    >
                      <div
                        className="truncate text-[11.5px] font-semibold text-primary"
                        title={chantier.name}
                      >
                        {chantier.name}
                      </div>
                      <div className="truncate text-[10px] text-tertiary">
                        {resolveMaturityStageLabel(chantier.stage, stages)} · {items.length}{" "}
                        {l.actionsSuffix}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-100">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${progress.pct}%`,
                              backgroundColor: blockColor,
                            }}
                          />
                        </div>
                        <span className="shrink-0 text-[9.5px] font-bold text-secondary">
                          {progress.pct}%
                        </span>
                      </div>
                    </div>

                    <div className="relative flex-1" style={{ height: trackHeight }}>
                      {/* Grille de colonnes */}
                      <TimelineGridColumns columns={columns} />

                      {/* Bloc macro du chantier (maille exécutive) — REMPLI, avec la part
                          d'avancement en teinte soutenue. */}
                      <TimelineBar
                        left={startPct}
                        width={widthPct}
                        top={0}
                        height={CHANTIER_BAR_HEIGHT}
                        color={blockColor}
                        variant="outline"
                        progressPct={progress.pct}
                        ringed={isAlerted}
                        onClick={() => openChantier(chantier)}
                        ariaLabel={chantier.name}
                        tooltipText={`${chantier.name} · ${formatTimelineDay(bounds.start)} → ${formatTimelineDay(
                          bounds.end
                        )} · ${l.progress} ${progress.pct}%${
                          chantierAlerts.length > 0
                            ? ` · ${l.alerted} : ${chantierAlerts.map((a) => a.message).join(" ; ")}`
                            : ""
                        }`}
                        label={chantier.name}
                        labelClassName="min-w-0 flex-1 truncate text-[11px] font-semibold text-primary"
                        icon={
                          isAlerted ? (
                            <TriangleAlert size={11} className="shrink-0 text-rag-amber" />
                          ) : undefined
                        }
                        trailing={
                          <span className="shrink-0 text-[11px] font-bold text-primary">
                            {progress.pct}%
                          </span>
                        }
                      />

                      {/* Actions individuelles (maille fine), NOMMÉES — même pop-up au clic. */}
                      {lanes.map((lane, laneIndex) =>
                        lane.map((action) => {
                          const aStart = pctOf(action.start);
                          const aWidth = Math.max(0.8, pctOf(action.end) - aStart);
                          const top = LANES_TOP + laneIndex * ACTION_LANE_HEIGHT;
                          // Prérequis go/no-go (round 4, point 5) — purement informatif : le badge
                          // cadenas et la raison en infobulle n'empêchent AUCUNE transition.
                          const startInfo = canStartAction(action, effectiveAllActions, stages);
                          return (
                            <TimelineBar
                              key={action.id}
                              left={aStart}
                              width={aWidth}
                              top={top}
                              height={ACTION_BAR_HEIGHT}
                              color={blockColor}
                              variant="solid"
                              roundedClassName="rounded-sm"
                              // Sous ~14 % de la piste, un nom écrit dans la barre serait réduit à
                              // « D… » : on le rabat alors juste à droite de la barre. Seuil en
                              // POURCENTAGE de largeur, indépendant de la hauteur de la barre —
                              // inchangé malgré l'agrandissement round 4 (voir doc-comment plus haut).
                              inlineMinWidthPct={14}
                              onClick={() => onActionClick?.(action, chantier)}
                              ariaLabel={action.name}
                              tooltipText={`${action.name} · ${formatTimelineDay(action.start)} → ${formatTimelineDay(
                                action.end
                              )} · ${resolveMaturityStageLabel(action.status, stages)}${
                                action.owner ? ` · ${action.owner}` : ""
                              }${
                                startInfo.blocked
                                  ? ` · ${l.blockedBy} ${startInfo.reasons.join(", ")}`
                                  : ""
                              }`}
                              label={action.name}
                              labelClassName="min-w-0 flex-1 truncate text-[9.5px] font-medium leading-none"
                              icon={
                                startInfo.blocked ? (
                                  <Lock size={9} className="shrink-0" aria-hidden />
                                ) : undefined
                              }
                            />
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {unplanned.length > 0 && (
        <div className={planned.length > 0 ? "mt-4 border-t border-border pt-3" : ""}>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
            {l.unplannedTitle}
          </div>
          <div className="flex flex-wrap gap-2">
            {unplanned.map(({ chantier }) => (
              <button
                key={chantier.id}
                onClick={() => openChantier(chantier)}
                className="rounded-md border border-dashed border-border px-3 py-2 text-left transition hover:border-black"
                style={{ backgroundColor: withAlpha(color, 0.08) }}
              >
                <div className="text-[11.5px] font-semibold text-primary">{chantier.name}</div>
                <div className="text-[10px] text-tertiary">{l.noDates}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
