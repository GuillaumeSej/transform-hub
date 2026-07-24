"use client";

import * as engine from "@/lib/engine";
import type { Marimekko2DColumn } from "@/lib/engine";

const COLORS = [
  "#806659",
  "#FF3C47",
  "#FFB1B5",
  "#421799",
  "#320300",
  "#7C6EF0",
  "#CCC1BD",
  "#E68900",
  "#2E7D32",
];

/** Vrai Marimekko à deux dimensions : la largeur des colonnes = poids de la dimension primaire
 * (ex. fonction), chaque colonne se décompose en segments empilés (dimension secondaire, ex.
 * pays) — porté depuis l'ancienne version 1D (largeur seule, "par fonction" figé). Clic sur un
 * segment pour creuser vers les leviers correspondant aux deux dimensions. */
export function MarimekkoChart({
  data,
  height = 240,
  onSegmentClick,
}: {
  data: Marimekko2DColumn[];
  height?: number;
  onSegmentClick?: (primaryKey: string, secondaryKey: string) => void;
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucun levier à représenter.</p>;
  }
  return (
    <div className="flex w-full items-stretch gap-0.5" style={{ height }}>
      {data.map((col) => (
        <div
          key={col.key}
          style={{ width: `${col.widthPct}%` }}
          className="flex flex-col overflow-hidden rounded-md"
        >
          {col.segments.map((seg, i) => (
            <button
              key={seg.key}
              onClick={() => onSegmentClick?.(col.key, seg.key)}
              title={`${col.label} — ${seg.label} : ${engine.fmtCurr(seg.value)} (${seg.count} levier(s))`}
              style={{ height: `${seg.heightPct}%`, backgroundColor: COLORS[i % COLORS.length] }}
              className="group flex w-full flex-col justify-end p-1.5 text-left text-white transition hover:opacity-90"
            >
              {seg.heightPct >= 12 && (
                <span className="truncate text-[9.5px] font-semibold opacity-85">{seg.label}</span>
              )}
              {seg.heightPct >= 20 && (
                <span className="truncate text-[11px] font-bold">{engine.fmtCurr(seg.value)}</span>
              )}
            </button>
          ))}
          <div className="mt-0.5 bg-neutral-100 px-1.5 py-1 text-center">
            <span className="block truncate text-[10px] font-semibold uppercase tracking-wide text-primary">
              {col.label}
            </span>
            <span className="block text-[10px] text-secondary">
              {engine.fmtCurr(col.totalSavings)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
