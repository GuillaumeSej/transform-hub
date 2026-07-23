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

/** Badge du niveau d'avancement du cycle de vie du levier. Le libellé par défaut vient de
 * `STATUS_LABEL` (lib/status-config.ts) ; les appelants avec accès à `useLifecycleLabels` peuvent
 * passer `label` pour refléter la config entreprise. */
export function StageBadge({
  status,
  label,
  className,
}: {
  status: LeverStatus;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        STYLES[status],
        className
      )}
    >
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}
