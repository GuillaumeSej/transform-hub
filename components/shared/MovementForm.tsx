"use client";

import { DateInput } from "@/components/shared/DateInput";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { movementStatusLabel, movementTypeLabel } from "@/lib/hrMovementLabels";
import {
  computeMovementFinancials,
  tenureYears,
  type MovementFinancials,
} from "@/lib/hrFinancials";
import { fmtCurr } from "@/lib/engine";
import { effectiveLeafLevel, selectableLeafNodes } from "@/lib/hierarchyLogic";
import { subscribeCompanies, subscribeHierarchyNodes } from "@/lib/firestore/admin";
import { hrToday, knownDepartments } from "@/lib/hrEngine";
import type {
  BeTrackData,
  HierarchyLevelDef,
  HierarchyNode,
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
  submitLabel,
}: {
  data: BeTrackData;
  /** Entreprise courante — si elle a configuré `geographyHierarchyLevels`/`hierarchyLevels`, un
   *  sélecteur optionnel de rattachement (maille la plus fine) est proposé en plus des champs
   *  historiques (`country`, etc.), même mécanique que `LeverForm.tsx`. Omis/absent = aucun
   *  sélecteur affiché (comportement historique inchangé). */
  companyId?: string | null;
  initialValues?: Partial<MovementFormValues>;
  onSubmit: (values: MovementFormValues) => void;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const { t: translate } = useTranslation();
  const resolvedSubmitLabel =
    submitLabel ?? translate("etp.form.createMovement", "Créer le mouvement");
  // Date locale réelle (B1) — `toISOString()` basculait au jour voisin autour de minuit.
  const today = hrToday();
  const employees = data.workforce.employees;
  // Liste de pays dérivée des employés existants plutôt qu'une liste figée — sinon un pays hors de
  // cette liste (entreprise opérant ailleurs qu'en France/Allemagne/Espagne/Italie/UK/USA) était
  // impossible à sélectionner pour un Recrutement.
  const countryOptions = useMemo(
    () =>
      Array.from(new Set(employees.map((e) => e.country)))
        .filter((c): c is string => !!c)
        .sort(),
    [employees]
  );
  // Référentiel des départements : baseline explicite + départements des employés + ceux déjà
  // cités par les mouvements (B2) — une entreprise sans méta workforce n'avait AUCUNE option.
  const departments = useMemo(
    () => knownDepartments(data.workforce).map((name) => ({ name })),
    [data.workforce]
  );
  const firstEmployee = employees[0];
  const firstLever = data.levers[0];

  // ─── Rattachement hiérarchique optionnel (géographie prioritaire, finance en bonus) ──────────
  // Même mécanique que `LeverForm.tsx` : un sélecteur de maille la plus fine par domaine, affiché
  // uniquement si l'entreprise a explicitement configuré ce domaine (sinon rien ne change pour les
  // entreprises sans arborescence — voir `Company.hierarchyLevels`/`geographyHierarchyLevels`).
  const [geographyLevels, setGeographyLevels] = useState<HierarchyLevelDef[]>([]);
  const [geographyNodes, setGeographyNodes] = useState<HierarchyNode[]>([]);
  const [hierarchyLevels, setHierarchyLevels] = useState<HierarchyLevelDef[]>([]);
  const [hierarchyNodes, setHierarchyNodes] = useState<HierarchyNode[]>([]);
  useEffect(() => {
    if (!companyId) {
      setGeographyLevels([]);
      setGeographyNodes([]);
      setHierarchyLevels([]);
      setHierarchyNodes([]);
      return;
    }
    let cancelled = false;
    let unsubGeoNodes: (() => void) | null = null;
    let unsubHierarchyNodes: (() => void) | null = null;
    const unsubCompanies = subscribeCompanies((companies) => {
      if (cancelled) return;
      const company = companies.find((c) => c.id === companyId);
      const geoLevels = company?.geographyHierarchyLevels ?? [];
      const levels = company?.hierarchyLevels ?? [];
      setGeographyLevels(geoLevels);
      setHierarchyLevels(levels);
      unsubGeoNodes?.();
      unsubHierarchyNodes?.();
      unsubGeoNodes = null;
      unsubHierarchyNodes = null;
      if (geoLevels.length === 0) {
        setGeographyNodes([]);
      } else {
        unsubGeoNodes = subscribeHierarchyNodes(
          companyId,
          (nodes) => {
            if (cancelled) return;
            setGeographyNodes(nodes);
          },
          "geographic"
        );
      }
      if (levels.length === 0) {
        setHierarchyNodes([]);
      } else {
        unsubHierarchyNodes = subscribeHierarchyNodes(
          companyId,
          (nodes) => {
            if (cancelled) return;
            setHierarchyNodes(nodes);
          },
          "financial"
        );
      }
    }, companyId);
    return () => {
      cancelled = true;
      unsubGeoNodes?.();
      unsubHierarchyNodes?.();
      unsubCompanies();
    };
  }, [companyId]);

  const sortedGeographyLevels = [...geographyLevels].sort((a, b) => a.order - b.order);
  const finestGeographyLevel = sortedGeographyLevels[sortedGeographyLevels.length - 1];
  const geographyLeafNodes = finestGeographyLevel
    ? geographyNodes.filter((n) => n.levelKey === finestGeographyLevel.key)
    : [];
  const hasGeographyHierarchy = geographyLeafNodes.length > 0;

  const finestHierarchyLevel = effectiveLeafLevel(hierarchyLevels);
  const hierarchyLeafNodes = selectableLeafNodes(hierarchyNodes, hierarchyLevels);
  const hasHierarchy = hierarchyLeafNodes.length > 0;

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
    country: firstEmployee?.country ?? countryOptions[0] ?? "",
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
  // Erreur de validation affichée sous le formulaire (département d'arrivée d'un transfert).
  const [formError, setFormError] = useState<string | null>(null);

  // Salaire chargé annuel de référence pour un Recrutement (pas d'Employee existant) — s'il
  // s'agit d'un mouvement existant déjà chiffré, salaryImpact = +loadedSalary pour un
  // Recrutement, donc c'est directement le salaire de référence (plus de charges à retirer).
  const [manualGrossSalary, setManualGrossSalary] = useState<number>(() => {
    if (initialValues?.type === "Recrutement" && initialValues.salaryImpact) {
      return Math.round(initialValues.salaryImpact);
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
        tenure,
        inPSE: values.inPSE,
        requiresRetraining: values.requiresRetraining,
      }),
    [values.type, grossSalary, tenure, values.inPSE, values.requiresRetraining]
  );

  const applyFinancials = (fin: MovementFinancials) => {
    setValues((prev) => ({
      ...prev,
      salaryImpact: fin.salaryImpact,
      savings: fin.salarySavings,
      cost: fin.socialCost,
    }));
  };

  // Préremplissage initial pour un NOUVEAU mouvement (pas de valeurs à éditer) : applique une
  // première fois le calcul mécanisme-dépendant plutôt que de laisser salaryImpact/savings/cost
  // à 0 tant que l'utilisateur n'a pas changé le type ou l'employé. Une seule fois au montage —
  // l'utilisateur reste ensuite libre de modifier ces champs.
  useEffect(() => {
    if (initialValues) return; // édition d'un mouvement existant : ne jamais écraser
    applyFinancials(financials);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyEmployee = (empId: string) => {
    const emp = employees.find((e) => e.id === empId);
    if (!emp) return;
    const nextTenure = tenureYears(emp.hireDate, refDate);
    const fin = computeMovementFinancials({
      type: values.type,
      grossSalary: emp.salary,
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
        // Un transfert sans département d'arrivée changeait de sens selon la vue (M11) : la
        // destination est désormais obligatoire et distincte du département de départ.
        if (
          TRANSFER_TYPES.includes(values.type) &&
          (!values.toDepartment || values.toDepartment === values.department)
        ) {
          setFormError(
            translate(
              "shared.movementForm.destinationRequired",
              "Un transfert nécessite un département d'arrivée différent du département de départ."
            )
          );
          return;
        }
        setFormError(null);
        onSubmit(values);
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={translate("shared.movementForm.movementType", "Type de mouvement")}>
          <select
            className={inputClass}
            value={values.type}
            onChange={(e) => applyType(e.target.value as MovementType)}
          >
            {TYPES.map((movementType) => (
              <option key={movementType} value={movementType}>
                {movementTypeLabel(translate, movementType)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={translate("shared.movementForm.linkedLever", "Levier rattaché")}>
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
            <Field
              label={translate("shared.movementForm.roleTitle", "Intitulé du poste à recruter")}
            >
              <input
                required
                className={inputClass}
                value={values.label}
                onChange={(e) => set("label", e.target.value)}
                placeholder={translate(
                  "shared.movementForm.roleTitlePlaceholder",
                  "ex. Data Engineer (poste créé)"
                )}
              />
            </Field>
            <Field
              label={translate(
                "shared.movementForm.refGrossSalary",
                "Salaire chargé annuel de référence (€)"
              )}
            >
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
            <Field label={translate("shared.movementForm.employee", "Employé")}>
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

        <Field
          label={
            isRecruitment
              ? translate("shared.movementForm.hostDepartment", "Département d'accueil")
              : translate("hr.department", "Département")
          }
        >
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
          <Field
            label={translate("shared.movementForm.destinationDepartment", "Département d'arrivée")}
          >
            <select
              required
              className={inputClass}
              value={values.toDepartment ?? ""}
              onChange={(e) => {
                setFormError(null);
                set("toDepartment", e.target.value || undefined);
              }}
            >
              <option value="">
                {translate("shared.movementForm.choosePlaceholder", "— choisir —")}
              </option>
              {departments
                .filter((d) => d.name !== values.department)
                .map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
            </select>
          </Field>
        ) : (
          <Field label={translate("leverForm.country", "Pays")}>
            <select
              className={inputClass}
              value={values.country}
              onChange={(e) => set("country", e.target.value)}
            >
              {countryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        )}

        {/* Rattachement géographique optionnel (maille la plus fine configurée) — n'apparaît que
         *  si l'entreprise a une arborescence géographique, en complément du champ `country` texte
         *  ci-dessus (jamais en remplacement, pour ne rien casser côté entreprises sans arborescence). */}
        {hasGeographyHierarchy && (
          <Field
            label={translate(
              "shared.movementForm.geographyLeaf",
              "{level} (arborescence géo)"
            ).replace("{level}", finestGeographyLevel.label)}
          >
            <select
              className={inputClass}
              value={values.geographyLeafId ?? ""}
              onChange={(e) => set("geographyLeafId", e.target.value || undefined)}
            >
              <option value="">
                {translate("shared.movementForm.choosePlaceholder", "— choisir —")}
              </option>
              {geographyLeafNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label} ({n.code})
                </option>
              ))}
            </select>
          </Field>
        )}
        {/* Rattachement financier optionnel (bonus) — même principe que ci-dessus, domaine
         *  "financial" (centre de coût / P&L) au lieu de "geographic". */}
        {hasHierarchy && (
          <Field
            label={translate(
              "shared.movementForm.hierarchyLeaf",
              "{level} (arborescence financière)"
            ).replace("{level}", finestHierarchyLevel?.label ?? "")}
          >
            <select
              className={inputClass}
              value={values.hierarchyLeafId ?? ""}
              onChange={(e) => set("hierarchyLeafId", e.target.value || undefined)}
            >
              <option value="">
                {translate("shared.movementForm.choosePlaceholder", "— choisir —")}
              </option>
              {hierarchyLeafNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label} ({n.code})
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label={translate("shared.movementForm.fteConcerned", "ETP concernés")}>
          <input
            type="number"
            step="0.1"
            min="0"
            className={inputClass}
            value={values.fte}
            onChange={(e) => set("fte", Number(e.target.value) || 0)}
          />
        </Field>
        <Field label={translate("shared.movementForm.hrOwnerResponsible", "RH local responsable")}>
          <input
            className={inputClass}
            value={values.hrOwner}
            onChange={(e) => set("hrOwner", e.target.value)}
          />
        </Field>

        <Field label={translate("shared.movementForm.plannedDate", "Date planifiée")}>
          <DateInput
            className={inputClass}
            value={values.plannedDate}
            onChange={(v) => set("plannedDate", v)}
          />
        </Field>
        <Field label={translate("shared.movementForm.actualDate", "Date réalisée")}>
          <DateInput
            className={inputClass}
            value={values.actualDate ?? ""}
            onChange={(v) => set("actualDate", v || null)}
          />
        </Field>
        <Field label={translate("hr.status", "Statut")}>
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
                {movementStatusLabel(translate, s)}
              </option>
            ))}
          </select>
        </Field>
        {PSE_TYPES.includes(values.type) ? (
          <Field label={translate("hr.column.socialScheme", "Dispositif social")}>
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
                    tenure,
                    inPSE,
                    requiresRetraining: values.requiresRetraining,
                  })
                );
              }}
            >
              <option value="">
                {translate("shared.movementForm.choosePlaceholder", "— choisir —")}
              </option>
              {SOCIAL_SCHEMES.map((scheme) => (
                <option key={scheme} value={scheme}>
                  {scheme === "Autre"
                    ? translate("shared.movementForm.schemeOther", "Autre")
                    : scheme}
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
                    tenure,
                    inPSE: values.inPSE,
                    requiresRetraining,
                  })
                );
              }}
              className="accent-[#0F172A]"
            />
            <span className="text-xs font-medium text-primary">
              {translate(
                "shared.movementForm.requiresRetraining",
                "Nécessite une reconversion (formation lourde)"
              )}
            </span>
          </label>
        ) : (
          <div />
        )}

        <Field
          label={translate(
            "shared.movementForm.salaryImpactField",
            "Impact masse salariale (€/an, − = économie)"
          )}
        >
          <input
            type="number"
            step="1000"
            className={inputClass}
            value={values.salaryImpact}
            onChange={(e) => set("salaryImpact", Number(e.target.value) || 0)}
          />
        </Field>
        <Field
          label={translate(
            "shared.movementForm.socialCostField",
            "Coût social one-off (€ — indemnités, formation, recrutement…)"
          )}
        >
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
              {translate(
                "shared.movementForm.suggestionMechanism",
                "Suggestion calculée selon le mécanisme « {type} »"
              ).replace("{type}", movementTypeLabel(translate, values.type))}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyFinancials(financials)}
            >
              <RefreshCw size={12} /> {translate("shared.movementForm.apply", "Appliquer")}
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px]">
            <div className="flex items-center justify-between">
              <dt className="text-secondary">
                {translate("shared.movementForm.annualLoadedSalary", "Salaire chargé annuel")}
              </dt>
              <dd className="font-semibold text-primary">
                {fmtCurr(financials.loadedSalary / 1_000_000)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-secondary">
                {financials.salarySavings > 0
                  ? translate("etp.column.savingsLoaded", "Économie salaire chargé")
                  : translate("shared.movementForm.salaryImpactLabel", "Impact masse salariale")}
              </dt>
              <dd className="font-semibold text-rag-green-dark">
                {financials.salarySavings > 0
                  ? fmtCurr(financials.salarySavings / 1_000_000)
                  : fmtCurr(financials.salaryImpact / 1_000_000)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-secondary">
                {translate("etp.column.socialCosts", "Coûts sociaux associés")}
              </dt>
              <dd className="font-semibold text-rag-amber">
                {fmtCurr(financials.socialCost / 1_000_000)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-secondary">
                {translate("etp.column.netImpactY1", "Impact net 1ère année")}
              </dt>
              <dd className="font-semibold text-primary">
                {fmtCurr(financials.netFirstYearImpact / 1_000_000)}
              </dd>
            </div>
          </dl>
          <p className="mt-1.5 text-[10px] text-tertiary">
            {isRecruitment
              ? translate(
                  "shared.movementForm.recruitmentGrossSalaryNote",
                  "Salaire chargé de référence saisi ci-dessus"
                )
              : translate(
                  "shared.movementForm.loadedSalaryNote",
                  "Salaire chargé de l'employé sélectionné"
                )}{" "}
            {translate(
              "shared.movementForm.defaultValueNote",
              "— valeur par défaut estimée, les champs ci-dessus restent modifiables librement."
            )}
          </p>
        </div>

        <div className="col-span-2">
          <Field label={translate("hr.column.comment", "Commentaire")}>
            <textarea
              rows={3}
              className={inputClass}
              value={values.comment ?? ""}
              onChange={(e) => set("comment", e.target.value || undefined)}
            />
          </Field>
        </div>
      </div>

      {formError && (
        <p role="alert" className="mt-4 text-[12px] font-semibold text-rag-red">
          {formError}
        </p>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {translate("common.cancel", "Annuler")}
        </Button>
        <Button type="submit" variant="primary">
          {resolvedSubmitLabel}
        </Button>
      </div>
    </form>
  );
}
