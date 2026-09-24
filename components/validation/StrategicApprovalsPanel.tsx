"use client";

import { useMemo, useState } from "react";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";
import { parseNumber } from "@/lib/kpiHistory";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  describeApproval,
  STRATEGIC_APPROVAL_KINDS,
  type KpiValueApprovalPayload,
  type StrategicApproval,
  type StrategicApprovalData,
  type StrategicApprovalKind,
} from "@/lib/strategicApprovals";

type Tab = "todo" | "mine" | "history";

const KIND_FALLBACK: Record<StrategicApprovalKind, string> = {
  milestone: "Passage de jalon",
  kpi_value: "Valeur KPI",
  projet_create: "Ajout de projet",
  projet_delete: "Suppression de projet",
  chantier_delete: "Suppression de chantier",
};

function formatTimestamp(ts: string | undefined): string {
  if (!ts) return "—";
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

type Api = {
  pending: StrategicApproval[];
  mine: StrategicApproval[];
  history: StrategicApproval[];
  approve: (id: string, comment?: string, adjust?: { value?: number }) => Promise<void>;
  reject: (id: string, comment: string) => Promise<void>;
};

/**
 * Onglet Décision > Validation du Plan Stratégique : demandes à valider (filtre par type, détail
 * avant/après, Approuver/Refuser + commentaire), « Mes demandes » et « Historique des décisions ».
 * `legacy` = contenu additionnel (ex. file de jalons historique) rendu sous « À valider ».
 */
export function StrategicApprovalsPanel({
  api,
  data,
  legacy,
}: {
  api: Api;
  data: StrategicApprovalData;
  legacy?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("todo");
  const [kindFilter, setKindFilter] = useState<StrategicApprovalKind | "all">("all");
  const [comments, setComments] = useState<Record<string, string>>({});
  /** Valeur AJUSTÉE par l'approbateur d'une correction KPI (saisie brute, par demande). */
  const [adjusted, setAdjusted] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const kindLabel = (k: StrategicApprovalKind) => t(`validation.sa.kind.${k}`, KIND_FALLBACK[k]);
  /** Correction KPI (valeur modifiable par l'approbateur avant d'accepter). */
  const kpiCorrection = (a: StrategicApproval): KpiValueApprovalPayload | undefined => {
    if (a.kind !== "kpi_value") return undefined;
    const p = a.payload as KpiValueApprovalPayload;
    return p.measurementId && !p.remove ? p : undefined;
  };
  const statusLabel = (s: StrategicApproval["status"], direct?: boolean) =>
    direct
      ? t("validation.sa.status.direct", "Appliquée (information)")
      : s === "approved"
        ? t("validation.sa.status.approved", "Validée")
        : s === "rejected"
          ? t("validation.sa.status.rejected", "Refusée")
          : t("validation.sa.status.pending", "En attente");

  const list = useMemo(() => {
    const base = tab === "todo" ? api.pending : tab === "mine" ? api.mine : api.history;
    return kindFilter === "all" ? base : base.filter((a) => a.kind === kindFilter);
  }, [tab, kindFilter, api.pending, api.mine, api.history]);

  async function run(a: StrategicApproval, decision: "approve" | "reject") {
    const comment = comments[a.id] ?? "";
    if (decision === "reject" && !comment.trim()) {
      showToast(
        t("validation.sa.commentRequired", "Commentaire requis"),
        t("validation.sa.commentRequiredDesc", "Indiquez un motif pour refuser la demande."),
        "error"
      );
      return;
    }
    let adjust: { value?: number } | undefined;
    const rawAdjusted = adjusted[a.id];
    if (decision === "approve" && kpiCorrection(a) && rawAdjusted !== undefined) {
      const parsed = parseNumber(rawAdjusted);
      if (parsed === null) {
        showToast(t("kpi.valueInvalid"), a.targetName ?? a.targetId, "error");
        return;
      }
      if (parsed !== undefined) adjust = { value: parsed };
    }
    setBusyId(a.id);
    try {
      if (decision === "approve") await api.approve(a.id, comment, adjust);
      else await api.reject(a.id, comment);
      showToast(
        decision === "approve"
          ? t("leverDetail.approval.approved", "Demande approuvée")
          : t("leverDetail.approval.rejected", "Demande de validation rejetée"),
        a.targetName ?? a.targetId,
        "success"
      );
    } catch (err) {
      showToast(
        t("leverDetail.approval.error", "Action impossible"),
        err instanceof Error ? err.message : String(err),
        "error"
      );
    } finally {
      setBusyId(null);
    }
  }

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "todo", label: t("validation.sa.tab.todo", "À valider"), count: api.pending.length },
    { id: "mine", label: t("validation.sa.tab.mine", "Mes demandes"), count: api.mine.length },
    {
      id: "history",
      label: t("validation.sa.tab.history", "Historique des décisions"),
      count: api.history.length,
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              tab === tb.id
                ? "border-black bg-black text-white"
                : "border-border bg-white text-secondary hover:border-black"
            }`}
          >
            {tb.label} ({tb.count})
          </button>
        ))}
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as StrategicApprovalKind | "all")}
          aria-label={t("validation.sa.filterKind", "Type de demande")}
          className="ml-auto rounded-md border border-border bg-white px-2 py-1.5 text-xs text-secondary"
        >
          <option value="all">{t("validation.sa.allKinds", "Tous les types")}</option>
          {STRATEGIC_APPROVAL_KINDS.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
      </div>

      {list.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-secondary">
              {tab === "todo"
                ? t("validation.empty", "Rien à valider pour le moment.")
                : tab === "mine"
                  ? t("validation.sa.emptyMine", "Vous n'avez émis aucune demande.")
                  : t("validation.sa.emptyHistory", "Aucune décision pour le moment.")}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((a) => {
            const d = describeApproval(a, data);
            return (
              <Card key={a.id}>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-tertiary">
                        {kindLabel(a.kind)}
                      </div>
                      <div className="text-sm font-semibold text-primary">{d.subject}</div>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        a.status === "approved"
                          ? "bg-rag-green-light text-rag-green-dark"
                          : a.status === "rejected"
                            ? "bg-rag-red-light text-rag-red"
                            : "bg-rag-amber-light text-rag-amber"
                      }`}
                    >
                      {statusLabel(a.status, a.direct)}
                    </span>
                  </div>

                  <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="inline text-tertiary">
                        {t("validation.requestedBy", "Demandé par")} :{" "}
                      </dt>
                      <dd className="inline text-secondary">
                        {a.requestedByName ?? a.requestedBy}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-tertiary">
                        {t("validation.requestedAt", "Demandé le")} :{" "}
                      </dt>
                      <dd className="inline text-secondary">{formatTimestamp(a.requestedAt)}</dd>
                    </div>
                    <div>
                      <dt className="inline text-tertiary">
                        {t("validation.sa.approver", "Approbateur")} :{" "}
                      </dt>
                      <dd className="inline text-secondary">
                        {a.approverUsername ?? a.approverRole}
                      </dd>
                    </div>
                    {a.reason && (
                      <div>
                        <dt className="inline text-tertiary">
                          {t("validation.sa.reason", "Motif")} :{" "}
                        </dt>
                        <dd className="inline text-secondary">{a.reason}</dd>
                      </div>
                    )}
                    {a.status !== "pending" && (
                      <>
                        <div>
                          <dt className="inline text-tertiary">
                            {t("validation.sa.decidedBy", "Décidé par")} :{" "}
                          </dt>
                          <dd className="inline text-secondary">
                            {a.decidedByName ?? a.decidedBy ?? "—"} · {formatTimestamp(a.decidedAt)}
                          </dd>
                        </div>
                        {a.decisionComment && (
                          <div>
                            <dt className="inline text-tertiary">
                              {t("validation.sa.decisionComment", "Commentaire")} :{" "}
                            </dt>
                            <dd className="inline text-secondary">{a.decisionComment}</dd>
                          </div>
                        )}
                      </>
                    )}
                  </dl>

                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-neutral-50 px-3 py-2 text-xs">
                    <span className="text-tertiary">{t("validation.sa.before", "Avant")}</span>
                    <span className="font-semibold text-primary">{d.before ?? "—"}</span>
                    <span aria-hidden="true">→</span>
                    <span className="text-tertiary">{t("validation.sa.after", "Après")}</span>
                    <span className="font-semibold text-primary">
                      {d.after ??
                        (a.kind === "projet_delete" || a.kind === "chantier_delete"
                          ? t("validation.sa.deleted", "Supprimé")
                          : "—")}
                    </span>
                  </div>

                  {tab === "todo" && a.status === "pending" && kpiCorrection(a) && (
                    <label className="mt-3 flex flex-wrap items-center gap-2 text-xs text-tertiary">
                      {t(
                        "validation.sa.adjustValue",
                        "Valeur à appliquer (modifiable avant d'accepter)"
                      )}
                      <input
                        type="text"
                        inputMode="decimal"
                        value={adjusted[a.id] ?? String(kpiCorrection(a)?.value ?? "")}
                        onChange={(e) => setAdjusted((v) => ({ ...v, [a.id]: e.target.value }))}
                        className="w-28 rounded-md border border-border px-2.5 py-1.5 text-xs text-primary"
                      />
                    </label>
                  )}

                  {tab === "todo" && a.status === "pending" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={comments[a.id] ?? ""}
                        onChange={(e) => setComments((c) => ({ ...c, [a.id]: e.target.value }))}
                        placeholder={t(
                          "validation.sa.commentPlaceholder",
                          "Commentaire (obligatoire pour refuser)"
                        )}
                        className="min-w-[200px] flex-1 rounded-md border border-border px-2.5 py-1.5 text-xs"
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busyId === a.id}
                        onClick={() => run(a, "approve")}
                      >
                        {t("leverDetail.approval.approve", "Approuver")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === a.id}
                        onClick={() => run(a, "reject")}
                      >
                        {t("validation.sa.refuse", "Refuser")}
                      </Button>
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "todo" && legacy}
    </div>
  );
}
