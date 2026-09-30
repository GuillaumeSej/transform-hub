"use client";

import * as engine from "@/lib/engine";
import type { Marimekko2DColumn } from "@/lib/engine";
import { useState } from "react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { LeverGroupSummary } from "@/lib/chartHoverPreview";
import { ChartHoverArea, FloatingPreview } from "./HoverPreview";
import {
  PreviewBar,
  PreviewCard,
  PreviewRealizedBlock,
  PreviewRow,
  PreviewSection,
  PreviewTopLevers,
  fmtShare,
} from "./LeverGroupPreview";

const COLORS = [
  "#806659",
  "#FF3C47",
  "#FFB1B5",
  "#421799",
  "#320300",
  "#991D1F",
  "#CCC1BD",
  "#FF797B",
  "#A99E9A",
];

/** Vrai Marimekko à deux dimensions : la largeur des colonnes = poids de la dimension primaire
 * (ex. fonction), chaque colonne se décompose en segments empilés (dimension secondaire, ex.
 * pays). Clic sur un segment pour creuser vers les leviers correspondant aux deux dimensions.
 *
 * Aperçu au survol (retour PO, même carte que la Trajectoire des économies) : segment → couple
 * primaire / secondaire, montant, part de la colonne et du total, réalisé vs réactualisé et
 * principaux leviers ; label de colonne → total de la colonne. Rendu en portail
 * (`FloatingPreview`), donc jamais rogné par la carte ni recouvert par le widget voisin. */
export function MarimekkoChart({
  data,
  height = 240,
  onSegmentClick,
  details,
  formatValue = engine.fmtCurr,
  formatLeverValue,
}: {
  data: Marimekko2DColumn[];
  height?: number;
  onSegmentClick?: (primaryKey: string, secondaryKey: string) => void;
  /** Synthèse des leviers d'un segment (ou d'une colonne si `secondaryKey` absent) pour l'aperçu. */
  details?: (primaryKey: string, secondaryKey?: string) => LeverGroupSummary | null;
  /** Format des valeurs de la métrique affichée (montant par défaut). */
  formatValue?: (v: number) => string;
  /** Format des valeurs des « principaux leviers » (défaut : `formatValue`) — ex. montant quand la
   *  métrique est un nombre de leviers. */
  formatLeverValue?: (v: number) => string;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<{ col: string; seg?: string } | null>(null);
  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("chart.emptyLevers", "Aucun levier à représenter.")}
      </p>
    );
  }
  const leverCount = (n: number) =>
    `${n} ${n > 1 ? t("levers.count", "leviers") : t("shared.marimekkoChart.leverSingular", "levier")}`;
  const renderPreview = () => {
    if (!hovered) return null;
    const col = data.find((c) => c.key === hovered.col);
    if (!col) return null;
    const segIdx =
      hovered.seg === undefined ? -1 : col.segments.findIndex((s) => s.key === hovered.seg);
    const seg = segIdx >= 0 ? col.segments[segIdx] : undefined;
    if (hovered.seg !== undefined && !seg) return null;
    const summary = details?.(col.key, seg?.key) ?? null;
    return (
      <FloatingPreview>
        <PreviewCard
          title={seg ? seg.label : col.label}
          subtitle={
            seg ? `${col.label} · ${leverCount(seg.count)}` : leverCount(summary?.count ?? 0)
          }
          clickHint={
            seg && onSegmentClick
              ? t("chart.groupPreview.clickLevers", "Cliquer pour voir les leviers →")
              : undefined
          }
        >
          <div className="space-y-1">
            <PreviewRow
              color={seg ? COLORS[segIdx % COLORS.length] : undefined}
              label={t("chart.groupPreview.amount", "Montant")}
              value={formatValue(seg ? seg.value : col.totalSavings)}
              strong
            />
            {seg && (
              <PreviewRow
                label={t("chart.groupPreview.shareOfColumn", "Part de la colonne")}
                value={fmtShare(seg.heightPct)}
              />
            )}
            <PreviewRow
              label={t("chart.groupPreview.shareOfTotal", "Part du total")}
              value={fmtShare(seg ? (seg.heightPct * col.widthPct) / 100 : col.widthPct)}
            />
          </div>
          <div className="mt-2">
            <PreviewBar pct={seg ? (seg.heightPct * col.widthPct) / 100 : col.widthPct} />
          </div>
          {summary && (
            <>
              <PreviewSection>
                <PreviewRealizedBlock summary={summary} />
              </PreviewSection>
              <PreviewTopLevers levers={summary.top} format={formatLeverValue ?? formatValue} />
            </>
          )}
        </PreviewCard>
      </FloatingPreview>
    );
  };
  return (
    <ChartHoverArea className="relative w-full">
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
                type="button"
                onClick={() => onSegmentClick?.(col.key, seg.key)}
                onMouseEnter={() => setHovered({ col: col.key, seg: seg.key })}
                onMouseLeave={() => setHovered(null)}
                aria-label={`${col.label} — ${seg.label} : ${formatValue(seg.value)}`}
                style={{ backgroundColor: COLORS[i % COLORS.length], height: `${seg.heightPct}%` }}
                className="group flex w-full flex-col justify-end p-1.5 text-left text-white transition hover:opacity-90"
              >
                {seg.heightPct >= 12 && (
                  <span className="truncate text-[9.5px] font-semibold opacity-85">
                    {seg.label}
                  </span>
                )}
                {seg.heightPct >= 20 && (
                  <span className="truncate text-[11px] font-bold">{formatValue(seg.value)}</span>
                )}
              </button>
            ))}
            <div
              className="mt-0.5 w-full bg-neutral-100 px-1.5 py-1 text-center"
              onMouseEnter={() => setHovered({ col: col.key })}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="block truncate text-[10px] font-semibold uppercase tracking-wide text-primary">
                {col.label}
              </span>
              <span className="block text-[10px] text-secondary">
                {formatValue(col.totalSavings)}
              </span>
            </div>
          </div>
        ))}
      </div>
      {renderPreview()}
    </ChartHoverArea>
  );
}
