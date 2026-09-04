"use client";

import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Tooltip } from "@/components/shared/Tooltip";
import { chantierBounds, chantierProgress } from "@/lib/axisLogic";
import { parseISO } from "@/lib/dateUtils";
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
 * Aucune donnée n'est chargée ni écrite ici : les clics remontent à l'appelant
 * (`AxisDetailClient`), qui ouvre la même pop-up de détail de chantier dans les deux cas (clic sur
 * le bloc chantier OU sur une action).
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
};

/** Maille des colonnes de l'axe temporel. */
type Scale = "month" | "quarter" | "semester";

const SCALE_MONTHS: Record<Scale, number> = { month: 1, quarter: 3, semester: 6 };

type Row = {
  chantier: Chantier;
  bounds: { start: string; end: string } | undefined;
  items: ChantierAction[];
};

type PlannedRow = Row & { bounds: { start: string; end: string } };

const ROW_LABEL_WIDTH = "w-52";

/** Couleur de repli quand l'axe n'a pas de couleur choisie — le taupe de la palette BearingPoint
 *  (`--bp-warm-taupe`), en dur parce qu'on a besoin de la composante hex pour calculer les
 *  transparences ci-dessous. */
const FALLBACK_COLOR = "#a99e9a";

const ALERT_COLOR = "#f5a623";

/** `#rgb` / `#rrggbb` → `[r, g, b]` ; `null` pour toute autre notation (l'appelant retombe alors
 *  sur la couleur brute, sans transparence calculée). */
function hexToRgb(color: string): [number, number, number] | null {
  const hex = color.trim().replace("#", "");
  if (hex.length === 3 && /^[0-9a-f]{3}$/i.test(hex)) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  if (hex.length === 6 && /^[0-9a-f]{6}$/i.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return null;
}

function withAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
}

/** Noir ou blanc selon la luminance du fond — les couleurs d'axe vont du bordeaux très sombre
 *  (#320300) au taupe clair (#B8A99A) : un texte blanc câblé en dur serait illisible sur la
 *  moitié de la palette. */
function readableTextColor(color: string): string {
  const rgb = hexToRgb(color);
  if (!rgb) return "#ffffff";
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance > 0.6 ? "#1f1512" : "#ffffff";
}

/** Libellé d'une colonne de l'axe temporel, selon la maille choisie. Formatage `fr-FR` comme
 *  partout ailleurs dans l'app (cf. `formatTimestamp`, app/(app)/admin/history/page.tsx). */
function columnLabel(date: Date, scale: Scale): string {
  if (scale === "month") return date.toLocaleDateString("fr-FR", { month: "short" });
  if (scale === "quarter") return `T${Math.floor(date.getMonth() / 3) + 1}`;
  return `S${Math.floor(date.getMonth() / 6) + 1}`;
}

