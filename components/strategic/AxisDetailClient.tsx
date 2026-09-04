"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Pencil, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Modal } from "@/components/shared/Modal";
import { AxisForm, type AxisFormValues } from "@/components/strategic/AxisForm";
import { AxisStageBadge } from "@/components/strategic/AxisStageBadge";
import { ChantierForm, type ChantierFormValues } from "@/components/strategic/ChantierForm";
import { ChantierGantt } from "@/components/strategic/ChantierGantt";
import { IndicatorChart } from "@/components/strategic/IndicatorChart";
import { IndicatorStatusBadge } from "@/components/strategic/IndicatorStatusBadge";
import { IndicatorStatusSummary } from "@/components/strategic/IndicatorStatusSummary";
import {
  chantierDependencyAlerts,
  latestMeasurement,
  resolveIndicatorStatus,
} from "@/lib/axisLogic";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { resolveMaturityStageLabel, useMaturityStages } from "@/lib/hooks/useMaturityStages";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Indicator } from "@/types";

/**
 * Fiche d'identité d'un axe stratégique — servie sur la même route que la fiche levier
 * (`/levers/detail?id=…`, voir le routeur `LeverDetailClient`), l'id étant résolu parmi les axes
 * du programme actif plutôt que parmi les leviers.
 *
 * Quatre blocs, dans cet ordre :
 *  1. compteur d'ensemble des indicateurs de l'axe (`IndicatorStatusSummary`) + alertes de cascade
 *     de dépendance entre chantiers ;
 *  2. Gantt des chantiers (`ChantierGantt`) — PUREMENT NAVIGATIONNEL depuis le round 4 (voir plus
 *     bas) : un clic sur un bloc chantier ou une action navigue vers la fiche chantier dédiée
 *     (`/levers/chantier?id=…`), qui porte désormais tout le détail (round 4, point 9) ;
 *  3. modale "nouveau chantier", qui crée puis navigue vers cette même fiche dédiée ;
 *  4. indicateurs de l'axe EN LECTURE SEULE — macro d'abord, puis groupés par chantier.
 *
 * Round 4 : la pop-up de détail chantier (actions/livrables/RACI/effort/prérequis) a été RETIRÉE
 * d'ici — voir `app/(app)/levers/chantier/ChantierDetailClient.tsx`, qui porte désormais tout ce
 * contenu sur sa propre route (décision PO : format "fiche PERIAL", incompatible avec une modale
 * 720px). Cette fiche d'axe ne garde que ce qui reste au niveau AXE (pas chantier) : en-tête,
 * stepper d'étape, indicateurs, Gantt navigationnel.
 *
 * La lecture seule des indicateurs est une décision de conception explicite (voir plan, section
 * « Page KPI ») : la saisie d'une mesure et la ré-édition de l'objectif/seuil vivent à UN SEUL
 * endroit, la page KPI, pour éviter deux flux de saisie divergents sur la même donnée. Cette page
 * reste une fiche d'identité, comme la fiche levier côté Performance.
 */

