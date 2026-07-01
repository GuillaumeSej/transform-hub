"use client";

import { useState } from "react";
import { Button } from "@/components/shared/Button";
import type { ActionStatus, LeverAction } from "@/types";

const STATUS_OPTIONS: { value: ActionStatus; label: string }[] = [
  { value: "todo", label: "À faire" },
  { value: "in_progress", label: "En cours" },
  { value: "done", label: "Fait" },
  { value: "delayed", label: "En retard" },
];

const inputClass =
  "w-full rounded-sm border border-border px-2.5 py-1.5 text-xs focus:border-bp-coral focus:outline-none";
const labelClass = "mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-tertiary";

export type ActionFormValues = Omit<LeverAction, "id">;

/** Formulaire d'une action du plan d'action — nom, dates, coût, statut. */
export function ActionForm({
  initialValues,
  onSubmit,
  onCancel,
  onDelete,
  submitLabel = "Enregistrer",
}: {
  initialValues?: Partial<ActionFormValues>;
  onSubmit: (values: ActionFormValues) => void;
  onCancel: () => void;
  onDelete?: () => void;
  submitLabel?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [values, setValues] = useState<ActionFormValues>({
    name: "",
    start: today,
    end: today,
    cost: 0,
    status: "todo",
    ...initialValues,
  });

  const set = <K extends keyof ActionFormValues>(key: K, value: ActionFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!values.name.trim()) return;
        onSubmit(values);
      }}
    >
      <label className="mb-3 block">
        <span className={labelClass}>Nom de l&apos;action</span>
        <input
          required
          autoFocus
          className={inputClass}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </label>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>Date de début</span>
          <input
            type="date"
            className={inputClass}
            value={values.start}
            onChange={(e) => set("start", e.target.value)}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Date de fin</span>
          <input
            type="date"
            className={inputClass}
            value={values.end}
            onChange={(e) => set("end", e.target.value)}
          />
        </label>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>Coût (€K)</span>
          <input
            type="number"
            step="1"
            className={inputClass}
            value={values.cost}
            onChange={(e) => set("cost", e.target.value === "" ? 0 : Number(e.target.value))}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Statut</span>
          <select
            className={inputClass}
            value={values.status}
            onChange={(e) => set("status", e.target.value as ActionStatus)}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex justify-between gap-2">
        {onDelete ? (
          <Button type="button" variant="ghost" onClick={onDelete}>
            Supprimer
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Annuler
          </Button>
          <Button type="submit" variant="primary">
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
