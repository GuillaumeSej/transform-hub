import { cn } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/status-config";
import type { LeverStatus } from "@/types";

const STYLES: Record<LeverStatus, string> = {
  idea: "bg-neutral-100 text-secondary",
  qualified: "bg-neutral-100 text-secondary",
  validated: "bg-info-blue-light text-info-blue",
  in_progress: "bg-info-blue-light text-info-blue",
  delivered: "bg-rag-green-light text-rag-green-dark",
  cancelled: "bg-rag-red-light text-rag-red",
};

/** Badge du niveau d'avancement L1-L5 du levier (labels dans lib/status-config.ts). */
export function StageBadge({ status, className }: { status: LeverStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        STYLES[status],
        className
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
