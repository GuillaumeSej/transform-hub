"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Plus, TriangleAlert, Users } from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import * as hr from "@/lib/hrEngine";
import { classifyMovementExecution, EXECUTION_LABELS } from "@/lib/hrExecution";
import { fmtCurr } from "@/lib/engine";
import { Button } from "@/components/shared/Button";
import { KPICard } from "@/components/shared/KPICard";
import { Modal } from "@/components/shared/Modal";
import { MovementForm, type MovementFormValues } from "@/components/shared/MovementForm";
import { HrExcelButtons } from "@/components/shared/HrExcelButtons";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import { FilterBar, type ActiveFilters, type FilterDef } from "@/components/shared/FilterBar";
import type { Employee, WorkforceMovement } from "@/types";
import { useTranslation } from "@/lib/i18n/useTranslation";

type EtpRow = {
  id: string;
  matricule: string;
  name: string;
  department: string;
  direction: string;
  country: string;
  func: string;
  level: string;
  fte: number;
  salary: number;
  hrOwner: string;
  hasMovement: string;
  movementType: string;
  leverCode: string;
  leverId: string | null;
  plannedDate: string;
  actualDate: string;
  movementStatus: string;
  pse: string;
  movement: WorkforceMovement | null;
  alertKind: hr.MovementAlertKind | null;
  employee: Employee | null;
};

type MovementRow = {
  id: string;
  label: string;
  type: string;
  department: string;
  country: string;
  function: string;
  programId: string;
  hrOwner: string;
  executionStatus: string;
  fte: number;
  plannedDate: string;
  actualDate: string;
  status: string;
  hrValidated: boolean;
  leverCode: string;
  leverId: string | null;
  alertKind: hr.MovementAlertKind | null;
  /** € économie de masse salariale chargée en régime annuel (>= 0), 0 si le mécanisme n'est pas
   *  une réduction nette d'ETP (voir WorkforceMovement.savings et lib/hrFinancials.ts). */
  savings: number;
  /** € impact masse salariale annuel signé (négatif = économie) — WorkforceMovement.salaryImpact. */
  salaryImpact: number;
  /** € coût social one-off associé au mécanisme — WorkforceMovement.cost. */
  cost: number;
  /** € impact net la 1ère année = salaryImpact + cost (vision cash court terme). */
  netImpact: number;
  movement: WorkforceMovement;
};

function alertKindLabels(
  t: (key: string, fallback?: string) => string
): Record<hr.MovementAlertKind | "none", string> {
  return {
    overdue: t("hr.alert.overdue", "En retard"),
    due: t("hr.alert.due", "Échéance proche"),
    toValidate: t("hr.alert.toValidate", "À valider"),
    leverMismatch: t("hr.alert.leverMismatch", "Désynchronisé levier"),
    none: t("etp.alert.none", "Aucune"),
  };
}

function alertKindLabel(
  labels: Record<hr.MovementAlertKind | "none", string>,
  kind: hr.MovementAlertKind | null
): string {
  return labels[kind ?? "none"];
}

