"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/shared/Button";
import { DateInput } from "@/components/shared/DateInput";
import { Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { STATUS_LABEL } from "@/lib/status-config";
import type { LifecycleLabels } from "@/lib/hooks/useLifecycleLabels";
import { riskLevelLabel } from "@/lib/leverRiskText";
import {
  subscribeCompanies,
  subscribeHierarchyNodes,
  subscribePrograms,
} from "@/lib/firestore/admin";
import type {
  RiskLevel,
  BeTrackData,
  HierarchyLevelDef,
  Company,
  HierarchyNode,
  Lever,
  LeverStatus,
  Program,
} from "@/types";
import { hierarchyPathValue, resolveHierarchyNodeChain } from "@/lib/hierarchyLogic";
import { ImpactsEditor } from "@/components/shared/ImpactsEditor";
import { ActionWeightsEditor } from "@/components/shared/ActionWeightsEditor";
import { getLeverTypes } from "@/lib/impactConfig";
import { weightsState } from "@/lib/actionWeights";
import { cleanImpacts } from "@/lib/impactKinds";
import { leverImpactTotals } from "@/lib/engine";
import { resolveProgramType } from "@/lib/axisLogic";
import { useCompanyUsers } from "@/lib/hooks/useCompanyUsers";
import { matchLeverOwner } from "@/lib/leverOwnerReconciliation";

/** Mêmes règles que `components/shared/Topbar.tsx`/`components/strategic/RaciChips.tsx` (2
 *  initiales max, majuscules) — pas de helper partagé exporté par ces composants d'affichage, on
 *  réplique ici pour dériver `ownerInit` depuis le nom du compte sélectionné. */
export function initialsFromName(name: string): string {
  return name
    .split(" ")
    .map((x) => x[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export type LeverFormValues = Omit<Lever, "id" | "createdAt" | "lastUpdate" | "dependencies">;

const inputClass =
  "w-full rounded-sm border border-border px-2.5 py-1.5 text-xs focus:border-black focus:outline-none";
const labelClass = "mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-tertiary";

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  /** Message d'erreur affiché sous le champ (champ obligatoire manquant, date incohérente). */
  error?: string;
  /** Affiche un astérisque après le libellé — réservé aux champs réellement bloquants à la
   *  soumission (voir la validation dans le `onSubmit` du formulaire ci-dessous : code, nom,
   *  programme), pas à tout champ qui a simplement une valeur par défaut non vide. */
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className={labelClass}>
        {label}
        {required && <span className="text-bp-coral"> *</span>}
      </span>
      {children}
      {error && <span className="mt-0.5 block text-[10.5px] text-bp-coral">{error}</span>}
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
  const defaultPnl = data.pnlAccounts.find(
    (account) => account.selectable !== false && !account.computed
  );
  return {
    code: "",
    // Vide au départ, jamais soumissible tel quel : `programId` est OBLIGATOIRE (voir types/index.ts
    // — un levier ne peut plus exister sans programme depuis le round "programId requis"). Le champ
    // ci-dessous est renseigné dès que la liste des programmes Plan Performance de l'entreprise est
    // connue (voir l'effet plus bas), avant que l'utilisateur n'ait la main.
    programId: "",
    type: "",
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
    pnlMap: defaultPnl?.id ?? "",
    start: new Date().toISOString().slice(0, 10),
    end: new Date().toISOString().slice(0, 10),
    status: "idea",
    progress: 0,
    risk: "low",
    grossSavings: 0,
    netSavings: 0,
    opexOneOff: 0,
    opexRec: 0,
    capex: 0,
    fteImpact: 0,
    popImpacted: "",
    description: "",
  };
}

/** Formulaire complet des paramètres d'un levier — réutilisé pour la création et l'édition. */
export function LeverForm({
  data,
  lifecycle,
  companyId,
  initialValues,
  onSubmit,
  onCancel,
  submitLabel,
  canEditWorkstreamWeight = false,
  computedRisk,
  onDelete,
}: {
  data: BeTrackData;
  /** Résolution des libellés de statut selon le référentiel de l'entreprise (facultatif, retombe
   * sur STATUS_LABEL si absent). */
  lifecycle?: LifecycleLabels;
  /** Entreprise courante — si elle a configuré `hierarchyLevels`, le champ "Centre de coût" texte
   *  libre est remplacé par un select des HierarchyNode de maille la plus fine. Omis/absent =
   *  comportement historique inchangé (champ texte libre). */
  companyId?: string | null;
  initialValues?: Partial<LeverFormValues>;
  /** Peut être asynchrone : le bouton de validation reste désactivé tant que la promesse n'est
   *  pas résolue (évite les doubles soumissions pendant l'écriture Firestore). */
  onSubmit: (values: LeverFormValues) => void | Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  /** Round <n> (fondations RBAC déclaratives) — `Lever.workstreamWeightPct` (poids du levier dans
   *  l'avancement déclaratif de son workstream, voir `lib/workstreamLogic.ts`) n'est éditable que
   *  par le pilote du workstream. Aucun rôle "pilote de workstream" explicite n'existe dans le
   *  RBAC actuel (`lib/roleProfiles.ts`/`useRole`) : l'appelant calcule ce booléen avec le contrôle
   *  le plus proche disponible (même check que l'édition du levier lui-même, potentiellement
   *  affiné avec `Workstream.sponsorUsername` — voir les call sites). Défaut `false` : le champ
   *  reste caché (comportement historique inchangé) tant que l'appelant ne l'autorise pas
   *  explicitement, y compris à la création (où le pilote du workstream n'a pas encore de raison
   *  d'intervenir — le champ se règle ensuite depuis la fiche détail). */
  canEditWorkstreamWeight?: boolean;
  /** Risque CALCULÉ du levier (alertes ouvertes, `engine.computeLeverRisk`), affiché en lecture
   *  seule — le champ stocké `Lever.risk`, figé à l'import, n'est plus montré (audit LEV-13).
   *  Absent (création) : le champ n'est pas affiché. */
  computedRisk?: RiskLevel;
  /** Édition uniquement : affiche « Supprimer le levier » en pied de formulaire (CTO /
   *  responsable de chantier, voir LeverDeletionDialog). */
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  // Création = pas d'id dans les valeurs initiales (l'édition reçoit le levier complet).
  const isCreate = !(initialValues as Lever | undefined)?.id;
  // Un levier naît TOUJOURS au premier jalon du cycle de vie : pas de choix de maturité à la
  // création (le passage aux jalons suivants passe par les portes de validation).
  const firstStage: LeverStatus = lifecycle?.activeCycle[0] ?? "idea";
  const [values, setValues] = useState<LeverFormValues>(() => ({
    ...emptyValues(data),
    // Création : chantier et fonction à choisir explicitement (champs obligatoires), pas de
    // pré-sélection silencieuse de la première valeur de la liste.
    ...(isCreate ? { ws: "", function: "", start: "", end: "", status: firstStage } : {}),
    ...initialValues,
  }));
  // Erreurs de validation affichées seulement après une première tentative d'enregistrement.
  const [showErrors, setShowErrors] = useState(false);

  // Comptes réels de l'entreprise, pour le sélecteur "Propriétaire" ci-dessous (round "ownership
  // réel" — voir doc-comment `Lever.ownerUsername`, types/index.ts). Un levier ne peut plus être
  // rattaché à du texte libre depuis ce formulaire, seulement à un compte de cette liste (ou
  // "Aucun").
  const companyUsers = useCompanyUsers(companyId);

  // Édition d'un levier LEGACY (jamais réconcilié, `ownerUsername` absent) dont l'`owner` texte
  // libre correspond à EXACTEMENT un compte réel : pré-sélectionne ce compte plutôt que "Aucun" —
  // simple confort UX (voir doc-comment "point 6" de `Lever.ownerUsername`), jamais imposé
  // silencieusement (l'utilisateur peut toujours changer/désélectionner avant d'enregistrer).
  useEffect(() => {
    if (values.ownerUsername || !values.owner || companyUsers.length === 0) return;
    const match = matchLeverOwner(
      values.owner,
      companyUsers.map((u) => ({ username: u.username, name: u.name }))
    );
    if (match.kind === "unique") {
      setValues((current) =>
        current.ownerUsername
          ? current
          : {
              ...current,
              ownerUsername: match.candidate.username,
              owner: match.candidate.name,
              ownerInit: initialsFromName(match.candidate.name),
            }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyUsers]);

  // Même convenance UX que ci-dessus, pour le sponsor legacy (texte libre) — `matchLeverOwner` est
  // générique (comparaison nom normalisé), pas spécifique au propriétaire.
  useEffect(() => {
    if (values.sponsorUsername || !values.sponsor || companyUsers.length === 0) return;
    const match = matchLeverOwner(
      values.sponsor,
      companyUsers.map((u) => ({ username: u.username, name: u.name }))
    );
    if (match.kind === "unique") {
      setValues((current) =>
        current.sponsorUsername
          ? current
          : {
              ...current,
              sponsorUsername: match.candidate.username,
              sponsor: match.candidate.name,
              sponsorInit: initialsFromName(match.candidate.name),
            }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyUsers]);

  // Round "rattachement financier par action" : le levier ne porte plus de sélecteur
  // hierarchyLeafId/pnlMap dérivé de l'arborescence financière — ce rattachement se fait
  // désormais par action/impact (voir `HierarchyLeafSelect` + `ActionForm.tsx`). `hierarchyLevels`
  // financiers et leurs nœuds ne sont donc plus chargés ici ; seule la hiérarchie GÉOGRAPHIQUE
  // reste gérée par ce formulaire (champ `geographyLeafId`, inchangé).
  const [geographyLevels, setGeographyLevels] = useState<HierarchyLevelDef[]>([]);
  const [geographyNodes, setGeographyNodes] = useState<HierarchyNode[]>([]);
  const [confidentialityLevels, setConfidentialityLevels] = useState<string[]>([]);
  const [company, setCompany] = useState<Company | null>(null);

  useEffect(() => {
    if (!companyId) {
      setGeographyLevels([]);
      setGeographyNodes([]);
      setConfidentialityLevels([]);
      setCompany(null);
      return;
    }
    let cancelled = false;
    let unsubGeoNodes: (() => void) | null = null;
    const unsubCompanies = subscribeCompanies((companies) => {
      if (cancelled) return;
      const company = companies.find((c) => c.id === companyId);
      const geoLevels = company?.geographyHierarchyLevels ?? [];
      setGeographyLevels(geoLevels);
      setConfidentialityLevels(company?.confidentialityLevels ?? []);
      setCompany(company ?? null);
      unsubGeoNodes?.();
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
    }, companyId);
    return () => {
      cancelled = true;
      unsubGeoNodes?.();
      unsubCompanies();
    };
  }, [companyId]);

  const hasGeographyHierarchy = geographyLevels.length > 0;

  const sortedGeographyLevels = [...geographyLevels].sort((a, b) => a.order - b.order);
  const geographyChain = resolveHierarchyNodeChain(
    values.geographyLeafId ?? "",
    geographyNodes,
    geographyLevels
  );
  const geographySelectionByLevel = new Map(geographyChain.map((n) => [n.levelKey, n.id]));

  /** Options d'un niveau géographique donné, filtrées aux enfants du niveau immédiatement plus
   *  macro déjà sélectionné (cascade) — vide tant que ce niveau parent n'est pas encore choisi,
   *  sauf pour le niveau racine (order le plus bas) qui liste tous ses nœuds. */
  const geographyOptionsForLevel = (level: HierarchyLevelDef): HierarchyNode[] => {
    const levelIndex = sortedGeographyLevels.findIndex((l) => l.key === level.key);
    const parentLevel = levelIndex > 0 ? sortedGeographyLevels[levelIndex - 1] : undefined;
    if (!parentLevel) {
      return geographyNodes
        .filter((n) => n.levelKey === level.key)
        .sort((a, b) => a.label.localeCompare(b.label, "fr"));
    }
    const parentId = geographySelectionByLevel.get(parentLevel.key);
    if (!parentId) return [];
    return geographyNodes
      .filter((n) => n.levelKey === level.key && n.parentId === parentId)
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  };

  const selectGeographyLeaf = (leafId: string) => {
    setValues((current) => {
      const next = { ...current };
      delete next.geographyLeafId;
      if (!leafId) return next;
      return {
        ...next,
        geographyLeafId: leafId,
        geography:
          hierarchyPathValue(leafId, "region", geographyNodes, geographyLevels) ??
          hierarchyPathValue(leafId, "continent", geographyNodes, geographyLevels) ??
          current.geography,
        country:
          hierarchyPathValue(leafId, "country", geographyNodes, geographyLevels) ?? current.country,
        entity:
          hierarchyPathValue(leafId, "legal_entity", geographyNodes, geographyLevels) ??
          current.entity,
      };
    });
  };

  const [allPrograms, setAllPrograms] = useState<Program[]>([]);
  useEffect(() => {
    if (!companyId) {
      setAllPrograms([]);
      return;
    }
    const unsub = subscribePrograms(
      (all) => setAllPrograms(all.filter((p) => p.companyId === companyId)),
      companyId
    );
    return unsub;
  }, [companyId]);
  // Un levier est une entité du Plan Performance : seuls les programmes de ce type sont des
  // rattachements valides (voir `resolveProgramType` — `type` absent = "performance" par défaut,
  // donc les programmes historiques sans `type` restent proposés).
  const projects = allPrograms.filter((p) => resolveProgramType(p) === "performance");

  // `programId` étant désormais obligatoire (voir types/index.ts), on le pré-remplit dès que la
  // liste des programmes Plan Performance est connue — sauf en édition d'un levier existant déjà
  // rattaché à un programme toujours valide (on ne force pas un changement silencieux). Si le
  // programme initial n'existe plus (supprimé depuis), on retombe sur le premier disponible plutôt
  // que de laisser un id fantôme dans le formulaire.
  useEffect(() => {
    if (projects.length === 0) return;
    setValues((current) => {
      if (current.programId && projects.some((p) => p.id === current.programId)) return current;
      return { ...current, programId: projects[0].id };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.map((p) => p.id).join(",")]);

  const set = <K extends keyof LeverFormValues>(key: K, value: LeverFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  // Dès que le levier a au moins une action chiffrée (impacts renseignés), le business case
  // initial saisi ci-dessous est mis de côté : `consolidateLeverFromActions` (appelé à chaque
  // création/édition d'action, voir `leversLogic.ts::recomputeLeverProgress`) recalcule alors
  // `grossSavings`/`netSavings`/`capex`/`opexOneOff`/`opexRec`/`fteImpact` depuis les lignes
  // d'impact des actions et écrase ces champs — ce formulaire ne doit donc plus les rendre
  // éditables à ce stade (ils redeviendraient faux dès la prochaine action modifiée), seulement
  // les afficher en lecture seule avec un message expliquant le bascule. Même logique que
  // `leverConsolidate.ts::hasActionImpacts`, dupliquée ici pour éviter de typer `values`
  // (`LeverFormValues`, un `Omit<Lever, ...>`) en `Lever` complet juste pour cet appel.
  const leverTypes = Array.from(
    new Set([
      ...(values.type ? [values.type] : []),
      ...getLeverTypes(company ?? { leverTypes: data.leverTypes }),
    ])
  );
  const impacts = values.impacts ?? [];
  const actionWeights = weightsState(values.actions ?? []);
  // Une fois le plan initial figé (passage à "validated"/L3, voir `leversLogic.ts::applyPlanLock`),
  // le business case initial ci-dessous n'est plus éditable manuellement — mêmes montants que le
  // snapshot `lockedPlan` (édition possible d'un tout nouveau levier uniquement).
  const isLocked = Boolean((initialValues as Lever | undefined)?.lockedPlan);

  // Maille géographique la plus fine : dernier niveau configuré (arborescence), sinon le champ
  // historique le plus fin disponible (entité > pays > région).
  const finestGeoLevel = sortedGeographyLevels[sortedGeographyLevels.length - 1];
  const legacyCountries = Array.from(
    new Set(data.levers.map((l) => l.country).filter((v): v is string => !!v))
  ).sort();
  const legacyEntities = Array.from(
    new Set(data.levers.map((l) => l.entity).filter((v): v is string => !!v))
  ).sort();
  const legacyFinestGeo: "entity" | "country" | "geography" =
    legacyEntities.length > 0 ? "entity" : legacyCountries.length > 0 ? "country" : "geography";
  const geographyFilled = hasGeographyHierarchy
    ? !!finestGeoLevel && geographySelectionByLevel.has(finestGeoLevel.key)
    : !!values[legacyFinestGeo];

  // Champs obligatoires (création) : code, nom, chantier, fonction, maille géographique la plus
  // fine, dates, responsable. En édition, seuls code/nom et la cohérence des dates sont bloquants
  // (leviers historiques parfois incomplets, à ne pas rendre impossibles à modifier).
  const requiredMsg = t("leverForm.requiredField", "Champ obligatoire");
  const errors: Partial<Record<string, string>> = {};
  if (!values.code.trim()) errors.code = requiredMsg;
  if (!values.name.trim()) errors.name = requiredMsg;
  if (isCreate) {
    if (!values.ws) errors.ws = requiredMsg;
    if (!values.function) errors.function = requiredMsg;
    if (!geographyFilled) errors.geography = requiredMsg;
    if (!values.start) errors.start = requiredMsg;
    if (!values.end) errors.end = requiredMsg;
    if (!values.ownerUsername) errors.owner = requiredMsg;
  }
  if (values.start && values.end && values.end < values.start) {
    errors.end = t(
      "leverForm.endBeforeStart",
      "La date de fin ne peut pas être antérieure à la date de début"
    );
  }
  const hasErrors = Object.keys(errors).length > 0;
  const err = (key: string) => (showErrors ? errors[key] : undefined);
  const errClass = (key: string) => (err(key) ? " border-bp-coral" : "");
  const req = isCreate;

  return (
    <form
      id="lever-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (hasErrors) {
          setShowErrors(true);
          return;
        }
        if (!values.programId) return;
        if (!actionWeights.valid) return;
        const cleaned = cleanImpacts(impacts);
        const next = { ...values, impacts: cleaned, type: values.type || leverTypes[0] || "" };
        if (isCreate) {
          next.status = firstStage;
          // Plus de champ « Commanditaire » à la création : on ne garde que le pré-remplissage
          // éventuel de l'appelant (responsable de chantier qui crée son propre levier).
          next.sponsor = initialValues?.sponsor ?? "";
          next.sponsorInit = initialValues?.sponsorInit ?? "";
          next.sponsorUsername = initialValues?.sponsorUsername;
        }
        if (cleaned.length > 0 && !isLocked) {
          const tot = leverImpactTotals(cleaned);
          next.grossSavings = tot.grossAnnual;
          next.netSavings = tot.netAnnual;
          next.capex = tot.capex;
          next.opexOneOff = tot.opexOneOff;
          next.opexRec = tot.opexRec;
          next.fteImpact = tot.fteNet;
        }
        if (submitting) return;
        setSubmitting(true);
        Promise.resolve(onSubmit(next))
          .catch(() => undefined)
          .finally(() => setSubmitting(false));
      }}
    >
      {isCreate && (
        <p className="mb-3 text-[11px] text-secondary">
          <span className="font-bold text-bp-coral">*</span>{" "}
          {t("leverForm.requiredLegend", "Champs obligatoires")}
        </p>
      )}
      {showErrors && hasErrors && (
        <p className="mb-3 rounded-sm border border-bp-coral/40 bg-bp-coral/5 px-2.5 py-2 text-[11px] font-medium text-bp-coral">
          {t(
            "leverForm.fixErrors",
            "Certains champs obligatoires sont manquants ou incorrects (en rouge ci-dessous)."
          )}
        </p>
      )}
      <SectionTitle>{t("leverForm.sectionIdentification")}</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        <Field label={t("leverForm.code")} required error={err("code")}>
          <input
            className={inputClass + errClass("code")}
            value={values.code}
            onChange={(e) => set("code", e.target.value)}
          />
        </Field>
        <Field label={t("leverForm.type")}>
          <select
            className={inputClass}
            value={values.type}
            onChange={(e) => set("type", e.target.value)}
          >
            {leverTypes.map((lt) => (
              <option key={lt} value={lt}>
                {lt}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("leverForm.workstream")} required={req} error={err("ws")}>
          <select
            className={inputClass + errClass("ws")}
            value={values.ws}
            onChange={(e) => set("ws", e.target.value)}
          >
            {(isCreate || !values.ws) && (
              <option value="">{t("leverForm.selectPlaceholder")}</option>
            )}
            {data.workstreams.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        {canEditWorkstreamWeight && (
          <Field
            label={t("leverForm.workstreamWeightPct", "Poids dans l'avancement du chantier (%)")}
          >
            <input
              className={inputClass}
              type="number"
              min={0}
              max={100}
              step={1}
              value={values.workstreamWeightPct ?? ""}
              onChange={(e) =>
                set(
                  "workstreamWeightPct",
                  e.target.value === "" ? undefined : Number(e.target.value)
                )
              }
              placeholder={t("leverForm.workstreamWeightPctPlaceholder", "Poids implicite")}
            />
          </Field>
        )}
        {projects.length > 0 ? (
          <Field label={t("leverForm.project")} required={projects.length > 1}>
            {projects.length > 1 ? (
              <select
                required
                className={inputClass}
                value={values.programId}
                onChange={(e) => set("programId", e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              // Un seul programme Performance : rien à choisir, on l'affiche en lecture seule
              // plutôt qu'un select à une unique option (même convention que LeversPagePerformance).
              <div className={`${inputClass} bg-neutral-50 text-secondary`}>{projects[0].name}</div>
            )}
          </Field>
        ) : (
          <div className="col-span-1 rounded-sm border border-bp-coral/40 bg-bp-coral/5 px-2.5 py-1.5 text-[11px] font-medium text-bp-coral sm:col-span-2 md:col-span-3">
            {t(
              "leverForm.noProgramBlocking",
              "Aucun programme Performance n'existe pour cette entreprise — un administrateur doit en créer un avant qu'un levier puisse être créé."
            )}
          </div>
        )}
        <div className="col-span-1 sm:col-span-2 md:col-span-3">
          <Field label={t("leverForm.name")} required error={err("name")}>
            <input
              className={inputClass + errClass("name")}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
        </div>
        {confidentialityLevels.length > 0 && (
          <div className="col-span-1 sm:col-span-2 md:col-span-3">
            <Field label={t("leverForm.confidentiality")}>
              <select
                className={inputClass}
                value={values.confidentialityLevel ?? ""}
                onChange={(e) => set("confidentialityLevel", e.target.value || undefined)}
              >
                <option value="">{t("leverForm.confidentialityNone")}</option>
                {confidentialityLevels.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </div>

      <SectionTitle>{t("leverForm.sectionOwnership")}</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <div className="col-span-1 sm:col-span-2">
          <Field label={t("leverForm.owner")} required={req} error={err("owner")}>
            {/* Round "ownership réel" (voir doc-comment `Lever.ownerUsername`, types/index.ts) :
             *  plus de texte libre — un levier ne peut être rattaché qu'à un compte réel de
             *  l'entreprise (ou explicitement à "Aucun"). Sélectionner un compte renseigne
             *  d'un coup `ownerUsername` (lien fiable) et `owner`/`ownerInit` (libellé d'affichage
             *  dénormalisé, voir `initialsFromName`). */}
            <select
              className={inputClass + errClass("owner")}
              value={values.ownerUsername ?? ""}
              onChange={(e) => {
                const username = e.target.value;
                if (!username) {
                  setValues((current) => ({
                    ...current,
                    ownerUsername: undefined,
                    owner: "",
                    ownerInit: "",
                  }));
                  return;
                }
                const selected = companyUsers.find((u) => u.username === username);
                if (!selected) return;
                setValues((current) => ({
                  ...current,
                  ownerUsername: selected.username,
                  owner: selected.name,
                  ownerInit: initialsFromName(selected.name),
                }));
              }}
            >
              <option value="">
                {isCreate ? t("leverForm.selectPlaceholder") : t("leverForm.ownerNone", "Aucun")}
              </option>
              {companyUsers
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((u) => (
                  <option key={u.username} value={u.username}>
                    {u.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Field label={t("leverForm.initials")}>
          <div className={`${inputClass} bg-neutral-100 text-tertiary`}>
            {values.ownerInit || "—"}
          </div>
        </Field>
        <div />
        {/* « Commanditaire » : absent du formulaire de CRÉATION (notion jugée inutile à la
            saisie) — conservé en édition pour les leviers qui en ont déjà un. */}
        {!isCreate && (
          <div className="col-span-1 sm:col-span-2">
            <Field label={t("leverForm.sponsor")}>
              {/* Même pattern que le sélecteur "Propriétaire" plus haut (round "ownership réel"
               *  étendu au sponsor) : plus de texte libre, un compte réel de l'entreprise ou
               *  "Aucun" — sert au scoping du rôle "sponsor" (voir Lever.sponsorUsername). */}
              <select
                className={inputClass}
                value={values.sponsorUsername ?? ""}
                onChange={(e) => {
                  const username = e.target.value;
                  if (!username) {
                    setValues((current) => ({
                      ...current,
                      sponsorUsername: undefined,
                      sponsor: "",
                      sponsorInit: "",
                    }));
                    return;
                  }
                  const selected = companyUsers.find((u) => u.username === username);
                  if (!selected) return;
                  setValues((current) => ({
                    ...current,
                    sponsorUsername: selected.username,
                    sponsor: selected.name,
                    sponsorInit: initialsFromName(selected.name),
                  }));
                }}
              >
                <option value="">{t("leverForm.ownerNone", "Aucun")}</option>
                {companyUsers
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((u) => (
                    <option key={u.username} value={u.username}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
        )}
        {!isCreate && (
          <Field label={t("leverForm.initials")}>
            <div className={`${inputClass} bg-neutral-100 text-tertiary`}>
              {values.sponsorInit || "—"}
            </div>
          </Field>
        )}
      </div>

      <SectionTitle>{t("leverForm.sectionLocation")}</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {/* Un sélecteur en cascade PAR NIVEAU configuré (région, pays, entité légale... — profondeur
         *  et libellés propres à l'entreprise, voir Company.geographyHierarchyLevels), plutôt qu'un
         *  unique menu "maille géographique configurée" qui affichait le chemin complet concaténé :
         *  ce dernier faisait doublon avec ces champs et n'avait aucune raison de rester si chaque
         *  niveau est déjà sélectionnable individuellement ci-dessous. Choisir un niveau filtre les
         *  options du niveau suivant (enfants du nœud choisi) et réinitialise les niveaux plus fins
         *  déjà sélectionnés (voir `selectGeographyLeaf`). Le nombre de champs affichés correspond
         *  toujours exactement au nombre de niveaux configurés, jamais un nombre fixe. */}
        {hasGeographyHierarchy ? (
          sortedGeographyLevels.map((level) => (
            <Field
              key={level.key}
              label={level.label}
              required={req && level.key === finestGeoLevel?.key}
              error={level.key === finestGeoLevel?.key ? err("geography") : undefined}
            >
              <select
                className={
                  inputClass + (level.key === finestGeoLevel?.key ? errClass("geography") : "")
                }
                value={geographySelectionByLevel.get(level.key) ?? ""}
                onChange={(e) => {
                  const nodeId = e.target.value;
                  if (nodeId) {
                    selectGeographyLeaf(nodeId);
                    return;
                  }
                  // Désélection : on remonte à la sélection du niveau parent (ou on efface tout
                  // si c'est le niveau le plus macro) plutôt que de laisser une sélection de
                  // niveau fin incohérente avec un niveau macro vidé.
                  const levelIndex = sortedGeographyLevels.findIndex((l) => l.key === level.key);
                  const parentLevel =
                    levelIndex > 0 ? sortedGeographyLevels[levelIndex - 1] : undefined;
                  const parentId = parentLevel
                    ? geographySelectionByLevel.get(parentLevel.key)
                    : undefined;
                  selectGeographyLeaf(parentId ?? "");
                }}
              >
                <option value="">{t("leverForm.selectPlaceholder")}</option>
                {geographyOptionsForLevel(level).map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.label} ({node.code})
                  </option>
                ))}
              </select>
            </Field>
          ))
        ) : (
          <>
            <Field
              label={t("leverForm.geography")}
              required={req && legacyFinestGeo === "geography"}
              error={legacyFinestGeo === "geography" ? err("geography") : undefined}
            >
              <select
                className={
                  inputClass + (legacyFinestGeo === "geography" ? errClass("geography") : "")
                }
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
            <Field
              label={t("leverForm.country")}
              required={req && legacyFinestGeo === "country"}
              error={legacyFinestGeo === "country" ? err("geography") : undefined}
            >
              <select
                className={
                  inputClass + (legacyFinestGeo === "country" ? errClass("geography") : "")
                }
                value={values.country}
                onChange={(e) => set("country", e.target.value)}
              >
                <option value="">{t("leverForm.selectPlaceholder")}</option>
                {legacyCountries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t("leverForm.entity")}
              required={req && legacyFinestGeo === "entity"}
              error={legacyFinestGeo === "entity" ? err("geography") : undefined}
            >
              <select
                className={inputClass + (legacyFinestGeo === "entity" ? errClass("geography") : "")}
                value={values.entity}
                onChange={(e) => set("entity", e.target.value)}
              >
                <option value="">{t("leverForm.selectPlaceholder")}</option>
                {legacyEntities.map((ent) => (
                  <option key={ent} value={ent}>
                    {ent}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        <Field label={t("leverForm.function")} required={req} error={err("function")}>
          <select
            className={inputClass + errClass("function")}
            value={values.function}
            onChange={(e) => set("function", e.target.value)}
          >
            {(isCreate || !values.function) && (
              <option value="">{t("leverForm.selectPlaceholder")}</option>
            )}
            {data.functions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>
        {/* Round "rattachement financier par action" : plus de sélecteur centre de coût / compte
         *  P&L au niveau du levier (ni la maille hiérarchique `hierarchyLeafId`, ni sa dérivation
         *  automatique vers `pnlMap`) — ce rattachement se fait désormais par action/impact (voir
         *  `HierarchyLeafSelect` + le tableau des impacts dans `ActionForm.tsx`). `Lever.pnlMap`/
         *  `Lever.hierarchyLeafId` restent des champs de type (repli legacy dans
         *  `engine.resolveLeverAccount`) mais ne sont plus éditables depuis ce formulaire, y
         *  compris en édition d'un levier existant qui en aurait déjà un. */}
      </div>

      <SectionTitle>
        {isCreate ? t("leverForm.sectionSchedule", "Calendrier") : t("leverForm.sectionStatus")}
      </SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        <Field label={t("leverForm.startDate")} required={req} error={err("start")}>
          <DateInput
            className={inputClass}
            invalid={!!err("start")}
            value={values.start}
            onChange={(v) => set("start", v)}
          />
        </Field>
        <Field label={t("leverForm.endDate")} required={req} error={err("end")}>
          <DateInput
            className={inputClass}
            invalid={!!err("end") || (!!values.end && !!values.start && values.end < values.start)}
            min={values.start || undefined}
            value={values.end}
            onChange={(v) => set("end", v)}
          />
          {!showErrors && values.start && values.end && values.end < values.start && (
            <span className="mt-0.5 block text-[10.5px] text-bp-coral">
              {t(
                "leverForm.endBeforeStart",
                "La date de fin ne peut pas être antérieure à la date de début"
              )}
            </span>
          )}
        </Field>
        {!isCreate && (
          <Field label={t("leverForm.status")}>
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
        )}
        {computedRisk && (
          <Field label={t("leverForm.risk")}>
            <div className={`${inputClass} bg-neutral-100 text-tertiary`}>
              {riskLevelLabel(t, computedRisk)}
            </div>
          </Field>
        )}
      </div>

      <SectionTitle>{t("leverForm.sectionImpact", "Impact")}</SectionTitle>
      {isLocked && (
        <p className="mb-3 rounded-sm border border-rag-amber/40 bg-rag-amber-light px-2.5 py-2 text-[11px] text-rag-amber">
          {t(
            "leverForm.impactReforecastNotice",
            "Le plan initial est figé : les modifications alimentent le réactualisé."
          )}
        </p>
      )}
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
        {t("leverForm.impactFinancialGroup", "Impact financier (hors ETP)")}
      </p>
      <ImpactsEditor
        scope="financial"
        impacts={impacts}
        onChange={(next) => set("impacts", next)}
        company={company}
        canEdit
      />
      <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
        {t("leverForm.impactFteGroup", "Impact ETP")}
      </p>
      <ImpactsEditor
        scope="fte"
        impacts={impacts}
        onChange={(next) => set("impacts", next)}
        company={company}
        canEdit
      />
      {impacts.length === 0 && (
        <p className="mt-2 text-[11px] text-tertiary">
          {t(
            "leverForm.impactOptional",
            "Ajoutez des impacts (OPEX, CAPEX, gains, ETP) : les totaux du levier en sont dérivés."
          )}
        </p>
      )}
      {(values.actions ?? []).length > 0 && (
        <>
          <SectionTitle>{t("leverForm.sectionActions", "Actions")}</SectionTitle>
          <ActionWeightsEditor
            actions={values.actions ?? []}
            onChange={(next) => set("actions", next)}
          />
        </>
      )}

      {/* Section "Impact RH" (population impactée = quel workstream/département) retirée du
       *  formulaire de création : tant que le plan d'actions chiffré n'existe pas encore, on ne
       *  sait pas précisément QUEL workstream/département est affecté par l'impact RH — cette
       *  information n'a de sens qu'au niveau des actions/impacts (voir `ActionImpact`), pas au
       *  niveau du business case initial du levier. `popImpacted` reste un champ de type
       *  (`LeverFormValues`/`Lever`) pour la compat des données existantes, mais n'est plus édité
       *  ici. */}

      <SectionTitle>{t("leverForm.sectionDescription")}</SectionTitle>
      <textarea
        rows={3}
        className={inputClass}
        value={values.description}
        onChange={(e) => set("description", e.target.value)}
      />

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {onDelete && !isCreate && (
          <Button
            type="button"
            variant="ghost"
            className="mr-auto text-bp-coral"
            onClick={onDelete}
          >
            <Trash2 size={13} /> {t("levers.deleteLever", "Supprimer le levier")}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!values.programId || !actionWeights.valid || submitting}
        >
          {submitLabel ?? t("common.save")}
        </Button>
      </div>
    </form>
  );
}
