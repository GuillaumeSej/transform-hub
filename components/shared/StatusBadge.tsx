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
 *  `engine.computeLeverRisk`) — affiché en tooltip natif (`title`) sur le badge quand fourni,
 *  pour ne pas changer la mise en page des call sites existants qui n'ont pas ce contexte
 *  (`workstreams/page.tsx`, `DashboardPagePerformance.tsx`, qui continuent à passer `risk` seul). */
export function StatusBadge({
  risk,
  reason,
  className,
}: {
  risk: RiskLevel;
  reason?: string;
  className?: string;
}) {
  return (
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
}