export function AxisDetailClient() {
  const { user } = useRole();
  const { activeProgramId } = useActiveProgram();
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const id = searchParams.get("id") ?? "";

  const data = useStrategicData(user?.companyId ?? null, activeProgramId);
  const stages = useMaturityStages(activeProgramId);

  const [editAxisOpen, setEditAxisOpen] = useState(false);
  const [newChantierOpen, setNewChantierOpen] = useState(false);

  const axis = useMemo(() => data.axes.find((a) => a.id === id), [data.axes, id]);
  const axisChantiers = useMemo(
    () => (axis ? data.chantiers.filter((c) => c.axisId === axis.id) : []),
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

  /** Navigation vers la fiche chantier dédiée (round 4, point 9) — l'id d'axe n'est plus nécessaire
   *  en paramètre, le document chantier porte déjà `axisId` (le lien retour de la fiche chantier le
   *  résout). `focusActionId` optionnel : ouverture ciblée sur une action précise, lue par
   *  `ChantierDetailClient` via `?action=…`. */
  const openChantier = (chantierId: string, focusActionId?: string) =>
    router.push(
      focusActionId
        ? `/levers/chantier?id=${chantierId}&action=${focusActionId}`
        : `/levers/chantier?id=${chantierId}`
    );

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
        <button
          onClick={() => router.push("/levers")}
          className="font-medium text-bp-coral hover:underline"
        >
          {t("strategicAxes.back")}
        </button>
      </div>
    );
  }

  const cycle = stages.filter((s) => !s.isTerminal);
  const terminals = stages.filter((s) => s.isTerminal);
  const currentIndex = cycle.findIndex((s) => s.id === axis.stage);

  const setStage = async (stageId: string) => {
    if (stageId === axis.stage) return;
    await data.updateAxis(axis.id, { stage: stageId });
    showToast(
      t("strategicAxes.stageUpdated"),
      `${axis.name} : ${resolveMaturityStageLabel(stageId, stages)}`,
      "success"
    );
  };

  /** Carte d'un indicateur — LECTURE SEULE (voir en-tête de fichier) : graphique, dernière valeur,
   *  badge de statut effectif. Aucun contrôle de saisie ni d'édition d'objectif. */
  const renderIndicator = (indicator: Indicator) => {
    const measures = data.measurements.filter((m) => m.indicatorId === indicator.id);
    const latest = latestMeasurement(indicator.id, data.measurements);
    return (
      <div key={indicator.id} className="rounded-lg border border-border bg-white p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-primary">{indicator.name}</div>
            <div className="mt-0.5 text-[11px] text-tertiary">
              {t("strategicAxes.objective")} : {indicator.objective} ·{" "}
              {t(`strategicAxes.freq.${indicator.frequency}`)}
            </div>
          </div>
          <IndicatorStatusBadge
            status={resolveIndicatorStatus(indicator)}
            label={t(
              resolveIndicatorStatus(indicator) === "at_risk"
                ? "indicatorStatus.atRisk"
                : "indicatorStatus.onTrack"
            )}
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

        <div className="mt-2">
          <IndicatorChart
            measurements={measures}
            objectiveValue={indicator.objectiveValue}
            direction={indicator.direction}
            unit={indicator.unit}
            qualitative={indicator.kind === "qualitative"}
            frequency={indicator.frequency}
            height={160}
            labelValue={t("strategicAxes.chartValue")}
            labelObjective={t("strategicAxes.chartObjective")}
            emptyLabel={t("strategicAxes.chartEmpty")}
            labelViewFull={t("kpi.chart.viewFull")}
            fullHistoryTitle={`${t("kpi.chart.fullHistory")} — ${indicator.name}`}
            labelProgress={t("kpi.chart.progressToTarget")}
          />
        </div>
      </div>
    );
  };

  const macroIndicators = axisIndicators.filter((i) => !i.chantierId);

  return (
    <div className="animate-fade-up">
      <button
        onClick={() => router.push("/levers")}
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
            <AxisStageBadge stageId={axis.stage} stages={stages} />
          </div>
          {axis.description && (
            <p className="mt-1.5 max-w-2xl text-[13px] text-secondary">{axis.description}</p>
          )}
          <div className="mt-1 text-[11px] text-tertiary">
            {t("strategicAxes.owner")} : {axis.owner ?? t("strategicAxes.unassigned")}
          </div>
        </div>
        <Button variant="outline" onClick={() => setEditAxisOpen(true)}>
          <Pencil size={13} /> {t("strategicAxes.editAxis")}
        </Button>
      </div>

      <Modal
        open={editAxisOpen}
        onOpenChange={setEditAxisOpen}
        title={t("strategicAxes.editAxisModalTitle")}
        maxWidth="640px"
      >
        <AxisForm
          initial={axis}
          stages={stages}
          submitLabel={t("common.save")}
          onCancel={() => setEditAxisOpen(false)}
          onSubmit={async (values: AxisFormValues) => {
            await data.updateAxis(axis.id, values);
            setEditAxisOpen(false);
            showToast(t("strategicAxes.axisUpdated"), values.name, "success");
          }}
        />
      </Modal>

      {/* ── Stepper d'étape de maturité ────────────────────────────────────────────────────── */}
      <div className="mb-4 rounded-lg border border-border bg-white px-4 py-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
          {t("axisStage.label")}
        </div>
        {stages.length === 0 ? (
          <p className="text-xs text-tertiary">{t("axisStage.none")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1 sm:flex-nowrap">
              {cycle.map((s, i) => {
                const isCurrent = axis.stage === s.id;
                const isPast = currentIndex > -1 && i < currentIndex;
                return (
                  <div
                    key={s.id}
                    className="flex min-w-0 flex-1 basis-[30%] items-center gap-1 sm:basis-auto"
                  >
                    <button
                      onClick={() => setStage(s.id)}
                      title={s.label}
                      className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md border px-2 py-2 transition hover:border-black ${
                        isCurrent
                          ? "border-bp-coral bg-black text-white"
                          : isPast
                            ? "border-rag-green bg-rag-green-light text-rag-green-dark"
                            : "border-border bg-neutral-50 text-secondary"
                      }`}
                    >
                      <span className="text-[13px] font-bold">{i + 1}</span>
                      <span className="w-full text-center text-[10px] font-semibold uppercase tracking-wide">
                        {s.label}
                      </span>
                    </button>
                    {i < cycle.length - 1 && (
                      <ArrowRight size={12} className="hidden shrink-0 text-tertiary sm:block" />
                    )}
                  </div>
                );
              })}
            </div>
            {terminals.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-tertiary">{t("axisStage.terminal")} :</span>
                {terminals.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStage(s.id)}
                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition hover:border-black ${
                      axis.stage === s.id
                        ? "border-black bg-black text-white"
                        : "border-border bg-white text-secondary"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

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
        }}
        className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
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
            <Button variant="outline" size="sm" onClick={() => setNewChantierOpen(true)}>
              <Plus size={12} /> {t("strategicAxes.newChantier")}
            </Button>
          }
        />
        <CardBody>
          <p className="mb-3 text-[11.5px] text-tertiary">{t("strategicAxes.ganttHint")}</p>
          <ChantierGantt
            chantiers={axisChantiers}
            actions={axisActions}
            allActions={data.chantierActions}
            stages={stages}
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
          initial={{ axisId: axis.id }}
          axes={data.axes}
          stages={stages}
          submitLabel={t("strategicAxes.createChantier")}
          onCancel={() => setNewChantierOpen(false)}
          onSubmit={async (values: ChantierFormValues) => {
            try {
              const created = await data.createChantier(values);
              setNewChantierOpen(false);
              showToast(t("strategicAxes.chantierCreated"), created.name, "success");
              openChantier(created.id);
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
    </div>
  );
}
