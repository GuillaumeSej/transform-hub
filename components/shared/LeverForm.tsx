"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/shared/Button";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { STATUS_LABEL } from "@/lib/status-config";
import type { LifecycleLabels } from "@/lib/hooks/useLifecycleLabels";
import {
  subscribeCompanies,
  subscribeHierarchyNodes,
  subscribePrograms,
} from "@/lib/firestore/admin";
import type {
  BeTrackData,
  HierarchyLevelDef,
  HierarchyNode,
  Lever,
  LeverStatus,
  Program,
} from "@/types";
import { hierarchyPathValue, resolveHierarchyNodeChain } from "@/lib/hierarchyLogic";
import { resolveProgramType } from "@/lib/axisLogic";
import { useCompanyUsers } from "@/lib/hooks/useCompanyUsers";
import { matchLeverOwner } from "@/lib/leverOwnerReconciliation";

/** Mêmes règles que `components/shared/Topbar.tsx`/`components/strategic/RaciChips.tsx` (2
 *  initiales max, majuscules) — pas de helper partagé exporté par ces composants d'affichage, on
 *  réplique ici pour dériver `ownerInit` depuis le nom du compte sélectionné. */
function initialsFromName(name: string): string {
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
  children,
}: {
  label: string;
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
  onSubmit: (values: LeverFormValues) => void;
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
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<LeverFormValues>({
    ...emptyValues(data),
    ...initialValues,
  });

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

  useEffect(() => {
    if (!companyId) {
      setGeographyLevels([]);
      setGeographyNodes([]);
      setConfidentialityLevels([]);
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
  const num = (v: string) => (v === "" ? 0 : Number(v));

  // Dès que le levier a au moins une action chiffrée (impacts renseignés), le business case
  // initial saisi ci-dessous est mis de côté : `consolidateLeverFromActions` (appelé à chaque
  // création/édition d'action, voir `leversLogic.ts::recomputeLeverProgress`) recalcule alors
  // `grossSavings`/`netSavings`/`capex`/`opexOneOff`/`opexRec`/`fteImpact` depuis les lignes
  // d'impact des actions et écrase ces champs — ce formulaire ne doit donc plus les rendre
  // éditables à ce stade (ils redeviendraient faux dès la prochaine action modifiée), seulement
  // les afficher en lecture seule avec un message expliquant le bascule. Même logique que
  // `leverConsolidate.ts::hasActionImpacts`, dupliquée ici pour éviter de typer `values`
  // (`LeverFormValues`, un `Omit<Lever, ...>`) en `Lever` complet juste pour cet appel.
  const hasCostedActions = (values.actions ?? []).some((a) => (a.impacts ?? []).length > 0);
  // Une fois le plan initial figé (passage à "validated"/L3, voir `leversLogic.ts::applyPlanLock`),
  // le business case initial ci-dessous n'est plus éditable manuellement — mêmes montants que le
  // snapshot `lockedPlan` (édition possible d'un tout nouveau levier uniquement).
  const isLocked = Boolean((initialValues as Lever | undefined)?.lockedPlan);

  return (
    <form
      id="lever-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!values.code.trim() || !values.name.trim() || !values.programId) return;
        onSubmit(values);
      }}
    >
      <SectionTitle>{t("leverForm.sectionIdentification")}</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        <Field label={t("leverForm.code")} required>
          <input
            required
            className={inputClass}
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
            {data.leverTypes.map((lt) => (
              <option key={lt} value={lt}>
                {lt}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("leverForm.workstream")}>
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
        {canEditWorkstreamWeight && (
          <Field
            label={t("leverForm.workstreamWeightPct", "Poids dans l'avancement du workstream (%)")}
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
          <Field label={t("leverForm.name")} required>
            <input
              required
              className={inputClass}
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
          <Field label={t("leverForm.owner")}>
            {/* Round "ownership réel" (voir doc-comment `Lever.ownerUsername`, types/index.ts) :
             *  plus de texte libre — un levier ne peut être rattaché qu'à un compte réel de
             *  l'entreprise (ou explicitement à "Aucun"). Sélectionner un compte renseigne
             *  d'un coup `ownerUsername` (lien fiable) et `owner`/`ownerInit` (libellé d'affichage
             *  dénormalisé, voir `initialsFromName`). */}
            <select
              className={inputClass}
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
        <Field label={t("leverForm.initials")}>
          <div className={`${inputClass} bg-neutral-100 text-tertiary`}>
            {values.ownerInit || "—"}
          </div>
        </Field>
        <div />
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
        <Field label={t("leverForm.initials")}>
          <div className={`${inputClass} bg-neutral-100 text-tertiary`}>
            {values.sponsorInit || "—"}
          </div>
        </Field>
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
            <Field key={level.key} label={level.label}>
              <select
                className={inputClass}
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
            <Field label={t("leverForm.geography")}>
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
            <Field label={t("leverForm.country")}>
              <select
                className={inputClass}
                value={values.country}
                onChange={(e) => set("country", e.target.value)}
              >
                <option value="">{t("leverForm.selectPlaceholder")}</option>
                {Array.from(
                  new Set(data.levers.map((l) => l.country).filter((v): v is string => !!v))
                )
                  .sort()
                  .map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t("leverForm.entity")}>
              <select
                className={inputClass}
                value={values.entity}
                onChange={(e) => set("entity", e.target.value)}
              >
                <option value="">{t("leverForm.selectPlaceholder")}</option>
                {Array.from(
                  new Set(data.levers.map((l) => l.entity).filter((v): v is string => !!v))
                )
                  .sort()
                  .map((ent) => (
                    <option key={ent} value={ent}>
                      {ent}
                    </option>
                  ))}
              </select>
            </Field>
          </>
        )}
        <Field label={t("leverForm.function")}>
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
        {/* Round "rattachement financier par action" : plus de sélecteur centre de coût / compte
         *  P&L au niveau du levier (ni la maille hiérarchique `hierarchyLeafId`, ni sa dérivation
         *  automatique vers `pnlMap`) — ce rattachement se fait désormais par action/impact (voir
         *  `HierarchyLeafSelect` + le tableau des impacts dans `ActionForm.tsx`). `Lever.pnlMap`/
         *  `Lever.hierarchyLeafId` restent des champs de type (repli legacy dans
         *  `engine.resolveLeverAccount`) mais ne sont plus éditables depuis ce formulaire, y
         *  compris en édition d'un levier existant qui en aurait déjà un. */}
      </div>

      <SectionTitle>{t("leverForm.sectionStatus")}</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        <Field label={t("leverForm.startDate")}>
          <input
            type="date"
            className={inputClass}
            value={values.start}
            onChange={(e) => set("start", e.target.value)}
          />
        </Field>
        <Field label={t("leverForm.endDate")}>
          <input
            type="date"
            className={inputClass}
            value={values.end}
            onChange={(e) => set("end", e.target.value)}
          />
        </Field>
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
        <Field label={t("leverForm.risk")}>
          <div className={`${inputClass} bg-neutral-100 text-tertiary`}>{values.risk}</div>
        </Field>
      </div>

      <SectionTitle>{t("leverForm.sectionInitialImpact")}</SectionTitle>
      {hasCostedActions ? (
        // Dès qu'une action chiffrée existe, le business case initial est consolidé depuis le
        // plan d'action (voir `consolidateLeverFromActions`) et n'est plus éditable ici — édition
        // désormais via "+ Action" sur la fiche détail du levier.
        <p className="mb-3 rounded-sm border border-border bg-neutral-50 px-2.5 py-2 text-[11px] text-secondary">
          {t("leverForm.initialImpactSupersededNotice")}
        </p>
      ) : (
        <>
          {isLocked && (
            <p className="mb-3 rounded-sm border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
              {t("leverForm.lockedPlanNotice")}{" "}
              {lifecycle ? lifecycle.label("validated") : STATUS_LABEL.validated}{" "}
              {t("leverForm.lockedPlanNoticeEnd")}
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            <Field label={t("leverForm.grossSavings")}>
              <input
                type="number"
                step="0.1"
                disabled={isLocked}
                className={`${inputClass} disabled:bg-neutral-100 disabled:text-tertiary`}
                value={values.grossSavings}
                onChange={(e) => set("grossSavings", num(e.target.value))}
              />
            </Field>
            <Field label={t("leverForm.netSavings")}>
              <input
                type="number"
                step="0.1"
                disabled={isLocked}
                className={`${inputClass} disabled:bg-neutral-100 disabled:text-tertiary`}
                value={values.netSavings}
                onChange={(e) => set("netSavings", num(e.target.value))}
              />
            </Field>
            <Field label={t("leverForm.fteImpact")}>
              <input
                type="number"
                step="0.1"
                disabled={isLocked}
                className={`${inputClass} disabled:bg-neutral-100 disabled:text-tertiary`}
                value={values.fteImpact}
                onChange={(e) => set("fteImpact", num(e.target.value))}
              />
            </Field>
            <Field label={t("leverForm.capex")}>
              <input
                type="number"
                step="0.1"
                disabled={isLocked}
                className={`${inputClass} disabled:bg-neutral-100 disabled:text-tertiary`}
                value={values.capex}
                onChange={(e) => set("capex", num(e.target.value))}
              />
            </Field>
            <Field label={t("leverForm.opexOneOff")}>
              <input
                type="number"
                step="0.1"
                disabled={isLocked}
                className={`${inputClass} disabled:bg-neutral-100 disabled:text-tertiary`}
                value={values.opexOneOff}
                onChange={(e) => set("opexOneOff", num(e.target.value))}
              />
            </Field>
            <Field label={t("leverForm.opexRec")}>
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
        </>
      )}

      <SectionTitle>{t("leverForm.sectionHr")}</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("leverForm.popImpacted")}>
          <select
            className={inputClass}
            value={values.popImpacted}
            onChange={(e) => set("popImpacted", e.target.value)}
          >
            <option value="">{t("leverForm.ownerNone", "Aucun")}</option>
            {data.workstreams.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <SectionTitle>{t("leverForm.sectionDescription")}</SectionTitle>
      <textarea
        rows={3}
        className={inputClass}
        value={values.description}
        onChange={(e) => set("description", e.target.value)}
      />

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={!values.programId}>
          {submitLabel ?? t("common.save")}
        </Button>
      </div>
    </form>
  );
}
