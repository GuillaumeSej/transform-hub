"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  GripVertical,
  LayoutGrid,
  Lock,
  Maximize2,
  Plus,
  RotateCcw,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useRole } from "@/lib/hooks/useRole";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { hasAnyRole } from "@/lib/roleProfiles";
import { useLifecycleLabels } from "@/lib/hooks/useLifecycleLabels";
import * as hr from "@/lib/hrEngine";
import {
  movementRhythmSeries,
  netEconomySeries,
  salarySavingsSeries,
  socialCostSeries,
} from "@/lib/hrTimeSeries";
import { hrProgramSummary, targetFteFromBaseline } from "@/lib/hrProgramSummary";
import { etpMovementDeepLink, etpMovementFilterLink } from "@/lib/hrMovementLink";
import { fmtCurr } from "@/lib/engine";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { HrKPICard } from "@/components/shared/HrKPICard";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { Modal } from "@/components/shared/Modal";
import { MovementDrilldownModal } from "@/components/shared/MovementDrilldownModal";
import type { MovementNetBalance } from "@/lib/hrMovementBalance";
import { Button } from "@/components/shared/Button";
import { ICON_REGISTRY } from "@/components/shared/icon-registry";
import { DashboardExportButton } from "@/components/shared/DashboardExportButton";
import {
  FteWaterfallChart,
  FteWaterfallLegend,
} from "@/components/shared/charts/FteWaterfallChart";
import { DepartmentMovementsChart } from "@/components/shared/charts/HrBreakdownCharts";
import { MovementBreakdownMergedChart } from "@/components/shared/charts/MovementBreakdownMergedChart";
import {
  MovementProgressByDimensionChart,
  movementProgressStatusLabel,
} from "@/components/shared/charts/MovementProgressByDimensionChart";
import { MovementDetailDrilldownModal } from "@/components/shared/MovementDetailDrilldownModal";
import { MovementAlertsSummaryModal } from "@/components/shared/MovementAlertsSummaryModal";
import { ExecutionStatusChart } from "@/components/shared/charts/HrExecutionCharts";
import { MovementStatusMatrix } from "@/components/shared/charts/MovementStatusMatrix";
import { ForcedDepartureStatusChart } from "@/components/shared/charts/ForcedDepartureStatusChart";
import { MovementStatusByTypeChart } from "@/components/shared/charts/MovementStatusByTypeChart";
import { HrOwnerActionTable } from "@/components/shared/HrOwnerActionTable";
import {
  EnrPeriodCumulChart,
  MovementRhythmChart,
  NetEconomyChart,
  SavingsPeriodCumulChart,
} from "@/components/shared/charts/HrGooduelleCharts";
import { type FilterDef } from "@/components/shared/filterTypes";
import { MultiSelect } from "@/components/shared/MultiSelect";
import { DropdownFilterBar } from "@/components/shared/DropdownFilterBar";
import { useMultiFilterBarState } from "@/lib/hooks/useMultiFilterBarState";
import { matchesFilter, parseFilterValues, serializeFilterValues } from "@/lib/filterUtils";
import { resolveHierarchyPath } from "@/lib/hierarchyLogic";
import { PeriodToolbar, type PeriodPreset } from "@/components/shared/PeriodToolbar";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import { generateFiscalYears } from "@/lib/fiscalYear";
import type { MovementAlertKind } from "@/lib/hrEngine";
import { pivotWorkforceByDimension } from "@/lib/hrDashboardPivot";
import { HrPivotBarChart } from "@/components/shared/charts/HrBreakdownCharts";
import type {
  Company,
  HierarchyLevelDef,
  HierarchyNode,
  MovementStatus,
  Program,
  SocialScheme,
  WorkforceMovement,
} from "@/types";
import {
  subscribeCompanies,
  subscribeHierarchyNodes,
  subscribePrograms,
} from "@/lib/firestore/admin";
import { buildMovementTableRows, type HrMovementTableRow } from "@/lib/hrMovementTable";
import {
  executionLabel,
  movementAlertMessage,
  movementStatusLabel,
  movementTypeLabel,
} from "@/lib/hrMovementLabels";
import { movementSocialSchemePatch, movementStatusPatch } from "@/lib/workforceLogic";
import { forcedDeparturesBySocialScheme } from "@/lib/hrSocialPlan";
import {
  EXECUTION_LABELS,
  classifyMovementAction,
  movementStatusByType,
  movementProgressByDimension,
  movementStatusGroups,
  ownerActionSummary,
  salaryExecutionByDimension,
  type ExecutionDimension,
  type MovementProgressDimension,
} from "@/lib/hrExecution";
import {
  HR_METRIC_REGISTRY,
  HR_DIMENSION_REGISTRY,
  getHrMetricDef,
  getHrDimensionDef,
} from "@/lib/hrDashboardPivot";
import {
  HR_WIDGET_LABEL_KEYS,
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
import { useTranslation } from "@/lib/i18n/useTranslation";
import { formatMillions, formatNumber, intlTag } from "@/lib/format";
import { SegmentedControl } from "@/components/shared/SegmentedControl";

function alertLabels(
  t: (key: string, fallback?: string) => string
): Record<MovementAlertKind, string> {
  return {
    overdue: t("hr.alert.overdue", "En retard"),
    leverMismatch: t("hr.alert.leverMismatch", "Désynchronisé levier"),
    toValidate: t("hr.alert.toValidate", "À valider"),
    due: t("hr.alert.due", "Échéance proche"),
  };
}

/** Libellé lisible d'une vue construite (builder générique RH) — `label` explicite si fourni,
 *  sinon généré à partir des libellés de la métrique et de la dimension. */
function describeHrCustomView(
  view: HrCustomViewConfig,
  t: (key: string, fallback?: string) => string
): string {
  if (view.label) return view.label;
  const metric = getHrMetricDef(view.metric);
  const dim = getHrDimensionDef(view.dimension);
  const metricLabel = metric ? t(`hr.pivot.metric.${metric.key}`, metric.label) : view.metric;
  const dimLabel = dim ? t(`hr.pivot.dim.${dim.key}`, dim.label) : view.dimension;
  return t("hr.builderModal.viewByPattern", "{metric} par {dimension}")
    .replace("{metric}", metricLabel)
    .replace("{dimension}", dimLabel);
}

/**
 * Dashboard RH — pilotage visuel de la transformation effectifs, personnalisable façon PowerBI
 * (voir lib/hrDashboardWidgets.ts / lib/hrDashboardPivot.ts) : waterfall baseline → cible
 * cliquable (décomposition par levier), mouvements par département/pays/type, impact masse
 * salariale, suivi PSE, table des départements et synthèse des mouvements. La donnée détaillée vit
 * dans la Base ETP (/hr/etp).
 */
export default function HrDashboardPage() {
  const { t, locale } = useTranslation();
  // Locale Intl active — libellés de période (mois via Intl, "T1"/"Q1") des séries RH (m15).
  const intlLocale = intlTag(locale);
  // Date de référence UNIQUE des calculs RH (B1) : date locale réelle, plus de date démo figée.
  const today = hr.hrToday();
  const { user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);
  const router = useRouter();
  // Vue consolidée multi-programmes (fondation chantier CTO, voir lib/hooks/useActiveProgram.tsx) :
  // demande métier explicite — SEUL le suivi des mouvements RH ci-dessous doit s'étendre à tous les
  // programmes de `consolidatedPrograms` quand elle est active ; la Base ETP (app/(app)/hr/etp/page.tsx,
  // onglet "etp") n'est PAS concernée et reste inchangée.
  const { isConsolidatedView, consolidatedPrograms } = useActiveProgram();
  const [granularity, setGranularity] = useState<"month" | "quarter" | "year">("quarter");
  const [drillBucket, setDrillBucket] = useState<string | null>(null);
  // Quelle waterfall a déclenché le drill (ETP ou masse salariale) — les deux graphiques
  // partagent le même mécanisme de drill (même bucket/mouvements sous-jacents via `bridge`,
  // voir `drill`/`drillBucketMovements` ci-dessous), seule la grandeur affichée par levier change.
  const [drillKind, setDrillKind] = useState<"fte" | "salary">("fte");
  // Drill-down générique pour les 3 graphiques agrégés sans vue de détail (item 3-5, round <n>) —
  // voir `components/shared/MovementDrilldownModal.tsx`. Un seul état partagé : chaque graphique
  // fournit son propre titre + la liste des `WorkforceMovement[]` déjà calculée derrière la
  // barre/segment cliqué (pas de recalcul ici).
  const [drilldownModal, setDrilldownModal] = useState<{
    title: string;
    movements: WorkforceMovement[];
    /** Bilan précalculé (vues par dimension : sens des transferts relatif au groupe cliqué). */
    balance?: MovementNetBalance;
  } | null>(null);
  // Drill-down détaillé ("qui a fait quoi") du widget "Avancement des mouvements par {dimension}"
  // — voir `components/shared/MovementDetailDrilldownModal.tsx`. État séparé de `drilldownModal`
  // car la modale affiche un tableau plus riche (programme / département / pays / dates / statut).
  const [progressDrilldown, setProgressDrilldown] = useState<{
    title: string;
    movements: WorkforceMovement[];
  } | null>(null);
  // Synthèse des alertes mouvements (components/shared/MovementAlertsSummaryModal.tsx) — ouverte
  // AVANT toute navigation depuis le bandeau d'alertes. `null` = fermée ; `kind: null` = toutes.
  const [alertsModal, setAlertsModal] = useState<{ kind: MovementAlertKind | null } | null>(null);

  // ─── Sélecteur de programme (source unique = collection Firestore multi-programmes) ─────
  // Le dashboard RH s'abonne à la même collection `programs` que le dashboard exécutif (voir
  // subscribePrograms de lib/firestore/admin.ts). L'ancien fallback sur [data.program]
  // (slot mono-programme ProgramConfig, id "PRG-2026") a été retiré Août 2026 : il ne
  // pointait pas vers le même id que celui utilisé côté leviers et mouvements ("p1"), ce qui
  // faisait apparaître un sélecteur avec un programme fantôme qui n'était l'ancre d'aucun
  // mouvement scopé.
  const [programs, setPrograms] = useState<Program[]>([]);
  useEffect(() => {
    const unsub = subscribePrograms(
      (all) =>
        setPrograms(user?.companyId ? all.filter((p) => p.companyId === user.companyId) : all),
      user?.companyId ?? null
    );
    return unsub;
  }, [user?.companyId]);
  const [selectedProgramId, setSelectedProgramId] = useState<string>("");
  // Sélection par défaut : on privilégie le programme réellement référencé par les mouvements RH
  // (le plus fréquent parmi `movement.programId`) plutôt que `programs[0]` au hasard — sinon, si
  // le premier programme retourné par `subscribePrograms` ne porte aucun mouvement (programme créé
  // après coup, ou mouvements liés à un autre programme), TOUT le dashboard reste vide alors que
  // le tableau RH / Base ETP (qui ne filtrent pas par programme) affichent bien des données.
  useEffect(() => {
    if (selectedProgramId || programs.length === 0) return;
    const counts = new Map<string, number>();
    for (const m of data.workforce.movements) {
      if (m.programId) counts.set(m.programId, (counts.get(m.programId) ?? 0) + 1);
    }
    const mostUsedId = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    const match = mostUsedId ? programs.find((p) => p.id === mostUsedId) : undefined;
    setSelectedProgramId((match ?? programs[0]).id);
  }, [programs, selectedProgramId, data.workforce.movements]);
  const activeProgram = programs.find((p) => p.id === selectedProgramId) ?? programs[0] ?? null;
  // Dashboard RH scopé à UN programme (voir sélecteur ci-dessus) — le cycle de vie est désormais
  // une config par programme (lib/firestore/admin.ts).
  const lifecycle = useLifecycleLabels(activeProgram?.id);

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
  // La plage par défaut suit les données (chargement Firestore, mouvement ajouté…) TANT QUE
  // l'utilisateur ne l'a pas modifiée — une plage choisie à la main n'est plus écrasée (m10).
  const userRangeRef = useRef(false);
  useEffect(() => {
    if (userRangeRef.current) return;
    setDateFromISO(movementDateRange.from);
    setDateToISO(movementDateRange.to);
  }, [movementDateRange.from, movementDateRange.to]);
  const setUserRange = (fromISO: string, toISO: string) => {
    userRangeRef.current = true;
    setDateFromISO(fromISO);
    setDateToISO(toISO);
  };
  // Borne vide = plage ouverte (m10) : vider "Au" ne vide plus le dashboard.
  const rangeFrom = dateFromISO || "0000-01-01";
  const rangeTo = dateToISO || "9999-12-31";
  // Préréglages de la barre transverse (PeriodToolbar) — uniquement quand un programme est résolu.
  const hrPeriodPresets = useMemo<PeriodPreset[]>(() => {
    if (!activeProgram) return [];
    return [
      {
        key: "full",
        label: t("hr.presetFullProgram", "Programme complet"),
        fromISO: movementDateRange.from,
        toISO: movementDateRange.to,
      },
      {
        key: "toDate",
        label: t("leverDetail.realizedToDate", "Réalisé à date"),
        fromISO: activeProgram.fyStart,
        toISO: today,
      },
      ...generateFiscalYears(activeProgram, movementDateRange.from, movementDateRange.to).map(
        (fy) => ({ key: `fy-${fy.label}`, label: fy.label, fromISO: fy.startISO, toISO: fy.endISO })
      ),
    ];
  }, [activeProgram, movementDateRange.from, movementDateRange.to, t, today]);

  // ─── Arborescences optionnelles (géographie prioritaire, finance en bonus) ─────────────────────
  // Même pattern défensif que `DashboardPagePerformance.tsx`/`app/(app)/levers/page.tsx` : ces
  // filtres par niveau ne remplacent le filtre plat existant que si l'entreprise a explicitement
  // configuré l'arborescence correspondante — sinon comportement historique inchangé.
  const [company, setCompany] = useState<Company | null>(null);
  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      setCompany(companies.find((c) => c.id === user?.companyId) ?? null);
    }, user?.companyId ?? null);
    return unsub;
  }, [user?.companyId]);

  const [hierarchyLevels, setHierarchyLevels] = useState<HierarchyLevelDef[]>([]);
  const [hierarchyNodes, setHierarchyNodes] = useState<HierarchyNode[]>([]);
  const [geographyHierarchyLevels, setGeographyHierarchyLevels] = useState<HierarchyLevelDef[]>([]);
  const [geographyNodes, setGeographyNodes] = useState<HierarchyNode[]>([]);
  useEffect(() => {
    setHierarchyLevels(company?.hierarchyLevels ?? []);
    setGeographyHierarchyLevels(company?.geographyHierarchyLevels ?? []);
  }, [company]);
  useEffect(() => {
    if (!user?.companyId || hierarchyLevels.length === 0) {
      setHierarchyNodes([]);
      return;
    }
    const unsub = subscribeHierarchyNodes(user.companyId, setHierarchyNodes, "financial");
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId, hierarchyLevels.length]);
  useEffect(() => {
    if (!user?.companyId || geographyHierarchyLevels.length === 0) {
      setGeographyNodes([]);
      return;
    }
    const unsub = subscribeHierarchyNodes(user.companyId, setGeographyNodes, "geographic");
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId, geographyHierarchyLevels.length]);

  const sortedHierarchyLevels = useMemo(
    () => [...hierarchyLevels].sort((a, b) => a.order - b.order),
    [hierarchyLevels]
  );
  const sortedGeographyHierarchyLevels = useMemo(
    () => [...geographyHierarchyLevels].sort((a, b) => a.order - b.order),
    [geographyHierarchyLevels]
  );

  // Un filtre par niveau d'arborescence géographique configuré — remplace le filtre unique "Pays"
  // dès que l'entreprise a activé l'arborescence (même principe que le dashboard exécutif).
  const geographyFilterDefs: FilterDef<WorkforceMovement>[] = useMemo(
    () =>
      sortedGeographyHierarchyLevels.map((level) => ({
        key: `geo_${level.key}`,
        label: level.label,
        getValue: (m: WorkforceMovement) => {
          const path = resolveHierarchyPath(
            m.geographyLeafId ?? "",
            geographyNodes,
            sortedGeographyHierarchyLevels
          );
          return path.find((p) => p.levelKey === level.key)?.label ?? "";
        },
      })),
    [sortedGeographyHierarchyLevels, geographyNodes]
  );

  // Un filtre par niveau d'arborescence financière configuré (bonus) — uniformément résolu via
  // `resolveHierarchyPath` : contrairement au dashboard exécutif (leviers), un `WorkforceMovement`
  // n'a pas d'équivalent `pnlMap` à utiliser en repli pour la maille macro, donc pas de cas
  // particulier ici.
  const hierarchyFilterDefs: FilterDef<WorkforceMovement>[] = useMemo(
    () =>
      sortedHierarchyLevels.map((level) => ({
        key: `hierarchy_${level.key}`,
        label: level.label,
        getValue: (m: WorkforceMovement) => {
          const path = resolveHierarchyPath(
            m.hierarchyLeafId ?? "",
            hierarchyNodes,
            sortedHierarchyLevels
          );
          return path.find((p) => p.levelKey === level.key)?.label ?? "";
        },
      })),
    [sortedHierarchyLevels, hierarchyNodes]
  );

  // ─── Filtres RH ──────────────────────────────────────────────────────────────────────────────
  const filterDefs: FilterDef<WorkforceMovement>[] = useMemo(
    () => [
      {
        key: "type",
        label: t("etp.filter.type", "Type"),
        getValue: (m) => m.type,
        formatValue: (v) => movementTypeLabel(t, v),
      },
      {
        key: "workstream",
        label: t("dashboard.workstream", "Chantier"),
        getValue: (m) => m.workstream || "—",
      },
      {
        key: "function",
        label: t("dashboard.function", "Fonction"),
        getValue: (m) => m.function || "—",
      },
      {
        key: "department",
        label: t("hr.department", "Département"),
        getValue: (m) => m.department,
      },
      ...(geographyFilterDefs.length > 0
        ? geographyFilterDefs
        : [
            {
              key: "country",
              label: t("dashboard.country", "Pays"),
              getValue: (m: WorkforceMovement) => m.country,
            },
          ]),
      {
        key: "status",
        label: t("hr.status", "Statut"),
        getValue: (m) => m.status,
        formatValue: (v) => movementStatusLabel(t, v),
      },
      { key: "hrOwner", label: t("hr.hrOwner", "Responsable RH"), getValue: (m) => m.hrOwner },
      ...hierarchyFilterDefs,
    ],
    [t, geographyFilterDefs, hierarchyFilterDefs]
  );
  // Filtres synchronisés dans l'URL via le hook partagé `useMultiFilterBarState`
  // (lib/hooks/useMultiFilterBarState.ts), comme les autres pages à `DropdownFilterBar`.
  const { activeFilters, setFilters: setActiveFilters } = useMultiFilterBarState(filterDefs);

  const wf = data.workforce;

  // Mouvements filtrés — alimente TOUS les calculs du dashboard quand un filtre ou le range
  // picker sont actifs. Le filtre par programme est appliqué en premier (scope), suivi du range
  // picker (dateFromISO/ToISO) puis des filtres FilterBar (types, workstream, fonction, pays, …).
  // Filet de sécurité : si AUCUN mouvement ne porte `programId === selectedProgramId` (programme
  // orphelin, ou mouvements dont le levier parent a changé de programme après coup), le filtre
  // programme ci-dessous est désactivé plutôt que de masquer silencieusement tout le dashboard —
  // même comportement que la Base ETP, qui ne filtre jamais par programme.
  // En vue consolidée (`isConsolidatedView`), ce filet de sécurité mono-programme ne s'applique
  // plus : le scope devient `consolidatedPrograms` (voir filteredMovements ci-dessous), qui n'a pas
  // besoin de ce repli.
  const programScopeHasMovements = useMemo(
    () =>
      isConsolidatedView ||
      !selectedProgramId ||
      wf.movements.some((m) => m.programId === selectedProgramId),
    [wf.movements, selectedProgramId, isConsolidatedView]
  );

  // Mouvements du PÉRIMÈTRE (programme + filtres), SANS la plage de dates : base de l'ouverture
  // des waterfalls (réalisés antérieurs à la plage, M2) et des chiffres absolus (actuel, cible).
  const scopedMovements = useMemo(() => {
    const keys = Object.keys(activeFilters);
    return wf.movements.filter((m) => {
      if (isConsolidatedView) {
        // Vue consolidée (chantier CTO, voir lib/hooks/useActiveProgram.tsx) : le scope couvre
        // TOUS les programmes de `consolidatedPrograms` combinés, pas le programme unique du
        // sélecteur local ci-dessous. Même filet de sécurité que le scope mono-programme : un
        // mouvement sans `programId` (orphelin) reste visible plutôt que d'être masqué à tort.
        if (m.programId && !consolidatedPrograms.some((p) => p.id === m.programId)) return false;
      } else if (
        // Scope programme (aujourd'hui mono-programme mock, mais évolutif multi-programmes).
        programScopeHasMovements &&
        selectedProgramId &&
        m.programId &&
        m.programId !== selectedProgramId
      ) {
        return false;
      }
      // DropdownFilterBar (nominal).
      for (const key of keys) {
        const value = activeFilters[key];
        if (!value || value.length === 0) continue;
        const def = filterDefs.find((d) => d.key === key);
        if (def && !matchesFilter(def.getValue(m), value)) return false;
      }
      return true;
    });
  }, [
    wf.movements,
    activeFilters,
    filterDefs,
    selectedProgramId,
    programScopeHasMovements,
    isConsolidatedView,
    consolidatedPrograms,
  ]);

  // Mouvements du périmètre DANS la plage (range picker temporel, bornes vides = ouvertes).
  const filteredMovements = useMemo(
    () => scopedMovements.filter((m) => m.plannedDate >= rangeFrom && m.plannedDate <= rangeTo),
    [scopedMovements, rangeFrom, rangeTo]
  );

  const hasActiveFilters = Object.keys(activeFilters).some(
    (key) => (activeFilters[key]?.length ?? 0) > 0
  );

  // ─── Baseline scopée par les filtres (M3) ─────────────────────────────────────────────────
  // Département / pays / chantier ont un équivalent sur la base ETP (employés ou baselines
  // explicites) : la baseline est restreinte au même périmètre que les mouvements. Tout autre
  // filtre (type, statut, fonction, RH, arborescences) ne porte que sur les mouvements : les
  // chiffres ABSOLUS (actuel, cible, atterrissage, référence) sont alors masqués avec une note
  // plutôt que de comparer des mouvements filtrés à la baseline de toute l'entreprise.
  const nonScopableFilterLabels = useMemo(
    () =>
      Object.keys(activeFilters)
        .filter((key) => (activeFilters[key]?.length ?? 0) > 0)
        .filter((key) => !["department", "country", "workstream"].includes(key))
        .map((key) => filterDefs.find((d) => d.key === key)?.label ?? key),
    [activeFilters, filterDefs]
  );
  const scopedBaseline = useMemo(
    () =>
      nonScopableFilterLabels.length > 0
        ? null
        : hr.scopeWorkforceBaseline(wf, {
            department: activeFilters.department,
            country: activeFilters.country,
            workstream: activeFilters.workstream,
          }),
    [wf, activeFilters, nonScopableFilterLabels.length]
  );
  const absoluteAvailable = scopedBaseline !== null;
  // Workforce du périmètre : baseline scopée (0 si non scopable → vues en variation) + mouvements
  // du périmètre sans filtre de date.
  const scopedWf = useMemo(
    () => ({
      ...wf,
      totalFTE: scopedBaseline?.totalFTE ?? 0,
      massSalary: scopedBaseline?.massSalary ?? 0,
      departments: scopedBaseline?.departments ?? [],
      countryBaselines: scopedBaseline?.countryBaselines ?? [],
      workstreamBaselines: scopedBaseline?.workstreamBaselines ?? [],
      movements: scopedMovements,
    }),
    [wf, scopedBaseline, scopedMovements]
  );
  // Même périmètre restreint à la plage de dates — alimente les vues "de période".
  const filteredWf = useMemo(
    () => ({ ...scopedWf, movements: filteredMovements }),
    [scopedWf, filteredMovements]
  );
  const seriesOptions = useMemo(() => ({ locale: intlLocale }), [intlLocale]);
  const bridgeRange = useMemo(
    () => ({ from: dateFromISO || null, to: dateToISO || null }),
    [dateFromISO, dateToISO]
  );

  const alerts = useMemo(
    () => hr.movementAlerts(filteredWf, data.levers, today),
    [filteredWf, data.levers, today]
  );
  // Waterfalls : ouverture = baseline + réalisés antérieurs à la plage (M2) — d'où `scopedWf`
  // (mouvements NON filtrés par date), la plage étant appliquée par `fteBridge` lui-même.
  const bridge = useMemo(
    () => hr.fteBridge(scopedWf, granularity, bridgeRange, seriesOptions),
    [scopedWf, granularity, bridgeRange, seriesOptions]
  );
  const bridgeOpening = useMemo(
    () => hr.fteOpening(scopedWf, bridgeRange),
    [scopedWf, bridgeRange]
  );
  const salary = useMemo(
    () => hr.salaryBridge(scopedWf, granularity, bridgeRange, seriesOptions),
    [scopedWf, granularity, bridgeRange, seriesOptions]
  );
  const salaryOpening = useMemo(
    () => hr.salaryOpening(scopedWf, bridgeRange),
    [scopedWf, bridgeRange]
  );
  const forcedDepartureSocialRows = useMemo(
    () => forcedDeparturesBySocialScheme(filteredMovements),
    [filteredMovements]
  );

  // ─── Gooduelle series (Août 2026) ────────────────────────────────────────────
  // Plage de dates pilotée par le range picker + presets FY côté page (voir dateFromISO/ToISO).
  // Bornes vides = plage ouverte (m10) : les séries retombent alors sur les dates des mouvements.
  const dateRange = useMemo(
    () => ({
      from: dateFromISO || movementDateRange.from,
      to: dateToISO || movementDateRange.to,
    }),
    [dateFromISO, dateToISO, movementDateRange.from, movementDateRange.to]
  );

  const savingsSeries = useMemo(
    () => salarySavingsSeries(filteredMovements, granularity, dateRange, today, seriesOptions),
    [filteredMovements, granularity, dateRange, today, seriesOptions]
  );
  const enrSeries = useMemo(
    () => socialCostSeries(filteredMovements, granularity, dateRange, seriesOptions),
    [filteredMovements, granularity, dateRange, seriesOptions]
  );
  const netEcoSeries = useMemo(
    () => netEconomySeries(filteredMovements, granularity, dateRange, today, seriesOptions),
    [filteredMovements, granularity, dateRange, today, seriesOptions]
  );
  const rhythmSeries = useMemo(
    () => movementRhythmSeries(filteredMovements, granularity, dateRange, seriesOptions),
    [filteredMovements, granularity, dateRange, seriesOptions]
  );
  const summary = useMemo(() => hrProgramSummary(filteredMovements), [filteredMovements]);
  const movementTableRows = useMemo(
    () => buildMovementTableRows(filteredMovements, data.levers, programs),
    [filteredMovements, data.levers, programs]
  );
  const canEditMovements = hasAnyRole(user, ["hr", "cto"]);
  const socialSchemeOptions = ["—", "PSE", "RC", "RCC", "PDV", "Autre"];
  const movementStatusOptions: MovementStatus[] = ["Réalisé", "Planifié", "À faire", "Abandonné"];

  const movementTableColumns: ColumnDef<HrMovementTableRow>[] = [
    { key: "label", label: t("hr.column.movement", "Mouvement"), mobile: "primary" },
    {
      key: "type",
      label: t("etp.filter.type", "Type"),
      options: hr.MOVEMENT_TYPES,
      optionLabel: (opt) => movementTypeLabel(t, opt),
      render: (row) => movementTypeLabel(t, row.type),
    },
    { key: "programName", label: t("dashboard.program", "Programme") },
    {
      key: "socialScheme",
      label: t("hr.column.socialScheme", "Dispositif social"),
      options: socialSchemeOptions,
      optionLabel: (opt) => (opt === "Autre" ? t("shared.movementForm.schemeOther", "Autre") : opt),
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
                {scheme === "Autre" ? t("shared.movementForm.schemeOther", "Autre") : scheme}
              </option>
            ))}
          </select>
        ) : row.socialScheme === "Autre" ? (
          t("shared.movementForm.schemeOther", "Autre")
        ) : (
          row.socialScheme
        ),
    },
    { key: "department", label: t("hr.department", "Département") },
    { key: "country", label: t("dashboard.country", "Pays") },
    {
      key: "initiativeOwner",
      label: t("hr.column.initiativeOwner", "Responsable de l'initiative"),
    },
    { key: "hrOwner", label: t("hr.hrOwner", "Responsable RH") },
    { key: "fte", label: t("etp.column.fte", "ETP"), align: "right" },
    { key: "plannedDate", label: t("hr.column.plannedDate", "Date prévisionnelle") },
    {
      key: "status",
      label: t("hr.status", "Statut"),
      options: movementStatusOptions,
      optionLabel: (opt) => movementStatusLabel(t, opt),
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
                {movementStatusLabel(t, status)}
              </option>
            ))}
          </select>
        ) : (
          movementStatusLabel(t, row.status)
        ),
    },
    {
      key: "actualDate",
      label: t("hr.column.actualDate", "Date effective"),
      editable: canEditMovements,
      type: "date",
      render: (row) => row.actualDate || "—",
    },
    {
      key: "comment",
      label: t("hr.column.comment", "Commentaire"),
      render: (row) =>
        canEditMovements ? (
          <MovementCommentEditor
            value={row.comment}
            onSave={(value) => handleMovementTableUpdate(row.id, "comment", value)}
          />
        ) : (
          row.comment || "—"
        ),
    },
    {
      key: "salaryImpact",
      label: t("hr.column.salaryImpact", "Impact salarial"),
      align: "right",
      render: (row) => fmtCurr(row.salaryImpact / 1_000_000),
    },
    {
      key: "cost",
      label: t("hr.column.socialCost", "Coût social"),
      align: "right",
      render: (row) => fmtCurr(row.cost / 1_000_000),
    },
  ];

  // Statut planifié d'un mouvement avant sa bascule en « Réalisé » par saisie de la date
  // effective — restauré si la date est ensuite effacée (m11).
  const previousStatusRef = useRef(new Map<string, MovementStatus>());
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
      const movement = row.movement;
      // Un mouvement abandonné garde son statut : seule la date est mise à jour (m11).
      if (movement.status === "Abandonné") {
        data.updateWorkforceMovement(rowId, { actualDate });
        return;
      }
      if (actualDate) {
        // Mémorise le statut planifié d'origine pour le restaurer si la date est effacée.
        if (movement.status !== "Réalisé") previousStatusRef.current.set(rowId, movement.status);
        data.updateWorkforceMovement(rowId, { actualDate, status: "Réalisé" });
        return;
      }
      // Date effacée : retour au statut planifié précédent (« Planifié » par défaut), plus de
      // bascule forcée sur « À faire ».
      const restored =
        movement.status === "Réalisé"
          ? (previousStatusRef.current.get(rowId) ?? "Planifié")
          : movement.status;
      previousStatusRef.current.delete(rowId);
      data.updateWorkforceMovement(rowId, {
        actualDate: null,
        status: restored,
        hrValidated: false,
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
  // Chiffres absolus du périmètre (baseline scopée + TOUS les mouvements du périmètre, quelle que
  // soit la plage) : "Effectif cible" = `hr.targetFTE`, définition unique partagée avec la Base
  // ETP (m3). Masqués si la baseline n'est pas scopable (M3, voir `absoluteAvailable`).
  const baselineFte = scopedWf.totalFTE;
  const current = hr.currentFTE(scopedWf);
  const target = hr.targetFTE(scopedWf);
  const landing = hr.plannedFTE(scopedWf);
  const reductionGoal = baselineFte - target;
  const reductionDone = baselineFte - current;
  const goalPct = reductionGoal > 0 ? Math.round((reductionDone / reductionGoal) * 100) : 100;
  // Cible de la waterfall de la PÉRIODE : ouverture + impact cible des mouvements de la plage.
  const waterfallTarget = targetFteFromBaseline(bridgeOpening, summary.fte.target);

  const ALERT_LABELS = alertLabels(t);
  // Compteurs en MOUVEMENTS distincts (un mouvement peut porter plusieurs alertes), M4.
  const alertedMovementCount = hr.alertedMovementIds(alerts).length;
  const alertCounts = (Object.keys(ALERT_LABELS) as MovementAlertKind[])
    .map((kind) => ({ kind, count: hr.alertedMovementIds(alerts, kind).length }))
    .filter((a) => a.count > 0);

  const drill = useMemo(() => {
    if (!drillBucket) return [];
    // La waterfall masse salariale n'a pas ses propres buckets `movements` (`salary` vient de
    // `hr.salaryBridge`, sans le détail des mouvements) — mais `bridge` et `salary` partagent
    // exactement les mêmes labels de bucket (même granularité/plage), donc on retrouve toujours
    // les mouvements via `bridge`. Seule la grandeur affichée par levier change avec `drillKind`.
    const bucket = bridge.find((b) => b.key === drillBucket);
    if (!bucket) return [];
    return drillKind === "salary"
      ? hr.bucketByLever(
          bucket,
          data.levers,
          (movements) =>
            Math.round((movements.reduce((s, m) => s + m.salaryImpact, 0) / 1_000_000) * 100) / 100
        )
      : hr.bucketByLever(bucket, data.levers);
  }, [drillBucket, drillKind, bridge, data.levers]);
  // Mouvements bruts du bucket en cours de drill (avant regroupement par levier) — alimente le
  // lien "Voir dans la Base ETP" du modal ci-dessous (item 2 : réutilise le même mécanisme unique
  // `etpMovementDeepLink` que la matrice de statut et `MovementDrilldownModal`).
  const drillBucketMovements = useMemo(() => {
    if (!drillBucket) return [];
    return bridge.find((b) => b.key === drillBucket)?.movements ?? [];
  }, [drillBucket, bridge]);

  const realizedMovements = filteredMovements.filter((m) => m.status === "Réalisé").length;

  // ─── Contexte de l'export PowerPoint (m15) : programme, période, filtres actifs ──────────────
  const fmtIsoDate = (iso: string) =>
    iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(intlLocale) : "…";
  const exportContextLines: string[] = [
    `${t("dashboard.program", "Programme")} : ${
      isConsolidatedView
        ? t("topbar.consolidatedViewShort", "Vue consolidée")
        : (activeProgram?.name ?? "—")
    }`,
    `${t("hr.period", "Période")} : ${fmtIsoDate(dateFromISO)} → ${fmtIsoDate(dateToISO)}`,
    `${t("hr.export.filters", "Filtres")} : ${
      Object.entries(activeFilters)
        .filter(([, values]) => (values?.length ?? 0) > 0)
        .map(([key, values]) => {
          const def = filterDefs.find((d) => d.key === key);
          const shown = values.map((v) => (def?.formatValue ? def.formatValue(v) : v));
          return `${def?.label ?? key} = ${shown.join(", ")}`;
        })
        .join(" · ") || t("hr.export.noFilters", "aucun")
    }`,
  ];

  // Libellé localisé du bucket en cours de drill (la sélection se fait par clé stable).
  const drillBucketLabel = drillBucket
    ? (bridge.find((b) => b.key === drillBucket)?.label ?? drillBucket)
    : "";
  // Label de bucket cliqué (affiché par le graphique) → clé stable.
  const bucketKeyFromLabel = (label: string) => bridge.find((b) => b.label === label)?.key ?? label;
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

  // Note affichée à la place des chiffres absolus quand la baseline n'est pas scopable (M3).
  const baselineNote = t(
    "hr.baselineNotScopable",
    "Chiffres absolus masqués : le filtre « {filters} » ne porte que sur les mouvements, pas sur la base ETP — les trajectoires affichent des variations."
  ).replace("{filters}", nonScopableFilterLabels.join(", "));
  const baselineNoteBlock = !absoluteAvailable ? (
    <p className="mb-2 rounded-sm border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-secondary">
      {baselineNote}
    </p>
  ) : null;
  const dimensionName = (dimension: string): string =>
    dimension === "country"
      ? t("dashboard.country", "Pays")
      : dimension === "program"
        ? t("dashboard.program", "Programme")
        : dimension === "function"
          ? t("dashboard.function", "Fonction")
          : dimension === "workstream"
            ? t("dashboard.workstream", "Chantier")
            : t("hr.department", "Département");

  /** Titre du slide PowerPoint d'un widget : libellé + vue choisie (dimension, indicateur,
   *  filtres du widget) pour que chaque slide soit autoporteur (m15). */
  const widgetExportTitle = (instance: HrWidgetInstance, base: string): string => {
    const byDim = (dim: string) =>
      `${base} — ${t("hr.export.byDimension", "par {dim}").replace("{dim}", dimensionName(dim).toLowerCase())}`;
    switch (instance.type) {
      case "fte-execution-status":
      case "salary-execution-status":
        return byDim(
          instance.view === "country" || instance.view === "program" ? instance.view : "function"
        );
      case "department-breakdown":
        return byDim(
          instance.view === "country" || instance.view === "program" ? instance.view : "department"
        );
      case "department-table":
        return byDim(
          instance.view === "country" || instance.view === "workstream"
            ? instance.view
            : "department"
        );
      case "movement-progress":
        return byDim(
          instance.view === "department" || instance.view === "country" ? instance.view : "program"
        );
      case "movement-status-by-type": {
        const [rawDepartments = "", rawCountries = ""] = (instance.view ?? "|").split("|");
        const parts = [
          ...(rawDepartments === "all" ? [] : parseFilterValues(rawDepartments)),
          ...(rawCountries === "all" ? [] : parseFilterValues(rawCountries)),
        ];
        return parts.length > 0 ? `${base} — ${parts.join(", ")}` : base;
      }
      case "hr-pivot": {
        const active = resolveHrActiveCustomView(instance);
        return active ? describeHrCustomView(active, t) : base;
      }
      default:
        return base;
    }
  };

  /** `exportTitle` : titre de slide explicite (sinon `widgetExportTitle`). */
  const renderWidgetShell = (
    instance: HrWidgetInstance,
    children: ReactNode,
    exportTitle?: string
  ) => {
    const def = getHrWidgetDef(instance.type);
    if (!def) return null;
    const isDragOver = editMode && dragOverInstanceId === instance.instanceId;
    return (
      <div
        key={instance.instanceId}
        data-widget-id={instance.instanceId}
        data-widget-title={
          exportTitle ??
          widgetExportTitle(instance, t(HR_WIDGET_LABEL_KEYS[instance.type], def.label))
        }
        className={`relative h-full self-stretch ${SPAN_COL_CLASS[instance.span]} ${
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
              title={t("dashboard.widgetShell.dragToReorder", "Glisser pour réordonner")}
            >
              <GripVertical size={14} />
            </span>
            <div className="flex items-center sm:hidden">
              <button
                type="button"
                onClick={() => moveWidgetBy(instance.instanceId, "up")}
                className="rounded p-0.5 text-tertiary hover:bg-neutral-100 hover:text-primary"
                title={t("dashboard.widgetShell.moveUp", "Monter")}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => moveWidgetBy(instance.instanceId, "down")}
                className="rounded p-0.5 text-tertiary hover:bg-neutral-100 hover:text-primary"
                title={t("dashboard.widgetShell.moveDown", "Descendre")}
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
              title={t("dashboard.widgetShell.changeSize", "Changer la taille")}
            >
              <Maximize2 size={12} />
              {instance.span}
            </button>
            <button
              type="button"
              onClick={() => updateLayout(removeHrWidget(layout, instance.instanceId))}
              className="flex items-center rounded px-1 py-0.5 text-tertiary hover:bg-neutral-100 hover:text-bp-coral"
              title={t("dashboard.widgetShell.removeWidget", "Retirer ce widget")}
            >
              <X size={13} />
            </button>
          </div>
        )}
        <div
          className={`h-full [&>div]:h-full ${editMode ? "pointer-events-none select-none" : ""}`}
        >
          {children}
        </div>
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
          {g === "month"
            ? t("hr.granularity.month", "Mois")
            : g === "quarter"
              ? t("hr.granularity.quarter", "Trim.")
              : t("hr.granularity.year", "Année")}
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
            <CardHeader
              title={t("hr.widget.fteWaterfall", "Trajectoire ETP")}
              actions={timeControls}
            />
            <CardBody>
              {baselineNoteBlock}
              {/* Ouverture = baseline + réalisés antérieurs à la plage (M2) ; cible = ouverture +
                  impact cible des mouvements de la plage. */}
              <FteWaterfallChart
                buckets={bridge}
                baseline={bridgeOpening}
                target={waterfallTarget}
                onBarClick={(label) => {
                  setDrillKind("fte");
                  setDrillBucket(bucketKeyFromLabel(label));
                }}
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
        const groups = movementStatusGroups(filteredMovements, dimension, programs);
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t("hr.widget.movementStatus", "Statut des mouvements")}
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
              <MovementStatusMatrix
                groups={groups}
                getInitiativeLabel={(leverId) => {
                  const lever = data.levers.find((item) => item.id === leverId);
                  return lever ? `${lever.code} · ${lever.name}` : leverId;
                }}
                onMovementClick={(movementId) => router.push(etpMovementDeepLink([movementId]))}
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
              title={t(
                "hr.widget.staffCostWaterfall",
                "Trajectoire Masse Salariale (€M, annualisé)"
              )}
              actions={timeControls}
            />
            <CardBody>
              {baselineNoteBlock}
              <FteWaterfallChart
                buckets={salary}
                baseline={salaryOpening}
                target={salaryOpening + salary.reduce((s, b) => s + b.delta, 0)}
                unit="€M"
                decimals={1}
                targetLabel={t("hr.landingPlan", "Atterrissage plan")}
                onBarClick={(label) => {
                  setDrillKind("salary");
                  setDrillBucket(bucketKeyFromLabel(label));
                }}
              />
              <FteWaterfallLegend
                downLabel={t("hr.savingsLabel", "Économies")}
                upLabel={t("hr.hiringCostsLabel", "Recrutements (coûts)")}
              />
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
              title={t(
                "hr.widget.salaryExecutionStatus",
                "Impacts Masse Salariale par statut (€M, annualisé)"
              )}
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
                onBarClick={(value, status, movements) =>
                  setDrilldownModal({
                    title: t("hr.drilldown.dimensionStatusTitle", "Mouvements — {label} · {status}")
                      .replace("{label}", value)
                      .replace("{status}", executionLabel(t, status)),
                    movements,
                  })
                }
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
            <CardHeader title={t("hr.widget.ownerActions", "Plan d'actions par responsable RH")} />
            <CardBody flush>
              <HrOwnerActionTable
                rows={rows}
                onCellClick={(owner, status) => {
                  // « À valider » n'est pas un état d'exécution : lien par ids exacts (même
                  // périmètre que la cellule). Les autres cellules ouvrent la Base ETP filtrée
                  // (préfixe `mov_` de la barre de filtres des mouvements, M5).
                  if (status === "toValidate") {
                    const ids = filteredMovements
                      .filter(
                        (m) =>
                          (m.hrOwner || "Non renseigné") === owner &&
                          classifyMovementAction(m, today) === "toValidate"
                      )
                      .map((m) => m.id);
                    router.push(etpMovementDeepLink(ids));
                    return;
                  }
                  router.push(
                    etpMovementFilterLink({
                      f_hrOwner: [owner],
                      f_execution: [EXECUTION_LABELS[status]],
                    })
                  );
                }}
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
            <CardHeader
              title={t("hr.widget.savingsPeriodCumul", "Économies par période et cumul")}
              actions={timeControls}
            />
            <CardBody>
              {/* Légende cliquable + détail de période épinglé intégrés au graphique. */}
              <SavingsPeriodCumulChart buckets={savingsSeries} />
            </CardBody>
          </Card>
        );
      case "social-cost-enr":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t("hr.widget.socialCostEnr", "Coûts sociaux exceptionnels et cumul")}
              actions={timeControls}
            />
            <CardBody>
              <EnrPeriodCumulChart buckets={enrSeries} />
              <p className="mt-2 text-[11px] text-tertiary">
                {t(
                  "hr.widget.socialCostEnrHint",
                  "Réalisé + prévision vs plan initial · la colonne Coût social est comptabilisée une seule fois"
                )}
              </p>
            </CardBody>
          </Card>
        );
      case "net-economy":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t("hr.widget.netEconomy", "Économie nette (économies récurrentes − ENR)")}
              actions={timeControls}
            />
            <CardBody>
              <NetEconomyChart buckets={netEcoSeries} />
              <p className="mt-2 text-[11px] text-tertiary">
                {t(
                  "hr.widget.netEconomyHint",
                  "Réalisé + prévision : économies de coûts de personnel récurrentes − coûts sociaux ponctuels, par période et en cumul"
                )}
              </p>
            </CardBody>
          </Card>
        );
      case "movement-rhythm":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t("hr.widget.movementRhythm", "Détail mensuel des mouvements et cumul net")}
              actions={timeControls}
            />
            <CardBody>
              <MovementRhythmChart
                buckets={rhythmSeries}
                onBarClick={(label, movements) =>
                  setDrilldownModal({
                    title: t("hr.drilldown.periodTitle", "Mouvements — {label}").replace(
                      "{label}",
                      label
                    ),
                    movements,
                  })
                }
              />
              <p className="mt-2 text-[11px] text-tertiary">
                {t(
                  "hr.widget.movementRhythmHint",
                  "Net ETP cible : transferts neutralisés (effectif total inchangé) · les deux axes sont centrés sur zéro"
                )}
              </p>
            </CardBody>
          </Card>
        );
      case "movement-status-by-type": {
        // Vue du widget = "<départements>|<pays>", chaque côté = valeurs encodées séparées par des
        // virgules (multi-sélection) ; l'ancien format ("all" / valeur simple) reste lu.
        const [rawDepartments = "", rawCountries = ""] = (instance.view ?? "|").split("|");
        const departmentFilter = rawDepartments === "all" ? [] : parseFilterValues(rawDepartments);
        const countryFilter = rawCountries === "all" ? [] : parseFilterValues(rawCountries);
        const rows = movementStatusByType(filteredMovements, {
          department: departmentFilter,
          country: countryFilter,
        });
        const departments = Array.from(
          new Set(filteredMovements.map((movement) => movement.department).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b, "fr"));
        const countries = Array.from(
          new Set(filteredMovements.map((movement) => movement.country).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b, "fr"));
        const setFilter = (department: string[], country: string[]) =>
          updateLayout(
            setHrWidgetView(
              layout,
              instance.instanceId,
              `${serializeFilterValues(department)}|${serializeFilterValues(country)}`
            )
          );
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t("hr.widget.movementStatusByType", "Statut des mouvements par type")}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <MultiSelect
                    label={t("hr.filter.department", "Département")}
                    placeholder={t("hr.allDepartments", "Tous les départements")}
                    values={departmentFilter}
                    onChange={(vals) => setFilter(vals, countryFilter)}
                    options={departments.map((d) => ({ value: d, label: d }))}
                  />
                  <MultiSelect
                    label={t("hr.filter.country", "Pays")}
                    placeholder={t("hr.allCountries", "Tous les pays")}
                    values={countryFilter}
                    onChange={(vals) => setFilter(departmentFilter, vals)}
                    options={countries.map((c) => ({ value: c, label: c }))}
                  />
                </div>
              }
            />
            <CardBody>
              <MovementStatusByTypeChart
                data={rows}
                onBarClick={(type, status, movements) =>
                  setDrilldownModal({
                    title: t("hr.drilldown.typeStatusTitle", "Mouvements — {type} · {status}")
                      .replace("{type}", movementTypeLabel(t, type))
                      .replace("{status}", executionLabel(t, status)),
                    movements,
                  })
                }
              />
            </CardBody>
          </Card>
        );
      }
      case "department-breakdown": {
        const dimension =
          instance.view === "country"
            ? "country"
            : instance.view === "program"
              ? "program"
              : "department";
        const programLabels = Object.fromEntries(
          programs.map((program) => [program.id, program.name])
        );
        const rows = hr.movementBreakdownByDimension(filteredMovements, dimension, programLabels);
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t(
                "hr.widget.movementsByDimension",
                "Mouvements prévus par {dim} (ETP)"
              ).replace(
                "{dim}",
                dimension === "country"
                  ? t("hr.dimLower.country", "pays")
                  : dimension === "program"
                    ? t("hr.dimLower.program", "programme")
                    : t("hr.dimLower.department", "département")
              )}
              actions={
                <ViewToggle
                  options={[
                    { value: "department", label: t("hr.department", "Département") },
                    { value: "country", label: t("dashboard.country", "Pays") },
                    { value: "program", label: t("dashboard.program", "Programme") },
                  ]}
                  value={dimension}
                  onChange={(next) =>
                    updateLayout(setHrWidgetView(layout, instance.instanceId, next))
                  }
                />
              }
            />
            <CardBody>
              <DepartmentMovementsChart
                data={rows}
                dimensionLabel={
                  dimension === "country"
                    ? t("dashboard.country", "Pays")
                    : dimension === "program"
                      ? t("dashboard.program", "Programme")
                      : t("hr.department", "Département")
                }
                onBarClick={(label, movements, balance) =>
                  setDrilldownModal({
                    title: t("hr.drilldown.dimensionTitle", "Mouvements — {label}").replace(
                      "{label}",
                      label
                    ),
                    movements,
                    balance,
                  })
                }
              />
            </CardBody>
          </Card>
        );
      }
      case "pse-summary":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t(
                "hr.widget.pseSummary",
                "Départs forcés prévus vs réalisés par dispositif social"
              )}
            />
            <CardBody>
              <ForcedDepartureStatusChart data={forcedDepartureSocialRows} />
              <div className="mt-2 text-[11px] text-tertiary">
                {t(
                  "hr.widget.pseSummaryHint",
                  "Une ligne mouvement = un départ. Les abandonnés sont affichés séparément."
                )}
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
        // Baselines par dimension restreintes au périmètre + tous les mouvements du périmètre
        // (actuel / cible indépendants de la plage). Non scopable → note à la place (M3).
        const positionRows = absoluteAvailable
          ? hr.ftePositionsByDimension(scopedWf, dimension)
          : [];
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t(
                "hr.widget.departmentTable",
                "Effectifs par dimension — référence vs actuel vs cible"
              )}
              actions={
                <ViewToggle
                  options={[
                    { value: "department", label: t("hr.department", "Département") },
                    { value: "country", label: t("dashboard.country", "Pays") },
                    { value: "workstream", label: t("dashboard.workstream", "Chantier") },
                  ]}
                  value={dimension}
                  onChange={(next) =>
                    updateLayout(setHrWidgetView(layout, instance.instanceId, next))
                  }
                />
              }
            />
            <CardBody flush>
              {!absoluteAvailable && (
                <p className="px-3 py-3 text-[11.5px] text-tertiary">{baselineNote}</p>
              )}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      {[
                        dimension === "department"
                          ? t("hr.department", "Département")
                          : dimension === "country"
                            ? t("dashboard.country", "Pays")
                            : t("hr.pivot.dim.workstream", "Chantier"),
                        t("hr.column.baselineFte", "ETP de référence"),
                        t("hr.current", "Actuel"),
                        t("hr.target", "Cible"),
                        t("hr.gapVsTarget", "Écart vs cible"),
                        t("hr.progress", "Avancement"),
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
                      const pct = d.progressPct;
                      return (
                        <tr
                          key={d.key}
                          className="border-b border-border last:border-b-0 hover:bg-neutral-50"
                        >
                          <td className="px-3 py-2.5 font-semibold text-primary">{d.label}</td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {d.baseline.toLocaleString(intlTag())}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {d.current.toLocaleString(intlTag())}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {d.target.toLocaleString(intlTag())}
                          </td>
                          <td
                            className={`px-3 py-2.5 font-semibold tabular-nums ${d.gapToTarget > 0 ? "text-rag-red" : "text-rag-green-dark"}`}
                          >
                            {d.gapToTarget > 0 ? "+" : ""}
                            {d.gapToTarget.toLocaleString(intlTag())}
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
                  const pct = d.progressPct;
                  return (
                    <div key={d.key} className="p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-primary">{d.label}</span>
                        <span
                          className={`text-[12px] font-semibold tabular-nums ${d.gapToTarget > 0 ? "text-rag-red" : "text-rag-green-dark"}`}
                        >
                          {d.gapToTarget > 0 ? "+" : ""}
                          {d.gapToTarget.toLocaleString(intlTag())} {t("hr.vsTarget", "vs cible")}
                        </span>
                      </div>
                      <dl className="mb-2 grid grid-cols-3 gap-x-3 gap-y-1.5">
                        {[
                          { label: t("finance.baseline", "Référence"), value: d.baseline },
                          { label: t("hr.current", "Actuel"), value: d.current },
                          { label: t("hr.target", "Cible"), value: d.target },
                        ].map((item) => (
                          <div key={item.label}>
                            <dt className="text-[10px] font-bold uppercase tracking-wide text-tertiary">
                              {item.label}
                            </dt>
                            <dd className="text-[12px] tabular-nums text-primary">
                              {item.value.toLocaleString(intlTag())}
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
            <CardHeader title={t("hr.widget.movementsTable", "Synthèse des mouvements")} />
            <CardBody>
              <EditableTable
                data={movementTableRows}
                columns={movementTableColumns}
                onCellUpdate={handleMovementTableUpdate}
                onRowClick={(row) => {
                  const lever = data.levers.find((item) => item.id === row.movement.leverId);
                  router.push(etpMovementFilterLink(lever ? { f_lever: [lever.code] } : {}));
                }}
                searchPlaceholder={t(
                  "hr.movementsSearchPlaceholder",
                  "Rechercher un mouvement, programme, responsable..."
                )}
                defaultSort={{ key: "plannedDate", direction: "asc" }}
              />
              {!canEditMovements && movementTableRows.length > 0 && (
                <p className="mt-2 text-[10.5px] text-tertiary">
                  {t(
                    "hr.readOnlyHint",
                    "Lecture seule — l'édition est réservée aux rôles RH et CTO."
                  )}
                </p>
              )}
            </CardBody>
          </Card>
        );
      case "movements-merged": {
        const programLabels = Object.fromEntries(
          programs.map((program) => [program.id, program.name])
        );
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t("hr.widget.movementsMerged", "Mouvements — vue combinée (proposition)")}
            />
            <CardBody>
              <MovementBreakdownMergedChart
                movements={filteredMovements}
                programLabels={programLabels}
                dateRange={dateRange}
                onDrilldown={(title, movements, balance) =>
                  setDrilldownModal({ title, movements, balance })
                }
              />
              <p className="mt-2 text-[11px] text-tertiary">
                {t(
                  "hr.widget.movementsMergedHint",
                  "Proposition à l'étude (regroupe les 2 vues dimension/période ci-dessus, mêmes données) — bascule interne pour comparer avant de décider de garder l'une, l'autre, ou les deux."
                )}
              </p>
            </CardBody>
          </Card>
        );
      }
      case "movement-progress": {
        // Avancement des mouvements (5 statuts d'exécution) par programme / département / pays —
        // mêmes données filtrées que les widgets voisins (`filteredMovements`), dimension
        // persistée dans `instance.view` comme `department-breakdown`.
        const dimension: MovementProgressDimension =
          instance.view === "department" || instance.view === "country" ? instance.view : "program";
        const programLabels = Object.fromEntries(
          programs.map((program) => [program.id, program.name])
        );
        const rows = movementProgressByDimension(filteredMovements, dimension, programLabels);
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t(
                "hr.widget.movementProgress",
                "Avancement des mouvements par {dim} (proposition)"
              ).replace(
                "{dim}",
                dimension === "country"
                  ? t("hr.dimLower.country", "pays")
                  : dimension === "department"
                    ? t("hr.dimLower.department", "département")
                    : t("hr.dimLower.program", "programme")
              )}
              actions={
                <ViewToggle
                  options={[
                    { value: "program", label: t("dashboard.program", "Programme") },
                    { value: "department", label: t("hr.department", "Département") },
                    { value: "country", label: t("dashboard.country", "Pays") },
                  ]}
                  value={dimension}
                  onChange={(next) =>
                    updateLayout(setHrWidgetView(layout, instance.instanceId, next))
                  }
                />
              }
            />
            <CardBody>
              <MovementProgressByDimensionChart
                data={rows}
                onSegmentClick={(row, status) =>
                  setProgressDrilldown(
                    status === null
                      ? {
                          title: t("hr.drilldown.dimensionTitle", "Mouvements — {label}").replace(
                            "{label}",
                            row.label
                          ),
                          movements: Object.values(row.movementsByStatus).flat(),
                        }
                      : {
                          title: t(
                            "hr.drilldown.dimensionStatusTitle",
                            "Mouvements — {label} · {status}"
                          )
                            .replace("{label}", row.label)
                            .replace("{status}", movementProgressStatusLabel(t, status)),
                          movements: row.movementsByStatus[status],
                        }
                  )
                }
              />
              <p className="mt-2 text-[11px] text-tertiary">
                {t(
                  "hr.widget.movementProgressHint",
                  "Proposition à l'étude — cliquer sur un segment (ou sur le nom d'un groupe) pour voir le détail des mouvements. « À venir » = ni réalisé, ni abandonné, ni en retard, selon la date prévue."
                )}
              </p>
            </CardBody>
          </Card>
        );
      }
      case "hr-pivot": {
        // Vue construite (builder générique indicateur × dimension, lib/hrDashboardPivot.ts) —
        // rend enfin atteignable le flux "Configurer le widget" / "Ajouter une vue" (m6).
        const views = resolveHrCustomViews(instance);
        const active = resolveHrActiveCustomView(instance);
        const metric = active ? getHrMetricDef(active.metric) : undefined;
        const rows = active
          ? pivotWorkforceByDimension(filteredMovements, active.metric, active.dimension, {
              locale: intlLocale,
            })
          : [];
        const formatPivotValue = (value: number) =>
          !metric || metric.aggregation === "count"
            ? value.toLocaleString(intlLocale)
            : metric.key === "fteImpact"
              ? `${value.toLocaleString(intlLocale, { maximumFractionDigits: 1 })} ${t("etp.column.fte", "ETP")}`
              : fmtCurr(value / 1_000_000);
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={
                active
                  ? describeHrCustomView(active, t)
                  : t("hr.widget.customPivot", "Vue personnalisée (indicateur × dimension)")
              }
              actions={
                views.length > 1 ? (
                  <ViewToggle
                    options={views.map((v) => ({ value: v.id, label: describeHrCustomView(v, t) }))}
                    value={active?.id ?? ""}
                    onChange={(next) =>
                      updateLayout(setHrWidgetView(layout, instance.instanceId, next))
                    }
                  />
                ) : undefined
              }
            />
            <CardBody>
              {!active ? (
                <p className="py-10 text-center text-sm text-tertiary">
                  {t(
                    "hr.pivot.noView",
                    "Aucune vue configurée — ajoutez-en une via « Personnaliser »."
                  )}
                </p>
              ) : (
                <HrPivotBarChart
                  data={rows.map((row) => ({ label: row.label, value: row.value }))}
                  formatValue={formatPivotValue}
                  onBarClick={(label) => {
                    const dim = getHrDimensionDef(active.dimension);
                    const row = rows.find((r) => r.label === label);
                    if (!dim || !row) return;
                    setDrilldownModal({
                      title: t("hr.drilldown.dimensionTitle", "Mouvements — {label}").replace(
                        "{label}",
                        label
                      ),
                      movements: filteredMovements.filter((m) => {
                        const raw = dim.getValue(m);
                        return (raw && raw.trim() !== "" ? raw : "Non renseigné") === row.key;
                      }),
                    });
                  }}
                />
              )}
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
          <div className="flex items-center gap-2">
            <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
              {t("nav.hrDashboard", "Tableau de bord RH")}
            </h1>
            <span className="flex items-center gap-1 rounded-sm border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary">
              <Lock size={10} />
              {t("hr.confidential", "Confidentiel")}
            </span>
          </div>
          <div className="mt-2.5 text-[13px] text-secondary">
            {(absoluteAvailable
              ? t(
                  "hr.subtitle",
                  "Trajectoire effectifs {from} → {to} ETP · {count} mouvements · {realized} réalisés"
                )
              : t("hr.subtitleNoBaseline", "{count} mouvements · {realized} réalisés")
            )
              .replace("{from}", baselineFte.toLocaleString(intlTag()))
              .replace("{to}", target.toLocaleString(intlTag()))
              .replace("{count}", String(filteredMovements.length))
              .replace("{realized}", String(realizedMovements))}
            {hasActiveFilters && (
              <span className="ml-1 text-bp-coral">
                {t("hr.filteredSuffix", "(filtré · {a}/{b})")
                  .replace("{a}", String(filteredMovements.length))
                  .replace("{b}", String(wf.movements.length))}
              </span>
            )}
          </div>
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          {!editMode && (
            <DashboardExportButton
              layout={layout}
              gridSelector="[data-hr-dashboard-widget-grid]"
              coverTitle={t("hr.export.coverTitle", "BeTrack — Dashboard RH")}
              fileNamePrefix="betrack_hr_dashboard"
              coverDate={t("hr.export.dataDate", "Données au {date}").replace(
                "{date}",
                new Date(`${today}T00:00:00`).toLocaleDateString(intlLocale)
              )}
              contextLines={exportContextLines}
            />
          )}
          <Button
            variant={editMode ? "dark" : "outline"}
            size="md"
            onClick={() => setEditMode((v) => !v)}
          >
            <LayoutGrid size={14} />
            {editMode ? t("dashboard.done", "Terminer") : t("dashboard.customize", "Personnaliser")}
          </Button>
          <Button variant="primary" onClick={() => router.push("/hr/etp")}>
            <Users size={13} /> {t("hr.openEtpBase", "Ouvrir la Base ETP")}
          </Button>
        </div>
        {/* Mobile : bouton condensé pour la Base ETP */}
        <div className="flex items-center gap-2 lg:hidden">
          <Button variant="primary" size="sm" onClick={() => router.push("/hr/etp")}>
            <Users size={13} /> {t("nav.hrEtp", "Base ETP")}
          </Button>
        </div>
      </div>

      {/* Filtres RH — rangée de dropdowns compacts (voir `DropdownFilterBar.tsx`), passent
          naturellement à la ligne sur mobile via `flex-wrap`. Filtrent tous les graphiques et
          KPI. */}
      <div className="mb-4">
        <DropdownFilterBar
          items={wf.movements}
          multiple
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
            <span className="text-[13px] text-secondary">
              {t("hr.movementsRealizedLabel", "mouvements réalisés")}
            </span>
          </div>
          {absoluteAvailable ? (
            <div className="flex items-center gap-3 text-[12px] tabular-nums text-secondary">
              <span>
                <strong className="text-primary">{current.toLocaleString(intlTag())}</strong>{" "}
                {t("hr.etpActuels", "ETP actuels")}
              </span>
              <span className="text-tertiary">→</span>
              <span>
                {t("hr.targetLower", "cible")}{" "}
                <strong className="text-primary">{target.toLocaleString(intlTag())}</strong>
              </span>
              <span className="rounded-sm bg-neutral-100 px-1.5 py-0.5 text-[11px] font-bold text-primary">
                {goalPct}%
              </span>
            </div>
          ) : (
            <span className="max-w-[560px] text-[11.5px] text-tertiary">{baselineNote}</span>
          )}
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
        {absoluteAvailable && (
          <div className="mt-1 flex justify-between text-[10px] text-tertiary">
            <span>
              {t("hr.baselineFteLine", "Référence {n} ETP").replace(
                "{n}",
                baselineFte.toLocaleString(intlTag())
              )}
            </span>
            <span>
              {t("hr.landingPrefix", "Atterrissage")} {landing.toLocaleString(intlTag())} (
              {landing - target > 0 ? "+" : ""}
              {(landing - target).toLocaleString(intlTag())} {t("hr.vsTarget", "vs cible")})
            </span>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════════════════════
          4 KPI Gooduelle — Impact ETP / Économies salariales annuelles / Coûts sociaux consommés
          / Économies nettes — chacun affiche réalisé + cible + reforecast + barre de progression.
          Alimenté par `hrProgramSummary` (source unique — voir lib/hrProgramSummary.ts).
          ═══════════════════════════════════════════════════════════════════════════════════════ */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HrKPICard
          label={t("hr.kpi.fteImpact", "Impact ETP")}
          value={summary.fte.realized.toLocaleString(intlTag())}
          sub={t("hr.kpi.subPattern", "Cible {target} · Réactualisé {reforecast} · {pct}%")
            .replace("{target}", summary.fte.target.toLocaleString(intlTag()))
            .replace("{reforecast}", summary.fte.reforecast.toLocaleString(intlTag()))
            .replace("{pct}", String(summary.fte.progressPct))}
          barPct={summary.fte.progressPct}
          barMarkerPct={
            summary.fte.target !== 0
              ? Math.round((Math.abs(summary.fte.reforecast) / Math.abs(summary.fte.target)) * 100)
              : undefined
          }
          accent="default"
          infoTooltip={t(
            "hr.kpi.fteImpactTooltip",
            "Suivi réel des mouvements RH (recrutements, départs, mobilité), à comparer à titre indicatif à l'ETP planifié au niveau des leviers (voir Pilotage global)."
          )}
        />
        <HrKPICard
          label={t("hr.kpi.netSalarySavings", "Économies nettes de masse salariale")}
          value={fmtCurr(summary.salarySavings.realized / 1_000_000)}
          sub={t("hr.kpi.subPattern", "Cible {target} · Réactualisé {reforecast} · {pct}%")
            .replace("{target}", fmtCurr(summary.salarySavings.target / 1_000_000))
            .replace("{reforecast}", fmtCurr(summary.salarySavings.reforecast / 1_000_000))
            .replace("{pct}", String(summary.salarySavings.progressPct))}
          barPct={summary.salarySavings.progressPct}
          barMarkerPct={
            summary.salarySavings.target > 0
              ? Math.round((summary.salarySavings.reforecast / summary.salarySavings.target) * 100)
              : undefined
          }
          accent="green"
          infoTooltip={t(
            "hr.kpi.netSalarySavingsTooltip",
            "Économies annuelles de masse salariale nettes des recrutements (− impact masse salariale) — même définition que le graphique « Économies par période et cumul »."
          )}
        />
        <HrKPICard
          label={t("hr.kpi.socialCostsConsumed", "Coûts sociaux consommés")}
          value={fmtCurr(summary.socialCost.realized / 1_000_000)}
          sub={t("hr.kpi.subPattern", "Cible {target} · Réactualisé {reforecast} · {pct}%")
            .replace("{target}", fmtCurr(summary.socialCost.target / 1_000_000))
            .replace("{reforecast}", fmtCurr(summary.socialCost.reforecast / 1_000_000))
            .replace("{pct}", String(summary.socialCost.progressPct))}
          barPct={summary.socialCost.progressPct}
          barMarkerPct={
            summary.socialCost.target > 0
              ? Math.round((summary.socialCost.reforecast / summary.socialCost.target) * 100)
              : undefined
          }
          accent="red"
        />
        <HrKPICard
          label={t("hr.kpi.netSavings", "Économies nettes")}
          value={fmtCurr(summary.netEconomy.realized / 1_000_000)}
          sub={t("hr.kpi.subPattern", "Cible {target} · Réactualisé {reforecast} · {pct}%")
            .replace("{target}", fmtCurr(summary.netEconomy.target / 1_000_000))
            .replace("{reforecast}", fmtCurr(summary.netEconomy.reforecast / 1_000_000))
            .replace("{pct}", String(summary.netEconomy.progressPct))}
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
            <button
              type="button"
              onClick={() => setAlertsModal({ kind: null })}
              className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
            >
              <TriangleAlert size={14} className="text-rag-amber" />{" "}
              {t("hr.alertedMovementsCount", "{n} mouvement(s) en alerte").replace(
                "{n}",
                String(alertedMovementCount)
              )}
            </button>
            {alertCounts.map(({ kind, count }) => (
              <button
                key={kind}
                type="button"
                onClick={() => setAlertsModal({ kind })}
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
                {movementAlertMessage(t, a)}
              </div>
            ))}
            {alerts.length > 3 && (
              <button
                type="button"
                onClick={() => setAlertsModal({ kind: null })}
                className="text-xs font-medium text-bp-coral hover:underline"
              >
                {t("hr.alertsModal.seeAll", "Voir la synthèse des {n} alertes →").replace(
                  "{n}",
                  String(alerts.length)
                )}
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
                {t("hr.customizePanelTitle", "Personnalisez votre tableau de bord RH")}
              </div>
              <div className="text-[11.5px] text-secondary">
                {t(
                  "hr.customizePanelHint",
                  "Ajoutez, déplacez, redimensionnez ou retirez des widgets — sauvegardé sur cet appareil."
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={addPanelOpen ? "dark" : "primary"}
                size="sm"
                onClick={() => setAddPanelOpen((v) => !v)}
              >
                <Plus size={13} />
                {t("dashboard.addWidget", "Ajouter un widget")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateLayout(buildHrDefaultLayout())}
              >
                <RotateCcw size={13} />
                {t("dashboard.reset", "Réinitialiser")}
              </Button>
              <Button variant="dark" size="sm" onClick={() => setEditMode(false)}>
                <LayoutGrid size={13} />
                {t("dashboard.done", "Terminer")}
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
                      {t(HR_WIDGET_LABEL_KEYS[def.type], def.label)}
                    </span>
                    {alreadyPresent && (
                      <span className="text-[10px] font-medium text-tertiary">
                        {t("hr.alreadyOnDashboard", "Déjà sur le tableau de bord")}
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
        title={t(
          "dashboard.builderModal.alreadyOnDashboard",
          "Ce graphique est déjà sur votre tableau de bord"
        )}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-secondary">
            {t(
              "dashboard.builderModal.addOrExtend",
              "Ajoutez-le comme nouveau bloc séparé, ou ajoutez cette vue au sélecteur d'un bloc déjà présent (petit bouton en haut du graphique) plutôt que de dupliquer."
            )}
          </p>
          <button
            type="button"
            onClick={() => builderChoiceType && openBuilderConfig(builderChoiceType, null)}
            className="w-full rounded-md border border-border-strong p-3 text-left text-[12.5px] font-semibold text-primary transition hover:border-bp-coral"
          >
            {t("dashboard.builderModal.addAsNewWidget", "Ajouter comme nouveau widget")}
          </button>
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
              {t(
                "dashboard.builderModal.addViewToExisting",
                "Ou ajouter une vue à un bloc existant"
              )}
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
                    <span className="font-semibold text-primary">
                      {t("dashboard.builderModal.existingBlock", "Bloc existant n°{n}").replace(
                        "{n}",
                        String(i + 1)
                      )}
                    </span>
                    {active && (
                      <span className="mt-0.5 block text-[11px] text-tertiary">
                        {t("dashboard.builderModal.currentView", "Vue actuelle : {view}").replace(
                          "{view}",
                          describeHrCustomView(active, t)
                        )}
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
        title={
          builderTargetInstanceId
            ? t("dashboard.builderModal.addView", "Ajouter une vue")
            : t("dashboard.builderModal.configureWidget", "Configurer le widget")
        }
        footer={
          <>
            <Button variant="ghost" onClick={closeBuilderConfig}>
              {t("common.cancel", "Annuler")}
            </Button>
            <Button variant="primary" onClick={confirmBuilderConfig} disabled={!builderConfigValid}>
              {builderTargetInstanceId
                ? t("dashboard.builderModal.addViewBtn", "Ajouter la vue")
                : t("dashboard.builderModal.addWidgetBtn", "Ajouter le widget")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-primary">
            {t("dashboard.builderModal.metric", "Indicateur (métrique)")}
            <select
              value={builderMetric}
              onChange={(e) => setBuilderMetric(e.target.value)}
              className="rounded-md border border-border-strong px-2.5 py-2 text-[13px] font-normal text-primary"
            >
              <option value="">
                {t("dashboard.builderModal.choosePlaceholder", "— Choisir —")}
              </option>
              {HR_METRIC_REGISTRY.map((m) => (
                <option key={m.key} value={m.key}>
                  {t(`hr.pivot.metric.${m.key}`, m.label)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-primary">
            {t("dashboard.builderModal.dimension", "Dimension")}
            <select
              value={builderDim}
              onChange={(e) => setBuilderDim(e.target.value)}
              className="rounded-md border border-border-strong px-2.5 py-2 text-[13px] font-normal text-primary"
            >
              <option value="">
                {t("dashboard.builderModal.choosePlaceholder", "— Choisir —")}
              </option>
              {HR_DIMENSION_REGISTRY.map((d) => (
                <option key={d.key} value={d.key}>
                  {t(`hr.pivot.dim.${d.key}`, d.label)}
                </option>
              ))}
            </select>
          </label>
          {!builderConfigValid && (
            <p className="text-[11.5px] text-tertiary">
              {builderMetric === ""
                ? t(
                    "dashboard.builderModal.chooseMetricHint",
                    "Choisissez un indicateur pour continuer."
                  )
                : t("hr.chooseDimensionHint", "Choisissez une dimension pour continuer.")}
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
          <strong className="text-primary">
            {t("hr.noProgramTitle", "Aucun programme configuré")}
          </strong>{" "}
          {t(
            "hr.noProgramBody",
            "pour cette entreprise. Les widgets restent en lecture sur toute la période de mouvements disponibles. Configurer un programme dans Admin → Programmes pour activer les préréglages d'exercice et le périmètre programme."
          )}
        </div>
      )}

      {selectedProgramId && !programScopeHasMovements && wf.movements.length > 0 && (
        <div className="mb-4 rounded-lg border border-rag-amber/40 bg-rag-amber-light p-3 text-[12px] text-secondary">
          <strong className="text-primary">
            {t("hr.programScopeMismatchTitle", "Programme sélectionné sans mouvement associé")}
          </strong>{" "}
          {t(
            "hr.programScopeMismatchBody",
            "aucun mouvement RH ne référence ce programme : le périmètre programme est temporairement désactivé et tous les mouvements disponibles sont affichés."
          )}
        </div>
      )}

      {/* Barre transverse modernisée (voir components/shared/PeriodToolbar.tsx) — mêmes états
       *  (selectedProgramId, dateFromISO/dateToISO) et mêmes préréglages qu'avant : "Programme
       *  complet" = plage RÉELLE des mouvements (pas activeProgram.fyStart/fyEnd qui pouvait exclure
       *  les exercices ultérieurs), "Réalisé à date", puis un préréglage par FY couvert par les
       *  mouvements. En vue consolidée (Topbar), `activeProgram` global est null : pas de sélecteur
       *  mono-programme, le scope couvre déjà tous les programmes (voir filteredMovements). */}
      <PeriodToolbar
        program={
          isConsolidatedView
            ? { kind: "consolidated", label: t("topbar.consolidatedViewShort", "Vue consolidée") }
            : {
                kind: "select",
                value: selectedProgramId,
                options: programs.map((p) => ({ value: p.id, label: p.name })),
                onChange: setSelectedProgramId,
              }
        }
        fromISO={dateFromISO}
        toISO={dateToISO}
        minISO={movementDateRange.from}
        maxISO={movementDateRange.to}
        onRangeChange={({ fromISO, toISO }) => setUserRange(fromISO, toISO)}
        presets={hrPeriodPresets}
        onReset={() => {
          // Retour à la plage par défaut, qui suit de nouveau les données.
          userRangeRef.current = false;
          setDateFromISO(movementDateRange.from);
          setDateToISO(movementDateRange.to);
        }}
        isDefault={dateFromISO === movementDateRange.from && dateToISO === movementDateRange.to}
      />

      <div
        data-hr-dashboard-widget-grid
        className="grid grid-cols-1 grid-flow-row-dense items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {layout.map((instance) => renderWidget(instance))}
      </div>

      {/* Drill-down waterfall par levier */}
      <Modal
        open={drillBucket !== null}
        onOpenChange={(open) => !open && setDrillBucket(null)}
        title={(drillKind === "salary"
          ? t("hr.drillTitleSalary", "Masse salariale {prefix} {bucket} — décomposition par levier")
          : t("hr.drillTitle", "Mouvements {prefix} {bucket} — décomposition par levier")
        )
          .replace(
            "{prefix}",
            granularity === "month"
              ? t("hr.drillPrefixMonth", "du mois de")
              : t("hr.drillPrefixOther", "du")
          )
          .replace("{bucket}", drillBucketLabel)}
        maxWidth="640px"
      >
        {drill.length === 0 ? (
          <p className="py-6 text-center text-sm text-tertiary">
            {t("hr.noMovementsPeriod", "Aucun mouvement sur cette période.")}
          </p>
        ) : (
          <div className="space-y-3">
            {drillBucketMovements.length >= 2 && (
              <button
                type="button"
                onClick={() => {
                  const ids = drillBucketMovements.map((m) => m.id);
                  setDrillBucket(null);
                  router.push(etpMovementDeepLink(ids));
                }}
                className="inline-flex w-fit items-center gap-1.5 rounded-md border border-bp-coral/40 bg-bp-coral/5 px-3 py-1.5 text-[12px] font-semibold text-bp-coral transition hover:border-bp-coral hover:bg-bp-coral/10"
              >
                {t("hr.drillSeeInEtp", "Voir ces {n} mouvements dans la Base ETP").replace(
                  "{n}",
                  String(drillBucketMovements.length)
                )}
                <ArrowUpRight size={13} />
              </button>
            )}
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
                      {entry.value > 0 ? "+" : ""}
                      {drillKind === "salary"
                        ? formatMillions(entry.value, 2)
                        : `${formatNumber(entry.value)} ${t("etp.column.fte", "ETP")}`}
                    </span>
                  </div>
                  {lever && (
                    <div className="mt-0.5 text-[10.5px] text-tertiary">
                      {lifecycle.label(lever.status)} · {t("hr.plannedEnd", "fin prévue")}{" "}
                      {lever.end}
                    </div>
                  )}
                  <div className="mt-2 space-y-1">
                    {entry.movements.map((m) => (
                      <div key={m.id} className="flex items-center justify-between text-[11px]">
                        <span className="text-secondary">
                          {movementTypeLabel(t, m.type)} · {m.label}
                        </span>
                        <span className="text-tertiary">
                          {m.plannedDate} · {movementStatusLabel(t, m.status)}
                          {m.hrValidated ? t("etp.hrValidatedSuffix", " ✓RH") : ""}
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

      {/* Drill-down générique — "Mouvements prévus par {dimension}", "Statut des mouvements par
          type" et "Détail mensuel des mouvements" (item 3-5, round <n>) : un seul état partagé,
          voir `drilldownModal` ci-dessus. */}
      <MovementDrilldownModal
        open={drilldownModal !== null}
        onOpenChange={(open) => !open && setDrilldownModal(null)}
        title={drilldownModal?.title ?? ""}
        movements={drilldownModal?.movements ?? []}
        balance={drilldownModal?.balance}
      />

      {/* Drill-down détaillé ("qui a fait quoi") — widget "Avancement des mouvements par
          {dimension}", voir `progressDrilldown` ci-dessus. */}
      <MovementDetailDrilldownModal
        open={progressDrilldown !== null}
        onOpenChange={(open) => !open && setProgressDrilldown(null)}
        title={progressDrilldown?.title ?? ""}
        movements={progressDrilldown?.movements ?? []}
        programLabels={Object.fromEntries(programs.map((program) => [program.id, program.name]))}
      />

      {/* Synthèse des alertes mouvements — voir `alertsModal` ci-dessus. */}
      <MovementAlertsSummaryModal
        open={alertsModal !== null}
        onOpenChange={(open) => !open && setAlertsModal(null)}
        alerts={alerts}
        initialKind={alertsModal?.kind ?? null}
        levers={data.levers}
        programLabels={Object.fromEntries(programs.map((program) => [program.id, program.name]))}
      />
    </div>
  );
}

function MovementCommentEditor({
  value,
  onSave,
}: {
  value: string;
  onSave: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onSave(draft);
  };
  return (
    <textarea
      rows={2}
      value={draft}
      placeholder={t("hr.commentPlaceholder", "Ajouter un commentaire")}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        }
      }}
      className="min-w-[220px] resize-y rounded-sm border border-border bg-white px-2 py-1.5 text-xs focus:border-bp-coral focus:outline-none"
    />
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
  const { t } = useTranslation();
  return (
    <SegmentedControl
      label={t("common.segmented.view", "Affichage")}
      showLabel={false}
      options={options}
      value={value}
      onChange={onChange}
    />
  );
}

function ExecutionDimensionToggle({
  value,
  onChange,
}: {
  value: ExecutionDimension;
  onChange: (value: ExecutionDimension) => void;
}) {
  const { t } = useTranslation();
  return (
    <ViewToggle
      options={[
        { value: "function", label: t("dashboard.function", "Fonction") },
        { value: "country", label: t("dashboard.country", "Pays") },
        { value: "program", label: t("dashboard.program", "Programme") },
      ]}
      value={value}
      onChange={(next) => onChange(next as ExecutionDimension)}
    />
  );
}
