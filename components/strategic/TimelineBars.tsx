"use client";

import type { ReactNode } from "react";
import { Tooltip } from "@/components/shared/Tooltip";
import { parseISO } from "@/lib/dateUtils";

/**
 * Primitives PARTAGÉES de rendu de timeline à colonnes (round 4, point 9 — extraction depuis
 * `ChantierGantt.tsx`) : calculs de couleur/transparence, empilement en couloirs (`packTimelineLanes`),
 * grille de colonnes temporelle (mois/trimestre/semestre), et le rendu d'UNE barre colorée
 * positionnée en pourcentage. Consommé par `ChantierGantt` (barres = chantiers/actions d'un axe) ET
 * par la timeline de livrables de la fiche chantier dédiée (barres = `Deliverable.phases`).
 *
 * Volontairement PAS de composant "ligne" complet ici : la mise en page d'une ligne (colonne
 * d'identité à gauche + piste de barres à droite, avancement, icônes spécifiques) reste propre à
 * chaque consommateur — seuls le calcul de grille et le rendu d'une barre individuelle sont
 * communs (voir plan round 4, point 9 : "l'extraction de primitives, pas la duplication").
 */

// ─── Échelle temporelle ─────────────────────────────────────────────────────────────────────────

export type TimelineScale = "month" | "quarter" | "semester";

export const TIMELINE_SCALE_MONTHS: Record<TimelineScale, number> = {
  month: 1,
  quarter: 3,
  semester: 6,
};

/** Libellé d'une colonne de l'axe temporel, selon la maille choisie. Formatage `fr-FR` comme
 *  partout ailleurs dans l'app (cf. `formatTimestamp`, app/(app)/admin/history/page.tsx). */
export function timelineColumnLabel(date: Date, scale: TimelineScale): string {
  if (scale === "month") return date.toLocaleDateString("fr-FR", { month: "short" });
  if (scale === "quarter") return `T${Math.floor(date.getMonth() / 3) + 1}`;
  return `S${Math.floor(date.getMonth() / 6) + 1}`;
}

