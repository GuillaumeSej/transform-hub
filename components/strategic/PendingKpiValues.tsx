"use client";

import { Clock } from "lucide-react";
import { useStrategicApprovalsApi } from "@/lib/hooks/useStrategicApprovalsContext";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { approverLabel, pendingApprovals } from "@/lib/strategicApprovalFlows";
import {
  approvalStepInfo,
  pendingApproversOf,
  type KpiValueApprovalPayload,
} from "@/lib/strategicApprovals";
import { displayUserName } from "@/lib/strategicApprovalView";
import type { AuthUser } from "@/types";

/** Valeurs KPI soumises et « en attente de validation » : lignes grisées (non publiées), avec
 *  l'étape courante (« étape 1/2 ») et le(s) approbateur(s) attendu(s). */
export function PendingKpiValues({
  indicatorId,
  unit,
  compact = false,
  users,
}: {
  indicatorId: string;
  unit?: string;
  compact?: boolean;
  /** Pour afficher le NOM des approbateurs attendus (repli : username). */
  users?: Pick<AuthUser, "username" | "name">[];
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
        const info = approvalStepInfo(a);
        const who = a.chain?.length
          ? pendingApproversOf(a)
              .map((u) => displayUserName(u, users))
              .join(", ")
          : approverLabel(a);
        const step =
          info && info.total > 1
            ? t("kpi.pendingStep", "étape {current}/{total}")
                .replace("{current}", String(info.current))
                .replace("{total}", String(info.total))
            : "";
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
              {step ? ` (${step})` : ""}
              {who ? ` — ${who}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
