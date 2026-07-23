"use client";

import { useState } from "react";
import { Button } from "@/components/shared/Button";
import { DependencyEditor } from "@/components/shared/DependencyEditor";
import { STATUS_LABEL, STATUS_ORDER } from "@/lib/status-config";
import type { LifecycleLabels } from "@/lib/hooks/useLifecycleLabels";
import type {
  BeTrackData,
  FinancialSnapshot,
  LeverStatus,
  PriorityLevel,
  RiskLevel,
  SubLever,
} from "@/types";

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

export type SubLeverFormValues = Omit<SubLever, "id">;

/** Formulaire d'un sous-levier — l'impact d'un levier sur un centre de coût unique, avec ses
 * dépendances (autres leviers/sous-leviers). Champs volontairement plus restreints que LeverForm. */
export function SubLeverForm({
  data,
  leverId,
  lifecycle,
  excludeSubLeverId,
  initialValues,
  onSubmit,
  onCancel,
  onDelete,
  submitLabel = "Enregistrer",
}: {
  data: BeTrackData;
  leverId: string;
  /** Résolution des libellés de statut selon le référentiel de l'entreprise (facultatif, retombe
   * sur STATUS_LABEL si absent). */
  lifecycle?: LifecycleLabels;
  /** id du sous-levier en cours d'édition, exclu de la liste de dépendances possibles */
  excludeSubLeverId?: string;
  initialValues?: Partial<SubLeverFormValues>;
  onSubmit: (values: SubLeverFormValues) => void;
  onCancel: () => void;
  onDelete?: () => void;
  submitLabel?: string;
}) {
  const parentLever = data.levers.find((l) => l.id === leverId);
  const today = new Date().toISOString().slice(0, 10);
  const [values, setValues] = useState<SubLeverFormValues>({
    leverId,
    name: "",
    owner: "",
    ownerInit: "",
    expensePost: "",
    businessUnit: "",
    pnlMap: data.pnlAccounts[0]?.id ?? "",
    grossSavings: 0,
    netSavings: 0,
    opexOneOff: 0,
    opexRec: 0,
    capex: 0,
    fteImpact: 0,
    popImpacted: 0,
    start: parentLever?.start ?? today,
    end: parentLever?.end ?? today,
    status: "idea",
    priority: "medium",
    risk: "low",
    dependencies: [],
    actions: [],
    ...initialValues,
  });

  const set = <K extends keyof SubLeverFormValues>(key: K, value: SubLeverFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const num = (v: string) => (v === "" ? 0 : Number(v));

  // Plan initial figé dès l'étape "validated" (décision de lancement) : les chiffres d'origine ne sont plus modifiables, seule la
  // réactualisation (à partir de l'étape "in_progress") l'est encore, dans un bloc séparé.
  const isLocked = Boolean(values.lockedPlan);
  const canReforecast = STATUS_ORDER[values.status] >= STATUS_ORDER.in_progress;
  const setReforecast = (key: keyof FinancialSnapshot, value: number) =>
    setValues((prev) => ({
      ...prev,
      reforecast: {
        ...(prev.reforecast ?? prev.lockedPlan ?? prev),
        [key]: value,
      } as FinancialSnapshot,
    }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!values.name.trim() || !values.expensePost.trim() || !values.businessUnit.trim())
          return;
        onSubmit(values);
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Nom du sous-levier">
            <input
              required
              autoFocus
              className={inputClass}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
        </div>
        <Field label={`Owner (défaut : ${parentLever?.owner ?? "owner du levier"})`}>
          <input
            className={inputClass}
            value={values.owner ?? ""}
            onChange={(e) => set("owner", e.target.value)}
          />
        </Field>
        <Field label="Initiales owner">
          <input
            className={inputClass}
            maxLength={3}
            value={values.ownerInit ?? ""}
            onChange={(e) => set("ownerInit", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Poste de dépense">
          <input
            required
            className={inputClass}
            value={values.expensePost}
            onChange={(e) => set("expensePost", e.target.value)}
          />
        </Field>
        <Field label="BU associée">
          <input
            required
            className={inputClass}
            value={values.businessUnit}
            onChange={(e) => set("businessUnit", e.target.value)}
          />
        </Field>
        <Field label="Compte P&L impacté">
          <select
            className={inputClass}
            value={values.pnlMap}
            onChange={(e) => set("pnlMap", e.target.value)}
          >
            {data.pnlAccounts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date de départ">
          <input
            type="date"
            className={inputClass}
            value={values.start}
            onChange={(e) => set("start", e.target.value)}
          />
        </Field>
        <Field label="Date de fin estimée">
          <input
            type="date"
            className={inputClass}
            value={values.end}
            onChange={(e) => set("end", e.target.value)}
          />
        </Field>
        <Field label="Niveau d'avancement">
          <select
            className={inputClass}
            value={values.status}
            onChange={(e) => set("status", e.target.value as LeverStatus)}
          >
            {data.leverStatuses.map((s) => (
              <option key={s} value={s}>
                {lifecycle ? lifecycle.label(s) : STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priorité">
          <select
            className={inputClass}
            value={values.priority}
            onChange={(e) => set("priority", e.target.value as PriorityLevel)}
          >
            {data.priorityLevels.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Risque">
          <select
            className={inputClass}
            value={values.risk}
            onChange={(e) => set("risk", e.target.value as RiskLevel)}
          >
            {data.riskLevels.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        {isLocked && (
          <div className="col-span-2 rounded-sm border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
            Plan initial figé au passage en «{" "}
            {lifecycle ? lifecycle.label("validated") : STATUS_LABEL.validated} ». Les valeurs
            ci-dessous sont en lecture seule — utilisez le bloc « Réactualisation » plus bas pour
            ajuster la projection.
          </div>
        )}
        <Field label="Impact estimé brut (€M)">
          <input
            type="number"
            step="0.1"
            disabled={isLocked}
            className={`${inputClass} disabled:bg-neutral-100 disabled:text-tertiary`}
            value={values.grossSavings}
            onChange={(e) => set("grossSavings", num(e.target.value))}
          />
        </Field>
        <Field label="Impact estimé net (€M)">
          <input
            type="number"
            step="0.1"
            disabled={isLocked}
            className={`${inputClass} disabled:bg-neutral-100 disabled:text-tertiary`}
            value={values.netSavings}
            onChange={(e) => set("netSavings", num(e.target.value))}
          />
        </Field>
        <Field label="CAPEX (€M)">
          <input
            type="number"
            step="0.1"
            disabled={isLocked}
            className={`${inputClass} disabled:bg-neutral-100 disabled:text-tertiary`}
            value={values.capex}
            onChange={(e) => set("capex", num(e.target.value))}
          />
        </Field>
        <Field label="OPEX one-off (€M)">
          <input
            type="number"
            step="0.1"
            disabled={isLocked}
            className={`${inputClass} disabled:bg-neutral-100 disabled:text-tertiary`}
            value={values.opexOneOff}
            onChange={(e) => set("opexOneOff", num(e.target.value))}
          />
        </Field>
        <Field label="OPEX récurrent (€M/an)">
          <input
            type="number"
            step="0.1"
            disabled={isLocked}
            className={`${inputClass} disabled:bg-neutral-100 disabled:text-tertiary`}
            value={values.opexRec}
            onChange={(e) => set("opexRec", num(e.target.value))}
          />
        </Field>
        <Field label="Impact estimé (ETP)">
          <input
            type="number"
            className={inputClass}
            value={values.fteImpact}
            onChange={(e) => set("fteImpact", num(e.target.value))}
          />
        </Field>
        <Field label="Population impactée">
          <input
            type="number"
            min={0}
            className={inputClass}
            value={values.popImpacted}
            onChange={(e) => set("popImpacted", num(e.target.value))}
          />
        </Field>
        {canReforecast && (
          <div className="col-span-2 rounded-sm border border-border bg-neutral-50 p-3">
            <span className={labelClass}>Réactualisation (prévisions à date)</span>
            <div className="mt-2 grid grid-cols-3 gap-3">
              <Field label="Net réactualisé (€M)">
                <input
                  type="number"
                  step="0.1"
                  className={inputClass}
                  value={(values.reforecast ?? values.lockedPlan)?.netSavings ?? values.netSavings}
                  onChange={(e) => setReforecast("netSavings", num(e.target.value))}
                />
              </Field>
              <Field label="CAPEX réactualisé (€M)">
                <input
                  type="number"
                  step="0.1"
                  className={inputClass}
                  value={(values.reforecast ?? values.lockedPlan)?.capex ?? values.capex}
                  onChange={(e) => setReforecast("capex", num(e.target.value))}
                />
              </Field>
              <Field label="OPEX réactualisé (€M/an)">
                <input
                  type="number"
                  step="0.1"
                  className={inputClass}
                  value={(values.reforecast ?? values.lockedPlan)?.opexRec ?? values.opexRec}
                  onChange={(e) => setReforecast("opexRec", num(e.target.value))}
                />
              </Field>
            </div>
          </div>
        )}
        <div className="col-span-2">
          <span className={labelClass}>Dépendances (leviers / sous-leviers)</span>
          <DependencyEditor
            data={data}
            value={values.dependencies}
            onChange={(next) => set("dependencies", next)}
            excludeIds={[leverId, ...(excludeSubLeverId ? [excludeSubLeverId] : [])]}
          />
        </div>
      </div>

      <div className="mt-6 flex justify-between gap-2">
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
