"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Pencil, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Modal } from "@/components/shared/Modal";
import { subscribeCompanies } from "@/lib/firestore/admin";
import { AxisForm, type AxisFormValues } from "@/components/strategic/AxisForm";
import { ChantierDetailPanel } from "@/components/strategic/ChantierDetailPanel";
import { ChantierForm, type ChantierFormValues } from "@/components/strategic/ChantierForm";
import { ChantierGantt } from "@/components/strategic/ChantierGantt";
import { IndicatorChart } from "@/components/strategic/IndicatorChart";
import { IndicatorStatusBadge } from "@/components/strategic/IndicatorStatusBadge";
import { IndicatorStatusSummary } from "@/components/strategic/IndicatorStatusSummary";
import {
  chantierDependencyAlerts,
  latestMeasurement,
  latestNumericMeasurement,
  resolveIndicatorStatus,
  resolveUserFullName,
} from "@/lib/axisLogic";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useMaturityStages } from "@/lib/hooks/useMaturityStages";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { isAnyAdmin, isReadOnlyUser } from "@/lib/roleProfiles";
import { useStrategicApprovalsApi } from "@/lib/hooks/useStrategicApprovalsContext";
import { createChantierFlow, newChantierId, pendingApprovals } from "@/lib/strategicApprovalFlows";
import { hierarchyContextFor, type ChantierCreateApprovalPayload } from "@/lib/strategicApprovals";
import {
  canDesignateAxisSponsor,
  chainLabel,
  chantierRights,
  fillTemplate,
  flowOutcomeMessage,
} from "@/lib/strategicFiche";
import { PendingApprovalBadge } from "@/components/strategic/PendingApprovalBadge";
import type { Chantier, Indicator, IndicatorMeasurement } from "@/types";
import { IndicatorMetaLine } from "@/components/strategic/IndicatorMetaLine";
import {
  YearSegmentedControl,
  useYearSelection,
} from "@/components/strategic/YearSegmentedControl";

/**
 * Fiche d'identité d'un axe stratégique — servie sur la même route que la fiche levier
 * (`/levers/detail?id=…`, voir le routeur `LeverDetailClient`), l'id étant résolu parmi les axes
 * du programme actif plutôt que parmi les leviers.
 *
 * Quatre blocs, dans cet ordre :
 *  1. compteur d'ensemble des indicateurs de l'axe (`IndicatorStatusSummary`) + alertes de cascade
 *     de dépendance entre chantiers ;
 *  2. Gantt des chantiers (`ChantierGantt`) — un clic sur un bloc chantier ou une action ouvre le
 *     panneau chantier (`ChantierDetailPanel`, round 6, point 0) directement SUR CETTE PAGE via
 *     `?chantier=`/`&action=`, plutôt qu'une navigation vers une route dédiée — préserve le
 *     contexte de scroll/zoom du Gantt ;
 *  3. modale "nouveau chantier", qui crée puis ouvre ce même panneau ;
 *  4. indicateurs de l'axe EN LECTURE SEULE — macro d'abord, puis groupés par chantier.
 *
 * Round 6 (point 0) : le détail chantier (jalons/critères de succès/effort/RACI/dépendances/
 * actions/timeline/effectifs) vivait jusque-là sur sa propre route (`/levers/chantier?id=…`,
 * round 4) ; il vit désormais dans `components/strategic/ChantierDetailPanel.tsx`, monté ici dans
 * un `Modal` — décision PO explicite : "tout apparaisse dans le kanban, sur une seule page". Cette
 * fiche d'axe ne garde que ce qui reste au niveau AXE (pas chantier) : en-tête, indicateurs, Gantt.
 *
 * La lecture seule des indicateurs est une décision de conception explicite (voir plan, section
 * « Page KPI ») : la saisie d'une mesure et la ré-édition de l'objectif/seuil vivent à UN SEUL
 * endroit, la page KPI, pour éviter deux flux de saisie divergents sur la même donnée. Cette page
 * reste une fiche d'identité, comme la fiche levier côté Performance.
 */

