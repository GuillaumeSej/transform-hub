"use client";

import { useState } from "react";
import { Button } from "@/components/shared/Button";
import type { BeTrackData, WorkforceMovement } from "@/types";

const inputClass =
  "w-full rounded-sm border border-border px-2.5 py-1.5 text-xs focus:border-bp-coral focus:outline-none";
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

const TYPES: WorkforceMovement["type"][] = ["Redéploiement", "Reconversion", "Suppression"];
const STATUSES: WorkforceMovement["status"][] = ["Planifié", "En cours", "Réalisé"];

/** Formulaire de création d'un mouvement RH — rattache un employé à un levier de transformation. */
export function MovementForm({
  data,
  onSubmit,
  onCancel,
}: {
  data: BeTrackData;
  onSubmit: (values: MovementFormValues) => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [values, setValues] = useState<MovementFormValues>({
    empId: data.workforce.employees[0]?.id ?? "",
    leverId: data.levers[0]?.id ?? "",
    type: "Redéploiement",
    plannedDate: today,
    actualDate: null,
    savings: 0,
    cost: 0,
    status: "Planifié",
  });

  const set = <K extends keyof MovementFormValues>(key: K, value: MovementFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Employé">
          <select
            className={inputClass}
            value={values.empId}
            onChange={(e) => set("empId", e.target.value)}
          >
            {data.workforce.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.func}
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
        <Field label="Type de mouvement">
          <select
            className={inputClass}
            value={values.type}
            onChange={(e) => set("type", e.target.value as WorkforceMovement["type"])}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Statut">
          <select
            className={inputClass}
            value={values.status}
            onChange={(e) => set("status", e.target.value as WorkforceMovement["status"])}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
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
        <Field label="Économies (€)">
          <input
            type="number"
            step="1000"
            className={inputClass}
            value={values.savings}
            onChange={(e) => set("savings", Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Coût (€)">
          <input
            type="number"
            step="1000"
            className={inputClass}
            value={values.cost}
            onChange={(e) => set("cost", Number(e.target.value) || 0)}
          />
        </Field>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" variant="primary">
          Créer le mouvement
        </Button>
      </div>
    </form>
  );
}
