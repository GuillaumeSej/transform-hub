import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/types";

const STYLES: Record<RiskLevel, string> = {
  low: "bg-rag-green-light text-rag-green-dark",
  medium: "bg-rag-amber-light text-rag-amber",
  high: "bg-rag-red-light text-rag-red",
  critical: "bg-bp-deep-red/10 text-bp-deep-red",
};

/** Badge RAG (risk level) — porté depuis `.badge` / `.risk-*` du prototype legacy.
 *
 *  `reason` (optionnel) : motif du niveau de risque (`LeverRiskAssessment.reason`, voir
 *  `engine.computeLeverRisk`). Retour utilisateur : le tooltip natif (`title`) seul n'était pas
 *  DÉCOUVRABLE — rien ne signalait qu'on pouvait survoler le badge. Quand `reason` est fourni, une
 *  icône `Info` + `cursor-help` s'affiche donc à côté du badge et porte elle-même le `title` :
 *  signal visuel explicite qu'il y a plus d'info au survol, sans changer la mise en page des call
 *  sites existants qui n'ont pas ce contexte (`workstreams/page.tsx`, qui continue à passer `risk`
 *  seul et n'affiche donc pas l'icône). */
export function StatusBadge({
  risk,
  reason,
  className,
}: {
  risk: RiskLevel;
  reason?: string;
  className?: string;
}) {
  const badge = (
    <span
      title={reason}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
        STYLES[risk],
        className
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", {
          "bg-rag-green": risk === "low",
          "bg-rag-amber": risk === "medium" || risk === "high",
          "bg-bp-deep-red": risk === "critical",
        })}
      />
      {risk}
    </span>
  );

  if (!reason) return badge;

  return (
    <span className="inline-flex items-center gap-1">
      {badge}
      <span title={reason} className="inline-flex cursor-help">
        <Info size={12} className="text-tertiary" />
      </span>
    </span>
  );
}
