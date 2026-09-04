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
import type { Program, ProgramType } from "@/types";
import { subscribePrograms, saveProgram, deleteProgram } from "@/lib/firestore/admin";
import { ensureDefaultMaturityStages } from "@/lib/firestore/maturityStageConfigs";
import { resolveProgramType } from "@/lib/axisLogic";
import { useRegisterUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { MaturityStagesEditor } from "@/components/admin/MaturityStagesEditor";
import { IndicatorsEditor } from "@/components/admin/IndicatorsEditor";

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

/** Sous-écrans d'administration propres à un programme STRATÉGIQUE. Le plan les veut accessibles
 *  « depuis la fiche du programme, pas depuis l'entreprise » : comme il n'existe pas de route de
 *  détail par programme, ce panneau bascule en place (liste → fiche) et rend ces deux onglets,
 *  sur le même pattern visuel que les onglets de `CompanyDetailClient`. */
type ProgramTabId = "maturity" | "indicators";

const PROGRAM_TABS: {
  id: ProgramTabId;
  key: string;
  fallback: string;
  icon: typeof Workflow;
}[] = [
  {
    id: "maturity",
    key: "adminPrograms.tabMaturity",
    fallback: "Étapes de maturité",
    icon: Workflow,
  },
  { id: "indicators", key: "adminPrograms.tabIndicators", fallback: "Indicateurs", icon: Gauge },
];

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

  useEffect(() => {
    const unsub = subscribePrograms((all) =>
      setPrograms(all.filter((p) => p.companyId === companyId))
    );
    return unsub;
  }, [companyId]);

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<{
    name: string;
    sponsor: string;
    target: string;
    type: ProgramType;
  }>({ name: "", sponsor: "", target: "", type: "performance" });
  const [showForm, setShowForm] = useState(false);
  /** Programme stratégique dont on affiche la fiche de configuration (null = liste). */
  const [managedProgramId, setManagedProgramId] = useState<string | null>(
    initialManagedProgramId ?? null
  );
  const [programTab, setProgramTab] = useState<ProgramTabId>("maturity");

  // Ré-appliqué quand le paramètre d'URL change (arrivée successive sur deux programmes différents
  // depuis le Topbar sans remontage du composant). Une valeur absente ne referme jamais une fiche
  // déjà ouverte : seul un choix explicite de l'utilisateur (« Tous les programmes ») le fait.
  useEffect(() => {
    if (!initialManagedProgramId) return;
    setManagedProgramId(initialManagedProgramId);
    setProgramTab("maturity");
    setShowForm(false);
  }, [initialManagedProgramId]);

  // Un programme est "en cours d'édition" (dirty) si le formulaire est ouvert avec au moins un
  // champ rempli — évite de bloquer inutilement la navigation quand l'utilisateur a juste
  // cliqué sur "Nouveau programme" sans rien saisir.
  const programFormDirty =
    showForm &&
    (form.name.trim() !== "" || form.sponsor.trim() !== "" || form.target.trim() !== "");
  useRegisterUnsavedChanges(`admin:programs:${companyId}`, programFormDirty);

  const startCreate = () => {
    setEditId(null);
    setForm({ name: "", sponsor: "", target: "", type: "performance" });
    setShowForm(true);
  };

  const startEdit = (p: Program) => {
    setEditId(p.id);
    // `type` est chargé pour l'affichage en lecture seule uniquement — jamais réécrit (voir save).
    setForm({
      name: p.name,
      sponsor: p.sponsor,
      target: String(p.target),
      type: resolveProgramType(p),
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    const target = parseFloat(form.target) || 0;
    if (editId) {
      const existing = programs.find((p) => p.id === editId);
      if (existing) {
        // Le patch d'édition n'inclut JAMAIS `type` : le type est figé à la création (l'étalement
        // via `...existing` conserve la valeur d'origine telle quelle).
        await saveProgram({
          ...existing,
          name: form.name,
          sponsor: form.sponsor,
          target,
        });
      }
    } else {
      const id = `p${Date.now()}`;
      await saveProgram({
        id,
        companyId,
        name: form.name,
        sponsor: form.sponsor,
        target,
        currency: "€M",
        fyStart: "2026-01",
        fyEnd: "2026-12",
        baselineEBIT: 0,
        revenue: 0,
        createdAt: new Date().toISOString().slice(0, 10),
        type: form.type,
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
    setProgramTab("maturity");
    setManagedProgramId(p.id);
  };

  // Fiche de configuration d'un programme stratégique — remplace la liste tant qu'elle est
  // ouverte (pas de route dédiée : ce panneau est lui-même un onglet de `CompanyDetailClient`,
  // imbriquer une seconde barre d'onglets sous un en-tête « retour » reste lisible, là où un
  // dépliage inline à la HierarchyEditor mêlerait deux éditeurs complets aux lignes de la liste).
  const managedProgram = managedProgramId
    ? programs.find((p) => p.id === managedProgramId && resolveProgramType(p) === "strategic")
    : undefined;

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
            <span className="rounded-full bg-bp-coral/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-bp-coral">
              Stratégique
            </span>
          </div>
        </div>

        <div className="flex snap-x gap-2 overflow-x-auto border-b border-border pb-2">
          {PROGRAM_TABS.map((tabDef) => {
            const Icon = tabDef.icon;
            const active = programTab === tabDef.id;
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

        {programTab === "maturity" && (
          <MaturityStagesEditor companyId={companyId} programId={managedProgram.id} />
        )}
        {programTab === "indicators" && (
          <IndicatorsEditor companyId={companyId} programId={managedProgram.id} />
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
            <div>
              <label className="text-xs font-medium text-text-secondary">
                {t("adminProgramsPanel.sponsor", "Sponsor")}
              </label>
              <input
                value={form.sponsor}
                onChange={(e) => setForm((f) => ({ ...f, sponsor: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder={t("adminProgramsPanel.sponsor", "Sponsor")}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">
                {t("adminProgramsPanel.targetLabel", "Cible (€M)")}
              </label>
              <input
                type="number"
                value={form.target}
                onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="50"
              />
            </div>
          </div>

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
                {t("adminProgramsPanel.colTarget", "Cible")}
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
                  {resolveProgramType(p) === "strategic" && (
                    <span className="ml-2 rounded-full bg-bp-coral/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-bp-coral">
                      Stratégique
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-text-secondary">{p.sponsor}</td>
                <td className="px-4 py-2.5 text-right font-medium text-text-primary">
                  €{p.target}M
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  {resolveProgramType(p) === "strategic" && (
                    <button
                      onClick={() => openManage(p)}
                      className="mr-3 inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-bg-surface hover:text-bp-coral"
                    >
                      <SlidersHorizontal size={13} /> {t("adminPrograms.manage", "Gérer")}
                    </button>
                  )}
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
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-text-secondary">
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
                  {resolveProgramType(p) === "strategic" && (
                    <span className="ml-2 rounded-full bg-bp-coral/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-bp-coral">
                      Stratégique
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-secondary">{p.sponsor}</div>
              </div>
              <div className="text-right">
                <div className="font-medium text-text-primary">€{p.target}M</div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-3">
              {resolveProgramType(p) === "strategic" && (
                <button
                  onClick={() => openManage(p)}
                  className="mr-auto inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-bg-surface hover:text-bp-coral"
                >
                  <SlidersHorizontal size={13} /> {t("adminPrograms.manage", "Gérer")}
                </button>
              )}
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
