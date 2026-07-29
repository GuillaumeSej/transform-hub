"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GuardedLink } from "@/components/shared/GuardedLink";
import { useRegisterUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import {
  ArrowLeft,
  Building2,
  Users,
  Network,
  Globe2,
  Workflow,
  Database,
  BarChart3,
  FolderKanban,
} from "lucide-react";
import type { Company } from "@/types";
import { subscribeCompanies, saveCompany } from "@/lib/firestore/admin";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import {
  CompanyFieldsEditor,
  DEFAULT_COMPANY_FORM,
  type CompanyFormState,
} from "@/components/admin/CompanyFieldsEditor";
import { UsersPanel } from "@/components/admin/UsersPanel";
import { HierarchyEditor } from "@/components/admin/HierarchyEditor";
import { LifecycleEditor } from "@/components/admin/LifecycleEditor";
import { ProgramsPanel } from "@/components/admin/ProgramsPanel";
import { CompanyDataHistoryPanel } from "@/components/admin/CompanyDataHistoryPanel";
import { CompanyDatabasePanel } from "@/components/admin/CompanyDatabasePanel";

type TabId =
  | "settings"
  | "users"
  | "financial-hierarchy"
  | "geographic-hierarchy"
  | "projects"
  | "lifecycle"
  | "data"
  | "database";

/** Comparaison simple (JSON stringify) — suffisant vu la taille du formulaire, et robuste au
 *  fait que confidentialityLevels et roleClearance sont des objets/tableaux "plats". */
function companyFormEquals(a: CompanyFormState, b: CompanyFormState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const TABS: { id: TabId; label: string; icon: typeof Building2 }[] = [
  { id: "settings", label: "Paramètres", icon: Building2 },
  { id: "users", label: "Utilisateurs", icon: Users },
  { id: "financial-hierarchy", label: "Arborescence financière", icon: Network },
  { id: "geographic-hierarchy", label: "Arborescence géographique", icon: Globe2 },
  { id: "projects", label: "Programmes", icon: FolderKanban },
  { id: "lifecycle", label: "Cycle de vie", icon: Workflow },
  { id: "data", label: "Données & Historique", icon: BarChart3 },
  { id: "database", label: "Base de données", icon: Database },
];

/**
 * Hub de détail d'une entreprise (`/admin/companies/detail?id=...`) — GLOBAL ADMIN UNIQUEMENT (voir
 * components/shared/AppShell.tsx, qui spécial-case cette route comme il le fait déjà pour
 * `/levers/detail`). Regroupe en un seul endroit, via des onglets, tout ce qui était auparavant
 * réparti entre plusieurs pages top-level indépendantes (admin/users, admin/hierarchy,
 * admin/lifecycle, admin/data, admin/history, admin/projects) — chacune gardait son propre
 * sélecteur d'entreprise.
 * Chaque onglet réutilise le composant partagé de la page globale correspondante, pré-scopé sur
 * cette entreprise ; aucune logique CRUD n'est dupliquée ici.
 */
export default function CompanyDetailClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { role } = useRole();
  const { showToast } = useToast();
  const companyId = searchParams.get("id") ?? "";

  const [companies, setCompanies] = useState<Company[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<TabId>("settings");
  const [form, setForm] = useState<CompanyFormState>(DEFAULT_COMPANY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = subscribeCompanies((list) => {
      setCompanies(list);
      setLoaded(true);
    });
    return unsub;
  }, []);

  const company = useMemo(() => companies.find((c) => c.id === companyId), [companies, companyId]);

  // "Baseline" du formulaire = état dérivé de `company` en Firestore. On compare `form` à cette
  // baseline pour savoir si l'utilisateur a des modifs non enregistrées (seul l'onglet "settings"
  // édite `form` ; les autres onglets ont leurs propres composants qui gèrent leur propre dirty).
  const baselineForm = useMemo<CompanyFormState>(() => {
    if (!company) return DEFAULT_COMPANY_FORM;
    return {
      name: company.name,
      industry: company.industry,
      fyStart: company.fyStart,
      fyEnd: company.fyEnd,
      capexBudget: company.capexBudget != null ? String(company.capexBudget) : "",
      actionPlanEnabled: company.actionPlanEnabled ?? true,
      socialChargesRate:
        company.socialChargesRate != null
          ? String(Math.round(company.socialChargesRate * 100))
          : "",
      confidentialityLevels: company.confidentialityLevels ?? [],
      roleClearance: company.roleClearance ?? {},
      defaultRecognition: company.defaultRecognition ?? "smoothing",
      riskThresholds: company.riskThresholds?.map((t) => ({
        level: t.level,
        minAmount: String(t.minAmount / 1000),
      })),
    };
  }, [company]);

  const settingsDirty =
    tab === "settings" && company != null && !companyFormEquals(form, baselineForm);
  useRegisterUnsavedChanges("admin:company-settings", settingsDirty);

  useEffect(() => {
    if (!company) return;
    setForm({
      name: company.name,
      industry: company.industry,
      fyStart: company.fyStart,
      fyEnd: company.fyEnd,
      capexBudget: company.capexBudget != null ? String(company.capexBudget) : "",
      actionPlanEnabled: company.actionPlanEnabled ?? true,
      socialChargesRate:
        company.socialChargesRate != null
          ? String(Math.round(company.socialChargesRate * 100))
          : "",
      confidentialityLevels: company.confidentialityLevels ?? [],
      roleClearance: company.roleClearance ?? {},
      defaultRecognition: company.defaultRecognition ?? "smoothing",
      riskThresholds: company.riskThresholds?.map((t) => ({
        level: t.level,
        minAmount: String(t.minAmount / 1000),
      })),
    });
  }, [company]);

  // Réservé au global admin : redirige tout autre profil (ceinture + bretelles en plus du guard
  // AppShell, qui n'autorise déjà cette route qu'à admin — voir AppShell.tsx).
  useEffect(() => {
    if (role && role !== "admin") {
      router.replace("/admin/companies");
    }
  }, [role, router]);

  const saveSettings = async () => {
    if (!company || !form.name.trim()) return;
    setSaving(true);
    try {
      // Ne jamais assigner `capexBudget`/`socialChargesRate` à `undefined` explicitement —
      // Firestore `setDoc` rejette toute clé valant `undefined` (voir le bug identique corrigé
      // sur AuthUser.confidentialityClearance dans UsersPanel.tsx) : on omet la clé plutôt que de
      // la mettre à `undefined` quand le champ est vidé, ce qui l'efface bien du document. Même
      // précaution pour `riskThresholds` : on ne l'inclut que s'il a été chargé/renseigné dans le
      // formulaire (voir baselineForm/useEffect ci-dessus, qui l'hydratent depuis `company`).
      const trimmedCapex = form.capexBudget.trim();
      const trimmedCharges = form.socialChargesRate.trim();
      const rest = { ...company };
      delete rest.capexBudget;
      delete rest.socialChargesRate;
      await saveCompany({
        ...rest,
        name: form.name,
        industry: form.industry,
        fyStart: form.fyStart,
        fyEnd: form.fyEnd,
        ...(trimmedCapex !== "" ? { capexBudget: Number(trimmedCapex) } : {}),
        actionPlanEnabled: form.actionPlanEnabled,
        ...(trimmedCharges !== "" ? { socialChargesRate: Number(trimmedCharges) / 100 } : {}),
        confidentialityLevels: form.confidentialityLevels,
        roleClearance: form.roleClearance,
        defaultRecognition: form.defaultRecognition ?? "smoothing",
        ...(form.riskThresholds
          ? {
              riskThresholds: form.riskThresholds.map((t) => ({
                level: t.level,
                minAmount: Number(t.minAmount) * 1000,
              })),
            }
          : {}),
      });
    } catch (err) {
      console.error("[betrack] échec de l'enregistrement des paramètres entreprise :", err);
      showToast(
        "Échec de l'enregistrement",
        "Les paramètres n'ont pas pu être sauvegardés.",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  if (role && role !== "admin") return null;

  if (!companyId) {
    return (
      <div className="space-y-4">
        <GuardedLink
          href="/admin/companies"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-bp-coral"
        >
          <ArrowLeft size={14} /> Retour à la liste des entreprises
        </GuardedLink>
        <div className="rounded-xl border border-border bg-bg-elevated p-8 text-center text-sm text-text-secondary">
          Aucune entreprise sélectionnée.
        </div>
      </div>
    );
  }

  if (loaded && !company) {
    return (
      <div className="space-y-4">
        <GuardedLink
          href="/admin/companies"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-bp-coral"
        >
          <ArrowLeft size={14} /> Retour à la liste des entreprises
        </GuardedLink>
        <div className="rounded-xl border border-border bg-bg-elevated p-8 text-center text-sm text-text-secondary">
          Entreprise introuvable ({companyId}).
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <GuardedLink
          href="/admin/companies"
          className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-bp-coral"
        >
          <ArrowLeft size={12} /> Toutes les entreprises
        </GuardedLink>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Building2 size={22} className="text-bp-coral" />
          <h1 className="text-xl font-bold text-text-primary">{company?.name ?? "Entreprise"}</h1>
          {company && (
            <span className="rounded-full bg-bg-surface px-2 py-0.5 text-xs text-text-secondary">
              {company.industry}
            </span>
          )}
        </div>
      </div>

      <div className="flex snap-x gap-2 overflow-x-auto border-b border-border pb-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex min-h-10 shrink-0 snap-start items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-bp-coral text-white"
                  : "border border-border text-text-secondary hover:bg-bg-elevated"
              }`}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {!company ? (
        <p className="text-sm text-text-secondary">Chargement…</p>
      ) : (
        <div>
          {tab === "settings" && (
            <div className="space-y-4">
              <CompanyFieldsEditor
                value={form}
                onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
              />
              <button
                onClick={saveSettings}
                disabled={saving}
                className="rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90 disabled:opacity-50"
              >
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          )}
          {tab === "users" && <UsersPanel scopeCompanyId={company.id} />}
          {tab === "financial-hierarchy" && (
            <HierarchyEditor companies={companies} companyId={company.id} domain="financial" />
          )}
          {tab === "geographic-hierarchy" && (
            <HierarchyEditor companies={companies} companyId={company.id} domain="geographic" />
          )}
          {tab === "projects" && <ProgramsPanel companyId={company.id} />}
          {tab === "lifecycle" && <LifecycleEditor companyId={company.id} />}
          {tab === "data" && <CompanyDataHistoryPanel company={company} />}
          {tab === "database" && <CompanyDatabasePanel company={company} />}
        </div>
      )}
    </div>
  );
}
