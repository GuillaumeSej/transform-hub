"use client";

import { useMemo, useState } from "react";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";
import { parseNumber } from "@/lib/kpiHistory";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  canAdjustKpiValue,
  canDecide,
  describeApproval,
  STRATEGIC_APPROVAL_KINDS,
  type KpiValueApprovalPayload,
  type StrategicApproval,
  type StrategicApprovalData,
  type StrategicApprovalKind,
} from "@/lib/strategicApprovals";
import { intlTag } from "@/lib/format";
import {
  chainStepsView,
  KIND_FALLBACK,
  kindLabelKey,
  LEVEL_FALLBACK,
  levelLabelKey,
  patchDiffRows,
  type ChainStepView,
} from "@/lib/strategicApprovalView";
import type { ChainLevel } from "@/lib/strategicHierarchy";
import type { AuthUser } from "@/types";

type Tab = "todo" | "mine" | "history";

function formatTimestamp(ts: string | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleDateString(intlTag(), {
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
  user,
  legacy,
}: {
  api: Api;
  data: StrategicApprovalData;
  /** Utilisateur courant : Approuver/Refuser seulement s'il peut décider le palier COURANT
   *  (`canDecide`). Absent = on se fie au bucket `api.pending` (déjà filtré par palier). */
  user?: Pick<AuthUser, "username" | "profiles" | "isGlobalAdmin" | "isCompanyAdmin"> | null;
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

  const kindLabel = (k: StrategicApprovalKind) => t(kindLabelKey(k), KIND_FALLBACK[k]);
  const levelLabel = (l: ChainLevel) => t(levelLabelKey(l), LEVEL_FALLBACK[l]);
  /** Ids → libellés pour le diff des modifications (chantier/axes de rattachement, indicateur). */
  const idNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of data.chantiers) out[c.id] = c.name;
    for (const a of data.axes) out[a.id] = a.name;
    for (const i of data.indicators) out[i.id] = i.name;
    return out;
  }, [data.chantiers, data.axes, data.indicators]);
  const decidable = (a: StrategicApproval) =>
    a.status === "pending" && (user === undefined || canDecide(user, a, data));
  /** Correction KPI dont la valeur est modifiable par le décideur COURANT avant d'accepter —
   *  uniquement au DERNIER palier (`canAdjustKpiValue`) : un valideur intermédiaire approuve ou
   *  refuse, sans ajuster. */
  const kpiCorrection = (a: StrategicApproval): KpiValueApprovalPayload | undefined =>
    canAdjustKpiValue(a) ? (a.payload as KpiValueApprovalPayload) : undefined;
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
            const steps = chainStepsView(a, data.users);
            const diff = patchDiffRows(a, data.users, idNames);
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
                        {a.chain?.length
                          ? (steps.find((s) => s.state === "current")?.approverNames.join(", ") ??
                            "—")
                          : (a.approverUsername ?? a.approverRole)}
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

                  {steps.length > 0 && <ChainStepper steps={steps} levelLabel={levelLabel} />}

                  {diff.length > 0 ? (
                    <table className="mt-3 w-full rounded-md bg-neutral-50 text-left text-xs">
                      <thead>
                        <tr className="text-[10px] font-semibold uppercase tracking-wide text-tertiary">
                          <th className="px-3 py-1.5">{t("validation.sa.field", "Champ")}</th>
                          <th className="px-3 py-1.5">{t("validation.sa.before", "Avant")}</th>
                          <th className="px-3 py-1.5" aria-hidden="true" />
                          <th className="px-3 py-1.5">{t("validation.sa.after", "Après")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diff.map((row) => (
                          <tr key={row.field} className="border-t border-border">
                            <td className="px-3 py-1.5 text-tertiary">
                              {t(row.labelKey, row.labelFallback)}
                            </td>
                            <td className="px-3 py-1.5 text-secondary">{row.before}</td>
                            <td className="px-1 py-1.5" aria-hidden="true">
                              →
                            </td>
                            <td className="px-3 py-1.5 font-semibold text-primary">{row.after}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
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
                  )}

                  {tab === "todo" && decidable(a) && kpiCorrection(a) && (
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

                  {tab === "todo" && decidable(a) && (
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

/** Stepper compact des paliers : « Étape 1 : Sponsor d'axe (Marie) ✓ — Étape 2 : Pilote (Paul)
 *  en attente », palier courant surligné, paliers décidés avec qui/quand/commentaire. */
function ChainStepper({
  steps,
  levelLabel,
}: {
  steps: ChainStepView[];
  levelLabel: (level: ChainLevel) => string;
}) {
  const { t } = useTranslation();
  const stateText = (s: ChainStepView) =>
    s.state === "approved"
      ? "✓"
      : s.state === "rejected"
        ? t("validation.sa.step.rejected", "refusée")
        : s.state === "current"
          ? t("validation.sa.step.current", "en attente")
          : s.state === "skipped"
            ? t("validation.sa.step.skipped", "non atteinte")
            : t("validation.sa.step.upcoming", "à venir");
  return (
    <ol
      className="mt-3 flex flex-wrap items-stretch gap-2 text-xs"
      aria-label={t("validation.sa.chain", "Chaîne de validation")}
    >
      {steps.map((s) => (
        <li
          key={s.index}
          aria-current={s.state === "current" ? "step" : undefined}
          className={`rounded-md border px-2.5 py-1.5 ${
            s.state === "current"
              ? "border-rag-amber bg-rag-amber-light"
              : s.state === "approved"
                ? "border-border bg-rag-green-light"
                : s.state === "rejected"
                  ? "border-border bg-rag-red-light"
                  : "border-border bg-white text-tertiary"
          }`}
        >
          <div>
            <span className="font-semibold text-primary">
              {t("validation.sa.step.label", "Étape")} {s.index}
            </span>{" "}
            : {levelLabel(s.level)}
            {s.approverNames.length > 0 && ` (${s.approverNames.join(", ")})`}{" "}
            <span
              className={`font-semibold ${
                s.state === "approved"
                  ? "text-rag-green-dark"
                  : s.state === "rejected"
                    ? "text-rag-red"
                    : s.state === "current"
                      ? "text-rag-amber"
                      : ""
              }`}
            >
              {stateText(s)}
            </span>
          </div>
          {s.decidedByName && (
            <div className="mt-0.5 text-[11px] text-secondary">
              {s.decidedByName} · {formatTimestamp(s.decidedAt)}
              {s.comment && ` — « ${s.comment} »`}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
