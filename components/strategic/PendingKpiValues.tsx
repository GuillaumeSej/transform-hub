"use client";

import { Clock } from "lucide-react";
import { useStrategicApprovalsApi } from "@/lib/hooks/useStrategicApprovalsContext";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { approverLabel, pendingApprovals } from "@/lib/strategicApprovalFlows";
import type { KpiValueApprovalPayload } from "@/lib/strategicApprovals";

/** Valeurs KPI soumises et « en attente de validation » : lignes grisées (non publiées). */
export function PendingKpiValues({
  indicatorId,
  unit,
  compact = false,
}: {
  indicatorId: string;
  unit?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const sa = useStrategicApprovalsApi();
  const rows = pendingApprovals(sa?.approvals, "kpi_value", indicatorId);
  if (rows.length === 0) return null;
  const label = t("kpi.pendingValidation", "En attente de validation");
  if (compact) {
    return (
      <p className="inline-flex items-center gap-1 text-[10px] font-medium text-rag-amber">
        <Clock size={10} /> {label} ({rows.length})
      </p>
    );
  }
  return (
    <ul className="space-y-1" aria-label={label}>
      {rows.map((a) => {
        const p = a.payload as KpiValueApprovalPayload;
        return (
          <li
            key={a.id}
            className="flex flex-wrap items-center gap-1.5 rounded-md border border-dashed border-border bg-bg-surface/60 px-2 py-1 text-xs italic text-text-secondary opacity-70"
          >
            <Clock size={11} className="text-rag-amber" />
            {p.measurementId && (
              <span className="not-italic font-semibold uppercase tracking-wide text-[10px]">
                {p.remove
                  ? t("kpi.measurement.pendingDeletion", "Suppression")
                  : t("kpi.measurement.pendingCorrection", "Correction")}
              </span>
            )}
            <span className="font-medium">{p.period}</span>
            <span>
              {p.value !== undefined ? `${p.value}${unit ? ` ${unit}` : ""}` : (p.note ?? "—")}
            </span>
            <span className="ml-auto text-[10.5px]">
              {label}
              {approverLabel(a) ? ` — ${approverLabel(a)}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
