"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { subscribeCompanies } from "@/lib/firestore/admin";
import {
  computeMovementFinancials,
  getSocialChargesRate,
  tenureYears,
  type MovementFinancials,
} from "@/lib/hrFinancials";
import { fmtCurr } from "@/lib/engine";
import type {
  BeTrackData,
  Company,
  MovementStatus,
  MovementType,
  SocialScheme,
  WorkforceMovement,
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

export type MovementFormValues = Omit<WorkforceMovement, "id">;

const TYPES: MovementType[] = [
  "Recrutement",
  "Attrition",
  "Départ forcé",
  "Transfert entrant",
  "Transfert sortant",
];
const STATUSES: MovementStatus[] = ["Réalisé", "Planifié", "À faire", "Abandonné"];
const TRANSFER_TYPES: MovementType[] = ["Transfert entrant", "Transfert sortant"];
const TENURE_TYPES: MovementType[] = ["Départ forcé", "Attrition"];
const PSE_TYPES: MovementType[] = ["Départ forcé"];
const SOCIAL_SCHEMES: SocialScheme[] = ["PSE", "RC", "RCC", "PDV", "Autre"];
const DEFAULT_RECRUITMENT_SALARY = 45_000;

/** Formulaire de création/édition d'un mouvement RH — rattache un employé (ou un poste à
 * recruter) à un levier de transformation. Le choix d'un employé préremplit département, pays,
 * ETP, RH local ; un Recrutement se saisit sans employé existant (salaire de référence saisi
 * manuellement). L'impact EUR (salaryImpact/savings/cost) est calculé automatiquement à partir
 * du mécanisme (voir lib/hrFinancials.ts — salaire chargé + coûts sociaux dépendants du type),
 * puis reste librement modifiable dans les champs ci-dessous (valeur par défaut calculée, pas
 * imposée). */
export function MovementForm({
  data,
  companyId,
  initialValues,
  onSubmit,
  onCancel,
  submitLabel = "Créer le mouvement",
}: {
  data: BeTrackData;
  /** Entreprise courante — utilisée pour résoudre Company.socialChargesRate (taux de charges
   *  patronales). Omis/absent = taux par défaut (voir DEFAULT_SOCIAL_CHARGES_RATE). */
  companyId?: string | null;
  initialValues?: Partial<MovementFormValues>;
  onSubmit: (values: MovementFormValues) => void;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const employees = data.workforce.employees;
  const departments = data.workforce.departments;
  const firstEmployee = employees[0];
  const firstLever = data.levers[0];

  const [company, setCompany] = useState<Company | null>(null);
  useEffect(() => {
    if (!companyId) {
      setCompany(null);
      return;
    }
    return subscribeCompanies((companies) => {
      setCompany(companies.find((c) => c.id === companyId) ?? null);
    });
  }, [companyId]);
  const chargesRate = getSocialChargesRate(company);

  const [values, setValues] = useState<MovementFormValues>({
    empId: firstEmployee?.id ?? null,
    label: firstEmployee?.name ?? "",
    leverId: firstLever?.id ?? "",
    workstream: firstLever?.ws,
    function: firstLever?.function,
    programId: firstLever?.programId,
    type: "Transfert entrant",
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
    socialScheme: undefined,
    salaryImpact: 0,
    savings: 0,
    cost: 0,
    ...initialValues,
  });

  // Salaire brut annuel de référence pour un Recrutement (pas d'Employee existant) — s'il s'agit
  // d'un mouvement existant déjà chiffré, on retrouve un salaire de référence approximatif en
  // inversant le calcul du salaire chargé (salaryImpact = +loadedSalary pour un Recrutement).
  const [manualGrossSalary, setManualGrossSalary] = useState<number>(() => {
    if (initialValues?.type === "Recrutement" && initialValues.salaryImpact) {
      return Math.round(initialValues.salaryImpact / (1 + chargesRate));
    }
    return DEFAULT_RECRUITMENT_SALARY;
  });

  const set = <K extends keyof MovementFormValues>(key: K, value: MovementFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const isRecruitment = values.type === "Recrutement";
  const isTransfer = TRANSFER_TYPES.includes(values.type);
  const currentEmployee = employees.find((e) => e.id === values.empId);
  const refDate = values.actualDate ?? values.plannedDate;
  const tenure = tenureYears(currentEmployee?.hireDate, refDate);
  const grossSalary = isRecruitment ? manualGrossSalary : (currentEmployee?.salary ?? 0);

  /** Aperçu live du calcul mécanisme-dépendant, à partir de la sélection courante — sert à la
   *  fois pour le préremplissage auto et pour le panneau de synthèse affiché sous le formulaire
   *  (qui peut donc différer des valeurs finalement saisies si l'utilisateur les a surchargées). */
  const financials: MovementFinancials = useMemo(
    () =>
      computeMovementFinancials({
        type: values.type,
        grossSalary,
        chargesRate,
        tenure,
        inPSE: values.inPSE,
        requiresRetraining: values.requiresRetraining,
      }),
    [values.type, grossSalary, chargesRate, tenure, values.inPSE, values.requiresRetraining]
  );

  const applyFinancials = (fin: MovementFinancials) => {
    setValues((prev) => ({
      ...prev,
      salaryImpact: fin.salaryImpact,
      savings: fin.salarySavings,
      cost: fin.socialCost,
    }));
  };

  // Préremplissage initial pour un NOUVEAU mouvement (pas de valeurs à éditer) : dès que le taux
  // de charges de l'entreprise est résolu (abonnement Firestore asynchrone), on applique une
  // première fois le calcul mécanisme-dépendant plutôt que de laisser salaryImpact/savings/cost
  // à 0 tant que l'utilisateur n'a pas changé le type ou l'employé. Une seule fois — l'utilisateur
  // reste ensuite libre de modifier ces champs.
  useEffect(() => {
    if (initialValues) return; // édition d'un mouvement existant : ne jamais écraser
    applyFinancials(
      computeMovementFinancials({
        type: values.type,
        grossSalary,
        chargesRate,
        tenure,
        inPSE: values.inPSE,
        requiresRetraining: values.requiresRetraining,
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargesRate]);

  const applyEmployee = (empId: string) => {
    const emp = employees.find((e) => e.id === empId);
    if (!emp) return;
    const nextTenure = tenureYears(emp.hireDate, refDate);
    const fin = computeMovementFinancials({
      type: values.type,
      grossSalary: emp.salary,
      chargesRate,
      tenure: nextTenure,
      inPSE: values.inPSE,
      requiresRetraining: values.requiresRetraining,
    });
    setValues((prev) => ({
      ...prev,
      empId: emp.id,
      label: emp.name,
      fte: emp.fte,
      department: emp.department,
      country: emp.country,
      hrOwner: emp.hrOwner,
      salaryImpact: fin.salaryImpact,
      savings: fin.salarySavings,
      cost: fin.socialCost,
    }));
  };

  const applyType = (type: MovementType) => {
    const emp = employees.find((e) => e.id === values.empId);
    const nextGrossSalary = type === "Recrutement" ? manualGrossSalary : (emp?.salary ?? 0);
    const nextTenure = TENURE_TYPES.includes(type) ? tenureYears(emp?.hireDate, refDate) : 0;
    const inPSE = PSE_TYPES.includes(type) ? (values.inPSE ?? false) : false;
    const socialScheme = PSE_TYPES.includes(type)
      ? (values.socialScheme ?? (inPSE ? "PSE" : undefined))
      : undefined;
    const requiresRetraining = TRANSFER_TYPES.includes(type)
      ? (values.requiresRetraining ?? false)
      : undefined;
    const fin = computeMovementFinancials({
      type,
      grossSalary: nextGrossSalary,
      chargesRate,
      tenure: nextTenure,
      inPSE,
      requiresRetraining,
    });
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
      inPSE,
      socialScheme,
      requiresRetraining,
      salaryImpact: fin.salaryImpact,
      savings: fin.salarySavings,
      cost: fin.socialCost,
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
            onChange={(e) => {
              const lever = data.levers.find((item) => item.id === e.target.value);
              setValues((prev) => ({
                ...prev,
                leverId: e.target.value,
                workstream: lever?.ws,
                function: lever?.function,
                programId: lever?.programId,
              }));
            }}
          >
            {data.levers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} — {l.name}
              </option>
            ))}
          </select>
        </Field>

        {isRecruitment ? (
          <div className="col-span-2 grid grid-cols-2 gap-3">
            <Field label="Intitulé du poste à recruter">
              <input
                required
                className={inputClass}
                value={values.label}
                onChange={(e) => set("label", e.target.value)}
                placeholder="ex. Data Engineer (poste créé)"
              />
            </Field>
            <Field label="Salaire brut annuel de référence (€)">
              <input
                type="number"
                step="1000"
                min="0"
                className={inputClass}
                value={manualGrossSalary}
                onChange={(e) => {
                  const next = Number(e.target.value) || 0;
                  setManualGrossSalary(next);
                  applyFinancials(
                    computeMovementFinancials({
                      type: values.type,
                      grossSalary: next,
                      chargesRate,
                      tenure: 0,
                      inPSE: false,
                    })
                  );
                }}
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
            onChange={(e) => {
              const status = e.target.value as MovementStatus;
              setValues((prev) => ({
                ...prev,
                status,
                actualDate: status === "Réalisé" ? (prev.actualDate ?? today) : null,
                hrValidated: status === "Réalisé" ? prev.hrValidated : false,
              }));
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        {PSE_TYPES.includes(values.type) ? (
          <Field label="Dispositif social">
            <select
              className={inputClass}
              value={values.socialScheme ?? ""}
              onChange={(e) => {
                const socialScheme = (e.target.value || undefined) as SocialScheme | undefined;
                const inPSE = socialScheme === "PSE";
                setValues((prev) => ({ ...prev, socialScheme, inPSE }));
                applyFinancials(
                  computeMovementFinancials({
                    type: values.type,
                    grossSalary,
                    chargesRate,
                    tenure,
                    inPSE,
                    requiresRetraining: values.requiresRetraining,
                  })
                );
              }}
            >
              <option value="">— choisir —</option>
              {SOCIAL_SCHEMES.map((scheme) => (
                <option key={scheme} value={scheme}>
                  {scheme}
                </option>
              ))}
            </select>
          </Field>
        ) : isTransfer ? (
          <label className="flex items-end gap-2 pb-1.5">
            <input
              type="checkbox"
              checked={values.requiresRetraining ?? false}
              onChange={(e) => {
                const requiresRetraining = e.target.checked;
                set("requiresRetraining", requiresRetraining);
                applyFinancials(
                  computeMovementFinancials({
                    type: values.type,
                    grossSalary,
                    chargesRate,
                    tenure,
                    inPSE: values.inPSE,
                    requiresRetraining,
                  })
                );
              }}
              className="accent-[#0F172A]"
            />
            <span className="text-xs font-medium text-primary">
              Nécessite une reconversion (formation lourde)
            </span>
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
        <Field label="Coût social one-off (€ — indemnités, formation, recrutement…)">
          <input
            type="number"
            step="1000"
            className={inputClass}
            value={values.cost}
            onChange={(e) => set("cost", Number(e.target.value) || 0)}
          />
        </Field>

        <div className="col-span-2 rounded-md border border-border bg-neutral-50 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
              Suggestion calculée selon le mécanisme « {values.type} »
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyFinancials(financials)}
            >
              <RefreshCw size={12} /> Appliquer
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px]">
            <div className="flex items-center justify-between">
              <dt className="text-secondary">Salaire chargé annuel</dt>
              <dd className="font-semibold text-primary">
                {fmtCurr(financials.loadedSalary / 1_000_000)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-secondary">
                {financials.salarySavings > 0
                  ? "Économie salaire chargé"
                  : "Impact masse salariale"}
              </dt>
              <dd className="font-semibold text-rag-green-dark">
                {financials.salarySavings > 0
                  ? fmtCurr(financials.salarySavings / 1_000_000)
                  : fmtCurr(financials.salaryImpact / 1_000_000)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-secondary">Coûts sociaux associés</dt>
              <dd className="font-semibold text-rag-amber">
                {fmtCurr(financials.socialCost / 1_000_000)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-secondary">Impact net 1ère année</dt>
              <dd className="font-semibold text-primary">
                {fmtCurr(financials.netFirstYearImpact / 1_000_000)}
              </dd>
            </div>
          </dl>
          <p className="mt-1.5 text-[10px] text-tertiary">
            Taux de charges patronales appliqué : {Math.round(chargesRate * 100)}%
            {isRecruitment ? " · salaire brut de référence saisi ci-dessus" : ""} — valeur par
            défaut estimée, les champs ci-dessus restent modifiables librement.
          </p>
        </div>

        <div className="col-span-2">
          <Field label="Commentaire">
            <textarea
              rows={3}
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
