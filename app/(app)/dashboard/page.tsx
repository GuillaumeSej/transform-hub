"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  SlidersHorizontal,
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
  subscribePrograms,
} from "@/lib/firestore/admin";
import type { Company, HierarchyLevelDef, HierarchyNode, Program } from "@/types";
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
import { ManualAlertForm } from "@/components/shared/ManualAlertForm";
import { DependencyTypeBadge } from "@/components/shared/DependencyTypeBadge";
import { Tooltip } from "@/components/shared/Tooltip";
import { DEPENDENCY_TYPE_META } from "@/lib/status-config";
import { useNotifications } from "@/lib/hooks/useNotifications";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
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
  country: "f_country",
  entity: "f_entity",
  sponsor: "f_sponsor",
  risk: "f_risk",
  pnl: "f_pnl",
  type: "f_type",
  status: "f_status",
};

export default function DashboardPage() {
  const { user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);
  const lifecycle = useLifecycleLabels(user?.companyId);
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const visibleData = useMemo(() => {
    return {
      ...data,
      levers: visibleLevers,
    };
  }, [data, visibleLevers]);

  // Programmes de l'entreprise — pour la ventilation "par programme" (en plus de "par
  // workstream") et pour le sélecteur de programme du dashboard (voir plus bas).
  const [programs, setPrograms] = useState<Program[]>([]);
  useEffect(() => {
    const unsub = subscribePrograms((all) =>
      setPrograms(user?.companyId ? all.filter((p) => p.companyId === user.companyId) : all)
    );
    return unsub;
  }, [user?.companyId]);

  // ── Sélecteur de programme (scope du dashboard) ─────────────────────────────
  // Le dashboard exécutif est scopé à UN programme sélectionné, porté par l'URL (?program=) pour
  // rester partageable/rechargeable. Auto-sélection du premier programme disponible si l'URL n'en
  // précise aucun et qu'au moins un programme existe (évite un dashboard vide inutilement pour les
  // entreprises n'ayant qu'un seul programme).
  const selectedProgramId = searchParams.get("program") ?? "";

  useEffect(() => {
    if (!selectedProgramId && programs.length > 0) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("program", programs[0].id);
      router.replace(`/dashboard?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProgramId, programs]);

  const handleProgramChange = (programId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("program", programId);
    router.push(`/dashboard?${params.toString()}`);
  };

  // Leviers scopés au programme sélectionné — appliqué AVANT le filtrage de la barre de filtres
  // (les options de filtres ne doivent refléter que les leviers du programme courant), mais reste
  // distinct des filtres globaux (c'est un scope, pas un filtre parmi d'autres).
  const programScopedLevers = useMemo(
    () => visibleLevers.filter((l) => l.programId === selectedProgramId),
    [visibleLevers, selectedProgramId]
  );

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

  // Clés de filtre "activées" indépendamment d'une valeur choisie (voir FilterBar : activer une
  // dimension démarre à ZÉRO valeur sélectionnée, style Excel). Sans cet état local, un filtre
  // activé mais encore vide redeviendrait immédiatement "inactif" au prochain rendu puisque
  // `activeForBar` ne serait dérivé que de `filters.f_X` (qui ne porte aucune valeur tant que rien
  // n'est coché).
  const [openFilterKeys, setOpenFilterKeys] = useState<string[]>([]);

  const activeForBar: ActiveFilters = useMemo(() => {
    const result: ActiveFilters = {};
    const openSet = new Set(openFilterKeys);
    if (filters.f_status || openSet.has("status"))
      result.status = filters.f_status ? filters.f_status.split(",").filter(Boolean) : [];
    if (filters.f_ws || openSet.has("ws"))
      result.ws = filters.f_ws ? filters.f_ws.split(",").filter(Boolean) : [];
    if (filters.f_owner || openSet.has("owner"))
      result.owner = filters.f_owner ? filters.f_owner.split(",").filter(Boolean) : [];
    if (filters.f_geography || openSet.has("geography"))
      result.geography = filters.f_geography ? filters.f_geography.split(",").filter(Boolean) : [];
    if (filters.f_function || openSet.has("function"))
      result.function = filters.f_function ? filters.f_function.split(",").filter(Boolean) : [];
    if (filters.f_type || openSet.has("type"))
      result.type = filters.f_type ? filters.f_type.split(",").filter(Boolean) : [];
    return result;
  }, [filters, openFilterKeys]);

  const hasActiveFilters = Object.keys(activeForBar).length > 0;

  const handleFilterChange = (next: ActiveFilters) => {
    resetFilters();
    setOpenFilterKeys(Object.keys(next));
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
    return programScopedLevers.filter((l) =>
      matchesGlobalFilters(
        {
          status: lifecycle.label(l.status),
          ws: data.workstreams.find((w) => w.id === l.ws)?.name ?? l.ws,
          function: l.function,
          geography: l.geography,
          country: l.country,
          owner: l.owner,
          type: l.type,
          risk: l.risk,
          end: l.end,
        },
        filters
      )
    );
  }, [programScopedLevers, data.workstreams, filters, lifecycle]);

  const filteredData = useMemo(() => {
    return {
      ...visibleData,
      levers: filteredLevers,
    };
  }, [visibleData, filteredLevers]);

  const summary = engine.programSummary(filteredData);
  const underperformingLevers = useMemo(() => engine.underperformers(filteredData), [filteredData]);

  // ── Tri des leviers sous-performants ───────────────────────────────────
  const [underSort, setUnderSort] = useState<"gap" | "savings">("gap");
  const [underSortDir, setUnderSortDir] = useState<"asc" | "desc">("desc");
  const sortedUnderperformers = useMemo(() => {
    const sorted = [...underperformingLevers];
    sorted.sort((a, b) => {
      const va = underSort === "gap" ? a.gap : a.netSavings;
      const vb = underSort === "gap" ? b.gap : b.netSavings;
      return underSortDir === "desc" ? vb - va : va - vb;
    });
    return sorted;
  }, [underperformingLevers, underSort, underSortDir]);
  const toggleUnderSort = (field: "gap" | "savings") => {
    if (underSort === field) {
      setUnderSortDir((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setUnderSort(field);
      setUnderSortDir("desc");
    }
  };
  const depAlerts = useMemo(() => engine.dependencyAlerts(filteredData), [filteredData]);

  // ── Alertes enrichies (manuelles + auto-générées) ──────────────────────────
  const ALERTS_PER_PAGE = 5;
  const [alertPage, setAlertPage] = useState(0);
  const [alertTypeFilter, setAlertTypeFilter] = useState<string>("all");
  const [alertShowResolved, setAlertShowResolved] = useState(false);
  const [manualAlertOpen, setManualAlertOpen] = useState(false);
  const { alerts: allAlerts } = useNotifications(visibleData, user);

  // Une alerte ne reste affichée que si elle est liée (via un levier, ou via un workstream ayant
  // au moins un levier) à l'ensemble scopé (programme) + filtré courant. Une alerte dont le scope
  // ne résout à AUCUN levier ni workstream connu (scope orphelin/inconnu) reste visible par
  // défaut ("fail open") plutôt que d'être masquée silencieusement.
  const scopedLeverIds = useMemo(() => new Set(filteredLevers.map((l) => l.id)), [filteredLevers]);
  const scopedWorkstreamIds = useMemo(
    () => new Set(filteredLevers.map((l) => l.ws)),
    [filteredLevers]
  );
  const scopedAlerts = useMemo(
    () =>
      allAlerts.filter((a) => {
        if (a.scope.startsWith("WS-")) return scopedWorkstreamIds.has(a.scope);
        if (data.getLeverById(a.scope)) return scopedLeverIds.has(a.scope);
        return true;
      }),
    [allAlerts, scopedLeverIds, scopedWorkstreamIds, data]
  );

  const filteredAlerts = useMemo(() => {
    let result = scopedAlerts;
    if (!alertShowResolved) result = result.filter((a) => !a.resolved);
    if (alertTypeFilter !== "all") result = result.filter((a) => a.type === alertTypeFilter);
    return result;
  }, [scopedAlerts, alertShowResolved, alertTypeFilter]);

  const alertPageCount = Math.max(1, Math.ceil(filteredAlerts.length / ALERTS_PER_PAGE));
  const alertPageClamped = Math.min(alertPage, alertPageCount - 1);
  const alertsOnPage = filteredAlerts.slice(
    alertPageClamped * ALERTS_PER_PAGE,
    (alertPageClamped + 1) * ALERTS_PER_PAGE
  );

  const toggleAlertResolved = (id: string) => {
    if (!user) return;
    const alert = allAlerts.find((item) => item.id === id);
    data.setAlertResolved(id, !(alert?.resolved ?? false), user, alert?.companyId);
  };
  const markAllResolved = () => {
    if (!user) return;
    filteredAlerts.forEach((alert) => data.setAlertResolved(alert.id, true, user, alert.companyId));
  };

  /** Résout le scope d'une alerte en nom lisible (lever name ou workstream name). */
  const resolveScopeLabel = (scope: string): string | undefined => {
    if (scope.startsWith("WS-")) {
      return data.workstreams.find((w) => w.id === scope)?.name;
    }
    const lever = data.levers.find((l) => l.id === scope);
    return lever ? `${lever.name} (${lever.code})` : undefined;
  };

  // Compteurs par sévérité (sur les non-résolus uniquement, scope+filtre appliqués)
  const alertCounts = useMemo(() => {
    const unresolvedAlerts = scopedAlerts.filter((a) => !a.resolved);
    return {
      red: unresolvedAlerts.filter((a) => a.type === "red").length,
      amber: unresolvedAlerts.filter((a) => a.type === "amber").length,
      green: unresolvedAlerts.filter((a) => a.type === "green").length,
      blue: unresolvedAlerts.filter((a) => a.type === "blue").length,
    };
  }, [scopedAlerts]);
  const [sCurveGranularity, setSCurveGranularity] = useState<engine.TimeGranularity>("month");

  // ── Trajectoire des économies (widget combiné S-curve + Bridge) ────────
  const [trajView, setTrajView] = useState<"scurve" | "bridge">("scurve");
  const [trajGranularity, setTrajGranularity] = useState<engine.TimeGranularity>("month");
  const [trajRangeStart, setTrajRangeStart] = useState(data.program.fyStart);
  const [trajRangeEnd, setTrajRangeEnd] = useState(data.program.fyEnd);

  /** Convertit un label de période ("Jan 2026", "Q2 2026") en Date pour le filtrage. */
  const labelToDate = useCallback(
    (label: string, granularity: engine.TimeGranularity): Date => {
      const parts = label.split(" ");
      const year =
        parseInt(parts[parts.length - 1]) || new Date(data.program.fyStart).getFullYear();
      if (granularity === "quarter") {
        const q = parseInt((parts[0] || "").replace("Q", "")) || 1;
        return new Date(year, (q - 1) * 3, 1);
      }
      const monthIdx = engine.MONTH_LABELS.indexOf(parts[0]);
      return new Date(year, monthIdx >= 0 ? monthIdx : 0, 1);
    },
    [data.program.fyStart]
  );

  const trajSCurve = useMemo(() => {
    const full = engine.sCurve3(filteredData, trajGranularity);
    const start = new Date(trajRangeStart);
    const end = new Date(trajRangeEnd);
    return full.filter((p) => {
      const d = labelToDate(p.month, trajGranularity);
      return d >= start && d <= end;
    });
  }, [filteredData, trajGranularity, trajRangeStart, trajRangeEnd, labelToDate]);

  const trajBridge = useMemo(() => {
    const full = engine.financialBridge(filteredData, trajGranularity);
    const start = new Date(trajRangeStart);
    const end = new Date(trajRangeEnd);
    return full.filter((p) => {
      const d = labelToDate(p.quarter, trajGranularity);
      return d >= start && d <= end;
    });
  }, [filteredData, trajGranularity, trajRangeStart, trajRangeEnd, labelToDate]);
  const [bridgeGranularity, setBridgeGranularity] = useState<engine.TimeGranularity>("quarter");
  const sCurve = engine.sCurve3(filteredData, sCurveGranularity);
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
  const goToBridgePeriod = (period: string, granularity = bridgeGranularity) =>
    granularity === "quarter"
      ? goToLevers({ f_endQuarter: period })
      : goToLevers({ f_endMonth: period });
  const goToSCurvePoint = (label: string, granularity = sCurveGranularity) =>
    granularity === "quarter"
      ? goToLevers({ f_endQuarter: `${label} ${currentYear}` })
      : goToMonth(label);

  const wsBars = data.workstreams.map((w) => {
    const levers = filteredData.levers.filter((l) => l.ws === w.id && l.status !== "cancelled");
    const realized = engine.workstreamSummary(filteredData, w.id).realized;
    const target = w.target;
    const reforecast =
      Math.round(levers.reduce((s, l) => s + (l.reforecast?.netSavings ?? l.netSavings), 0) * 10) /
      10;
    return {
      label: w.name,
      target,
      realized,
      reforecast: Math.abs(reforecast - target) > 0.05 ? reforecast : undefined,
    };
  });

  /** Calcule les barres (target/realized/reforecast) groupées par une dimension du levier. */
  const dimensionBars = (getKey: (l: Lever) => string) => {
    const active = filteredData.levers.filter((l) => l.status !== "cancelled");
    const groups = new Map<string, Lever[]>();
    active.forEach((l) => {
      const key = getKey(l) || "—";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(l);
    });
    return Array.from(groups.entries())
      .map(([key, levers]) => {
        const target = Math.round(levers.reduce((s, l) => s + l.netSavings, 0) * 10) / 10;
        const realized =
          Math.round(levers.reduce((s, l) => s + engine.realizedSavings(l), 0) * 10) / 10;
        const reforecast =
          Math.round(
            levers.reduce((s, l) => s + (l.reforecast?.netSavings ?? l.netSavings), 0) * 10
          ) / 10;
        return {
          label: key,
          target,
          realized,
          reforecast: Math.abs(reforecast - target) > 0.05 ? reforecast : undefined,
        };
      })
      .sort((a, b) => b.target - a.target);
  };
  const countryBars = dimensionBars((l) => l.country);
  const functionBars = dimensionBars((l) => l.function);

  const programMap = engine.byProgram(visibleData, programs);
  const programBars = [
    ...programs.map((p) => ({
      label: p.name,
      realized: programMap[p.name] ?? 0,
      target: p.target,
    })),
    ...(programMap["Non assigné"]
      ? [{ label: "Non assigné", realized: programMap["Non assigné"], target: 0 }]
      : []),
  ];

  const geoDataFor = (dimension: string) => {
    const map =
      dimension === "function" ? engine.byFunction(filteredData) : engine.byCountry(filteredData);
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  };
  // ── Filtres géographiques du widget P&L (cascade Région → Pays → Entité) ──
  const [pnlFilterGeo, setPnlFilterGeo] = useState("");
  const [pnlFilterCountry, setPnlFilterCountry] = useState("");
  const [pnlFilterEntity, setPnlFilterEntity] = useState("");

  const pnlFilteredLevers = useMemo(() => {
    let levers = filteredData.levers.filter((l) => l.status !== "cancelled");
    if (pnlFilterGeo) levers = levers.filter((l) => l.geography === pnlFilterGeo);
    if (pnlFilterCountry) levers = levers.filter((l) => l.country === pnlFilterCountry);
    if (pnlFilterEntity) levers = levers.filter((l) => l.entity === pnlFilterEntity);
    return levers;
  }, [filteredData, pnlFilterGeo, pnlFilterCountry, pnlFilterEntity]);

  const pnlGeoOptions = useMemo(() => {
    const vals = new Set<string>();
    filteredData.levers.forEach((l) => {
      if (l.geography) vals.add(l.geography);
    });
    return Array.from(vals).sort();
  }, [filteredData]);
  const pnlCountryOptions = useMemo(() => {
    const vals = new Set<string>();
    filteredData.levers
      .filter((l) => !pnlFilterGeo || l.geography === pnlFilterGeo)
      .forEach((l) => {
        if (l.country) vals.add(l.country);
      });
    return Array.from(vals).sort();
  }, [filteredData, pnlFilterGeo]);
  const pnlEntityOptions = useMemo(() => {
    const vals = new Set<string>();
    filteredData.levers
      .filter((l) => !pnlFilterGeo || l.geography === pnlFilterGeo)
      .filter((l) => !pnlFilterCountry || l.country === pnlFilterCountry)
      .forEach((l) => {
        if (l.entity) vals.add(l.entity);
      });
    return Array.from(vals).sort();
  }, [filteredData, pnlFilterGeo, pnlFilterCountry]);

  const pnlFilteredData = useMemo(
    () => ({ ...filteredData, levers: pnlFilteredLevers }),
    [filteredData, pnlFilteredLevers]
  );

  // ── Filtre temporel P&L (cascade Année → Trimestre → Mois) ──
  const fyYear = new Date(data.program.fyStart).getFullYear().toString();
  const [pnlYear, setPnlYear] = useState(fyYear);
  const [pnlQuarter, setPnlQuarter] = useState("");
  const [pnlMonth, setPnlMonth] = useState("");

  const pnlPeriodFilter: engine.PnlPeriodFilter | undefined = useMemo(() => {
    if (!pnlYear) return undefined;
    return {
      year: pnlYear,
      ...(pnlQuarter ? { quarter: pnlQuarter } : {}),
      ...(pnlMonth ? { month: pnlMonth } : {}),
    };
  }, [pnlYear, pnlQuarter, pnlMonth]);

  const pnlQuarterMonths: string[] = useMemo(() => {
    if (!pnlQuarter) return engine.MONTH_LABELS;
    const qIdx = parseInt(pnlQuarter.replace("Q", "")) - 1;
    return engine.MONTH_LABELS.slice(qIdx * 3, qIdx * 3 + 3);
  }, [pnlQuarter]);

  const pnlDetailedData = useMemo(
    () => engine.pnlImpactDetailed(pnlFilteredData, pnlPeriodFilter),
    [pnlFilteredData, pnlPeriodFilter]
  );
  const pnlData = pnlDetailedData.map((d) => ({
    account: d.accountName,
    plan: d.plan,
    realized: d.realized,
  }));

  // Legacy pnlMap kept for non-dashboard consumers (finance page, etc.)
  // const pnlMap = engine.pnlImpact(pnlFilteredData);
  // ─── Layout du dashboard (widgets) ────────────────────────────────────────────────────────
  // Personnalisation d'affichage purement locale (localStorage, par navigateur) — voir
  // lib/dashboardWidgets.ts. Le layout par défaut reproduit exactement l'ancien ordre/tailles
  // fixes, donc rien ne change pour qui n'entre jamais en mode édition.
  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState<DashboardWidgetInstance[]>(buildDefaultLayout);
  const [dragInstanceId, setDragInstanceId] = useState<string | null>(null);
  const [dragOverInstanceId, setDragOverInstanceId] = useState<string | null>(null);
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  // Filtres repliés par défaut sur mobile (< lg) — voir le bouton "Filtres" dans le rendu.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

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
      case "portfolio-funnel":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("dashboard.widgets.portfolioFunnel")} />
            <CardBody>
              <StageFunnel data={stages} onStageClick={goToStage} />
              <div className="my-3 border-t border-border" />
              <SankeyChart data={sankeyChrono} height={260} onNodeClick={goToStageLabel} />
            </CardBody>
          </Card>
        );
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
            <CardHeader
              title={t("dashboard.widgets.alerts")}
              actions={
                <div className="flex items-center gap-2">
                  {/* Compteurs par sévérité (cliquables pour filtrer, avec tooltip) */}
                  <button
                    onClick={() => setManualAlertOpen(true)}
                    className="rounded-sm border border-border px-2 py-0.5 text-[10.5px] font-semibold text-secondary transition hover:border-black hover:text-primary"
                  >
                    + Alerte manuelle
                  </button>
                  {(["red", "amber", "green", "blue"] as const).map((type) => {
                    const count = alertCounts[type];
                    if (count === 0) return null;
                    const isActive = alertTypeFilter === type;
                    const colors: Record<string, string> = {
                      red: isActive ? "bg-rag-red text-white" : "bg-rag-red-light text-rag-red",
                      amber: isActive
                        ? "bg-rag-amber text-white"
                        : "bg-rag-amber-light text-rag-amber",
                      green: isActive
                        ? "bg-rag-green-dark text-white"
                        : "bg-rag-green-light text-rag-green-dark",
                      blue: isActive
                        ? "bg-info-blue text-white"
                        : "bg-info-blue-light text-info-blue",
                    };
                    return (
                      <Tooltip key={type} text={t(`alerts.tooltip.${type}`)} position="bottom">
                        <button
                          onClick={() =>
                            setAlertTypeFilter((prev) => (prev === type ? "all" : type))
                          }
                          className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold transition ${colors[type]}`}
                        >
                          {count}
                        </button>
                      </Tooltip>
                    );
                  })}
                  {/* Toggle résolu / à traiter */}
                  <select
                    className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary"
                    value={alertShowResolved ? "all" : "todo"}
                    onChange={(e) => {
                      setAlertShowResolved(e.target.value === "all");
                      setAlertPage(0);
                    }}
                  >
                    <option value="todo">{t("alerts.toProcess")}</option>
                    <option value="all">{t("alerts.showAll")}</option>
                  </select>
                  {/* Bouton tout résoudre */}
                  <button
                    onClick={markAllResolved}
                    className="rounded-sm px-1.5 py-0.5 text-[10px] font-semibold text-tertiary transition hover:bg-neutral-100 hover:text-primary"
                    title={t("alerts.markAllResolved")}
                  >
                    ✓ {t("alerts.markAllResolved")}
                  </button>
                </div>
              }
            />
            <CardBody>
              {alertsOnPage.length === 0 ? (
                <p className="py-6 text-center text-sm text-tertiary">
                  {t("dashboard.widgets.noAlerts")}
                </p>
              ) : (
                <>
                  {alertsOnPage.map((a) => (
                    <AlertItem
                      key={a.id}
                      alert={a}
                      onClick={() => goToAlert(a)}
                      onToggleResolved={() => toggleAlertResolved(a.id)}
                      scopeLabel={resolveScopeLabel(a.scope)}
                      tooltips={{
                        severity: t(`alerts.tooltip.severity.${a.type}`),
                        impact: t("alerts.tooltip.impact"),
                        auto: t("alerts.tooltip.auto"),
                      }}
                    />
                  ))}
                  {/* Pagination */}
                  {alertPageCount > 1 && (
                    <div className="flex items-center justify-center gap-3 pt-3 mt-2 border-t border-border">
                      <button
                        onClick={() => setAlertPage((p) => Math.max(0, p - 1))}
                        disabled={alertPageClamped === 0}
                        className="flex h-6 w-6 items-center justify-center rounded-sm text-secondary transition hover:bg-neutral-100 disabled:opacity-30"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <span className="text-[11px] font-semibold text-secondary">
                        {t("alerts.page", `Page ${alertPageClamped + 1} / ${alertPageCount}`)
                          .replace("{current}", String(alertPageClamped + 1))
                          .replace("{total}", String(alertPageCount))}
                      </span>
                      <button
                        onClick={() => setAlertPage((p) => Math.min(alertPageCount - 1, p + 1))}
                        disabled={alertPageClamped >= alertPageCount - 1}
                        className="flex h-6 w-6 items-center justify-center rounded-sm text-secondary transition hover:bg-neutral-100 disabled:opacity-30"
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </CardBody>
            <ManualAlertForm
              open={manualAlertOpen}
              onOpenChange={setManualAlertOpen}
              data={visibleData}
              onSubmit={(input) => {
                if (user) data.createManualAlert(input, user);
              }}
            />
          </Card>
        );
      case "savings-trajectory":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t("dashboard.widgets.savingsTrajectory")}
              actions={
                <div className="flex items-center gap-2">
                  {/* Toggle S-Curve / Bridge */}
                  <div className="flex rounded-md border border-border-strong p-0.5 text-[11px] font-semibold">
                    {(["scurve", "bridge"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setTrajView(v)}
                        className={`rounded px-2 py-1 transition ${
                          trajView === v
                            ? "bg-bp-coral text-white"
                            : "text-secondary hover:text-primary"
                        }`}
                      >
                        {v === "scurve"
                          ? t("dashboard.widgets.viewSCurve")
                          : t("dashboard.widgets.viewBridge")}
                      </button>
                    ))}
                  </div>
                  {/* Granularité Mois / Trimestre */}
                  <GranularityToggle value={trajGranularity} onChange={setTrajGranularity} />
                  {/* Range picker libre */}
                  <div className="flex items-center gap-1 text-[10.5px] text-secondary">
                    <span className="font-semibold">{t("dashboard.widgets.dateFrom")}</span>
                    <input
                      type="date"
                      value={trajRangeStart}
                      onChange={(e) => setTrajRangeStart(e.target.value || data.program.fyStart)}
                      className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] focus:border-bp-coral focus:outline-none"
                    />
                    <span className="font-semibold">{t("dashboard.widgets.dateTo")}</span>
                    <input
                      type="date"
                      value={trajRangeEnd}
                      onChange={(e) => setTrajRangeEnd(e.target.value || data.program.fyEnd)}
                      className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] focus:border-bp-coral focus:outline-none"
                    />
                  </div>
                </div>
              }
            />
            <CardBody>
              {trajView === "scurve" ? (
                <SCurveChart
                  data={trajSCurve}
                  height={360}
                  onPointClick={(label) => goToSCurvePoint(label, trajGranularity)}
                  labelActual={t("chart.scurve.actual")}
                  labelPlanned={t("chart.scurve.planned")}
                  labelReforecast={t("chart.scurve.reforecast")}
                />
              ) : (
                <QuarterlyBridgeChart
                  data={trajBridge}
                  height={340}
                  onBarClick={(period) => goToBridgePeriod(period, trajGranularity)}
                  barLabel={
                    trajGranularity === "month"
                      ? t("chart.bridge.monthSavings")
                      : t("chart.bridge.quarterSavings")
                  }
                  labelCumulative={t("chart.bridge.cumulative")}
                  labelPlanned={t("chart.bridge.planned")}
                  plannedCumulative={trajSCurve.map((p) => p.planned)}
                />
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
              <SCurveChart
                data={sCurve}
                height={360}
                onPointClick={goToSCurvePoint}
                labelActual={t("chart.scurve.actual")}
                labelPlanned={t("chart.scurve.planned")}
                labelReforecast={t("chart.scurve.reforecast")}
              />
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
                height={340}
                onBarClick={goToBridgePeriod}
                barLabel={
                  bridgeGranularity === "month"
                    ? t("chart.bridge.monthSavings")
                    : t("chart.bridge.quarterSavings")
                }
                labelCumulative={t("chart.bridge.cumulative")}
                labelPlanned={t("chart.bridge.planned")}
                plannedCumulative={sCurve.map((p) => p.planned)}
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
          activeView?.id === "function-country" ||
          activeView?.id === "workstream-project" ||
          activeView?.id === "workstream-lever";
        const mekko2D = activeView
          ? isLegacy
            ? engine.marimekko2D(filteredData, activeView.id as engine.MarimekkoPairKey, programs)
            : (pivotByDimensions(filteredData, activeView.metric, activeView.dimensions, {
                programs,
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
        const isLegacy =
          activeView?.id === "workstream" ||
          activeView?.id === "country" ||
          activeView?.id === "function" ||
          activeView?.id === "program";
        const barData = activeView
          ? isLegacy
            ? activeView.id === "workstream"
              ? wsBars
              : activeView.id === "country"
                ? countryBars
                : activeView.id === "function"
                  ? functionBars
                  : programBars
            : (
                pivotByDimensions(filteredData, activeView.metric, activeView.dimensions, {
                  programs,
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
                    ? describeCustomView(activeView, hierarchyLevels)
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
              <WorkstreamBarChart
                data={barData}
                labelTarget={t("chart.bar.target")}
                labelRealized={t("chart.bar.realized")}
                labelReforecast={t("chart.bar.reforecast")}
              />
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
                  programs,
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
                <div className="flex items-center gap-2">
                  {views.length > 1 && activeView && (
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
                  )}
                  <select
                    className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary focus:border-bp-coral focus:outline-none"
                    value={pnlFilterGeo}
                    onChange={(e) => {
                      setPnlFilterGeo(e.target.value);
                      setPnlFilterCountry("");
                      setPnlFilterEntity("");
                    }}
                  >
                    <option value="">{t("pnl.allRegions")}</option>
                    {pnlGeoOptions.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary focus:border-bp-coral focus:outline-none"
                    value={pnlFilterCountry}
                    onChange={(e) => {
                      setPnlFilterCountry(e.target.value);
                      setPnlFilterEntity("");
                    }}
                  >
                    <option value="">{t("pnl.allCountries")}</option>
                    {pnlCountryOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary focus:border-bp-coral focus:outline-none"
                    value={pnlFilterEntity}
                    onChange={(e) => setPnlFilterEntity(e.target.value)}
                  >
                    <option value="">{t("pnl.allEntities")}</option>
                    {pnlEntityOptions.map((ent) => (
                      <option key={ent} value={ent}>
                        {ent}
                      </option>
                    ))}
                  </select>
                  {/* Filtres temporels : Année → Trimestre → Mois */}
                  <span className="mx-1 text-[10px] text-tertiary">|</span>
                  <select
                    className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary focus:border-bp-coral focus:outline-none"
                    value={pnlYear}
                    onChange={(e) => {
                      setPnlYear(e.target.value);
                      setPnlQuarter("");
                      setPnlMonth("");
                    }}
                  >
                    <option value={fyYear}>{fyYear}</option>
                  </select>
                  <select
                    className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary focus:border-bp-coral focus:outline-none"
                    value={pnlQuarter}
                    onChange={(e) => {
                      setPnlQuarter(e.target.value);
                      setPnlMonth("");
                    }}
                  >
                    <option value="">{t("pnl.allQuarters")}</option>
                    {["Q1", "Q2", "Q3", "Q4"].map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                  {pnlQuarter && (
                    <select
                      className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary focus:border-bp-coral focus:outline-none"
                      value={pnlMonth}
                      onChange={(e) => setPnlMonth(e.target.value)}
                    >
                      <option value="">{t("pnl.allMonths")}</option>
                      {pnlQuarterMonths.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              }
            />
            <CardBody>
              <PnlBarChart
                data={pnlData}
                labelPlan={t("chart.pnl.plan")}
                labelRealized={t("chart.pnl.realized")}
              />
            </CardBody>
          </Card>
        );
      }
      case "underperformers":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t("dashboard.widgets.underperformers")}
              actions={
                <div className="flex items-center gap-2">
                  {/* Boutons de tri */}
                  {(["gap", "savings"] as const).map((field) => {
                    const isActive = underSort === field;
                    const Icon = isActive && underSortDir === "asc" ? ArrowUp : ArrowDown;
                    return (
                      <button
                        key={field}
                        onClick={() => toggleUnderSort(field)}
                        className={`flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10.5px] font-semibold transition ${
                          isActive
                            ? "bg-bp-coral/10 text-bp-coral"
                            : "text-tertiary hover:bg-neutral-100 hover:text-secondary"
                        }`}
                      >
                        <Icon size={11} />
                        {field === "gap"
                          ? t("dashboard.widgets.sortByDelay")
                          : t("dashboard.widgets.sortBySavings")}
                      </button>
                    );
                  })}
                  <span className="text-[10.5px] font-semibold text-tertiary">
                    {underperformingLevers.length}
                  </span>
                </div>
              }
            />
            <CardBody>
              {sortedUnderperformers.length === 0 ? (
                <p className="py-6 text-center text-sm text-tertiary">
                  {t("dashboard.widgets.noUnderperformers")}
                </p>
              ) : (
                <div className="flex flex-col gap-0">
                  {sortedUnderperformers.slice(0, 8).map((l) => (
                    <div
                      key={l.id}
                      onClick={() => router.push(`/levers/detail?id=${l.id}`)}
                      className="flex cursor-pointer items-start gap-3 border-b border-border py-2.5 last:border-b-0 hover:bg-neutral-50"
                    >
                      <Avatar initials={l.ownerInit} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-[12.5px] font-semibold text-primary">
                            {l.name}
                          </div>
                          <span className="flex-shrink-0 rounded-full bg-bp-coral/10 px-2 py-0.5 text-[10.5px] font-bold text-bp-coral">
                            −{l.gap} {t("dashboard.widgets.gapPts")}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-[11px] text-secondary">
                          <span>
                            {t("dashboard.widgets.expectedProgress")} {l.expectedProgress}%
                          </span>
                          <span>→</span>
                          <span>
                            {t("dashboard.widgets.actualProgress")} {l.progress}%
                          </span>
                          <span className="ml-auto font-semibold text-bp-coral">
                            {engine.fmtCurr(l.netSavings)} {t("dashboard.widgets.atRiskAmount")}
                          </span>
                        </div>
                        <div className="mt-1.5">
                          <ProgressBar pct={l.progress} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        );

      case "dependency-alerts": {
        const depSeverity = (days: number) => {
          if (days > 30) return { label: t("dep.blocking"), cls: "bg-rag-red-light text-rag-red" };
          if (days > 7) return { label: t("dep.watch"), cls: "bg-rag-amber-light text-rag-amber" };
          return { label: t("dep.minor"), cls: "bg-neutral-100 text-secondary" };
        };

        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t("dashboard.widgets.dependencyAlerts")}
              actions={
                <span className="text-[10.5px] font-semibold text-tertiary">
                  {depAlerts.length} alerte{depAlerts.length !== 1 ? "s" : ""}
                </span>
              }
            />
            <CardBody>
              {depAlerts.length === 0 ? (
                <p className="py-6 text-center text-sm text-tertiary">
                  {t("dashboard.widgets.noDependencyAlerts")}
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {depAlerts.slice(0, 6).map((a, i) => {
                    const sev = depSeverity(a.delayDays);
                    const meta = DEPENDENCY_TYPE_META[a.type];
                    return (
                      <div
                        key={`${a.sourceId}-${a.targetId}-${i}`}
                        onClick={() => {
                          router.push(`/levers/detail?id=${a.sourceId}`);
                        }}
                        className="cursor-pointer rounded-lg border border-border p-3 transition hover:border-bp-coral/40 hover:shadow-sm"
                      >
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wide text-tertiary">
                              Règle de planning
                            </div>
                            <div className="mt-1 text-[11px] font-semibold text-primary">
                              {a.type === "FS" && "La cible doit finir avant le début de la source"}
                              {a.type === "SF" &&
                                "La cible doit démarrer avant la fin de la source"}
                              {a.type === "SS" && "Les deux éléments doivent démarrer ensemble"}
                              {a.type === "FF" && "Les deux éléments doivent finir ensemble"}
                            </div>
                          </div>
                          <DependencyTypeBadge type={a.type} />
                        </div>
                        {/* Layout directionnel (FS, SF) : empilé avec connecteur vertical sur
                            mobile (les deux blocs côte à côte débordaient sous ~480px), côte à
                            côte avec flèche dès sm. min-w-0 partout : sans lui, flex-1 refuse de
                            rétrécir sous la largeur du contenu et pousse hors de la carte. */}
                        {meta.directional ? (
                          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-stretch sm:gap-2">
                            <div className="flex min-w-0 flex-1 flex-col rounded-md border border-border bg-neutral-50 p-2">
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-tertiary">
                                {t("dep.blocker")}
                              </div>
                              <div className="mt-0.5 truncate text-[11px] font-bold text-primary">
                                {a.targetName}
                              </div>
                              <div className="mt-0.5 text-[10px] text-secondary">
                                {meta.targetMilestone} : {a.targetDate}
                              </div>
                            </div>
                            <div className="flex items-center justify-center gap-1 text-tertiary sm:flex-col sm:gap-0">
                              <ArrowDown size={14} className="sm:hidden" />
                              <ArrowRight size={14} className="hidden sm:block" />
                              <span className="text-[8px] font-semibold uppercase sm:mt-0.5">
                                {a.type}
                              </span>
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col rounded-md border-2 border-bp-coral/25 bg-bp-coral/[0.03] p-2">
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-bp-coral">
                                {t("dep.blocked")}
                              </div>
                              <div className="mt-0.5 truncate text-[11px] font-bold text-primary">
                                {a.sourceName}
                              </div>
                              <div className="mt-0.5 text-[10px] text-secondary">
                                {meta.sourceMilestone} : {a.sourceDate}
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* Layout symétrique (SS, FF) : empilé, les 2 leviers en style "à risque" */
                          <div className="overflow-hidden rounded-md border-2 border-bp-coral/25">
                            <div className="border-b border-bp-coral/15 bg-bp-coral/[0.03] p-2">
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-bp-coral">
                                {t("dep.atRisk")}
                              </div>
                              <div className="mt-0.5 truncate text-[11px] font-bold text-primary">
                                {a.sourceName}
                              </div>
                              <div className="mt-0.5 text-[10px] text-secondary">
                                {meta.sourceMilestone} : {a.sourceDate}
                              </div>
                            </div>
                            <div className="flex items-center justify-center gap-1.5 py-1 text-[9px] font-semibold text-tertiary">
                              <ArrowUpDown size={10} />
                              {a.type}
                            </div>
                            <div className="bg-bp-coral/[0.03] p-2">
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-bp-coral">
                                {t("dep.atRisk")}
                              </div>
                              <div className="mt-0.5 truncate text-[11px] font-bold text-primary">
                                {a.targetName}
                              </div>
                              <div className="mt-0.5 text-[10px] text-secondary">
                                {meta.targetMilestone} : {a.targetDate}
                              </div>
                            </div>
                          </div>
                        )}
                        {/* Barre de pied : sévérité + retard + type + impact € — flex-wrap pour
                            que l'impact € passe à la ligne au lieu de déborder sur mobile. */}
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
                          <span className={`rounded-full px-2 py-0.5 font-bold ${sev.cls}`}>
                            {sev.label}
                          </span>
                          <span className="text-secondary">
                            {a.delayDays}{" "}
                            {meta.directional ? t("dep.delayDays") : t("dep.offsetDays")}
                          </span>
                          {a.impactEur > 0 && (
                            <span className="ml-auto font-bold text-bp-coral">
                              {engine.fmtCurr(a.impactEur)} {t("dep.atRisk")}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardBody>
          </Card>
        );
      }

      default:
        return null;
    }
  };

  // Aucun programme configuré pour l'entreprise (ou l'utilisateur n'en a pas encore choisi un
  // parmi ceux disponibles) → écran vide guidant vers la création d'un programme, plutôt qu'un
  // dashboard vide/incohérent (aucun levier ne peut être scopé sans programme).
  if (programs.length === 0) {
    return (
      <div className="animate-fade-up">
        <div className="mb-5">
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {t("dashboard.title")}
          </h1>
        </div>
        <div className="rounded-lg border border-border bg-white p-10 text-center">
          <p className="mx-auto max-w-md text-sm text-secondary">
            Aucun programme n&apos;a encore été créé pour votre entreprise. Créez-en un dans Admin
            &gt; Entreprises &gt; Programmes, puis rattachez-y des leviers.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {t("dashboard.title")}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px] text-secondary">
            {t("dashboard.program")} <strong>{data.program.name}</strong> · {summary.leverCount}{" "}
            {t("dashboard.leversActive")}
            <select
              value={selectedProgramId}
              onChange={(e) => handleProgramChange(e.target.value)}
              className="ml-1 rounded-sm border border-border bg-white px-2 py-0.5 text-[12px] font-semibold text-primary focus:border-bp-coral focus:outline-none"
            >
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {/* Outils de bureau (export PPTX, personnalisation du layout) — sans objet au doigt
            sur téléphone : masqués sous lg pour laisser toute la place aux indicateurs. */}
        <div className="hidden items-center gap-2 lg:flex">
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

      {/* Filtres — repliés par défaut sur mobile derrière un bouton (ils poussaient les KPI
          sous la ligne de flottaison), toujours visibles à partir de lg. */}
      <div className="mb-4 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileFiltersOpen((v) => !v)}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
            hasActiveFilters || mobileFiltersOpen
              ? "border-bp-coral bg-bp-coral text-white"
              : "border-border bg-white text-secondary"
          }`}
        >
          <SlidersHorizontal size={12} />
          {t("dashboard.filters")}
          {hasActiveFilters && (
            <span className="rounded-full bg-white/25 px-1.5 text-[10px] font-bold">
              {Object.keys(activeForBar).length}
            </span>
          )}
        </button>
        {mobileFiltersOpen && (
          <div className="mt-2">
            <FilterBar
              items={programScopedLevers}
              defs={filterDefs}
              active={activeForBar}
              onChange={handleFilterChange}
            />
          </div>
        )}
      </div>
      <div className="mb-4 hidden lg:block">
        <FilterBar
          items={programScopedLevers}
          defs={filterDefs}
          active={activeForBar}
          onChange={handleFilterChange}
        />
      </div>

      {/* Grille KPI — desktop : 5 colonnes égales. Mobile/tablette (< 1100px) : hiérarchie
          exécutive — "Économies réalisées" (l'indicateur que DG/CTO regardent en premier) passe
          héros pleine largeur avec chiffre agrandi, les 4 autres en 2×2 compact dessous. */}
      <div className="mb-4 grid grid-cols-5 gap-3.5 max-[1100px]:grid-cols-2 max-[1100px]:gap-3">
        {/* 1. Économies réalisées — cible + reforecast + % (marqueur sur la barre) */}
        <KPICard
          label={t("dashboard.kpi.savingsRealized")}
          value={engine.fmtCurr(summary.realized)}
          icon={Banknote}
          hero
          className="max-[1100px]:col-span-2"
          sub={`${t("dashboard.kpi.target")} ${engine.fmtCurr(summary.target)} · ${t("dashboard.kpi.reforecast")} ${engine.fmtCurr(summary.reforecastTarget)} · ${summary.progressPct}%`}
          barPct={summary.progressPct}
          barMarkerPct={
            summary.target > 0
              ? Math.round((summary.reforecastTarget / summary.target) * 100)
              : undefined
          }
          onClick={() => goToLevers({})}
        />
        {/* 2. CAPEX & coûts one-off — engagé vs plan + % + marqueur reforecast */}
        <KPICard
          label={t("dashboard.kpi.implementationCosts")}
          value={engine.fmtCurr(summary.engagedCosts)}
          icon={TrendingUp}
          accent="brown"
          sub={`${t("dashboard.kpi.plan")} ${engine.fmtCurr(summary.plannedCosts)} · ${t("dashboard.kpi.reforecast")} ${engine.fmtCurr(summary.reforecastCosts)} · ${summary.plannedCosts > 0 ? Math.round((summary.engagedCosts / summary.plannedCosts) * 100) : 0}%`}
          barPct={
            summary.plannedCosts > 0
              ? Math.round((summary.engagedCosts / summary.plannedCosts) * 100)
              : 0
          }
          barMarkerPct={
            summary.plannedCosts > 0
              ? Math.round((summary.reforecastCosts / summary.plannedCosts) * 100)
              : undefined
          }
          onClick={() => router.push("/finance")}
        />
        {/* 3. Leviers réalisés — barre delivered/total + % */}
        <KPICard
          label={t("dashboard.kpi.leversDelivered")}
          value={`${summary.delivered} / ${summary.leverCount}`}
          icon={CircleCheck}
          accent="green"
          sub={`${summary.leverCount > 0 ? Math.round((summary.delivered / summary.leverCount) * 100) : 0}%`}
          barPct={
            summary.leverCount > 0 ? Math.round((summary.delivered / summary.leverCount) * 100) : 0
          }
          onClick={() => goToLevers({ f_status: lifecycle.label("delivered") })}
        />
        {/* 4. Leviers à risque — barre segmentée par catégorie (délais / surcoûts / savings) */}
        <KPICard
          label={t("dashboard.kpi.leversAtRisk")}
          value={String(summary.atRisk + summary.critical)}
          icon={TriangleAlert}
          accent="amber"
          sub={`${summary.riskDelay} ${t("dashboard.kpi.riskDelay")} · ${summary.riskCostOverrun} ${t("dashboard.kpi.riskCost")} · ${summary.riskSavingsCut} ${t("dashboard.kpi.riskSavings")}`}
          barSegments={(() => {
            const totalRisk = summary.riskDelay + summary.riskCostOverrun + summary.riskSavingsCut;
            if (totalRisk === 0) return [];
            return [
              { pct: (summary.riskDelay / totalRisk) * 100, className: "bg-rag-amber" },
              { pct: (summary.riskCostOverrun / totalRisk) * 100, className: "bg-rag-red" },
              { pct: (summary.riskSavingsCut / totalRisk) * 100, className: "bg-bp-warm-brown" },
            ];
          })()}
          onClick={() => goToLevers({})}
        />
        {/* 5. ETP impactés — fteImpact comme valeur, suppressions comme barre + % */}
        <KPICard
          label={t("dashboard.kpi.fteImpacted")}
          value={String(summary.fteImpact)}
          icon={Users}
          sub={`${engine.fmtInt(summary.suppressionsRealized)} / ${engine.fmtInt(summary.suppressionsPlanned)} ${t("dashboard.kpi.suppressions")} · ${summary.suppressionsPlanned > 0 ? Math.round((summary.suppressionsRealized / summary.suppressionsPlanned) * 100) : 0}%`}
          barPct={
            summary.suppressionsPlanned > 0
              ? Math.round((summary.suppressionsRealized / summary.suppressionsPlanned) * 100)
              : 0
          }
          onClick={() => router.push("/hr")}
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

      {/* Grille unique — tous les widgets sur la même page, sans onglets ni sections */}
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
