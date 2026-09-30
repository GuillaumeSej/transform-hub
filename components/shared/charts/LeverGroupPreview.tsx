"use client";

import type { ReactNode } from "react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { formatMillions, formatNumber } from "@/lib/format";
import type { LeverGroupSummary, PreviewLever } from "@/lib/chartHoverPreview";

/**
 * Briques de l'aperçu au survol des graphiques « par groupe de leviers » (Marimekko, donut,
 * entonnoir, matrice Santé) — même carte que `SCurvePreview` (Trajectoire des économies) : en-tête
 * = élément survolé, valeurs clés avec marqueur de couleur, mini-barres, écart en corail si négatif
 * / encre si positif, principaux leviers, pied « Cliquer pour… » si le graphique est cliquable.
 * À rendre dans un `FloatingPreview` (voir `HoverPreview.tsx`).
 */

export const fmtM = (v: number) => formatMillions(v);
export const signedM = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtM(Math.abs(v))}`;
export const fmtShare = (pct: number | null) =>
  pct === null ? "—" : `${formatNumber(pct, { maximumFractionDigits: 1 })} %`;

export function PreviewCard({
  title,
  subtitle,
  clickHint,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  clickHint?: string;
  children: ReactNode;
}) {
  return (
    <div className="w-[260px] border border-border bg-white p-3 text-[11.5px] shadow-lg">
      <div className="mb-2">
        <div className="text-[12.5px] font-bold leading-snug text-primary">{title}</div>
        {subtitle && <div className="mt-0.5 text-[10.5px] text-tertiary">{subtitle}</div>}
      </div>
      {children}
      {clickHint && <div className="mt-2 text-[10.5px] font-medium text-tertiary">{clickHint}</div>}
    </div>
  );
}

/** Ligne libellé / valeur, avec marqueur carré de couleur optionnel. */
export function PreviewRow({
  label,
  value,
  color,
  strong,
}: {
  label: ReactNode;
  value: ReactNode;
  color?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex min-w-0 items-center gap-1.5 text-secondary">
        {color && (
          <span className="inline-block h-2 w-2 shrink-0" style={{ backgroundColor: color }} />
        )}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={`shrink-0 tabular-nums text-primary ${strong ? "font-bold" : "font-semibold"}`}
      >
        {value}
      </span>
    </div>
  );
}

export function PreviewSection({ children }: { children: ReactNode }) {
  return <div className="mt-2.5 border-t border-border pt-2">{children}</div>;
}

/** Mini-barre horizontale (0-100 %). */
export function PreviewBar({
  pct,
  className = "bg-bp-coral",
}: {
  pct: number;
  className?: string;
}) {
  return (
    <div className="h-1.5 bg-neutral-100">
      <div
        className={`h-full ${className}`}
        style={{ width: `${Math.max(2, Math.min(100, Math.abs(pct)))}%` }}
      />
    </div>
  );
}

/** Réalisé / réactualisé (+ plan initial optionnel), mini-comparaison et écart réalisé − référence. */
export function PreviewRealizedBlock({
  summary,
  showPlanned,
  compareTo = "reforecast",
}: {
  summary: Pick<LeverGroupSummary, "realized" | "reforecast" | "planned">;
  showPlanned?: boolean;
  /** Référence de l'écart affiché : réactualisé (défaut) ou planifié initial. */
  compareTo?: "reforecast" | "planned";
}) {
  const { t } = useTranslation();
  const { realized, reforecast, planned } = summary;
  const ref = compareTo === "planned" ? planned : reforecast;
  const max = Math.max(Math.abs(realized), Math.abs(ref), 1e-9);
  const gap = Math.round((realized - ref) * 10) / 10;
  return (
    <>
      <div className="space-y-1">
        {showPlanned && (
          <PreviewRow
            color="#806659"
            label={t("chart.scurve.planned", "Plan initial")}
            value={fmtM(planned)}
          />
        )}
        <PreviewRow
          color="#320300"
          label={t("chart.scurve.reforecast", "Réactualisé")}
          value={fmtM(reforecast)}
        />
        <PreviewRow
          color="#FF3C47"
          label={t("chart.scurve.actual", "Réalisé")}
          value={fmtM(realized)}
        />
      </div>
      <div className="mt-2 space-y-1">
        <PreviewBar
          pct={(Math.abs(ref) / max) * 100}
          className={compareTo === "planned" ? "bg-bp-warm-brown/60" : "bg-bp-deep-red/70"}
        />
        <PreviewBar pct={(Math.abs(realized) / max) * 100} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className="font-semibold text-primary">
          {compareTo === "planned"
            ? t("chart.scurvePreview.gap", "Écart réalisé − plan")
            : t("chart.groupPreview.gapReforecast", "Écart réalisé − réactualisé")}
        </span>
        <span
          className={
            gap < 0 ? "font-bold tabular-nums text-bp-coral" : "font-bold tabular-nums text-primary"
          }
        >
          {gap === 0 ? fmtM(0) : signedM(gap)}
        </span>
      </div>
    </>
  );
}

/** « Principaux leviers » (3 premiers), valeurs formatées par `format`. */
export function PreviewTopLevers({
  levers,
  format = fmtM,
  title,
}: {
  levers: PreviewLever[];
  format?: (v: number) => string;
  title?: string;
}) {
  const { t } = useTranslation();
  if (levers.length === 0) return null;
  return (
    <PreviewSection>
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
        {title ?? t("chart.groupPreview.topLevers", "Principaux leviers")}
      </div>
      <div className="space-y-0.5">
        {levers.map((l) => (
          <div key={l.id} className="flex justify-between gap-3">
            <span className="truncate text-secondary">
              <span className="font-semibold text-primary">{l.code}</span> · {l.name}
            </span>
            <span
              className={l.value < 0 ? "tabular-nums text-bp-coral" : "tabular-nums text-primary"}
            >
              {format(l.value)}
            </span>
          </div>
        ))}
      </div>
    </PreviewSection>
  );
}
