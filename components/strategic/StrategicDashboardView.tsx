"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  LayoutGrid,
  Maximize2,
  Plus,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";
import { useRole } from "@/lib/hooks/useRole";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useMaturityStages } from "@/lib/hooks/useMaturityStages";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  chantierDependencyAlerts,
  countOnTrackAtRisk,
  latestMeasurement,
  resolveIndicatorStatus,
} from "@/lib/axisLogic";
import {
  STRATEGIC_DASHBOARD_WIDGET_REGISTRY,
  SPAN_COL_CLASS,
  addWidget,
  buildDefaultLayout,
  cycleSpan,
  getStrategicWidgetDef,
  loadStrategicDashboardLayout,
  moveWidget,
  removeWidget,
  saveStrategicDashboardLayout,
  setWidgetSpan,
  type StrategicDashboardWidgetInstance,
} from "@/lib/strategicDashboardWidgets";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { DependencyTypeBadge } from "@/components/shared/DependencyTypeBadge";
import { ICON_REGISTRY } from "@/components/shared/icon-registry";
import {
  BusinessKpiCards,
  IndicatorStatusSummary,
} from "@/components/strategic/IndicatorStatusSummary";
import { IndicatorStatusBadge } from "@/components/strategic/IndicatorStatusBadge";
import { AxisStageBadge } from "@/components/strategic/AxisStageBadge";

/**
 * Dashboard du PLAN STRATÉGIQUE — pendant de `DashboardPagePerformance.tsx` pour un programme de
 * type "strategic" (le routeur `app/(app)/dashboard/page.tsx` branche l'un ou l'autre selon le
 * programme actif).
 *
 * Même MÉCANIQUE de personnalisation que le dashboard exécutif (mode édition, drag & drop,
 * redimensionnement, ajout/suppression, persistance localStorage) — le PO exige que cette
 * fonctionnalité reste disponible pour le Plan Stratégique — mais sur un registre de widgets
 * DISJOINT (`lib/strategicDashboardWidgets.ts`, clé de stockage propre) : aucune métrique
 * financière ici, donc aucun widget de l'exécutif n'est réutilisable. Le code de la mécanique est
 * volontairement re-écrit plutôt que factorisé avec l'exécutif : ce dernier est la zone la plus
 * sensible de l'app (zéro régression tolérée) et porte en plus un builder générique
 * métrique × dimensions qui n'a pas d'équivalent stratégique.
 *
 * Les alertes de cascade de retard entre chantiers sont mises en évidence (bordure d'accent + tri
 * par retard décroissant) : c'est la fonctionnalité explicitement jugée « super importante » par
 * le PO, elle ne doit pas se noyer dans la grille.
 */
