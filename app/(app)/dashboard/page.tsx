"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useGlobalFilters, matchesGlobalFilters } from "@/lib/hooks/useGlobalFilters";
import { FilterBar, type ActiveFilters, type FilterDef } from "@/components/shared/FilterBar";
import {
  Banknote,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  GripVertical,
  LayoutGrid,
  Maximize2,
  Plus,
  RotateCcw,
  TriangleAlert,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useRole } from "@/lib/hooks/useRole";
import { useLifecycleLabels } from "@/lib/hooks/useLifecycleLabels";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  subscribeCompanies,
  subscribeHierarchyNodes,
  subscribeProjects,
} from "@/lib/firestore/admin";
import type { Company, HierarchyLevelDef, HierarchyNode, Project } from "@/types";
import * as engine from "@/lib/engine";
import {
  METRIC_REGISTRY,
  getAvailableDimensions,
  getDimensionDef,
  getMetricDef,
  pivotByDimensions,
  type PivotRow,
} from "@/lib/dashboardPivot";
import { isLeverVisibleForClearance, resolveConfidentialityClearance } from "@/lib/leversLogic";
import { KPICard } from "@/components/shared/KPICard";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { ICON_REGISTRY } from "@/components/shared/icon-registry";
import { AlertItem } from "@/components/shared/AlertItem";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { Avatar } from "@/components/shared/Avatar";
import { DashboardExportButton } from "@/components/shared/DashboardExportButton";
import { SCurveChart } from "@/components/shared/charts/SCurveChart";
import { WorkstreamBarChart } from "@/components/shared/charts/WorkstreamBarChart";
import { GeoDonutChart } from "@/components/shared/charts/GeoDonutChart";
import { PnlBarChart } from "@/components/shared/charts/PnlBarChart";
import { StageFunnel } from "@/components/shared/charts/StageFunnel";
import { SankeyChart } from "@/components/shared/charts/SankeyChart";
import { MarimekkoChart } from "@/components/shared/charts/MarimekkoChart";
import { QuarterlyBridgeChart } from "@/components/shared/charts/QuarterlyBridgeChart";
import type { Lever, LeverStatus } from "@/types";
import {
  DASHBOARD_WIDGET_REGISTRY,
  SPAN_COL_CLASS,
  addCustomViewToInstance,
  addWidget,
  addWidgetWithCustomView,
  buildDefaultLayout,
  cycleSpan,
  getWidgetDef,
  loadDashboardLayout,
  moveWidget,
  removeWidget,
  resolveActiveCustomView,
  resolveCustomViews,
  saveDashboardLayout,
  setWidgetSpan,
  setWidgetView,
  type CustomViewConfig,
  type DashboardWidgetInstance,
  type DashboardWidgetType,
} from "@/lib/dashboardWidgets";

/** Libellé lisible d'une vue construite (builder générique) — `label` explicite si fourni par
 * l'utilisateur, sinon généré à partir des libellés de la métrique et des dimensions choisies
 * (ex. "Économies réalisées par Fonction × Pays"). */
function describeCustomView(view: CustomViewConfig, hierarchyLevels: HierarchyLevelDef[]): string {
  if (view.label) return view.label;
  const metricLabel = getMetricDef(view.metric)?.label ?? view.metric;
  const dimLabels = view.dimensions
    .map((d) => getDimensionDef(d, hierarchyLevels)?.label ?? d)
    .join(" × ");
  return `${metricLabel} par ${dimLabels}`;
}

/** Correspondance dimension → paramètre de filtre global existant (voir `useGlobalFilters`), pour
 * le clic de drill-down depuis un graphique du builder générique vers la liste des leviers.
 * Uniquement les dimensions qui ont un équivalent dans la barre de filtres du dashboard — les
 * autres dimensions (ex. sponsor, risque, projet) naviguent simplement sans filtre additionnel
 * plutôt que d'échouer. */
const FILTER_PARAM_BY_DIMENSION: Partial<Record<string, string>> = {
  function: "f_function",
  ws: "f_ws",
  owner: "f_owner",
  geography: "f_geography",
  type: "f_type",
  status: "f_status",
};

