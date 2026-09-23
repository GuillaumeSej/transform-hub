"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useMultiFilterBarState } from "@/lib/hooks/useMultiFilterBarState";
import { matchesFilter, serializeFilterValues, toggleInSelection } from "@/lib/filterUtils";
import { resolveHierarchyPath } from "@/lib/hierarchyLogic";
import { type FilterDef } from "@/components/shared/FilterBar";
import { DropdownFilterBar } from "@/components/shared/DropdownFilterBar";
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
import { isAnyAdmin, isReadOnlyUser } from "@/lib/roleProfiles";
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
import { paginateDashboardItems } from "@/lib/dashboardPagination";
import { groupLeversByHealthDimension, type LeverHealthDimension } from "@/lib/leverHealth";
import { ArrowDown, ArrowRight, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/shared/Avatar";
import { SCurveChart, type SCurvePoint } from "@/components/shared/charts/SCurveChart";
import { SCurveDetail } from "@/components/shared/charts/SCurveDetail";
import { gapEntriesAt } from "@/lib/scurveDetail";
import { currentPointIndex } from "@/components/shared/charts/SCurveChart";
import {
  WorkstreamBarChart,
  WorkstreamBarDetail,
  type WorkstreamBarPoint,
} from "@/components/shared/charts/WorkstreamBarChart";
import { GeoDonutChart } from "@/components/shared/charts/GeoDonutChart";
import { InitiativeHealthMatrix } from "@/components/shared/charts/InitiativeHealthMatrix";
import { StageFunnel } from "@/components/shared/charts/StageFunnel";
import { MarimekkoChart } from "@/components/shared/charts/MarimekkoChart";
import { SavingsWaterfallChart } from "@/components/shared/charts/SavingsWaterfallChart";
import { oneOffGainsTotal, savingsTriple } from "@/lib/dashboardSavings";
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

/** Correspondance dimension → paramètre de filtre de `/levers` (`f_xxx`, voir
 * `LeversPagePerformance.tsx`), pour le clic de drill-down depuis un graphique du builder
 * générique vers la liste des leviers.
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

export function DashboardPagePerformance() {
  const { user } = useRole();
  const readOnly = isReadOnlyUser(user);
  const data = useBeTrackData(user?.companyId ?? null);
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Dashboard scopé à UN programme (voir sélecteur de programme plus bas) — le cycle de vie est
  // désormais une config par programme (lib/firestore/admin.ts), d'où la lecture anticipée de
  // `?program=` pour alimenter `useLifecycleLabels` avec le bon scope.
  const selectedProgramId = searchParams.get("program") ?? "";
  const lifecycle = useLifecycleLabels(selectedProgramId || undefined);
  // Contexte global "programme actif" — synchronisé dans les deux sens avec le `?program=` de
  // cette page (voir plus bas). `isConsolidatedView`/`consolidatedPrograms` pilotent le mode "vue
  // consolidée" (fondation chantier CTO multi-programmes, voir lib/consolidatedProgramAccess.ts) :
  // au lieu d'un unique `selectedProgramId`, les leviers/alertes/KPI de CE dashboard doivent alors
  // agréger TOUS les programmes de `consolidatedPrograms` — voir `programScopedLevers` plus bas.
  const { activeProgramId, setActiveProgramId, isConsolidatedView, consolidatedPrograms } =
    useActiveProgram();

  // Société courante — utilisée pour le budget CAPEX de référence (KPI ci-dessous) et
  // l'habilitation de confidentialité (filtrage des leviers visibles par profil).
  const [company, setCompany] = useState<Company | null>(null);
  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      setCompany(companies.find((c) => c.id === user?.companyId) ?? null);
    }, user?.companyId ?? null);
    return unsub;
  }, [user?.companyId]);

  const clearance = resolveConfidentialityClearance(
    user,
    company?.roleClearance,
    "performance",
    company?.confidentialityLevels
  );
  const visibleLevers = useMemo(
    () =>
      data.levers.filter(
        (l) => isAnyAdmin(user) || isLeverVisibleForClearance(l.confidentialityLevel, clearance)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      data.levers,
      user?.profiles,
      user?.isGlobalAdmin,
      user?.isCompanyAdmin,
      company?.roleClearance,
      company?.confidentialityLevels,
      user?.confidentialityClearance,
    ]
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
    const unsub = subscribePrograms(
      (all) =>
        setPrograms(user?.companyId ? all.filter((p) => p.companyId === user.companyId) : all),
      user?.companyId ?? null
    );
    return unsub;
  }, [user?.companyId]);

  // ── Sélecteur de programme (scope du dashboard) ─────────────────────────────
  // Le dashboard exécutif est scopé à UN programme sélectionné, porté par l'URL (?program=) pour
  // rester partageable/rechargeable (calculé plus haut, avant `lifecycle`, qui en a besoin).
  // Auto-sélection du premier programme disponible si l'URL n'en précise aucun et qu'au moins un
  // programme existe (évite un dashboard vide inutilement pour les entreprises n'ayant qu'un seul
  // programme).

  // Synchronisation bidirectionnelle avec le contexte global "programme actif" : l'URL reste la
  // source de vérité DE CETTE PAGE (partageable/rechargeable), mais le programme choisi ici doit
  // aussi piloter la nav et les autres pages — et, à l'inverse, arriver sur le dashboard depuis
  // une autre page doit conserver le programme déjà actif plutôt que repartir du premier de la
  // liste. D'où l'ancrage sur `activeProgramId` (qui retombe lui-même sur le premier programme
  // disponible, voir useActiveProgram) plutôt que sur `programs[0]` directement.
  useEffect(() => {
    // Vue consolidée : ce dashboard n'a pas besoin d'un `?program=` (il lit `isConsolidatedView`/
    // `consolidatedPrograms` du contexte directement, voir ProgramSwitcher) — ne pas y forcer
    // `CONSOLIDATED_PROGRAM_ID`, qui ne correspond à aucun `programId` réel de levier.
    if (isConsolidatedView) return;
    if (!selectedProgramId && (activeProgramId || programs.length > 0)) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("program", activeProgramId ?? programs[0].id);
      router.replace(`/dashboard?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProgramId, programs, activeProgramId, isConsolidatedView]);

  useEffect(() => {
    // Ne PAS resynchroniser depuis une URL `?program=` restée sur un ancien programme pendant que
    // la vue consolidée est active (sélectionnée depuis le Topbar, qui ne touche pas ce paramètre
    // — voir ProgramSwitcher) : sans cette garde, ce seul effet ramenait aussitôt le contexte hors
    // de la vue consolidée dès le premier rendu (mount, ou rechargement de page).
    if (selectedProgramId && !isConsolidatedView) setActiveProgramId(selectedProgramId);
  }, [selectedProgramId, isConsolidatedView, setActiveProgramId]);

  // Leviers scopés au programme sélectionné — appliqué AVANT le filtrage de la barre de filtres
  // (les options de filtres ne doivent refléter que les leviers du programme courant), mais reste
  // distinct des filtres globaux (c'est un scope, pas un filtre parmi d'autres).
  // Vue consolidée : au lieu d'un unique `selectedProgramId`, le scope devient l'ensemble des
  // `consolidatedPrograms` accessibles à l'utilisateur (voir `getConsolidatedPerformancePrograms`)
  // — tous leurs leviers combinés alimentent alors les KPI/widgets ci-dessous, qui n'ont pas besoin
  // d'être modifiés individuellement puisqu'ils dérivent tous, en cascade, de ce scope.
  const programScopedLevers = useMemo(
    () =>
      isConsolidatedView
        ? visibleLevers.filter((l) => consolidatedPrograms.some((p) => p.id === l.programId))
        : visibleLevers.filter((l) => l.programId === selectedProgramId),
    [visibleLevers, selectedProgramId, isConsolidatedView, consolidatedPrograms]
  );

  // Programme actuellement sélectionné (objet complet, avec ses propres fyStart/fyEnd) — à
  // utiliser à la place de `data.program` (vestige du modèle mono-programme, toujours vide
  // `fyStart: ""`/`fyEnd: ""` depuis la migration multi-programmes, voir emptyProgramConfig()
  // dans lib/hooks/useStorage.ts) pour tout ce qui dépend de l'année fiscale DU PROGRAMME
  // affiché : `new Date("").getFullYear()` vaut NaN, ce qui rendait vide tout filtrage par date
  // dérivé de cette valeur (widget "Trajectoire des économies", filtre P&L).
  // `undefined` en vue consolidée (aucun programme unique) — lire `effectiveFyStart`/
  // `effectiveFyEnd` ci-dessous à la place, qui gèrent aussi ce cas.
  const selectedProgram = useMemo(
    () => programs.find((p) => p.id === selectedProgramId),
    [programs, selectedProgramId]
  );

  // Bornes d'exercice fiscal EFFECTIVES pour les widgets temporels (trajectoire des économies,
  // S-Curve/Bridge, filtre de date) : en vue consolidée, les programmes agrégés peuvent avoir des
  // exercices différents — stratégie volontairement simple (pas de sur-ingénierie) : on prend
  // l'UNION de leurs bornes (date de début la plus ancienne, date de fin la plus tardive), pour
  // qu'aucune donnée d'un des programmes consolidés ne tombe hors de la plage affichée par défaut.
  // Hors vue consolidée : comportement inchangé (bornes du programme sélectionné).
  const effectiveFyStart = useMemo(() => {
    if (isConsolidatedView) {
      const starts = consolidatedPrograms.map((p) => p.fyStart).filter(Boolean);
      return starts.length > 0
        ? starts.reduce((min, s) => (s < min ? s : min))
        : data.program.fyStart;
    }
    return selectedProgram?.fyStart ?? data.program.fyStart;
  }, [isConsolidatedView, consolidatedPrograms, selectedProgram, data.program.fyStart]);

  const effectiveFyEnd = useMemo(() => {
    if (isConsolidatedView) {
      const ends = consolidatedPrograms.map((p) => p.fyEnd).filter(Boolean);
      return ends.length > 0 ? ends.reduce((max, e) => (e > max ? e : max)) : data.program.fyEnd;
    }
    return selectedProgram?.fyEnd ?? data.program.fyEnd;
  }, [isConsolidatedView, consolidatedPrograms, selectedProgram, data.program.fyEnd]);

  // Arborescence financière (optionnelle) de l'entreprise — n'ajoute des dimensions "hiérarchie"
  // au builder générique que si l'entreprise a explicitement configuré des hierarchyLevels (voir
  // lib/dashboardPivot.ts, même pattern défensif que app/(app)/levers/page.tsx).
  const [hierarchyLevels, setHierarchyLevels] = useState<HierarchyLevelDef[]>([]);
  const [hierarchyNodes, setHierarchyNodes] = useState<HierarchyNode[]>([]);
  // Arborescence géographique (optionnelle, domaine séparé) — un filtre par niveau configuré,
  // même principe que la financière : voir geographyFilterDefs plus bas et le pendant sur
  // app/(app)/levers/page.tsx.
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

  const sortedGeographyHierarchyLevels = useMemo(
    () => [...geographyHierarchyLevels].sort((a, b) => a.order - b.order),
    [geographyHierarchyLevels]
  );

  // Un filtre par niveau d'arborescence géographique configuré — remplace le filtre unique
  // "Géographie" dès que l'entreprise a activé l'arborescence, pour qu'un N-ième niveau produise
  // bien un N-ième filtre distinct (répond à "si j'ai 4 niveaux de géographie, 4 filtres ?").
  const geographyFilterDefs: FilterDef<Lever>[] = useMemo(
    () =>
      sortedGeographyHierarchyLevels.map((level) => ({
        key: `geo_${level.key}`,
        label: level.label,
        getValue: (l: Lever) => {
          const path = resolveHierarchyPath(
            l.geographyLeafId ?? "",
            geographyNodes,
            sortedGeographyHierarchyLevels
          );
          return path.find((p) => p.levelKey === level.key)?.label ?? "";
        },
      })),
    [sortedGeographyHierarchyLevels, geographyNodes]
  );

  const filterDefs: FilterDef<Lever>[] = useMemo(
    () => [
      {
        key: "status",
        label: t("hr.status", "Statut"),
        getValue: (l) => lifecycle.label(l.status),
      },
      {
        key: "ws",
        label: "Chantier",
        getValue: (l) => data.workstreams.find((w) => w.id === l.ws)?.name ?? l.ws,
      },
      { key: "owner", label: "Owner", getValue: (l) => l.owner },
      ...(geographyFilterDefs.length > 0
        ? geographyFilterDefs
        : [
            {
              key: "geography",
              label: t("dashboard.geography", "Géographie"),
              getValue: (l: Lever) => l.geography,
            },
          ]),
      {
        key: "function",
        label: t("dashboard.leverDepartment", "Département"),
        getValue: (l) => l.function,
      },
      { key: "type", label: "Type", getValue: (l) => l.type },
    ],
    [data.workstreams, lifecycle, geographyFilterDefs, t]
  );

  // Round <n> : hook partagé `useFilterBarState` (lib/hooks/useFilterBarState.ts) — remplace
  // l'ancien `useGlobalFilters()` (Context à forme FIXE, 6 clés seulement), qui avait un bug
  // silencieux : les dimensions dynamiques `geo_*`/`hierarchy_*` (arborescences géographie/finance
  // configurées par l'entreprise, voir `geographyFilterDefs`/`hierarchyFilterDefs` ci-dessus)
  // n'avaient pas d'entrée dans la table de correspondance de l'ancien `handleFilterChange` —
  // sélectionner une valeur sur l'un de ces filtres ne filtrait donc RIEN, silencieusement. Le
  // hook partagé gère n'importe quelle clé dynamique de `filterDefs` sans table de correspondance.
  const { activeFilters, setFilters } = useMultiFilterBarState(filterDefs);

  // Filtrage générique par `filterDefs` — même patron que `LeversPagePerformance.tsx`/
  // `app/(app)/hr/etp/page.tsx`/`app/(app)/hr/page.tsx` (voir `useFilterBarState`, même base
  // partagée). Remplace `matchesGlobalFilters`, dont la forme fixe ne couvrait pas les dimensions
  // dynamiques ci-dessus (et dont les champs `country`/`risk`/`endMonth`/`endQuarter` n'étaient de
  // toute façon jamais alimentés par cette page — seul `goToLevers`, plus bas, les utilise pour un
  // drill-down VERS `/levers`, indépendamment du filtrage local ici).
  const filteredLevers = useMemo(() => {
    return programScopedLevers.filter((l) =>
      Object.entries(activeFilters).every(([key, value]) => {
        const def = filterDefs.find((d) => d.key === key);
        return !def || matchesFilter(def.getValue(l), value);
      })
    );
  }, [programScopedLevers, activeFilters, filterDefs]);

  const filteredData = useMemo(() => {
    return {
      ...visibleData,
      levers: filteredLevers,
    };
  }, [visibleData, filteredLevers]);

  const summary = engine.programSummary(filteredData);
  const underperformingLevers = useMemo(() => engine.underperformers(filteredData), [filteredData]);

  const depAlerts = useMemo(() => engine.dependencyAlerts(filteredData), [filteredData]);
  const [dependencyPage, setDependencyPage] = useState(0);

  // ── Widget fusionné "Alertes & Dépendances" (risk-center) ──────────────────────────────────
  // Toujours affiché en 2 panneaux côte à côte (alertes | dépendances), chacun titré.
  const [alertSortKey, setAlertSortKey] = useState<"delay" | "savings">("delay");
  const [depsSortKey, setDepsSortKey] = useState<"delay" | "savings">("delay");

  // Proxy de "retard" par alerte : le nombre d'actions en retard du levier lié à `alert.scope`
  // (voir engine.underperformers/isActionLate) — aucun décompte de jours n'est disponible au
  // niveau d'une Alert, donc ce compteur sert d'indicateur de priorisation raisonnable. 0 pour un
  // scope qui ne résout à aucun levier en sous-performance (workstream, scope inconnu, ou levier
  // sans action en retard).
  const leverLateActionsById = useMemo(() => {
    const map = new Map<string, number>();
    underperformingLevers.forEach((l) => map.set(l.id, l.lateActionsCount));
    return map;
  }, [underperformingLevers]);

  const sortedDepAlerts = useMemo(() => {
    const arr = [...depAlerts];
    arr.sort((a, b) =>
      depsSortKey === "savings" ? b.impactEur - a.impactEur : b.delayDays - a.delayDays
    );
    return arr;
  }, [depAlerts, depsSortKey]);

  const dependencyPagination = paginateDashboardItems(sortedDepAlerts, dependencyPage, 6);

  useEffect(() => {
    setDependencyPage(0);
  }, [selectedProgramId, activeFilters]);

  useEffect(() => {
    if (dependencyPage !== dependencyPagination.page) {
      setDependencyPage(dependencyPagination.page);
    }
  }, [dependencyPage, dependencyPagination.page]);

  useEffect(() => {
    setDependencyPage(0);
  }, [depsSortKey]);

  // ── Alertes enrichies (manuelles + auto-générées) ──────────────────────────
  const ALERTS_PER_PAGE = 5;
  const [alertPage, setAlertPage] = useState(0);
  const [alertTypeFilter, setAlertTypeFilter] = useState<string[]>([]);
  const [alertShowResolved, setAlertShowResolved] = useState(false);
  const [manualAlertOpen, setManualAlertOpen] = useState(false);
  const { alerts: allAlerts } = useNotifications(visibleData, user);

  useEffect(() => {
    setAlertPage(0);
  }, [alertSortKey]);

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

  const healthLabels = {
    onTrack: t("dashboard.widgets.healthOnTrack"),
    watch: t("dashboard.widgets.healthWatch"),
    critical: t("dashboard.widgets.healthCritical"),
    cancelled: t("dashboard.widgets.healthCancelled"),
    empty: t("dashboard.widgets.initiativeHealthEmpty"),
  };

  const filteredAlerts = useMemo(() => {
    let result = scopedAlerts;
    if (!alertShowResolved) result = result.filter((a) => !a.resolved);
    if (alertTypeFilter.length > 0) result = result.filter((a) => alertTypeFilter.includes(a.type));
    return result;
  }, [scopedAlerts, alertShowResolved, alertTypeFilter]);

  const sortedFilteredAlerts = useMemo(() => {
    const arr = [...filteredAlerts];
    arr.sort((a, b) => {
      if (alertSortKey === "savings") return (b.impactEur ?? 0) - (a.impactEur ?? 0);
      // Proxy "Retard" — voir commentaire sur `leverLateActionsById` plus haut.
      const la = leverLateActionsById.get(a.scope) ?? 0;
      const lb = leverLateActionsById.get(b.scope) ?? 0;
      return lb - la;
    });
    return arr;
  }, [filteredAlerts, alertSortKey, leverLateActionsById]);

  const alertPageCount = Math.max(1, Math.ceil(sortedFilteredAlerts.length / ALERTS_PER_PAGE));
  const alertPageClamped = Math.min(alertPage, alertPageCount - 1);
  const alertsOnPage = sortedFilteredAlerts.slice(
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
  const [trajGranularity, setTrajGranularity] = useState<engine.TimeGranularity>("month");
  const [trajRangeStart, setTrajRangeStart] = useState(effectiveFyStart);
  const [trajRangeEnd, setTrajRangeEnd] = useState(effectiveFyEnd);
  // Réaligne la plage par défaut sur le programme sélectionné (ou, en vue consolidée, sur l'union
  // des exercices des programmes consolidés — voir `effectiveFyStart`/`effectiveFyEnd`) dès qu'il
  // devient disponible ou change (le premier rendu n'a en général pas encore `programs`, chargé de
  // façon asynchrone) — sans ça `trajRangeStart`/`trajRangeEnd` restaient figés sur la valeur
  // (vide) du tout premier rendu et la S-Curve/Bridge de ce widget n'affichait plus jamais rien,
  // quel que soit le programme ou l'entreprise.
  useEffect(() => {
    if (!isConsolidatedView && !selectedProgram) return;
    setTrajRangeStart(effectiveFyStart);
    setTrajRangeEnd(effectiveFyEnd);
  }, [isConsolidatedView, selectedProgram, effectiveFyStart, effectiveFyEnd]);

  /** Convertit un label de période ("Jan 2026", "Q2 2026") en Date pour le filtrage. */
  const labelToDate = useCallback(
    (label: string, granularity: engine.TimeGranularity): Date => {
      const parts = label.split(" ");
      const year = parseInt(parts[parts.length - 1]) || new Date(effectiveFyStart).getFullYear();
      if (granularity === "quarter") {
        const q = parseInt((parts[0] || "").replace("Q", "")) || 1;
        return new Date(year, (q - 1) * 3, 1);
      }
      const monthIdx = engine.MONTH_LABELS.indexOf(parts[0]);
      return new Date(year, monthIdx >= 0 ? monthIdx : 0, 1);
    },
    [effectiveFyStart]
  );

  const trajSCurve = useMemo(() => {
    const full = engine.savingsSeries(filteredData, trajGranularity);
    const start = new Date(trajRangeStart);
    const end = new Date(trajRangeEnd);
    return full.filter((p) => {
      const d = labelToDate(p.month, trajGranularity);
      return d >= start && d <= end;
    });
  }, [filteredData, trajGranularity, trajRangeStart, trajRangeEnd, labelToDate]);

  // Pop-up de détail de la trajectoire (clic sur la courbe en S).
  const [scurveDetail, setScurveDetail] = useState<{
    points: SCurvePoint[];
    granularity: engine.TimeGranularity;
    /** Période dont on détaille l'écart (période cliquée si réalisée, sinon période courante). */
    month: string;
  } | null>(null);
  const openScurveDetail = (
    points: SCurvePoint[],
    granularity: engine.TimeGranularity,
    clicked?: string
  ) => {
    const clickedPoint = points.find((p) => p.month === clicked);
    const cur = points[currentPointIndex(points)];
    const month = (clickedPoint?.actual != null ? clickedPoint : cur)?.month ?? points[0]?.month;
    if (month) setScurveDetail({ points, granularity, month });
  };
  const scurveGapEntries = useMemo(
    () =>
      scurveDetail ? gapEntriesAt(filteredData, scurveDetail.granularity, scurveDetail.month) : [],
    [scurveDetail, filteredData]
  );
  const sCurve = engine.savingsSeries(filteredData, sCurveGranularity);
  const stages = engine.stageCounts(filteredData);
  const savingsWaterfallData = useMemo(() => engine.savingsWaterfall(filteredData), [filteredData]);
  const oneOffGains = useMemo(() => oneOffGainsTotal(filteredData), [filteredData]);

  // Reporte les filtres actuellement actifs sur CE dashboard vers `/levers` (Bibliothèque de
  // leviers) — dont les `FilterDef.key` sont toujours préfixés `f_` (`f_status`, `f_geo_xxx`,
  // `f_hierarchy_xxx`…, voir `LeversPagePerformance.tsx`), alors que les clés de `filterDefs`
  // ci-dessus ne le sont pas (`status`, `geo_xxx`, `hierarchy_xxx`…) — d'où le préfixage ici.
  const goToLevers = (params: Record<string, string>) => {
    const globalParams: Record<string, string> = {};
    Object.entries(activeFilters).forEach(([key, value]) => {
      if (value.length > 0)
        globalParams[`f_${key}`] = value.length === 1 ? value[0] : serializeFilterValues(value);
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

  // `data.workstreams` vient de `useBeTrackData` → `programConfig`, abonnement Firestore
  // (`onSnapshot`) qui démarre à `[]` (voir `emptyProgramConfig()` dans lib/hooks/useStorage.ts)
  // et se re-déclenche (donc repasse transitoirement par un état vide) à chaque re-souscription —
  // changement de `companyId`, reconnexion réseau, etc. Le widget "Réalisation des économies"
  // (`wsBars` ci-dessous) lit `data.workstreams` directement pour ses libellés d'axe X : sans
  // garde-fou, un de ces instants transitoires vide fait disparaître puis réapparaître les titres
  // sous le bar chart ("bug de loading des titres" signalé). `stableWorkstreams` retient le
  // dernier tableau non vide reçu et ne le remplace que lorsqu'un nouveau tableau non vide arrive,
  // ce qui absorbe ces flashs sans changer le rendu une fois les données réellement chargées (et
  // sans masquer le cas légitime d'un périmètre sans aucun workstream, où `data.workstreams` reste
  // vide en permanence).
  const stableWorkstreamsRef = useRef(data.workstreams);
  if (data.workstreams.length > 0) {
    stableWorkstreamsRef.current = data.workstreams;
  }
  const stableWorkstreams =
    data.workstreams.length > 0 ? data.workstreams : stableWorkstreamsRef.current;

  const wsBars = stableWorkstreams.map((w) => {
    const levers = filteredData.levers.filter((l) => l.ws === w.id && l.status !== "cancelled");
    // Cible recalculée dynamiquement depuis les leviers (bottom-up), PAS `w.target` (champ de
    // configuration manuelle saisi dans l'admin/Configuration, qui peut devenir obsolète par
    // rapport aux leviers réels) — même source que le widget "Synthèse des Workstreams" juste en
    // dessous (`engine.workstreamSummary(filteredData, ws.id).target`, lib/engine.ts, voir son
    // commentaire + celui sur `ss` plus bas). Avant ce fix, les deux widgets affichaient des
    // cibles différentes pour un même workstream dès que `w.target` divergeait de la somme des
    // `netSavings` des leviers actifs (même classe de bug que celui déjà corrigé pour
    // `Program.target`, voir le commentaire plus bas sur l'ambition programme).
    // `target` = cible RÉACTUALISÉE (barre de fond) ; `planned` = planifié initial (contour
    // pointillé) ; `realized` = réalisé. Leviers annulés exclus (voir `savingsTriple`).
    const { planned, reforecast, realized } = savingsTriple(levers);
    return {
      label: w.name,
      target: reforecast,
      planned,
      realized,
      leverBreakdown: {
        target: levers.map((l) => ({
          name: l.name,
          value: engine.displayedReforecastNet(l).value,
        })),
        realized: levers.map((l) => ({ name: l.name, value: engine.realizedSavings(l) })),
      },
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
        const { planned, reforecast, realized } = savingsTriple(levers);
        return {
          label: key,
          target: reforecast,
          planned,
          realized,
          leverBreakdown: {
            target: levers.map((l) => ({
              name: l.name,
              value: engine.displayedReforecastNet(l).value,
            })),
            realized: levers.map((l) => ({ name: l.name, value: engine.realizedSavings(l) })),
          },
        };
      })
      .sort((a, b) => b.target - a.target);
  };
  const countryBars = dimensionBars((l) => l.country);
  const functionBars = dimensionBars((l) => l.function);

  const programMap = engine.byProgram(visibleData, programs);
  // Program.target a été retiré (cible saisie à la main, jamais alignée avec la cible bottom-up —
  // voir le commentaire plus bas sur l'ambition programme) : la cible affichée ici est recalculée
  // par programme sur le même principe que engine.programSummary — somme des netSavings des
  // leviers actifs rattachés au programme.
  const programTargetById = new Map<string, number>();
  const programPlannedById = new Map<string, number>();
  visibleData.levers
    .filter((l) => l.status !== "cancelled")
    .forEach((l) => {
      if (!l.programId) return;
      programTargetById.set(
        l.programId,
        (programTargetById.get(l.programId) ?? 0) + engine.displayedReforecastNet(l).value
      );
      programPlannedById.set(
        l.programId,
        (programPlannedById.get(l.programId) ?? 0) + (l.lockedPlan?.netSavings ?? l.netSavings)
      );
    });
  const programBars = [
    ...programs.map((p) => ({
      label: p.name,
      realized: programMap[p.name] ?? 0,
      target: Math.round((programTargetById.get(p.id) ?? 0) * 10) / 10,
      planned: Math.round((programPlannedById.get(p.id) ?? 0) * 10) / 10,
    })),
    ...(programMap["Non assigné"]
      ? [
          {
            label: t("leverForm.notAssigned", "Non assigné"),
            realized: programMap["Non assigné"],
            target: 0,
          },
        ]
      : []),
  ];

  const geoDataFor = (dimension: string) => {
    const map =
      dimension === "function" ? engine.byFunction(filteredData) : engine.byCountry(filteredData);
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  };
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
  // Détail par levier ouvert au clic sur un segment du widget "workstream-breakdown".
  const [workstreamDetail, setWorkstreamDetail] = useState<{
    point: WorkstreamBarPoint;
    segment: "target" | "realized";
  } | null>(null);

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
              title={t("dashboard.widgetShell.changeSize", "Changer la taille")}
            >
              <Maximize2 size={12} />
              {instance.span}
            </button>
            <button
              type="button"
              onClick={() => updateLayout(removeWidget(layout, instance.instanceId))}
              className="flex items-center rounded px-1 py-0.5 text-tertiary hover:bg-neutral-100 hover:text-bp-coral"
              title={t("dashboard.widgetShell.removeWidget", "Retirer ce widget")}
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
      case "risk-center": {
        // Résumé agrégé (badge replié) : total des alertes non résolues (les cascades de
        // dépendances, AUTO-DEP-*, sont déjà générées par `generateAlerts` et donc déjà comprises
        // dans `filteredAlerts` — ne pas les rajouter une 2e fois via `depAlerts`, sous peine de
        // double comptage). `depAlerts` reste utilisé séparément pour sa propre section ci-dessous.
        const totalAtRisk = filteredAlerts.length;
        const criticalCount = alertCounts.red + depAlerts.filter((a) => a.delayDays > 30).length;
        const depSeverity = (days: number) => {
          if (days > 30) return { label: t("dep.blocking"), cls: "bg-rag-red-light text-rag-red" };
          if (days > 7) return { label: t("dep.watch"), cls: "bg-rag-amber-light text-rag-amber" };
          return { label: t("dep.minor"), cls: "bg-neutral-100 text-secondary" };
        };

        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t("dashboard.widgets.riskCenter")}
              actions={
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    criticalCount > 0
                      ? "bg-rag-red-light text-rag-red"
                      : totalAtRisk > 0
                        ? "bg-rag-amber-light text-rag-amber"
                        : "bg-neutral-100 text-secondary"
                  }`}
                >
                  {t("risk.summary", `${totalAtRisk} leviers en alerte`).replace(
                    "{n}",
                    String(totalAtRisk)
                  )}
                </span>
              }
            />
            <CardBody>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* ── Panneau gauche : Alertes ─────────────────────────────────────────── */}
                <div className="min-w-0">
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-primary">
                    {t("dashboard.widgets.riskCenter.alertsPanel", "Alertes")}
                  </div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {!readOnly && (
                      <button
                        onClick={() => setManualAlertOpen(true)}
                        className="rounded-sm border border-border px-2 py-0.5 text-[10.5px] font-semibold text-secondary transition hover:border-black hover:text-primary"
                      >
                        + Alerte manuelle
                      </button>
                    )}
                    {(["red", "amber", "green", "blue"] as const).map((type) => {
                      const count = alertCounts[type];
                      if (count === 0) return null;
                      const isActive = alertTypeFilter.includes(type);
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
                              setAlertTypeFilter((prev) => toggleInSelection(prev, type))
                            }
                            className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold transition ${colors[type]}`}
                          >
                            {count}
                          </button>
                        </Tooltip>
                      );
                    })}
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
                    <select
                      className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary"
                      value={alertSortKey}
                      onChange={(e) => setAlertSortKey(e.target.value as "delay" | "savings")}
                    >
                      <option value="delay">{t("risk.sortByDelay")}</option>
                      <option value="savings">{t("risk.sortBySavings")}</option>
                    </select>
                    {!readOnly && (
                      <button
                        onClick={markAllResolved}
                        className="ml-auto rounded-sm px-1.5 py-0.5 text-[10px] font-semibold text-tertiary transition hover:bg-neutral-100 hover:text-primary"
                        title={t("alerts.markAllResolved")}
                      >
                        ✓ {t("alerts.markAllResolved")}
                      </button>
                    )}
                  </div>
                  {alertsOnPage.length === 0 ? (
                    <p className="py-6 text-center text-sm text-tertiary">
                      {t("dashboard.widgets.noAlerts")}
                    </p>
                  ) : (
                    <>
                      <div className="max-h-[420px] min-h-[420px] overflow-y-auto pr-1">
                        {alertsOnPage.map((a) => (
                          <AlertItem
                            key={a.id}
                            alert={a}
                            onClick={() => goToAlert(a)}
                            onToggleResolved={
                              readOnly ? undefined : () => toggleAlertResolved(a.id)
                            }
                            scopeLabel={resolveScopeLabel(a.scope)}
                            tooltips={{
                              severity: t(`alerts.tooltip.severity.${a.type}`),
                              impact: t("alerts.tooltip.impact"),
                              auto: t("alerts.tooltip.auto"),
                            }}
                          />
                        ))}
                      </div>
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
                  <ManualAlertForm
                    open={manualAlertOpen}
                    onOpenChange={setManualAlertOpen}
                    data={visibleData}
                    onSubmit={(input) => {
                      if (user) data.createManualAlert(input, user);
                    }}
                  />
                </div>

                {/* ── Panneau droit : Alertes de dépendances ──────────────────────────── */}
                <div className="min-w-0 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-primary">
                    {t("dashboard.widgets.riskCenter.dependenciesPanel", "Dépendances")}
                  </div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-[10.5px] font-semibold text-tertiary">
                      {depAlerts.length} alerte{depAlerts.length !== 1 ? "s" : ""}
                    </span>
                    <select
                      className="ml-auto rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary"
                      value={depsSortKey}
                      onChange={(e) => setDepsSortKey(e.target.value as "delay" | "savings")}
                    >
                      <option value="delay">{t("risk.sortByDelay")}</option>
                      <option value="savings">{t("risk.sortBySavings")}</option>
                    </select>
                  </div>
                  {depAlerts.length === 0 ? (
                    <p className="py-6 text-center text-sm text-tertiary">
                      {t("dashboard.widgets.noDependencyAlerts")}
                    </p>
                  ) : (
                    <>
                      <div className="max-h-[420px] min-h-[420px] overflow-y-auto pr-1">
                        <div className="flex flex-col gap-3">
                          {dependencyPagination.items.map((a, i) => {
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
                                      {t("dashboard.dependency.planningRule", "Règle de planning")}
                                    </div>
                                    <div className="mt-1 text-[11px] font-semibold text-primary">
                                      {a.type === "FS" &&
                                        t(
                                          "dashboard.dependency.rule.fs",
                                          "La cible doit finir avant le début de la source"
                                        )}
                                      {a.type === "SF" &&
                                        t(
                                          "dashboard.dependency.rule.sf",
                                          "La cible doit démarrer avant la fin de la source"
                                        )}
                                      {a.type === "SS" &&
                                        t(
                                          "dashboard.dependency.rule.ss",
                                          "Les deux éléments doivent démarrer ensemble"
                                        )}
                                      {a.type === "FF" &&
                                        t(
                                          "dashboard.dependency.rule.ff",
                                          "Les deux éléments doivent finir ensemble"
                                        )}
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
                      </div>
                      {dependencyPagination.pageCount > 1 && (
                        <DashboardPager
                          page={dependencyPagination.page}
                          pageCount={dependencyPagination.pageCount}
                          onPrevious={() =>
                            setDependencyPage(Math.max(0, dependencyPagination.page - 1))
                          }
                          onNext={() =>
                            setDependencyPage(
                              Math.min(
                                dependencyPagination.pageCount - 1,
                                dependencyPagination.page + 1
                              )
                            )
                          }
                          label={t("alerts.page")}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        );
      }
      case "savings-trajectory":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t("dashboard.widgets.savingsTrajectory")}
              actions={
                <div className="flex items-center gap-2">
                  {/* Granularité Mois / Trimestre */}
                  <GranularityToggle value={trajGranularity} onChange={setTrajGranularity} />
                  {/* Range picker libre */}
                  <div className="flex items-center gap-1 text-[10.5px] text-secondary">
                    <span className="font-semibold">{t("dashboard.widgets.dateFrom")}</span>
                    <input
                      type="date"
                      value={trajRangeStart}
                      onChange={(e) => setTrajRangeStart(e.target.value || effectiveFyStart)}
                      className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] focus:border-bp-coral focus:outline-none"
                    />
                    <span className="font-semibold">{t("dashboard.widgets.dateTo")}</span>
                    <input
                      type="date"
                      value={trajRangeEnd}
                      onChange={(e) => setTrajRangeEnd(e.target.value || effectiveFyEnd)}
                      className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] focus:border-bp-coral focus:outline-none"
                    />
                  </div>
                </div>
              }
            />
            <CardBody>
              <SCurveChart
                data={trajSCurve}
                height={360}
                onPointClick={(month) => openScurveDetail(trajSCurve, trajGranularity, month)}
                labelActual={t("chart.scurve.actual")}
                labelPlanned={t("chart.scurve.planned")}
                labelReforecast={t("chart.scurve.reforecast")}
              />
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
                onPointClick={(month) => openScurveDetail(sCurve, sCurveGranularity, month)}
                labelActual={t("chart.scurve.actual")}
                labelPlanned={t("chart.scurve.planned")}
                labelReforecast={t("chart.scurve.reforecast")}
              />
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
            : // `pivotByDimensions` renvoie `PivotRow[]` pour 1 dimension (a `.value`) mais
              // `Marimekko2DColumn[]` pour 2 (a `.totalSavings`/`.segments`, pas `.value`) — ce
              // widget ("workstream-breakdown", `WorkstreamBarChart`) ne sait afficher qu'UNE
              // barre par ligne, jamais la ventilation par segment (réservée au widget "marimekko",
              // `MarimekkoChart`, cas "marimekko" ci-dessus). Un cast aveugle en `PivotRow[]` sur le
              // cas 2 dimensions lisait `.value` — `undefined` sur ce type — d'où des montants
              // manquants sur certaines barres (celles issues d'une vue personnalisée à 2
              // dimensions) alors que d'autres (vues 1 dimension) s'affichaient normalement. On
              // choisit ici le bon champ selon le nombre de dimensions réel plutôt que de deviner
              // par un cast.
              activeView.dimensions.length === 2
              ? (
                  pivotByDimensions(filteredData, activeView.metric, activeView.dimensions, {
                    programs,
                    hierarchyLevels,
                    hierarchyNodes,
                  }) as engine.Marimekko2DColumn[]
                ).map((col) => ({ label: col.label, realized: col.totalSavings, target: 0 }))
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
              title={t("dashboard.widgets.workstreamBreakdown")}
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
                labelPlanned={t("chart.bar.planned")}
                labelRealized={t("chart.bar.realized")}
                onSegmentClick={(point, segment) => setWorkstreamDetail({ point, segment })}
              />
            </CardBody>
            <Modal
              open={workstreamDetail !== null}
              onOpenChange={(open) => {
                if (!open) setWorkstreamDetail(null);
              }}
              title={workstreamDetail?.point.label ?? ""}
              maxWidth="560px"
            >
              {workstreamDetail && (
                <WorkstreamBarDetail point={workstreamDetail.point} fmt={(v) => `€${v}M`} />
              )}
            </Modal>
          </Card>
        );
      }
      case "savings-waterfall":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("dashboard.widgets.savingsWaterfall", "Cascade des économies")} />
            <CardBody>
              <SavingsWaterfallChart
                waterfall={savingsWaterfallData}
                oneOffGains={oneOffGains}
                levers={filteredData.levers}
                workstreams={filteredData.workstreams}
                geographyLevels={geographyHierarchyLevels}
                geographyNodes={geographyNodes}
                impactNatures={company?.impactNatures}
              />
            </CardBody>
          </Card>
        );
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
            <p className="px-4 pb-2 text-[11px] text-secondary">
              {t(
                "dashboard.workstreamTable.targetNote",
                "Réalisé par rapport à la cible réactualisée (dernière version de la cible)."
              )}
            </p>
            <CardBody flush>
              <div className="overflow-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      {[
                        t("dashboard.workstream", "Chantier"),
                        "Sponsor",
                        t("dashboard.tableHeader.leverCount", "Leviers"),
                        t(
                          "dashboard.tableHeader.realizedReforecastTarget",
                          "Réalisé / Cible réactualisée"
                        ),
                        t("dashboard.tableHeader.capexRealizedPlan", "CAPEX (réalisé / plan)"),
                        t(
                          "dashboard.tableHeader.opexOneOffRealizedPlan",
                          "OPEX one-off (réalisé / plan)"
                        ),
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
                      // `filteredData` (programme(s) sélectionné(s)/vue consolidée + filtres de la
                      // barre en cours) — MÊME source que le widget "Réalisation des économies"
                      // (`wsBars` ci-dessus). Ce widget utilisait auparavant `visibleData` (tous les
                      // programmes de l'entreprise, sans les filtres actifs), d'où l'écart signalé
                      // entre les deux graphiques : les totaux par workstream ne portaient pas sur
                      // le même périmètre de leviers.
                      const ss = engine.workstreamSummary(filteredData, ws.id);
                      // `WorkstreamSummary.opex` (lib/engine.ts) agrège opexOneOff + opexRec — on a
                      // besoin ici du seul OPEX one-off, recalculé sur le même périmètre de leviers
                      // que `ss` (même logique d'agrégation que le CAPEX déjà affiché).
                      // `ss.capex`/`opexOneOff` (ci-dessous) sont des montants PLAN/réactualisé
                      // (valeur courante du champ `Lever.capex`/`opexOneOff`), jamais réalisés — audit
                      // #7 : l'ancien libellé "CAPEX"/"OPEX one-off" sans qualificatif laissait croire
                      // à un réalisé, alors que le KPI héros "CAPEX & coûts one-off" au-dessus AFFICHE
                      // bien un réalisé. On calcule donc ici un "réalisé" par workstream avec la MÊME
                      // formule que `engine.programSummary.engagedCosts` (capex/opex one-off × 100%
                      // si levier livré, sinon × progress%), pour rester cohérent avec ce KPI plutôt
                      // que de se contenter de renommer la colonne.
                      const wsLevers = filteredData.levers.filter(
                        (l) => l.ws === ws.id && l.status !== "cancelled"
                      );
                      const engagedFactor = (l: (typeof wsLevers)[number]) =>
                        l.status === "delivered" ? 1 : l.progress / 100;
                      const opexOneOff = wsLevers.reduce((s, l) => s + l.opexOneOff, 0);
                      const capexRealized = wsLevers.reduce(
                        (s, l) => s + l.capex * engagedFactor(l),
                        0
                      );
                      const opexOneOffRealized = wsLevers.reduce(
                        (s, l) => s + l.opexOneOff * engagedFactor(l),
                        0
                      );
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
                            {engine.fmtCurr(ss.reforecastTarget)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">
                            <strong>{engine.fmtCurr(capexRealized)}</strong> /{" "}
                            {engine.fmtCurr(ss.capex)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">
                            <strong>{engine.fmtCurr(opexOneOffRealized)}</strong> /{" "}
                            {engine.fmtCurr(opexOneOff)}
                          </td>
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
      case "initiative-health": {
        const dimension = (
          instance.view === "country" || instance.view === "function" ? instance.view : "workstream"
        ) as LeverHealthDimension;
        const groups = groupLeversByHealthDimension(
          filteredData.levers,
          dimension,
          scopedAlerts,
          data.workstreams,
          company?.riskThresholds
        );
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader
              title={t("dashboard.widgets.initiativeHealth")}
              actions={
                <DimensionToggle
                  options={[
                    { value: "workstream", label: t("dashboard.workstream") },
                    { value: "country", label: t("dashboard.country") },
                    { value: "function", label: t("dashboard.leverDepartment") },
                  ]}
                  value={dimension}
                  onChange={(next) =>
                    updateLayout(setWidgetView(layout, instance.instanceId, next))
                  }
                />
              }
            />
            <CardBody>
              <InitiativeHealthMatrix
                groups={groups}
                labels={healthLabels}
                onLeverClick={(leverId) => router.push(`/levers/detail?id=${leverId}`)}
              />
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
            {t(
              "dashboard.noProgram",
              "Aucun programme n'a encore été créé pour votre entreprise. Créez-en un dans Admin > Entreprises > Programmes, puis rattachez-y des leviers."
            )}
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
        </div>
        {/* Outils de bureau (personnalisation du layout) — sans objet au doigt sur téléphone :
            masqués sous lg pour laisser toute la place aux indicateurs. */}
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

      {/* Filtres — une rangée de dropdowns compacts (voir `DropdownFilterBar.tsx`), passent
          naturellement à la ligne sur mobile via `flex-wrap` : plus besoin du repli sous bouton
          qu'imposait l'ancienne double rangée de chips `FilterBar`. */}
      <div className="mb-4">
        <DropdownFilterBar
          items={programScopedLevers}
          multiple
          defs={filterDefs}
          active={activeFilters}
          onChange={setFilters}
        />
      </div>

      {/* Grille KPI — desktop : 5 colonnes égales. Mobile/tablette (< 1100px) : hiérarchie
          exécutive — "Économies réalisées" (l'indicateur que DG/CTO regardent en premier) passe
          héros pleine largeur avec chiffre agrandi, les 4 autres en 2×2 compact dessous. */}
      <div className="mb-4 grid grid-cols-5 gap-3.5 max-[1100px]:grid-cols-2 max-[1100px]:gap-3">
        {/* 1. Économies réalisées — cible + reforecast + % (marqueur reforecast sur la barre).
            NOTE (feedback pilote Août 2026) : l'ancien bloc `secondary` "Ambition Programme"
            (Program.target top-down) a été retiré — sa cohabitation avec la cible bottom-up
            (summary.target) dans la même carte produisait deux chiffres perçus comme
            incohérents. L'ambition programme reste consultable dans Admin → Programmes. */}
        <KPICard
          label={t("dashboard.kpi.savingsRealized")}
          value={engine.fmtCurr(summary.realized)}
          icon={Banknote}
          hero
          className="max-[1100px]:col-span-2"
          sub={`${t("dashboard.kpi.target")} ${engine.fmtCurr(summary.target)} · ${t("dashboard.kpi.reforecast")} ${engine.fmtCurr(summary.reforecastTarget)} · ${summary.progressPct}%`}
          barPct={summary.progressPct}
          barMarkerPct={
            summary.reforecastTarget > 0
              ? Math.round((summary.target / summary.reforecastTarget) * 100)
              : undefined
          }
          onClick={() => goToLevers({})}
        />
        {/* 2. CAPEX & coûts one-off — engagé vs réactualisé + % (même convention que la carte 1 :
            le % d'avancement se lit TOUJOURS contre le réactualisé, jamais contre le plan initial —
            le marqueur sur la barre indique où se situe le plan initial). */}
        <KPICard
          label={t("dashboard.kpi.implementationCosts")}
          value={engine.fmtCurr(summary.engagedCosts)}
          icon={TrendingUp}
          accent="brown"
          sub={`${t("dashboard.kpi.plan")} ${engine.fmtCurr(summary.plannedCosts)} · ${t("dashboard.kpi.reforecast")} ${engine.fmtCurr(summary.reforecastCosts)} · ${summary.reforecastCosts > 0 ? Math.round((summary.engagedCosts / summary.reforecastCosts) * 100) : 0}%`}
          barPct={
            summary.reforecastCosts > 0
              ? Math.round((summary.engagedCosts / summary.reforecastCosts) * 100)
              : 0
          }
          barMarkerPct={
            summary.reforecastCosts > 0
              ? Math.round((summary.plannedCosts / summary.reforecastCosts) * 100)
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
          infoTooltip={t(
            "dashboard.kpi.leversAtRiskTooltip",
            "Le total compte chaque levier une seule fois (1 catégorie déclenchée = à risque, 2+ = critique). Les 3 catégories ci-dessous ne sont pas exclusives : un même levier peut être compté dans plusieurs à la fois (ex. en retard ET en surcoût), donc leur somme est normalement supérieure au total affiché."
          )}
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
        {/* 5. ETP impactés — fteImpact comme valeur, suppressions comme barre + %
            Audit #3 : ce chiffre, la barre "postes supprimés" ci-dessous ET le KPI "Impact ETP" du
            Dashboard RH sont 3 mesures ETP légitimement DIFFÉRENTES qui ne se réconcilient jamais
            numériquement (planification leviers / suivi RH réel / départs forcés uniquement) —
            l'icône ⓘ rend cette distinction explicite plutôt que de laisser croire à une erreur. */}
        <KPICard
          label={t("dashboard.kpi.fteImpacted")}
          value={String(summary.fteImpact)}
          icon={Users}
          barPct={
            summary.suppressionsPlanned > 0
              ? Math.round((summary.suppressionsRealized / summary.suppressionsPlanned) * 100)
              : 0
          }
          infoTooltip={t(
            "dashboard.kpi.fteImpactedTooltip",
            'Somme des ETP estimés au niveau des leviers (planification), à ne pas confondre avec le suivi RH réel (voir Dashboard RH). "X / Y postes supprimés" ne compte que les départs forcés réalisés/planifiés suivis dans le module RH — un SOUS-ENSEMBLE de cet impact ETP global, pas une décomposition complète.'
          )}
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

      <Modal
        open={scurveDetail !== null}
        onOpenChange={(open) => {
          if (!open) setScurveDetail(null);
        }}
        title={t("chart.scurveDetail.title", "Trajectoire des économies — détail")}
        maxWidth="880px"
      >
        {scurveDetail && (
          <SCurveDetail
            gap={{
              month: scurveDetail.month,
              entries: scurveGapEntries,
              workstreams: filteredData.workstreams,
              geographyLevels: geographyHierarchyLevels,
              geographyNodes,
            }}
          />
        )}
      </Modal>

      {/* Étape 1 du builder générique (widgets déjà présents) : nouveau bloc séparé, ou vue
          supplémentaire ajoutée au sélecteur d'un bloc existant (l'utilisateur choisit LEQUEL
          s'il y en a plusieurs) — voir requestAddWidget/openBuilderConfig. */}
      <Modal
        open={builderChoiceType !== null}
        onOpenChange={(open) => !open && setBuilderChoiceType(null)}
        title={t(
          "dashboard.builderModal.alreadyOnDashboard",
          "Ce graphique est déjà sur votre dashboard"
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
                          describeCustomView(active, hierarchyLevels)
                        )}
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
                  ? t("dashboard.builderModal.primaryDimension", "Dimension primaire")
                  : t("dashboard.builderModal.secondaryDimension", "Dimension secondaire")
                : t("dashboard.builderModal.dimension", "Dimension")}
              <select
                value={builderDims[i] ?? ""}
                onChange={(e) => {
                  const next = [...builderDims];
                  next[i] = e.target.value;
                  setBuilderDims(next);
                }}
                className="rounded-md border border-border-strong px-2.5 py-2 text-[13px] font-normal text-primary"
              >
                <option value="">
                  {t("dashboard.builderModal.choosePlaceholder", "— Choisir —")}
                </option>
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
                ? t(
                    "dashboard.builderModal.chooseMetricHint",
                    "Choisissez un indicateur pour continuer."
                  )
                : selectedDims.length < requiredDimCount
                  ? t(
                      "dashboard.builderModal.chooseMoreDims",
                      "Choisissez encore {n} dimension(s)."
                    ).replace("{n}", String(requiredDimCount - selectedDims.length))
                  : t(
                      "dashboard.builderModal.dimsMustDiffer",
                      "Les dimensions choisies doivent être différentes."
                    )}
            </p>
          )}
        </div>
      </Modal>

      {/* Grille unique — tous les widgets sur la même page, sans onglets ni sections.
          "Alertes & Dépendances" (risk-center) est toujours rendu en dernier, quelle que soit sa
          position dans `layout` (ordre par défaut ou personnalisé par glisser-déposer) — tri
          d'affichage uniquement, l'état `layout`/les indices de drag-and-drop ne sont pas modifiés. */}
      <div
        data-dashboard-widget-grid
        className="grid grid-cols-1 grid-flow-row-dense gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {[...layout]
          .sort((a, b) => (a.type === "risk-center" ? 1 : b.type === "risk-center" ? -1 : 0))
          .map((instance) => renderWidget(instance))}
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

function DashboardPager({
  page,
  pageCount,
  onPrevious,
  onNext,
  label,
}: {
  page: number;
  pageCount: number;
  onPrevious: () => void;
  onNext: () => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex items-center justify-center gap-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={onPrevious}
        disabled={page === 0}
        className="flex h-6 w-6 items-center justify-center rounded-sm text-secondary transition hover:bg-neutral-100 disabled:opacity-30"
        aria-label={t("dashboard.pager.previous", "Page précédente")}
      >
        <ChevronLeft size={14} />
      </button>
      <span className="text-[11px] font-semibold text-secondary">
        {label.replace("{current}", String(page + 1)).replace("{total}", String(pageCount))}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={page >= pageCount - 1}
        className="flex h-6 w-6 items-center justify-center rounded-sm text-secondary transition hover:bg-neutral-100 disabled:opacity-30"
        aria-label={t("dashboard.pager.next", "Page suivante")}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
