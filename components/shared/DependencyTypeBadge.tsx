import { Tooltip } from "@/components/shared/Tooltip";
import { DEPENDENCY_TYPE_DESCRIPTION, DEPENDENCY_TYPE_LABEL } from "@/lib/status-config";
import type { DependencyType } from "@/types";

export function DependencyTypeBadge({ type }: { type: DependencyType }) {
  return (
    <Tooltip text={`${type} : ${DEPENDENCY_TYPE_DESCRIPTION[type]}`} position="bottom">
      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-secondary">
        <strong className="text-primary">{type}</strong>
        <span aria-hidden="true">·</span>
        {DEPENDENCY_TYPE_LABEL[type]}
      </span>
    </Tooltip>
  );
}