export default function BaseEtpPage() {
  const { t } = useTranslation();
  const ALERT_LABELS = alertKindLabels(t);
  const { user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState<"etp" | "mouvements">(
    requestedTab === "mouvements" ? "mouvements" : "etp"
  );
  useEffect(() => {
    setTab(requestedTab === "mouvements" ? "mouvements" : "etp");
  }, [requestedTab]);
  const [movementModal, setMovementModal] = useState<{ movement?: WorkforceMovement } | null>(null);

  const wf = data.workforce;
  const alerts = useMemo(() => hr.movementAlerts(wf, data.levers), [wf, data.levers]);
  const alertByMovement = useMemo(() => {
    const map = new Map<string, hr.MovementAlertKind>();
    // movementAlerts est trié par priorité : la première alerte d'un mouvement est la plus grave
    for (const a of alerts) if (!map.has(a.movement.id)) map.set(a.movement.id, a.kind);
    return map;
  }, [alerts]);

  const employeeRows: EtpRow[] = useMemo(() => {
    const movementByEmp = new Map<string, WorkforceMovement>();
    for (const m of wf.movements) {
      if (m.empId && !movementByEmp.has(m.empId)) movementByEmp.set(m.empId, m);
    }

    const baseRows: EtpRow[] = wf.employees.map((e) => {
      const m = movementByEmp.get(e.id) ?? null;
      const lever = m ? data.levers.find((l) => l.id === m.leverId) : undefined;
      return {
        id: e.id,
        matricule: e.id,
        name: e.name,
        department: e.department,
        direction: e.direction,
        country: e.country,
        func: e.func,
        level: e.level,
        fte: e.fte,
        salary: e.salary,
        hrOwner: e.hrOwner,
        hasMovement: m ? t("etp.yes", "Oui") : t("etp.no", "Non"),
        movementType: m?.type ?? "—",
        leverCode: lever?.code ?? "—",
        leverId: lever?.id ?? null,
        plannedDate: m?.plannedDate ?? "—",
        actualDate: m?.actualDate ?? "—",
        movementStatus: m
          ? `${m.status}${m.hrValidated ? t("etp.hrValidatedSuffix", " ✓RH") : ""}`
          : "—",
        pse: m?.inPSE ? t("etp.yes", "Oui") : t("etp.no", "Non"),
        movement: m,
        alertKind: m ? (alertByMovement.get(m.id) ?? null) : null,
        employee: e,
      };
    });

    const recruitmentRows: EtpRow[] = wf.movements
      .filter((m) => m.type === "Recrutement")
      .map((m) => {
        const lever = data.levers.find((l) => l.id === m.leverId);
        return {
          id: m.id,
          matricule: t("etp.toRecruit", "— à recruter —"),
          name: m.label,
          department: m.department,
          direction: "—",
          country: m.country,
          func: m.label,
          level: "—",
          fte: m.fte,
          salary: m.salaryImpact,
          hrOwner: m.hrOwner,
          hasMovement: t("etp.yes", "Oui"),
          movementType: m.type,
          leverCode: lever?.code ?? "—",
          leverId: lever?.id ?? null,
          plannedDate: m.plannedDate,
          actualDate: m.actualDate ?? "—",
          movementStatus: `${m.status}${m.hrValidated ? t("etp.hrValidatedSuffix", " ✓RH") : ""}`,
          pse: t("etp.no", "Non"),
          movement: m,
          alertKind: alertByMovement.get(m.id) ?? null,
          employee: null,
        };
      });

    return [...baseRows, ...recruitmentRows];
  }, [wf, data.levers, alertByMovement, t]);

  const movementRows: MovementRow[] = useMemo(
    () =>
      wf.movements.map((m) => {
        const lever = data.levers.find((l) => l.id === m.leverId);
        return {
          id: m.id,
          label: m.label,
          type: m.type,
          department: m.department,
          country: m.country,
          function: m.function ?? "—",
          programId: m.programId ?? "—",
          hrOwner: m.hrOwner,
          executionStatus: EXECUTION_LABELS[classifyMovementExecution(m)],
          fte: m.fte,
          plannedDate: m.plannedDate,
          actualDate: m.actualDate ?? "—",
          status: `${m.status}${m.hrValidated ? t("etp.hrValidatedSuffix", " ✓RH") : ""}`,
          hrValidated: m.hrValidated,
          leverCode: lever?.code ?? "—",
          leverId: lever?.id ?? null,
          alertKind: alertByMovement.get(m.id) ?? null,
          savings: m.savings,
          salaryImpact: m.salaryImpact,
          cost: m.cost,
          netImpact: m.salaryImpact + m.cost,
          movement: m,
        };
      }),
    [wf.movements, data.levers, alertByMovement, t]
  );

  const etpFilterDefs: FilterDef<EtpRow>[] = useMemo(
    () => [
      {
        key: "f_department",
        label: t("hr.department", "Département"),
        getValue: (r) => r.department,
      },
      {
        key: "f_direction",
        label: t("etp.filter.direction", "Direction"),
        getValue: (r) => r.direction,
      },
      { key: "f_country", label: t("dashboard.country", "Pays"), getValue: (r) => r.country },
      { key: "f_func", label: t("dashboard.function", "Fonction"), getValue: (r) => r.func },
      { key: "f_level", label: t("levers.columnStatus", "Niveau"), getValue: (r) => r.level },
      {
        key: "f_hrOwner",
        label: t("etp.filter.hrOwnerLocal", "RH local"),
        getValue: (r) => r.hrOwner,
      },
      {
        key: "f_hasMovement",
        label: t("etp.filter.hasMovement", "Mouvement prévu"),
        getValue: (r) => r.hasMovement,
      },
      { key: "f_lever", label: t("etp.linkedLever", "Levier lié"), getValue: (r) => r.leverCode },
      { key: "f_pse", label: "PSE", getValue: (r) => r.pse },
      {
        key: "f_alert",
        label: t("etp.alertLabel", "Alerte"),
        getValue: (r) => alertKindLabel(ALERT_LABELS, r.alertKind),
      },
    ],
    [t, ALERT_LABELS]
  );

  const movementFilterDefs: FilterDef<MovementRow>[] = useMemo(
    () => [
      { key: "f_type", label: t("etp.filter.type", "Type"), getValue: (r) => r.type },
      {
        key: "f_department",
        label: t("hr.department", "Département"),
        getValue: (r) => r.department,
      },
      { key: "f_country", label: t("dashboard.country", "Pays"), getValue: (r) => r.country },
      {
        key: "f_function",
        label: t("dashboard.function", "Fonction"),
        getValue: (r) => r.function,
      },
      {
        key: "f_program",
        label: t("dashboard.program", "Programme"),
        getValue: (r) => r.programId,
      },
      {
        key: "f_hrOwner",
        label: t("etp.filter.hrOwnerMovement", "RH Owner"),
        getValue: (r) => r.hrOwner,
      },
      {
        key: "f_execution",
        label: t("etp.filter.executionStatus", "État d'exécution"),
        getValue: (r) => r.executionStatus,
      },
      { key: "f_status", label: t("hr.status", "Statut"), getValue: (r) => r.status },
      {
        key: "f_hrValidated",
        label: t("etp.hrValidated", "Validé RH"),
        getValue: (r) => (r.hrValidated ? t("etp.yes", "Oui") : t("etp.no", "Non")),
      },
      { key: "f_lever", label: t("etp.linkedLever", "Levier lié"), getValue: (r) => r.leverCode },
      {
        key: "f_alert",
        label: t("etp.alertLabel", "Alerte"),
        getValue: (r) => alertKindLabel(ALERT_LABELS, r.alertKind),
      },
    ],
    [t, ALERT_LABELS]
  );

  const etpActiveFilters: ActiveFilters = useMemo(() => {
    const result: ActiveFilters = {};
    searchParams.forEach((value, key) => {
      if (etpFilterDefs.some((def) => def.key === key))
        result[key] = value.split(",").filter(Boolean);
    });
    return result;
  }, [searchParams, etpFilterDefs]);

  const setFilters = (next: ActiveFilters) => {
    const params = new URLSearchParams(searchParams.toString());
    Array.from(params.keys())
      .filter((k) => k.startsWith("f_"))
      .forEach((k) => params.delete(k));
    Object.entries(next).forEach(([k, v]) => {
      if (v.length > 0) params.set(k, v.join(","));
    });
    router.replace(`/hr/etp?${params.toString()}`);
  };

  const movementActiveFilters: ActiveFilters = useMemo(() => {
    const result: ActiveFilters = {};
    searchParams.forEach((value, key) => {
      if (movementFilterDefs.some((def) => def.key === key))
        result[key] = value.split(",").filter(Boolean);
    });
    return result;
  }, [searchParams, movementFilterDefs]);

  const filteredEmployees = useMemo(
    () =>
      employeeRows.filter((row) =>
        Object.entries(etpActiveFilters).every(([key, values]) => {
          const def = etpFilterDefs.find((d) => d.key === key);
          return !def || values.length === 0 || values.includes(def.getValue(row));
        })
      ),
    [employeeRows, etpActiveFilters, etpFilterDefs]
  );

  const filteredMovements = useMemo(
    () =>
      movementRows.filter((row) =>
        Object.entries(movementActiveFilters).every(([key, values]) => {
          const def = movementFilterDefs.find((d) => d.key === key);
          return !def || values.length === 0 || values.includes(def.getValue(row));
        })
      ),
    [movementRows, movementActiveFilters, movementFilterDefs]
  );

  const toValidateCount = alerts.filter((a) => a.kind === "toValidate").length;
  const plannedCount = wf.movements.filter((m) => m.status !== "Réalisé").length;

  const handleCellUpdate = (rowId: string, field: keyof EtpRow, value: string | number) => {
    const row = employeeRows.find((r) => r.id === rowId);
    if (!row?.employee) return;
    const patch: Partial<Employee> = {};
    if (field === "salary" || field === "fte") patch[field] = Number(value);
    else if (
      field === "name" ||
      field === "direction" ||
      field === "country" ||
      field === "func" ||
      field === "hrOwner" ||
      field === "department" ||
      field === "level"
    ) {
      patch[field] = String(value) as never;
    } else if (field === "matricule") {
      patch.id = String(value);
    } else return;
    data.upsertEmployee({ ...row.employee, ...patch });
    showToast(t("etp.toast.employeeUpdated", "Employé mis à jour"), row.employee.name, "success");
  };

  const departmentOptions = useMemo(
    () => Array.from(new Set(wf.departments.map((d) => d.name))).sort(),
    [wf.departments]
  );
  const directionOptions = useMemo(
    () =>
      Array.from(new Set(wf.employees.map((e) => e.direction)))
        .filter(Boolean)
        .sort(),
    [wf.employees]
  );
  const countryOptions = useMemo(
    () =>
      Array.from(new Set(wf.employees.map((e) => e.country)))
        .filter(Boolean)
        .sort(),
    [wf.employees]
  );
  const funcOptions = useMemo(
    () =>
      Array.from(new Set(wf.employees.map((e) => e.func)))
        .filter(Boolean)
        .sort(),
    [wf.employees]
  );

  const etpColumns: ColumnDef<EtpRow>[] = [
    {
      key: "matricule",
      label: t("etp.column.matricule", "Matricule"),
      width: "110px",
      editable: true,
      render: (r) => (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-secondary">
          {(r.alertKind === "overdue" || r.alertKind === "leverMismatch") && (
            <TriangleAlert size={12} className="text-rag-red" />
          )}
          {r.alertKind === "due" && <TriangleAlert size={12} className="text-rag-amber" />}
          {r.matricule}
        </span>
      ),
    },
    {
      key: "name",
      label: t("etp.column.name", "Nom"),
      editable: true,
      render: (r) => <strong>{r.name}</strong>,
    },
    {
      key: "department",
      label: t("hr.department", "Département"),
      editable: true,
      options: departmentOptions,
      allowCustom: true,
    },
    {
      key: "direction",
      label: t("etp.filter.direction", "Direction"),
      editable: true,
      options: directionOptions,
      allowCustom: true,
    },
    {
      key: "country",
      label: t("dashboard.country", "Pays"),
      editable: true,
      options: countryOptions,
      allowCustom: true,
    },
    {
      key: "func",
      label: t("dashboard.function", "Fonction"),
      editable: true,
      options: funcOptions,
      allowCustom: true,
    },
    {
      key: "level",
      label: t("levers.columnStatus", "Niveau"),
      editable: true,
      options: ["Global", "Régional", "Local"],
    },
    {
      key: "fte",
      label: t("etp.column.fte", "ETP"),
      align: "right",
      editable: true,
      type: "number",
    },
    {
      key: "salary",
      label: t("etp.column.salaryEur", "Salaire (€)"),
      align: "right",
      editable: true,
      type: "number",
      render: (r) => r.salary.toLocaleString("fr-FR"),
    },
    { key: "hrOwner", label: t("etp.filter.hrOwnerLocal", "RH local"), editable: true },
  ];

  const movementColumns: ColumnDef<MovementRow>[] = [
    {
      key: "id",
      label: t("etp.column.id", "ID"),
      width: "100px",
      render: (r) => <span className="font-mono text-[11px] text-secondary">{r.id}</span>,
    },
    {
      key: "label",
      label: t("etp.column.label", "Libellé"),
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMovementModal({ movement: r.movement });
          }}
          className="font-semibold text-bp-coral hover:underline"
        >
          {r.label}
        </button>
      ),
    },
    { key: "type", label: t("etp.filter.type", "Type") },
    { key: "department", label: t("hr.department", "Département") },
    { key: "country", label: t("dashboard.country", "Pays") },
    { key: "fte", label: t("etp.column.fte", "ETP"), align: "right" },
    { key: "plannedDate", label: t("etp.column.plannedDate", "Date prévue") },
    { key: "actualDate", label: t("etp.column.actualDate", "Date réelle") },
    { key: "status", label: t("hr.status", "Statut") },
    {
      key: "hrValidated",
      label: t("etp.hrValidated", "Validé RH"),
      render: (r) =>
        r.hrValidated ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rag-green-dark">
            <CheckCircle2 size={13} /> {t("etp.validatedLabel", "Validé")}
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              data.validateMovement(r.movement.id);
              showToast(
                t("etp.toast.movementValidated", "Mouvement validé"),
                r.movement.label,
                "success"
              );
            }}
          >
            {t("etp.validateAction", "✓ Valider")}
          </Button>
        ),
    },
    {
      key: "leverCode",
      label: t("etp.linkedLever", "Levier lié"),
      render: (r) =>
        r.leverId ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/levers/detail?id=${r.leverId}`);
            }}
            className="font-mono text-[11px] text-bp-coral hover:underline"
          >
            {r.leverCode}
          </button>
        ) : (
          "—"
        ),
    },
    {
      key: "alertKind",
      label: t("etp.alertLabel", "Alerte"),
      render: (r) => {
        if (r.alertKind === "overdue")
          return <span className="text-[11px] text-rag-red">{ALERT_LABELS.overdue}</span>;
        if (r.alertKind === "due")
          return <span className="text-[11px] text-rag-amber">{ALERT_LABELS.due}</span>;
        if (r.alertKind === "toValidate")
          return <span className="text-[11px] text-rag-amber">{ALERT_LABELS.toValidate}</span>;
        if (r.alertKind === "leverMismatch")
          return <span className="text-[11px] text-rag-red">{ALERT_LABELS.leverMismatch}</span>;
        return <span className="text-[11px] text-tertiary">—</span>;
      },
    },
    {
      key: "savings",
      label: t("etp.column.savingsLoaded", "Économie salaire chargé"),
      align: "right",
      render: (r) =>
        r.savings > 0 ? (
          <span className="font-semibold text-rag-green-dark">
            {fmtCurr(r.savings / 1_000_000)}
          </span>
        ) : (
          <span className="text-tertiary">
            {r.salaryImpact !== 0 ? fmtCurr(r.salaryImpact / 1_000_000) : "—"}
          </span>
        ),
    },
    {
      key: "cost",
      label: t("etp.column.socialCosts", "Coûts sociaux associés"),
      align: "right",
      render: (r) => <span className="text-rag-amber">{fmtCurr(r.cost / 1_000_000)}</span>,
    },
    {
      key: "netImpact",
      label: t("etp.column.netImpactY1", "Impact net 1ère année"),
      align: "right",
      render: (r) => (
        <span
          className={`font-semibold ${r.netImpact <= 0 ? "text-rag-green-dark" : "text-primary"}`}
        >
          {fmtCurr(r.netImpact / 1_000_000)}
        </span>
      ),
    },
  ];

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {t("nav.hrEtp", "Base ETP")}
          </h1>
          <div className="mt-2.5 text-[13px] text-secondary">
            {t(
              "etp.employeesSummary",
              "{n} employés sur le périmètre transformation · {m} mouvements suivis"
            )
              .replace("{n}", String(wf.employees.length))
              .replace("{m}", String(wf.movements.length))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HrExcelButtons data={data} />
          <Button variant="primary" onClick={() => setMovementModal({})}>
            <Plus size={13} /> {t("etp.newMovement", "Nouveau mouvement")}
          </Button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-5 gap-3.5 max-[1100px]:grid-cols-2">
        <KPICard
          label={t("etp.kpi.currentHeadcount", "Effectif actuel")}
          value={hr.currentFTE(wf).toLocaleString("fr-FR")}
          icon={Users}
        />
        <KPICard
          label={t("etp.kpi.targetHeadcount", "Effectif cible")}
          value={hr.targetFTE(wf).toLocaleString("fr-FR")}
          icon={Users}
          accent="green"
        />
        <KPICard
          label={t("hr.landingPlan", "Atterrissage plan")}
          value={hr.plannedFTE(wf).toLocaleString("fr-FR")}
          icon={Users}
          accent="brown"
          sub={t("etp.kpi.landingPlanSub", "écart cible : {n} ETP").replace(
            "{n}",
            (hr.plannedFTE(wf) - hr.targetFTE(wf)).toLocaleString("fr-FR")
          )}
        />
        <KPICard
          label={t("etp.kpi.upcomingMovements", "Mouvements à venir")}
          value={String(plannedCount)}
          icon={Users}
          accent="amber"
        />
        <KPICard
          label={t("etp.kpi.toValidateHr", "À valider RH")}
          value={String(toValidateCount)}
          icon={CheckCircle2}
          accent={toValidateCount > 0 ? "red" : "default"}
        />
      </div>

      <div className="mb-3.5 flex gap-1 border-b border-border">
        <button
          onClick={() => setTab("etp")}
          className={`px-4 py-2 text-[13px] font-medium transition-colors ${
            tab === "etp"
              ? "border-b-2 border-bp-coral text-bp-coral"
              : "text-tertiary hover:text-primary"
          }`}
        >
          {t("nav.hrEtp", "Base ETP")}
        </button>
        <button
          onClick={() => setTab("mouvements")}
          className={`px-4 py-2 text-[13px] font-medium transition-colors ${
            tab === "mouvements"
              ? "border-b-2 border-bp-coral text-bp-coral"
              : "text-tertiary hover:text-primary"
          }`}
        >
          {t("etp.tab.movementsTracking", "Suivi des mouvements")}
        </button>
      </div>

      {tab === "etp" && (
        <>
          <div className="mb-3.5 rounded-md border border-border bg-white p-3">
            <FilterBar
              items={employeeRows}
              defs={etpFilterDefs}
              active={etpActiveFilters}
              onChange={setFilters}
            />
          </div>
          <EditableTable
            data={filteredEmployees}
            columns={etpColumns}
            onCellUpdate={handleCellUpdate}
            searchPlaceholder={t(
              "etp.searchPlaceholderEtp",
              "Rechercher (nom, matricule, fonction...)"
            )}
            defaultSort={{ key: "department", direction: "asc" }}
          />
        </>
      )}

      {tab === "mouvements" && (
        <>
          <div className="mb-3.5 rounded-md border border-border bg-white p-3">
            <FilterBar
              items={movementRows}
              defs={movementFilterDefs}
              active={movementActiveFilters}
              onChange={setFilters}
            />
          </div>
          <EditableTable
            data={filteredMovements}
            columns={movementColumns}
            searchPlaceholder={t(
              "etp.searchPlaceholderMovements",
              "Rechercher (libellé, type, département...)"
            )}
            defaultSort={{ key: "plannedDate", direction: "desc" }}
          />
        </>
      )}

      <Modal
        open={movementModal !== null}
        onOpenChange={(open) => !open && setMovementModal(null)}
        title={
          movementModal?.movement
            ? t("etp.modal.editMovement", "Modifier le mouvement")
            : t("etp.newMovement", "Nouveau mouvement")
        }
        maxWidth="640px"
      >
        {movementModal && (
          <MovementForm
            data={data}
            companyId={user?.companyId}
            initialValues={movementModal.movement}
            submitLabel={
              movementModal.movement
                ? t("common.save", "Enregistrer")
                : t("etp.form.createMovement", "Créer le mouvement")
            }
            onCancel={() => setMovementModal(null)}
            onSubmit={(values: MovementFormValues) => {
              if (movementModal.movement) {
                data.updateWorkforceMovement(movementModal.movement.id, values);
                showToast(
                  t("etp.toast.movementUpdated", "Mouvement mis à jour"),
                  values.label,
                  "success"
                );
              } else {
                data.createWorkforceMovement(values);
                showToast(
                  t("etp.toast.movementCreated", "Mouvement créé"),
                  values.label,
                  "success"
                );
              }
              setMovementModal(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
