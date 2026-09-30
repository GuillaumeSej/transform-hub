"use client";

import type { ReactNode } from "react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { formatPct } from "@/lib/format";

/**
 * Carte d'aperçu au survol commune à TOUS les graphiques du Dashboard RH (retour PO « aperçu au
 * survol ») — même langage visuel que `SCurvePreview` (components/shared/charts/SCurveChart.tsx) :
 * carte 260 px, en-tête, valeurs clés avec repère coloré, écart en corail si défavorable / encre
 * sinon, part du total en mini-barre, principaux contributeurs, pied « Cliquer pour le détail → ».
 *
 * Purement présentationnel : les valeurs arrivent déjà formatées (l'unité — ETP, €M, mouvements —
 * dépend du graphique). À rendre dans un `FloatingPreview` (components/shared/charts/HoverPreview.tsx)
 * pour être toujours entièrement visible (portail, jamais rogné par la carte du widget).
 */

export type HrPreviewMarker = {
  color: string;
  /** `square` (barre, défaut), `line` (courbe pleine), `dashed` (courbe pointillée). */
  shape?: "square" | "line" | "dashed";
};

export type HrPreviewRow = {
  label: string;
  value: string;
  marker?: HrPreviewMarker;
  /** Ligne mise en avant (total, valeur principale). */
  strong?: boolean;
  /** Ligne secondaire (cumul, complément). */
  muted?: boolean;
};

export type HrPreviewGap = {
  label: string;
  value: string;
  /** Écart défavorable → corail ; sinon encre (voir `isUnfavourableGap`, lib/hrChartPreview.ts). */
  unfavourable: boolean;
};

export type HrPreviewList = {
  title: string;
  items: { key: string; label: string; value: string; unfavourable?: boolean }[];
};

function Marker({ marker }: { marker: HrPreviewMarker }) {
  if (marker.shape === "line" || marker.shape === "dashed") {
    return (
      <span
        aria-hidden
        className="inline-block h-0 w-3 shrink-0 border-t-2"
        style={{
          borderColor: marker.color,
          borderTopStyle: marker.shape === "dashed" ? "dashed" : "solid",
        }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
      style={{ backgroundColor: marker.color }}
    />
  );
}

export function HrChartPreview({
  title,
  badge,
  rows,
  gap,
  extraGaps,
  share,
  list,
  children,
  clickHint,
}: {
  title: string;
  /** Petit libellé à droite du titre (ex. « Prévision », statut). */
  badge?: string;
  rows: HrPreviewRow[];
  gap?: HrPreviewGap;
  /** Écarts complémentaires sous l'écart principal (ex. écart cumulé). */
  extraGaps?: HrPreviewGap[];
  /** Part de l'élément survolé dans le total du graphique, en POINTS (`shareOfTotal`). `null` =
   *  non calculable (total nul) → masquée. */
  share?: { label?: string; pct: number | null };
  list?: HrPreviewList;
  /** Bloc libre (ex. `MovementNetBalanceSummary`) rendu sous l'écart. */
  children?: ReactNode;
  /** `true` = « Cliquer pour le détail → » ; une chaîne = texte spécifique (ex. épingler). */
  clickHint?: boolean | string;
}) {
  const { t } = useTranslation();
  const listItems = list?.items ?? [];
  const pct = share?.pct ?? null;
  return (
    <div className="w-[260px] border border-border bg-white p-3 text-[11.5px] shadow-lg">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="min-w-0 break-words text-[12.5px] font-bold text-primary">{title}</span>
        {badge && <span className="shrink-0 text-[10.5px] text-tertiary">{badge}</span>}
      </div>
      {rows.length > 0 && (
        <div className="space-y-1">
          {rows.map((row, i) => (
            <div key={`${row.label}-${i}`} className="flex items-center justify-between gap-4">
              <span
                className={`flex min-w-0 items-center gap-1.5 ${row.muted ? "text-tertiary" : "text-secondary"}`}
              >
                {row.marker && <Marker marker={row.marker} />}
                <span className="truncate">{row.label}</span>
              </span>
              <span
                className={`max-w-[62%] break-words text-right tabular-nums ${
                  row.muted
                    ? "text-tertiary"
                    : row.strong
                      ? "font-bold text-primary"
                      : "font-semibold text-primary"
                }`}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}
      {pct !== null && (
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-secondary">
            <span>{share?.label ?? t("chart.hrPreview.share", "Part du total")}</span>
            <span className="font-semibold tabular-nums text-primary">{formatPct(pct)}</span>
          </div>
          <div className="h-1.5 bg-neutral-100">
            <div
              className="h-full bg-bp-warm-brown/60"
              style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
            />
          </div>
        </div>
      )}
      {(gap || (extraGaps && extraGaps.length > 0)) && (
        <div className="mt-2.5 space-y-0.5 border-t border-border pt-2">
          {[...(gap ? [gap] : []), ...(extraGaps ?? [])].map((g, i) => (
            <div key={`${g.label}-${i}`} className="flex items-center justify-between gap-3">
              <span className={i === 0 && gap ? "font-semibold text-primary" : "text-secondary"}>
                {g.label}
              </span>
              <span
                className={`tabular-nums ${i === 0 && gap ? "font-bold" : ""} ${
                  g.unfavourable ? "text-bp-coral" : "text-primary"
                }`}
              >
                {g.value}
              </span>
            </div>
          ))}
        </div>
      )}
      {children && <div className="mt-2 border-t border-border pt-2">{children}</div>}
      {list && listItems.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
            {list.title}
          </div>
          <div className="space-y-0.5">
            {listItems.map((item) => (
              <div key={item.key} className="flex justify-between gap-3">
                <span className="truncate text-secondary">{item.label}</span>
                <span
                  className={
                    item.unfavourable
                      ? "shrink-0 tabular-nums text-bp-coral"
                      : "shrink-0 tabular-nums text-primary"
                  }
                >
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {clickHint && (
        <div className="mt-2 text-[10.5px] font-medium text-tertiary">
          {typeof clickHint === "string"
            ? clickHint
            : t("chart.scurvePreview.click", "Cliquer pour le détail →")}
        </div>
      )}
    </div>
  );
}
