"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useGlobalFilters, matchesGlobalFilters } from "@/lib/hooks/useGlobalFilters";
import { FilterBar, type ActiveFilters, type FilterDef } from "@/components/shared/FilterBar";
import {
  Banknote,
  CircleCheck,
  GripVertical,
  LayoutGrid,
  Maximize2,
  Plus,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useRole } from "@/lib/hooks/useRole";
import { useLifecycleLabels } from "@/lib/hooks/useLifecycleLabels";
import {
  subscribeBestPracticeRules,
  subscribeCompanies,
  subscribeProjects,
} from "@/lib/firestore/admin";
import type { BestPracticeRule, Company, Project } from "@/types";
import * as engine from "@/lib/engine";
import { KPICard } from "@/components/shared/KPICard";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { AlertItem } from "@/components/shared/AlertItem";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { Avatar } from "@/components/shared/Avatar";
import { ExcelUploadButton } from "@/components/shared/ExcelUploadButton";
import { ExportButton } from "@/components/shared/ExportButton";
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
  addWidget,
  buildDefaultLayout,
  cycleSpan,
  getWidgetDef,
  loadDashboardLayout,
  moveWidget,
  removeWidget,
  saveDashboardLayout,
  setWidgetSpan,
  type DashboardWidgetInstance,
  type DashboardWidgetType,
} from "@/lib/dashboardWidgets";

