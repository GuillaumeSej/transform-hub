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
import { resolveHierarchyPath } from "@/lib/hierarchyLogic";
import { isLeverVisibleForClearance, resolveConfidentialityClearance } from "@/lib/leversLogic";
import { subscribeCompanies, subscribeHierarchyNodes } from "@/lib/firestore/admin";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { ExportButton } from "@/components/shared/ExportButton";
import { ExcelUploadButton } from "@/components/shared/ExcelUploadButton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StageBadge } from "@/components/shared/StageBadge";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { Avatar } from "@/components/shared/Avatar";
import { Kanban } from "@/components/shared/Kanban";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import { FilterBar, type ActiveFilters, type FilterDef } from "@/components/shared/FilterBar";
import { Modal } from "@/components/shared/Modal";
import { LeverForm, type LeverFormValues } from "@/components/shared/LeverForm";
import type { HierarchyLevelDef, HierarchyNode, Lever, PriorityLevel, RiskLevel } from "@/types";

type LeverRow = Lever & {
  realized: number;
  wsName: string;
  statusLabel: string;
  costCenterLabel: string;
  hasAlert: boolean;
};

export default function LeversPage() {
  const { role, user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);
  const lifecycle = useLifecycleLabels(user?.companyId);
  const { t } = useTranslation();
  const router = useRouter();
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const [view, setView] = useState<"table" | "kanban">(
    (searchParams.get("view") as "table" | "kanban") ?? "table"
  );
  const [newLeverOpen, setNewLeverOpen] = useState(false);

  // Arborescence financière (optionnelle) de l'entreprise courante — n'affiche des colonnes
  // supplémentaires que si l'entreprise a explicitement configuré des hierarchyLevels ; sinon la
  // colonne historique "Centre de coût / Poste de dépense" reste seule affichée (non-régressif).
  const [hierarchyLevels, setHierarchyLevels] = useState<HierarchyLevelDef[]>([]);
  const [hierarchyNodes, setHierarchyNodes] = useState<HierarchyNode[]>([]);
  const [clearance, setClearance] = useState<"all" | string[]>([]);

  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      const company = companies.find((c) => c.id === user?.companyId);
      setHierarchyLevels(company?.hierarchyLevels ?? []);
      setClearance(resolveConfidentialityClearance(user, company?.roleClearance));
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId, user?.role, user?.confidentialityClearance]);

  useEffect(() => {
    if (!user?.companyId || hierarchyLevels.length === 0) {
      setHierarchyNodes([]);
      return;
    }
    const unsub = subscribeHierarchyNodes(user.companyId, setHierarchyNodes);
    return unsub;
  }, [user?.companyId, hierarchyLevels.length]);

  const sortedHierarchyLevels = useMemo(
    () => [...hierarchyLevels].sort((a, b) => a.order - b.order),
    [hierarchyLevels]
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

  // Leviers/sous-leviers avec au moins une contrainte de dépendance violée (colonne ⚠ + filtre)
  const alertedLeverIds = useMemo(() => {
    const ids = new Set<string>();
    for (const alert of engine.dependencyAlerts(data)) {
      for (const entityId of [alert.sourceId, alert.targetId]) {
        if (entityId.startsWith("SL")) {
          const parent = data.subLevers.find((s) => s.id === entityId);
          if (parent) ids.add(parent.leverId);
        } else {
          ids.add(entityId);
        }
      }
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.levers, data.subLevers]);

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
      { key: "f_status", label: "Niveau", getValue: (l) => lifecycle.label(l.status) },
      { key: "f_owner", label: "Owner", getValue: (l) => l.owner },
      { key: "f_sponsor", label: "Sponsor", getValue: (l) => l.sponsor },
      { key: "f_geography", label: "Géographie", getValue: (l) => l.geography },
      { key: "f_country", label: "Pays", getValue: (l) => l.country },
      { key: "f_entity", label: "Entité", getValue: (l) => l.entity },
      { key: "f_function", label: "Fonction", getValue: (l) => l.function },
      {
        key: "f_costCenter",
        label: "Centre de coût / Poste de dépense",
        getValue: (l) => {
          const subs = data.subLevers.filter((s) => s.leverId === l.id);
          return subs.length ? subs.map((s) => s.expensePost).join(", ") : l.costCenter;
        },
      },
      { key: "f_priority", label: "Priorité", getValue: (l) => l.priority },
      { key: "f_risk", label: "Risque", getValue: (l) => l.risk },
      {
        key: "f_pnl",
        label: "Compte P&L",
        getValue: (l) => data.pnlAccounts.find((p) => p.id === l.pnlMap)?.name ?? l.pnlMap,
      },
      {
        key: "f_subLevers",
        label: "Sous-leviers",
        getValue: (l) =>
          data.subLevers.some((s) => s.leverId === l.id) ? "Avec sous-leviers" : "Sans sous-levier",
      },
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
    [data.workstreams, data.subLevers, data.pnlAccounts, alertedLeverIds, lifecycle]
  );

  const activeFilters: ActiveFilters = useMemo(() => {
    const result: ActiveFilters = {};
    searchParams.forEach((value, key) => {
      if (key.startsWith("f_")) result[key] = value.split(",").filter(Boolean);
    });
    return result;
  }, [searchParams]);

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

  const rows: LeverRow[] = filteredLevers.map((l) => ({
    ...l,
    realized: engine.realizedSavings(l, data),
    wsName: data.workstreams.find((w) => w.id === l.ws)?.name.split(" ")[0] ?? l.ws,
    statusLabel: lifecycle.label(l.status),
    costCenterLabel: (() => {
      const subs = data.subLevers.filter((s) => s.leverId === l.id);
      return subs.length ? subs.map((s) => s.expensePost).join(", ") : l.costCenter;
    })(),
    hasAlert: alertedLeverIds.has(l.id),
  }));

  /** Une colonne par niveau configuré (ordre macro -> fin), affichant le libellé résolu pour ce
   *  levier via hierarchyLeafId. N'existe que si l'entreprise a activé l'arborescence. */
  const hierarchyColumns: ColumnDef<LeverRow>[] = hasHierarchy
    ? sortedHierarchyLevels.map((level) => ({
        key: `hierarchy_${level.key}` as keyof LeverRow,
        label: level.label,
        render: (r: LeverRow) => {
          const path = resolveHierarchyPath(
            r.hierarchyLeafId ?? "",
            hierarchyNodes,
            sortedHierarchyLevels
          );
          const entry = path.find((p) => p.levelKey === level.key);
          return <span>{entry?.label ?? "—"}</span>;
        },
      }))
    : [];

  const totalNet = filteredLevers.reduce((s, l) => s + l.netSavings, 0);
  const totalReal = filteredLevers.reduce((s, l) => s + engine.realizedSavings(l, data), 0);

  /** Édition inline (double-clic) : les colonnes marquées editable écrivent directement sur le
   * levier. Les selects (statut/priorité/risque) passent par un mapping label → valeur interne. */
  const handleCellUpdate = (rowId: string, field: keyof LeverRow, value: string | number) => {
    const patch: Partial<Lever> = {};
    if (field === "statusLabel") {
      const status = data.leverStatuses.find((s) => lifecycle.label(s) === value);
      if (status) patch.status = status;
    } else if (field === "priority") {
      patch.priority = value as PriorityLevel;
    } else if (field === "risk") {
      patch.risk = value as RiskLevel;
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
    {
      key: "code",
      label: "Code",
      width: "90px",
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
      render: (r) => <strong>{r.name}</strong>,
    },
    { key: "type", label: "Type" },
    { key: "wsName", label: t("leverForm.workstream") },
    {
      key: "owner",
      label: t("leverForm.owner"),
      editable: true,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Avatar initials={r.ownerInit} size="sm" /> {r.owner}
        </span>
      ),
    },
    { key: "sponsor", label: t("leverForm.sponsor"), editable: true },
    { key: "geography", label: "Géo", editable: true },
    { key: "country", label: t("leverForm.country"), editable: true },
    ...(hasHierarchy
      ? hierarchyColumns
      : [
          {
            key: "costCenterLabel",
            label: t("leverForm.costCenter"),
          } as ColumnDef<LeverRow>,
        ]),
    { key: "start", label: "Début", editable: true },
    { key: "end", label: "Fin", editable: true },
    {
      key: "netSavings",
      label: "Net €M",
      align: "right",
      editable: true,
      type: "number",
      render: (r) => r.netSavings.toFixed(1),
    },
    { key: "realized", label: "Réalisé", align: "right", render: (r) => r.realized.toFixed(1) },
    { key: "progress", label: "Progress", render: (r) => <ProgressBar pct={r.progress} /> },
    {
      key: "fteImpact",
      label: "ETP",
      align: "right",
      editable: true,
      type: "number",
    },
    {
      key: "priority",
      label: "Priorité",
      editable: true,
      type: "select",
      options: data.priorityLevels,
      render: (r) => <StatusBadge risk={r.priority} />,
    },
    {
      key: "risk",
      label: "Risque",
      editable: true,
      type: "select",
      options: data.riskLevels,
      render: (r) => <StatusBadge risk={r.risk} />,
    },
    {
      key: "statusLabel",
      label: t("levers.columnStatus"),
      editable: true,
      type: "select",
      options: data.leverStatuses.map((s) => lifecycle.label(s)),
      render: (r) => <StageBadge status={r.status} label={lifecycle.label(r.status)} />,
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
          <ExportButton type="excel" data={data} />
          <ExcelUploadButton data={data} companyId={user?.companyId ?? null} />
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
