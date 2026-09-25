"use client";

import { Suspense, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { displayMilestoneId } from "@/lib/axisLogic";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import {
  useApprovalQueue,
  useDeletionQueue,
  useMilestoneApprovalQueue,
  useRealizedApprovalQueue,
} from "@/lib/hooks/useApprovalQueue";
import { decideImpactRealized } from "@/lib/impactStatus";
import { fmtCurr } from "@/lib/engine";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData, type StrategicData } from "@/lib/hooks/useStrategicData";
import { useToast } from "@/lib/hooks/useToast";
import { useStrategicApprovals } from "@/lib/hooks/useStrategicApprovals";
import { StrategicApprovalsPanel } from "@/components/validation/StrategicApprovalsPanel";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { STATUS_SHORT_LABEL } from "@/lib/status-config";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { StageBadge } from "@/components/shared/StageBadge";
import { LeverDeletionDialog } from "@/components/shared/LeverDeletionDialog";
import type { AuthUser, Lever } from "@/types";
import { intlTag } from "@/lib/format";
import { onActivateKey } from "@/lib/a11y";
import { isPilotProfile } from "@/lib/myWorkspace";
import { useMyWorkspace } from "@/lib/hooks/useMyWorkspace";
import { BlockedSection, SkeletonCard } from "@/components/workspace/WorkspaceSections";
import {
  parseValidationTab,
  validationTabQuery,
  VALIDATION_TAB_PARAM,
  type ValidationTab,
} from "@/components/validation/validationTabs";

