"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  ChevronDown,
  ChevronUp,
  GripVertical,
  LayoutGrid,
  Maximize2,
  Plus,
  RotateCcw,
  TriangleAlert,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useRole } from "@/lib/hooks/useRole";
import { useLifecycleLabels } from "@/lib/hooks/useLifecycleLabels";
import * as hr from "@/lib/hrEngine";
import { fmtCurr } from "@/lib/engine";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { KPICard } from "@/components/shared/KPICard";
import { RadialProgress } from "@/components/shared/RadialProgress";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { ICON_REGISTRY } from "@/components/shared/icon-registry";
import { DashboardExportButton } from "@/components/shared/DashboardExportButton";
import {
  FteWaterfallChart,
  FteWaterfallLegend,
} from "@/components/shared/charts/FteWaterfallChart";
import {
  DepartmentMovementsChart,
  HrDonutChart,
  HrPivotBarChart,
} from "@/components/shared/charts/HrBreakdownCharts";
import type { MovementAlertKind } from "@/lib/hrEngine";
import {
  HR_METRIC_REGISTRY,
  HR_DIMENSION_REGISTRY,
  getHrMetricDef,
  getHrDimensionDef,
  pivotWorkforceByDimension,
} from "@/lib/hrDashboardPivot";
import {
  HR_WIDGET_REGISTRY,
  SPAN_COL_CLASS,
  addCustomViewToHrInstance,
  addHrWidget,
  addHrWidgetWithCustomView,
  buildHrDefaultLayout,
  cycleSpan,
  getHrWidgetDef,
  loadHrDashboardLayout,
  moveWidget,
  removeHrWidget,
  resolveHrActiveCustomView,
  resolveHrCustomViews,
  saveHrDashboardLayout,
  setHrWidgetSpan,
  setHrWidgetView,
  type HrCustomViewConfig,
  type HrWidgetInstance,
  type HrWidgetType,
} from "@/lib/hrDashboardWidgets";

const ALERT_LABELS: Record<MovementAlertKind, string> = {
  overdue: "En retard",
  leverMismatch: "Désynchronisé levier",
  toValidate: "À valider",
  due: "Échéance proche",
};

/** Libellé lisible d'une vue construite (builder générique RH) — `label` explicite si fourni,
 *  sinon généré à partir des libellés de la métrique et de la dimension. */
function describeHrCustomView(view: HrCustomViewConfig): string {
  if (view.label) return view.label;
  const metricLabel = getHrMetricDef(view.metric)?.label ?? view.metric;
  const dimLabel = getHrDimensionDef(view.dimension)?.label ?? view.dimension;
  return `${metricLabel} par ${dimLabel}`;
}

/** Correspondance dimension RH → paramètre de filtre existant de la Base ETP (mouvements), pour le
 *  clic de drill-down depuis un graphique du builder générique — voir `movementFilterDefs` de
 *  `app/(app)/hr/etp/page.tsx`. Dimensions sans équivalent (owner RH, PSE, mois/trimestre...)
 *  naviguent simplement sans filtre additionnel plutôt que d'échouer. */
const FILTER_PARAM_BY_HR_DIMENSION: Partial<Record<string, string>> = {
  type: "f_type",
  department: "f_department",
  country: "f_country",
  status: "f_status",
};

/**
 * Dashboard RH — pilotage visuel de la transformation effectifs, personnalisable façon PowerBI
 * (voir lib/hrDashboardWidgets.ts / lib/hrDashboardPivot.ts) : waterfall baseline → cible
 * cliquable (décomposition par levier), mouvements par département/pays/type, impact masse
 * salariale, suivi PSE, table des départements et synthèse des mouvements. La donnée détaillée vit
 * dans la Base ETP (/hr/etp).
 */
