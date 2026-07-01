import { cn } from "@/lib/utils";
import type { LeverStatus } from "@/types";

const LABELS: Record<LeverStatus, string> = {
  idea: "Idea",
  qualified: "Qualified",
  validated: "Validated",
  in_progress: "In Progress",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const STYLES: Record<LeverStatus, string> = {
  idea: "bg-neutral-100 text-secondary",
  qualified: "bg-neutral-100 text-secondary",
  validated: "bg-info-blue-light text-info-blue",
  in_progress: "bg-info-blue-light text-info-blue",
  delivered: "bg-rag-green-light text-rag-green-dark",
  cancelled: "bg-rag-red-light text-rag-red",
};

/** Badge de stade du levier — porté depuis `.badge-*` (statut) du prototype legacy. */
export function StageBadge({ status, className }: { status: LeverStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        STYLES[status],
        className
      )}
    >
      {LABELS[status]}
    </span>
  );
}
