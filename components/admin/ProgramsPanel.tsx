"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  FolderKanban,
  Gauge,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  Workflow,
} from "lucide-react";
import type { AuthUser, Program, ProgramType } from "@/types";
import {
  subscribePrograms,
  saveProgram,
  deleteProgram,
  subscribeUsers,
} from "@/lib/firestore/admin";
import { ensureDefaultMaturityStages } from "@/lib/firestore/maturityStageConfigs";
import { resolveProgramType } from "@/lib/axisLogic";
import { useRegisterUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { MaturityStagesEditor } from "@/components/admin/MaturityStagesEditor";
import { IndicatorsEditor } from "@/components/admin/IndicatorsEditor";
import { LifecycleEditor } from "@/components/admin/LifecycleEditor";
import { UserPicker } from "@/components/strategic/UserPicker";

/** Libellés des deux types de programme. Le type est choisi À LA CRÉATION et figé ensuite : il
 *  détermine la nature même des entités du programme (leviers financiers vs axes/chantiers/
 *  indicateurs) — le basculer après coup laisserait des données orphelines sans équivalent dans
 *  l'autre modèle. */
const PROGRAM_TYPE_OPTIONS: { value: ProgramType; label: string; hint: string }[] = [
  {
    value: "performance",
    label: "Plan Performance",
    hint: "Leviers financiers, cycle de vie L1-L5, impacts CAPEX/OPEX.",
  },
  {
    value: "strategic",
    label: "Plan Stratégique",
    hint: "Axes, chantiers et indicateurs (3-5-15), étapes de maturité configurables.",
  },
];

/** Sous-écrans d'administration propres à UN programme (Stratégique ou Performance). Le plan les
 *  veut accessibles « depuis la fiche du programme, pas depuis l'entreprise » : comme il n'existe
 *  pas de route de détail par programme, ce panneau bascule en place (liste → fiche) et rend ces
 *  onglets, sur le même pattern visuel que les onglets de `CompanyDetailClient`. Chaque onglet
 *  porte les types de programme auxquels il s'applique (`programTypes`) — `maturity`/`indicators`
 *  sont des notions de Plan Stratégique (axes/chantiers/indicateurs 3-5-15), `lifecycle` une notion
 *  de Plan Performance (cycle de vie L1-L5 des leviers, voir lib/status-config.ts) : les deux types
 *  ne partagent aujourd'hui aucun onglet, la fiche « Gérer » d'un programme n'affiche donc que les
 *  onglets pertinents pour son type. */
type ProgramTabId = "maturity" | "indicators" | "lifecycle";

const PROGRAM_TABS: {
  id: ProgramTabId;
  key: string;
  fallback: string;
  icon: typeof Workflow;
  programTypes: ProgramType[];
}[] = [
  {
    id: "maturity",
    key: "adminPrograms.tabMaturity",
    fallback: "Étapes de maturité",
    icon: Workflow,
    programTypes: ["strategic"],
  },
  {
    id: "indicators",
    key: "adminPrograms.tabIndicators",
    fallback: "Indicateurs",
    icon: Gauge,
    programTypes: ["strategic"],
  },
  {
    id: "lifecycle",
    key: "adminPrograms.tabLifecycle",
    fallback: "Cycle de vie",
    icon: SlidersHorizontal,
    programTypes: ["performance"],
  },
];

/** Pastille de type de programme — même style que le badge « Stratégique » historique (pill,
 *  fond translucide + texte de la couleur d'accent), simplement sur l'accent bleu du design system
 *  (`info-blue`, déjà utilisé pour StageBadge/AxisStageBadge) plutôt que le corail réservé aux
 *  actions/accents primaires — pour rester visuellement distinct du corail sans introduire une
 *  nouvelle couleur hors design system. Partagée entre la liste (lignes/cartes) et l'en-tête de la
 *  fiche « Gérer ». */
function ProgramTypeBadge({
  type,
  t,
  className = "",
}: {
  type: ProgramType;
  t: (key: string, fallback?: string) => string;
  className?: string;
}) {
  if (type === "strategic") {
    return (
      <span
        className={`rounded-full bg-bp-coral/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-bp-coral ${className}`}
      >
        {t("adminPrograms.badgeStrategic", "Stratégique")}
      </span>
    );
  }
  return (
    <span
      className={`rounded-full bg-info-blue-light px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-info-blue ${className}`}
    >
      {t("adminPrograms.badgePerformance", "Transformation")}
    </span>
  );
}

/**
 * Gestion des programmes pour UNE entreprise déjà sélectionnée. Extrait de
 * `admin/projects/page.tsx` (route supprimée — orpheline après le retrait de `admin-projects` de
 * la nav, voir lib/nav-config.ts) — le hub `/admin/companies/detail` le rend directement, scopé via
 * `companyId`, sans sélecteur ni filtre entreprise (contrairement à l'ancienne page globale). Seule
 * source de vérité pour ce CRUD.
 *
 * `initialManagedProgramId` : ouvre d'emblée la fiche « Gérer » de ce programme (s'il est bien
 * stratégique) plutôt que la liste — alimenté par `?manageProgram=` quand le global admin arrive
 * ici via le sélecteur de programme du Topbar (voir components/shared/ProgramSwitcher.tsx).
 */
export function ProgramsPanel({
  companyId,
  initialManagedProgramId,
}: {
  companyId: string;
  initialManagedProgramId?: string | null;
}) {
  const { t } = useTranslation();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [companyUsers, setCompanyUsers] = useState<AuthUser[]>([]);

  useEffect(() => {
    const unsub = subscribePrograms(
      (all) => setPrograms(all.filter((p) => p.companyId === companyId)),
      companyId
    );
    return unsub;
  }, [companyId]);

  useEffect(() => {
    const unsub = subscribeUsers(
      (all) => setCompanyUsers(all.filter((u) => u.companyId === companyId)),
      companyId
    );
    return unsub;
  }, [companyId]);

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<{
    name: string;
    sponsor: string | undefined;
    type: ProgramType;
    actionPlanEnabled: boolean;
    ambition: string | undefined;
  }>({
    name: "",
    sponsor: undefined,
    type: "performance",
    actionPlanEnabled: true,
    ambition: undefined,
  });
  const [showForm, setShowForm] = useState(false);
  /** Programme (Stratégique ou Performance) dont on affiche la fiche de configuration (null =
   *  liste). */
  const [managedProgramId, setManagedProgramId] = useState<string | null>(
    initialManagedProgramId ?? null
  );
  const [programTab, setProgramTab] = useState<ProgramTabId | null>(null);

  // Ré-appliqué quand le paramètre d'URL change (arrivée successive sur deux programmes différents
  // depuis le Topbar sans remontage du composant). Une valeur absente ne referme jamais une fiche
  // déjà ouverte : seul un choix explicite de l'utilisateur (« Tous les programmes ») le fait.
  // `programTab` est remis à `null` plutôt qu'à un onglet fixe — le type du programme visé n'est
  // pas forcément déjà chargé ici (course avec `subscribePrograms`), le rendu plus bas retombe sur
  // le premier onglet pertinent pour SON type dès que `managedProgram` est résolu.
  useEffect(() => {
    if (!initialManagedProgramId) return;
    setManagedProgramId(initialManagedProgramId);
    setProgramTab(null);
    setShowForm(false);
  }, [initialManagedProgramId]);

  // Un programme est "en cours d'édition" (dirty) si le formulaire est ouvert avec au moins un
  // champ rempli — évite de bloquer inutilement la navigation quand l'utilisateur a juste
  // cliqué sur "Nouveau programme" sans rien saisir.
  const programFormDirty = showForm && (form.name.trim() !== "" || !!form.sponsor);
  useRegisterUnsavedChanges(`admin:programs:${companyId}`, programFormDirty);

  const startCreate = () => {
    setEditId(null);
    setForm({
      name: "",
      sponsor: undefined,
      type: "performance",
      actionPlanEnabled: true,
      ambition: undefined,
    });
    setShowForm(true);
  };

  const startEdit = (p: Program) => {
    setEditId(p.id);
    // `type` est chargé pour l'affichage en lecture seule uniquement — jamais réécrit (voir save).
    setForm({
      name: p.name,
      sponsor: p.sponsor,
      type: resolveProgramType(p),
      actionPlanEnabled: p.actionPlanEnabled ?? true,
      ambition: p.ambition,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    if (editId) {
      const existing = programs.find((p) => p.id === editId);
      if (existing) {
        // Le patch d'édition n'inclut JAMAIS `type` : le type est figé à la création (l'étalement
        // via `...existing` conserve la valeur d'origine telle quelle).
        await saveProgram({
          ...existing,
          name: form.name,
          sponsor: form.sponsor,
          ambition: form.ambition,
          ...(resolveProgramType(existing) === "performance"
            ? { actionPlanEnabled: form.actionPlanEnabled }
            : {}),
        });
      }
    } else {
      const id = `p${Date.now()}`;
      await saveProgram({
        id,
        companyId,
        name: form.name,
        sponsor: form.sponsor,
        ambition: form.ambition,
        currency: "€M",
        fyStart: "2026-01",
        fyEnd: "2026-12",
        baselineEBIT: 0,
        revenue: 0,
        createdAt: new Date().toISOString().slice(0, 10),
        type: form.type,
        ...(form.type === "performance" ? { actionPlanEnabled: form.actionPlanEnabled } : {}),
      });
      // Un plan stratégique démarre avec un jeu d'étapes de maturité par défaut, que l'admin
      // pourra ensuite étendre à N étapes (voir MaturityStagesEditor). Idempotent.
      if (form.type === "strategic") {
        await ensureDefaultMaturityStages(companyId, id);
      }
    }
    setShowForm(false);
  };

  const remove = async (id: string) => {
    if (id === managedProgramId) setManagedProgramId(null);
    await deleteProgram(id);
  };

  const openManage = (p: Program) => {
    setShowForm(false);
    setProgramTab(null);
    setManagedProgramId(p.id);
  };

  // Fiche de configuration d'UN programme (Stratégique OU Performance) — remplace la liste tant
  // qu'elle est ouverte (pas de route dédiée : ce panneau est lui-même un onglet de
  // `CompanyDetailClient`, imbriquer une seconde barre d'onglets sous un en-tête « retour » reste
  // lisible, là où un dépliage inline à la HierarchyEditor mêlerait deux éditeurs complets aux
  // lignes de la liste). Généralisé aux deux types : auparavant réservé aux programmes stratégiques
  // (seuls dotés d'une fiche « Gérer »), désormais les programmes Performance en ont une aussi
  // (cycle de vie L1-L5, voir PROGRAM_TABS ci-dessus).
  const managedProgram = managedProgramId
    ? programs.find((p) => p.id === managedProgramId)
    : undefined;
  const managedProgramType = managedProgram ? resolveProgramType(managedProgram) : undefined;
  const availableTabs = managedProgramType
    ? PROGRAM_TABS.filter((tabDef) => tabDef.programTypes.includes(managedProgramType))
    : [];
  // Onglet effectivement affiché : celui choisi explicitement s'il reste pertinent pour CE
  // programme, sinon le premier onglet de son type (cas initial, ou bascule depuis un programme
  // d'un autre type sans passer par `openManage`, ex. paramètre d'URL `manageProgram`).
  const activeProgramTab: ProgramTabId | undefined =
    programTab && availableTabs.some((tabDef) => tabDef.id === programTab)
      ? programTab
      : availableTabs[0]?.id;

  if (managedProgram) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <button
            onClick={() => setManagedProgramId(null)}
            className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-bp-coral"
          >
            <ArrowLeft size={12} /> {t("adminPrograms.back", "Tous les programmes")}
          </button>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <FolderKanban size={22} className="text-bp-coral" />
            <h1 className="text-xl font-bold text-text-primary">{managedProgram.name}</h1>
            {managedProgramType && <ProgramTypeBadge type={managedProgramType} t={t} />}
          </div>
        </div>

        {availableTabs.length > 0 && (
          <div className="flex snap-x gap-2 overflow-x-auto border-b border-border pb-2">
            {availableTabs.map((tabDef) => {
              const Icon = tabDef.icon;
              const active = activeProgramTab === tabDef.id;
              return (
                <button
                  key={tabDef.id}
                  onClick={() => setProgramTab(tabDef.id)}
                  className={`flex min-h-10 shrink-0 snap-start items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "bg-bp-coral text-white"
                      : "border border-border text-text-secondary hover:bg-bg-elevated"
                  }`}
                >
                  <Icon size={14} /> {t(tabDef.key, tabDef.fallback)}
                </button>
              );
            })}
          </div>
        )}

        {activeProgramTab === "maturity" && (
          <MaturityStagesEditor companyId={companyId} programId={managedProgram.id} />
        )}
        {activeProgramTab === "indicators" && (
          <IndicatorsEditor companyId={companyId} programId={managedProgram.id} />
        )}
        {activeProgramTab === "lifecycle" && (
          <LifecycleEditor companyId={companyId} programId={managedProgram.id} />
        )}
        {/* Aucun onglet pour ce type de programme (ne devrait pas arriver : tout programme a au
         * moins un onglet dans PROGRAM_TABS) — garde-fou plutôt qu'une fiche vide muette. */}
        {availableTabs.length === 0 && (
          <p className="text-sm text-text-secondary">
            {t(
              "adminPrograms.noSettings",
              "Aucun paramètre de configuration disponible pour ce type de programme."
            )}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FolderKanban size={22} className="text-bp-coral" />
          <h1 className="text-xl font-bold text-text-primary">
            {t("adminProgramsPanel.title", "Gestion des Programmes")}
          </h1>
        </div>
        <button
          onClick={startCreate}
          className="flex items-center gap-1.5 rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90"
        >
          <Plus size={14} /> {t("common.add", "Ajouter")}
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-bg-elevated p-4 space-y-3">
          <div className="text-sm font-semibold text-text-primary">
            {editId
              ? t("adminProgramsPanel.editTitle", "Modifier le programme")
              : t("adminProgramsPanel.newTitle", "Nouveau programme")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-text-secondary">
                {t("adminProgramsPanel.nameLabel", "Nom du programme")}
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder={t("adminProgramsPanel.namePlaceholder", "Nom")}
              />
            </div>
            <UserPicker
              users={companyUsers}
              value={form.sponsor}
              onChange={(sponsor) => setForm((f) => ({ ...f, sponsor }))}
              label={t("adminProgramsPanel.sponsor", "Sponsor")}
              id="program-sponsor"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-text-secondary">
              {t("adminProgramsPanel.ambitionLabel", "Ambition")}
            </label>
            <input
              value={form.ambition ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, ambition: e.target.value || undefined }))}
              className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
              placeholder={t(
                "adminProgramsPanel.ambitionPlaceholder",
                "Ex. Devenir leader du marché d'ici 2027"
              )}
            />
          </div>

          {form.type === "performance" && (
            <label className="flex cursor-pointer gap-2 rounded-lg border border-border p-3 text-sm hover:bg-bg-surface">
              <input
                type="checkbox"
                checked={form.actionPlanEnabled}
                onChange={(e) => setForm((f) => ({ ...f, actionPlanEnabled: e.target.checked }))}
                className="mt-0.5 accent-bp-coral"
              />
              <span>
                <span className="block font-medium text-text-primary">
                  {t("adminProgramsPanel.actionPlanModuleLabel", "Module Plan d'action")}
                </span>
                <span className="block text-xs text-text-secondary">
                  {t(
                    "adminProgramsPanel.actionPlanModuleHint",
                    "Active l'onglet Plan d'action (Kanban/Gantt) sur les leviers de ce programme. Module additionnel activable selon les options souscrites par le client — décoché, les leviers de ce programme n'affichent pas cet onglet."
                  )}
                </span>
              </span>
            </label>
          )}

          {/* Type de programme — sélectionnable UNIQUEMENT à la création, figé ensuite : il
              détermine la nature des entités du programme (leviers vs axes/chantiers). */}
          {editId ? (
            <div className="text-xs text-text-secondary">
              Type de programme :{" "}
              <span className="font-semibold text-text-primary">
                {PROGRAM_TYPE_OPTIONS.find((o) => o.value === form.type)?.label ?? form.type}
              </span>{" "}
              — figé à la création, non modifiable.
            </div>
          ) : (
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-text-secondary">Type de programme</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {PROGRAM_TYPE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm transition ${
                      form.type === option.value
                        ? "border-bp-coral bg-bp-coral/5"
                        : "border-border hover:bg-bg-surface"
                    }`}
                  >
                    <input
                      type="radio"
                      name="programType"
                      value={option.value}
                      checked={form.type === option.value}
                      onChange={() => setForm((f) => ({ ...f, type: option.value }))}
                      className="mt-0.5 accent-bp-coral"
                    />
                    <span>
                      <span className="block font-medium text-text-primary">{option.label}</span>
                      <span className="block text-xs text-text-secondary">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="flex gap-2">
            <button
              onClick={save}
              className="rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90"
            >
              {t("common.save", "Enregistrer")}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
            >
              {t("common.cancel", "Annuler")}
            </button>
          </div>
        </div>
      )}

      <div className="text-xs text-text-secondary">
        {t("adminProgramsPanel.count", "{n} programme(s)").replace("{n}", String(programs.length))}
      </div>

      {/* Desktop/tablette (>= sm). En dessous de sm, remplacé par des cartes empilées
       * verticalement — même pattern que LifecycleEditor/UsersPanel pour éviter tout scroll
       * horizontal à 375px. */}
      <div className="hidden rounded-xl border border-border overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-elevated border-b border-border">
              <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-text-secondary md:table-cell">
                ID
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                {t("adminProgramsPanel.colProgram", "Programme")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                {t("adminProgramsPanel.sponsor", "Sponsor")}
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">
                {t("adminProgramsPanel.colActions", "Actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {programs.map((p) => (
              <tr key={p.id} className="border-b border-border hover:bg-bg-elevated/50">
                <td className="hidden px-4 py-2.5 font-mono text-xs text-text-secondary md:table-cell">
                  {p.id}
                </td>
                <td className="px-4 py-2.5 font-medium text-text-primary">
                  {p.name}
                  <ProgramTypeBadge type={resolveProgramType(p)} t={t} className="ml-2" />
                </td>
                <td className="px-4 py-2.5 text-text-secondary">{p.sponsor}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <button
                    onClick={() => openManage(p)}
                    className="mr-3 inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-bg-surface hover:text-bp-coral"
                  >
                    <SlidersHorizontal size={13} /> {t("adminPrograms.manage", "Gérer")}
                  </button>
                  <button
                    onClick={() => startEdit(p)}
                    className="mr-2 text-text-secondary hover:text-bp-coral"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => remove(p.id)}
                    className="text-text-secondary hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {programs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-text-secondary">
                  {t("adminProgramsPanel.empty", "Aucun programme pour cette entreprise.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile (< sm) : une carte par programme. */}
      <div className="divide-y divide-border rounded-xl border border-border sm:hidden">
        {programs.map((p) => (
          <div key={p.id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-text-primary">
                  {p.name}
                  <ProgramTypeBadge type={resolveProgramType(p)} t={t} className="ml-2" />
                </div>
                <div className="text-xs text-text-secondary">{p.sponsor}</div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-3">
              <button
                onClick={() => openManage(p)}
                className="mr-auto inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-bg-surface hover:text-bp-coral"
              >
                <SlidersHorizontal size={13} /> {t("adminPrograms.manage", "Gérer")}
              </button>
              <button
                onClick={() => startEdit(p)}
                className="text-text-secondary hover:text-bp-coral"
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={() => remove(p.id)}
                className="text-text-secondary hover:text-red-500"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
        {programs.length === 0 && (
          <div className="p-4 text-center text-sm text-text-secondary">
            {t("adminProgramsPanel.empty", "Aucun programme pour cette entreprise.")}
          </div>
        )}
      </div>
    </div>
  );
}
