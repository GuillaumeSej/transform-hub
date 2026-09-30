"use client";

import type React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { Tooltip } from "@/components/shared/Tooltip";

/** KPI RH — miroir de `KPICard` du dashboard exécutif, adapté aux valeurs numériques du module
 *  RH (ETP entiers, montants en €M/€K).
 *
 *  Layout (charte BP, barres carrées) :
 *  - label (uppercase) + ⓘ optionnel ;
 *  - `value` en gros chiffre, avec à droite un badge `pct` (Réalisé / Cible) ;
 *  - barre de progression `barPct`, avec un marqueur `barMarkerPct` (reforecast) uniquement
 *    quand `reforecastDiffers` — sinon il serait collé à 100 % et ne serait que du bruit ;
 *  - une ligne discrète « Cible X » + « · Réactualisé Y » seulement si le réactualisé diffère.
 *    Quand il est identique, l'info est conservée dans un `title` sur cette ligne. */
export function HrKPICard({
  label,
  value,
  target,
  reforecast,
  reforecastDiffers = false,
  pct,
  barPct,
  barMarkerPct,
  accent = "default",
  className,
  infoTooltip,
  onClick,
}: {
  label: string;
  value: string;
  /** Cible, déjà formatée (ex. « 648 k € »). */
  target: string;
  /** Réactualisé, déjà formaté — affiché seulement si `reforecastDiffers`. */
  reforecast?: string;
  /** Vrai quand le réactualisé diffère de la cible. */
  reforecastDiffers?: boolean;
  /** Progression Réalisé / Cible, entier (affiché dans le badge). */
  pct: number;
  /** Progression Réalisé / Cible (0-100) pour la barre. */
  barPct?: number;
  /** Marqueur sur la barre — position du reforecast en % de la cible. Rendu seulement si
   *  `reforecastDiffers`. */
  barMarkerPct?: number;
  accent?: "default" | "green" | "amber" | "red" | "brown";
  className?: string;
  /** Texte optionnel affiché dans un tooltip au survol d'une icône ⓘ à côté du label — même
   *  pattern que `KPICard.infoTooltip` (voir son doc-comment). */
  infoTooltip?: string;
  /** Carte cliquable : ouvre la fiche détaillée du KPI (`HrKpiDetailModal`). */
  onClick?: () => void;
}) {
  const { t } = useTranslation();
  const accentClass: Record<string, string> = {
    default: "border-black",
    green: "border-rag-green-dark",
    amber: "border-bp-warm-brown",
    red: "border-bp-coral",
    brown: "border-bp-warm-taupe",
  };

  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  const targetText = t("hr.kpi.targetLabel", "Cible {v}").replace("{v}", target);
  const showReforecast = reforecastDiffers && reforecast !== undefined;
  const reforecastText = showReforecast
    ? t("hr.kpi.reforecastLabel", "Réactualisé {v}").replace("{v}", reforecast)
    : null;

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden border-l-[3px] bg-white p-4 tabular-nums",
        accentClass[accent],
        onClick &&
          "cursor-pointer text-left transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-black",
        className
      )}
      {...(onClick && {
        role: "button",
        tabIndex: 0,
        title: t("hr.kpi.openDetail", "Voir le détail"),
        onClick,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        },
      })}
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
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-[24px] font-bold leading-none tracking-tight text-primary">
          {value}
        </span>
        <span className="shrink-0 rounded-sm bg-neutral-100 px-1.5 py-0.5 text-[11px] font-bold text-primary">
          {pct} %
        </span>
      </div>
      {barPct !== undefined && (
        <div className="relative mt-2 h-1 overflow-visible bg-neutral-100">
          <div className="h-full bg-bp-coral" style={{ width: `${clamp(barPct)}%` }} />
          {reforecastDiffers && barMarkerPct !== undefined && (
            <div
              className="absolute -top-0.5 h-2 w-[2px] bg-neutral-700"
              style={{ left: `${clamp(barMarkerPct)}%` }}
              title={reforecastText ?? t("dashboard.kpi.reforecast", "Reforecast")}
            />
          )}
        </div>
      )}
      <div
        className="mt-1.5 text-[11px] text-secondary"
        title={
          reforecastDiffers
            ? undefined
            : t("hr.kpi.reforecastSameAsTarget", "Réactualisé identique à la cible")
        }
      >
        {targetText}
        {reforecastText && ` · ${reforecastText}`}
      </div>
    </div>
  );
}