function formatDay(iso: string): string {
  const time = parseISO(iso);
  if (Number.isNaN(time)) return iso;
  return new Date(time).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Répartit les actions (déjà triées par date de début) en « couloirs » : deux actions qui se
 * chevauchent dans le temps ne peuvent pas partager la même ligne sans se recouvrir. La plupart
 * des chantiers étant séquentiels, un seul couloir suffit et la ligne reste compacte.
 */
function packLanes(items: ChantierAction[]): ChantierAction[][] {
  const lanes: ChantierAction[][] = [];
  for (const item of items) {
    const lane = lanes.find((l) => parseISO(l[l.length - 1].end) <= parseISO(item.start));
    if (lane) lane.push(item);
    else lanes.push([item]);
  }
  return lanes;
}

const CHANTIER_BAR_HEIGHT = 24;
const ACTION_LANE_HEIGHT = 20;
const LANES_TOP = CHANTIER_BAR_HEIGHT + 6;

export function ChantierGantt({
  chantiers,
  actions,
  stages,
  axisColor,
  onChantierClick,
  onActionClick,
  alertedChantierIds,
  labels,
}: {
  chantiers: Chantier[];
  /** Toutes les actions du programme — filtrées par chantier ici (les bornes d'un chantier ne
   *  sont pas stockées, elles se dérivent de ses actions). */
  actions: ChantierAction[];
  /** Référentiel d'étapes du programme, pour afficher le libellé d'étape sous le nom du chantier
   *  et calculer l'avancement (`chantierProgress`). */
  stages: MaturityStageConfig[];
  /** Couleur de l'axe (`StrategicAxis.color`) — teinte de tous les blocs de ce Gantt. */
  axisColor?: string;
  onChantierClick?: (chantier: Chantier) => void;
  /** Clic sur une action : l'appelant ouvre la MÊME pop-up que pour son chantier, focalisée sur
   *  l'action cliquée. */
  onActionClick?: (action: ChantierAction, chantier: Chantier) => void;
  /** Chantiers concernés par une alerte de cascade de dépendance — teintés en ambre et marqués
   *  d'un triangle dans le Gantt pour que l'alerte affichée au-dessus soit localisable. */
  alertedChantierIds?: Set<string>;
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
  };

  // Trimestre par défaut : meilleur compromis lisibilité/détail sur un plan de 2-3 ans.
  const [scale, setScale] = useState<Scale>("quarter");

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

  // Échelle temporelle commune à toutes les lignes — calculée sur les bornes des chantiers, pas
  // sur celles des actions (une action ne peut pas sortir des bornes de son propre chantier), puis
  // ARRONDIE aux limites de colonne de la maille active : les blocs s'alignent ainsi sur la grille
  // au lieu de flotter au milieu d'une colonne.
  const { minTime, maxTime } = useMemo(() => {
    const times = planned.flatMap((r) => [parseISO(r.bounds.start), parseISO(r.bounds.end)]);
    if (times.length === 0) return { minTime: 0, maxTime: 1 };
    const step = SCALE_MONTHS[scale];
    const rawMin = new Date(Math.min(...times));
    const rawMax = new Date(Math.max(...times));
    const start = new Date(rawMin.getFullYear(), Math.floor(rawMin.getMonth() / step) * step, 1);
    const end = new Date(
      rawMax.getFullYear(),
      Math.floor(rawMax.getMonth() / step) * step + step,
      1
    );
    return { minTime: start.getTime(), maxTime: end.getTime() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, scale]);

  const range = Math.max(1, maxTime - minTime);
  const pctOf = (iso: string) => ((parseISO(iso) - minTime) / range) * 100;

  /** Colonnes de la grille temporelle, à la maille active. */
  const columns = useMemo(() => {
    if (planned.length === 0)
      return [] as { key: string; label: string; year: number; left: number; width: number }[];
    const step = SCALE_MONTHS[scale];
    const out: { key: string; label: string; year: number; left: number; width: number }[] = [];
    const cur = new Date(minTime);
    while (cur.getTime() < maxTime) {
      const next = new Date(cur.getFullYear(), cur.getMonth() + step, 1);
      out.push({
        key: `${cur.getFullYear()}-${cur.getMonth()}`,
        label: columnLabel(cur, scale),
        year: cur.getFullYear(),
        left: ((cur.getTime() - minTime) / range) * 100,
        width: ((next.getTime() - cur.getTime()) / range) * 100,
      });
      cur.setMonth(cur.getMonth() + step);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minTime, maxTime, range, scale, planned.length]);

  /** Bandeau des années, au-dessus des colonnes — sans lui, une suite de « T1 T2 T3 T4 T1 … » sur
   *  trois ans ne dit plus de quelle année on parle. */
  const yearBands = useMemo(() => {
    const bands: { year: number; left: number; width: number }[] = [];
    for (const col of columns) {
      const last = bands[bands.length - 1];
      if (last && last.year === col.year) last.width += col.width;
      else bands.push({ year: col.year, left: col.left, width: col.width });
    }
    return bands;
  }, [columns]);

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-tertiary">{l.empty}</p>;
  }

  const openChantier = (chantier: Chantier) => onChantierClick?.(chantier);

  const scaleOptions: { value: Scale; label: string }[] = [
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
            <div className="flex overflow-hidden rounded-md border border-border">
              {scaleOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={scale === option.value}
                  onClick={() => setScale(option.value)}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition ${
                    scale === option.value
                      ? "bg-black text-white"
                      : "bg-white text-secondary hover:text-primary"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              {/* ── En-tête : années puis colonnes de la maille ──────────────────────────── */}
              <div className="flex items-end gap-2 pb-1">
                <div className={`${ROW_LABEL_WIDTH} shrink-0`} />
                <div className="relative h-8 flex-1">
                  {yearBands.map((band) => (
                    <span
                      key={band.year}
                      className="absolute top-0 truncate border-l border-border pl-1 text-[10px] font-bold text-secondary"
                      style={{ left: `${band.left}%`, width: `${band.width}%` }}
                    >
                      {band.year}
                    </span>
                  ))}
                  {columns.map((col) => (
                    <span
                      key={col.key}
                      className="absolute bottom-0 truncate text-center text-[9.5px] uppercase text-tertiary"
                      style={{ left: `${col.left}%`, width: `${col.width}%` }}
                    >
                      {col.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* ── Une ligne par chantier ───────────────────────────────────────────────── */}
              {planned.map(({ chantier, bounds, items }) => {
                const startPct = pctOf(bounds.start);
                const widthPct = Math.max(1.5, pctOf(bounds.end) - startPct);
                const isAlerted = alertedChantierIds?.has(chantier.id) ?? false;
                const progress = chantierProgress(chantier.id, actions, stages);
                const lanes = packLanes(items);
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
                      {columns.map((col, i) => (
                        <div
                          key={col.key}
                          className={`absolute inset-y-0 border-l ${
                            i === 0 ? "border-border" : "border-border/60"
                          }`}
                          style={{ left: `${col.left}%` }}
                        />
                      ))}

                      {/* Bloc macro du chantier (maille exécutive) — REMPLI, avec la part
                          d'avancement en teinte soutenue. */}
                      <Tooltip
                        text={`${chantier.name} · ${formatDay(bounds.start)} → ${formatDay(
                          bounds.end
                        )} · ${l.progress} ${progress.pct}%${isAlerted ? ` · ${l.alerted}` : ""}`}
                        className="absolute"
                        style={{ left: `${startPct}%`, width: `${widthPct}%`, top: 0 }}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          aria-label={chantier.name}
                          onClick={() => openChantier(chantier)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openChantier(chantier);
                            }
                          }}
                          className={`relative w-full cursor-pointer overflow-hidden rounded border transition hover:ring-2 hover:ring-bp-coral/40 ${
                            isAlerted ? "ring-1 ring-rag-amber" : ""
                          }`}
                          style={{
                            height: CHANTIER_BAR_HEIGHT,
                            backgroundColor: withAlpha(blockColor, 0.16),
                            borderColor: withAlpha(blockColor, 0.65),
                          }}
                        >
                          <div
                            aria-hidden
                            className="absolute inset-y-0 left-0"
                            style={{
                              width: `${progress.pct}%`,
                              backgroundColor: withAlpha(blockColor, 0.42),
                            }}
                          />
                          <div className="relative flex h-full items-center gap-1 px-1.5">
                            <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-primary">
                              {chantier.name}
                            </span>
                            {isAlerted && (
                              <TriangleAlert size={10} className="shrink-0 text-rag-amber" />
                            )}
                            <span className="shrink-0 text-[10px] font-bold text-primary">
                              {progress.pct}%
                            </span>
                          </div>
                        </div>
                      </Tooltip>

                      {/* Actions individuelles (maille fine), NOMMÉES — même pop-up au clic. */}
                      {lanes.map((lane, laneIndex) =>
                        lane.map((action) => {
                          const aStart = pctOf(action.start);
                          const aWidth = Math.max(0.8, pctOf(action.end) - aStart);
                          // Sous ~14 % de la piste, un nom écrit dans la barre serait réduit à
                          // « D… » : on le rabat alors juste à droite de la barre.
                          const inlineLabel = aWidth >= 14;
                          const top = LANES_TOP + laneIndex * ACTION_LANE_HEIGHT;
                          return (
                            <Tooltip
                              key={action.id}
                              text={`${action.name} · ${formatDay(action.start)} → ${formatDay(
                                action.end
                              )} · ${resolveMaturityStageLabel(action.status, stages)}${
                                action.owner ? ` · ${action.owner}` : ""
                              }`}
                              className="absolute"
                              style={{ left: `${aStart}%`, width: `${aWidth}%`, top }}
                            >
                              <div
                                role="button"
                                tabIndex={0}
                                aria-label={action.name}
                                onClick={() => onActionClick?.(action, chantier)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    onActionClick?.(action, chantier);
                                  }
                                }}
                                className="flex h-[15px] w-full cursor-pointer items-center rounded-sm px-1 transition hover:brightness-110"
                                style={{
                                  backgroundColor: withAlpha(blockColor, 0.9),
                                  color: readableTextColor(blockColor),
                                }}
                              >
                                {inlineLabel && (
                                  <span className="truncate text-[9.5px] font-medium leading-none">
                                    {action.name}
                                  </span>
                                )}
                              </div>
                              {!inlineLabel && (
                                <span
                                  aria-hidden
                                  className="pointer-events-none absolute left-full top-0 ml-1 whitespace-nowrap text-[9.5px] leading-[15px] text-secondary"
                                >
                                  {action.name}
                                </span>
                              )}
                            </Tooltip>
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
