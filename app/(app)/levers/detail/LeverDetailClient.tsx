"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { subscribeCompanies } from "@/lib/firestore/admin";
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
  Settings,
  TriangleAlert,
} from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import { useLifecycleLabels } from "@/lib/hooks/useLifecycleLabels";
import * as engine from "@/lib/engine";
import type { CascadeResult } from "@/lib/engine";
import {
  DEPENDENCY_TYPE_DESCRIPTION,
  DEPENDENCY_TYPE_LABEL,
  STATUS_ORDER,
} from "@/lib/status-config";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { Avatar } from "@/components/shared/Avatar";
import { StageBadge } from "@/components/shared/StageBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { RadialProgress } from "@/components/shared/RadialProgress";
import { Modal } from "@/components/shared/Modal";
import { DependencyEditor } from "@/components/shared/DependencyEditor";
import { LeverForm, type LeverFormValues } from "@/components/shared/LeverForm";
import { SubLeverForm, type SubLeverFormValues } from "@/components/shared/SubLeverForm";
import { ActionForm, type ActionFormValues } from "@/components/shared/ActionForm";
import { ActionKanban } from "@/components/shared/ActionKanban";
import { ActionGantt } from "@/components/shared/ActionGantt";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import type { ActionStatus, LeverAction, SubLever } from "@/types";

const TABS = ["overview", "plan", "impact", "collab"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  plan: "Plan d'action",
  impact: "Impact",
  collab: "Collaboration",
};

type CascadeProposal = CascadeResult & { checked: Record<string, boolean> };

