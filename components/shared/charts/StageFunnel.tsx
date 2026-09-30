"use client";

import { useState } from "react";
import type { StageCount } from "@/lib/engine";
import type { StagePreview } from "@/lib/chartHoverPreview";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { ChartHoverArea, FloatingPreview } from "./HoverPreview";
import {
  PreviewBar,
  PreviewCard,
  PreviewRow,
  PreviewTopLevers,
  fmtM,
  fmtShare,
} from "./LeverGroupPreview";

/** Avancement des leviers par étape du cycle de vie (+ Annulé) — clic pour creuser vers la liste filtrée.
 *
 * Aperçu au survol (retour PO, même carte que la Trajectoire des économies) : étape → nombre de
 * leviers, valeur (net réactualisé), part du pipeline et 3 principaux leviers par valeur. Rendu en
 * portail (`FloatingPreview`) : jamais rogné par la carte. */
export function StageFunnel({
  data,
  onStageClick,
  details,
}: {
  data: StageCount[];
  onStageClick?: (status: StageCount["status"]) => void;
  /** Synthèse des leviers d'une étape (aperçu au survol, voir `stagePreviews`). */
  details?: (status: StageCount["status"]) => StagePreview | undefined;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<StageCount | null>(null);
  const max = Math.max(1, ...data.map((d) => d.count));
  const preview = hovered ? details?.(hovered.status) : undefined;
  return (
    <ChartHoverArea>
      <div className="flex h-[300px] items-end gap-3 px-1">
        {data.map((d) => (
          <button
            key={d.status}
            type="button"
            onClick={() => onStageClick?.(d.status)}
            onMouseEnter={() => setHovered(d)}
            onMouseLeave={() => setHovered(null)}
            className="group flex flex-1 flex-col items-center justify-end gap-2"
          >
            <span className="text-lg font-bold text-primary">{d.count}</span>
            <div
              className={`w-full rounded-t-sm transition group-hover:opacity-80 ${
                d.status === "cancelled" ? "bg-neutral-300" : "bg-bp-coral"
              }`}
              style={{ height: `${Math.max(6, (d.count / max) * 210)}px` }}
            />
            <span className="text-[13px] font-bold text-secondary">{d.level}</span>
            <span className="text-[10px] uppercase tracking-wide text-tertiary">{d.label}</span>
          </button>
        ))}
      </div>
      {hovered && (
        <FloatingPreview>
          <PreviewCard
            title={`${hovered.level} · ${hovered.label}`}
            clickHint={
              onStageClick
                ? t("chart.groupPreview.clickLevers", "Cliquer pour voir les leviers →")
                : undefined
            }
          >
            <div className="space-y-1">
              <PreviewRow
                label={t("chart.groupPreview.leverCount", "Nombre de leviers")}
                value={hovered.count}
                strong
              />
              {preview && (
                <>
                  <PreviewRow
                    color={hovered.status === "cancelled" ? "#CCC1BD" : "#FF3C47"}
                    label={t("chart.groupPreview.stageValue", "Valeur (net réactualisé)")}
                    value={fmtM(preview.value)}
                  />
                  {preview.pipelineShare !== null && (
                    <PreviewRow
                      label={t("chart.groupPreview.pipelineShare", "Part du pipeline")}
                      value={fmtShare(preview.pipelineShare)}
                    />
                  )}
                </>
              )}
            </div>
            {preview && preview.pipelineShare !== null && (
              <div className="mt-2">
                <PreviewBar pct={preview.pipelineShare} />
              </div>
            )}
            {preview && <PreviewTopLevers levers={preview.top} />}
          </PreviewCard>
        </FloatingPreview>
      )}
    </ChartHoverArea>
  );
}