function formatTimestamp(ts: string): string {
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

/**
 * Vue Plan Performance (comportement historique, INCHANGÉ) — sponsors de workstream, CTO et
 * admins : liste tout ce qui attend actuellement leur approbation, toutes portes confondues
 * (M1→M2/M2→M3/M3→M4, voir lib/leversLogic.ts::approveLeverGate). Même source de données que le
 * badge/dropdown du Topbar (`useApprovalQueue`, voir lib/hooks/useApprovalQueue.ts).
 */
function PerformanceValidationTable({ user }: { user: AuthUser | null }) {
  const { t } = useTranslation();
  const router = useRouter();
  const data = useBeTrackData(user?.companyId ?? null, user);
  const { queue } = useApprovalQueue(data, user);
  const { queue: realizedQueue } = useRealizedApprovalQueue(data, user);
  const { queue: deletionQueue } = useDeletionQueue(data, user);
  const [deletionLeverId, setDeletionLeverId] = useState<string | null>(null);
  const { showToast } = useToast();

  if (queue.length === 0 && realizedQueue.length === 0 && deletionQueue.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-secondary">
            {t("validation.empty", "Rien à valider pour le moment.")}
          </p>
        </CardBody>
      </Card>
    );
  }

  /** Décision finance sur un impact coché « Réalisé » (même règle que l'onglet Impact de la fiche,
   *  `decideImpactRealized`) : validé → compte dans le réalisé ; rejeté → repasse non réalisé. */
  const decideRealized = (lever: Lever, impactId: string, decision: "approved" | "rejected") => {
    const next = (lever.impacts ?? []).map((imp) =>
      imp.id === impactId ? { ...imp, ...decideImpactRealized(imp, decision, user) } : imp
    );
    data.updateLever(lever.id, { impacts: next });
    showToast(
      decision === "approved"
        ? t("validation.realized.approved", "Réalisé validé")
        : t("validation.realized.rejected", "Réalisé rejeté"),
      lever.name,
      "success"
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <LeverDeletionDialog
        lever={deletionLeverId ? (data.getLeverById(deletionLeverId) ?? null) : null}
        user={user}
        data={data}
        open={deletionLeverId !== null}
        onOpenChange={(open) => !open && setDeletionLeverId(null)}
      />
      {deletionQueue.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-primary">
            {t("validation.deletion.title", "Suppressions à confirmer")} · {deletionQueue.length}
          </h2>
          <p className="text-xs text-secondary">
            {t(
              "validation.deletion.intro",
              "Suppressions de leviers demandées par le CTO ou un responsable de chantier : elles ne sont effectives qu'après votre confirmation."
            )}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-white">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-neutral-50 text-[10px] font-semibold uppercase tracking-wide text-tertiary">
                  <th className="px-4 py-2.5">{t("validation.lever", "Levier")}</th>
                  <th className="px-4 py-2.5">{t("validation.workstream", "Chantier")}</th>
                  <th className="px-4 py-2.5">{t("validation.requestedBy", "Demandé par")}</th>
                  <th className="px-4 py-2.5">{t("validation.requestedAt", "Demandé le")}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {deletionQueue.map((lever) => (
                  <tr
                    key={lever.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-neutral-50"
                    tabIndex={0}
                    onClick={() => router.push(`/levers/detail?id=${lever.id}`)}
                    onKeyDown={onActivateKey(() => router.push(`/levers/detail?id=${lever.id}`))}
                  >
                    <td className="px-4 py-3">
                      <div className="font-mono text-[10px] text-tertiary">{lever.code}</div>
                      <div className="font-semibold text-primary">{lever.name}</div>
                    </td>
                    <td className="px-4 py-3 text-secondary">
                      {data.workstreams.find((w) => w.id === lever.ws)?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-secondary">
                      {lever.deletionRequest?.requestedByName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-secondary">
                      {lever.deletionRequest
                        ? formatTimestamp(lever.deletionRequest.requestedAt)
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletionLeverId(lever.id);
                          }}
                        >
                          {t("validation.deletion.review", "Examiner")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {realizedQueue.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-primary">
            {t("validation.realized.title", "Réalisés à valider")} · {realizedQueue.length}
          </h2>
          <p className="text-xs text-secondary">
            {t(
              "validation.realized.intro",
              "Gains ou coûts cochés « Réalisé » par les porteurs : ils ne comptent dans le réalisé qu'une fois validés."
            )}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-white">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-neutral-50 text-[10px] font-semibold uppercase tracking-wide text-tertiary">
                  <th className="px-4 py-2.5">{t("validation.lever", "Levier")}</th>
                  <th className="px-4 py-2.5">{t("validation.realized.impact", "Impact")}</th>
                  <th className="px-4 py-2.5 text-right">
                    {t("validation.realized.amount", "Montant")}
                  </th>
                  <th className="px-4 py-2.5">{t("validation.requestedBy", "Demandé par")}</th>
                  <th className="px-4 py-2.5">{t("validation.requestedAt", "Demandé le")}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {realizedQueue.map(({ lever, impact }) => (
                  <tr
                    key={`${lever.id}-${impact.id}`}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-neutral-50"
                    tabIndex={0}
                    onClick={() => router.push(`/levers/detail?id=${lever.id}`)}
                    onKeyDown={onActivateKey(() => router.push(`/levers/detail?id=${lever.id}`))}
                  >
                    <td className="px-4 py-3">
                      <div className="font-mono text-[10px] text-tertiary">{lever.code}</div>
                      <div className="font-semibold text-primary">{lever.name}</div>
                    </td>
                    <td className="px-4 py-3 text-secondary">{impact.label}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-primary">
                      {impact.type === "cost" ? "−" : ""}
                      {fmtCurr(impact.amount)}
                    </td>
                    <td className="px-4 py-3 text-secondary">
                      {impact.realizedApproval?.requestedBy ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-secondary">
                      {impact.realizedApproval?.requestedAt
                        ? formatTimestamp(impact.realizedApproval.requestedAt)
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            decideRealized(lever, impact.id, "approved");
                          }}
                        >
                          {t("impactsEditor.approve", "Valider")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            decideRealized(lever, impact.id, "rejected");
                          }}
                        >
                          {t("impactsEditor.reject", "Rejeter")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {queue.length > 0 && (
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
                    tabIndex={0}
                    onClick={() => router.push(`/levers/detail?id=${lever.id}`)}
                    onKeyDown={onActivateKey(() => router.push(`/levers/detail?id=${lever.id}`))}
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

/**
 * Vue Plan Stratégique (round "jalon validation gate") — pendant de `PerformanceValidationTable`
 * ci-dessus, pour les demandes de validation de JALON de projet (`ChantierAction.milestoneApproval`)
 * plutôt qu'une porte de cycle de vie de levier. Approbateurs = cascade `canDecideMilestone`
 * (pilote du chantier, à défaut responsable d'axe, `strategic_lead` du programme, admin) — pas de
 * sponsor/cto, notion absente du Plan Stratégique. Même source de données que le dropdown du Topbar
 * (`useMilestoneApprovalQueue`, voir lib/hooks/useApprovalQueue.ts).
 */
function StrategicValidationTable({
  data,
  user,
  excludeActionIds,
  hideWhenEmpty,
}: {
  data: StrategicData;
  user: AuthUser | null;
  /** Projets déjà couverts par une demande du nouveau flux (lib/strategicApprovals.ts) : évite le
   *  doublon avec le marqueur `milestoneApproval` posé par `request("milestone", …)`. */
  excludeActionIds?: Set<string>;
  hideWhenEmpty?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { queue: fullQueue } = useMilestoneApprovalQueue(data, user);
  const queue = excludeActionIds
    ? fullQueue.filter(({ action }) => !excludeActionIds.has(action.id))
    : fullQueue;
  const { showToast } = useToast();

  if (queue.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-secondary">
            {t("validation.empty", "Rien à valider pour le moment.")}
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-white">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-neutral-50 text-[10px] font-semibold uppercase tracking-wide text-tertiary">
            <th className="px-4 py-2.5">{t("validation.milestone.projet", "Projet")}</th>
            <th className="px-4 py-2.5">{t("validation.milestone.chantier", "Chantier")}</th>
            <th className="px-4 py-2.5">
              {t("validation.milestone.targetMilestone", "Jalon visé")}
            </th>
            <th className="px-4 py-2.5">{t("validation.requestedBy", "Demandé par")}</th>
            <th className="px-4 py-2.5">{t("validation.requestedAt", "Demandé le")}</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {queue.map(({ action, chantier }) => {
            const approval = action.milestoneApproval;
            return (
              <tr
                key={action.id}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-neutral-50"
                tabIndex={0}
                onClick={() => router.push(`/levers?chantier=${chantier.id}&action=${action.id}`)}
                onKeyDown={onActivateKey(() =>
                  router.push(`/levers?chantier=${chantier.id}&action=${action.id}`)
                )}
              >
                <td className="px-4 py-3 font-semibold text-primary">{action.name}</td>
                <td className="px-4 py-3 text-secondary">{chantier.name}</td>
                <td className="px-4 py-3">
                  {approval && (
                    <span className="rounded-full bg-rag-amber-light px-2.5 py-1 text-[11px] font-semibold text-rag-amber">
                      {displayMilestoneId(approval.targetMilestone)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-secondary">{approval?.requestedBy ?? "—"}</td>
                <td className="px-4 py-3 text-secondary">
                  {approval ? formatTimestamp(approval.requestedAt) : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await data.approveMilestoneGate(action.id);
                          showToast(
                            t("leverDetail.approval.approved", "Demande approuvée"),
                            action.name,
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
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await data.rejectMilestoneApproval(action.id);
                          showToast(
                            t("leverDetail.approval.rejected", "Demande de validation rejetée"),
                            action.name,
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
  );
}

/**
 * Page dédiée "Validation" — devenue program-type-aware (round "jalon validation gate") : en mode
 * Plan Performance, comportement historique inchangé (`PerformanceValidationTable`, portes de
 * cycle de vie de levier) ; en mode Plan Stratégique, demandes de validation de jalon de projet
 * (`StrategicValidationTable`, nouveau round). La PAGE branche elle-même sur `programType`
 * (`useActiveProgram`) plutôt que de dupliquer la route — voir `lib/nav-config.ts` pour l'octroi
 * d'accès nav correspondant (`strategic_lead` y gagne cet item, scopé `programTypes: ["strategic"]`).
 */
/**
 * Vue Plan Stratégique complète : demandes de validation (lib/strategicApprovals.ts) + file de
 * jalons historique (`milestoneApproval` posé hors du nouveau flux) sous « À valider ».
 */
function StrategicValidationView({
  user,
  activeProgramId,
}: {
  user: AuthUser | null;
  activeProgramId: string | null;
}) {
  const data = useStrategicData(user?.companyId ?? null, activeProgramId, user);
  const sa = useStrategicApprovals({
    user,
    companyId: user?.companyId ?? null,
    programId: activeProgramId,
    data,
  });
  const covered = new Set(
    sa.approvals
      .filter((a) => a.kind === "milestone" && a.status === "pending")
      .map((a) => a.targetId)
  );
  return (
    <StrategicApprovalsPanel
      api={sa}
      data={{ ...data, programId: activeProgramId }}
      user={user}
      legacy={
        <div className="mt-4">
          <StrategicValidationTable
            data={data}
            user={user}
            excludeActionIds={covered}
            hideWhenEmpty
          />
        </div>
      }
    />
  );
}

/**
 * Vue pilotage (cto / program_sponsor / program_owner / admins — `isPilotProfile`, même règle que
 * « Mon espace ») : deux onglets. « Mes décisions » = contenu historique de la page, INCHANGÉ ;
 * « En attente chez d'autres » = `MyWorkspace.blocked` (validations en attente depuis plus de 7 j
 * chez un autre décideur), calculé par le moteur de « Mon espace » (`useMyWorkspace` → pas de règle
 * dupliquée). Le hook n'est monté que pour les pilotes. Onglet synchronisé avec `?tab=blocked`.
 */
function PilotValidationTabs({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseValidationTab(searchParams.get(VALIDATION_TAB_PARAM));
  const { workspace, loading } = useMyWorkspace();

  const selectTab = (next: ValidationTab) => {
    const qs = validationTabQuery(searchParams.toString(), next);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const blockedLabel = t("validation.tabs.blocked", "En attente chez d'autres");
  const tabs: { id: ValidationTab; label: string }[] = [
    { id: "mine", label: t("validation.tabs.mine", "Mes décisions") },
    {
      id: "blocked",
      label: loading ? blockedLabel : `${blockedLabel} (${workspace.blocked.length})`,
    },
  ];

  return (
    <div>
      <div
        role="tablist"
        className="mb-4 flex w-fit overflow-hidden rounded-md border border-border"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => selectTab(item.id)}
            className={`px-3 py-1.5 text-xs font-semibold ${
              tab === item.id ? "bg-black text-white" : "bg-white text-secondary"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "mine" ? (
        children
      ) : loading ? (
        <div aria-busy="true" aria-label={t("validation.tabs.loading", "Chargement…")}>
          <SkeletonCard rows={3} />
        </div>
      ) : (
        <BlockedSection
          items={workspace.blocked}
          navigate={(href) => router.push(href)}
          t={t}
          title={blockedLabel}
          subtitle={t(
            "validation.tabs.blockedSubtitle",
            "Validations en attente depuis plus de 7 jours chez un autre décideur — relancez-les."
          )}
          emptyLabel={t(
            "validation.tabs.blockedEmpty",
            "Aucune validation en attente chez d'autres depuis plus de 7 jours."
          )}
        />
      )}
    </div>
  );
}

function ValidationPageContent() {
  const { t } = useTranslation();
  const { user } = useRole();
  const { programType, activeProgramId } = useActiveProgram();
  const isStrategic = programType === "strategic";

  const decisions = isStrategic ? (
    <StrategicValidationView user={user} activeProgramId={activeProgramId} />
  ) : (
    <PerformanceValidationTable user={user} />
  );

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex items-center gap-2">
        <ShieldCheck size={18} className="text-bp-coral" />
        <h1 className="text-xl font-bold text-primary">{t("validation.title", "Validation")}</h1>
      </div>

      {isPilotProfile(user) ? <PilotValidationTabs>{decisions}</PilotValidationTabs> : decisions}
    </div>
  );
}

/** Suspense : `PilotValidationTabs` lit `useSearchParams()` (`?tab=`), ce que Next.js exige
 *  d'envelopper en export statique (même motif que app/(app)/dashboard/page.tsx). */
export default function ValidationPage() {
  return (
    <Suspense fallback={null}>
      <ValidationPageContent />
    </Suspense>
  );
}