export default function LeverDetailClient() {
  const { role, user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);
  const [roleClearance, setRoleClearance] = useState<string[]>([]);
  const [actionPlanEnabled, setActionPlanEnabled] = useState(true);
  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      const company = companies.find((c) => c.id === user?.companyId);
      setRoleClearance((user && company?.roleClearance?.[user.role]) ?? []);
      setActionPlanEnabled(company?.actionPlanEnabled ?? true);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId, user?.role]);
  const lifecycle = useLifecycleLabels(user?.companyId);
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [comment, setComment] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [subLeverModal, setSubLeverModal] = useState<{
    mode: "create" | "edit";
    sub?: SubLever;
  } | null>(null);
  const [actionModal, setActionModal] = useState<{
    mode: "create" | "edit";
    action?: LeverAction;
  } | null>(null);
  const [activeSubLeverId, setActiveSubLeverId] = useState<string | null>(null);
  const [actionView, setActionView] = useState<"kanban" | "gantt">("kanban");
  const [cascadeProposal, setCascadeProposal] = useState<CascadeProposal | null>(null);
  const [depsModalOpen, setDepsModalOpen] = useState(false);

  const lever = data.getLeverById(id);
  const allDependencyAlerts = useMemo(() => engine.dependencyAlerts(data), [data]);

  if (!lever) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-white p-10 text-center text-secondary">
        Levier introuvable.{" "}
        <button
          onClick={() => router.push("/levers")}
          className="font-medium text-bp-coral hover:underline"
        >
          Retour au pipeline
        </button>
      </div>
    );
  }

  const canView =
    !lever.confidentialityLevel ||
    role === "admin" ||
    role === "admin_entreprise" ||
    roleClearance.includes(lever.confidentialityLevel);

  if (!canView) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-white p-10 text-center text-secondary">
        Accès restreint — ce levier est classé « {lever.confidentialityLevel} », un niveau de
        confidentialité auquel votre profil n&apos;est pas habilité.{" "}
        <button
          onClick={() => router.push("/levers")}
          className="font-medium text-bp-coral hover:underline"
        >
          Retour au pipeline
        </button>
      </div>
    );
  }

  const ws = data.workstreams.find((w) => w.id === lever.ws);
  const real = engine.realizedSavings(lever, data);
  const realFte = engine.realizedFte(lever);
  const comments = data.getComments(lever.id);
  const subLevers = data.getSubLeversForLever(lever.id);
  const hasSubLevers = subLevers.length > 0;
  const activeSubLever = hasSubLevers
    ? (subLevers.find((s) => s.id === activeSubLeverId) ?? subLevers[0])
    : undefined;
  const actions = activeSubLever ? activeSubLever.actions : (lever.actions ?? []);
  const hasAnyActions =
    (lever.actions?.length ?? 0) > 0 || subLevers.some((s) => s.actions.length > 0);
  const actionScope = activeSubLever
    ? { leverId: lever.id, subLeverId: activeSubLever.id }
    : { leverId: lever.id };

  // Alertes de dépendance liées à ce levier et ses sous-leviers (dans les deux sens)
  const localIds = new Set([lever.id, ...subLevers.map((s) => s.id)]);
  const leverAlerts = allDependencyAlerts.filter(
    (a) => localIds.has(a.sourceId) || localIds.has(a.targetId)
  );

  // Qui dépend de ce levier (recherche inverse, leviers et sous-leviers confondus)
  const dependents = [
    ...data.levers
      .filter((l) => l.dependencies.some((d) => d.targetId === lever.id))
      .map((l) => ({
        id: l.id,
        name: l.name,
        type: l.dependencies.find((d) => d.targetId === lever.id)!.type,
      })),
    ...data.subLevers
      .filter((s) => s.leverId !== lever.id && s.dependencies.some((d) => d.targetId === lever.id))
      .map((s) => ({
        id: s.id,
        name: `${s.name} (sous-levier)`,
        type: s.dependencies.find((d) => d.targetId === lever.id)!.type,
      })),
  ];

  /** Vérifie si un décalage de date en implique d'autres : les sous-leviers dépendants reçoivent
   * une proposition de décalage (à confirmer, sélective), les leviers dépendants sont uniquement
   * alertés — leurs dates ne bougent jamais automatiquement. */
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
            <Pencil size={13} /> Modifier le levier
          </Button>
        </div>
      </div>

      {/* Stepper du cycle de vie — clic pour changer d'étape (la dernière étape "delivered" est
          atteinte automatiquement à 100 % du plan d'action, non cliquable). Les étapes et leurs
          libellés viennent du référentiel de l'entreprise (`useLifecycleLabels`). */}
      {lever.status !== "cancelled" && (
        <div className="mb-4 rounded-lg border border-border bg-white px-4 py-3">
          <div className="flex items-center gap-1">
            {lifecycle.activeCycle.map((s, i) => {
              const isCurrent = lever.status === s;
              const isPast = STATUS_ORDER[lever.status] > STATUS_ORDER[s];
              const isAuto = s === "delivered";
              return (
                <div key={s} className="flex flex-1 items-center gap-1">
                  <button
                    onClick={() => {
                      if (isAuto || isCurrent) return;
                      data.updateLever(lever.id, { status: s });
                      showToast(
                        "Niveau mis à jour",
                        `${lever.name} : ${lifecycle.shortLabel(s)}`,
                        "success"
                      );
                    }}
                    disabled={isAuto}
                    title={
                      isAuto
                        ? "Cette étape est atteinte automatiquement quand le plan d'action est à 100 %"
                        : `Passer en « ${lifecycle.shortLabel(s)} »`
                    }
                    className={`flex flex-1 flex-col items-center gap-1 rounded-md border px-2 py-2 transition ${
                      isCurrent
                        ? "border-bp-coral bg-black text-white"
                        : isPast
                          ? "border-rag-green bg-rag-green-light text-rag-green-dark"
                          : "border-border bg-neutral-50 text-secondary"
                    } ${isAuto ? "cursor-not-allowed opacity-80" : "hover:border-black"}`}
                  >
                    <span className="text-[13px] font-bold">{i + 1}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide">
                      {lifecycle.shortLabel(s)}
                    </span>
                  </button>
                  {i < lifecycle.activeCycle.length - 1 && (
                    <ArrowRight size={12} className="shrink-0 text-tertiary" />
                  )}
                </div>
              );
            })}
          </div>
          {hasAnyActions && STATUS_ORDER[lever.status] < STATUS_ORDER.in_progress && (
            <div className="mt-2.5 flex items-center justify-between gap-3 rounded-md bg-info-blue-light px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs text-info-blue">
                <Info size={13} /> Des actions sont planifiées sur ce levier — il peut passer en «{" "}
                {lifecycle.shortLabel("in_progress")} ».
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  data.updateLever(lever.id, { status: "in_progress" });
                  showToast(
                    "Niveau mis à jour",
                    `${lever.name} : ${lifecycle.shortLabel("in_progress")}`,
                    "success"
                  );
                }}
              >
                Passer en « {lifecycle.shortLabel("in_progress")} »
              </Button>
            </div>
          )}
        </div>
      )}

      <Modal open={editOpen} onOpenChange={setEditOpen} title="Modifier le levier" maxWidth="760px">
        <LeverForm
          data={data}
          lifecycle={lifecycle}
          companyId={user?.companyId}
          initialValues={lever}
          submitLabel="Enregistrer les modifications"
          onCancel={() => setEditOpen(false)}
          onSubmit={(values: LeverFormValues) => {
            const oldEnd = lever.end;
            data.updateLever(lever.id, values);
            setEditOpen(false);
            showToast("Levier mis à jour", lever.name, "success");
            if (!hasSubLevers && values.end > oldEnd) checkCascade(lever.id, oldEnd, values.end);
          }}
        />
      </Modal>

      <Modal
        open={subLeverModal !== null}
        onOpenChange={(open) => !open && setSubLeverModal(null)}
        title={subLeverModal?.mode === "edit" ? "Modifier le sous-levier" : "Nouveau sous-levier"}
        maxWidth="700px"
      >
        {subLeverModal && (
          <SubLeverForm
            data={data}
            lifecycle={lifecycle}
            leverId={lever.id}
            excludeSubLeverId={subLeverModal.sub?.id}
            initialValues={subLeverModal.sub}
            submitLabel={subLeverModal.mode === "edit" ? "Enregistrer" : "Créer le sous-levier"}
            onCancel={() => setSubLeverModal(null)}
            onDelete={
              subLeverModal.sub
                ? () => {
                    data.deleteSubLever(subLeverModal.sub!.id);
                    setSubLeverModal(null);
                    showToast("Sous-levier supprimé", "", "success");
                  }
                : undefined
            }
            onSubmit={(values: SubLeverFormValues) => {
              const before = subLeverModal.sub;
              if (before) {
                data.updateSubLever(before.id, values);
                if (values.end > before.end) checkCascade(before.id, before.end, values.end);
              } else {
                data.createSubLever(values);
              }
              setSubLeverModal(null);
              showToast(
                before ? "Sous-levier mis à jour" : "Sous-levier créé",
                values.name,
                "success"
              );
            }}
          />
        )}
      </Modal>

      <Modal
        open={actionModal !== null}
        onOpenChange={(open) => !open && setActionModal(null)}
        title={actionModal?.mode === "edit" ? "Modifier l'action" : "Nouvelle action"}
        maxWidth="480px"
      >
        {actionModal && (
          <ActionForm
            initialValues={actionModal.action}
            submitLabel={actionModal.mode === "edit" ? "Enregistrer" : "Créer l'action"}
            onCancel={() => setActionModal(null)}
            onDelete={
              actionModal.action
                ? () => {
                    data.deleteAction(actionScope, actionModal.action!.id);
                    setActionModal(null);
                    showToast("Action supprimée", "", "success");
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
                actionModal.action ? "Action mise à jour" : "Action créée",
                values.name,
                "success"
              );

              // Une action qui dépasse la date de fin de son sous-levier/levier étend cette
              // dernière — et déclenche la cascade sur les dépendants si nécessaire.
              const scopeEntity = activeSubLever ?? lever;
              if (values.end > scopeEntity.end) {
                if (activeSubLever) data.updateSubLever(activeSubLever.id, { end: values.end });
                else data.updateLever(lever.id, { end: values.end });
                checkCascade(scopeEntity.id, scopeEntity.end, values.end);
              }
            }}
          />
        )}
      </Modal>

      <Modal
        open={depsModalOpen}
        onOpenChange={setDepsModalOpen}
        title="Gérer les dépendances du levier"
        maxWidth="560px"
        footer={
          <Button variant="primary" onClick={() => setDepsModalOpen(false)}>
            Terminé
          </Button>
        }
      >
        <p className="mb-3 text-xs text-secondary">
          Les dépendances sont suivies et alertées, mais les dates des leviers ne sont jamais
          modifiées automatiquement en cas de retard.
        </p>
        <DependencyEditor
          data={data}
          value={lever.dependencies}
          onChange={(next) => data.updateLever(lever.id, { dependencies: next })}
          excludeIds={[lever.id, ...subLevers.map((s) => s.id)]}
        />
      </Modal>

      <Modal
        open={cascadeProposal !== null}
        onOpenChange={(open) => !open && setCascadeProposal(null)}
        title="Impact du retard sur les dépendances"
        maxWidth="560px"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCascadeProposal(null)}>
              Ne rien décaler
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
                      "Décalage appliqué",
                      `${selected.length} sous-levier(s) redaté(s)`,
                      "success"
                    );
                  }
                  setCascadeProposal(null);
                }}
              >
                Décaler la sélection (
                {cascadeProposal
                  ? cascadeProposal.shifts.filter((s) => cascadeProposal.checked[s.id]).length
                  : 0}
                )
              </Button>
            )}
          </>
        }
      >
        {(cascadeProposal?.shifts.length ?? 0) > 0 && (
          <>
            <p className="mb-2 text-[13px] font-semibold text-primary">
              Décalages proposés — sous-leviers dépendants
            </p>
            <p className="mb-3 text-xs text-secondary">
              Cochez ceux à redater du même nombre de jours. Rien n&apos;est appliqué sans votre
              confirmation.
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
                      <span className="mx-1 font-semibold text-primary">devient</span> {s.newStart}{" "}
                      → {s.newEnd}
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
              <TriangleAlert size={14} className="text-rag-amber" /> Leviers impactés — alerte seule
            </p>
            <p className="mb-3 text-xs text-secondary">
              Ces leviers dépendent de l&apos;élément retardé. Leurs dates ne sont{" "}
              <strong>jamais modifiées automatiquement</strong> : rapprochez-vous de leur owner.
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
                  <span className="text-tertiary">{DEPENDENCY_TYPE_LABEL[l.dependencyType]}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </Modal>

      <div className="mb-4 flex gap-0 rounded-t-lg border-b-[1.5px] border-border bg-white px-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-[1.5px] border-b-[2.5px] px-4 py-3 text-[12.5px] font-semibold transition ${
              tab === t
                ? "border-bp-coral text-primary"
                : "border-transparent text-secondary hover:text-primary"
            }`}
          >
            {TAB_LABELS[t]}
            {t === "collab" && ` (${comments.length})`}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <Card>
          <CardBody>
            <div className="mb-6 flex flex-wrap items-center gap-6 rounded-lg border border-border bg-neutral-50 p-4">
              <RadialProgress
                pct={lever.progress}
                size={140}
                strokeWidth={12}
                label={hasSubLevers ? "Global (sous-leviers)" : "Progression"}
              />
              <div className="flex flex-1 flex-wrap gap-x-8 gap-y-4">
                <BigStat label="Réalisé à date" value={engine.fmtCurr(real)} accent />
                <BigStat label="Net savings visé" value={engine.fmtCurr(lever.netSavings)} />
                <BigStat
                  label="Niveau"
                  value={<StageBadge status={lever.status} label={lifecycle.label(lever.status)} />}
                />
                <BigStat label="Risque" value={<StatusBadge risk={lever.risk} />} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Code">
                <span className="font-mono text-[13px]">{lever.code}</span>
              </Stat>
              <Stat label="Type de levier">{lever.type}</Stat>
              <Stat label="Workstream">
                <span style={{ color: ws?.color }}>{ws?.name}</span>
              </Stat>
              <Stat label="Owner">
                <Avatar initials={lever.ownerInit} /> {lever.owner}
              </Stat>
              <Stat label="Sponsor">
                <Avatar initials={lever.sponsorInit} /> {lever.sponsor}
              </Stat>
              <Stat label="Status">
                <StageBadge status={lever.status} label={lifecycle.label(lever.status)} />
              </Stat>
              <Stat label="Géographie">
                {lever.geography} · {lever.country}
              </Stat>
              <Stat label="Function / Entité">
                {lever.function} · {lever.entity}
              </Stat>
              <Stat label={hasSubLevers ? "Postes de dépense impactés" : "Centre de coût"}>
                {hasSubLevers ? (
                  <span className="flex flex-wrap gap-1">
                    {subLevers.map((s) => (
                      <span
                        key={s.id}
                        className="rounded-full bg-neutral-100 px-2 py-0.5 font-mono text-[11px] text-secondary"
                      >
                        {s.expensePost}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="font-mono text-[13px]">{lever.costCenter}</span>
                )}
              </Stat>
              <Stat label="Priorité">
                <StatusBadge risk={lever.priority} />
              </Stat>
              <Stat label="Risque">
                <StatusBadge risk={lever.risk} />
              </Stat>
              <Stat label="Date de départ">{lever.start}</Stat>
              <Stat label="Date de fin estimée">{lever.end}</Stat>
              <Stat label="Dernière mise à jour">{lever.lastUpdate}</Stat>
            </div>
            <SectionTitle>Description</SectionTitle>
            <p className="text-[13px] text-secondary">{lever.description}</p>

            <div className="mt-6 flex items-center justify-between border-b-[1.5px] border-bp-coral pb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-secondary">
                Sous-leviers
              </span>
              <button
                onClick={() => setSubLeverModal({ mode: "create" })}
                className="inline-flex items-center gap-1 text-xs font-semibold text-bp-coral hover:underline"
              >
                <Plus size={12} /> Ajouter un sous-levier
              </button>
            </div>
            {!hasSubLevers && (
              <p className="mt-2.5 text-[13px] text-secondary">
                Ce levier a un impact sur un centre de coût unique ({lever.costCenter}) — pas de
                sous-levier nécessaire.
              </p>
            )}
            {hasSubLevers && (
              <div className="mt-4 flex flex-col items-center">
                {/* Nœud racine — le levier lui-même */}
                <div className="rounded-md border-2 border-bp-coral bg-white px-4 py-2 text-center shadow-sm">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-tertiary">
                    {lever.code}
                  </div>
                  <div className="text-xs font-bold text-primary">{lever.name}</div>
                </div>
                <div className="h-6 w-px bg-neutral-300" />
                {/* Branches vers chaque sous-levier */}
                <div className="flex w-full items-start justify-center gap-4">
                  {subLevers.map((s, i) => (
                    <div key={s.id} className="relative flex-1 pt-5" style={{ maxWidth: 220 }}>
                      {i > 0 && <div className="absolute left-0 top-0 h-px w-1/2 bg-neutral-300" />}
                      {i < subLevers.length - 1 && (
                        <div className="absolute right-0 top-0 h-px w-1/2 bg-neutral-300" />
                      )}
                      <div className="absolute left-1/2 top-0 h-5 w-px -translate-x-1/2 bg-neutral-300" />
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setActiveSubLeverId(s.id);
                          setTab("plan");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            setActiveSubLeverId(s.id);
                            setTab("plan");
                          }
                        }}
                        title="Voir le plan d'action de ce sous-levier"
                        className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-border bg-white p-3 text-center transition hover:border-black hover:shadow-md"
                      >
                        <div className="flex w-full items-center justify-between gap-1">
                          <StageBadge status={s.status} label={lifecycle.label(s.status)} />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSubLeverModal({ mode: "edit", sub: s });
                            }}
                            title="Paramètres du sous-levier"
                            className="rounded-full p-1 text-tertiary transition hover:bg-neutral-100 hover:text-primary hover:underline"
                          >
                            <Settings size={13} />
                          </button>
                        </div>
                        <RadialProgress
                          pct={engine.subLeverProgress(s)}
                          size={64}
                          strokeWidth={6}
                        />
                        <span className="text-xs font-semibold text-primary">{s.name}</span>
                        <span className="text-[10.5px] text-tertiary">
                          {s.expensePost} · {s.businessUnit}
                        </span>
                        <span className="text-xs font-bold text-primary">
                          {engine.fmtCurr(s.netSavings)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 flex items-center justify-between border-b-[1.5px] border-bp-coral pb-1.5">
              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-secondary">
                <Link2 size={13} /> Dépendances
                {leverAlerts.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rag-red-light px-2 py-0.5 text-[10px] font-bold normal-case text-rag-red">
                    <TriangleAlert size={10} /> {leverAlerts.length} alerte(s)
                  </span>
                )}
              </span>
              <button
                onClick={() => setDepsModalOpen(true)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-bp-coral hover:underline"
              >
                <Pencil size={11} /> Gérer les dépendances
              </button>
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-4">
              <div>
                <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                  Ce levier dépend de
                </div>
                {lever.dependencies.length === 0 && (
                  <p className="text-xs text-tertiary">Aucune dépendance amont.</p>
                )}
                {lever.dependencies.map((d) => {
                  const target =
                    data.levers.find((l) => l.id === d.targetId) ??
                    data.subLevers.find((s) => s.id === d.targetId);
                  const alert = leverAlerts.find(
                    (a) => a.sourceId === lever.id && a.targetId === d.targetId
                  );
                  return (
                    <button
                      key={d.targetId}
                      onClick={() => {
                        const leverTarget = data.levers.find((l) => l.id === d.targetId);
                        const subTarget = data.subLevers.find((s) => s.id === d.targetId);
                        router.push(
                          `/levers/detail?id=${leverTarget ? d.targetId : (subTarget?.leverId ?? d.targetId)}`
                        );
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
                        {target && "end" in target && (
                          <span className="mt-0.5 block text-[10.5px] text-tertiary">
                            {target.start} → {target.end}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {alert && <TriangleAlert size={13} className="text-rag-red" />}
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-secondary">
                          {DEPENDENCY_TYPE_LABEL[d.type]}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div>
                <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                  Dépendent de ce levier
                </div>
                {dependents.length === 0 && (
                  <p className="text-xs text-tertiary">Aucun levier ne dépend de celui-ci.</p>
                )}
                {dependents.map((dep) => (
                  <button
                    key={dep.id}
                    onClick={() => {
                      const subTarget = data.subLevers.find((s) => s.id === dep.id);
                      router.push(`/levers/detail?id=${subTarget ? subTarget.leverId : dep.id}`);
                    }}
                    className="mb-1.5 flex w-full items-center justify-between gap-2 rounded-md border border-border bg-neutral-50 px-2.5 py-2 text-left text-xs transition hover:border-black"
                  >
                    <span className="font-semibold text-primary">
                      {dep.id} · {dep.name}
                    </span>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-secondary">
                      {DEPENDENCY_TYPE_LABEL[dep.type]}
                    </span>
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
                    <span>
                      <strong>{a.sourceName}</strong> ({DEPENDENCY_TYPE_LABEL[a.type]}) —{" "}
                      {a.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "plan" && !actionPlanEnabled && (
        <Card>
          <CardBody>
            <div className="rounded-lg border border-dashed border-border bg-bg-surface p-10 text-center text-secondary">
              Module non activé — le Plan d&apos;action a été désactivé pour votre entreprise
              (paramétrable dans Admin &gt; Entreprises).
            </div>
          </CardBody>
        </Card>
      )}

      {tab === "plan" && actionPlanEnabled && (
        <Card>
          <CardBody>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              {hasSubLevers ? (
                <div className="flex flex-wrap gap-1.5">
                  {subLevers.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setActiveSubLeverId(s.id)}
                      title={`Owner : ${s.owner || lever.owner}`}
                      className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-xs font-semibold transition ${
                        activeSubLever?.id === s.id
                          ? "border-bp-coral bg-black text-white"
                          : "border-border bg-white text-secondary hover:border-black"
                      }`}
                    >
                      <Avatar initials={s.ownerInit || lever.ownerInit} size="sm" />
                      {s.name}
                      <span
                        className={`rounded-full px-1.5 py-px text-[10px] font-bold ${
                          activeSubLever?.id === s.id
                            ? "bg-white/20 text-white"
                            : "bg-neutral-100 text-secondary"
                        }`}
                      >
                        {lifecycle.activeCycle.indexOf(s.status) + 1 || "—"}
                      </span>
                      <span
                        className={activeSubLever?.id === s.id ? "text-white/80" : "text-tertiary"}
                      >
                        {engine.subLeverProgress(s)}%
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-[13px] font-semibold text-primary">
                  Plan d&apos;action — {lever.name}
                </div>
              )}
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
                {actions.length} action{actions.length > 1 ? "s" : ""}
              </span>
              <span className="text-secondary">
                À faire : {actions.filter((a) => a.status === "todo").length}
              </span>
              <span className="text-info-blue">
                En cours : {actions.filter((a) => a.status === "in_progress").length}
              </span>
              <span className="text-rag-green-dark">
                Fait : {actions.filter((a) => a.status === "done").length}
              </span>
              <span className="text-rag-red">
                En retard : {actions.filter((a) => a.status === "delayed").length}
              </span>
              <span className="ml-auto font-bold text-primary">
                {engine.actionProgress(actions)}% du plan
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
                onCardClick={(action) => setActionModal({ mode: "edit", action })}
              />
            )}

            <p className="mt-4 flex items-start gap-1.5 text-[11px] text-tertiary">
              <Info size={12} className="mt-px shrink-0" />
              Repousser la date de fin d&apos;une action peut retarder ce plan : l&apos;outil vous
              proposera alors de décaler les sous-leviers dépendants (à confirmer), et alertera les
              leviers dépendants sans toucher à leurs dates.
            </p>
          </CardBody>
        </Card>
      )}

      {tab === "impact" && (
        <Card>
          <CardBody>
            {hasSubLevers ? (
              <>
                <SectionTitle first>Impact financier par sous-levier</SectionTitle>
                <SubLeverImpactTable
                  subLevers={subLevers}
                  fallbackOwner={{ owner: lever.owner, ownerInit: lever.ownerInit }}
                  pnlAccountName={(pnlId) =>
                    data.pnlAccounts.find((p) => p.id === pnlId)?.name ?? pnlId
                  }
                  statusLabel={lifecycle.label}
                />
              </>
            ) : (
              <>
                <SectionTitle first>Impact financier</SectionTitle>
                <div className="grid grid-cols-3 gap-4">
                  <Stat
                    label={`Plan initial (net, figé à « ${lifecycle.label("validated")} »)`}
                    accent
                  >
                    {lever.lockedPlan ? engine.fmtCurr(lever.lockedPlan.netSavings) : "—"}
                  </Stat>
                  <Stat label="Réalisé à date (€)">{engine.fmtCurr(real)}</Stat>
                  <Stat label="Réactualisé (net)">
                    {lever.reforecast ? engine.fmtCurr(lever.reforecast.netSavings) : "—"}
                  </Stat>
                  <Stat label="CAPEX">{engine.fmtCurr(lever.capex)}</Stat>
                  <Stat label="OPEX one-off">{engine.fmtCurr(lever.opexOneOff)}</Stat>
                  <Stat label="OPEX récurrent /an">{engine.fmtCurr(lever.opexRec)}</Stat>
                </div>
                <SectionTitle>Mapping P&L</SectionTitle>
                <p className="text-[13px] text-secondary">
                  Compte impacté :{" "}
                  <strong>
                    {data.pnlAccounts.find((p) => p.id === lever.pnlMap)?.name ?? lever.pnlMap}
                  </strong>
                </p>
                <SectionTitle>Impact RH</SectionTitle>
                <div className="grid grid-cols-3 gap-4">
                  <Stat label="Impact estimé (ETP)">
                    {lever.fteImpact > 0 ? `+${lever.fteImpact}` : lever.fteImpact}
                  </Stat>
                  <Stat label="Réalisé à date (ETP)">{realFte > 0 ? `+${realFte}` : realFte}</Stat>
                  <Stat label="Population impactée">{lever.popImpacted}</Stat>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "collab" && (
        <Card>
          <CardBody>
            {comments.length === 0 && (
              <p className="py-6 text-center text-xs text-tertiary">
                Aucun commentaire pour le moment
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
                placeholder="Ajouter un commentaire..."
                rows={2}
                className="w-full rounded-sm border border-border px-3 py-2 text-xs focus:border-black focus:outline-none"
              />
              <Button
                variant="primary"
                size="sm"
                className="mt-2"
                onClick={() => {
                  if (!comment.trim()) return;
                  data.addComment(lever.id, comment);
                  setComment("");
                  showToast("Commentaire ajouté", "", "success");
                }}
              >
                <Send size={12} /> Envoyer
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function SubLeverImpactTable({
  subLevers,
  fallbackOwner,
  pnlAccountName,
  statusLabel,
}: {
  subLevers: SubLever[];
  fallbackOwner: { owner: string; ownerInit: string };
  pnlAccountName: (id: string) => string;
  statusLabel: (status: SubLever["status"]) => string;
}) {
  type Row = SubLever & { pnlName: string; progressPct: number; ownerName: string };
  const rows: Row[] = subLevers.map((s) => ({
    ...s,
    pnlName: pnlAccountName(s.pnlMap),
    progressPct: engine.subLeverProgress(s),
    ownerName: s.owner || fallbackOwner.owner,
  }));

  const columns: ColumnDef<Row>[] = [
    { key: "name", label: "Sous-levier", render: (r) => <strong>{r.name}</strong> },
    {
      key: "ownerName",
      label: "Owner",
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Avatar initials={r.ownerInit || fallbackOwner.ownerInit} size="sm" /> {r.ownerName}
        </span>
      ),
    },
    { key: "expensePost", label: "Poste de dépense" },
    { key: "businessUnit", label: "BU" },
    { key: "pnlName", label: "Compte P&L" },
    {
      key: "netSavings",
      label: "Net €M",
      align: "right",
      render: (r) => r.netSavings.toFixed(1),
    },
    { key: "capex", label: "CAPEX €M", align: "right", render: (r) => r.capex.toFixed(1) },
    {
      key: "opexOneOff",
      label: "OPEX €M",
      align: "right",
      render: (r) => (r.opexOneOff + r.opexRec).toFixed(1),
    },
    { key: "fteImpact", label: "ETP", align: "right" },
    {
      key: "progressPct",
      label: "Progression",
      render: (r) => <ProgressBar pct={r.progressPct} />,
    },
    {
      key: "status",
      label: "Statut",
      render: (r) => <StageBadge status={r.status} label={statusLabel(r.status)} />,
    },
  ];

  return (
    <EditableTable
      data={rows}
      columns={columns}
      showTotalsRow
      totalsConfig={{
        netSavings: (list) => list.reduce((s, r) => s + r.netSavings, 0).toFixed(1),
        capex: (list) => list.reduce((s, r) => s + r.capex, 0).toFixed(1),
        opexOneOff: (list) => list.reduce((s, r) => s + r.opexOneOff + r.opexRec, 0).toFixed(1),
        fteImpact: (list) => list.reduce((s, r) => s + r.fteImpact, 0),
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
