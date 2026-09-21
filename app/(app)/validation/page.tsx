"use client";

import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useApprovalQueue } from "@/lib/hooks/useApprovalQueue";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { STATUS_SHORT_LABEL } from "@/lib/status-config";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { StageBadge } from "@/components/shared/StageBadge";

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

/**
 * Page dédiée "Validation" — pour les sponsors de workstream, les CTO et les admins : liste tout
 * ce qui attend actuellement leur approbation, toutes portes confondues (M1→M2/M2→M3/M3→M4, voir
 * lib/leversLogic.ts::approveLeverGate). Même source de données que le badge/dropdown du Topbar
 * (`useApprovalQueue`, voir lib/hooks/useApprovalQueue.ts) — cette page en est la vue complète
 * avec actions inline, plutôt qu'une duplication de la logique de résolution de file.
 */
export default function ValidationPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null, user);
  const { queue } = useApprovalQueue(data, user);
  const { showToast } = useToast();

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex items-center gap-2">
        <ShieldCheck size={18} className="text-bp-coral" />
        <h1 className="text-xl font-bold text-primary">{t("validation.title", "Validation")}</h1>
      </div>

      {queue.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-secondary">
              {t("validation.empty", "Rien à valider pour le moment.")}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-neutral-50 text-[10px] font-semibold uppercase tracking-wide text-tertiary">
                <th className="px-4 py-2.5">{t("validation.lever", "Levier")}</th>
                <th className="px-4 py-2.5">{t("validation.gate", "Étape")}</th>
                <th className="px-4 py-2.5">{t("validation.workstream", "Chantier")}</th>
                <th className="px-4 py-2.5">{t("validation.requestedBy", "Demandé par")}</th>
                <th className="px-4 py-2.5">{t("validation.requestedAt", "Demandé le")}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {queue.map((lever) => {
                const ws = data.workstreams.find((w) => w.id === lever.ws);
                const targetStatus = lever.approval?.targetStatus;
                return (
                  <tr
                    key={lever.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-neutral-50"
                    onClick={() => router.push(`/levers/detail?id=${lever.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-mono text-[10px] text-tertiary">{lever.code}</div>
                      <div className="font-semibold text-primary">{lever.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      {targetStatus && (
                        <StageBadge
                          status={targetStatus}
                          label={STATUS_SHORT_LABEL[targetStatus]}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 text-secondary">{ws?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-secondary">
                      {lever.approval?.requestedBy ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-secondary">
                      {lever.approval ? formatTimestamp(lever.approval.requestedAt) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            try {
                              data.approveLeverGate(lever.id);
                              showToast(
                                t("leverDetail.approval.approved", "Demande approuvée"),
                                lever.name,
                                "success"
                              );
                            } catch (err) {
                              showToast(
                                t("leverDetail.approval.error", "Action impossible"),
                                err instanceof Error ? err.message : String(err),
                                "error"
                              );
                            }
                          }}
                        >
                          {t("leverDetail.approval.approve", "Approuver")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            try {
                              data.rejectLeverApproval(lever.id);
                              showToast(
                                t("leverDetail.approval.rejected", "Demande de validation rejetée"),
                                lever.name,
                                "success"
                              );
                            } catch (err) {
                              showToast(
                                t("leverDetail.approval.error", "Action impossible"),
                                err instanceof Error ? err.message : String(err),
                                "error"
                              );
                            }
                          }}
                        >
                          {t("leverDetail.approval.reject", "Rejeter")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
