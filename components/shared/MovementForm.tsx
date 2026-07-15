"use client";

import { useState } from "react";
import { Button } from "@/components/shared/Button";
import type { BeTrackData, MovementStatus, MovementType, WorkforceMovement } from "@/types";

const inputClass =
  "w-full rounded-sm border border-border px-2.5 py-1.5 text-xs focus:border-black focus:outline-none";
const labelClass = "mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-tertiary";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

export type MovementFormValues = Omit<WorkforceMovement, "id">;

const TYPES: MovementType[] = ["Redéploiement", "Reconversion", "Suppression", "Recrutement"];
const STATUSES: MovementStatus[] = ["Planifié", "En cours", "Réalisé"];
const TRANSFER_TYPES: MovementType[] = ["Redéploiement", "Reconversion"];

/** Formulaire de création/édition d'un mouvement RH — rattache un employé (ou un poste à
 * recruter) à un levier de transformation. Le choix d'un employé préremplit département, pays,
 * ETP, RH local et impact salarial ; un Recrutement se saisit sans employé existant. */
export function MovementForm({
  data,
  initialValues,
  onSubmit,
  onCancel,
  submitLabel = "Créer le mouvement",
}: {
  data: BeTrackData;
  initialValues?: Partial<MovementFormValues>;
  onSubmit: (values: MovementFormValues) => void;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const employees = data.workforce.employees;
  const departments = data.workforce.departments;
  const firstEmployee = employees[0];

  const [values, setValues] = useState<MovementFormValues>({
    empId: firstEmployee?.id ?? null,
    label: firstEmployee?.name ?? "",
    leverId: data.levers[0]?.id ?? "",
    type: "Redéploiement",
    fte: firstEmployee?.fte ?? 1,
    department: firstEmployee?.department ?? departments[0]?.name ?? "",
    toDepartment: undefined,
    country: firstEmployee?.country ?? "France",
    hrOwner: firstEmployee?.hrOwner ?? "",
    plannedDate: today,
    actualDate: null,
    status: "Planifié",
    hrValidated: false,
    inPSE: false,
    salaryImpact: 0,
    savings: 0,
    cost: 0,
    ...initialValues,
  });

  const set = <K extends keyof MovementFormValues>(key: K, value: MovementFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const isRecruitment = values.type === "Recrutement";
  const isTransfer = TRANSFER_TYPES.includes(values.type);

  const applyEmployee = (empId: string) => {
    const emp = employees.find((e) => e.id === empId);
    if (!emp) return;
    setValues((prev) => ({
      ...prev,
      empId: emp.id,
      label: emp.name,
      fte: emp.fte,
      department: emp.department,
      country: emp.country,
      hrOwner: emp.hrOwner,
      salaryImpact: prev.type === "Suppression" ? -emp.salary : prev.salaryImpact,
      savings: prev.type === "Suppression" ? emp.salary : prev.savings,
    }));
  };

  const applyType = (type: MovementType) => {
    const emp = employees.find((e) => e.id === values.empId);
    setValues((prev) => ({
      ...prev,
      type,
      empId: type === "Recrutement" ? null : (prev.empId ?? firstEmployee?.id ?? null),
      label:
        type === "Recrutement"
          ? prev.empId
            ? "" // on passe d'un employé à un poste : à saisir
            : prev.label
          : (emp?.name ?? prev.label),
      toDepartment: TRANSFER_TYPES.includes(type) ? prev.toDepartment : undefined,
      inPSE: type === "Suppression" ? prev.inPSE : false,
      salaryImpact: type === "Suppression" && emp ? -emp.salary : type === "Recrutement" ? Math.abs(prev.salaryImpact) : 0,
      savings: type === "Suppression" && emp ? emp.salary : 0,
    }));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!values.label.trim()) return;
        onSubmit(values);
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type de mouvement">
          <select
            className={inputClass}
            value={values.type}
            onChange={(e) => applyType(e.target.value as MovementType)}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Levier rattaché">
          <select
            className={inputClass}
            value={values.leverId}
            onChange={(e) => set("leverId", e.target.value)}
          >
            {data.levers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} — {l.name}
              </option>
            ))}
          </select>
        </Field>

        {isRecruitment ? (
          <div className="col-span-2">
            <Field label="Intitulé du poste à recruter">
              <input
                required
                className={inputClass}
                value={values.label}
                onChange={(e) => set("label", e.target.value)}
                placeholder="ex. Data Engineer (poste créé)"
              />
            </Field>
          </div>
        ) : (
          <div className="col-span-2">
            <Field label="Employé">
              <select
                className={inputClass}
                value={values.empId ?? ""}
                onChange={(e) => applyEmployee(e.target.value)}
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {e.func} ({e.department})
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        <Field label={isRecruitment ? "Département d'accueil" : "Département"}>
          <select
            className={inputClass}
            value={values.department}
            onChange={(e) => set("department", e.target.value)}
          >
            {departments.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        {isTransfer ? (
          <Field label="Département d'arrivée">
            <select
              className={inputClass}
              value={values.toDepartment ?? ""}
              onChange={(e) => set("toDepartment", e.target.value || undefined)}
            >
              <option value="">— choisir —</option>
              {departments.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Pays">
            <select
              className={inputClass}
              value={values.country}
              onChange={(e) => set("country", e.target.value)}
            >
              {["France", "Germany", "Spain", "Italy", "UK", "USA"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="ETP concernés">
          <input
            type="number"
            step="0.1"
            min="0"
            className={inputClass}
            value={values.fte}
            onChange={(e) => set("fte", Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="RH local responsable">
          <input
            className={inputClass}
            value={values.hrOwner}
            onChange={(e) => set("hrOwner", e.target.value)}
          />
        </Field>

        <Field label="Date planifiée">
          <input
            type="date"
            className={inputClass}
            value={values.plannedDate}
            onChange={(e) => set("plannedDate", e.target.value)}
          />
        </Field>
        <Field label="Date réalisée">
          <input
            type="date"
            className={inputClass}
            value={values.actualDate ?? ""}
            onChange={(e) => set("actualDate", e.target.value || null)}
          />
        </Field>
        <Field label="Statut">
          <select
            className={inputClass}
            value={values.status}
            onChange={(e) => set("status", e.target.value as MovementStatus)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        {values.type === "Suppression" ? (
          <label className="flex items-end gap-2 pb-1.5">
            <input
              type="checkbox"
              checked={values.inPSE ?? false}
              onChange={(e) => set("inPSE", e.target.checked)}
              className="accent-[#FF3C47]"
            />
            <span className="text-xs font-medium text-primary">Inclus dans le PSE</span>
          </label>
        ) : (
          <div />
        )}

        <Field label="Impact masse salariale (€/an, − = économie)">
          <input
            type="number"
            step="1000"
            className={inputClass}
            value={values.salaryImpact}
            onChange={(e) => set("salaryImpact", Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Coût one-off (€ — indemnités, formation…)">
          <input
            type="number"
            step="1000"
            className={inputClass}
            value={values.cost}
            onChange={(e) => set("cost", Number(e.target.value) || 0)}
          />
        </Field>
        <div className="col-span-2">
          <Field label="Commentaire">
            <input
              className={inputClass}
              value={values.comment ?? ""}
              onChange={(e) => set("comment", e.target.value || undefined)}
            />
          </Field>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" variant="primary">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
