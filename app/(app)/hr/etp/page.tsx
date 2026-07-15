"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Plus, TriangleAlert, Users } from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
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

/** Une ligne = un employé (joint à son mouvement le plus pertinent) OU un recrutement (poste
 * sans employé existant). Le RH voit ainsi toute sa base ET les postes entrants au même endroit. */
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
  hasMovement: string; // "Oui"/"Non" (filtrable)
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

export default function BaseEtpPage() {
  const data = useBeTrackData();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [movementModal, setMovementModal] = useState<{ movement?: WorkforceMovement } | null>(null);

  const wf = data.workforce;
  const alerts = useMemo(() => hr.movementAlerts(wf, data.levers), [wf, data.levers]);
  const alertByMovement = useMemo(() => {
    const map = new Map<string, hr.MovementAlertKind>();
    // movementAlerts est trié par priorité : la première alerte d'un mouvement est la plus grave
    for (const a of alerts) if (!map.has(a.movement.id)) map.set(a.movement.id, a.kind);
    return map;
  }, [alerts]);

  const rows: EtpRow[] = useMemo(() => {
    const movementByEmp = new Map<string, WorkforceMovement>();
    for (const m of wf.movements) {
      if (m.empId && !movementByEmp.has(m.empId)) movementByEmp.set(m.empId, m);
    }

    const employeeRows: EtpRow[] = wf.employees.map((e) => {
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

    return [...employeeRows, ...recruitmentRows];
  }, [wf, data.levers, alertByMovement]);

  const filterDefs: FilterDef<EtpRow>[] = useMemo(
    () => [
      { key: "f_department", label: "Département", getValue: (r) => r.department },
      { key: "f_direction", label: "Direction", getValue: (r) => r.direction },
      { key: "f_country", label: "Pays", getValue: (r) => r.country },
      { key: "f_func", label: "Fonction", getValue: (r) => r.func },
      { key: "f_level", label: "Niveau", getValue: (r) => r.level },
      { key: "f_hrOwner", label: "RH local", getValue: (r) => r.hrOwner },
      { key: "f_hasMovement", label: "Mouvement prévu", getValue: (r) => r.hasMovement },
      { key: "f_movementType", label: "Type de mouvement", getValue: (r) => r.movementType },
      { key: "f_movementStatus", label: "Statut mouvement", getValue: (r) => r.movementStatus },
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

  const activeFilters: ActiveFilters = useMemo(() => {
    const entries: [string, string][] = [];
    searchParams.forEach((value, key) => {
      if (key.startsWith("f_")) entries.push([key, value]);
    });
    return Object.fromEntries(entries);
  }, [searchParams]);

  const setFilters = (next: ActiveFilters) => {
    const params = new URLSearchParams(searchParams.toString());
    Array.from(params.keys())
      .filter((k) => k.startsWith("f_"))
      .forEach((k) => params.delete(k));
    Object.entries(next).forEach(([k, v]) => params.set(k, v));
    router.replace(`/hr/etp?${params.toString()}`);
  };

  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        Object.entries(activeFilters).every(([key, value]) => {
          const def = filterDefs.find((d) => d.key === key);
          return !def || def.getValue(row) === value;
        })
      ),
    [rows, activeFilters, filterDefs]
  );

  const toValidateCount = alerts.filter((a) => a.kind === "toValidate").length;
  const plannedCount = wf.movements.filter((m) => m.status !== "Réalisé").length;

  const handleCellUpdate = (rowId: string, field: keyof EtpRow, value: string | number) => {
    const row = rows.find((r) => r.id === rowId);
    if (!row?.employee) return; // lignes recrutement : édition via le modal mouvement
    const patch: Partial<Employee> = {};
    if (field === "salary" || field === "fte") patch[field] = Number(value);
    else if (
      field === "name" ||
      field === "direction" ||
      field === "country" ||
      field === "func" ||
      field === "hrOwner"
    ) {
      patch[field] = String(value);
    } else return;
    data.upsertEmployee({ ...row.employee, ...patch });
    showToast("Employé mis à jour", row.employee.name, "success");
  };

  const columns: ColumnDef<EtpRow>[] = [
    {
      key: "matricule",
      label: "Matricule",
      width: "110px",
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
    { key: "department", label: "Département" },
    { key: "direction", label: "Direction", editable: true },
    { key: "country", label: "Pays", editable: true },
    { key: "func", label: "Fonction", editable: true },
    { key: "level", label: "Niveau" },
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
    {
      key: "movementType",
      label: "Mouvement",
      render: (r) =>
        r.movement ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMovementModal({ movement: r.movement! });
            }}
            className="font-semibold text-bp-coral hover:underline"
          >
            {r.movementType}
          </button>
        ) : (
          "—"
        ),
    },
    {
      key: "leverCode",
      label: "Levier",
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
    { key: "plannedDate", label: "Date prévue" },
    { key: "actualDate", label: "Date réelle" },
    { key: "movementStatus", label: "Statut" },
    { key: "pse", label: "PSE", align: "center" },
    {
      key: "id",
      label: "Validation RH",
      sortable: false,
      render: (r) => {
        if (!r.movement) return null;
        if (r.movement.hrValidated) {
          return (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rag-green-dark">
              <CheckCircle2 size={13} /> Validé
            </span>
          );
        }
        return (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              data.validateMovement(r.movement!.id);
              showToast("Mouvement validé", r.movement!.label, "success");
            }}
          >
            ✓ Valider
          </Button>
        );
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

      <div className="mb-3.5 rounded-md border border-border bg-white p-3">
        <FilterBar items={rows} defs={filterDefs} active={activeFilters} onChange={setFilters} />
      </div>

      <EditableTable
        data={filteredRows}
        columns={columns}
        onCellUpdate={handleCellUpdate}
        searchPlaceholder="Rechercher (nom, matricule, fonction, levier...)"
        defaultSort={{ key: "department", direction: "asc" }}
      />

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