export default function DashboardPage() {
  const { user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);
  const lifecycle = useLifecycleLabels(user?.companyId);
  const router = useRouter();
  const { filters, setFilter, resetFilters } = useGlobalFilters();

  // Règles "bonnes pratiques" de l'entreprise — concept distinct des `Alert` manuelles
  // (voir la carte "Alerts & Notifications" plus bas) : ici on signale les catégories de
  // leviers attendues qui n'ont aucune couverture actuellement.
  const [bestPracticeRules, setBestPracticeRules] = useState<BestPracticeRule[]>([]);
  useEffect(() => {
    if (!user?.companyId) {
      setBestPracticeRules([]);
      return;
    }
    const unsub = subscribeBestPracticeRules(user.companyId, setBestPracticeRules);
    return unsub;
  }, [user?.companyId]);
  const bestPracticeGaps = engine
    .bestPracticeGaps(data, bestPracticeRules)
    .filter((g) => !g.hasMatch);

  // Société courante — utilisée pour le budget CAPEX de référence (KPI ci-dessous) et
  // l'habilitation de confidentialité (filtrage des leviers visibles par profil).
  const [company, setCompany] = useState<Company | null>(null);
  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      setCompany(companies.find((c) => c.id === user?.companyId) ?? null);
    });
    return unsub;
  }, [user?.companyId]);

  const clearance = user ? (company?.roleClearance?.[user.role] ?? []) : [];
  const visibleLevers = useMemo(
    () =>
      data.levers.filter(
        (l) =>
          !l.confidentialityLevel ||
          user?.role === "admin" ||
          user?.role === "admin_entreprise" ||
          clearance.includes(l.confidentialityLevel)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.levers, user?.role, company?.roleClearance]
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
  const sankey = engine.sankeyData(filteredData);
  const sankeyChrono = engine.sankeyChronology(filteredData);
  const mekko = engine.marimekko(filteredData);
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

  const [wsDimension, setWsDimension] = useState<"workstream" | "project">("workstream");
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

  const [geoDimension, setGeoDimension] = useState<"country" | "function">("country");
  const geoMap =
    geoDimension === "country" ? engine.byCountry(filteredData) : engine.byFunction(filteredData);
  const geoData = Object.entries(geoMap).map(([name, value]) => ({ name, value }));
  const pnlMap = engine.pnlImpact(filteredData);
  const pnlData = Object.entries(pnlMap).map(([id, impact]) => ({
    account: data.pnlAccounts.find((a) => a.id === id)?.name ?? id,
    impact,
  }));
  const activeScenario = data.scenarios.find((s) => s.id === data.activeScenario);

  // ─── Layout du dashboard (widgets) ────────────────────────────────────────────────────────
  // Personnalisation d'affichage purement locale (localStorage, par navigateur) — voir
  // lib/dashboardWidgets.ts. Le layout par défaut reproduit exactement l'ancien ordre/tailles
  // fixes, donc rien ne change pour qui n'entre jamais en mode édition.
  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState<DashboardWidgetInstance[]>(buildDefaultLayout);
  const [dragInstanceId, setDragInstanceId] = useState<string | null>(null);
  const [dragOverInstanceId, setDragOverInstanceId] = useState<string | null>(null);
  const [addWidgetChoice, setAddWidgetChoice] = useState("");

  useEffect(() => {
    setLayout(loadDashboardLayout());
  }, []);

  const updateLayout = (next: DashboardWidgetInstance[]) => {
    setLayout(next);
    saveDashboardLayout(next);
  };

  const availableToAdd = DASHBOARD_WIDGET_REGISTRY.filter(
    (def) => !layout.some((w) => w.type === def.type)
  );

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
              className="cursor-grab px-0.5 text-tertiary active:cursor-grabbing"
              title="Glisser pour réordonner"
            >
              <GripVertical size={14} />
            </span>
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
              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-neutral-100 hover:text-primary"
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
            <CardHeader title="Avancement des leviers par étape du cycle de vie" />
            <CardBody>
              <StageFunnel data={stages} onStageClick={goToStage} />
            </CardBody>
          </Card>
        );
      case "alerts":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Alerts & Notifications" />
            <CardBody>
              {data.alerts.slice(0, 5).map((a) => (
                <AlertItem key={a.id} alert={a} onClick={() => goToAlert(a)} />
              ))}
              {data.alerts.length === 0 && (
                <p className="py-6 text-center text-sm text-tertiary">Aucune alerte active</p>
              )}
            </CardBody>
          </Card>
        );
      case "best-practices":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Bonnes pratiques" />
            <CardBody>
              <div className="grid grid-cols-2 gap-x-6 max-[900px]:grid-cols-1">
                {bestPracticeGaps.map(({ rule }) => (
                  <div
                    key={rule.id}
                    className="flex gap-3 border-b border-border py-3 last:border-b-0"
                  >
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm bg-rag-amber-light text-rag-amber">
                      <ShieldCheck size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-semibold text-primary">{rule.label}</div>
                      <div className="mt-0.5 text-[11.5px] text-secondary">{rule.description}</div>
                      <div className="mt-1 text-[10.5px] text-tertiary">
                        Aucun levier ne couvre ce point — est-ce normal ?
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {bestPracticeGaps.length === 0 && (
                <p className="py-6 text-center text-sm text-tertiary">Aucun manquement détecté</p>
              )}
            </CardBody>
          </Card>
        );
      case "s-curve":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title="S-Curve — Plan initial / Réalisé / Réactualisé"
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
                  ? "Économies par trimestre → cible"
                  : "Économies par mois → cible"
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
            <CardHeader title="Flux des leviers par étape (Sankey)" />
            <CardBody>
              <SankeyChart
                data={sankey}
                chronologyData={sankeyChrono}
                height={300}
                onNodeClick={goToStageLabel}
              />
            </CardBody>
          </Card>
        );
      case "marimekko":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Savings par fonction (Marimekko)" />
            <CardBody>
              <MarimekkoChart
                data={mekko}
                height={300}
                onSegmentClick={(func) => goToLevers({ f_function: func })}
              />
            </CardBody>
          </Card>
        );
      case "workstream-breakdown":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={wsDimension === "workstream" ? "Savings par Workstream" : "Savings par Projet"}
              actions={
                <DimensionToggle
                  options={[
                    { value: "workstream", label: "Workstream" },
                    { value: "project", label: "Projet" },
                  ]}
                  value={wsDimension}
                  onChange={setWsDimension}
                />
              }
            />
            <CardBody>
              <WorkstreamBarChart data={wsDimension === "workstream" ? wsBars : projectBars} />
            </CardBody>
          </Card>
        );
      case "geo-breakdown":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={geoDimension === "country" ? "Savings par Pays" : "Savings par Fonction"}
              actions={
                <DimensionToggle
                  options={[
                    { value: "country", label: "Pays" },
                    { value: "function", label: "Fonction" },
                  ]}
                  value={geoDimension}
                  onChange={setGeoDimension}
                />
              }
            />
            <CardBody>
              <GeoDonutChart data={geoData} />
            </CardBody>
          </Card>
        );
      case "workstream-table":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Synthèse des Workstreams" />
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
            <CardHeader title="Dépendances inter-leviers (top 5)" />
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
      case "pnl":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Impact P&L par compte" />
            <CardBody>
              <PnlBarChart data={pnlData} />
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
            Executive Dashboard
          </h1>
          <div className="mt-2.5 text-[13px] text-secondary">
            Programme <strong>{data.program.name}</strong> · {summary.leverCount} leviers actifs ·
            Scénario : {activeScenario?.name}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExcelUploadButton data={data} companyId={user?.companyId ?? null} />
          <ExportButton type="pptx" />
          <Button
            variant={editMode ? "dark" : "outline"}
            size="md"
            onClick={() => setEditMode((v) => !v)}
          >
            <LayoutGrid size={14} />
            {editMode ? "Terminer" : "Personnaliser"}
          </Button>
          <select
            value={data.activeScenario}
            onChange={(e) => data.setActiveScenario(e.target.value)}
            className="rounded-md border border-border-strong bg-white px-3 py-2 text-[13px] font-semibold text-primary"
          >
            {data.scenarios.map((sc) => (
              <option key={sc.id} value={sc.id}>
                Scénario : {sc.name}
              </option>
            ))}
          </select>
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

      <div className="mb-4 grid grid-cols-5 gap-3.5 max-[1100px]:grid-cols-2">
        <KPICard
          label="Savings réalisés YTD"
          value={engine.fmtCurr(summary.realized)}
          icon={Banknote}
          sub={`vs. cible ${engine.fmtCurr(summary.target)} · ${summary.progressPct}%`}
          barPct={summary.progressPct}
        />
        <KPICard
          label="Leviers Delivered"
          value={`${summary.delivered} / ${summary.leverCount}`}
          icon={CircleCheck}
          accent="green"
        />
        <KPICard
          label="Leviers At Risk"
          value={String(summary.atRisk)}
          icon={TriangleAlert}
          accent="amber"
          sub={`${summary.critical} critiques · à surveiller`}
        />
        <KPICard
          label="CAPEX engagé"
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
          label="ETP impactés"
          value={String(summary.fteImpact)}
          icon={Users}
          sub={`${engine.fmtInt(summary.popImpacted)} pers. concernées`}
        />
      </div>

      {editMode && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border-strong bg-neutral-50 p-3">
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-secondary">
            <Plus size={14} /> Ajouter un widget :
          </span>
          <select
            value={addWidgetChoice}
            onChange={(e) => {
              const type = e.target.value as DashboardWidgetType;
              if (type) updateLayout(addWidget(layout, type));
              setAddWidgetChoice("");
            }}
            className="rounded-md border border-border-strong bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-primary disabled:opacity-50"
            disabled={availableToAdd.length === 0}
          >
            <option value="">
              {availableToAdd.length === 0 ? "Tous les widgets sont déjà affichés" : "Choisir…"}
            </option>
            {availableToAdd.map((def) => (
              <option key={def.type} value={def.type}>
                {def.label}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateLayout(buildDefaultLayout())}
            className="ml-auto"
          >
            <RotateCcw size={13} />
            Réinitialiser
          </Button>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
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
          {g === "month" ? "Mois" : "Trimestre"}
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
