"use client";

import * as engine from "@/lib/engine";
import type { MarimekkoSegment } from "@/lib/engine";

const COLORS = ["#806659", "#FF3C47", "#FFB1B5", "#421799", "#320300", "#421799", "#CCC1BD"];

/** Marimekko par fonction : largeur = poids financier de la fonction dans le programme. Clic sur
 * un segment pour creuser vers les leviers de cette fonction. */
export function MarimekkoChart({
  data,
  height = 220,
  onSegmentClick,
}: {
  data: MarimekkoSegment[];
  height?: number;
  onSegmentClick?: (func: string) => void;
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">Aucun levier à représenter.</p>;
  }
  return (
    <div
      className="flex w-full items-stretch gap-0.5 overflow-hidden rounded-md"
      style={{ height }}
    >
      {data.map((seg, i) => (
        <button
          key={seg.function}
          onClick={() => onSegmentClick?.(seg.function)}
          title={`${seg.function} — ${engine.fmtCurr(seg.totalSavings)} (${seg.levers.length} leviers)`}
          style={{ width: `${seg.widthPct}%`, backgroundColor: COLORS[i % COLORS.length] }}
          className="group flex flex-col justify-end p-2 text-left text-white transition hover:opacity-90"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
            {seg.function}
          </span>
          <span className="text-[13px] font-bold">{engine.fmtCurr(seg.totalSavings)}</span>
          <span className="text-[10px] opacity-70">{seg.levers.length} leviers</span>
        </button>
      ))}
    </div>
  );
}
