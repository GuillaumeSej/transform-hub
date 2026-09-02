"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { subscribeCompanies } from "@/lib/firestore/admin";
import { canUserViewLever } from "@/lib/leversLogic";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Info,
  LayoutGrid,
  Link2,
  Pencil,
  Plus,
  Send,
  TriangleAlert,
} from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import { useLifecycleLabels } from "@/lib/hooks/useLifecycleLabels";
import * as engine from "@/lib/engine";
import { generateAlerts } from "@/lib/alertEngine";
import type { CascadeResult } from "@/lib/engine";
import { DEPENDENCY_TYPE_DESCRIPTION, STATUS_ORDER } from "@/lib/status-config";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { Avatar } from "@/components/shared/Avatar";
import { StageBadge } from "@/components/shared/StageBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { RadialProgress } from "@/components/shared/RadialProgress";
import { Collapsible } from "@/components/shared/Collapsible";
import { Modal } from "@/components/shared/Modal";
import { DependencyEditor } from "@/components/shared/DependencyEditor";
import { DependencyTypeBadge } from "@/components/shared/DependencyTypeBadge";
import { LeverForm, type LeverFormValues } from "@/components/shared/LeverForm";
import { ActionForm, type ActionFormValues } from "@/components/shared/ActionForm";
import { ActionKanban } from "@/components/shared/ActionKanban";
import { ActionGantt } from "@/components/shared/charts/ActionGantt";
import { JCurveChart } from "@/components/shared/charts/JCurveChart";
import { consolidateLeverFromActions, leverJCurve, leverPayback } from "@/lib/leverConsolidate";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import type { ActionStatus, Company, LeverAction, RecognitionMode } from "@/types";

const TABS = ["overview", "plan", "impact", "collab"] as const;
type Tab = (typeof TABS)[number];
function tabLabels(t: (key: string, fallback?: string) => string): Record<Tab, string> {
  return {
    overview: "Overview",
    plan: t("leverDetail.tab.plan", "Plan d'action"),
    impact: "Impact",
    collab: t("leverDetail.tab.collab", "Collaboration"),
  };
}

type CascadeProposal = CascadeResult & { checked: Record<string, boolean> };