/** Date ISO ("2026-09-03") → « 3 sept. 2026 », utilisé dans les infobulles des barres. */
export function formatTimelineDay(iso: string): string {
  const time = parseISO(iso);
  if (Number.isNaN(time)) return iso;
  return new Date(time).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ─── Couleur ────────────────────────────────────────────────────────────────────────────────────

/** `#rgb` / `#rrggbb` → `[r, g, b]` ; `null` pour toute autre notation (l'appelant retombe alors
 *  sur la couleur brute, sans transparence calculée). */
export function hexToRgb(color: string): [number, number, number] | null {
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

export function withAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
}

/** Noir ou blanc selon la luminance du fond — les couleurs d'axe vont du bordeaux très sombre
 *  (#320300) au taupe clair (#B8A99A) : un texte blanc câblé en dur serait illisible sur la
 *  moitié de la palette. */
export function readableTextColor(color: string): string {
  const rgb = hexToRgb(color);
  if (!rgb) return "#ffffff";
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance > 0.6 ? "#1f1512" : "#ffffff";
}

// ─── Couloirs (évite le chevauchement de deux items sur une même ligne) ──────────────────────────

/**
 * Répartit des items (déjà triés par date de début) en « couloirs » : deux items qui se
 * chevauchent dans le temps ne peuvent pas partager la même ligne sans se recouvrir. Générique sur
 * tout item porteur de `start`/`end` ISO — utilisé pour les actions d'un chantier (`ChantierGantt`)
 * comme pour les phases d'un livrable (timeline de la fiche chantier).
 */
export function packTimelineLanes<T extends { start: string; end: string }>(items: T[]): T[][] {
  const lanes: T[][] = [];
  for (const item of items) {
    const lane = lanes.find((l) => parseISO(l[l.length - 1].end) <= parseISO(item.start));
    if (lane) lane.push(item);
    else lanes.push([item]);
  }
  return lanes;
}

// ─── Grille de colonnes ─────────────────────────────────────────────────────────────────────────

export type TimelineColumn = {
  key: string;
  label: string;
  year: number;
  left: number;
  width: number;
};

export type TimelineYearBand = { year: number; left: number; width: number };

/**
 * Bornes temporelles [minTime, maxTime] (ms epoch) ARRONDIES aux limites de colonne de la maille
 * active, à partir d'une liste de bornes `{start, end}` (ISO). Les blocs s'alignent ainsi sur la
 * grille au lieu de flotter au milieu d'une colonne. `{minTime: 0, maxTime: 1}` si `boundsList` est
 * vide (repli neutre, l'appelant doit tester la longueur en amont pour l'affichage vide).
 */
export function timelineRange(
  boundsList: { start: string; end: string }[],
  scale: TimelineScale
): { minTime: number; maxTime: number } {
  const times = boundsList.flatMap((b) => [parseISO(b.start), parseISO(b.end)]);
  if (times.length === 0) return { minTime: 0, maxTime: 1 };
  const step = TIMELINE_SCALE_MONTHS[scale];
  const rawMin = new Date(Math.min(...times));
  const rawMax = new Date(Math.max(...times));
  const start = new Date(rawMin.getFullYear(), Math.floor(rawMin.getMonth() / step) * step, 1);
  const end = new Date(rawMax.getFullYear(), Math.floor(rawMax.getMonth() / step) * step + step, 1);
  return { minTime: start.getTime(), maxTime: end.getTime() };
}

/** Colonnes de la grille temporelle, à la maille active, entre `minTime` et `maxTime` (déjà
 *  arrondis par `timelineRange`). */
export function timelineColumns(
  minTime: number,
  maxTime: number,
  scale: TimelineScale
): TimelineColumn[] {
  if (minTime >= maxTime) return [];
  const step = TIMELINE_SCALE_MONTHS[scale];
  const range = Math.max(1, maxTime - minTime);
  const out: TimelineColumn[] = [];
  const cur = new Date(minTime);
  while (cur.getTime() < maxTime) {
    const next = new Date(cur.getFullYear(), cur.getMonth() + step, 1);
    out.push({
      key: `${cur.getFullYear()}-${cur.getMonth()}`,
      label: timelineColumnLabel(cur, scale),
      year: cur.getFullYear(),
      left: ((cur.getTime() - minTime) / range) * 100,
      width: ((next.getTime() - cur.getTime()) / range) * 100,
    });
    cur.setMonth(cur.getMonth() + step);
  }
  return out;
}

/** Bandeau des années, au-dessus des colonnes — sans lui, une suite de « T1 T2 T3 T4 T1 … » sur
 *  trois ans ne dit plus de quelle année on parle. */
export function timelineYearBands(columns: TimelineColumn[]): TimelineYearBand[] {
  const bands: TimelineYearBand[] = [];
  for (const col of columns) {
    const last = bands[bands.length - 1];
    if (last && last.year === col.year) last.width += col.width;
    else bands.push({ year: col.year, left: col.left, width: col.width });
  }
  return bands;
}

/** `pctOf(iso)` : position en % d'une date ISO dans `[minTime, maxTime]`, bornes déjà calculées par
 *  `timelineRange`. Factory plutôt que fonction à 3 arguments : la plupart des appelants en ont
 *  besoin pour CHAQUE barre d'une ligne, autant fermer `minTime`/`range` une seule fois. */
export function timelinePctOf(minTime: number, maxTime: number): (iso: string) => number {
  const range = Math.max(1, maxTime - minTime);
  return (iso: string) => ((parseISO(iso) - minTime) / range) * 100;
}

// ─── Composants de rendu ────────────────────────────────────────────────────────────────────────

/** Bascule d'échelle temporelle — même look que le contrôle segmenté de `EffortScoringGrid.tsx`
 *  (groupe de boutons contigus dans une bordure arrondie, sélection en fond noir). Générique sur les
 *  libellés fournis par l'appelant (traduits différemment selon le contexte). */
export function TimelineScaleToggle({
  value,
  onChange,
  options,
}: {
  value: TimelineScale;
  onChange: (next: TimelineScale) => void;
  options: { value: TimelineScale; label: string }[];
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-border">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`px-2.5 py-1 text-[11px] font-semibold transition ${
            value === option.value
              ? "bg-black text-white"
              : "bg-white text-secondary hover:text-primary"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** En-tête de grille : bandeau des années puis libellés de colonnes, avec un espaceur à gauche de
 *  la largeur EXACTE de la colonne d'identité des lignes (`labelWidthClassName`), pour que les
 *  colonnes s'alignent verticalement avec la grille des lignes en dessous. */
export function TimelineHeaderRow({
  columns,
  yearBands,
  labelWidthClassName,
}: {
  columns: TimelineColumn[];
  yearBands: TimelineYearBand[];
  labelWidthClassName: string;
}) {
  return (
    <div className="flex items-end gap-2 pb-1">
      <div className={`${labelWidthClassName} shrink-0`} />
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
  );
}

/** Grille de fond (traits verticaux de colonne) — à placer en premier enfant d'un conteneur
 *  `relative` dont l'appelant fixe la hauteur (la grille remplit `inset-y-0`). */
export function TimelineGridColumns({ columns }: { columns: TimelineColumn[] }) {
  return (
    <>
      {columns.map((col, i) => (
        <div
          key={col.key}
          className={`absolute inset-y-0 border-l ${i === 0 ? "border-border" : "border-border/60"}`}
          style={{ left: `${col.left}%` }}
        />
      ))}
    </>
  );
}

/**
 * UNE barre colorée, positionnée en pourcentage sur la piste temporelle. Deux variantes :
 *  - `"outline"` (bloc macro type chantier) : remplissage translucide + bordure, avec une surcouche
 *    d'avancement optionnelle (`progressPct`) — le contenu (icône/label/fin de ligne) est TOUJOURS
 *    affiché (seuil d'affichage en ligne à 0 par défaut).
 *  - `"solid"` (item fin type action/phase) : remplissage opaque, texte lisible calculé
 *    automatiquement (`readableTextColor`). Le contenu n'est affiché QUE si la barre est assez
 *    large (`inlineMinWidthPct`), sinon le libellé est rabattu juste à droite de la barre.
 *
 * Aucune décoration spécifique (icône cadenas, triangle d'alerte…) n'est câblée ici : l'appelant les
 * fournit via `icon`/`trailing`, déjà stylées pour son contexte — cette primitive ne connaît que le
 * positionnement, la couleur et le seuil d'affichage.
 */
export function TimelineBar({
  left,
  width,
  top,
  height,
  color,
  variant = "outline",
  progressPct,
  ringed = false,
  roundedClassName = "rounded",
  onClick,
  ariaLabel,
  tooltipText,
  label,
  labelClassName,
  icon,
  trailing,
  inlineMinWidthPct = 0,
  besideLabelClassName = "text-[9.5px] leading-[15px] text-secondary",
}: {
  left: number;
  width: number;
  top: number;
  height: number;
  color: string;
  variant?: "outline" | "solid";
  /** 0-100, uniquement pertinent pour `variant="outline"` — surcouche d'avancement à gauche. */
  progressPct?: number;
  /** Anneau ambre (cascade de dépendance en alerte, etc.). */
  ringed?: boolean;
  roundedClassName?: string;
  onClick?: () => void;
  ariaLabel: string;
  tooltipText: string;
  label: string;
  labelClassName?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  inlineMinWidthPct?: number;
  besideLabelClassName?: string;
}) {
  const inline = width >= inlineMinWidthPct;
  return (
    <Tooltip
      text={tooltipText}
      className="absolute"
      style={{ left: `${left}%`, width: `${width}%`, top }}
    >
      <div
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-label={ariaLabel}
        onClick={onClick}
        onKeyDown={
          onClick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick();
                }
              }
            : undefined
        }
        className={`relative w-full overflow-hidden ${roundedClassName} ${variant === "outline" ? "border" : ""} ${
          onClick
            ? "cursor-pointer transition hover:brightness-110 hover:ring-2 hover:ring-bp-coral/40"
            : ""
        } ${ringed ? "ring-1 ring-rag-amber" : ""}`}
        style={{
          height,
          backgroundColor: variant === "solid" ? withAlpha(color, 0.9) : withAlpha(color, 0.16),
          borderColor: variant === "outline" ? withAlpha(color, 0.65) : undefined,
          color: variant === "solid" ? readableTextColor(color) : undefined,
        }}
      >
        {variant === "outline" && progressPct !== undefined && (
          <div
            aria-hidden
            className="absolute inset-y-0 left-0"
            style={{ width: `${progressPct}%`, backgroundColor: withAlpha(color, 0.42) }}
          />
        )}
        {inline && (
          <div className="relative flex h-full items-center gap-1 px-1.5">
            {icon}
            <span className={labelClassName ?? "min-w-0 flex-1 truncate text-[10px] font-semibold"}>
              {label}
            </span>
            {trailing}
          </div>
        )}
      </div>
      {!inline && (
        <span
          aria-hidden
          className={`pointer-events-none absolute left-full top-0 ml-1 whitespace-nowrap ${besideLabelClassName}`}
        >
          {label}
        </span>
      )}
    </Tooltip>
  );
}
