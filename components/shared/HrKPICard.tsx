"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { Tooltip } from "@/components/shared/Tooltip";

/** KPI RH — miroir de `KPICard` du dashboard exécutif, adapté aux valeurs numériques du module
 *  RH (ETP entiers, montants en €M/€K). Affiche `value` en gros chiffre, avec `sub` (cible +
 *  reforecast + %) et une barre de progression. */
export function HrKPICard({
  label,
  value,
  sub,
  barPct,
  barMarkerPct,
  accent = "default",
  className,
  infoTooltip,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Progression Réalisé / Cible (0-100). */
  barPct?: number;
  /** Marqueur sur la barre — position du reforecast en % de la cible. */
  barMarkerPct?: number;
  accent?: "default" | "green" | "amber" | "red" | "brown";
  className?: string;
  /** Texte optionnel affiché dans un tooltip au survol d'une icône ⓘ à côté du label — même
   *  pattern que `KPICard.infoTooltip` (voir son doc-comment). */
  infoTooltip?: string;
}) {
  const { t } = useTranslation();
  const accentClass: Record<string, string> = {
    default: "border-black",
    green: "border-rag-green-dark",
    amber: "border-bp-warm-brown",
    red: "border-bp-coral",
    brown: "border-bp-warm-taupe",
  };

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden border-l-[3px] bg-white p-4",
        accentClass[accent],
        className
      )}
    >
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-tertiary">
        {label}
        {infoTooltip && (
          // position="bottom" : la carte a `overflow-hidden`, une tooltip "top" s'ouvrant au-dessus
          // de l'icône (tout en haut de la carte) est rognée/invisible — voir KPICard.tsx.
          <Tooltip text={infoTooltip} position="bottom">
            <Info size={11} className="shrink-0 text-tertiary" />
          </Tooltip>
        )}
      </div>
      <div className="mt-1 text-[26px] font-bold leading-none tracking-tight text-primary">
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-secondary">{sub}</div>}
      {barPct !== undefined && (
        <div className="relative mt-3 h-1.5 overflow-visible rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-bp-coral"
            style={{ width: `${Math.min(100, Math.max(0, barPct))}%` }}
          />
          {barMarkerPct !== undefined && (
            <div
              className="absolute -top-0.5 h-2.5 w-[2px] bg-neutral-700"
              style={{ left: `${Math.min(100, Math.max(0, barMarkerPct))}%` }}
              title={t("dashboard.kpi.reforecast", "Reforecast")}
            />
          )}
        </div>
      )}
    </div>
  );
}
