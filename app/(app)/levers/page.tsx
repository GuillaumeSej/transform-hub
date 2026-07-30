"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Plus, Table2, TriangleAlert } from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import { useLifecycleLabels } from "@/lib/hooks/useLifecycleLabels";
import { useTranslation } from "@/lib/i18n/useTranslation";
import * as engine from "@/lib/engine";
import { generateAlerts } from "@/lib/alertEngine";
import { resolveHierarchyPath } from "@/lib/hierarchyLogic";
import { isLeverVisibleForClearance, resolveConfidentialityClearance } from "@/lib/leversLogic";
import {
  subscribeCompanies,
  subscribeHierarchyNodes,
  subscribePrograms,
} from "@/lib/firestore/admin";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { ExportButton } from "@/components/shared/ExportButton";
import { LeverImportButton } from "@/components/shared/LeverImportButton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Tooltip } from "@/components/shared/Tooltip";
import { StageBadge } from "@/components/shared/StageBadge";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { Avatar } from "@/components/shared/Avatar";
import { Kanban } from "@/components/shared/Kanban";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import { FilterBar, type ActiveFilters, type FilterDef } from "@/components/shared/FilterBar";
import { Modal } from "@/components/shared/Modal";
import { LeverForm, type LeverFormValues } from "@/components/shared/LeverForm";
import type { HierarchyLevelDef, HierarchyNode, Lever, Program, RiskLevel } from "@/types";

type LeverRow = Lever & {
  realized: number;
  wsName: string;
  statusLabel: string;
  costCenterLabel: string;
  hasAlert: boolean;
  roi: number | null;
};