export default function DashboardPage() {
  const { user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);
  const lifecycle = useLifecycleLabels(user?.companyId);
  const { t } = useTranslation();
  const router = useRouter();
  const { filters, setFilter, resetFilters } = useGlobalFilters();

  // Société courante — utilisée pour le budget CAPEX de référence (KPI ci-dessous) et
  // l'habilitation de confidentialité (filtrage des leviers visibles par profil).
  const [company, setCompany] = useState<Company | null>(null);
  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      setCompany(companies.find((c) => c.id === user?.companyId) ?? null);
    });
    return unsub;
  }, [user?.companyId]);

  const clearance = resolveConfidentialityClearance(user, company?.roleClearance);
  const visibleLevers = useMemo(
    () =>
      data.levers.filter(
        (l) =>
          user?.role === "admin" ||
          user?.role === "admin_entreprise" ||
          isLeverVisibleForClearance(l.confidentialityLevel, clearance)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.levers, user?.role, company?.roleClearance, user?.confidentialityClearance]
  );
  const visibleData = useMemo(() => ({ ...data, levers: visibleLevers }), [data, visibleLevers]);

  // Projets de l'entreprise — pour la ventilation "par projet" (en plus de "par workstream").
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    const unsub = subscribeProjects((all) =>
      setProjects(user?.companyId ? all.filter((p) => p.companyId === user.companyId) : all)
    );
    return unsub;
  }, [user?.companyId]);

  // Arborescence financière (optionnelle) de l'entreprise — n'ajoute des dimensions "hiérarchie"
  // au builder générique que si l'entreprise a explicitement configuré des hierarchyLevels (voir
  // lib/dashboardPivot.ts, même pattern défensif que app/(app)/levers/page.tsx).
  const [hierarchyLevels, setHierarchyLevels] = useState<HierarchyLevelDef[]>([]);
  const [hierarchyNodes, setHierarchyNodes] = useState<HierarchyNode[]>([]);
  useEffect(() => {
    setHierarchyLevels(company?.hierarchyLevels ?? []);
  }, [company]);
  useEffect(() => {
    if (!user?.companyId || hierarchyLevels.length === 0) {
      setHierarchyNodes([]);
      return;
    }
    const unsub = subscribeHierarchyNodes(user.companyId, setHierarchyNodes);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId, hierarchyLevels.length]);

  const filterDefs: FilterDef<Lever>[] = useMemo(
    () => [
      { key: "status", label: "Statut", getValue: (l) => lifecycle.label(l.status) },
      {
        key: "ws",
        label: "Workstream",
        getValue: (l) => data.workstreams.find((w) => w.id === l.ws)?.name ?? l.ws,
      },
      { key: "owner", label: "Owner", getValue: (l) => l.owner },
      { key: "geography", label: "Géographie", getValue: (l) => l.geography },
      { key: "function", label: "Fonction", getValue: (l) => l.function },
      { key: "type", label: "Type", getValue: (l) => l.type },
    ],
    [data.workstreams, lifecycle]
  );

  const activeForBar: ActiveFilters = useMemo(() => {
    const result: ActiveFilters = {};
    if (filters.f_status) result.status = filters.f_status.split(",").filter(Boolean);
    if (filters.f_ws) result.ws = filters.f_ws.split(",").filter(Boolean);
    if (filters.f_owner) result.owner = filters.f_owner.split(",").filter(Boolean);
    if (filters.f_geography) result.geography = filters.f_geography.split(",").filter(Boolean);
    if (filters.f_function) result.function = filters.f_function.split(",").filter(Boolean);
    if (filters.f_type) result.type = filters.f_type.split(",").filter(Boolean);
    return result;
  }, [filters]);

  const handleFilterChange = (next: ActiveFilters) => {
    resetFilters();
    const map: Record<string, keyof typeof filters> = {
      status: "f_status",
      ws: "f_ws",
      owner: "f_owner",
      geography: "f_geography",
      function: "f_function",
      type: "f_type",
    };
    Object.entries(next).forEach(([key, values]) => {
      const globalKey = map[key];
      if (globalKey && values.length > 0) setFilter(globalKey, values.join(","));
    });
  };

  const filteredLevers = useMemo(() => {
    return visibleLevers.filter((l) =>
      matchesGlobalFilters(
        {
          status: lifecycle.label(l.status),
          ws: data.workstreams.find((w) => w.id === l.ws)?.name ?? l.ws,
          function: l.function,
          geography: l.geography,
          country: l.country,
          owner: l.owner,
          type: l.type,
          priority: l.priority,
          risk: l.risk,
          end: l.end,
        },
        filters
      )
    );
  }, [visibleLevers, data.workstreams, filters, lifecycle]);

  const filteredData = useMemo(() => ({ ...data, levers: filteredLevers }), [data, filteredLevers]);

  const summary = engine.programSummary(filteredData);
  const [sCurveGranularity, setSCurveGranularity] = useState<engine.TimeGranularity>("month");
  const [bridgeGranularity, setBridgeGranularity] = useState<engine.TimeGranularity>("quarter");
  const sCurve = engine.sCurve3(visibleData, sCurveGranularity);
  const stages = engine.stageCounts(filteredData);
  const sankeyChrono = engine.sankeyChronology(filteredData);
  const bridge = engine.financialBridge(filteredData, bridgeGranularity);

  const goToLevers = (params: Record<string, string>) => {
    const globalParams: Record<string, string> = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value) globalParams[key] = value;
    });
    const merged = { ...globalParams, ...params };
    const qs = new URLSearchParams(merged).toString();
    router.push(`/levers${qs ? `?${qs}` : ""}`);
  };
  /** Drill-down générique depuis un graphique du builder (Marimekko/ventilations/P&L) : navigue
   * filtré si la dimension cliquée a un équivalent dans la barre de filtres globale, sinon
   * navigue sans filtre additionnel plutôt que d'échouer silencieusement. */
  const goToDimensionValue = (dimensionKey: string, value: string) => {
    const param = FILTER_PARAM_BY_DIMENSION[dimensionKey];
    goToLevers(param ? { [param]: value } : {});
  };
  const goToStage = (status: LeverStatus) => goToLevers({ f_status: lifecycle.label(status) });
  const goToStageLabel = (label: string) => {
    const stage = stages.find((s) => s.label === label);
    if (stage) goToStage(stage.status);
  };
  const goToAlert = (alert: (typeof data.alerts)[number]) => {
    if (alert.scope.startsWith("WS-")) {
      const ws = data.workstreams.find((w) => w.id === alert.scope);
      goToLevers(ws ? { f_ws: ws.name } : {});
    } else if (data.getLeverById(alert.scope)) {
      router.push(`/levers/detail?id=${alert.scope}`);
    } else {
      goToLevers({});
    }
  };
  const currentYear = new Date(data.program.fyStart).getFullYear();
  const goToMonth = (month: string) => goToLevers({ f_endMonth: `${month} ${currentYear}` });
  const goToBridgePeriod = (period: string) =>
    bridgeGranularity === "quarter"
      ? goToLevers({ f_endQuarter: period })
      : goToLevers({ f_endMonth: period });
  const goToSCurvePoint = (label: string) =>
    sCurveGranularity === "quarter"
      ? goToLevers({ f_endQuarter: `${label} ${currentYear}` })
      : goToMonth(label);

  const wsBars = data.workstreams.map((w) => ({
    label: w.name.split(" ")[0],
    realized: engine.workstreamSummary(visibleData, w.id).realized,
    target: w.target,
  }));
  const projectMap = engine.byProject(visibleData, projects);
  const projectBars = [
    ...projects.map((p) => ({
      label: p.name.split(" ")[0],
      realized: projectMap[p.name] ?? 0,
      target: p.target,
    })),
    ...(projectMap["Non assigné"]
      ? [{ label: "Non assigné", realized: projectMap["Non assigné"], target: 0 }]
      : []),
  ];

  const geoDataFor = (dimension: string) => {
    const map =
      dimension === "function" ? engine.byFunction(filteredData) : engine.byCountry(filteredData);
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  };
  const pnlMap = engine.pnlImpact(filteredData);
  const pnlData = Object.entries(pnlMap).map(([id, impact]) => ({
    account: data.pnlAccounts.find((a) => a.id === id)?.name ?? id,
    impact,
  }));
  // ─── Layout du dashboard (widgets) ────────────────────────────────────────────────────────
  // Personnalisation d'affichage purement locale (localStorage, par navigateur) — voir
  // lib/dashboardWidgets.ts. Le layout par défaut reproduit exactement l'ancien ordre/tailles
  // fixes, donc rien ne change pour qui n'entre jamais en mode édition.
  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState<DashboardWidgetInstance[]>(buildDefaultLayout);
  const [dragInstanceId, setDragInstanceId] = useState<string | null>(null);
  const [dragOverInstanceId, setDragOverInstanceId] = useState<string | null>(null);
  const [addPanelOpen, setAddPanelOpen] = useState(false);

  // ─── Builder générique métrique × dimension(s) ─────────────────────────────────────────────
  // Widget "builder" (Marimekko, ventilations, P&L — voir `builderDimensionCount` du registre) déjà
  // présent qu'on tente de rajouter : on demande d'abord explicitement si c'est un nouveau bloc
  // séparé ou une vue supplémentaire sur un bloc existant, plutôt que de dupliquer silencieusement
  // un widget qui peut déjà tout afficher via son propre sélecteur de vue.
  const [builderChoiceType, setBuilderChoiceType] = useState<DashboardWidgetType | null>(null);
  // Étape de configuration (métrique + dimension(s)) — `builderTargetInstanceId` = null pour une
  // nouvelle instance, ou l'instanceId d'un bloc existant pour lui ajouter une vue.
  const [builderConfigType, setBuilderConfigType] = useState<DashboardWidgetType | null>(null);
  const [builderTargetInstanceId, setBuilderTargetInstanceId] = useState<string | null>(null);
  const [builderMetric, setBuilderMetric] = useState<string>("");
  const [builderDims, setBuilderDims] = useState<string[]>(["", ""]);

  useEffect(() => {
    setLayout(loadDashboardLayout());
  }, []);

  const updateLayout = (next: DashboardWidgetInstance[]) => {
    setLayout(next);
    saveDashboardLayout(next);
  };

  // Tous les types de widgets restent toujours proposés — les doublons sont autorisés (comparer
  // deux fois le même graphique avec des filtres différents, à l'image d'un outil type PowerBI).
  const availableToAdd = DASHBOARD_WIDGET_REGISTRY;

  const openBuilderConfig = (type: DashboardWidgetType, targetInstanceId: string | null) => {
    setBuilderConfigType(type);
    setBuilderTargetInstanceId(targetInstanceId);
    setBuilderMetric("");
    setBuilderDims(["", ""]);
    setBuilderChoiceType(null);
  };

  const closeBuilderConfig = () => {
    setBuilderConfigType(null);
    setBuilderTargetInstanceId(null);
    setBuilderMetric("");
    setBuilderDims(["", ""]);
  };

  /** Point d'entrée unique pour ajouter un widget depuis le panneau — les types "builder" (voir
   * `builderDimensionCount`) ouvrent la configuration métrique + dimension(s) au lieu d'un ajout
   * immédiat ; s'ils sont déjà présents sur le dashboard, on demande d'abord nouveau bloc vs vue
   * sur un bloc existant. Les autres types gardent le comportement historique (ajout immédiat). */
  const requestAddWidget = (type: DashboardWidgetType) => {
    const def = getWidgetDef(type);
    if (!def?.builderDimensionCount) {
      updateLayout(addWidget(layout, type));
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

  const requiredDimCount = builderConfigType
    ? (getWidgetDef(builderConfigType)?.builderDimensionCount ?? 1)
    : 1;
  const selectedDims = builderDims.slice(0, requiredDimCount).filter(Boolean);
  const builderConfigValid =
    builderMetric !== "" &&
    selectedDims.length === requiredDimCount &&
    new Set(selectedDims).size === selectedDims.length;

  const confirmBuilderConfig = () => {
    if (!builderConfigType || !builderConfigValid) return;
    const config = { metric: builderMetric, dimensions: selectedDims };
    if (builderTargetInstanceId) {
      updateLayout(addCustomViewToInstance(layout, builderTargetInstanceId, config));
    } else {
      updateLayout(addWidgetWithCustomView(layout, builderConfigType, config));
    }
    closeBuilderConfig();
    setAddPanelOpen(false);
  };

  // Réordonnancement mobile via boutons haut/bas — le drag-and-drop HTML5 natif (draggable=) ne
  // se déclenche jamais sur écran tactile (iOS Safari / Chrome Android), donc en dessous de `sm`
  // la barre d'outils du widget affiche ces boutons à la place de la poignée de glisser.
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

  /** Coquille commune à tous les widgets : gère la classe de largeur (col-span-*) et, en mode
   * édition, superpose une mini-barre d'outils (poignée de glisser, cycle de taille, suppression)
   * sans toucher au contenu métier du widget (passé en `children`). */
  const renderWidgetShell = (instance: DashboardWidgetInstance, children: ReactNode) => {
    const def = getWidgetDef(instance.type);
    if (!def) return null;
    const isDragOver = editMode && dragOverInstanceId === instance.instanceId;
    return (
      <div
        key={instance.instanceId}
        data-widget-id={instance.instanceId}
        data-widget-title={t(
          `dashboard.widgets.${instance.type.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`,
          def.label
        )}
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
            {/* Glisser-déposer — desktop/tablette (>= sm) uniquement : le drag HTML5 natif ne
             * fonctionne pas au toucher, remplacé sur mobile par les boutons haut/bas ci-dessous. */}
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
            {/* Cycle de taille — desktop/tablette uniquement : simplification "sans PowerBI" sur
             * mobile, où chaque widget garde une taille fixe raisonnable (1 colonne). */}
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
              title="Changer la taille"
            >
              <Maximize2 size={12} />
              {instance.span}
            </button>
            <button
              type="button"
              onClick={() => updateLayout(removeWidget(layout, instance.instanceId))}
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

  const renderWidget = (instance: DashboardWidgetInstance): ReactNode => {
    switch (instance.type) {
      case "stage-funnel":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("dashboard.widgets.stageFunnelFull")} />
            <CardBody>
              <StageFunnel data={stages} onStageClick={goToStage} />
            </CardBody>
          </Card>
        );
      case "alerts":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("dashboard.widgets.alerts")} />
            <CardBody>
              {data.alerts.slice(0, 5).map((a) => (
                <AlertItem key={a.id} alert={a} onClick={() => goToAlert(a)} />
              ))}
              {data.alerts.length === 0 && (
                <p className="py-6 text-center text-sm text-tertiary">
                  {t("dashboard.widgets.noAlerts")}
                </p>
              )}
            </CardBody>
          </Card>
        );
      case "s-curve":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t("dashboard.widgets.sCurve")}
              actions={
                <GranularityToggle value={sCurveGranularity} onChange={setSCurveGranularity} />
              }
            />
            <CardBody>
              <SCurveChart data={sCurve} height={360} onPointClick={goToSCurvePoint} />
            </CardBody>
          </Card>
        );
      case "bridge":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={
                bridgeGranularity === "quarter"
                  ? t("dashboard.widgets.bridgeQuarter")
                  : t("dashboard.widgets.bridgeMonth")
              }
              actions={
                <GranularityToggle value={bridgeGranularity} onChange={setBridgeGranularity} />
              }
            />
            <CardBody>
              <QuarterlyBridgeChart
                data={bridge}
                target={summary.target}
                height={340}
                onBarClick={goToBridgePeriod}
              />
            </CardBody>
          </Card>
        );
      case "sankey":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("dashboard.widgets.sankey")} />
            <CardBody>
              <SankeyChart data={sankeyChrono} height={340} onNodeClick={goToStageLabel} />
            </CardBody>
          </Card>
        );
      case "marimekko": {
        // Les deux vues historiques ("function-country" / "workstream-project") gardent le calcul
        // exact d'origine (engine.marimekko2D) pour zéro régression visuelle ; toute vue construite
        // par l'utilisateur via le builder générique passe par le pivot générique.
        const activeView = resolveActiveCustomView(instance);
        const views = resolveCustomViews(instance);
        const isLegacy =
          activeView?.id === "function-country" || activeView?.id === "workstream-project";
        const mekko2D = activeView
          ? isLegacy
            ? engine.marimekko2D(filteredData, activeView.id as engine.MarimekkoPairKey, projects)
            : (pivotByDimensions(filteredData, activeView.metric, activeView.dimensions, {
                projects,
                hierarchyLevels,
                hierarchyNodes,
              }) as engine.Marimekko2DColumn[])
          : [];
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t("dashboard.widgets.marimekko")}
              actions={
                views.length > 1 && activeView ? (
                  <DimensionToggle
                    options={views.map((v) => ({
                      value: v.id,
                      label: describeCustomView(v, hierarchyLevels),
                    }))}
                    value={activeView.id}
                    onChange={(next) =>
                      updateLayout(setWidgetView(layout, instance.instanceId, next))
                    }
                  />
                ) : undefined
              }
            />
            <CardBody>
              <MarimekkoChart
                data={mekko2D}
                height={300}
                onSegmentClick={(primaryKey) => {
                  if (!activeView) return;
                  goToDimensionValue(activeView.dimensions[0], primaryKey);
                }}
              />
            </CardBody>
          </Card>
        );
      }
      case "workstream-breakdown": {
        const activeView = resolveActiveCustomView(instance);
        const views = resolveCustomViews(instance);
        const isLegacy = activeView?.id === "workstream" || activeView?.id === "project";
        const barData = activeView
          ? isLegacy
            ? activeView.id === "workstream"
              ? wsBars
              : projectBars
            : (
                pivotByDimensions(filteredData, activeView.metric, activeView.dimensions, {
                  projects,
                  hierarchyLevels,
                  hierarchyNodes,
                }) as PivotRow[]
              ).map((row) => ({ label: row.label, realized: row.value, target: 0 }))
          : [];
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={
                activeView
                  ? isLegacy
                    ? activeView.id === "workstream"
                      ? t("dashboard.widgets.workstreamSavings")
                      : t("dashboard.widgets.projectSavings")
                    : describeCustomView(activeView, hierarchyLevels)
                  : t("dashboard.widgets.workstreamBreakdown")
              }
              actions={
                views.length > 1 && activeView ? (
                  <DimensionToggle
                    options={views.map((v) => ({
                      value: v.id,
                      label: describeCustomView(v, hierarchyLevels),
                    }))}
                    value={activeView.id}
                    onChange={(next) =>
                      updateLayout(setWidgetView(layout, instance.instanceId, next))
                    }
                  />
                ) : undefined
              }
            />
            <CardBody>
              <WorkstreamBarChart data={barData} />
            </CardBody>
          </Card>
        );
      }
      case "geo-breakdown": {
        const activeView = resolveActiveCustomView(instance);
        const views = resolveCustomViews(instance);
        const isLegacy = activeView?.id === "country" || activeView?.id === "function";
        const donutData = activeView
          ? isLegacy
            ? geoDataFor(activeView.id)
            : (
                pivotByDimensions(filteredData, activeView.metric, activeView.dimensions, {
                  projects,
                  hierarchyLevels,
                  hierarchyNodes,
                }) as PivotRow[]
              ).map((row) => ({ name: row.label, value: row.value }))
          : [];
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={
                activeView
                  ? isLegacy
                    ? activeView.id === "country"
                      ? t("dashboard.widgets.countrySavings")
                      : t("dashboard.widgets.functionSavings")
                    : describeCustomView(activeView, hierarchyLevels)
                  : t("dashboard.widgets.geoBreakdown")
              }
              actions={
                views.length > 1 && activeView ? (
                  <DimensionToggle
                    options={views.map((v) => ({
                      value: v.id,
                      label: describeCustomView(v, hierarchyLevels),
                    }))}
                    value={activeView.id}
                    onChange={(next) =>
                      updateLayout(setWidgetView(layout, instance.instanceId, next))
                    }
                  />
                ) : undefined
              }
            />
            <CardBody>
              <GeoDonutChart data={donutData} />
            </CardBody>
          </Card>
        );
      }
      case "workstream-table":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("dashboard.widgets.workstreamTable")} />
            <CardBody flush>
              <div className="overflow-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      {[
                        "Workstream",
                        "Sponsor",
                        "Leviers",
                        "Réalisé / Cible",
                        "Progression",
                        "Risque",
                        "CAPEX",
                        "OPEX/an",
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
                    {data.workstreams.map((ws) => {
                      const ss = engine.workstreamSummary(visibleData, ws.id);
                      return (
                        <tr
                          key={ws.id}
                          onClick={() => goToLevers({ f_ws: ws.name })}
                          className="cursor-pointer border-b border-border last:border-b-0 hover:bg-neutral-50"
                        >
                          <td className="px-3 py-2.5 font-semibold text-primary">{ws.name}</td>
                          <td className="px-3 py-2.5">
                            <Avatar
                              initials={ws.sponsor
                                .split(" ")
                                .map((x) => x[0])
                                .join("")
                                .slice(0, 2)}
                              size="sm"
                            />{" "}
                            {ws.sponsor}
                          </td>
                          <td className="px-3 py-2.5">{ss.leverCount}</td>
                          <td className="px-3 py-2.5 tabular-nums">
                            <strong>{engine.fmtCurr(ss.realized)}</strong> /{" "}
                            {engine.fmtCurr(ss.target)}
                          </td>
                          <td className="px-3 py-2.5">
                            <ProgressBar pct={ss.progressPct} />
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge risk={ss.worstRisk} />
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">{engine.fmtCurr(ss.capex)}</td>
                          <td className="px-3 py-2.5 tabular-nums">{engine.fmtCurr(ss.opex)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        );
      case "dependencies":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("dashboard.widgets.dependencies")} />
            <CardBody>
              {visibleLevers
                .filter((l) => l.dependencies.length)
                .slice(0, 5)
                .map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center gap-2.5 border-b border-border py-2 text-[12.5px] last:border-b-0"
                  >
                    <Avatar initials={l.ownerInit} size="sm" />
                    <div className="flex-1">
                      <strong>{l.name}</strong> <span className="text-tertiary">({l.code})</span>
                    </div>
                    <div className="flex gap-1">
                      {l.dependencies.map((d) => (
                        <span
                          key={d.targetId}
                          className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-secondary"
                        >
                          {d.targetId}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
            </CardBody>
          </Card>
        );
      case "pnl": {
        const activeView = resolveActiveCustomView(instance);
        const views = resolveCustomViews(instance);
        const isLegacy = activeView?.id === "account";
        const pnlChartData = activeView
          ? isLegacy
            ? pnlData
            : (
                pivotByDimensions(filteredData, activeView.metric, activeView.dimensions, {
                  projects,
                  hierarchyLevels,
                  hierarchyNodes,
                }) as PivotRow[]
              ).map((row) => ({ account: row.label, impact: row.value }))
          : [];
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={
                activeView && !isLegacy
                  ? describeCustomView(activeView, hierarchyLevels)
                  : t("dashboard.widgets.pnl")
              }
              actions={
                views.length > 1 && activeView ? (
                  <DimensionToggle
                    options={views.map((v) => ({
                      value: v.id,
                      label: describeCustomView(v, hierarchyLevels),
                    }))}
                    value={activeView.id}
                    onChange={(next) =>
                      updateLayout(setWidgetView(layout, instance.instanceId, next))
                    }
                  />
                ) : undefined
              }
            />
            <CardBody>
              <PnlBarChart data={pnlChartData} />
            </CardBody>
          </Card>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {t("dashboard.title")}
          </h1>
          <div className="mt-2.5 text-[13px] text-secondary">
            {t("dashboard.program")} <strong>{data.program.name}</strong> · {summary.leverCount}{" "}
            {t("dashboard.leversActive")}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!editMode && <DashboardExportButton layout={layout} />}
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

      <div className="mb-4">
        <FilterBar
          items={visibleLevers}
          defs={filterDefs}
          active={activeForBar}
          onChange={handleFilterChange}
        />
      </div>

      <div className="mb-4 grid grid-cols-5 gap-3.5 max-[1100px]:grid-cols-2 max-[500px]:grid-cols-1">
        <KPICard
          label={t("dashboard.kpi.savingsRealized")}
          value={engine.fmtCurr(summary.realized)}
          icon={Banknote}
          sub={`vs. cible ${engine.fmtCurr(summary.target)} · ${summary.progressPct}%`}
          barPct={summary.progressPct}
        />
        <KPICard
          label={t("dashboard.kpi.leversDelivered")}
          value={`${summary.delivered} / ${summary.leverCount}`}
          icon={CircleCheck}
          accent="green"
        />
        <KPICard
          label={t("dashboard.kpi.leversAtRisk")}
          value={String(summary.atRisk)}
          icon={TriangleAlert}
          accent="amber"
          sub={`${summary.critical} critiques · à surveiller`}
        />
        <KPICard
          label={t("dashboard.kpi.capexEngaged")}
          value={
            company?.capexBudget != null
              ? `${engine.fmtCurr(summary.capex)} / ${engine.fmtCurr(company.capexBudget)}`
              : engine.fmtCurr(summary.capex)
          }
          icon={TrendingUp}
          accent="brown"
          sub={
            company?.capexBudget != null
              ? `+ ${engine.fmtCurr(summary.opex)} OPEX`
              : `+ ${engine.fmtCurr(summary.opex)} OPEX · budget non renseigné (voir Finance)`
          }
        />
        <KPICard
          label={t("dashboard.kpi.fteImpacted")}
          value={String(summary.fteImpact)}
          icon={Users}
          sub={`${engine.fmtInt(summary.popImpacted)} pers. concernées`}
        />
      </div>

      {editMode && (
        <div className="mb-4 rounded-lg border-2 border-bp-coral/30 bg-bp-coral/[0.04]">
          {/* Barre d'outils collante — reste visible en haut de l'écran pendant le scroll, pour ne
              jamais avoir à remonter en haut de page pour cliquer "Terminer" après être descendu
              choisir un widget à ajouter (pain point signalé : scroller en bas pour ajouter, puis
              tout en haut pour terminer). */}
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
                      {t(
                        `dashboard.widgets.${def.type.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`,
                        def.label
                      )}
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

      {/* Étape 1 du builder générique (widgets déjà présents) : nouveau bloc séparé, ou vue
          supplémentaire ajoutée au sélecteur d'un bloc existant (l'utilisateur choisit LEQUEL
          s'il y en a plusieurs) — voir requestAddWidget/openBuilderConfig. */}
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
                const active = resolveActiveCustomView(inst);
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
                        Vue actuelle : {describeCustomView(active, hierarchyLevels)}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      </Modal>

      {/* Étape 2 du builder générique : choix de la métrique + 1 ou 2 dimension(s) selon le type de
          graphique (voir builderDimensionCount). Empilement vertical simple → aucun scroll
          horizontal introduit sur mobile (Modal est déjà plein-écran-friendly). */}
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
              {METRIC_REGISTRY.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {Array.from({ length: requiredDimCount }).map((_, i) => (
            <label
              key={i}
              className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-primary"
            >
              {requiredDimCount === 2
                ? i === 0
                  ? "Dimension primaire"
                  : "Dimension secondaire"
                : "Dimension"}
              <select
                value={builderDims[i] ?? ""}
                onChange={(e) => {
                  const next = [...builderDims];
                  next[i] = e.target.value;
                  setBuilderDims(next);
                }}
                className="rounded-md border border-border-strong px-2.5 py-2 text-[13px] font-normal text-primary"
              >
                <option value="">— Choisir —</option>
                {getAvailableDimensions(hierarchyLevels).map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {!builderConfigValid && (
            <p className="text-[11.5px] text-tertiary">
              {builderMetric === ""
                ? "Choisissez un indicateur pour continuer."
                : selectedDims.length < requiredDimCount
                  ? `Choisissez encore ${requiredDimCount - selectedDims.length} dimension(s).`
                  : "Les dimensions choisies doivent être différentes."}
            </p>
          )}
        </div>
      </Modal>

      {/* grid-flow-row-dense : comble automatiquement les trous laissés par un widget large suivi
          d'un widget étroit, sans avoir à réordonner manuellement le layout. Colonnes réduites en
          dessous de `lg`/`sm` (breakpoints Tailwind standards) — les classes col-span-* des widgets
          (SPAN_COL_CLASS) restent valides à toute largeur de grille (un col-span-4 sur une grille à
          1 colonne se contente d'occuper l'unique colonne disponible, sans débordement). */}
      <div
        data-dashboard-widget-grid
        className="grid grid-cols-1 grid-flow-row-dense gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {layout.map((instance) => renderWidget(instance))}
      </div>
    </div>
  );
}

/** Sélecteur mois/trimestre réutilisé par les graphiques temporels du dashboard exécutif. */
function GranularityToggle({
  value,
  onChange,
}: {
  value: engine.TimeGranularity;
  onChange: (g: engine.TimeGranularity) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex rounded-md border border-border-strong p-0.5 text-[11px] font-semibold">
      {(["month", "quarter"] as const).map((g) => (
        <button
          key={g}
          onClick={() => onChange(g)}
          className={`rounded px-2 py-1 transition ${
            value === g ? "bg-bp-coral text-white" : "text-secondary hover:text-primary"
          }`}
        >
          {g === "month" ? t("dashboard.month") : t("dashboard.quarter")}
        </button>
      ))}
    </div>
  );
}

/** Sélecteur générique d'axe de ventilation (pays/fonction, workstream/projet, ...). */
function DimensionToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
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