export default function LeverDetailClient() {
  const { t } = useTranslation();
  const { user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);
  const [actionPlanEnabled, setActionPlanEnabled] = useState(true);
  const [roleClearance, setRoleClearance] = useState<Company["roleClearance"]>();
  const [defaultRecognition, setDefaultRecognition] = useState<RecognitionMode>("smoothing");
  const [riskThresholds, setRiskThresholds] = useState<Company["riskThresholds"]>();
  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      const company = companies.find((c) => c.id === user?.companyId);
      setRoleClearance(company?.roleClearance);
      setActionPlanEnabled(company?.actionPlanEnabled ?? true);
      setDefaultRecognition(company?.defaultRecognition ?? "smoothing");
      setRiskThresholds(company?.riskThresholds);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId, user?.role, user?.confidentialityClearance]);
  const lifecycle = useLifecycleLabels(user?.companyId);
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const { showToast } = useToast();
  const requestedTab = searchParams.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(requestedTab ?? "overview");
  const [comment, setComment] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [actionModal, setActionModal] = useState<{
    mode: "create" | "edit";
    action?: LeverAction;
  } | null>(null);
  const [actionView, setActionView] = useState<"kanban" | "gantt">("kanban");
  const [cascadeProposal, setCascadeProposal] = useState<CascadeProposal | null>(null);
  const [depsModalOpen, setDepsModalOpen] = useState(false);

  const lever = data.getLeverById(id);
  useEffect(() => {
    if (requestedTab) setTab(requestedTab);
  }, [requestedTab, searchParams]);
  const allDependencyAlerts = useMemo(() => engine.dependencyAlerts(data), [data]);
  const alerts = useMemo(() => generateAlerts(data), [data]);

  // J-Curve + consolidation — hooks doivent être avant tout return conditionnel
  const jCurveData = useMemo(
    () => (lever ? leverJCurve(lever, data.program.fyStart, data.program.fyEnd) : []),
    [lever, data.program.fyStart, data.program.fyEnd]
  );
  const paybackMonth = useMemo(() => leverPayback(jCurveData), [jCurveData]);
  const consolidatedKPIs = useMemo(
    () => (lever ? consolidateLeverFromActions(lever) : undefined),
    [lever]
  );

  if (!lever) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-white p-10 text-center text-secondary">
        {t("leverDetail.notFound", "Levier introuvable.")}{" "}
        <button
          onClick={() => router.push("/levers")}
          className="font-medium text-bp-coral hover:underline"
        >
          {t("leverDetail.backToPipeline", "Retour au pipeline")}
        </button>
      </div>
    );
  }

  const canView = canUserViewLever(user, lever, roleClearance);

  if (!canView) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-white p-10 text-center text-secondary">
        {t(
          "leverDetail.restrictedAccess",
          "Accès restreint — ce levier est classé « {level} », un niveau de confidentialité auquel votre profil n'est pas habilité."
        ).replace("{level}", lever.confidentialityLevel ?? "")}{" "}
        <button
          onClick={() => router.push("/levers")}
          className="font-medium text-bp-coral hover:underline"
        >
          {t("leverDetail.backToPipeline", "Retour au pipeline")}
        </button>
      </div>
    );
  }

  const ws = data.workstreams.find((w) => w.id === lever.ws);
  const real = engine.realizedSavings(lever);
  const realFte = engine.realizedFte(lever);
  const comments = data.getComments(lever.id);
  const actions = lever.actions ?? [];
  const hasAnyActions = actions.length > 0;
  const actionScope = { leverId: lever.id };

  // Alertes de dépendance liées à ce levier (dans les deux sens)
  const localIds = new Set([lever.id]);
  const leverAlerts = allDependencyAlerts.filter(
    (a) => localIds.has(a.sourceId) || localIds.has(a.targetId)
  );

  // Qui dépend de ce levier (recherche inverse)
  const dependents = [
    ...data.levers
      .filter((l) => l.dependencies.some((d) => d.targetId === lever.id))
      .map((l) => ({
        id: l.id,
        name: l.name,
        type: l.dependencies.find((d) => d.targetId === lever.id)!.type,
      })),
  ];

  /** Vérifie si un décalage de date implique d'autres leviers. Ils sont uniquement alertés :
   * leurs dates ne bougent jamais automatiquement. */
  const checkCascade = (entityId: string, oldEnd: string, newEnd: string) => {
    const result = engine.computeCascadeShift(entityId, oldEnd, newEnd, data);
    if (result.shifts.length > 0 || result.impactedLevers.length > 0) {
      setCascadeProposal({
        ...result,
        checked: Object.fromEntries(result.shifts.map((s) => [s.id, true])),
      });
    }
  };

  return (
    <div className="animate-fade-up">
      <button
        onClick={() => router.push("/levers")}
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary hover:underline"
      >
        <ArrowLeft size={13} /> Retour au pipeline
      </button>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] text-tertiary">{lever.code}</div>
          <h1 className="mt-0.5 text-xl font-bold text-primary">{lever.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {lever.status === "cancelled" && (
            <StageBadge status="cancelled" label={lifecycle.label("cancelled")} />
          )}
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil size={13} /> {t("leverDetail.editLever", "Modifier le levier")}
          </Button>
        </div>
      </div>

      {/* Stepper du cycle de vie — clic pour changer d'étape (la dernière étape "delivered" est
          atteinte automatiquement à 100 % du plan d'action, non cliquable). Les étapes et leurs
          libellés viennent du référentiel de l'entreprise (`useLifecycleLabels`). */}
      {lever.status !== "cancelled" && (
        <div className="mb-4 rounded-lg border border-border bg-white px-4 py-3">
          {/* min-w-0 sur les conteneurs flex-1 : sans lui, le min-width automatique des items flex
              se cale sur la largeur du texte non coupé ("DÉCISION DE LANCEMENT"...) et force un
              débordement horizontal à 375px. Avec min-w-0, le texte peut s'enrouler sur plusieurs
              lignes et toute la barre reste 100% verticale, sans swipe latéral. */}
          <div className="flex flex-wrap items-center gap-1 sm:flex-nowrap">
            {lifecycle.activeCycle.map((s, i) => {
              const isCurrent = lever.status === s;
              const isPast = STATUS_ORDER[lever.status] > STATUS_ORDER[s];
              const isAuto = s === "delivered";
              return (
                <div
                  key={s}
                  className="flex min-w-0 flex-1 basis-[30%] items-center gap-1 sm:basis-auto"
                >
                  <button
                    onClick={() => {
                      if (isAuto || isCurrent) return;
                      data.updateLever(lever.id, { status: s });
                      showToast(
                        t("leverDetail.statusUpdated", "Niveau mis à jour"),
                        `${lever.name} : ${lifecycle.shortLabel(s)}`,
                        "success"
                      );
                    }}
                    disabled={isAuto}
                    title={
                      isAuto
                        ? t(
                            "leverDetail.autoStageHint",
                            "Cette étape est atteinte automatiquement quand le plan d'action est à 100 %"
                          )
                        : t("leverDetail.moveToStage", "Passer en « {stage} »").replace(
                            "{stage}",
                            lifecycle.shortLabel(s)
                          )
                    }
                    className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md border px-2 py-2 transition ${
                      isCurrent
                        ? "border-bp-coral bg-black text-white"
                        : isPast
                          ? "border-rag-green bg-rag-green-light text-rag-green-dark"
                          : "border-border bg-neutral-50 text-secondary"
                    } ${isAuto ? "cursor-not-allowed opacity-80" : "hover:border-black"}`}
                  >
                    <span className="text-[13px] font-bold">{i + 1}</span>
                    <span className="w-full text-center text-[10px] font-semibold uppercase tracking-wide">
                      {lifecycle.shortLabel(s)}
                    </span>
                  </button>
                  {i < lifecycle.activeCycle.length - 1 && (
                    <ArrowRight size={12} className="hidden shrink-0 text-tertiary sm:block" />
                  )}
                </div>
              );
            })}
          </div>
          {hasAnyActions && STATUS_ORDER[lever.status] < STATUS_ORDER.in_progress && (
            <div className="mt-2.5 flex items-center justify-between gap-3 rounded-md bg-info-blue-light px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs text-info-blue">
                <Info size={13} />{" "}
                {t(
                  "leverDetail.actionsPlannedHint",
                  "Des actions sont planifiées sur ce levier — il peut passer en « {stage} »."
                ).replace("{stage}", lifecycle.shortLabel("in_progress"))}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  data.updateLever(lever.id, { status: "in_progress" });
                  showToast(
                    t("leverDetail.statusUpdated", "Niveau mis à jour"),
                    `${lever.name} : ${lifecycle.shortLabel("in_progress")}`,
                    "success"
                  );
                }}
              >
                {t("leverDetail.moveToStage", "Passer en « {stage} »").replace(
                  "{stage}",
                  lifecycle.shortLabel("in_progress")
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      <Modal
        open={editOpen}
        onOpenChange={setEditOpen}
        title={t("leverDetail.editLever", "Modifier le levier")}
        maxWidth="760px"
      >
        <LeverForm
          data={data}
          lifecycle={lifecycle}
          companyId={user?.companyId}
          initialValues={lever}
          submitLabel={t("leverDetail.saveChanges", "Enregistrer les modifications")}
          onCancel={() => setEditOpen(false)}
          onSubmit={(values: LeverFormValues) => {
            const oldEnd = lever.end;
            data.updateLever(lever.id, values);
            setEditOpen(false);
            showToast(t("leverForm.updated", "Levier mis à jour"), lever.name, "success");
            if (values.end > oldEnd) checkCascade(lever.id, oldEnd, values.end);
          }}
        />
      </Modal>

      <Modal
        open={actionModal !== null}
        onOpenChange={(open) => !open && setActionModal(null)}
        title={
          actionModal?.mode === "edit"
            ? t("leverDetail.editAction", "Modifier l'action")
            : t("leverDetail.newAction", "Nouvelle action")
        }
        maxWidth="min(1400px, 96vw)"
      >
        {actionModal && (
          <ActionForm
            data={data}
            companyDefaultRecognition={defaultRecognition}
            initialValues={actionModal.action}
            submitLabel={
              actionModal.mode === "edit"
                ? t("common.save", "Enregistrer")
                : t("leverDetail.createAction", "Créer l'action")
            }
            onCancel={() => setActionModal(null)}
            onDelete={
              actionModal.action
                ? () => {
                    data.deleteAction(actionScope, actionModal.action!.id);
                    setActionModal(null);
                    showToast(t("leverDetail.actionDeleted", "Action supprimée"), "", "success");
                  }
                : undefined
            }
            onSubmit={(values: ActionFormValues) => {
              if (actionModal.action) {
                data.updateAction(actionScope, actionModal.action.id, values);
              } else {
                data.createAction(actionScope, values);
              }
              setActionModal(null);
              showToast(
                actionModal.action
                  ? t("leverDetail.actionUpdated", "Action mise à jour")
                  : t("leverDetail.actionCreated", "Action créée"),
                values.name,
                "success"
              );

              // Une action qui dépasse la date de fin du levier étend cette dernière et déclenche
              // les alertes sur les leviers dépendants si nécessaire.
              if (values.end > lever.end) {
                data.updateLever(lever.id, { end: values.end });
                checkCascade(lever.id, lever.end, values.end);
              }
            }}
          />
        )}
      </Modal>

      <Modal
        open={depsModalOpen}
        onOpenChange={setDepsModalOpen}
        title={t("leverDetail.manageDependenciesTitle", "Gérer les dépendances du levier")}
        maxWidth="560px"
        footer={
          <Button variant="primary" onClick={() => setDepsModalOpen(false)}>
            {t("leverDetail.finished", "Terminé")}
          </Button>
        }
      >
        <p className="mb-3 text-xs text-secondary">
          {t(
            "leverDetail.depsHint",
            "Les dépendances sont suivies et alertées, mais les dates des leviers ne sont jamais modifiées automatiquement en cas de retard."
          )}
        </p>
        <DependencyEditor
          data={data}
          value={lever.dependencies}
          onChange={(next) => data.updateLever(lever.id, { dependencies: next })}
          excludeIds={[lever.id]}
        />
      </Modal>

      <Modal
        open={cascadeProposal !== null}
        onOpenChange={(open) => !open && setCascadeProposal(null)}
        title={t("leverDetail.cascadeTitle", "Impact du retard sur les dépendances")}
        maxWidth="560px"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCascadeProposal(null)}>
              {t("leverDetail.noShift", "Ne rien décaler")}
            </Button>
            {(cascadeProposal?.shifts.length ?? 0) > 0 && (
              <Button
                variant="primary"
                onClick={() => {
                  const selected = cascadeProposal!.shifts.filter(
                    (s) => cascadeProposal!.checked[s.id]
                  );
                  if (selected.length > 0) {
                    data.applyCascadeShift(selected);
                    showToast(
                      t("leverDetail.shiftApplied", "Décalage appliqué"),
                      t("leverDetail.itemsRescheduled", "{n} élément(s) redaté(s)").replace(
                        "{n}",
                        String(selected.length)
                      ),
                      "success"
                    );
                  }
                  setCascadeProposal(null);
                }}
              >
                {t("leverDetail.shiftSelection", "Décaler la sélection ({n})").replace(
                  "{n}",
                  String(
                    cascadeProposal
                      ? cascadeProposal.shifts.filter((s) => cascadeProposal.checked[s.id]).length
                      : 0
                  )
                )}
              </Button>
            )}
          </>
        }
      >
        {(cascadeProposal?.shifts.length ?? 0) > 0 && (
          <>
            <p className="mb-2 text-[13px] font-semibold text-primary">
              {t("leverDetail.proposedShifts", "Décalages proposés")}
            </p>
            <p className="mb-3 text-xs text-secondary">
              {t(
                "leverDetail.checkToReschedule",
                "Cochez ceux à redater du même nombre de jours. Rien n'est appliqué sans votre confirmation."
              )}
            </p>
            <div className="space-y-2">
              {cascadeProposal?.shifts.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-neutral-50 p-2.5 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={cascadeProposal.checked[s.id] ?? false}
                    onChange={(e) =>
                      setCascadeProposal({
                        ...cascadeProposal,
                        checked: { ...cascadeProposal.checked, [s.id]: e.target.checked },
                      })
                    }
                    className="mt-0.5 accent-[#FF3C47]"
                  />
                  <span>
                    <span className="font-semibold text-primary">{s.name}</span>
                    <span className="mt-1 block text-tertiary">
                      {s.oldStart} → {s.oldEnd}{" "}
                      <span className="mx-1 font-semibold text-primary">
                        {t("leverDetail.becomes", "devient")}
                      </span>{" "}
                      {s.newStart} → {s.newEnd}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
        {(cascadeProposal?.impactedLevers.length ?? 0) > 0 && (
          <>
            <p className="mb-2 mt-4 flex items-center gap-1.5 text-[13px] font-semibold text-primary">
              <TriangleAlert size={14} className="text-rag-amber" />{" "}
              {t("leverDetail.impactedLevers", "Leviers impactés — alerte seule")}
            </p>
            <p className="mb-3 text-xs text-secondary">
              {t(
                "leverDetail.impactedLeversHint",
                "Ces leviers dépendent de l'élément retardé. Leurs dates ne sont jamais modifiées automatiquement : rapprochez-vous de leur owner."
              )}
            </p>
            <div className="space-y-1.5">
              {cascadeProposal?.impactedLevers.map((l) => (
                <button
                  key={l.id}
                  onClick={() => {
                    setCascadeProposal(null);
                    router.push(`/levers/detail?id=${l.id}`);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-rag-amber-light bg-rag-amber-light/40 px-2.5 py-2 text-left text-xs hover:border-rag-amber"
                >
                  <span className="font-semibold text-primary">
                    {l.id} · {l.name}
                  </span>
                  <DependencyTypeBadge type={l.dependencyType} />
                </button>
              ))}
            </div>
          </>
        )}
      </Modal>

      <div className="mb-4 flex snap-x flex-nowrap gap-0 overflow-x-auto rounded-t-lg border-b-[1.5px] border-border bg-white px-4">
        {TABS.map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`-mb-[1.5px] border-b-[2.5px] px-4 py-3 text-[12.5px] font-semibold transition ${
              tab === tabKey
                ? "border-bp-coral text-primary"
                : "border-transparent text-secondary hover:text-primary"
            }`}
          >
            {tabLabels(t)[tabKey]}
            {tabKey === "collab" && ` (${comments.length})`}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <Card>
          <CardBody>
            {/* ── 1. Bandeau exécutif ─────────────────────────────────────── */}
            <div className="mb-6 flex flex-wrap items-center gap-6 rounded-lg border border-border bg-neutral-50 p-4">
              <RadialProgress
                pct={lever.progress}
                size={140}
                strokeWidth={12}
                label={t("leverDetail.progressLabel", "Progression")}
              />
              <div className="flex flex-1 flex-wrap gap-x-8 gap-y-4">
                <BigStat
                  label={t("leverDetail.realizedToDate", "Réalisé à date")}
                  value={engine.fmtCurr(real)}
                  accent
                />
                <BigStat
                  label={t("leverDetail.lockedPlan", "Plan initial (figé à « {stage} »)").replace(
                    "{stage}",
                    lifecycle.label("validated")
                  )}
                  value={lever.lockedPlan ? engine.fmtCurr(lever.lockedPlan.netSavings) : "—"}
                />
                <BigStat
                  label={t("leverDetail.plannedReforecast", "Planifié (réactualisé)")}
                  value={lever.reforecast ? engine.fmtCurr(lever.reforecast.netSavings) : "—"}
                />
                <BigStat
                  label={t("leverDetail.netSavingsTarget", "Net savings visé")}
                  value={engine.fmtCurr(lever.netSavings)}
                />
                <BigStat
                  label={t("levers.columnMaturity", "Maturité")}
                  value={<StageBadge status={lever.status} label={lifecycle.label(lever.status)} />}
                />
                <BigStat
                  label={t("leverForm.risk", "Risque")}
                  value={
                    <StatusBadge risk={engine.computeLeverRisk(lever.id, alerts, riskThresholds)} />
                  }
                />
              </div>
            </div>

            {/* ── 2. Description (remontée avant les blocs identité) ──────── */}
            <Collapsible title={t("leverDetail.descriptionTitle", "Description")}>
              <p className="mb-2 text-[13px] leading-relaxed text-secondary">{lever.description}</p>
            </Collapsible>

            {/* ── 3. Identité ─────────────────────────────────────────────── */}
            <Collapsible title={t("leverDetail.identityTitle", "Identité")}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <OverviewField label={t("leverDetail.codeLabel", "Code")}>
                  <span className="font-mono text-[13px] text-primary">{lever.code}</span>
                </OverviewField>
                <OverviewField label="Type">{lever.type}</OverviewField>
                <OverviewField label="Workstream">
                  <span className="font-medium" style={{ color: ws?.color }}>
                    {ws?.name}
                  </span>
                </OverviewField>
                <OverviewField label="Owner">
                  <span className="inline-flex items-center gap-2">
                    <Avatar initials={lever.ownerInit} /> {lever.owner}
                  </span>
                </OverviewField>
                <OverviewField label="Sponsor">
                  <span className="inline-flex items-center gap-2">
                    <Avatar initials={lever.sponsorInit} /> {lever.sponsor}
                  </span>
                </OverviewField>
              </div>
            </Collapsible>

            {/* ── 4. Périmètre ─────────────────────────────────────────────── */}
            <Collapsible title={t("leverDetail.scopeTitle", "Périmètre")}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <OverviewField label={t("leverForm.geography", "Région")}>
                  {lever.geography} · {lever.country}
                </OverviewField>
                <OverviewField label={t("dashboard.function", "Fonction")}>
                  {lever.function}
                </OverviewField>
                <OverviewField label={t("leverDetail.legalEntity", "Entité légale")}>
                  {lever.entity}
                </OverviewField>
                <OverviewField
                  label={t("leverDetail.impactedCostCenters", "Centres de coût impactés")}
                >
                  <span className="text-[12px] text-secondary">
                    {Array.from(
                      new Set(
                        actions
                          .flatMap((action) => action.impacts ?? [])
                          .map((impact) => impact.costCenter)
                          .filter((value): value is string => !!value)
                      )
                    ).join(" · ") || lever.costCenter}
                  </span>
                </OverviewField>
              </div>
            </Collapsible>

            {/* ── 5. Planning ─────────────────────────────────────────────── */}
            <Collapsible title={t("leverDetail.planningTitle", "Planning")}>
              <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-primary">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-neutral-50 px-3 py-1">
                  <span className="text-tertiary">{t("leverDetail.start", "Début")}</span>
                  <span className="font-medium">{lever.start}</span>
                  <span className="text-tertiary">→ {t("leverDetail.end", "Fin")}</span>
                  <span className="font-medium">{lever.end}</span>
                </span>
                <span className="text-tertiary">·</span>
                <span className="text-tertiary">
                  {t("leverDetail.updatedOn", "Mis à jour le")}{" "}
                  <span className="font-medium text-primary">{lever.lastUpdate}</span>
                </span>
              </div>
            </Collapsible>

            {/* ── Courbe en J + Gantt des actions (si le levier a des actions avec impacts) ── */}
            {(lever.actions ?? []).some((a) => (a.impacts ?? []).length > 0) && (
              <Collapsible
                title={t("leverDetail.jcurveTimelineTitle", "Courbe en J & Timeline des actions")}
              >
                <JCurveChart
                  data={jCurveData}
                  paybackMonth={paybackMonth}
                  labelPlan={t("chart.pnl.plan", "Plan")}
                  labelReforecast={t("dashboard.kpi.reforecast", "Reforecast")}
                  labelActual={t("levers.realized", "Réalisé")}
                />
                {(lever.actions ?? []).length > 0 && (
                  <>
                    <SectionTitle>{t("lever.actionTimeline", "Timeline des actions")}</SectionTitle>
                    <ActionGantt
                      actions={lever.actions ?? []}
                      onActionClick={(action) => setActionModal({ mode: "edit", action })}
                      defaultRecognition={defaultRecognition}
                    />
                  </>
                )}
                {consolidatedKPIs && (
                  <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-neutral-50 p-3 sm:grid-cols-3 lg:grid-cols-5">
                    <div className="text-center">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-secondary">
                        {t("lever.grossGain", "Gain brut")}
                      </div>
                      <div className="mt-0.5 text-[15px] font-bold text-primary">
                        {engine.fmtCurr(consolidatedKPIs.grossSavings ?? 0)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-secondary">
                        {t("lever.totalCost", "Coût total")}
                      </div>
                      <div className="mt-0.5 text-[15px] font-bold text-bp-coral">
                        {engine.fmtCurr(
                          (consolidatedKPIs.capex ?? 0) +
                            (consolidatedKPIs.opexOneOff ?? 0) +
                            (consolidatedKPIs.opexRec ?? 0)
                        )}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-secondary">
                        {t("lever.netGain", "Gain net")}
                      </div>
                      <div className="mt-0.5 text-[15px] font-bold text-rag-green-dark">
                        {engine.fmtCurr(consolidatedKPIs.netSavings ?? 0)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-secondary">
                        ROI
                      </div>
                      <div className="mt-0.5 text-[15px] font-bold text-primary">
                        {(() => {
                          const totalCosts =
                            (consolidatedKPIs.capex ?? 0) +
                            (consolidatedKPIs.opexOneOff ?? 0) +
                            (consolidatedKPIs.opexRec ?? 0);
                          return totalCosts > 0
                            ? `${((consolidatedKPIs.grossSavings ?? 0) / totalCosts).toFixed(1)}x`
                            : "—";
                        })()}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-secondary">
                        {t("lever.payback", "Payback")}
                      </div>
                      <div className="mt-0.5 text-[15px] font-bold text-primary">
                        {paybackMonth ?? "—"}
                      </div>
                    </div>
                  </div>
                )}
              </Collapsible>
            )}

            <Collapsible
              title={
                <span className="inline-flex items-center gap-1.5">
                  <Link2 size={13} /> {t("leverDetail.dependenciesTitle", "Dépendances")}
                  {leverAlerts.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rag-red-light px-2 py-0.5 text-[10px] font-bold normal-case text-rag-red">
                      <TriangleAlert size={10} />{" "}
                      {t("alerts.count", "{n} alerte(s)").replace(
                        "{n}",
                        String(leverAlerts.length)
                      )}
                    </span>
                  )}
                </span>
              }
            >
              <div className="mb-2 flex justify-end">
                <button
                  onClick={() => setDepsModalOpen(true)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-bp-coral hover:underline"
                >
                  <Pencil size={11} />{" "}
                  {t("leverDetail.manageDependencies", "Gérer les dépendances")}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                    {t("leverDetail.dependsOn", "Ce levier dépend de")}
                  </div>
                  {lever.dependencies.length === 0 && (
                    <p className="text-xs text-tertiary">
                      {t("leverDetail.noUpstreamDep", "Aucune dépendance amont.")}
                    </p>
                  )}
                  {lever.dependencies.map((d) => {
                    const target = data.levers.find((l) => l.id === d.targetId);
                    const alert = leverAlerts.find(
                      (a) => a.sourceId === lever.id && a.targetId === d.targetId
                    );
                    return (
                      <button
                        key={d.targetId}
                        onClick={() => {
                          router.push(`/levers/detail?id=${d.targetId}`);
                        }}
                        title={alert ? alert.message : DEPENDENCY_TYPE_DESCRIPTION[d.type]}
                        className={`mb-1.5 flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition hover:border-black ${
                          alert
                            ? "border-rag-red-light bg-rag-red-light/40"
                            : "border-border bg-neutral-50"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold text-primary">
                            {d.targetId} · {target?.name ?? "?"}
                          </span>
                          {target && (
                            <span className="mt-0.5 block text-[10.5px] text-tertiary">
                              {target.start} → {target.end}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {alert && <TriangleAlert size={13} className="text-rag-red" />}
                          <DependencyTypeBadge type={d.type} />
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div>
                  <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                    {t("leverDetail.dependsOnThis", "Dépendent de ce levier")}
                  </div>
                  {dependents.length === 0 && (
                    <p className="text-xs text-tertiary">
                      {t("leverDetail.noDownstreamDep", "Aucun levier ne dépend de celui-ci.")}
                    </p>
                  )}
                  {dependents.map((dep) => (
                    <button
                      key={dep.id}
                      onClick={() => router.push(`/levers/detail?id=${dep.id}`)}
                      className="mb-1.5 flex w-full items-center justify-between gap-2 rounded-md border border-border bg-neutral-50 px-2.5 py-2 text-left text-xs transition hover:border-black"
                    >
                      <span className="font-semibold text-primary">
                        {dep.id} · {dep.name}
                      </span>
                      <DependencyTypeBadge type={dep.type} />
                    </button>
                  ))}
                </div>
              </div>
              {leverAlerts.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {leverAlerts.map((a, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-md border border-rag-red-light bg-rag-red-light/30 px-2.5 py-2 text-xs text-primary"
                    >
                      <TriangleAlert size={13} className="mt-0.5 shrink-0 text-rag-red" />
                      <span className="flex flex-wrap items-center gap-1">
                        <strong>{a.sourceName}</strong> <DependencyTypeBadge type={a.type} />
                        <span>— {a.message}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Collapsible>
          </CardBody>
        </Card>
      )}

      {tab === "plan" && !actionPlanEnabled && (
        <Card>
          <CardBody>
            <div className="rounded-lg border border-dashed border-border bg-bg-surface p-10 text-center text-secondary">
              {t(
                "leverDetail.actionPlanDisabled",
                "Module non activé — le Plan d'action a été désactivé pour votre entreprise (paramétrable dans Admin > Entreprises)."
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {tab === "plan" && actionPlanEnabled && (
        <Card>
          <CardBody>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-[13px] font-semibold text-primary">
                {t("leverDetail.actionPlanTitle", "Plan d'action — {name}").replace(
                  "{name}",
                  lever.name
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex overflow-hidden rounded-md border border-border">
                  <button
                    onClick={() => setActionView("kanban")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${actionView === "kanban" ? "bg-black text-white" : "bg-white text-secondary"}`}
                  >
                    <LayoutGrid size={13} /> Kanban
                  </button>
                  <button
                    onClick={() => setActionView("gantt")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${actionView === "gantt" ? "bg-black text-white" : "bg-white text-secondary"}`}
                  >
                    <BarChart3 size={13} /> Gantt
                  </button>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setActionModal({ mode: "create" })}
                >
                  <Plus size={12} /> Action
                </Button>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-4 rounded-md border border-border bg-neutral-50 px-3 py-2 text-xs">
              <span className="font-semibold text-primary">
                {t("leverDetail.actionsCount", "{n} action(s)").replace(
                  "{n}",
                  String(actions.length)
                )}
              </span>
              <span className="text-secondary">
                {t("leverDetail.todo", "À faire")} :{" "}
                {actions.filter((a) => a.status === "todo").length}
              </span>
              <span className="text-info-blue">
                {t("leverDetail.inProgress", "En cours")} :{" "}
                {actions.filter((a) => a.status === "in_progress").length}
              </span>
              <span className="text-rag-green-dark">
                {t("leverDetail.completed", "Fait")} :{" "}
                {actions.filter((a) => a.status === "done").length}
              </span>
              <span className="text-rag-red">
                {t("leverDetail.late", "En retard")} :{" "}
                {actions.filter((a) => a.status === "delayed").length}
              </span>
              <span className="ml-auto font-bold text-primary">
                {t("leverDetail.percentOfPlan", "{pct}% du plan").replace(
                  "{pct}",
                  String(engine.actionProgress(actions))
                )}
              </span>
            </div>

            {actionView === "kanban" ? (
              <ActionKanban
                actions={actions}
                onCardClick={(action) => setActionModal({ mode: "edit", action })}
                onStatusChange={(actionId, status: ActionStatus) =>
                  data.updateAction(actionScope, actionId, { status })
                }
              />
            ) : (
              <ActionGantt
                actions={actions}
                onActionClick={(action) => setActionModal({ mode: "edit", action })}
                defaultRecognition={defaultRecognition}
              />
            )}

            <p className="mt-4 flex items-start gap-1.5 text-[11px] text-tertiary">
              <Info size={12} className="mt-px shrink-0" />
              {t(
                "leverDetail.delayActionHint",
                "Repousser la date de fin d'une action peut retarder ce plan : l'outil alertera les leviers dépendants sans modifier automatiquement leurs dates."
              )}
            </p>
          </CardBody>
        </Card>
      )}

      {tab === "impact" && (
        <Card>
          <CardBody>
            <SectionTitle first>
              {t("leverDetail.financialImpactTitle", "Impact financier")}
            </SectionTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Stat
                label={t(
                  "leverDetail.lockedPlanNet",
                  "Plan initial (net, figé à « {stage} »)"
                ).replace("{stage}", lifecycle.label("validated"))}
                accent
              >
                {lever.lockedPlan ? engine.fmtCurr(lever.lockedPlan.netSavings) : "—"}
              </Stat>
              <Stat label={t("leverDetail.realizedToDateEuro", "Réalisé à date (€)")}>
                {engine.fmtCurr(real)}
              </Stat>
              <Stat label={t("leverDetail.reforecastNet", "Réactualisé (net)")}>
                {lever.reforecast ? engine.fmtCurr(lever.reforecast.netSavings) : "—"}
              </Stat>
              <Stat label="CAPEX">{engine.fmtCurr(consolidatedKPIs?.capex ?? lever.capex)}</Stat>
              <Stat label="One-off">
                {engine.fmtCurr(consolidatedKPIs?.opexOneOff ?? lever.opexOneOff)}
              </Stat>
              <Stat label={t("leverDetail.opexRecYear", "OPEX récurrent /an")}>
                {engine.fmtCurr(consolidatedKPIs?.opexRec ?? lever.opexRec)}
              </Stat>
            </div>

            <SectionTitle>
              {t("leverDetail.impactsByActionTitle", "Impacts par action")}
            </SectionTitle>
            <ActionImpactTable
              actions={actions}
              fallbackPnlMap={lever.pnlMap}
              fallbackCostCenter={lever.costCenter}
              fallbackEntity={lever.entity}
              pnlAccountName={(pnlId) =>
                data.pnlAccounts.find((p) => p.id === pnlId)?.name ?? pnlId
              }
            />

            <SectionTitle>{t("leverDetail.hrImpactTitle", "Impact RH")}</SectionTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Stat label={t("leverForm.fteImpact", "Impact estimé (ETP)")}>
                {(consolidatedKPIs?.fteImpact ?? lever.fteImpact) > 0
                  ? `+${consolidatedKPIs?.fteImpact ?? lever.fteImpact}`
                  : (consolidatedKPIs?.fteImpact ?? lever.fteImpact)}
              </Stat>
              <Stat label={t("leverDetail.realizedToDateFte", "Réalisé à date (ETP)")}>
                {realFte > 0 ? `+${realFte}` : realFte}
              </Stat>
              <Stat label={t("leverForm.popImpacted", "Population impactée")}>
                {lever.popImpacted}
              </Stat>
            </div>
          </CardBody>
        </Card>
      )}

      {tab === "collab" && (
        <Card>
          <CardBody>
            {comments.length === 0 && (
              <p className="py-6 text-center text-xs text-tertiary">
                {t("leverDetail.noComments", "Aucun commentaire pour le moment")}
              </p>
            )}
            {comments.map((c, i) => (
              <div key={i} className="border-b border-border py-2.5 last:border-b-0">
                <div className="flex items-center justify-between">
                  <strong className="text-xs">{c.user}</strong>
                  <span className="text-[11px] text-tertiary">{c.ts}</span>
                </div>
                <div className="mt-1 text-[13px] text-primary">{c.text}</div>
              </div>
            ))}
            <div className="mt-3.5">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t("leverDetail.addCommentPlaceholder", "Ajouter un commentaire...")}
                rows={2}
                className="w-full rounded-sm border border-border px-3 py-2 text-xs focus:border-black focus:outline-none"
              />
              <Button
                variant="primary"
                size="sm"
                className="mt-2"
                disabled={!user}
                onClick={() => {
                  if (!comment.trim() || !user) return;
                  data.addComment(lever.id, comment, user);
                  setComment("");
                  showToast(t("leverDetail.commentAdded", "Commentaire ajouté"), "", "success");
                }}
              >
                <Send size={12} /> {t("leverDetail.send", "Envoyer")}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function ActionImpactTable({
  actions,
  fallbackPnlMap,
  fallbackCostCenter,
  fallbackEntity,
  pnlAccountName,
}: {
  actions: LeverAction[];
  fallbackPnlMap: string;
  fallbackCostCenter: string;
  fallbackEntity: string;
  pnlAccountName: (id: string) => string;
}) {
  const { t } = useTranslation();
  type Row = {
    id: string;
    actionName: string;
    label: string;
    type: string;
    nature: string;
    amount: number;
    fte: number;
    pnlName: string;
    costCenter: string;
    entity: string;
  };
  const rows: Row[] = actions.flatMap((action) =>
    (action.impacts ?? []).map((impact) => ({
      id: `${action.id}-${impact.id}`,
      actionName: action.name,
      label: impact.label,
      type: impact.type === "saving" ? t("action.saving", "Gain") : t("action.cost", "Coût"),
      nature:
        impact.type === "saving"
          ? impact.nature === "opex_rec"
            ? t("leverDetail.impactTable.recurrent", "Récurrent")
            : "One-off"
          : impact.nature === "opex_rec"
            ? t("leverDetail.impactTable.opexRec", "OPEX récurrent")
            : impact.nature === "capex"
              ? "CAPEX"
              : "One-off",
      amount: impact.amount,
      fte: impact.fteCount ?? 0,
      pnlName: pnlAccountName(impact.pnlMap || fallbackPnlMap),
      costCenter: impact.costCenter || fallbackCostCenter,
      entity: impact.entity || fallbackEntity,
    }))
  );

  const columns: ColumnDef<Row>[] = [
    { key: "actionName", label: "Action", render: (r) => <strong>{r.actionName}</strong> },
    { key: "label", label: "Impact" },
    { key: "type", label: "Type" },
    { key: "nature", label: t("leverDetail.impactTable.nature", "Nature") },
    { key: "pnlName", label: t("leverDetail.impactTable.pnlAccount", "Compte P&L") },
    { key: "costCenter", label: t("leverForm.costCenter", "Centre de coût") },
    { key: "entity", label: t("leverDetail.impactTable.entityPnl", "Entité (P&L)") },
    {
      key: "amount",
      label: t("leverDetail.impactTable.amount", "Montant €M"),
      align: "right",
      render: (r) => r.amount.toFixed(2),
    },
    { key: "fte", label: "ETP", align: "right" },
  ];

  return (
    <EditableTable
      data={rows}
      columns={columns}
      showTotalsRow
      totalsConfig={{
        amount: (list) => list.reduce((sum, row) => sum + row.amount, 0).toFixed(2),
        fte: (list) => list.reduce((sum, row) => sum + row.fte, 0),
      }}
    />
  );
}

function SectionTitle({ children, first = false }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div
      className={`border-b-[1.5px] border-bp-coral pb-1.5 text-[11px] font-bold uppercase tracking-wide text-secondary ${first ? "mt-0" : "mt-6"} mb-2.5`}
    >
      {children}
    </div>
  );
}

function Stat({
  label,
  children,
  accent = false,
}: {
  label: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
        {label}
      </div>
      <div
        className={`mt-1 text-sm font-semibold ${accent ? "text-primary underline decoration-bp-coral decoration-2 underline-offset-4" : "text-primary"}`}
      >
        {children}
      </div>
    </div>
  );
}

function BigStat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
        {label}
      </div>
      <div
        className={`mt-1 text-xl font-bold ${accent ? "text-primary underline decoration-bp-coral decoration-2 underline-offset-4" : "text-primary"}`}
      >
        {value}
      </div>
    </div>
  );
}

/** Champ label/valeur allégé pour l'onglet Overview — même métrique typographique que Stat
 *  mais sans souligné coral (réservé aux valeurs clés du bandeau). */
function OverviewField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
        {label}
      </div>
      <div className="mt-1 text-[13px] text-primary">{children}</div>
    </div>
  );
}
