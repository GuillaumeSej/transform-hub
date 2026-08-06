"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  LayoutGrid,
  Lock,
  Maximize2,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useRole } from "@/lib/hooks/useRole";
import { useLifecycleLabels } from "@/lib/hooks/useLifecycleLabels";
import * as hr from "@/lib/hrEngine";
import {
  movementRhythmSeries,
  netEconomySeries,
  salarySavingsSeries,
  socialCostSeries,
} from "@/lib/hrTimeSeries";
import { hrProgramSummary, targetFteFromBaseline } from "@/lib/hrProgramSummary";
import { fmtCurr } from "@/lib/engine";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { HrKPICard } from "@/components/shared/HrKPICard";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { ICON_REGISTRY } from "@/components/shared/icon-registry";
import { DashboardExportButton } from "@/components/shared/DashboardExportButton";
import {
  FteWaterfallChart,
  FteWaterfallLegend,
} from "@/components/shared/charts/FteWaterfallChart";
import { DepartmentMovementsChart } from "@/components/shared/charts/HrBreakdownCharts";
import { ExecutionStatusChart } from "@/components/shared/charts/HrExecutionCharts";
import { HrOwnerActionTable } from "@/components/shared/HrOwnerActionTable";
import {
  EnrPeriodCumulChart,
  EtpBridgeChart,
  MovementRhythmChart,
  NetEconomyChart,
  SavingsPeriodCumulChart,
} from "@/components/shared/charts/HrGooduelleCharts";
import { FilterBar, type ActiveFilters, type FilterDef } from "@/components/shared/FilterBar";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import { generateFiscalYears } from "@/lib/fiscalYear";
import type { MovementAlertKind } from "@/lib/hrEngine";
import type { MovementStatus, Program, SocialScheme, WorkforceMovement } from "@/types";
import { subscribePrograms } from "@/lib/firestore/admin";
import { buildMovementTableRows, type HrMovementTableRow } from "@/lib/hrMovementTable";
import { movementSocialSchemePatch, movementStatusPatch } from "@/lib/workforceLogic";
import {
  fteExecutionByDimension,
  EXECUTION_LABELS,
  ownerActionSummary,
  salaryExecutionByDimension,
  type ExecutionDimension,
  type MovementExecutionStatus,
} from "@/lib/hrExecution";
import {
  HR_METRIC_REGISTRY,
  HR_DIMENSION_REGISTRY,
  getHrMetricDef,
  getHrDimensionDef,
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
  const [granularity, setGranularity] = useState<"month" | "quarter" | "year">("quarter");
  const [drillBucket, setDrillBucket] = useState<string | null>(null);

  // ─── Sélecteur de programme (source unique = collection Firestore multi-programmes) ─────
  // Le dashboard RH s'abonne à la même collection `programs` que le dashboard exécutif (voir
  // subscribePrograms de lib/firestore/admin.ts). L'ancien fallback sur [data.program]
  // (slot mono-programme ProgramConfig, id "PRG-2026") a été retiré Août 2026 : il ne
  // pointait pas vers le même id que celui utilisé côté leviers et mouvements ("p1"), ce qui
  // faisait apparaître un sélecteur avec un programme fantôme qui n'était l'ancre d'aucun
  // mouvement scopé.
  const [programs, setPrograms] = useState<Program[]>([]);
  useEffect(() => {
    const unsub = subscribePrograms((all) =>
      setPrograms(user?.companyId ? all.filter((p) => p.companyId === user.companyId) : all)
    );
    return unsub;
  }, [user?.companyId]);
  const [selectedProgramId, setSelectedProgramId] = useState<string>("");
  useEffect(() => {
    if (!selectedProgramId && programs.length > 0) setSelectedProgramId(programs[0].id);
  }, [programs, selectedProgramId]);
  const activeProgram = programs.find((p) => p.id === selectedProgramId) ?? programs[0] ?? null;

  // ─── Range picker + presets FY (Août 2026) ─────────────────────────────────
  // Plage réelle des mouvements en base (min/max des plannedDate). Sert de valeur initiale au
  // range picker, de borne min/max de l'input, ET de plage pour le preset "Programme complet"
  // + les presets FY (générés sur cette plage plutôt que sur activeProgram.fyStart/fyEnd, sinon
  // les mouvements des exercices ultérieurs seraient invisibles).
  const movementDateRange = useMemo(() => {
    const dates = data.workforce.movements
      .map((m) => m.plannedDate)
      .filter((d): d is string => !!d)
      .sort();
    if (dates.length === 0) {
      return {
        from: activeProgram?.fyStart ?? "2026-01-01",
        to: activeProgram?.fyEnd ?? "2028-12-31",
      };
    }
    return { from: dates[0], to: dates[dates.length - 1] };
  }, [data.workforce.movements, activeProgram?.fyStart, activeProgram?.fyEnd]);

  const [dateFromISO, setDateFromISO] = useState<string>(movementDateRange.from);
  const [dateToISO, setDateToISO] = useState<string>(movementDateRange.to);
  useEffect(() => {
    setDateFromISO(movementDateRange.from);
    setDateToISO(movementDateRange.to);
  }, [movementDateRange.from, movementDateRange.to]);

  // ─── Filtres RH (même pattern que le dashboard exécutif) ────────────────────────────────────
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({});
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const filterDefs: FilterDef<WorkforceMovement>[] = useMemo(
    () => [
      { key: "type", label: "Type", getValue: (m) => m.type },
      { key: "workstream", label: "Workstream", getValue: (m) => m.workstream || "—" },
      { key: "function", label: "Fonction", getValue: (m) => m.function || "—" },
      { key: "department", label: "Département", getValue: (m) => m.department },
      { key: "country", label: "Pays", getValue: (m) => m.country },
      { key: "status", label: "Statut", getValue: (m) => m.status },
      { key: "hrOwner", label: "Owner RH", getValue: (m) => m.hrOwner },
    ],
    []
  );

  const wf = data.workforce;

  // Mouvements filtrés — alimente TOUS les calculs du dashboard quand un filtre ou le range
  // picker sont actifs. Le filtre par programme est appliqué en premier (scope), suivi du range
  // picker (dateFromISO/ToISO) puis des filtres FilterBar (types, workstream, fonction, pays, …).
  const filteredMovements = useMemo(() => {
    const keys = Object.keys(activeFilters);
    return wf.movements.filter((m) => {
      // Scope programme (aujourd'hui mono-programme mock, mais évolutif multi-programmes).
      if (selectedProgramId && m.programId && m.programId !== selectedProgramId) return false;
      // Range picker temporel.
      if (m.plannedDate < dateFromISO || m.plannedDate > dateToISO) return false;
      // FilterBar (nominal).
      for (const key of keys) {
        const values = activeFilters[key];
        if (!values || values.length === 0) continue;
        const def = filterDefs.find((d) => d.key === key);
        if (def && !values.includes(def.getValue(m))) return false;
      }
      return true;
    });
  }, [wf.movements, activeFilters, filterDefs, selectedProgramId, dateFromISO, dateToISO]);

  const hasActiveFilters = Object.keys(activeFilters).length > 0;

  // Workforce virtuelle filtrée — remplace `wf` dans tous les calculs pour que les graphiques
  // réagissent aux filtres exactement comme le dashboard exécutif.
  const filteredWf = useMemo(
    () => ({ ...wf, movements: filteredMovements }),
    [wf, filteredMovements]
  );

  const alerts = useMemo(
    () => hr.movementAlerts(filteredWf, data.levers),
    [filteredWf, data.levers]
  );
  const bridge = useMemo(
    () => hr.fteBridge(filteredWf, granularity, { from: dateFromISO, to: dateToISO }),
    [filteredWf, granularity, dateFromISO, dateToISO]
  );
  const salary = useMemo(
    () => hr.salaryBridge(filteredWf, granularity, { from: dateFromISO, to: dateToISO }),
    [filteredWf, granularity, dateFromISO, dateToISO]
  );
  const pse = useMemo(() => hr.pseSummary(filteredWf), [filteredWf]);

  // ─── Gooduelle series (Août 2026) ────────────────────────────────────────────
  // Plage de dates pilotée par le range picker + presets FY côté page (voir dateFromISO/ToISO).
  const dateRange = useMemo(() => ({ from: dateFromISO, to: dateToISO }), [dateFromISO, dateToISO]);

  const savingsSeries = useMemo(
    () => salarySavingsSeries(filteredMovements, granularity, dateRange, hr.HR_TODAY),
    [filteredMovements, granularity, dateRange]
  );
  const enrSeries = useMemo(
    () => socialCostSeries(filteredMovements, granularity, dateRange),
    [filteredMovements, granularity, dateRange]
  );
  const netEcoSeries = useMemo(
    () => netEconomySeries(filteredMovements, granularity, dateRange),
    [filteredMovements, granularity, dateRange]
  );
  const rhythmSeries = useMemo(
    () => movementRhythmSeries(filteredMovements, granularity, dateRange),
    [filteredMovements, granularity, dateRange]
  );
  const bridgeSummary = useMemo(
    () => hr.fteBridgeSummary(filteredWf, dateRange),
    [filteredWf, dateRange]
  );
  const summary = useMemo(() => hrProgramSummary(filteredMovements), [filteredMovements]);
  const movementTableRows = useMemo(
    () => buildMovementTableRows(filteredMovements, data.levers, programs),
    [filteredMovements, data.levers, programs]
  );
  const canEditMovements = user?.role === "hr" || user?.role === "cto";
  const socialSchemeOptions = ["—", "PSE", "RC", "RCC", "PDV", "Autre"];
  const movementStatusOptions: MovementStatus[] = ["Planifié", "En cours", "Réalisé"];

  const movementTableColumns: ColumnDef<HrMovementTableRow>[] = [
    { key: "label", label: "Mouvement", mobile: "primary" },
    { key: "type", label: "Type", options: hr.MOVEMENT_TYPES },
    { key: "programName", label: "Programme" },
    {
      key: "socialScheme",
      label: "Dispositif social",
      options: socialSchemeOptions,
      render: (row) =>
        canEditMovements && row.type === "Départ forcé" ? (
          <select
            value={row.socialScheme}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              event.stopPropagation();
              handleMovementTableUpdate(row.id, "socialScheme", event.target.value);
            }}
            className="w-full min-w-[90px] rounded-sm border border-border bg-white px-1.5 py-1 text-xs focus:border-black focus:outline-none"
          >
            {socialSchemeOptions.map((scheme) => (
              <option key={scheme} value={scheme}>
                {scheme}
              </option>
            ))}
          </select>
        ) : (
          row.socialScheme
        ),
    },
    { key: "department", label: "Département" },
    { key: "country", label: "Pays" },
    { key: "initiativeOwner", label: "Owner Initiative" },
    { key: "hrOwner", label: "Owner RH" },
    { key: "fte", label: "ETP", align: "right" },
    { key: "plannedDate", label: "Date prévisionnelle" },
    {
      key: "status",
      label: "Statut",
      options: movementStatusOptions,
      render: (row) =>
        canEditMovements ? (
          <select
            value={row.status}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              event.stopPropagation();
              handleMovementTableUpdate(row.id, "status", event.target.value);
            }}
            className="w-full min-w-[100px] rounded-sm border border-border bg-white px-1.5 py-1 text-xs focus:border-black focus:outline-none"
          >
            {movementStatusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        ) : (
          row.status
        ),
    },
    {
      key: "actualDate",
      label: "Date effective",
      editable: canEditMovements,
      type: "date",
      render: (row) => row.actualDate || "—",
    },
    {
      key: "comment",
      label: "Commentaire",
      editable: canEditMovements,
      type: "textarea",
      render: (row) => row.comment || "—",
    },
    {
      key: "salaryImpact",
      label: "Impact salarial",
      align: "right",
      render: (row) => fmtCurr(row.salaryImpact / 1_000_000),
    },
    {
      key: "cost",
      label: "Coût social",
      align: "right",
      render: (row) => fmtCurr(row.cost / 1_000_000),
    },
  ];

  const handleMovementTableUpdate = (
    rowId: string,
    field: keyof HrMovementTableRow,
    value: string | number
  ) => {
    if (!canEditMovements) return;
    const row = movementTableRows.find((item) => item.id === rowId);
    if (!row) return;
    if (field === "status") {
      data.updateWorkforceMovement(
        rowId,
        movementStatusPatch(row.movement, String(value) as MovementStatus)
      );
      return;
    }
    if (field === "actualDate") {
      const actualDate = String(value) || null;
      data.updateWorkforceMovement(rowId, {
        actualDate,
        status: actualDate ? "Réalisé" : "En cours",
        ...(actualDate ? {} : { hrValidated: false }),
      });
      return;
    }
    if (field === "comment") {
      data.updateWorkforceMovement(rowId, { comment: String(value) || undefined });
      return;
    }
    if (field === "socialScheme") {
      data.updateWorkforceMovement(
        rowId,
        movementSocialSchemePatch(
          String(value) === "—" ? undefined : (String(value) as SocialScheme)
        )
      );
    }
  };
  const current = hr.currentFTE(filteredWf);
  // Cible ETP bottom-up : baseline + réductions/créations prévues dans les mouvements.
  // L'ancienne cible reposait sur les fteTarget départementaux figés (2 600 ETP), sans lien
  // avec la cible du KPI Impact ETP calculée depuis les lockedPlan des mouvements filtrés.
  const target = targetFteFromBaseline(wf.totalFTE, summary.fte.target);
  const landing = hr.plannedFTE(filteredWf);
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

  const realizedMovements = filteredMovements.filter((m) => m.status === "Réalisé").length;

  const goToEtp = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    router.push(`/hr/etp${qs ? `?${qs}` : ""}`);
  };
  const goToExecution = (
    value: string,
    dimension: ExecutionDimension,
    status: MovementExecutionStatus
  ) => {
    const dimensionParam =
      dimension === "function" ? "f_function" : dimension === "country" ? "f_country" : "f_program";
    const dimensionValue =
      dimension === "program"
        ? (programs.find((program) => program.name === value)?.id ?? value)
        : value;
    const executionValue =
      status === "upcoming"
        ? `${EXECUTION_LABELS.dueSoon},${EXECUTION_LABELS.later}`
        : status === "realized"
          ? `${EXECUTION_LABELS.realized},${EXECUTION_LABELS.toValidate}`
          : EXECUTION_LABELS[status];
    const params = new URLSearchParams({
      tab: "mouvements",
      [dimensionParam]: dimensionValue,
      f_execution: executionValue,
    });
    router.push(`/hr/etp?${params.toString()}`);
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

  /** Sélecteur granularité seul — partagé entre widgets à axe temporel. Les autres contrôles
   *  (presets FY, range picker) sont dans la barre transverse au-dessus du grid, pas dans
   *  chaque CardHeader (voir Août 2026). */
  const timeControls = (
    <div className="flex overflow-hidden rounded-md border border-border">
      {(["month", "quarter", "year"] as const).map((g) => (
        <button
          key={g}
          onClick={() => setGranularity(g)}
          className={`px-2.5 py-1 text-[11px] font-semibold ${granularity === g ? "bg-neutral-900 text-white" : "bg-white text-secondary"}`}
        >
          {g === "month" ? "Mois" : g === "quarter" ? "Trim." : "Année"}
        </button>
      ))}
    </div>
  );

  const renderWidget = (instance: HrWidgetInstance): ReactNode => {
    switch (instance.type) {
      case "fte-waterfall":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Trajectoire ETP" actions={timeControls} />
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
      case "fte-execution-status": {
        const dimension = (["function", "country", "program"] as const).includes(
          instance.view as ExecutionDimension
        )
          ? (instance.view as ExecutionDimension)
          : "function";
        const rows = fteExecutionByDimension(filteredMovements, dimension, programs);
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title="Impacts ETP par statut"
              actions={
                <ExecutionDimensionToggle
                  value={dimension}
                  onChange={(next) =>
                    updateLayout(setHrWidgetView(layout, instance.instanceId, next))
                  }
                />
              }
            />
            <CardBody>
              <ExecutionStatusChart
                data={rows}
                mode="fte"
                onBarClick={(value, status) => goToExecution(value, dimension, status)}
              />
            </CardBody>
          </Card>
        );
      }
      case "staff-cost-waterfall":
        // Waterfall des staff costs chargés — même mécanique visuelle que la waterfall ETP mais
        // exprimée en €M. Utilise `salary` déjà calculé par `hr.salaryBridge`.
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title="Trajectoire Masse Salariale (€M, annualisé)"
              actions={timeControls}
            />
            <CardBody>
              <FteWaterfallChart
                buckets={salary}
                baseline={wf.massSalary}
                target={wf.massSalary + salary.reduce((s, b) => s + b.delta, 0)}
                unit="€M"
                decimals={1}
                targetLabel="Atterrissage plan"
              />
              <FteWaterfallLegend downLabel="Économies" upLabel="Recrutements (coûts)" />
            </CardBody>
          </Card>
        );
      case "salary-execution-status": {
        const dimension = (["function", "country", "program"] as const).includes(
          instance.view as ExecutionDimension
        )
          ? (instance.view as ExecutionDimension)
          : "function";
        const rows = salaryExecutionByDimension(filteredMovements, dimension, programs);
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title="Impacts Masse Salariale par statut (€M, annualisé)"
              actions={
                <ExecutionDimensionToggle
                  value={dimension}
                  onChange={(next) =>
                    updateLayout(setHrWidgetView(layout, instance.instanceId, next))
                  }
                />
              }
            />
            <CardBody>
              <ExecutionStatusChart
                data={rows}
                mode="salary"
                onBarClick={(value, status) => goToExecution(value, dimension, status)}
              />
            </CardBody>
          </Card>
        );
      }
      case "hr-owner-actions": {
        const rows = ownerActionSummary(filteredMovements);
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Plan d'actions par RH Owner" />
            <CardBody flush>
              <HrOwnerActionTable
                rows={rows}
                onCellClick={(owner, status) =>
                  router.push(
                    `/hr/etp?tab=mouvements&f_hrOwner=${encodeURIComponent(owner)}&f_execution=${encodeURIComponent(EXECUTION_LABELS[status])}`
                  )
                }
              />
            </CardBody>
          </Card>
        );
      }
      case "savings-period-cumul":
        // Économies par période et cumul (Actual + forecast vs Plan, double axe Y).
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Économies par période et cumul" actions={timeControls} />
            <CardBody>
              <SavingsPeriodCumulChart buckets={savingsSeries} />
              <p className="mt-2 text-[11px] text-tertiary">
                Barres violettes = réalisé + prévision par période · barres taupe = plan initial ·
                courbes = cumuls correspondants
              </p>
            </CardBody>
          </Card>
        );
      case "social-cost-enr":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Coûts sociaux exceptionnels et cumul" actions={timeControls} />
            <CardBody>
              <EnrPeriodCumulChart buckets={enrSeries} />
              <p className="mt-2 text-[11px] text-tertiary">
                Barres = ENR par période générés par les départs forcés · courbe = cumul ENR
              </p>
            </CardBody>
          </Card>
        );
      case "net-economy":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Économie nette (savings récurrentes − ENR)" actions={timeControls} />
            <CardBody>
              <NetEconomyChart buckets={netEcoSeries} />
              <p className="mt-2 text-[11px] text-tertiary">
                Économies staff costs chargés diminuées des ENR · courbe = cumul net
              </p>
            </CardBody>
          </Card>
        );
      case "movement-rhythm":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Détail mensuel des mouvements et cumul net" actions={timeControls} />
            <CardBody>
              <MovementRhythmChart buckets={rhythmSeries} />
              <p className="mt-2 text-[11px] text-tertiary">
                Barres = mouvements par période · courbe noire = cumul net ETP · échelle centrée sur
                zéro
              </p>
            </CardBody>
          </Card>
        );
      case "etp-bridge":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Pont ETP — contribution des mouvements au résultat net" />
            <CardBody>
              <EtpBridgeChart summary={bridgeSummary} />
              <p className="mt-2 text-[11px] text-tertiary">
                Décomposition ETP de la période sélectionnée · ouverture → mouvements → clôture
              </p>
            </CardBody>
          </Card>
        );
      case "department-breakdown": {
        const dimension = instance.view === "country" ? "country" : "department";
        const rows = hr.movementBreakdownByDimension(filteredMovements, dimension);
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={`Mouvements prévus par ${dimension === "country" ? "pays" : "département"} (ETP)`}
              actions={
                <ViewToggle
                  options={[
                    { value: "department", label: "Département" },
                    { value: "country", label: "Pays" },
                  ]}
                  value={dimension}
                  onChange={(next) =>
                    updateLayout(setHrWidgetView(layout, instance.instanceId, next))
                  }
                />
              }
            />
            <CardBody>
              <DepartmentMovementsChart data={rows} />
            </CardBody>
          </Card>
        );
      }
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
      case "department-table": {
        const dimension =
          instance.view === "country"
            ? "country"
            : instance.view === "workstream"
              ? "workstream"
              : "department";
        const positionRows = hr.ftePositionsByDimension(filteredWf, dimension);
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title="Effectifs par dimension — actuel vs cible vs atterrissage"
              actions={
                <ViewToggle
                  options={[
                    { value: "department", label: "Département" },
                    { value: "country", label: "Pays" },
                    { value: "workstream", label: "Workstream" },
                  ]}
                  value={dimension}
                  onChange={(next) =>
                    updateLayout(setHrWidgetView(layout, instance.instanceId, next))
                  }
                />
              }
            />
            <CardBody flush>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      {[
                        dimension === "department"
                          ? "Département"
                          : dimension === "country"
                            ? "Pays"
                            : "Workstream",
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
                    {positionRows.map((d) => {
                      const toDo = d.current - d.target;
                      const done = d.current - d.landing;
                      const pct = toDo !== 0 ? Math.round((done / toDo) * 100) : 100;
                      return (
                        <tr
                          key={d.key}
                          className="border-b border-border last:border-b-0 hover:bg-neutral-50"
                        >
                          <td className="px-3 py-2.5 font-semibold text-primary">{d.label}</td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {d.current.toLocaleString("fr-FR")}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {d.target.toLocaleString("fr-FR")}
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
                {positionRows.map((d) => {
                  const toDo = d.current - d.target;
                  const done = d.current - d.landing;
                  const pct = toDo !== 0 ? Math.round((done / toDo) * 100) : 100;
                  return (
                    <div key={d.key} className="p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-primary">{d.label}</span>
                        <span
                          className={`text-[12px] font-semibold tabular-nums ${d.gapToTarget > 0 ? "text-rag-red" : "text-rag-green-dark"}`}
                        >
                          {d.gapToTarget > 0 ? "+" : ""}
                          {d.gapToTarget.toLocaleString("fr-FR")} vs cible
                        </span>
                      </div>
                      <dl className="mb-2 grid grid-cols-3 gap-x-3 gap-y-1.5">
                        {[
                          { label: "Actuel", value: d.current },
                          { label: "Cible", value: d.target },
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
      }
      case "movements-table":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title="Synthèse des mouvements" />
            <CardBody>
              <EditableTable
                data={movementTableRows}
                columns={movementTableColumns}
                onCellUpdate={handleMovementTableUpdate}
                onRowClick={(row) => {
                  const lever = data.levers.find((item) => item.id === row.movement.leverId);
                  goToEtp(lever ? { f_lever: lever.code } : {});
                }}
                searchPlaceholder="Rechercher un mouvement, programme, owner..."
                defaultSort={{ key: "plannedDate", direction: "asc" }}
              />
              {!canEditMovements && movementTableRows.length > 0 && (
                <p className="mt-2 text-[10.5px] text-tertiary">
                  Lecture seule — l&apos;édition est réservée aux rôles RH et CTO.
                </p>
              )}
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
          <div className="flex items-center gap-2">
            <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
              Dashboard RH
            </h1>
            <span className="flex items-center gap-1 rounded-sm border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary">
              <Lock size={10} />
              Confidentiel
            </span>
          </div>
          <div className="mt-2.5 text-[13px] text-secondary">
            Trajectoire effectifs {wf.totalFTE.toLocaleString("fr-FR")} →{" "}
            {target.toLocaleString("fr-FR")} ETP · {filteredMovements.length} mouvements ·{" "}
            {realizedMovements} réalisés
            {hasActiveFilters && (
              <span className="ml-1 text-bp-coral">
                (filtré · {filteredMovements.length}/{wf.movements.length})
              </span>
            )}
          </div>
        </div>
        <div className="hidden items-center gap-2 lg:flex">
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
        {/* Mobile : bouton condensé pour la Base ETP */}
        <div className="flex items-center gap-2 lg:hidden">
          <Button variant="primary" size="sm" onClick={() => router.push("/hr/etp")}>
            <Users size={13} /> Base ETP
          </Button>
        </div>
      </div>

      {/* Filtres RH — même mécanisme que le dashboard exécutif : repliés sur mobile,
          toujours visibles sur desktop. Filtrent tous les graphiques et KPI. */}
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
          Filtres
          {hasActiveFilters && (
            <span className="rounded-full bg-white/25 px-1.5 text-[10px] font-bold">
              {Object.keys(activeFilters).length}
            </span>
          )}
        </button>
        {mobileFiltersOpen && (
          <div className="mt-2">
            <FilterBar
              items={wf.movements}
              defs={filterDefs}
              active={activeFilters}
              onChange={setActiveFilters}
            />
          </div>
        )}
      </div>
      <div className="mb-4 hidden lg:block">
        <FilterBar
          items={wf.movements}
          defs={filterDefs}
          active={activeFilters}
          onChange={setActiveFilters}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════════════════════
          BARRE D'AVANCEMENT ETP — pleine largeur, pas de cadre blanc isolé : lecture immédiate
          du ratio mouvements réalisés / total et de la trajectoire baseline → cible.
          ═══════════════════════════════════════════════════════════════════════════════════════ */}
      <div className="mb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[28px] font-bold leading-none tracking-tight text-primary">
              {realizedMovements}
              <span className="text-[18px] font-semibold text-tertiary">
                /{filteredMovements.length}
              </span>
            </span>
            <span className="text-[13px] text-secondary">mouvements réalisés</span>
          </div>
          <div className="flex items-center gap-3 text-[12px] tabular-nums text-secondary">
            <span>
              <strong className="text-primary">{current.toLocaleString("fr-FR")}</strong> ETP
              actuels
            </span>
            <span className="text-tertiary">→</span>
            <span>
              cible <strong className="text-primary">{target.toLocaleString("fr-FR")}</strong>
            </span>
            <span className="rounded-sm bg-neutral-100 px-1.5 py-0.5 text-[11px] font-bold text-primary">
              {goalPct}%
            </span>
          </div>
        </div>
        {/* Barre double : fond = total, remplissage = réalisé. Pas de rounded — charte BP. */}
        <div className="mt-2 h-2 w-full overflow-hidden bg-neutral-200">
          <div
            className="h-full bg-bp-coral transition-all duration-500"
            style={{
              width: `${filteredMovements.length > 0 ? Math.round((realizedMovements / filteredMovements.length) * 100) : 0}%`,
            }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-tertiary">
          <span>Baseline {wf.totalFTE.toLocaleString("fr-FR")} ETP</span>
          <span>
            Atterrissage {landing.toLocaleString("fr-FR")} ({landing - target > 0 ? "+" : ""}
            {(landing - target).toLocaleString("fr-FR")} vs cible)
          </span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════════════════════
          4 KPI Gooduelle — Impact ETP / Économies salariales annuelles / Coûts sociaux consommés
          / Économies nettes — chacun affiche réalisé + cible + reforecast + barre de progression.
          Alimenté par `hrProgramSummary` (source unique — voir lib/hrProgramSummary.ts).
          ═══════════════════════════════════════════════════════════════════════════════════════ */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HrKPICard
          label="Impact ETP"
          value={summary.fte.realized.toLocaleString("fr-FR")}
          sub={`Cible ${summary.fte.target.toLocaleString("fr-FR")} · Reforecast ${summary.fte.reforecast.toLocaleString("fr-FR")} · ${summary.fte.progressPct}%`}
          barPct={summary.fte.progressPct}
          barMarkerPct={
            summary.fte.target !== 0
              ? Math.round((Math.abs(summary.fte.reforecast) / Math.abs(summary.fte.target)) * 100)
              : undefined
          }
          accent="default"
        />
        <HrKPICard
          label="Économies salariales annuelles"
          value={fmtCurr(summary.salarySavings.realized / 1_000_000)}
          sub={`Cible ${fmtCurr(summary.salarySavings.target / 1_000_000)} · Reforecast ${fmtCurr(summary.salarySavings.reforecast / 1_000_000)} · ${summary.salarySavings.progressPct}%`}
          barPct={summary.salarySavings.progressPct}
          barMarkerPct={
            summary.salarySavings.target > 0
              ? Math.round((summary.salarySavings.reforecast / summary.salarySavings.target) * 100)
              : undefined
          }
          accent="green"
        />
        <HrKPICard
          label="Coûts sociaux consommés"
          value={fmtCurr(summary.socialCost.realized / 1_000_000)}
          sub={`Cible ${fmtCurr(summary.socialCost.target / 1_000_000)} · Reforecast ${fmtCurr(summary.socialCost.reforecast / 1_000_000)} · ${summary.socialCost.progressPct}%`}
          barPct={summary.socialCost.progressPct}
          barMarkerPct={
            summary.socialCost.target > 0
              ? Math.round((summary.socialCost.reforecast / summary.socialCost.target) * 100)
              : undefined
          }
          accent="red"
        />
        <HrKPICard
          label="Économies nettes"
          value={fmtCurr(summary.netEconomy.realized / 1_000_000)}
          sub={`Cible ${fmtCurr(summary.netEconomy.target / 1_000_000)} · Reforecast ${fmtCurr(summary.netEconomy.reforecast / 1_000_000)} · ${summary.netEconomy.progressPct}%`}
          barPct={summary.netEconomy.progressPct}
          barMarkerPct={
            summary.netEconomy.target !== 0
              ? Math.round(
                  (Math.abs(summary.netEconomy.reforecast) / Math.abs(summary.netEconomy.target)) *
                    100
                )
              : undefined
          }
          accent="brown"
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════════════════════
          ALERTES MOUVEMENTS — sous les KPI, pas au-dessus.
          ═══════════════════════════════════════════════════════════════════════════════════════ */}
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

      {/* ═══════════════════════════════════════════════════════════════════════════════════════
          Contrôles transverses — sélecteur programme + presets FY / Réalisé à date / Programme
          complet + range picker. Pilote uniformément TOUS les widgets à axe temporel via
          `dateFromISO` / `dateToISO` (dateRange dans les series et bridge/salary).
          ═══════════════════════════════════════════════════════════════════════════════════════ */}
      {/* Aucune Program dans la collection Firestore multi-programmes pour ce tenant : on
       *  informe explicitement plutôt que d'afficher une barre de contrôles à moitié vide.
       *  Ce cas ne devrait pas se produire (TEST_PROGRAM est seedé par ensureAdminSeeded) mais
       *  reste possible si l'admin a supprimé le programme. */}
      {programs.length === 0 && (
        <div className="mb-4 rounded-lg border border-rag-amber-light bg-rag-amber-light/20 p-3 text-[12.5px] text-secondary">
          <strong className="text-primary">Aucun programme configuré</strong> pour cette entreprise.
          Les widgets restent en lecture sur toute la période de mouvements disponibles. Configurer
          un programme dans <em>Admin → Programmes</em> pour activer les presets FY et le scope
          programme.
        </div>
      )}

      <div className="mb-4 rounded-lg border border-border bg-white p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {programs.length > 1 && (
            <div className="inline-flex items-center gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                Programme
              </span>
              <select
                value={selectedProgramId}
                onChange={(e) => setSelectedProgramId(e.target.value)}
                className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[11px] font-semibold text-secondary focus:border-black focus:outline-none"
              >
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="inline-flex items-center gap-1">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
              Période
            </span>
            <DateRangePicker
              fromISO={dateFromISO}
              toISO={dateToISO}
              minISO={movementDateRange.from}
              maxISO={movementDateRange.to}
              onChange={({ fromISO, toISO }) => {
                setDateFromISO(fromISO);
                setDateToISO(toISO);
              }}
              showSummary
            />
          </div>
          {activeProgram && (
            <div className="inline-flex flex-wrap items-center gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                Presets
              </span>
              {/* Preset "Programme complet" = plage RÉELLE des mouvements (pas activeProgram
               *  .fyStart/fyEnd qui pouvait exclure les exercices ultérieurs). Le libellé
               *  reflète le vrai périmètre visible. */}
              <button
                type="button"
                onClick={() => {
                  setDateFromISO(movementDateRange.from);
                  setDateToISO(movementDateRange.to);
                }}
                className="rounded-sm border border-border bg-white px-2 py-1 text-[10.5px] font-semibold text-secondary hover:border-black hover:text-primary"
              >
                Programme complet
              </button>
              <button
                type="button"
                onClick={() => {
                  setDateFromISO(activeProgram.fyStart);
                  setDateToISO(hr.HR_TODAY);
                }}
                className="rounded-sm border border-border bg-white px-2 py-1 text-[10.5px] font-semibold text-secondary hover:border-black hover:text-primary"
              >
                Réalisé à date
              </button>
              {/* Presets FY générés sur la plage RÉELLE des mouvements. FY2026 / FY2027 /
               *  FY2028 apparaîtront dès qu'un mouvement les couvre, indépendamment de
               *  Program.fyStart/fyEnd (qui reste sur FY2026 dans le mock actuel). */}
              {generateFiscalYears(activeProgram, movementDateRange.from, movementDateRange.to).map(
                (fy) => (
                  <button
                    key={fy.label}
                    type="button"
                    onClick={() => {
                      setDateFromISO(fy.startISO);
                      setDateToISO(fy.endISO);
                    }}
                    className="rounded-sm border border-border bg-white px-2 py-1 text-[10.5px] font-semibold text-secondary hover:border-black hover:text-primary"
                  >
                    {fy.label}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>

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

function ExecutionDimensionToggle({
  value,
  onChange,
}: {
  value: ExecutionDimension;
  onChange: (value: ExecutionDimension) => void;
}) {
  return (
    <ViewToggle
      options={[
        { value: "function", label: "Fonction" },
        { value: "country", label: "Pays" },
        { value: "program", label: "Programme" },
      ]}
      value={value}
      onChange={(next) => onChange(next as ExecutionDimension)}
    />
  );
}