export function StrategicDashboardView() {
  const { user } = useRole();
  const { activeProgram, activeProgramId, programs, loading: programsLoading } = useActiveProgram();
  const { t } = useTranslation();
  const strategic = useStrategicData(user?.companyId ?? null, activeProgramId);
  const stages = useMaturityStages(activeProgramId);

  const { axes, chantiers, chantierActions, indicators, measurements } = strategic;

  // ─── Agrégats (toute la logique de calcul vient de lib/axisLogic.ts) ──────────────────────
  const counts = useMemo(() => countOnTrackAtRisk(indicators), [indicators]);
  const atRiskIndicators = useMemo(
    () => indicators.filter((i) => resolveIndicatorStatus(i) === "at_risk"),
    [indicators]
  );
  const axisNameById = useMemo(() => new Map(axes.map((a) => [a.id, a.name])), [axes]);

  /** Une ligne par axe : volumétrie (chantiers/indicateurs) et part d'indicateurs sur la
   *  trajectoire — la « répartition par axe » demandée au plan. */
  const axisBreakdown = useMemo(
    () =>
      axes
        .map((axis) => {
          const axisIndicators = indicators.filter((i) => i.axisId === axis.id);
          const { total, onTrack, atRisk } = countOnTrackAtRisk(axisIndicators);
          return {
            axis,
            chantierCount: chantiers.filter((c) => c.axisId === axis.id).length,
            total,
            onTrack,
            atRisk,
            onTrackPct: total > 0 ? Math.round((onTrack / total) * 100) : 0,
          };
        })
        .sort((a, b) => b.atRisk - a.atRisk || b.total - a.total),
    [axes, chantiers, indicators]
  );

  /** Nombre d'axes ET de chantiers par étape de maturité, dans l'ordre du référentiel du
   *  programme (`order`). Les entités dont l'étape a été supprimée du référentiel depuis sont
   *  regroupées dans une ligne « étape inconnue » plutôt que d'être perdues du décompte. */
  const maturityBreakdown = useMemo(() => {
    const rows = stages.map((stage) => ({
      stage,
      axisCount: axes.filter((a) => a.stage === stage.id).length,
      chantierCount: chantiers.filter((c) => c.stage === stage.id).length,
    }));
    const knownIds = new Set(stages.map((s) => s.id));
    const orphanAxes = axes.filter((a) => !knownIds.has(a.stage)).length;
    const orphanChantiers = chantiers.filter((c) => !knownIds.has(c.stage)).length;
    return { rows, orphanAxes, orphanChantiers };
  }, [stages, axes, chantiers]);

  const dependencyAlerts = useMemo(
    () =>
      chantierDependencyAlerts(chantiers, chantierActions).sort(
        (a, b) => b.delayDays - a.delayDays
      ),
    [chantiers, chantierActions]
  );

  const summaryLabels = {
    tracked: t("strategicDashboard.tracked"),
    onTrack: t("strategicDashboard.onTrack"),
    atRisk: t("strategicDashboard.atRisk"),
    indicatorsSuffix: t("strategicDashboard.indicatorsSuffix"),
  };

  const businessKpiLabels = {
    empty: t("businessKpis.empty"),
    noValue: t("businessKpis.noValue"),
    objective: t("kpi.objectiveValue"),
    onTrack: t("indicatorStatus.onTrack"),
    atRisk: t("indicatorStatus.atRisk"),
  };

  // ─── Layout personnalisable (même mécanique que le dashboard exécutif) ────────────────────
  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState<StrategicDashboardWidgetInstance[]>(buildDefaultLayout);
  const [dragInstanceId, setDragInstanceId] = useState<string | null>(null);
  const [dragOverInstanceId, setDragOverInstanceId] = useState<string | null>(null);
  const [addPanelOpen, setAddPanelOpen] = useState(false);

  // Chargement APRÈS le premier rendu : `localStorage` n'existe pas au prerender statique
  // (output: "export"), l'état initial doit donc rester le layout par défaut.
  useEffect(() => {
    setLayout(loadStrategicDashboardLayout());
  }, []);

  const updateLayout = (next: StrategicDashboardWidgetInstance[]) => {
    setLayout(next);
    saveStrategicDashboardLayout(next);
  };

  const moveWidgetBy = (instanceId: string, direction: "up" | "down") => {
    const fromIndex = layout.findIndex((w) => w.instanceId === instanceId);
    if (fromIndex === -1) return;
    const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= layout.length) return;
    updateLayout(moveWidget(layout, fromIndex, toIndex));
  };

  const handleDrop = (targetInstanceId: string) => {
    if (dragInstanceId && dragInstanceId !== targetInstanceId) {
      const fromIndex = layout.findIndex((w) => w.instanceId === dragInstanceId);
      const toIndex = layout.findIndex((w) => w.instanceId === targetInstanceId);
      if (fromIndex !== -1 && toIndex !== -1) {
        updateLayout(moveWidget(layout, fromIndex, toIndex));
      }
    }
    setDragInstanceId(null);
    setDragOverInstanceId(null);
  };

  /** Coquille commune : largeur de colonne + barre d'outils du mode édition, sans toucher au
   *  contenu métier du widget. Identique en comportement à celle du dashboard exécutif (poignée
   *  de glisser sur desktop, boutons haut/bas au doigt). */
  const renderWidgetShell = (instance: StrategicDashboardWidgetInstance, children: ReactNode) => {
    const def = getStrategicWidgetDef(instance.type);
    if (!def) return null;
    const isDragOver = editMode && dragOverInstanceId === instance.instanceId;
    return (
      <div
        key={instance.instanceId}
        data-widget-id={instance.instanceId}
        data-widget-title={t(def.label)}
        className={`relative ${SPAN_COL_CLASS[instance.span]} ${
          isDragOver ? "outline outline-2 outline-offset-2 outline-bp-coral" : ""
        }`}
        draggable={editMode}
        onDragStart={() => setDragInstanceId(instance.instanceId)}
        onDragOver={(e) => {
          if (!editMode) return;
          e.preventDefault();
          setDragOverInstanceId(instance.instanceId);
        }}
        onDragLeave={() => {
          if (dragOverInstanceId === instance.instanceId) setDragOverInstanceId(null);
        }}
        onDrop={(e) => {
          if (!editMode) return;
          e.preventDefault();
          handleDrop(instance.instanceId);
        }}
      >
        {editMode && (
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-border-strong bg-white/95 px-1.5 py-1 text-[11px] font-semibold text-secondary shadow-sm">
            <span
              className="hidden cursor-grab px-0.5 text-tertiary active:cursor-grabbing sm:inline-flex"
              title={t("strategicDashboard.dragToReorder")}
            >
              <GripVertical size={14} />
            </span>
            <div className="flex items-center sm:hidden">
              <button
                type="button"
                onClick={() => moveWidgetBy(instance.instanceId, "up")}
                className="rounded p-0.5 text-tertiary hover:bg-neutral-100 hover:text-primary"
                title={t("strategicDashboard.moveUp")}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => moveWidgetBy(instance.instanceId, "down")}
                className="rounded p-0.5 text-tertiary hover:bg-neutral-100 hover:text-primary"
                title={t("strategicDashboard.moveDown")}
              >
                <ChevronDown size={14} />
              </button>
            </div>
            <button
              type="button"
              onClick={() =>
                updateLayout(
                  setWidgetSpan(
                    layout,
                    instance.instanceId,
                    cycleSpan(instance.span, def.allowedSpans)
                  )
                )
              }
              className="hidden items-center gap-1 rounded px-1.5 py-0.5 hover:bg-neutral-100 hover:text-primary sm:flex"
              title={t("strategicDashboard.resizeWidget")}
            >
              <Maximize2 size={12} />
              {instance.span}
            </button>
            <button
              type="button"
              onClick={() => updateLayout(removeWidget(layout, instance.instanceId))}
              className="flex items-center rounded px-1 py-0.5 text-tertiary hover:bg-neutral-100 hover:text-bp-coral"
              title={t("strategicDashboard.removeWidget")}
            >
              <X size={13} />
            </button>
          </div>
        )}
        <div className={editMode ? "pointer-events-none select-none" : ""}>{children}</div>
      </div>
    );
  };

  const emptyLine = (label: string) => (
    <p className="py-6 text-center text-xs text-tertiary">{label}</p>
  );

  const renderWidget = (instance: StrategicDashboardWidgetInstance): ReactNode => {
    switch (instance.type) {
      // ── Compteur global on-track / à risque (carte héro) ──────────────────────────────────
      case "indicator-status":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("strategicDashboard.widget.indicatorStatus")} />
            <CardBody>
              {indicators.length === 0 ? (
                emptyLine(t("strategicDashboard.noIndicators"))
              ) : (
                <IndicatorStatusSummary
                  indicators={indicators}
                  measurements={measurements}
                  showTotal={false}
                  labels={summaryLabels}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                />
              )}
            </CardBody>
          </Card>
        );

      // ── KPI business : indicateurs de niveau axe (remplace l'ancien widget « cumul des
      //    indicateurs », retiré — sommer des indicateurs hétérogènes n'a pas de sens sur un plan
      //    stratégique, contrairement aux économies d'un Plan Performance) ─────────────────────
      case "business-kpis":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("strategicDashboard.widget.businessKpis")} />
            <CardBody>
              <BusinessKpiCards
                indicators={indicators}
                measurements={measurements}
                labels={businessKpiLabels}
                className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              />
            </CardBody>
          </Card>
        );

      // ── Répartition des indicateurs par axe ───────────────────────────────────────────────
      case "axis-breakdown":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("strategicDashboard.widget.axisBreakdown")} />
            <CardBody>
              {axisBreakdown.length === 0
                ? emptyLine(t("strategicDashboard.noAxes"))
                : axisBreakdown.map((row) => (
                    <div
                      key={row.axis.id}
                      className="border-b border-border py-2.5 last:border-0 first:pt-0"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[12.5px] font-semibold text-primary">
                          {row.axis.name}
                        </span>
                        <span className="flex-shrink-0 text-[11px] text-tertiary">
                          {row.chantierCount} {t("strategicDashboard.chantiersSuffix")} ·{" "}
                          {row.total} {t("strategicDashboard.indicatorsSuffix")}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3">
                        <ProgressBar pct={row.onTrackPct} className="flex-1" />
                        {row.atRisk > 0 && (
                          <span className="flex-shrink-0 text-[11px] font-semibold text-rag-amber">
                            {row.atRisk} {t("strategicDashboard.atRisk").toLowerCase()}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
            </CardBody>
          </Card>
        );

      // ── Indicateurs actuellement à risque ─────────────────────────────────────────────────
      case "indicators-at-risk":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t("strategicDashboard.widget.indicatorsAtRisk")}
              actions={
                atRiskIndicators.length > 0 ? (
                  <span className="rounded-full bg-rag-amber-light px-2 py-0.5 text-[10.5px] font-bold text-rag-amber">
                    {atRiskIndicators.length}
                  </span>
                ) : undefined
              }
            />
            <CardBody>
              {atRiskIndicators.length === 0
                ? emptyLine(t("strategicDashboard.noIndicatorsAtRisk"))
                : atRiskIndicators.map((indicator) => {
                    const latest = latestMeasurement(indicator.id, measurements);
                    return (
                      <div
                        key={indicator.id}
                        className="flex items-start justify-between gap-3 border-b border-border py-2.5 last:border-0 first:pt-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[12.5px] font-semibold text-primary">
                            {indicator.name}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-secondary">
                            {axisNameById.get(indicator.axisId) ?? indicator.axisId}
                          </div>
                          {indicator.objectiveValue !== undefined && (
                            <div className="mt-0.5 text-[11px] text-tertiary">
                              {latest?.value !== undefined
                                ? `${latest.value}${indicator.unit ? ` ${indicator.unit}` : ""}`
                                : "—"}{" "}
                              / {indicator.objectiveValue}
                              {indicator.unit ? ` ${indicator.unit}` : ""}
                            </div>
                          )}
                        </div>
                        <IndicatorStatusBadge
                          status="at_risk"
                          label={t("indicatorStatus.atRisk")}
                          className="flex-shrink-0"
                        />
                      </div>
                    );
                  })}
            </CardBody>
          </Card>
        );

      // ── Avancement des axes/chantiers par étape de maturité ───────────────────────────────
      case "axis-maturity": {
        const maxCount = Math.max(
          1,
          ...maturityBreakdown.rows.map((r) => r.axisCount + r.chantierCount)
        );
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("strategicDashboard.widget.axisMaturity")} />
            <CardBody>
              {maturityBreakdown.rows.length === 0
                ? emptyLine(t("axisStage.none"))
                : maturityBreakdown.rows.map((row) => (
                    <div
                      key={row.stage.id}
                      className="flex items-center gap-3 border-b border-border py-2.5 last:border-0 first:pt-0"
                    >
                      <AxisStageBadge
                        stageId={row.stage.id}
                        stages={stages}
                        className="w-[150px] flex-shrink-0 justify-center"
                      />
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                        <div
                          className="h-full rounded-full bg-bp-warm-taupe"
                          style={{
                            width: `${((row.axisCount + row.chantierCount) / maxCount) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="w-[150px] flex-shrink-0 text-right text-[11px] font-semibold text-secondary">
                        {row.axisCount} {t("strategicDashboard.axesSuffix")} · {row.chantierCount}{" "}
                        {t("strategicDashboard.chantiersSuffix")}
                      </span>
                    </div>
                  ))}
              {(maturityBreakdown.orphanAxes > 0 || maturityBreakdown.orphanChantiers > 0) && (
                <p className="pt-2.5 text-[11px] text-tertiary">
                  {t("axisStage.unknown")} : {maturityBreakdown.orphanAxes}{" "}
                  {t("strategicDashboard.axesSuffix")} · {maturityBreakdown.orphanChantiers}{" "}
                  {t("strategicDashboard.chantiersSuffix")}
                </p>
              )}
            </CardBody>
          </Card>
        );
      }

      // ── Alertes de cascade de retard entre chantiers (mise en évidence) ───────────────────
      case "chantier-dependency-alerts":
        return renderWidgetShell(
          instance,
          <Card
            className={`mb-0 h-full ${
              dependencyAlerts.length > 0 ? "border-bp-coral/60 shadow-md" : ""
            }`}
          >
            <CardHeader
              title={
                <>
                  {dependencyAlerts.length > 0 && (
                    <TriangleAlert size={14} className="flex-shrink-0 text-bp-coral" />
                  )}
                  {t("strategicDashboard.widget.chantierDependencyAlerts")}
                </>
              }
              actions={
                dependencyAlerts.length > 0 ? (
                  <span className="rounded-full bg-bp-coral px-2 py-0.5 text-[10.5px] font-bold text-white">
                    {dependencyAlerts.length}
                  </span>
                ) : undefined
              }
            />
            <CardBody>
              {dependencyAlerts.length === 0
                ? emptyLine(t("strategicDashboard.noDependencyAlerts"))
                : dependencyAlerts.map((alert) => (
                    <div
                      key={`${alert.sourceId}-${alert.targetId}-${alert.type}`}
                      className="border-b border-border py-2.5 last:border-0 first:pt-0"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <DependencyTypeBadge type={alert.type} />
                        <span className="text-[11px] font-semibold text-bp-coral">
                          {alert.delayDays} {t("strategicDashboard.delayDays")}
                        </span>
                      </div>
                      <p className="mt-1 text-[12px] leading-snug text-secondary">
                        {alert.message}
                      </p>
                    </div>
                  ))}
            </CardBody>
          </Card>
        );

      default:
        return null;
    }
  };

  // ─── Écrans d'attente / vides ─────────────────────────────────────────────────────────────
  if (programsLoading || strategic.loading) {
    return (
      <div className="animate-fade-up p-6 text-sm text-secondary">
        {t("strategicDashboard.loading")}
      </div>
    );
  }

  if (programs.length === 0 || !activeProgram) {
    return (
      <div className="animate-fade-up">
        <Card>
          <CardBody>
            <p className="text-sm text-secondary">{t("strategicDashboard.noProgram")}</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {t("strategicDashboard.title")}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px] text-secondary">
            {t("dashboard.program")} <strong>{activeProgram.name}</strong> · {axes.length}{" "}
            {t("strategicDashboard.axesSuffix")} · {chantiers.length}{" "}
            {t("strategicDashboard.chantiersSuffix")} · {counts.total}{" "}
            {t("strategicDashboard.indicatorsSuffix")}
          </div>
        </div>
        {/* Personnalisation : desktop uniquement, comme sur le dashboard exécutif (le
            glisser-déposer n'a pas de sens au doigt). */}
        <div className="hidden items-center gap-2 lg:flex">
          <Button
            variant={editMode ? "dark" : "outline"}
            size="md"
            onClick={() => setEditMode((v) => !v)}
          >
            <LayoutGrid size={14} />
            {editMode ? t("dashboard.done") : t("dashboard.customize")}
          </Button>
        </div>
      </div>

      {editMode && (
        <div className="mb-4 rounded-lg border-2 border-bp-coral/30 bg-bp-coral/[0.04]">
          <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-t-lg border-b border-bp-coral/20 bg-white/95 p-4 shadow-sm backdrop-blur">
            <div>
              <div className="text-[13px] font-bold text-primary">
                {t("dashboard.editModeTitle")}
              </div>
              <div className="text-[11.5px] text-secondary">{t("dashboard.editModeHint")}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={addPanelOpen ? "dark" : "primary"}
                size="sm"
                onClick={() => setAddPanelOpen((v) => !v)}
              >
                <Plus size={13} />
                {t("dashboard.addWidget")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateLayout(buildDefaultLayout())}
              >
                <RotateCcw size={13} />
                {t("dashboard.reset")}
              </Button>
              <Button variant="dark" size="sm" onClick={() => setEditMode(false)}>
                <LayoutGrid size={13} />
                {t("dashboard.done")}
              </Button>
            </div>
          </div>

          {addPanelOpen && (
            <div className="grid grid-cols-2 gap-2 p-4 pt-3.5 sm:grid-cols-3 lg:grid-cols-4">
              {STRATEGIC_DASHBOARD_WIDGET_REGISTRY.map((def) => {
                // `Sigma` n'est pas dans ICON_REGISTRY (registre partagé avec la nav, que ce
                // workstream ne modifie pas) — repli neutre plutôt qu'un widget sans icône.
                const Icon = ICON_REGISTRY[def.icon] ?? LayoutGrid;
                const alreadyPresent = layout.some((w) => w.type === def.type);
                return (
                  <button
                    key={def.type}
                    type="button"
                    onClick={() => {
                      updateLayout(addWidget(layout, def.type));
                      setAddPanelOpen(false);
                    }}
                    className="flex flex-col items-start gap-2 rounded-md border border-border-strong bg-white p-3 text-left transition hover:border-bp-coral hover:shadow-sm"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-neutral-100 text-primary">
                      <Icon size={16} />
                    </span>
                    <span className="text-[12px] font-semibold leading-tight text-primary">
                      {t(def.label)}
                    </span>
                    {alreadyPresent && (
                      <span className="text-[10px] font-medium text-tertiary">
                        {t("dashboard.alreadyOnBoard")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {axes.length === 0 && (
        <Card>
          <CardBody>
            <p className="text-sm text-secondary">{t("strategicDashboard.noAxesHint")}</p>
          </CardBody>
        </Card>
      )}

      <div
        data-dashboard-widget-grid
        className="grid grid-cols-1 grid-flow-row-dense gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {layout.map((instance) => renderWidget(instance))}
      </div>
    </div>
  );
}