export default function HrDashboardPage() {
  const { user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);
  const lifecycle = useLifecycleLabels(user?.companyId);
  const router = useRouter();
  const [granularity, setGranularity] = useState<"month" | "quarter">("quarter");
  const [drillBucket, setDrillBucket] = useState<string | null>(null);

  const wf = data.workforce;
  const alerts = useMemo(() => hr.movementAlerts(wf, data.levers), [wf, data.levers]);
  const bridge = useMemo(() => hr.fteBridge(wf, granularity), [wf, granularity]);
  const salary = useMemo(() => hr.salaryBridge(wf, "quarter"), [wf]);
  const byDept = useMemo(() => hr.movementsByDepartment(wf), [wf]);
  const byCountry = useMemo(() => hr.movementsByCountry(wf), [wf]);
  const deptDeltas = useMemo(() => hr.deltaByDepartment(wf), [wf]);
  const pse = useMemo(() => hr.pseSummary(wf), [wf]);

  const current = hr.currentFTE(wf);
  const target = hr.targetFTE(wf);
  const landing = hr.plannedFTE(wf);
  const reductionGoal = wf.totalFTE - target;
  const reductionDone = wf.totalFTE - current;
  const goalPct = reductionGoal > 0 ? Math.round((reductionDone / reductionGoal) * 100) : 100;

  const alertCounts = (Object.keys(ALERT_LABELS) as MovementAlertKind[])
    .map((kind) => ({ kind, count: alerts.filter((a) => a.kind === kind).length }))
    .filter((a) => a.count > 0);

  const drill = useMemo(() => {
    if (!drillBucket) return [];
    const bucket = bridge.find((b) => b.label === drillBucket);
    return bucket ? hr.bucketByLever(bucket, data.levers) : [];
  }, [drillBucket, bridge, data.levers]);

  const realizedMovements = wf.movements.filter((m) => m.status === "Réalisé").length;

  const goToEtp = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    router.push(`/hr/etp${qs ? `?${qs}` : ""}`);
  };
  /** Drill-down générique depuis un graphique du builder RH : navigue filtré si la dimension
   *  cliquée a un équivalent dans les filtres de la Base ETP, sinon navigue sans filtre. */
  const goToHrDimensionValue = (dimensionKey: string, value: string) => {
    const param = FILTER_PARAM_BY_HR_DIMENSION[dimensionKey];
    goToEtp(param ? { [param]: value } : {});
  };

  // ─── Layout du Dashboard RH (widgets) ───────────────────────────────────────────────────────
  // Personnalisation d'affichage purement locale (localStorage, par navigateur, clé DISTINCTE du
  // dashboard exécutif) — voir lib/hrDashboardWidgets.ts.
  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState<HrWidgetInstance[]>(buildHrDefaultLayout);
  const [dragInstanceId, setDragInstanceId] = useState<string | null>(null);
  const [dragOverInstanceId, setDragOverInstanceId] = useState<string | null>(null);
  const [addPanelOpen, setAddPanelOpen] = useState(false);

  // ─── Builder générique métrique × dimension ─────────────────────────────────────────────────
  const [builderChoiceType, setBuilderChoiceType] = useState<HrWidgetType | null>(null);
  const [builderConfigType, setBuilderConfigType] = useState<HrWidgetType | null>(null);
  const [builderTargetInstanceId, setBuilderTargetInstanceId] = useState<string | null>(null);
  const [builderMetric, setBuilderMetric] = useState<string>("");
  const [builderDim, setBuilderDim] = useState<string>("");

  useEffect(() => {
    setLayout(loadHrDashboardLayout());
  }, []);

  const updateLayout = (next: HrWidgetInstance[]) => {
    setLayout(next);
    saveHrDashboardLayout(next);
  };

  const availableToAdd = HR_WIDGET_REGISTRY;

  const openBuilderConfig = (type: HrWidgetType, targetInstanceId: string | null) => {
    setBuilderConfigType(type);
    setBuilderTargetInstanceId(targetInstanceId);
    setBuilderMetric("");
    setBuilderDim("");
    setBuilderChoiceType(null);
  };

  const closeBuilderConfig = () => {
    setBuilderConfigType(null);
    setBuilderTargetInstanceId(null);
    setBuilderMetric("");
    setBuilderDim("");
  };

  /** Point d'entrée unique pour ajouter un widget depuis le panneau — les types du builder ouvrent
   *  la configuration métrique + dimension au lieu d'un ajout immédiat ; s'ils sont déjà présents,
   *  on demande d'abord nouveau bloc vs vue sur un bloc existant. */
  const requestAddWidget = (type: HrWidgetType) => {
    const def = getHrWidgetDef(type);
    if (!def?.builderEnabled) {
      updateLayout(addHrWidget(layout, type));
      setAddPanelOpen(false);
      return;
    }
    const alreadyPresent = layout.some((w) => w.type === type);
    if (alreadyPresent) {
      setBuilderChoiceType(type);
    } else {
      openBuilderConfig(type, null);
    }
  };

  const builderConfigValid = builderMetric !== "" && builderDim !== "";

  const confirmBuilderConfig = () => {
    if (!builderConfigType || !builderConfigValid) return;
    const config = { metric: builderMetric, dimension: builderDim };
    if (builderTargetInstanceId) {
      updateLayout(addCustomViewToHrInstance(layout, builderTargetInstanceId, config));
    } else {
      updateLayout(addHrWidgetWithCustomView(layout, builderConfigType, config));
    }
    closeBuilderConfig();
    setAddPanelOpen(false);
  };

  // Réordonnancement mobile via boutons haut/bas — le drag-and-drop HTML5 natif ne se déclenche
  // jamais sur écran tactile, donc en dessous de `sm` la barre d'outils du widget affiche ces
  // boutons à la place de la poignée de glisser (même UX que le dashboard exécutif).
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

  const renderWidgetShell = (instance: HrWidgetInstance, children: ReactNode) => {
    const def = getHrWidgetDef(instance.type);
    if (!def) return null;
    const isDragOver = editMode && dragOverInstanceId === instance.instanceId;
    return (
      <div
        key={instance.instanceId}
        data-widget-id={instance.instanceId}
        data-widget-title={def.label}
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
              title="Glisser pour réordonner"
            >
              <GripVertical size={14} />
            </span>
            <div className="flex items-center sm:hidden">
              <button
                type="button"
                onClick={() => moveWidgetBy(instance.instanceId, "up")}
                className="rounded p-0.5 text-tertiary hover:bg-neutral-100 hover:text-primary"
                title="Monter"
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => moveWidgetBy(instance.instanceId, "down")}
                className="rounded p-0.5 text-tertiary hover:bg-neutral-100 hover:text-primary"
                title="Descendre"
              >
                <ChevronDown size={14} />
              </button>
            </div>
            <button
              type="button"
              onClick={() =>
                updateLayout(
                  setHrWidgetSpan(
                    layout,
                    instance.instanceId,
                    cycleSpan(instance.span, def.allowedSpans)
                  )
                )
              }
              className="hidden items-center gap-1 rounded px-1.5 py-0.5 hover:bg-neutral-100 hover:text-primary sm:flex"
              title="Changer la taille"
            >
              <Maximize2 size={12} />
              {instance.span}
            </button>
            <button
              type="button"
              onClick={() => updateLayout(removeHrWidget(layout, instance.instanceId))}
              className="flex items-center rounded px-1 py-0.5 text-tertiary hover:bg-neutral-100 hover:text-bp-coral"
              title="Retirer ce widget"
            >
              <X size={13} />
            </button>
          </div>
        )}
        <div className={editMode ? "pointer-events-none select-none" : ""}>{children}</div>
      </div>
    );
  };

  const renderWidget = (instance: HrWidgetInstance): ReactNode => {
    switch (instance.type) {
      case "fte-waterfall":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title="Trajectoire des effectifs — waterfall des mouvements"
              actions={
                <div className="flex overflow-hidden rounded-md border border-border">
                  {(["month", "quarter"] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGranularity(g)}
                      className={`px-3 py-1.5 text-xs font-semibold ${granularity === g ? "bg-black text-white" : "bg-white text-secondary"}`}
                    >
                      {g === "month" ? "Mois" : "Trimestre"}
                    </button>
                  ))}
                </div>
              }
            />
            <CardBody>
              <FteWaterfallChart
                buckets={bridge}
                baseline={wf.totalFTE}
                target={target}
                onBarClick={(label) => setDrillBucket(label)}
              />
              <FteWaterfallLegend />
            </CardBody>
          </Card>
        );
      case "department-breakdown": {
        const activeView = resolveHrActiveCustomView(instance);
        const views = resolveHrCustomViews(instance);
        const isLegacy = activeView?.id === "detail";
        const pivotRows =
          activeView && !isLegacy
            ? pivotWorkforceByDimension(wf.movements, activeView.metric, activeView.dimension)
            : [];
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={
                activeView && !isLegacy
                  ? describeHrCustomView(activeView)
                  : "Mouvements par département (ETP)"
              }
              actions={
                views.length > 1 && activeView ? (
                  <ViewToggle
                    options={views.map((v) => ({ value: v.id, label: describeHrCustomView(v) }))}
                    value={activeView.id}
                    onChange={(next) =>
                      updateLayout(setHrWidgetView(layout, instance.instanceId, next))
                    }
                  />
                ) : undefined
              }
            />
            <CardBody>
              {activeView && isLegacy ? (
                <DepartmentMovementsChart data={byDept} />
              ) : (
                <HrPivotBarChart
                  data={pivotRows.map((r) => ({ label: r.label, value: r.value }))}
                  onBarClick={(label) =>
                    activeView && goToHrDimensionValue(activeView.dimension, label)
                  }
                />
              )}
            </CardBody>
          </Card>
        );
      }
      case "country-breakdown": {
        const activeView = resolveHrActiveCustomView(instance);
        const views = resolveHrCustomViews(instance);
        const isLegacy = activeView?.id === "country";
        const pivotRows =
          activeView && !isLegacy
            ? pivotWorkforceByDimension(wf.movements, activeView.metric, activeView.dimension)
            : [];
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={
                activeView && !isLegacy
                  ? describeHrCustomView(activeView)
                  : "Mouvements par pays (ETP)"
              }
              actions={
                views.length > 1 && activeView ? (
                  <ViewToggle
                    options={views.map((v) => ({ value: v.id, label: describeHrCustomView(v) }))}
                    value={activeView.id}
                    onChange={(next) =>
                      updateLayout(setHrWidgetView(layout, instance.instanceId, next))
                    }
                  />
                ) : undefined
              }
            />
            <CardBody>
              <HrDonutChart
                data={
                  activeView && isLegacy
                    ? byCountry.map((c) => ({ name: c.country, value: c.fte }))
                    : pivotRows.map((r) => ({ name: r.label, value: r.value }))
                }
                onSliceClick={(name) =>
                  activeView &&
                  goToHrDimensionValue(isLegacy ? "country" : activeView.dimension, name)
                }
              />
              <p className="mt-1 text-center text-[10.5px] text-tertiary">
                Cliquer sur une valeur pour ouvrir la Base ETP filtrée
              </p>
            </CardBody>
          </Card>
        );
      }
      case "movement-type-breakdown": {
        const activeView = resolveHrActiveCustomView(instance);
        const views = resolveHrCustomViews(instance);
        const pivotRows = activeView
          ? pivotWorkforceByDimension(wf.movements, activeView.metric, activeView.dimension)
          : [];
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={
                activeView ? describeHrCustomView(activeView) : "Mouvements par type (mécanisme)"
              }
              actions={
                views.length > 1 && activeView ? (
                  <ViewToggle
                    options={views.map((v) => ({ value: v.id, label: describeHrCustomView(v) }))}
                    value={activeView.id}
                    onChange={(next) =>
                      updateLayout(setHrWidgetView(layout, instance.instanceId, next))
                    }
                  />
                ) : undefined
              }
            />
            <CardBody>
              <HrPivotBarChart
                data={pivotRows.map((r) => ({ label: r.label, value: r.value }))}
                formatValue={(v) => v.toLocaleString("fr-FR")}
                onBarClick={(label) =>
                  activeView && goToHrDimensionValue(activeView.dimension, label)
                }
              />
            </CardBody>
          </Card>
        );
      }
      case "salary-waterfall":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Impact masse salariale (€M, annualisé)" />
            <CardBody>
              <FteWaterfallChart
                buckets={salary}
                baseline={wf.massSalary}
                target={wf.massSalary + salary.reduce((s, b) => s + b.delta, 0)}
                unit="€M"
                decimals={1}
                height={240}
              />
              <FteWaterfallLegend downLabel="Économies" upLabel="Recrutements (coûts)" />
            </CardBody>
          </Card>
        );
      case "pse-summary":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Suivi du PSE (Plan de Sauvegarde de l'Emploi)" />
            <CardBody>
              <div className="mb-4 flex items-end gap-3">
                {[
                  { label: "Postes concernés", value: pse.postes, color: "bg-neutral-300" },
                  { label: "En cours", value: pse.enCours, color: "bg-rag-amber" },
                  { label: "Réalisés", value: pse.realises, color: "bg-bp-coral" },
                  { label: "Validés RH", value: pse.valides, color: "bg-rag-green" },
                ].map((stage) => {
                  const max = Math.max(1, pse.postes);
                  return (
                    <div key={stage.label} className="flex flex-1 flex-col items-center gap-1.5">
                      <span className="text-lg font-bold text-primary">{stage.value}</span>
                      <div
                        className={`w-full rounded-t-sm ${stage.color}`}
                        style={{ height: `${Math.max(8, (Number(stage.value) / max) * 90)}px` }}
                      />
                      <span className="text-center text-[10px] uppercase tracking-wide text-tertiary">
                        {stage.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="space-y-1.5 border-t border-border pt-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-secondary">Coût social engagé / provision</span>
                  <strong>
                    {fmtCurr(pse.coutEngage / 1_000_000)} / {fmtCurr(pse.coutTotal / 1_000_000)}
                  </strong>
                </div>
                <ProgressBar
                  pct={pse.coutTotal > 0 ? Math.round((pse.coutEngage / pse.coutTotal) * 100) : 0}
                />
              </div>
            </CardBody>
          </Card>
        );
      case "department-table":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Effectifs par département — actuel vs cible vs atterrissage" />
            <CardBody flush>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      {[
                        "Département",
                        "Actuel",
                        "Cible",
                        "Atterrissage plan",
                        "Écart vs cible",
                        "Avancement",
                      ].map((h) => (
                        <th
                          key={h}
                          className="border-b border-border bg-neutral-50 px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-secondary"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {deptDeltas.map((d) => {
                      const toDo = d.fte - d.fteTarget;
                      const done = d.fte - d.landing;
                      const pct = toDo !== 0 ? Math.round((done / toDo) * 100) : 100;
                      return (
                        <tr
                          key={d.name}
                          className="border-b border-border last:border-b-0 hover:bg-neutral-50"
                        >
                          <td className="px-3 py-2.5 font-semibold text-primary">{d.name}</td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {d.fte.toLocaleString("fr-FR")}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {d.fteTarget.toLocaleString("fr-FR")}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {d.landing.toLocaleString("fr-FR")}
                          </td>
                          <td
                            className={`px-3 py-2.5 font-semibold tabular-nums ${d.gapToTarget > 0 ? "text-rag-red" : "text-rag-green-dark"}`}
                          >
                            {d.gapToTarget > 0 ? "+" : ""}
                            {d.gapToTarget.toLocaleString("fr-FR")}
                          </td>
                          <td className="w-[180px] px-3 py-2.5">
                            <ProgressBar pct={Math.max(0, Math.min(100, pct))} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-border sm:hidden">
                {deptDeltas.map((d) => {
                  const toDo = d.fte - d.fteTarget;
                  const done = d.fte - d.landing;
                  const pct = toDo !== 0 ? Math.round((done / toDo) * 100) : 100;
                  return (
                    <div key={d.name} className="p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-primary">{d.name}</span>
                        <span
                          className={`text-[12px] font-semibold tabular-nums ${d.gapToTarget > 0 ? "text-rag-red" : "text-rag-green-dark"}`}
                        >
                          {d.gapToTarget > 0 ? "+" : ""}
                          {d.gapToTarget.toLocaleString("fr-FR")} vs cible
                        </span>
                      </div>
                      <dl className="mb-2 grid grid-cols-3 gap-x-3 gap-y-1.5">
                        {[
                          { label: "Actuel", value: d.fte },
                          { label: "Cible", value: d.fteTarget },
                          { label: "Atterrissage", value: d.landing },
                        ].map((item) => (
                          <div key={item.label}>
                            <dt className="text-[10px] font-bold uppercase tracking-wide text-tertiary">
                              {item.label}
                            </dt>
                            <dd className="text-[12px] tabular-nums text-primary">
                              {item.value.toLocaleString("fr-FR")}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <ProgressBar pct={Math.max(0, Math.min(100, pct))} />
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>
        );
      case "movements-table":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Synthèse des mouvements" />
            <CardBody flush>
              <div className="overflow-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      {[
                        "Mouvement",
                        "Type",
                        "Département",
                        "Pays",
                        "Owner RH",
                        "ETP",
                        "Statut",
                        "Impact salarial",
                        "Coût social",
                      ].map((h) => (
                        <th
                          key={h}
                          className="border-b border-border bg-neutral-50 px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-secondary"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {wf.movements.map((m) => {
                      const lever = data.levers.find((l) => l.id === m.leverId);
                      return (
                        <tr
                          key={m.id}
                          onClick={() => goToEtp(lever ? { f_lever: lever.code } : {})}
                          className="cursor-pointer border-b border-border last:border-b-0 hover:bg-neutral-50"
                        >
                          <td className="px-3 py-2.5 font-semibold text-primary">{m.label}</td>
                          <td className="px-3 py-2.5">{m.type}</td>
                          <td className="px-3 py-2.5">
                            {m.department}
                            {m.toDepartment ? ` → ${m.toDepartment}` : ""}
                          </td>
                          <td className="px-3 py-2.5">{m.country}</td>
                          <td className="px-3 py-2.5">{m.hrOwner}</td>
                          <td className="px-3 py-2.5 tabular-nums">{m.fte}</td>
                          <td className="px-3 py-2.5">{m.status}</td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {fmtCurr(m.salaryImpact / 1_000_000)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {fmtCurr(m.cost / 1_000_000)}
                          </td>
                        </tr>
                      );
                    })}
                    {wf.movements.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-sm text-tertiary">
                          Aucun mouvement enregistré.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        );
      default:
        return null;
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            Dashboard RH
          </h1>
          <div className="mt-2.5 text-[13px] text-secondary">
            Trajectoire effectifs {wf.totalFTE.toLocaleString("fr-FR")} →{" "}
            {target.toLocaleString("fr-FR")} ETP · {wf.movements.length} mouvements ·{" "}
            {realizedMovements} réalisés
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!editMode && (
            <DashboardExportButton
              layout={layout}
              gridSelector="[data-hr-dashboard-widget-grid]"
              coverTitle="BeTrack — Dashboard RH"
              fileNamePrefix="betrack_hr_dashboard"
            />
          )}
          <Button
            variant={editMode ? "dark" : "outline"}
            size="md"
            onClick={() => setEditMode((v) => !v)}
          >
            <LayoutGrid size={14} />
            {editMode ? "Terminer" : "Personnaliser"}
          </Button>
          <Button variant="primary" onClick={() => router.push("/hr/etp")}>
            <Users size={13} /> Ouvrir la Base ETP
          </Button>
        </div>
      </div>

      {/* Alertes RH — réconciliation avec les leviers. Reste en chrome fixe (comme la ligne de KPI
          ci-dessous) plutôt que de devenir un widget : c'est un flux d'actions prioritaires à
          garder toujours visible en haut, pas un graphique repositionnable — voir la note de scope
          dans lib/hrDashboardWidgets.ts. */}
      {alerts.length > 0 && (
        <div className="mb-4 rounded-lg border border-rag-amber-light bg-rag-amber-light/30 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-primary">
              <TriangleAlert size={14} className="text-rag-amber" /> {alerts.length} alerte(s)
              mouvement
            </span>
            {alertCounts.map(({ kind, count }) => (
              <button
                key={kind}
                onClick={() => goToEtp({ f_alert: ALERT_LABELS[kind] })}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition hover:border-black ${
                  kind === "overdue" || kind === "leverMismatch"
                    ? "border-rag-red-light bg-rag-red-light/60 text-rag-red"
                    : "border-border bg-white text-secondary"
                }`}
              >
                {ALERT_LABELS[kind]} · {count}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            {alerts.slice(0, 3).map((a, i) => (
              <div key={i} className="text-xs text-secondary">
                <span className="font-mono text-[10px] text-tertiary">{a.movement.id}</span>{" "}
                {a.message}
              </div>
            ))}
            {alerts.length > 3 && (
              <button
                onClick={() => router.push("/hr/etp")}
                className="text-xs font-medium text-bp-coral hover:underline"
              >
                Voir les {alerts.length - 3} autres dans la Base ETP →
              </button>
            )}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-[auto_1fr_1fr_1fr_1fr] gap-3.5 max-[1100px]:grid-cols-2 max-[500px]:grid-cols-1">
        <div className="flex items-center justify-center rounded-lg border border-border bg-white px-5 shadow-sm">
          <RadialProgress
            pct={goalPct}
            size={104}
            label={`${goalPct}%`}
            sublabel="objectif réalisé"
          />
        </div>
        <KPICard
          label="Effectif actuel"
          value={current.toLocaleString("fr-FR")}
          icon={Users}
          sub={`baseline ${wf.totalFTE.toLocaleString("fr-FR")} ETP`}
        />
        <KPICard
          label="Cible fin 2026"
          value={target.toLocaleString("fr-FR")}
          icon={Users}
          accent="green"
          sub={`atterrissage plan : ${landing.toLocaleString("fr-FR")} (${landing - target > 0 ? "+" : ""}${(landing - target).toLocaleString("fr-FR")} vs cible)`}
        />
        <KPICard
          label="Masse salariale"
          value={`€${wf.massSalary.toFixed(1)}M`}
          icon={Wallet}
          accent="brown"
          sub={`budget €${wf.budgetSalary.toFixed(1)}M`}
        />
        <KPICard
          label="Économies salariales réalisées"
          value={fmtCurr(hr.realizedSalarySavings(wf) / 1_000_000)}
          icon={Banknote}
          accent="green"
          sub="annualisées · mouvements réalisés"
        />
      </div>

      {editMode && (
        <div className="mb-4 rounded-lg border-2 border-bp-coral/30 bg-bp-coral/[0.04]">
          <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-t-lg border-b border-bp-coral/20 bg-white/95 p-4 shadow-sm backdrop-blur">
            <div>
              <div className="text-[13px] font-bold text-primary">
                Personnalisez votre Dashboard RH
              </div>
              <div className="text-[11.5px] text-secondary">
                Ajoutez, déplacez, redimensionnez ou retirez des widgets — sauvegardé sur cet
                appareil.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={addPanelOpen ? "dark" : "primary"}
                size="sm"
                onClick={() => setAddPanelOpen((v) => !v)}
              >
                <Plus size={13} />
                Ajouter un widget
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateLayout(buildHrDefaultLayout())}
              >
                <RotateCcw size={13} />
                Réinitialiser
              </Button>
              <Button variant="dark" size="sm" onClick={() => setEditMode(false)}>
                <LayoutGrid size={13} />
                Terminer
              </Button>
            </div>
          </div>

          {addPanelOpen && (
            <div className="grid grid-cols-2 gap-2 p-4 pt-3.5 sm:grid-cols-3 lg:grid-cols-4">
              {availableToAdd.map((def) => {
                const Icon = ICON_REGISTRY[def.icon] ?? LayoutGrid;
                const alreadyPresent = layout.some((w) => w.type === def.type);
                return (
                  <button
                    key={def.type}
                    type="button"
                    onClick={() => requestAddWidget(def.type)}
                    className="flex flex-col items-start gap-2 rounded-md border border-border-strong bg-white p-3 text-left transition hover:border-bp-coral hover:shadow-sm"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-neutral-100 text-primary">
                      <Icon size={16} />
                    </span>
                    <span className="text-[12px] font-semibold leading-tight text-primary">
                      {def.label}
                    </span>
                    {alreadyPresent && (
                      <span className="text-[10px] font-medium text-tertiary">
                        Déjà sur le dashboard
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Étape 1 du builder générique (widgets déjà présents) : nouveau bloc séparé, ou vue
          supplémentaire sur un bloc existant. */}
      <Modal
        open={builderChoiceType !== null}
        onOpenChange={(open) => !open && setBuilderChoiceType(null)}
        title="Ce graphique est déjà sur votre dashboard"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-secondary">
            Ajoutez-le comme nouveau bloc séparé, ou ajoutez cette vue au sélecteur d&apos;un bloc
            déjà présent (petit bouton en haut du graphique) plutôt que de dupliquer.
          </p>
          <button
            type="button"
            onClick={() => builderChoiceType && openBuilderConfig(builderChoiceType, null)}
            className="w-full rounded-md border border-border-strong p-3 text-left text-[12.5px] font-semibold text-primary transition hover:border-bp-coral"
          >
            Ajouter comme nouveau widget
          </button>
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
              Ou ajouter une vue à un bloc existant
            </div>
            {layout
              .filter((w) => w.type === builderChoiceType)
              .map((inst, i) => {
                const active = resolveHrActiveCustomView(inst);
                return (
                  <button
                    key={inst.instanceId}
                    type="button"
                    onClick={() =>
                      builderChoiceType && openBuilderConfig(builderChoiceType, inst.instanceId)
                    }
                    className="w-full rounded-md border border-border p-2.5 text-left text-[12.5px] transition hover:border-bp-coral"
                  >
                    <span className="font-semibold text-primary">Bloc existant n°{i + 1}</span>
                    {active && (
                      <span className="mt-0.5 block text-[11px] text-tertiary">
                        Vue actuelle : {describeHrCustomView(active)}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      </Modal>

      {/* Étape 2 du builder générique : choix de la métrique + dimension. */}
      <Modal
        open={builderConfigType !== null}
        onOpenChange={(open) => !open && closeBuilderConfig()}
        title={builderTargetInstanceId ? "Ajouter une vue" : "Configurer le widget"}
        footer={
          <>
            <Button variant="ghost" onClick={closeBuilderConfig}>
              Annuler
            </Button>
            <Button variant="primary" onClick={confirmBuilderConfig} disabled={!builderConfigValid}>
              {builderTargetInstanceId ? "Ajouter la vue" : "Ajouter le widget"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-primary">
            Indicateur (métrique)
            <select
              value={builderMetric}
              onChange={(e) => setBuilderMetric(e.target.value)}
              className="rounded-md border border-border-strong px-2.5 py-2 text-[13px] font-normal text-primary"
            >
              <option value="">— Choisir —</option>
              {HR_METRIC_REGISTRY.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-primary">
            Dimension
            <select
              value={builderDim}
              onChange={(e) => setBuilderDim(e.target.value)}
              className="rounded-md border border-border-strong px-2.5 py-2 text-[13px] font-normal text-primary"
            >
              <option value="">— Choisir —</option>
              {HR_DIMENSION_REGISTRY.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          {!builderConfigValid && (
            <p className="text-[11.5px] text-tertiary">
              {builderMetric === ""
                ? "Choisissez un indicateur pour continuer."
                : "Choisissez une dimension pour continuer."}
            </p>
          )}
        </div>
      </Modal>

      <div
        data-hr-dashboard-widget-grid
        className="grid grid-cols-1 grid-flow-row-dense gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {layout.map((instance) => renderWidget(instance))}
      </div>

      {/* Drill-down waterfall par levier */}
      <Modal
        open={drillBucket !== null}
        onOpenChange={(open) => !open && setDrillBucket(null)}
        title={`Mouvements ${granularity === "month" ? "du mois de" : "du"} ${drillBucket ?? ""} — décomposition par levier`}
        maxWidth="640px"
      >
        {drill.length === 0 ? (
          <p className="py-6 text-center text-sm text-tertiary">
            Aucun mouvement sur cette période.
          </p>
        ) : (
          <div className="space-y-3">
            {drill.map((entry) => {
              const lever = data.levers.find((l) => l.id === entry.leverId);
              return (
                <div
                  key={entry.leverId}
                  className="rounded-md border border-border bg-neutral-50 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => router.push(`/levers/detail?id=${entry.leverId}`)}
                      className="text-left text-xs font-semibold text-primary hover:text-primary hover:underline"
                    >
                      <span className="font-mono text-[10px] text-tertiary">{entry.leverCode}</span>{" "}
                      {entry.leverName}
                    </button>
                    <span className={`text-sm font-bold text-primary`}>
                      {entry.fte > 0 ? "+" : ""}
                      {entry.fte} ETP
                    </span>
                  </div>
                  {lever && (
                    <div className="mt-0.5 text-[10.5px] text-tertiary">
                      {lifecycle.label(lever.status)} · fin prévue {lever.end}
                    </div>
                  )}
                  <div className="mt-2 space-y-1">
                    {entry.movements.map((m) => (
                      <div key={m.id} className="flex items-center justify-between text-[11px]">
                        <span className="text-secondary">
                          {m.type} · {m.label}
                        </span>
                        <span className="text-tertiary">
                          {m.plannedDate} · {m.status}
                          {m.hrValidated ? " ✓RH" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Sélecteur générique de vue construite (builder RH) — équivalent du `DimensionToggle` du
 *  dashboard exécutif. */
function ViewToggle({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded-md border border-border-strong p-0.5 text-[11px] font-semibold">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2 py-1 transition ${
            value === o.value ? "bg-bp-coral text-white" : "text-secondary hover:text-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
