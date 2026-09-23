"use client";

import { Tooltip } from "@/components/shared/Tooltip";
import { dependencyTypeDescription, dependencyTypeLabel } from "@/lib/dependencyLabels";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { DependencyType } from "@/types";

export function DependencyTypeBadge({ type }: { type: DependencyType }) {
  const { t } = useTranslation();
  return (
    <Tooltip text={`${type} : ${dependencyTypeDescription(t, type)}`} position="bottom">
      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-secondary">
        <strong className="text-primary">{type}</strong>
        <span aria-hidden="true">·</span>
        {dependencyTypeLabel(t, type)}
      </span>
    </Tooltip>
  );
}
