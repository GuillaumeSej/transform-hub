"use client";

import { Hourglass } from "lucide-react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  chainLabel,
  displayName,
  fillTemplate,
  formatPendingValue,
  pendingBadgeLabel,
  pendingFieldInfo,
  type PendingFieldInfo,
} from "@/lib/strategicFiche";
import type { StrategicApproval, StrategicApprovalTarget } from "@/lib/strategicApprovals";
import type { AuthUser } from "@/types";

/** Libellés traduits d'une demande en attente (badge + infobulle). */
export function usePendingLabels(users: AuthUser[]) {
  const { t } = useTranslation();
  const badge = (info: Pick<PendingFieldInfo, "current" | "total">) =>
    pendingBadgeLabel(info, {
      withStep: t(
        "strategicFiche.pending.badgeStep",
        "En attente de validation (étape {current}/{total})"
      ),
      plain: t("strategicFiche.pending.badge", "En attente de validation"),
    });
  const approvers = (usernames: string[]) =>
    fillTemplate(t("strategicFiche.pending.waitingFor", "Chez {names}"), {
      names: usernames.map((u) => displayName(u, users)).join(", ") || "—",
    });
  const proposed = (value: unknown) =>
    fillTemplate(t("strategicFiche.pending.proposedValue", "Valeur proposée : {value}"), {
      value: formatPendingValue(value, users),
    });
  const conflict = t(
    "strategicFiche.pending.conflictTooltip",
    "Une demande de validation est déjà en attente sur ce champ : attendez sa décision avant de le modifier à nouveau."
  );
  const chain = (steps: { usernames: string[] }[] | undefined) =>
    chainLabel(steps, users, t("strategicFiche.chain.then", "puis"));
  return { badge, approvers, proposed, conflict, chain };
}

/**
 * Badge « En attente de validation (étape x/2) » — pour un CHAMP (`field` : affiche aussi la valeur
 * proposée) ou pour un objet entier (`approval` fourni directement). Rien si rien n'est en attente.
 */
export function PendingApprovalBadge({
  approvals,
  target,
  field,
  approval,
  users,
  showValue = true,
  className = "",
}: {
  approvals?: StrategicApproval[];
  target?: Pick<StrategicApprovalTarget, "type" | "id">;
  field?: string;
  /** Demande précise (sinon résolue depuis `approvals`/`target`/`field`). */
  approval?: StrategicApproval;
  users: AuthUser[];
  showValue?: boolean;
  className?: string;
}) {
  const labels = usePendingLabels(users);
  let info: PendingFieldInfo | undefined;
  if (approval) {
    const chain = approval.chain;
    const idx = Math.min(approval.stepIndex ?? 0, (chain?.length ?? 1) - 1);
    info = {
      approval,
      ...(chain?.length ? { current: idx + 1, total: chain.length } : {}),
      approvers: chain?.length ? chain[idx].usernames : (approval.approverUsernames ?? []),
      value: undefined,
    };
  } else if (target && field) {
    info = pendingFieldInfo(approvals, target, field);
  }
  if (!info) return null;
  const tooltip = [
    labels.approvers(info.approvers),
    info.approval.chain?.length ? labels.chain(info.approval.chain) : "",
    field && info.value !== undefined ? labels.proposed(info.value) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`} title={tooltip}>
      <span className="inline-flex items-center gap-1 rounded-full bg-rag-amber-light px-2 py-0.5 text-[10.5px] font-semibold text-rag-amber">
        <Hourglass size={10} aria-hidden /> {labels.badge(info)}
      </span>
      {showValue && field && info.value !== undefined && (
        <span className="text-[10.5px] italic text-tertiary">{labels.proposed(info.value)}</span>
      )}
    </span>
  );
}
