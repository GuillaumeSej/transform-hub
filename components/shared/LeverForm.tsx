"use client";

import { useState } from "react";
import { Button } from "@/components/shared/Button";
import { STATUS_LABEL } from "@/lib/status-config";
import type { BeTrackData, Lever, LeverStatus, PriorityLevel, RiskLevel } from "@/types";

export type LeverFormValues = Omit<Lever, "id" | "createdAt" | "lastUpdate" | "dependencies">;

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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 mt-6 border-b-[1.5px] border-bp-coral pb-1.5 text-[11px] font-bold uppercase tracking-wide text-secondary first:mt-0">
      {children}
    </div>
  );
}

function emptyValues(data: BeTrackData): LeverFormValues {
  return {
    code: "",
    type: data.leverTypes[0] ?? "",
    name: "",
    ws: data.workstreams[0]?.id ?? "",
    owner: "",
    ownerInit: "",
    sponsor: "",
    sponsorInit: "",
    geography: data.geographies[0] ?? "",
    country: "",
    entity: "",
    function: data.functions[0] ?? "",
    costCenter: "",
    pnlMap: data.pnlAccounts[0]?.id ?? "",
    start: new Date().toISOString().slice(0, 10),
    end: new Date().toISOString().slice(0, 10),
    status: "idea",
    progress: 0,
    priority: "medium",
    risk: "low",
    grossSavings: 0,
    netSavings: 0,
    opexOneOff: 0,
    opexRec: 0,
    capex: 0,
    fteImpact: 0,
    popImpacted: 0,
    description: "",
  };
}

/** Formulaire complet des paramètres d'un levier — réutilisé pour la création et l'édition. */
export function LeverForm({
  data,
  initialValues,
  onSubmit,
  onCancel,
  submitLabel = "Enregistrer",
}: {
  data: BeTrackData;
  initialValues?: Partial<LeverFormValues>;
  onSubmit: (values: LeverFormValues) => void;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const [values, setValues] = useState<LeverFormValues>({
    ...emptyValues(data),
    ...initialValues,
  });

  const set = <K extends keyof LeverFormValues>(key: K, value: LeverFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const num = (v: string) => (v === "" ? 0 : Number(v));
  const isLocked = Boolean((initialValues as Lever | undefined)?.lockedPlan);

  return (
    <form
      id="lever-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!values.code.trim() || !values.name.trim()) return;
        onSubmit(values);
      }}
    >
      <SectionTitle>Identification</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Code du levier">
          <input
            required
            className={inputClass}
            value={values.code}
            onChange={(e) => set("code", e.target.value)}
          />
        </Field>
        <Field label="Type de levier">
          <select
            className={inputClass}
            value={values.type}
            onChange={(e) => set("type", e.target.value)}
          >
            {data.leverTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Workstream">
          <select
            className={inputClass}
            value={values.ws}
            onChange={(e) => set("ws", e.target.value)}
          >
            {data.workstreams.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="col-span-3">
          <Field label="Nom du levier">
            <input
              required
              className={inputClass}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
        </div>
      </div>

      <SectionTitle>Ownership</SectionTitle>
      <div className="grid grid-cols-4 gap-3">
        <div className="col-span-2">
          <Field label="Owner">
            <input
              className={inputClass}
              value={values.owner}
              onChange={(e) => set("owner", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Initiales">
          <input
            className={inputClass}
            maxLength={3}
            value={values.ownerInit}
            onChange={(e) => set("ownerInit", e.target.value.toUpperCase())}
          />
        </Field>
        <div />
        <div className="col-span-2">
          <Field label="Sponsor">
            <input
              className={inputClass}
              value={values.sponsor}
              onChange={(e) => set("sponsor", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Initiales">
          <input
            className={inputClass}
            maxLength={3}
            value={values.sponsorInit}
            onChange={(e) => set("sponsorInit", e.target.value.toUpperCase())}
          />
        </Field>
      </div>

      <SectionTitle>Localisation & mapping</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Géographie">
          <select
            className={inputClass}
            value={values.geography}
            onChange={(e) => set("geography", e.target.value)}
          >
            {data.geographies.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Pays">
          <input
            className={inputClass}
            value={values.country}
            onChange={(e) => set("country", e.target.value)}
          />
        </Field>
        <Field label="Entité">
          <input
            className={inputClass}
            value={values.entity}
            onChange={(e) => set("entity", e.target.value)}
          />
        </Field>
        <Field label="Fonction">
          <select
            className={inputClass}
            value={values.function}
            onChange={(e) => set("function", e.target.value)}
          >
            {data.functions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Centre de coût">
          <input
            className={inputClass}
            value={values.costCenter}
            onChange={(e) => set("costCenter", e.target.value)}
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
      </div>

      <SectionTitle>Statut & avancement</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
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
        <Field label="Niveau d'avancement (L1-L5)">
          <select
            className={inputClass}
            value={values.status}
            onChange={(e) => set("status", e.target.value as LeverStatus)}
          >
            {data.leverStatuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Progression (%)">
          <input
            type="number"
            min={0}
            max={100}
            className={inputClass}
            value={values.progress}
            onChange={(e) => set("progress", num(e.target.value))}
          />
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
      </div>

      <SectionTitle>Impact financier (€M)</SectionTitle>
      {isLocked && (
        <p className="mb-3 rounded-sm border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
          Plan initial figé au passage en L3 · Validé — lecture seule. Utilisez la réactualisation
          (onglet Impact du levier) pour ajuster la projection.
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Impact brut estimé">
          <input
            type="number"
            step="0.1"
            disabled={isLocked}
            className={`${inputClass} disabled:bg-neutral-100 disabled:text-tertiary`}
            value={values.grossSavings}
            onChange={(e) => set("grossSavings", num(e.target.value))}
          />
        </Field>
        <Field label="Impact net estimé">
          <input
            type="number"
            step="0.1"
            disabled={isLocked}
            className={`${inputClass} disabled:bg-neutral-100 disabled:text-tertiary`}
            value={values.netSavings}
            onChange={(e) => set("netSavings", num(e.target.value))}
          />
        </Field>
        <div />
        <Field label="CAPEX">
          <input
            type="number"
            step="0.1"
            disabled={isLocked}
            className={`${inputClass} disabled:bg-neutral-100 disabled:text-tertiary`}
            value={values.capex}
            onChange={(e) => set("capex", num(e.target.value))}
          />
        </Field>
        <Field label="OPEX one-off">
          <input
            type="number"
            step="0.1"
            disabled={isLocked}
            className={`${inputClass} disabled:bg-neutral-100 disabled:text-tertiary`}
            value={values.opexOneOff}
            onChange={(e) => set("opexOneOff", num(e.target.value))}
          />
        </Field>
        <Field label="OPEX récurrent /an">
          <input
            type="number"
            step="0.1"
            disabled={isLocked}
            className={`${inputClass} disabled:bg-neutral-100 disabled:text-tertiary`}
            value={values.opexRec}
            onChange={(e) => set("opexRec", num(e.target.value))}
          />
        </Field>
      </div>

      <SectionTitle>Impact RH</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
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
      </div>

      <SectionTitle>Description</SectionTitle>
      <textarea
        rows={3}
        className={inputClass}
        value={values.description}
        onChange={(e) => set("description", e.target.value)}
      />

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
