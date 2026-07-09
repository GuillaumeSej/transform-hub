"use client";

import { useState } from "react";
import { Banknote, PiggyBank, Plus, Trash2, Users } from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useToast } from "@/lib/hooks/useToast";
import * as engine from "@/lib/engine";
import { KPICard } from "@/components/shared/KPICard";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import { MovementForm, type MovementFormValues } from "@/components/shared/MovementForm";
import type { Department, WorkforceMovement } from "@/types";

type DepartmentRow = Department & { id: string; gap: number };
type MovementRow = WorkforceMovement & {
  id: string;
  employeeName: string;
  leverName: string;
  net: number;
};

/**
 * Module RH — baseline ETP par département et suivi des mouvements, édités inline comme un
 * tableau Excel (double-clic sur une cellule éditable), comme le reste de l'app.
 */
export default function HrPage() {
  const data = useBeTrackData();
  const { showToast } = useToast();
  const [movementModalOpen, setMovementModalOpen] = useState(false);

  const wf = data.workforce;

  const deptRows: DepartmentRow[] = wf.departments.map((d) => ({
    ...d,
    id: d.name,
    gap: Math.round((d.fte - d.fteTarget) * 10) / 10,
  }));

  const deptColumns: ColumnDef<DepartmentRow>[] = [
    { key: "name", label: "Département" },
    { key: "fte", label: "FTE actuel", align: "right", editable: true, type: "number" },
    { key: "fteTarget", label: "FTE cible", align: "right", editable: true, type: "number" },
    {
      key: "gap",
      label: "Écart",
      align: "right",
      render: (r) => (
        <span
          className={r.gap > 0 ? "text-rag-red" : r.gap < 0 ? "text-info-blue" : "text-secondary"}
        >
          {r.gap > 0 ? `+${r.gap}` : r.gap}
        </span>
      ),
    },
  ];

  const movementRows: MovementRow[] = wf.movements.map((m) => {
    const emp = wf.employees.find((e) => e.id === m.empId);
    const lever = data.levers.find((l) => l.id === m.leverId);
    return {
      ...m,
      employeeName: emp?.name ?? m.empId,
      leverName: lever ? `${lever.code} — ${lever.name}` : m.leverId,
      net: Math.round((m.savings - m.cost) * 10) / 10,
    };
  });

  const movementColumns: ColumnDef<MovementRow>[] = [
    { key: "employeeName", label: "Employé" },
    { key: "leverName", label: "Levier" },
    {
      key: "type",
      label: "Type",
      editable: true,
      type: "select",
      options: ["Redéploiement", "Reconversion", "Suppression"],
    },
    {
      key: "status",
      label: "Statut",
      editable: true,
      type: "select",
      options: ["Planifié", "En cours", "Réalisé"],
    },
    { key: "plannedDate", label: "Date planifiée", editable: true },
    {
      key: "actualDate",
      label: "Date réalisée",
      editable: true,
      render: (r) => r.actualDate ?? "—",
    },
    {
      key: "savings",
      label: "Économies (€)",
      align: "right",
      editable: true,
      type: "number",
      render: (r) => r.savings.toLocaleString("fr-FR"),
    },
    {
      key: "cost",
      label: "Coût (€)",
      align: "right",
      editable: true,
      type: "number",
      render: (r) => r.cost.toLocaleString("fr-FR"),
    },
    {
      key: "net",
      label: "Net (€)",
      align: "right",
      render: (r) => r.net.toLocaleString("fr-FR"),
    },
    {
      key: "id",
      label: "",
      sortable: false,
      width: "40px",
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.deleteWorkforceMovement(r.id);
            showToast("Mouvement supprimé", "", "success");
          }}
          title="Supprimer ce mouvement"
          className="rounded-full p-1 text-tertiary transition hover:bg-rag-red-light hover:text-rag-red"
        >
          <Trash2 size={13} />
        </button>
      ),
    },
  ];

  const handleDeptUpdate = (rowId: string, field: keyof DepartmentRow, value: string | number) => {
    if (field !== "fte" && field !== "fteTarget") return;
    data.updateDepartment(rowId, { [field]: Number(value) });
    showToast("Baseline mise à jour", rowId, "success");
  };

  const handleMovementUpdate = (
    rowId: string,
    field: keyof MovementRow,
    value: string | number
  ) => {
    const patch: Partial<WorkforceMovement> = {};
    if (field === "savings" || field === "cost") patch[field] = Number(value);
    else if (field === "type") patch.type = value as WorkforceMovement["type"];
    else if (field === "status") patch.status = value as WorkforceMovement["status"];
    else if (field === "plannedDate" || field === "actualDate") patch[field] = String(value);
    else return;
    data.updateWorkforceMovement(rowId, patch);
    showToast("Mouvement mis à jour", "", "success");
  };

  const plannedCount = wf.movements.filter((m) => m.status === "Planifié").length;
  const inProgressCount = wf.movements.filter((m) => m.status === "En cours").length;
  const doneCount = wf.movements.filter((m) => m.status === "Réalisé").length;

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            HR Module
          </h1>
          <div className="mt-2.5 text-[13px] text-secondary">
            Baseline ETP par département et suivi des mouvements RH — édition directe comme un
            tableur (double-clic sur une cellule).
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-3.5 max-[1100px]:grid-cols-2">
        <KPICard label="Total ETP" value={engine.fmtInt(wf.totalFTE)} icon={Users} />
        <KPICard
          label="Masse salariale"
          value={engine.fmtCurr(wf.massSalary)}
          icon={Banknote}
          accent="brown"
        />
        <KPICard label="Budget salarial" value={engine.fmtCurr(wf.budgetSalary)} icon={PiggyBank} />
        <KPICard
          label="Mouvements"
          value={`${doneCount} / ${wf.movements.length}`}
          icon={Users}
          sub={`${plannedCount} planifiés · ${inProgressCount} en cours`}
        />
      </div>

      <Card>
        <CardHeader title="Baseline ETP par département" />
        <CardBody flush>
          <EditableTable
            data={deptRows}
            columns={deptColumns}
            onCellUpdate={handleDeptUpdate}
            searchPlaceholder="Rechercher un département..."
            showTotalsRow
            totalsConfig={{
              fte: (rows) => rows.reduce((s, r) => s + r.fte, 0).toFixed(1),
              fteTarget: (rows) => rows.reduce((s, r) => s + r.fteTarget, 0).toFixed(1),
              gap: (rows) => rows.reduce((s, r) => s + r.gap, 0).toFixed(1),
            }}
          />
        </CardBody>
      </Card>

      <div className="mt-4 mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-primary">Mouvements RH</h2>
        <Button variant="primary" size="sm" onClick={() => setMovementModalOpen(true)}>
          <Plus size={13} /> Nouveau mouvement
        </Button>
      </div>

      <Modal
        open={movementModalOpen}
        onOpenChange={setMovementModalOpen}
        title="Nouveau mouvement RH"
        maxWidth="640px"
      >
        <MovementForm
          data={data}
          onCancel={() => setMovementModalOpen(false)}
          onSubmit={(values: MovementFormValues) => {
            data.createWorkforceMovement(values);
            setMovementModalOpen(false);
            showToast("Mouvement créé", "", "success");
          }}
        />
      </Modal>

      <Card>
        <CardBody flush>
          <EditableTable
            data={movementRows}
            columns={movementColumns}
            onCellUpdate={handleMovementUpdate}
            searchPlaceholder="Rechercher (employé, levier...)"
            showTotalsRow
            totalsConfig={{
              savings: (rows) => rows.reduce((s, r) => s + r.savings, 0).toLocaleString("fr-FR"),
              cost: (rows) => rows.reduce((s, r) => s + r.cost, 0).toLocaleString("fr-FR"),
              net: (rows) => rows.reduce((s, r) => s + r.net, 0).toLocaleString("fr-FR"),
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
