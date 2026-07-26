"use client";

import { useState } from "react";
import type { ActionImpact, ActionStatus, BeTrackData, LeverAction } from "@/types";

const inputClass =
  "w-full rounded-sm border border-border bg-white px-2 py-1.5 text-[12px] focus:border-bp-coral focus:outline-none";
const selectClass =
  "w-full rounded-sm border border-border bg-white px-1.5 py-1.5 text-[12px] focus:border-bp-coral focus:outline-none";

const ACTION_STATUSES: ActionStatus[] = ["todo", "in_progress", "done", "delayed"];
const STATUS_LABELS: Record<ActionStatus, string> = {
  todo: "À faire",
  in_progress: "En cours",
  done: "Terminé",
  delayed: "En retard",
};

function generateId(): string {
  return "IMP" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function emptyImpact(): ActionImpact {
  return {
    id: generateId(),
    label: "",
    type: "cost",
    nature: "oneoff",
    amount: 0,
  };
}

export type ActionFormValues = Omit<LeverAction, "id">;

/** Formulaire de création/édition d'une action enrichie, avec un tableau d'impacts inline.
 *  Le tableau d'impacts permet d'ajouter/supprimer des lignes comme dans un tableur. */
export function ActionForm({
  data,
  initialValues,
  submitLabel = "Créer l'action",
  onSubmit,
  onCancel,
  onDelete,
}: {
  data: BeTrackData;
  initialValues?: Partial<LeverAction>;
  submitLabel?: string;
  onSubmit: (values: ActionFormValues) => void;
  onCancel?: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [owner, setOwner] = useState(initialValues?.owner ?? "");
  const [start, setStart] = useState(initialValues?.start ?? "");
  const [end, setEnd] = useState(initialValues?.end ?? "");
  const [status, setStatus] = useState<ActionStatus>(initialValues?.status ?? "todo");
  const [impacts, setImpacts] = useState<ActionImpact[]>(
    initialValues?.impacts && initialValues.impacts.length > 0
      ? initialValues.impacts
      : [emptyImpact()]
  );

  const updateImpact = (idx: number, patch: Partial<ActionImpact>) => {
    setImpacts((prev) => prev.map((imp, i) => (i === idx ? { ...imp, ...patch } : imp)));
  };
  const removeImpact = (idx: number) => setImpacts((prev) => prev.filter((_, i) => i !== idx));
  const addImpact = () => setImpacts((prev) => [...prev, emptyImpact()]);

  const handleSubmit = () => {
    const validImpacts = impacts.filter((imp) => imp.label.trim() !== "" && imp.amount > 0);
    onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      owner: owner.trim() || undefined,
      ownerInit:
        owner
          .trim()
          .split(" ")
          .map((w) => w[0])
          .join("")
          .slice(0, 2)
          .toUpperCase() || undefined,
      start,
      end,
      status,
      cost: 0,
      impacts: validImpacts,
    });
  };

  const pnlOptions = data.pnlAccounts.filter((a) => !a.computed);
  const entityOptions = Array.from(
    new Set(data.levers.map((l) => l.entity).filter((v): v is string => !!v))
  ).sort();

  return (
    <div className="flex flex-col gap-4">
      {/* Identification */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-secondary">
            Nom de l&apos;action
          </label>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Lancer le RFP"
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-secondary">
            Description
          </label>
          <textarea
            className={inputClass}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-secondary">
            Owner
          </label>
          <input className={inputClass} value={owner} onChange={(e) => setOwner(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-secondary">
            Statut
          </label>
          <select
            className={selectClass}
            value={status}
            onChange={(e) => setStatus(e.target.value as ActionStatus)}
          >
            {ACTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-secondary">
            Date début
          </label>
          <input
            className={inputClass}
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-secondary">
            Date fin
          </label>
          <input
            className={inputClass}
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>

      {/* Tableau d'impacts inline */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
            Lignes d&apos;impact
          </span>
          <button
            type="button"
            onClick={addImpact}
            className="rounded-sm bg-bp-coral/10 px-2 py-0.5 text-[10.5px] font-semibold text-bp-coral transition hover:bg-bp-coral/20"
          >
            + Ajouter
          </button>
        </div>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-neutral-50 text-left">
                <th className="px-2 py-1.5 font-semibold text-secondary">Type</th>
                <th className="px-2 py-1.5 font-semibold text-secondary">Description</th>
                <th className="px-2 py-1.5 font-semibold text-secondary">Nature</th>
                <th className="px-2 py-1.5 font-semibold text-secondary">€M</th>
                <th className="px-2 py-1.5 font-semibold text-secondary">ETP</th>
                <th className="px-2 py-1.5 font-semibold text-secondary">Poste de coût</th>
                <th className="px-2 py-1.5 font-semibold text-secondary">Centre de coût</th>
                <th className="px-2 py-1.5 font-semibold text-secondary">Entité (P&L)</th>
                <th className="w-8 px-1"></th>
              </tr>
            </thead>
            <tbody>
              {impacts.map((imp, idx) => (
                <tr key={imp.id} className="border-t border-border">
                  <td className="px-1 py-1">
                    <select
                      className="w-full rounded-sm border border-border px-1 py-1 text-[11px]"
                      value={imp.type}
                      onChange={(e) => {
                        const newType = e.target.value as "cost" | "saving";
                        const patch: Partial<ActionImpact> = { type: newType };
                        // Si on passe en "saving" et que la nature est "capex" (non valide), basculer vers "oneoff"
                        if (newType === "saving" && imp.nature === "capex") {
                          patch.nature = "oneoff";
                        }
                        updateImpact(idx, patch);
                      }}
                    >
                      <option value="cost">Coût</option>
                      <option value="saving">Gain</option>
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      className="w-full rounded-sm border border-border px-1.5 py-1 text-[11px]"
                      value={imp.label}
                      onChange={(e) => updateImpact(idx, { label: e.target.value })}
                      placeholder="Description..."
                    />
                  </td>
                  <td className="px-1 py-1">
                    <select
                      className="w-full rounded-sm border border-border px-1 py-1 text-[11px]"
                      value={imp.nature}
                      onChange={(e) =>
                        updateImpact(idx, {
                          nature: e.target.value as ActionImpact["nature"],
                        })
                      }
                    >
                      {imp.type === "cost" ? (
                        <>
                          <option value="capex">CAPEX</option>
                          <option value="opex_rec">OPEX réc.</option>
                          <option value="oneoff">One-off</option>
                        </>
                      ) : (
                        <>
                          <option value="opex_rec">Récurrent</option>
                          <option value="oneoff">One-off</option>
                        </>
                      )}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      className="w-16 rounded-sm border border-border px-1.5 py-1 text-right text-[11px]"
                      type="number"
                      step="0.01"
                      value={imp.amount || ""}
                      onChange={(e) =>
                        updateImpact(idx, { amount: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      className="w-12 rounded-sm border border-border px-1.5 py-1 text-right text-[11px]"
                      type="number"
                      step="1"
                      value={imp.fteCount ?? ""}
                      onChange={(e) =>
                        updateImpact(idx, {
                          fteCount: e.target.value ? parseInt(e.target.value) : undefined,
                        })
                      }
                    />
                  </td>
                  <td className="px-1 py-1">
                    <select
                      className="w-full rounded-sm border border-border px-1 py-1 text-[11px]"
                      value={imp.pnlMap ?? ""}
                      onChange={(e) => updateImpact(idx, { pnlMap: e.target.value || undefined })}
                    >
                      <option value="">—</option>
                      {pnlOptions.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      className="w-full rounded-sm border border-border px-1.5 py-1 text-[11px]"
                      value={imp.costCenter ?? ""}
                      onChange={(e) =>
                        updateImpact(idx, { costCenter: e.target.value || undefined })
                      }
                      placeholder="CC..."
                    />
                  </td>
                  <td className="px-1 py-1">
                    <select
                      className="w-full rounded-sm border border-border px-1 py-1 text-[11px]"
                      value={imp.entity ?? ""}
                      onChange={(e) => updateImpact(idx, { entity: e.target.value || undefined })}
                    >
                      <option value="">—</option>
                      {entityOptions.map((ent) => (
                        <option key={ent} value={ent}>
                          {ent}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1 text-center">
                    {impacts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeImpact(idx)}
                        className="text-tertiary transition hover:text-bp-coral"
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Boutons */}
      <div className="flex items-center gap-2 pt-2">
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md px-3 py-2 text-[12px] font-semibold text-rag-red transition hover:bg-rag-red-light"
          >
            Supprimer
          </button>
        )}
        <div className="flex-1" />
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-[12px] font-semibold text-secondary hover:bg-neutral-100"
          >
            Annuler
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!name.trim() || !start || !end}
          className="rounded-md bg-bp-coral px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-bp-red-brick disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
