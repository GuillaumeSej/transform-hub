"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Plus, TriangleAlert, Users } from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import * as hr from "@/lib/hrEngine";
import { Button } from "@/components/shared/Button";
import { KPICard } from "@/components/shared/KPICard";
import { Modal } from "@/components/shared/Modal";
import { MovementForm, type MovementFormValues } from "@/components/shared/MovementForm";
import { HrExcelButtons } from "@/components/shared/HrExcelButtons";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import { FilterBar, type ActiveFilters, type FilterDef } from "@/components/shared/FilterBar";
import type { Employee, WorkforceMovement } from "@/types";

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
  fte: number;
  plannedDate: string;
  actualDate: string;
  status: string;
  hrValidated: boolean;
  leverCode: string;
  leverId: string | null;
  alertKind: hr.MovementAlertKind | null;
  movement: WorkforceMovement;
};

export default function BaseEtpPage() {
  const { user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [tab, setTab] = useState<"etp" | "mouvements">("etp");
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
        hasMovement: m ? "Oui" : "Non",
        movementType: m?.type ?? "—",
        leverCode: lever?.code ?? "—",
        leverId: lever?.id ?? null,
        plannedDate: m?.plannedDate ?? "—",
        actualDate: m?.actualDate ?? "—",
        movementStatus: m ? `${m.status}${m.hrValidated ? " ✓RH" : ""}` : "—",
        pse: m?.inPSE ? "Oui" : "Non",
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
          matricule: "— à recruter —",
          name: m.label,
          department: m.department,
          direction: "—",
          country: m.country,
          func: m.label,
          level: "—",
          fte: m.fte,
          salary: m.salaryImpact,
          hrOwner: m.hrOwner,
          hasMovement: "Oui",
          movementType: m.type,
          leverCode: lever?.code ?? "—",
          leverId: lever?.id ?? null,
          plannedDate: m.plannedDate,
          actualDate: m.actualDate ?? "—",
          movementStatus: `${m.status}${m.hrValidated ? " ✓RH" : ""}`,
          pse: "Non",
          movement: m,
          alertKind: alertByMovement.get(m.id) ?? null,
          employee: null,
        };
      });

    return [...baseRows, ...recruitmentRows];
  }, [wf, data.levers, alertByMovement]);

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
          fte: m.fte,
          plannedDate: m.plannedDate,
          actualDate: m.actualDate ?? "—",
          status: `${m.status}${m.hrValidated ? " ✓RH" : ""}`,
          hrValidated: m.hrValidated,
          leverCode: lever?.code ?? "—",
          leverId: lever?.id ?? null,
          alertKind: alertByMovement.get(m.id) ?? null,
          movement: m,
        };
      }),
    [wf.movements, data.levers, alertByMovement]
  );

  const etpFilterDefs: FilterDef<EtpRow>[] = useMemo(
    () => [
      { key: "f_department", label: "Département", getValue: (r) => r.department },
      { key: "f_direction", label: "Direction", getValue: (r) => r.direction },
      { key: "f_country", label: "Pays", getValue: (r) => r.country },
      { key: "f_func", label: "Fonction", getValue: (r) => r.func },
      { key: "f_level", label: "Niveau", getValue: (r) => r.level },
      { key: "f_hrOwner", label: "RH local", getValue: (r) => r.hrOwner },
      { key: "f_hasMovement", label: "Mouvement prévu", getValue: (r) => r.hasMovement },
      { key: "f_lever", label: "Levier lié", getValue: (r) => r.leverCode },
      { key: "f_pse", label: "PSE", getValue: (r) => r.pse },
      {
        key: "f_alert",
        label: "Alerte",
        getValue: (r) =>
          r.alertKind === "overdue"
            ? "En retard"
            : r.alertKind === "due"
              ? "Échéance proche"
              : r.alertKind === "toValidate"
                ? "À valider"
                : r.alertKind === "leverMismatch"
                  ? "Désynchronisé levier"
                  : "Aucune",
      },
    ],
    []
  );

  const movementFilterDefs: FilterDef<MovementRow>[] = useMemo(
    () => [
      { key: "f_type", label: "Type", getValue: (r) => r.type },
      { key: "f_department", label: "Département", getValue: (r) => r.department },
      { key: "f_country", label: "Pays", getValue: (r) => r.country },
      { key: "f_status", label: "Statut", getValue: (r) => r.status },
      { key: "f_hrValidated", label: "Validé RH", getValue: (r) => (r.hrValidated ? "Oui" : "Non") },
      { key: "f_lever", label: "Levier lié", getValue: (r) => r.leverCode },
      {
        key: "f_alert",
        label: "Alerte",
        getValue: (r) =>
          r.alertKind === "overdue"
            ? "En retard"
            : r.alertKind === "due"
              ? "Échéance proche"
              : r.alertKind === "toValidate"
                ? "À valider"
                : r.alertKind === "leverMismatch"
                  ? "Désynchronisé levier"
                  : "Aucune",
      },
    ],
    []
  );

  const etpActiveFilters: ActiveFilters = useMemo(() => {
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
    router.replace(`/hr/etp?${params.toString()}`);
  };

  const movementActiveFilters: ActiveFilters = useMemo(() => {
    const result: ActiveFilters = {};
    searchParams.forEach((value, key) => {
      if (key.startsWith("f_")) result[key] = value.split(",").filter(Boolean);
    });
    return result;
  }, [searchParams]);

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
    showToast("Employé mis à jour", row.employee.name, "success");
  };

  const departmentOptions = useMemo(() =>
    Array.from(new Set(wf.departments.map((d) => d.name))).sort(),
    [wf.departments]
  );
  const directionOptions = useMemo(() =>
    Array.from(new Set(wf.employees.map((e) => e.direction))).filter(Boolean).sort(),
    [wf.employees]
  );
  const countryOptions = useMemo(() =>
    Array.from(new Set(wf.employees.map((e) => e.country))).filter(Boolean).sort(),
    [wf.employees]
  );
  const funcOptions = useMemo(() =>
    Array.from(new Set(wf.employees.map((e) => e.func))).filter(Boolean).sort(),
    [wf.employees]
  );

  const etpColumns: ColumnDef<EtpRow>[] = [
    {
      key: "matricule",
      label: "Matricule",
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
    { key: "name", label: "Nom", editable: true, render: (r) => <strong>{r.name}</strong> },
    {
      key: "department",
      label: "Département",
      editable: true,
      options: departmentOptions,
      allowCustom: true,
    },
    {
      key: "direction",
      label: "Direction",
      editable: true,
      options: directionOptions,
      allowCustom: true,
    },
    {
      key: "country",
      label: "Pays",
      editable: true,
      options: countryOptions,
      allowCustom: true,
    },
    {
      key: "func",
      label: "Fonction",
      editable: true,
      options: funcOptions,
      allowCustom: true,
    },
    {
      key: "level",
      label: "Niveau",
      editable: true,
      options: ["Global", "Régional", "Local"],
    },
    { key: "fte", label: "ETP", align: "right", editable: true, type: "number" },
    {
      key: "salary",
      label: "Salaire (€)",
      align: "right",
      editable: true,
      type: "number",
      render: (r) => r.salary.toLocaleString("fr-FR"),
    },
    { key: "hrOwner", label: "RH local", editable: true },
  ];

  const movementColumns: ColumnDef<MovementRow>[] = [
    { key: "id", label: "ID", width: "100px", render: (r) => <span className="font-mono text-[11px] text-secondary">{r.id}</span> },
    {
      key: "label",
      label: "Libellé",
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
    { key: "type", label: "Type" },
    { key: "department", label: "Département" },
    { key: "country", label: "Pays" },
    { key: "fte", label: "ETP", align: "right" },
    { key: "plannedDate", label: "Date prévue" },
    { key: "actualDate", label: "Date réelle" },
    { key: "status", label: "Statut" },
    {
      key: "hrValidated",
      label: "Validé RH",
      render: (r) =>
        r.hrValidated ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rag-green-dark">
            <CheckCircle2 size={13} /> Validé
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              data.validateMovement(r.movement.id);
              showToast("Mouvement validé", r.movement.label, "success");
            }}
          >
            ✓ Valider
          </Button>
        ),
    },
    {
      key: "leverCode",
      label: "Levier lié",
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
      label: "Alerte",
      render: (r) => {
        if (r.alertKind === "overdue") return <span className="text-[11px] text-rag-red">En retard</span>;
        if (r.alertKind === "due") return <span className="text-[11px] text-rag-amber">Échéance proche</span>;
        if (r.alertKind === "toValidate") return <span className="text-[11px] text-rag-amber">À valider</span>;
        if (r.alertKind === "leverMismatch") return <span className="text-[11px] text-rag-red">Désynchronisé levier</span>;
        return <span className="text-[11px] text-tertiary">—</span>;
      },
    },
  ];

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            Base ETP
          </h1>
          <div className="mt-2.5 text-[13px] text-secondary">
            {wf.employees.length} employés sur le périmètre transformation ·{" "}
            {wf.movements.length} mouvements suivis
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HrExcelButtons data={data} />
          <Button variant="primary" onClick={() => setMovementModal({})}>
            <Plus size={13} /> Nouveau mouvement
          </Button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-5 gap-3.5 max-[1100px]:grid-cols-2">
        <KPICard label="Effectif actuel" value={hr.currentFTE(wf).toLocaleString("fr-FR")} icon={Users} />
        <KPICard
          label="Effectif cible"
          value={hr.targetFTE(wf).toLocaleString("fr-FR")}
          icon={Users}
          accent="green"
        />
        <KPICard
          label="Atterrissage plan"
          value={hr.plannedFTE(wf).toLocaleString("fr-FR")}
          icon={Users}
          accent="brown"
          sub={`écart cible : ${(hr.plannedFTE(wf) - hr.targetFTE(wf)).toLocaleString("fr-FR")} ETP`}
        />
        <KPICard label="Mouvements à venir" value={String(plannedCount)} icon={Users} accent="amber" />
        <KPICard
          label="À valider RH"
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
          Base ETP
        </button>
        <button
          onClick={() => setTab("mouvements")}
          className={`px-4 py-2 text-[13px] font-medium transition-colors ${
            tab === "mouvements"
              ? "border-b-2 border-bp-coral text-bp-coral"
              : "text-tertiary hover:text-primary"
          }`}
        >
          Suivi des mouvements
        </button>
      </div>

      {tab === "etp" && (
        <>
          <div className="mb-3.5 rounded-md border border-border bg-white p-3">
            <FilterBar items={employeeRows} defs={etpFilterDefs} active={etpActiveFilters} onChange={setFilters} />
          </div>
          <EditableTable
            data={filteredEmployees}
            columns={etpColumns}
            onCellUpdate={handleCellUpdate}
            searchPlaceholder="Rechercher (nom, matricule, fonction...)"
            defaultSort={{ key: "department", direction: "asc" }}
          />
        </>
      )}

      {tab === "mouvements" && (
        <>
          <div className="mb-3.5 rounded-md border border-border bg-white p-3">
            <FilterBar items={movementRows} defs={movementFilterDefs} active={movementActiveFilters} onChange={setFilters} />
          </div>
          <EditableTable
            data={filteredMovements}
            columns={movementColumns}
            searchPlaceholder="Rechercher (libellé, type, département...)"
            defaultSort={{ key: "plannedDate", direction: "desc" }}
          />
        </>
      )}

      <Modal
        open={movementModal !== null}
        onOpenChange={(open) => !open && setMovementModal(null)}
        title={movementModal?.movement ? "Modifier le mouvement" : "Nouveau mouvement"}
        maxWidth="640px"
      >
        {movementModal && (
          <MovementForm
            data={data}
            initialValues={movementModal.movement}
            submitLabel={movementModal.movement ? "Enregistrer" : "Créer le mouvement"}
            onCancel={() => setMovementModal(null)}
            onSubmit={(values: MovementFormValues) => {
              if (movementModal.movement) {
                data.updateWorkforceMovement(movementModal.movement.id, values);
                showToast("Mouvement mis à jour", values.label, "success");
              } else {
                data.createWorkforceMovement(values);
                showToast("Mouvement créé", values.label, "success");
              }
              setMovementModal(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