export default function LeversPage() {
  const { role, user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);
  const lifecycle = useLifecycleLabels(user?.companyId);
  const { t } = useTranslation();
  const router = useRouter();
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const [view, setView] = useState<"table" | "kanban">(
    requestedView === "kanban" ? "kanban" : "table"
  );
  useEffect(() => setView(requestedView === "kanban" ? "kanban" : "table"), [requestedView]);
  const [newLeverOpen, setNewLeverOpen] = useState(false);

  // Arborescence financière (optionnelle) de l'entreprise courante — n'affiche des colonnes
  // supplémentaires que si l'entreprise a explicitement configuré des hierarchyLevels ; sinon la
  // colonne historique "Centre de coût / Poste de dépense" reste seule affichée (non-régressif).
  const [hierarchyLevels, setHierarchyLevels] = useState<HierarchyLevelDef[]>([]);
  const [hierarchyNodes, setHierarchyNodes] = useState<HierarchyNode[]>([]);
  // Arborescence géographique (optionnelle, domaine séparé) — même pattern que la financière,
  // mais utilisée pour générer N filtres dynamiques (un par niveau configuré) plutôt que des
  // colonnes : voir geographyFilterDefs plus bas.
  const [geographyHierarchyLevels, setGeographyHierarchyLevels] = useState<HierarchyLevelDef[]>([]);
  const [geographyNodes, setGeographyNodes] = useState<HierarchyNode[]>([]);
  const [clearance, setClearance] = useState<"all" | string[]>([]);
  const [riskThresholds, setRiskThresholds] = useState<
    { level: RiskLevel; minAmount: number }[] | undefined
  >(undefined);

  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      const company = companies.find((c) => c.id === user?.companyId);
      setHierarchyLevels(company?.hierarchyLevels ?? []);
      setGeographyHierarchyLevels(company?.geographyHierarchyLevels ?? []);
      setClearance(resolveConfidentialityClearance(user, company?.roleClearance));
      setRiskThresholds(company?.riskThresholds);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId, user?.role, user?.confidentialityClearance]);

  // Programmes de l'entreprise — pour résoudre la colonne optionnelle "Programme" de l'import
  // Excel des leviers (voir lib/leverExcelImport.ts) ; même pattern que le dashboard exécutif.
  const [programs, setPrograms] = useState<Program[]>([]);
  useEffect(() => {
    const unsub = subscribePrograms((all) =>
      setPrograms(user?.companyId ? all.filter((p) => p.companyId === user.companyId) : all)
    );
    return unsub;
  }, [user?.companyId]);

  // Alertes auto (dépendances, jalons, etc.) + manuelles — même source que useNotifications —
  // servent à recalculer le risque de chaque levier à la volée (voir engine.computeLeverRisk).
  const alerts = useMemo(() => generateAlerts(data), [data]);

  useEffect(() => {
    if (!user?.companyId || hierarchyLevels.length === 0) {
      setHierarchyNodes([]);
      return;
    }
    const unsub = subscribeHierarchyNodes(user.companyId, setHierarchyNodes, "financial");
    return unsub;
  }, [user?.companyId, hierarchyLevels.length]);

  useEffect(() => {
    if (!user?.companyId || geographyHierarchyLevels.length === 0) {
      setGeographyNodes([]);
      return;
    }
    const unsub = subscribeHierarchyNodes(user.companyId, setGeographyNodes, "geographic");
    return unsub;
  }, [user?.companyId, geographyHierarchyLevels.length]);

  const sortedHierarchyLevels = useMemo(
    () => [...hierarchyLevels].sort((a, b) => a.order - b.order),
    [hierarchyLevels]
  );
  const sortedGeographyHierarchyLevels = useMemo(
    () => [...geographyHierarchyLevels].sort((a, b) => a.order - b.order),
    [geographyHierarchyLevels]
  );

  // Le Lever Owner ne voit que ses propres leviers (owner === son nom de compte de test). Les
  // autres rôles (CTO, Sponsor, ...) voient toute la bibliothèque. Les leviers confidentiels sont
  // en plus masqués aux profils non habilités (voir Company.roleClearance) — admin/admin_entreprise
  // voient toujours tout.
  const scopedLevers = useMemo(() => {
    const ownerScoped =
      role === "lever" && user ? data.levers.filter((l) => l.owner === user.name) : data.levers;
    return ownerScoped.filter(
      (l) =>
        role === "admin" ||
        role === "admin_entreprise" ||
        isLeverVisibleForClearance(l.confidentialityLevel, clearance)
    );
  }, [data.levers, role, user, clearance]);

  // Leviers avec au moins une contrainte de dépendance violée (colonne ⚠ + filtre)
  const alertedLeverIds = useMemo(() => {
    const ids = new Set<string>();
    for (const alert of engine.dependencyAlerts(data)) {
      for (const entityId of [alert.sourceId, alert.targetId]) ids.add(entityId);
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.levers]);

  // Un filtre par niveau d'arborescence configuré (financier ET géographique) — remplace les
  // filtres figés (Région/Pays/Entité, Compte P&L) dès qu'une arborescence est active pour
  // l'entreprise, pour qu'un N-ième niveau configuré produise bien un N-ième filtre distinct
  // (voir aussi hierarchyColumns pour le même principe appliqué aux colonnes du tableau).
  // Un levier importé via Excel n'a souvent qu'un `pnlMap` (ancien matching par code), pas encore
  // de `hierarchyLeafId` — même repli que engine.pnlImpactDetailed : on retombe sur le nœud macro
  // dont le code correspond à `lever.pnlMap`, pour ne pas afficher "—" sur des leviers valides.
  const resolveMacroLabel = (l: Lever): string => {
    const macroLevel = sortedHierarchyLevels[0];
    if (!macroLevel) return "";
    const path = resolveHierarchyPath(
      l.hierarchyLeafId ?? "",
      hierarchyNodes,
      sortedHierarchyLevels
    );
    const viaLeaf = path.find((p) => p.levelKey === macroLevel.key)?.label;
    if (viaLeaf) return viaLeaf;
    const viaPnlMap = hierarchyNodes.find(
      (n) => n.levelKey === macroLevel.key && n.code === l.pnlMap
    )?.label;
    return viaPnlMap ?? "";
  };

  const hierarchyFilterDefs: FilterDef<Lever>[] = useMemo(
    () =>
      sortedHierarchyLevels.map((level, index) => ({
        key: `f_hierarchy_${level.key}`,
        label: level.label,
        getValue: (l: Lever) => {
          if (index === 0) return resolveMacroLabel(l);
          const path = resolveHierarchyPath(
            l.hierarchyLeafId ?? "",
            hierarchyNodes,
            sortedHierarchyLevels
          );
          return path.find((p) => p.levelKey === level.key)?.label ?? "";
        },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortedHierarchyLevels, hierarchyNodes]
  );
  const geographyFilterDefs: FilterDef<Lever>[] = useMemo(
    () =>
      sortedGeographyHierarchyLevels.map((level) => ({
        key: `f_geo_${level.key}`,
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

  // Toutes les propriétés catégorielles du levier sont filtrables — les valeurs proposées sont
  // celles réellement présentes dans les données. L'état vit dans l'URL (préfixe f_) pour rester
  // partageable/actualisable, comme les anciens filtres ws/status/risk.
  const filterDefs: FilterDef<Lever>[] = useMemo(
    () => [
      { key: "f_type", label: "Type", getValue: (l) => l.type },
      {
        key: "f_ws",
        label: "Workstream",
        getValue: (l) => data.workstreams.find((w) => w.id === l.ws)?.name ?? l.ws,
      },
      { key: "f_status", label: "Maturité", getValue: (l) => lifecycle.label(l.status) },
      { key: "f_owner", label: "Owner", getValue: (l) => l.owner },
      { key: "f_sponsor", label: "Sponsor", getValue: (l) => l.sponsor },
      ...(geographyFilterDefs.length > 0
        ? geographyFilterDefs
        : [
            { key: "f_geography", label: "Région", getValue: (l: Lever) => l.geography },
            { key: "f_country", label: "Pays", getValue: (l: Lever) => l.country },
            { key: "f_entity", label: "Entité", getValue: (l: Lever) => l.entity },
          ]),
      { key: "f_function", label: "Fonction", getValue: (l) => l.function },
      {
        key: "f_costCenter",
        label: "Centre de coût / Poste de dépense",
        getValue: (l) => {
          const actionCenters = (l.actions ?? [])
            .flatMap((action) => action.impacts ?? [])
            .map((impact) => impact.costCenter)
            .filter((value): value is string => !!value);
          return actionCenters.length
            ? Array.from(new Set(actionCenters)).join(", ")
            : l.costCenter;
        },
      },
      {
        key: "f_risk",
        label: "Risque",
        // Recalculé depuis les alertes (voir engine.computeLeverRisk), pas la valeur stockée —
        // les options proposées doivent refléter le risque réellement affiché.
        getValue: (l) => engine.computeLeverRisk(l.id, alerts, riskThresholds),
      },
      ...(hierarchyFilterDefs.length > 0
        ? hierarchyFilterDefs
        : [
            {
              key: "f_pnl",
              label: "Compte P&L",
              getValue: (l: Lever) =>
                data.pnlAccounts.find((p) => p.id === l.pnlMap)?.name ?? l.pnlMap,
            },
          ]),
      {
        key: "f_alerts",
        label: "Alerte dépendance",
        getValue: (l) => (alertedLeverIds.has(l.id) ? "En alerte" : "Sans alerte"),
      },
      {
        key: "f_endMonth",
        label: "Mois de fin",
        getValue: (l) => engine.leverEndMonthLabel(l),
      },
      {
        key: "f_endQuarter",
        label: "Trimestre de fin",
        getValue: (l) => engine.leverEndQuarterLabel(l),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      data.workstreams,
      data.pnlAccounts,
      alertedLeverIds,
      lifecycle,
      alerts,
      riskThresholds,
      hierarchyFilterDefs,
      geographyFilterDefs,
    ]
  );

  const activeFilters: ActiveFilters = useMemo(() => {
    const result: ActiveFilters = {};
    searchParams.forEach((value, key) => {
      if (filterDefs.some((def) => def.key === key)) result[key] = value.split(",").filter(Boolean);
    });
    return result;
  }, [searchParams, filterDefs]);

  const setFilters = (next: ActiveFilters) => {
    const params = new URLSearchParams(searchParams.toString());
    Array.from(params.keys())
      .filter((k) => k.startsWith("f_"))
      .forEach((k) => params.delete(k));
    Object.entries(next).forEach(([k, v]) => {
      if (v.length > 0) params.set(k, v.join(","));
    });
    router.replace(`/levers?${params.toString()}`);
  };

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/levers?${next.toString()}`);
  };

  const filteredLevers = useMemo(() => {
    return scopedLevers.filter((lever) =>
      Object.entries(activeFilters).every(([key, values]) => {
        const def = filterDefs.find((d) => d.key === key);
        return !def || values.length === 0 || values.includes(def.getValue(lever));
      })
    );
  }, [scopedLevers, activeFilters, filterDefs]);

  const hasHierarchy = sortedHierarchyLevels.length > 0;

  const rows: LeverRow[] = filteredLevers.map((l) => {
    const costs = l.capex + l.opexOneOff;
    return {
      ...l,
      risk: engine.computeLeverRisk(l.id, alerts, riskThresholds),
      realized: engine.realizedSavings(l),
      wsName: data.workstreams.find((w) => w.id === l.ws)?.name ?? l.ws,
      statusLabel: lifecycle.label(l.status),
      costCenterLabel: (() => {
        const centers = (l.actions ?? [])
          .flatMap((action) => action.impacts ?? [])
          .map((impact) => impact.costCenter)
          .filter((value): value is string => !!value);
        return centers.length ? Array.from(new Set(centers)).join(", ") : l.costCenter;
      })(),
      hasAlert: alertedLeverIds.has(l.id),
      roi: costs > 0 ? Math.round((l.netSavings / costs) * 10) / 10 : null,
    };
  });

  /** Une seule colonne, sur le niveau le plus macro (généralement P&L) — pas besoin des niveaux
   *  plus fins dans la vue tableau. Le détail complet (tous les niveaux) reste consultable au
   *  survol (tooltip) et dans le Focus Levier. N'existe que si l'entreprise a activé
   *  l'arborescence. */
  const macroHierarchyLevel = sortedHierarchyLevels[0];
  const hierarchyColumns: ColumnDef<LeverRow>[] =
    hasHierarchy && macroHierarchyLevel
      ? [
          {
            key: `hierarchy_${macroHierarchyLevel.key}` as keyof LeverRow,
            label: macroHierarchyLevel.label,
            width: "160px",
            render: (r: LeverRow) => {
              const path = resolveHierarchyPath(
                r.hierarchyLeafId ?? "",
                hierarchyNodes,
                sortedHierarchyLevels
              );
              const macroLabel = resolveMacroLabel(r);
              const fullDetail = path.map((p) => p.label).join(" › ");
              return (
                <Tooltip text={fullDetail || macroLabel || "Non renseigné"}>
                  <span>{macroLabel || "—"}</span>
                </Tooltip>
              );
            },
          },
        ]
      : [];

  const totalNet = filteredLevers.reduce((s, l) => s + l.netSavings, 0);
  const totalReal = filteredLevers.reduce((s, l) => s + engine.realizedSavings(l), 0);

  /** Édition inline (double-clic) : les colonnes marquées editable écrivent directement sur le
   * levier. Les selects (statut/priorité/risque) passent par un mapping label → valeur interne. */
  const handleCellUpdate = (rowId: string, field: keyof LeverRow, value: string | number) => {
    const patch: Partial<Lever> = {};
    if (field === "statusLabel") {
      const status = data.leverStatuses.find((s) => lifecycle.label(s) === value);
      if (status) patch.status = status;
    } else if (field === "netSavings" || field === "fteImpact") {
      patch[field] = Number(value);
    } else if (
      field === "name" ||
      field === "owner" ||
      field === "sponsor" ||
      field === "geography" ||
      field === "country" ||
      field === "function" ||
      field === "costCenter" ||
      field === "start" ||
      field === "end"
    ) {
      patch[field] = String(value);
    } else {
      return;
    }
    data.updateLever(rowId, patch);
    showToast(t("leverForm.updated"), "", "success");
  };

  const columns: ColumnDef<LeverRow>[] = [
    // ── Identification ──
    {
      key: "code",
      label: "Code",
      width: "90px",
      mobile: "primary",
      render: (r) => (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-secondary">
          {r.hasAlert && (
            <TriangleAlert size={12} className="text-rag-red" aria-label="Alerte dépendance" />
          )}
          {r.code}
        </span>
      ),
    },
    {
      key: "name",
      label: t("levers.columnName"),
      editable: true,
      mobile: "primary",
      width: "220px",
      render: (r) => <strong>{r.name}</strong>,
    },
    { key: "type", label: "Type", mobile: "hide", width: "100px" },
    { key: "wsName", label: t("leverForm.workstream"), mobile: "hide", width: "150px" },
    // ── Responsabilité ──
    {
      key: "owner",
      label: t("leverForm.owner"),
      editable: true,
      mobile: "primary",
      width: "150px",
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Avatar initials={r.ownerInit} size="sm" /> {r.owner}
        </span>
      ),
    },
    {
      key: "sponsor",
      label: t("leverForm.sponsor"),
      editable: true,
      mobile: "hide",
      width: "150px",
    },
    // ── Localisation ──
    { key: "function", label: t("leverForm.function"), mobile: "hide", width: "130px" },
    {
      key: "geography",
      label: t("leverForm.geography"),
      editable: true,
      mobile: "hide",
      width: "110px",
    },
    {
      key: "country",
      label: t("leverForm.country"),
      editable: true,
      mobile: "hide",
      width: "110px",
    },
    { key: "entity", label: t("leverForm.entity"), editable: true, mobile: "hide", width: "150px" },
    ...(hasHierarchy ? hierarchyColumns.map((c) => ({ ...c, mobile: "hide" as const })) : []),
    // ── Financier ──
    {
      key: "netSavings",
      label: "Net Savings €M",
      align: "right",
      editable: true,
      type: "number",
      mobile: "secondary",
      width: "110px",
      render: (r) => r.netSavings.toFixed(1),
    },
    {
      key: "realized",
      label: "Réalisé",
      align: "right",
      // Visible dans la vue carte mobile : avec Net Savings, c'est LA paire que DG/CTO
      // regardent (réalisé vs engagé) — le reste du détail financier reste desktop.
      mobile: "secondary",
      width: "90px",
      render: (r) => r.realized.toFixed(1),
    },
    {
      key: "progress",
      label: "Progress",
      mobile: "secondary",
      width: "120px",
      render: (r) => <ProgressBar pct={r.progress} />,
    },
    {
      key: "fteImpact",
      label: "ETP",
      align: "right",
      editable: true,
      type: "number",
      mobile: "hide",
      width: "80px",
    },
    {
      key: "capex",
      label: "CAPEX",
      align: "right",
      editable: true,
      type: "number",
      mobile: "hide",
      width: "90px",
      render: (r) => r.capex.toFixed(1),
    },
    {
      key: "opexOneOff",
      label: "One-Off",
      align: "right",
      editable: true,
      type: "number",
      mobile: "hide",
      width: "90px",
      render: (r) => r.opexOneOff.toFixed(1),
    },
    {
      key: "roi",
      label: "ROI",
      align: "right",
      mobile: "hide",
      width: "80px",
      render: (r) => (r.roi != null ? `${r.roi}x` : "—"),
    },
    // ── Statut ──
    {
      key: "statusLabel",
      label: t("levers.columnMaturity"),
      editable: true,
      type: "select",
      options: data.leverStatuses.map((s) => lifecycle.label(s)),
      mobile: "secondary",
      width: "130px",
      render: (r) => <StageBadge status={r.status} label={lifecycle.label(r.status)} />,
    },
    {
      // Risque calculé automatiquement depuis les alertes (voir engine.computeLeverRisk) —
      // affichage lecture seule, plus d'édition manuelle possible.
      key: "risk",
      label: "Risque",
      mobile: "secondary",
      width: "110px",
      render: (r) => <StatusBadge risk={r.risk} />,
    },
  ];

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {role === "lever" ? t("levers.title.mine") : t("levers.title.library")}
          </h1>
          <div className="mt-2.5 text-[13px] text-secondary">
            {filteredLevers.length} {t("levers.count")} · {t("levers.netSavingsShown")} :{" "}
            <strong>{engine.fmtCurr(totalNet)}</strong> · {t("levers.realized")} :{" "}
            <strong>{engine.fmtCurr(totalReal)}</strong>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Export/import Excel : outils de bureau, sans objet sur téléphone. */}
          <span className="hidden items-center gap-2 sm:inline-flex">
            <ExportButton data={data} />
            <LeverImportButton
              data={data}
              companyId={user?.companyId}
              programs={programs}
              onImport={(rows) => data.importLevers(rows)}
              onCreateWorkstreams={(workstreams) => data.addWorkstreams(workstreams)}
            />
          </span>
          <Button variant="primary" onClick={() => setNewLeverOpen(true)}>
            <Plus size={13} /> {t("levers.newLever")}
          </Button>
        </div>
      </div>

      <Modal
        open={newLeverOpen}
        onOpenChange={setNewLeverOpen}
        title={t("levers.newLeverModalTitle")}
        maxWidth="760px"
      >
        <LeverForm
          data={data}
          lifecycle={lifecycle}
          companyId={user?.companyId}
          submitLabel={t("levers.createLever")}
          onCancel={() => setNewLeverOpen(false)}
          onSubmit={(values: LeverFormValues) => {
            const created = data.createLever({ ...values, dependencies: [] });
            setNewLeverOpen(false);
            showToast(t("leverForm.created"), created.name, "success");
            router.push(`/levers/detail?id=${created.id}`);
          }}
        />
      </Modal>

      <Card>
        <CardBody flush>
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <FilterBar
              items={scopedLevers}
              defs={filterDefs}
              active={activeFilters}
              onChange={setFilters}
            />

            <div className="ml-auto flex overflow-hidden rounded-md border border-border">
              <button
                onClick={() => {
                  setView("table");
                  setParam("view", "table");
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${view === "table" ? "bg-black text-white" : "bg-white text-secondary"}`}
              >
                <Table2 size={13} /> {t("levers.table")}
              </button>
              <button
                onClick={() => {
                  setView("kanban");
                  setParam("view", "kanban");
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${view === "kanban" ? "bg-black text-white" : "bg-white text-secondary"}`}
              >
                <LayoutGrid size={13} /> {t("levers.kanban")}
              </button>
            </div>
          </div>
        </CardBody>
      </Card>

      {view === "table" ? (
        <EditableTable
          data={rows}
          columns={columns}
          onCellUpdate={handleCellUpdate}
          onRowClick={(row) => router.push(`/levers/detail?id=${row.id}`)}
          searchPlaceholder={t("levers.searchPlaceholder")}
          defaultSort={{ key: "risk", direction: "desc" }}
        />
      ) : (
        <Kanban
          levers={filteredLevers}
          onCardClick={(id) => router.push(`/levers/detail?id=${id}`)}
          stageOrder={lifecycle.activeCycle}
          stageLabel={lifecycle.shortLabel}
        />
      )}
    </div>
  );
}
