import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/types";

const STYLES: Record<RiskLevel, string> = {
  low: "bg-rag-green-light text-rag-green-dark",
  medium: "bg-rag-amber-light text-rag-amber",
  high: "bg-rag-red-light text-rag-red",
  critical: "bg-bp-deep-red/10 text-bp-deep-red",
};

/** Badge RAG (risk level) — porté depuis `.badge` / `.risk-*` du prototype legacy. */
export function StatusBadge({ risk, className }: { risk: RiskLevel; className?: string }) {
  return (
    <span
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