export function AxisDetailClient() {
  const { user } = useRole();
  const { activeProgramId } = useActiveProgram();
  const readOnly = isReadOnlyUser(user, activeProgramId, "strategic");
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const id = searchParams.get("id") ?? "";

  const data = useStrategicData(user?.companyId ?? null, activeProgramId, user);
  const sa = useStrategicApprovalsApi();
  const stages = useMaturityStages(activeProgramId, user?.companyId ?? null);

  // Échelle de confidentialité de l'entreprise — pour le sélecteur des modales d'édition d'axe et
  // de création de chantier ci-dessous (même pattern que `StrategicAxesView.tsx`).
  const [confidentialityLevels, setConfidentialityLevels] = useState<string[]>([]);
  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      const company = companies.find((c) => c.id === user?.companyId);
      setConfidentialityLevels(company?.confidentialityLevels ?? []);
    }, user?.companyId ?? null);
    return unsub;
  }, [user?.companyId]);

  const [editAxisOpen, setEditAxisOpen] = useState(false);
  const [newChantierOpen, setNewChantierOpen] = useState(false);

  const axis = useMemo(() => data.axes.find((a) => a.id === id), [data.axes, id]);
  const axisChantiers = useMemo(
    () => (axis ? data.chantiers.filter((c) => c.axisIds.includes(axis.id)) : []),
    [data.chantiers, axis]
  );
  const chantierIds = useMemo(() => new Set(axisChantiers.map((c) => c.id)), [axisChantiers]);
  const axisActions = useMemo(
    () => data.chantierActions.filter((a) => chantierIds.has(a.chantierId)),
    [data.chantierActions, chantierIds]
  );
  const axisIndicators = useMemo(
    () => (axis ? data.indicators.filter((i) => i.axisId === axis.id) : []),
    [data.indicators, axis]
  );

  // Les dépendances sont évaluées sur TOUT le programme (un chantier de cet axe peut dépendre du
  // chantier d'un autre axe — cas explicitement prévu par le modèle), puis restreintes aux
  // alertes qui touchent un chantier de cet axe, dans un sens ou dans l'autre.
  const alerts = useMemo(() => {
    const all = chantierDependencyAlerts(data.chantiers, data.chantierActions);
    return all.filter((a) => chantierIds.has(a.sourceId) || chantierIds.has(a.targetId));
  }, [data.chantiers, data.chantierActions, chantierIds]);

  /** Panneau chantier (round 6, point 0 — remplace l'ancienne route `/levers/chantier?id=…`) : monté
   *  ICI plutôt que renvoyé vers la page portefeuille, pour ne pas faire perdre à l'utilisateur son
   *  contexte de Gantt (scroll, zoom) sur un aller-retour inutile. Pose `?chantier=`/`&action=` À
   *  CÔTÉ du `?id=` déjà utilisé par cette page pour l'axe — pas de collision de nom possible.
   *  `focusActionId` optionnel : ouverture ciblée sur une action précise. */
  const openChantier = (chantierId: string, focusActionId?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("chantier", chantierId);
    if (focusActionId) params.set("action", focusActionId);
    else params.delete("action");
    router.push(`/levers/detail?${params.toString()}`);
  };

  /** Ferme le panneau chantier — conserve le `?id=` de l'axe (`router.replace` pour ne pas empiler
   *  d'entrée d'historique par simple fermeture). */
  const closeChantierPanel = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("chantier");
    params.delete("action");
    router.replace(`/levers/detail?${params.toString()}`);
  };

  const openChantierId = searchParams.get("chantier");
  const focusActionId = searchParams.get("action") ?? undefined;

  /** Round <n> (RBAC, gating identique au dashboard exécutif) : `axis_sponsor` perd le clic-vers-KPI
   *  pour tout indicateur CHANTIER-SCOPÉ — copie exacte de `isIndicatorPillClickable`
   *  (`StrategicDashboardView.tsx`, ~ligne 299) pour rester cohérent avec le SEUL autre endroit de
   *  l'app qui gate ce même clic. Pas d'export partagé : les deux fichiers construisent déjà leur
   *  propre gate locale à partir de `strategic.strategicRole`/`data.strategicRole` (même hook,
   *  `useStrategicData`), une seule ligne à dupliquer ne justifie pas une extraction. */
  const isAxisSponsor = data.strategicRole === "axis_sponsor";
  const isIndicatorClickable = (indicator: Pick<Indicator, "chantierId">) =>
    !(isAxisSponsor && indicator.chantierId);

  if (data.loading) {
    return (
      <div className="rounded-lg border border-border bg-white p-10 text-center text-sm text-tertiary">
        {t("strategicAxes.loading")}
      </div>
    );
  }

  if (!axis) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-white p-10 text-center text-secondary">
        {t("strategicAxes.notFound")}{" "}
        <button onClick={() => router.back()} className="font-medium text-bp-coral hover:underline">
          {t("strategicAxes.back")}
        </button>
      </div>
    );
  }

  /** Carte d'un indicateur — LECTURE SEULE (voir en-tête de fichier) : graphique, dernière valeur,
   *  badge de statut effectif. Aucun contrôle de saisie ni d'édition d'objectif ici — round <n> :
   *  la carte devient NAVIGABLE (clic → fiche KPI, `/kpi?indicator=<id>`, où vivent seuls la saisie
   *  de mesure et l'édition d'objectif/seuil, voir le doc-comment de tête de fichier), même RBAC que
   *  les puces d'indicateur du dashboard exécutif (`isIndicatorClickable` ci-dessus). Le clic est
   *  posé sur la carte plutôt que dans un `<button>` l'enveloppant : `IndicatorChart` porte son
   *  propre bouton interactif ("voir l'historique complet"), et un `<button>` ne peut pas contenir
   *  un autre `<button>` — la zone graphique stoppe donc explicitement la propagation du clic
   *  (`stopPropagation` ci-dessous) pour que l'ouverture de son historique complet ne déclenche pas
   *  AUSSI une navigation vers la fiche KPI. */
  const renderIndicator = (indicator: Indicator) => (
    <AxisIndicatorCard
      key={indicator.id}
      indicator={indicator}
      measures={data.measurements.filter((m) => m.indicatorId === indicator.id)}
      clickable={isIndicatorClickable(indicator)}
    />
  );

  const macroIndicators = axisIndicators.filter((i) => !i.chantierId);

  // ── Hiérarchie de validation (lib/strategicHierarchy.ts) ────────────────────────────────────
  // Désignations : sponsor d'axe et sponsor de chantier réservés au pilote du plan / admin.
  // Création de chantier : `createChantierFlow` (sponsor d'axe puis pilote), sauf chaîne vide.
  const axisCtx = hierarchyContextFor(
    "chantier_update",
    { type: "axe", id: axis.id, name: axis.name },
    {
      programId: activeProgramId,
      axes: data.axes,
      chantiers: data.chantiers,
      chantierActions: data.chantierActions,
      indicators: data.indicators,
      users: data.users,
    }
  );
  const rightsInput = {
    username: user?.username,
    isAdmin: !!user && isAnyAdmin(user),
    readOnly,
    ctx: axisCtx,
  };
  const canEditAxisOwner = canDesignateAxisSponsor(rightsInput);
  const canEditChantierPilote = chantierRights(rightsInput).canDesignateSponsor;
  const designationTooltip = {
    axisSponsor: t(
      "strategicFiche.rights.axisSponsor",
      "Le sponsor d'axe est désigné par le pilote du plan (ou un administrateur)."
    ),
    chantierSponsor: t(
      "strategicFiche.rights.chantierSponsor",
      "Le sponsor de chantier est désigné par le pilote du plan (ou un administrateur)."
    ),
  };
  const chainJoiner = t("strategicFiche.chain.then", "puis");
  /** Chantier complet (id stable) soumis à `createChantierFlow`. */
  const buildChantier = (values: ChantierFormValues): Chantier => ({
    dependencies: [],
    ...values,
    id: newChantierId(),
    companyId: user?.companyId ?? "",
    programId: activeProgramId ?? "",
    createdAt: new Date().toISOString().slice(0, 10),
    lastUpdate: new Date().toISOString().slice(0, 10),
  });
  const chantierCreatePreview = (values: ChantierFormValues) => {
    if (!sa || values.axisIds.length === 0) return [];
    const chantier = buildChantier(values);
    return sa.previewChain(
      "chantier_create",
      { type: "axe", id: chantier.axisIds[0], name: chantier.name },
      { chantier } satisfies ChantierCreateApprovalPayload
    );
  };
  const pendingChantierCreations = pendingApprovals(sa?.approvals, "chantier_create").filter((a) =>
    (a.payload as ChantierCreateApprovalPayload).chantier?.axisIds?.includes(axis.id)
  );

  return (
    <div className="animate-fade-up">
      <button
        onClick={() => router.back()}
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary hover:underline"
      >
        <ArrowLeft size={13} /> {t("strategicAxes.back")}
      </button>

      {/* ── En-tête ────────────────────────────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: axis.color ?? "var(--bp-warm-taupe)" }}
            />
            <h1 className="text-xl font-bold text-primary">{axis.name}</h1>
          </div>
          {axis.description && (
            <p className="mt-1.5 max-w-2xl text-[13px] text-secondary">{axis.description}</p>
          )}
          <div className="mt-1 text-[11px] text-tertiary">
            {t("strategicAxes.owner")} :{" "}
            {resolveUserFullName(axis.owner, data.users) ?? t("strategicAxes.unassigned")}
          </div>
        </div>
        {!readOnly && (
          <Button variant="outline" onClick={() => setEditAxisOpen(true)}>
            <Pencil size={13} /> {t("strategicAxes.editAxis")}
          </Button>
        )}
      </div>

      <Modal
        open={editAxisOpen}
        onOpenChange={setEditAxisOpen}
        title={t("strategicAxes.editAxisModalTitle")}
        maxWidth="640px"
      >
        <AxisForm
          users={data.users}
          initial={axis}
          stages={stages}
          confidentialityLevels={confidentialityLevels}
          submitLabel={t("common.save")}
          canEditOwner={canEditAxisOwner}
          ownerTooltip={designationTooltip.axisSponsor}
          onCancel={() => setEditAxisOpen(false)}
          onSubmit={async (values: AxisFormValues) => {
            await data.updateAxis(axis.id, values);
            setEditAxisOpen(false);
            showToast(t("strategicAxes.axisUpdated"), values.name, "success");
          }}
        />
      </Modal>

      {/* ── Compteur d'ensemble des indicateurs de l'axe ───────────────────────────────────── */}
      <IndicatorStatusSummary
        indicators={axisIndicators}
        measurements={data.measurements}
        showTotal={false}
        labels={{
          tracked: t("strategicAxes.summaryTracked"),
          onTrack: t("indicatorStatus.onTrack"),
          atRisk: t("indicatorStatus.atRisk"),
          indicatorsSuffix: t("strategicAxes.indicatorsCount"),
          title: t("kpi.summary.title", "Santé des indicateurs"),
          ofIndicators: t("kpi.summary.ofIndicators", "des indicateurs"),
        }}
        className="mb-4"
      />

      {/* ── Alertes de cascade de dépendance entre chantiers ───────────────────────────────── */}
      {alerts.length > 0 && (
        <div className="mb-4 rounded-lg border border-rag-amber bg-rag-amber-light p-3.5">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-rag-amber">
            <TriangleAlert size={14} /> {t("strategicAxes.dependencyAlerts")}
          </div>
          <ul className="space-y-1.5">
            {alerts.map((alert) => (
              <li
                key={`${alert.sourceId}-${alert.targetId}-${alert.type}`}
                className="flex flex-wrap items-center gap-2 text-[12px] text-primary"
              >
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-secondary">
                  {t(`dep.${alert.type.toLowerCase()}`)}
                </span>
                <span>{alert.message}</span>
                <span className="font-semibold">
                  {alert.delayDays} {t("strategicAxes.dependencyDelay")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Gantt des chantiers ────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title={t("strategicAxes.ganttSection")}
          actions={
            !readOnly && (
              <Button variant="outline" size="sm" onClick={() => setNewChantierOpen(true)}>
                <Plus size={12} /> {t("strategicAxes.newChantier")}
              </Button>
            )
          }
        />
        <CardBody>
          <p className="mb-3 text-[11.5px] text-tertiary">{t("strategicAxes.ganttHint")}</p>
          {pendingChantierCreations.map((a) => (
            <div
              key={a.id}
              className="mb-2 flex flex-wrap items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-xs text-text-secondary"
            >
              <span className="font-medium">
                {(a.payload as ChantierCreateApprovalPayload).chantier?.name ?? a.targetName}
              </span>
              <span className="text-[10.5px] italic">
                {t("strategicFiche.pending.chantierCreation", "Création en attente de validation")}
              </span>
              <PendingApprovalBadge approval={a} users={data.users} className="ml-auto" />
            </div>
          ))}
          <ChantierGantt
            chantiers={axisChantiers}
            actions={axisActions}
            allActions={data.chantierActions}
            stages={stages}
            progressOf={data.projetProgress}
            axisColor={axis.color}
            alerts={alerts}
            onChantierClick={(c) => openChantier(c.id)}
            onActionClick={(action, c) => openChantier(c.id, action.id)}
            labels={{
              empty: t("strategicAxes.noChantiers"),
              unplannedTitle: t("strategicAxes.chantierUnplanned"),
              noDates: t("strategicAxes.chantierNoDates"),
              actionsSuffix: t("strategicAxes.actionsSuffix"),
              scale: t("strategicAxes.ganttScale"),
              scaleMonth: t("strategicAxes.ganttScaleMonth"),
              scaleQuarter: t("strategicAxes.ganttScaleQuarter"),
              scaleSemester: t("strategicAxes.ganttScaleSemester"),
              progress: t("strategicAxes.progress"),
              alerted: t("strategicAxes.chantierAlerted"),
              blockedBy: t("strategicChantierDetail.prerequisites.blockedBy"),
              today: t("strategicAxes.ganttToday"),
            }}
          />
        </CardBody>
      </Card>

      <Modal
        open={newChantierOpen}
        onOpenChange={setNewChantierOpen}
        title={t("strategicAxes.newChantierModalTitle")}
        maxWidth="640px"
      >
        <ChantierForm
          initial={{ axisIds: [axis.id] }}
          axes={data.axes}
          stages={stages}
          confidentialityLevels={confidentialityLevels}
          users={data.users}
          submitLabel={t("strategicAxes.createChantier")}
          canEditPilote={canEditChantierPilote}
          piloteTooltip={designationTooltip.chantierSponsor}
          approvalHint={(values) => {
            const chain = chainLabel(chantierCreatePreview(values), data.users, chainJoiner);
            return chain
              ? fillTemplate(t("strategicFiche.chain.preview", "Sera validé par {chain}"), {
                  chain,
                })
              : "";
          }}
          onCancel={() => setNewChantierOpen(false)}
          onSubmit={async (values: ChantierFormValues) => {
            try {
              // Sponsor de chantier non désignable par l'acteur : jamais transmis.
              const { pilote: requestedPilote, ...rest } = values;
              const input: ChantierFormValues =
                canEditChantierPilote && requestedPilote
                  ? { ...rest, pilote: requestedPilote }
                  : rest;
              const preview = chantierCreatePreview(input);
              let createdId: string | undefined;
              const outcome = await createChantierFlow(sa, buildChantier(input), async () => {
                const created = await data.createChantier(input);
                createdId = created.id;
              });
              setNewChantierOpen(false);
              if (outcome === "pending") {
                const message = flowOutcomeMessage(
                  { outcome },
                  data.users,
                  {
                    applied: t("strategicFiche.toast.applied", "Appliqué"),
                    pending: t("strategicFiche.toast.pending", "Envoyé en validation : {chain}"),
                    partial: t("strategicFiche.toast.pending", "Envoyé en validation : {chain}"),
                    joiner: chainJoiner,
                  },
                  preview
                );
                showToast(message ?? "", input.name, "success");
                return;
              }
              showToast(t("strategicAxes.chantierCreated"), input.name, "success");
              if (createdId) openChantier(createdId);
            } catch (error) {
              console.error("[betrack] échec de création du chantier :", error);
              showToast(
                t("strategicAxes.chantierSaveErrorTitle"),
                t("strategicAxes.chantierSaveError"),
                "error"
              );
            }
          }}
        />
      </Modal>

      {/* ── Indicateurs de l'axe (lecture seule) ───────────────────────────────────────────── */}
      <Card>
        <CardHeader title={t("strategicAxes.indicatorsSection")} />
        <CardBody>
          <p className="mb-3 text-[11.5px] text-tertiary">
            {t("strategicAxes.indicatorsReadOnly")}
          </p>

          {axisIndicators.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-tertiary">
              {t("strategicAxes.noIndicators")}
            </p>
          ) : (
            <div className="space-y-5">
              {macroIndicators.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
                    {t("strategicAxes.macroIndicators")}
                  </div>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {macroIndicators.map(renderIndicator)}
                  </div>
                </div>
              )}

              {axisChantiers.map((chantier) => {
                const list = axisIndicators.filter((i) => i.chantierId === chantier.id);
                if (list.length === 0) return null;
                return (
                  <div key={chantier.id}>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
                      {chantier.name}
                    </div>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {list.map(renderIndicator)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Panneau chantier (round 6, point 0) — ouvert depuis le Gantt ci-dessus, monté ICI plutôt
          que sur une route séparée pour préserver le contexte de scroll/zoom du Gantt. ──────────── */}
      <Modal
        open={!!openChantierId}
        onOpenChange={(open) => {
          if (!open) closeChantierPanel();
        }}
        title={
          (openChantierId && data.chantiers.find((c) => c.id === openChantierId)?.name) ??
          t("strategicChantierDetail.title")
        }
        maxWidth="1100px"
      >
        {openChantierId && (
          <ChantierDetailPanel
            chantierId={openChantierId}
            focusActionId={focusActionId}
            onClose={closeChantierPanel}
          />
        )}
      </Modal>
    </div>
  );
}

/** Carte d'un indicateur de la fiche d'axe — LECTURE SEULE, navigable vers la fiche KPI (voir le
 *  doc-comment de `renderIndicator`). Composant à part pour porter son propre état : la sélection
 *  d'année (`YearSegmentedControl`, partagé avec la page KPI), affichée seulement si les mesures
 *  couvrent plusieurs années. Défaut = historique complet (comportement historique de la fiche). */
function AxisIndicatorCard({
  indicator,
  measures,
  clickable,
}: {
  indicator: Indicator;
  /** Mesures DE CET indicateur uniquement. */
  measures: IndicatorMeasurement[];
  clickable: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  // Valeur chiffrée d'abord : un commentaire seul saisi ensuite ne masque pas le dernier chiffre.
  const latest =
    latestNumericMeasurement(indicator.id, measures) ?? latestMeasurement(indicator.id, measures);
  const { year, setYear, options, visible, filtered } = useYearSelection(measures, "all");
  const status = resolveIndicatorStatus(indicator);
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => router.push(`/kpi?indicator=${indicator.id}`) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                router.push(`/kpi?indicator=${indicator.id}`);
              }
            }
          : undefined
      }
      className={`rounded-lg border border-border bg-white p-3.5 transition-colors ${
        clickable ? "cursor-pointer hover:border-black" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-primary">{indicator.name}</div>
          <IndicatorMetaLine indicator={indicator} className="mt-1" />
          <div className="mt-1 text-[11px] text-tertiary">
            {t("strategicAxes.objective")} : {indicator.objective}
          </div>
        </div>
        <IndicatorStatusBadge
          status={status}
          label={t(status === "at_risk" ? "indicatorStatus.atRisk" : "indicatorStatus.onTrack")}
          title={status === "at_risk" ? t("strategicAxes.atRiskTooltip") : undefined}
        />
      </div>

      <div className="mt-2 text-[11px] text-secondary">
        {t("strategicAxes.latestValue")} :{" "}
        <strong className="text-primary">
          {latest?.value !== undefined
            ? `${latest.value}${indicator.unit ? ` ${indicator.unit}` : ""}`
            : (latest?.note ?? t("strategicAxes.noMeasurement"))}
        </strong>
        {latest && <span className="text-tertiary"> · {latest.period}</span>}
      </div>

      {/* Zone interactive (sélecteur d'année + graphique) : ne déclenche pas la navigation. */}
      <div className="mt-2 space-y-2" role="presentation" onClick={(e) => e.stopPropagation()}>
        {visible && <YearSegmentedControl years={options} value={year} onChange={setYear} />}
        <IndicatorChart
          measurements={filtered}
          objectiveValue={indicator.objectiveValue}
          direction={indicator.direction}
          unit={indicator.unit}
          qualitative={indicator.kind === "qualitative"}
          frequency={indicator.frequency}
          height={160}
          windowMeasurements={year === "all" ? "recent" : "all"}
          labelValue={t("strategicAxes.chartValue")}
          labelObjective={t("strategicAxes.chartObjective")}
          emptyLabel={t("strategicAxes.chartEmpty")}
          labelViewFull={t("kpi.chart.viewFull")}
          fullHistoryTitle={`${t("kpi.chart.fullHistory")} — ${indicator.name}`}
          labelProgress={t("kpi.chart.progressToTarget")}
          targetSchedule={indicator.targetSchedule}
          baselineMeasurements={measures}
        />
      </div>
    </div>
  );
}
