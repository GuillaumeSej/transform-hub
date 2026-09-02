"use client";

import { CircleAlert, CircleCheck, CircleUser, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/shared/Tooltip";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Alert } from "@/types";

const ICONS = { red: CircleAlert, amber: TriangleAlert, green: CircleCheck, blue: CircleUser };
const ICON_STYLE = {
  red: "bg-rag-red-light text-rag-red",
  amber: "bg-rag-amber-light text-rag-amber",
  green: "bg-rag-green-light text-rag-green-dark",
  blue: "bg-info-blue-light text-info-blue",
};

function fmtImpact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${v > 0 ? "+" : ""}€${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${v > 0 ? "+" : ""}€${Math.round(v / 1_000)}K`;
  return `${v > 0 ? "+" : ""}€${v}`;
}

/** Ligne d'alerte enrichie — impact €, owner, checkbox résolu, badge auto.
 *  Clic sur la ligne -> drill-down vers le levier/workstream (alert.scope).
 *  Clic sur la checkbox -> toggle résolu/à traiter (sans propager le clic ligne). */
export function AlertItem({
  alert,
  onClick,
  onToggleResolved,
  scopeLabel,
  tooltips,
}: {
  alert: Alert;
  onClick?: () => void;
  /** Callback quand le CTO coche/décoche la checkbox "résolu". */
  onToggleResolved?: () => void;
  /** Nom lisible du scope (nom du levier ou du workstream) au lieu de l'ID brut. */
  scopeLabel?: string;
  /** Textes des tooltips (traduits par l'appelant). */
  tooltips?: {
    severity?: string;
    impact?: string;
    auto?: string;
  };
}) {
  const { t } = useTranslation();
  const Icon = ICONS[alert.type];
  const resolved = alert.resolved ?? false;
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && e.key === "Enter") onClick();
      }}
      className={cn(
        "flex gap-3 border-b border-border py-3 last:border-b-0",
        onClick && "cursor-pointer rounded-sm px-1.5 -mx-1.5 transition hover:bg-neutral-50",
        resolved && "opacity-50"
      )}
    >
      {/* Checkbox résolu */}
      {onToggleResolved && (
        <div className="flex items-start pt-0.5">
          <input
            type="checkbox"
            checked={resolved}
            onChange={(e) => {
              e.stopPropagation();
              onToggleResolved();
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 cursor-pointer accent-bp-coral"
            title={
              resolved ? t("alerts.resolved", "Résolu / vu") : t("alerts.toProcess", "À traiter")
            }
          />
        </div>
      )}

      {/* Icône sévérité */}
      <Tooltip text={tooltips?.severity ?? ""} position="bottom">
        <div
          className={cn(
            "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm",
            ICON_STYLE[alert.type]
          )}
        >
          <Icon size={14} />
        </div>
      </Tooltip>

      {/* Contenu */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div
            className={cn(
              "text-[12.5px] text-primary",
              resolved ? "font-normal line-through decoration-neutral-300" : "font-semibold"
            )}
          >
            {alert.title}
          </div>
          {/* Badge impact € */}
          {alert.impactEur != null && alert.impactEur !== 0 && (
            <Tooltip text={tooltips?.impact ?? ""}>
              <span
                className={cn(
                  "flex-shrink-0 rounded-sm px-1.5 py-0.5 text-[10.5px] font-bold",
                  alert.impactEur < 0
                    ? "bg-rag-red-light text-rag-red"
                    : "bg-rag-green-light text-rag-green-dark"
                )}
              >
                {fmtImpact(alert.impactEur)}
              </span>
            </Tooltip>
          )}
        </div>
        <div className="mt-0.5 text-[11.5px] text-secondary">{alert.desc}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-tertiary">
          {alert.owner && <span className="font-medium text-secondary">{alert.owner}</span>}
          {alert.owner && <span>·</span>}
          <span>{alert.ts}</span>
          <span>·</span>
          <span>{scopeLabel || alert.scope}</span>
          {alert.source === "auto" && (
            <>
              <span>·</span>
              <Tooltip text={tooltips?.auto ?? ""} position="bottom">
                <span className="rounded-sm bg-neutral-100 px-1 py-px text-[9.5px] font-semibold uppercase tracking-wide text-tertiary">
                  {t("alerts.auto", "Auto")}
                </span>
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
