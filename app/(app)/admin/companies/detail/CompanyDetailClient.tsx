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
  BarChart3,
  FolderKanban,
  SlidersHorizontal,
  UserPlus,
} from "lucide-react";
import type {
  AuthUser,
  Chantier,
  Company,
  Indicator,
  Lever,
  Program,
  StrategicAxis,
} from "@/types";
import {
  subscribeCompanies,
  saveCompany,
  subscribePrograms,
  subscribeUsers,
} from "@/lib/firestore/admin";
import { subscribeStrategicAxes } from "@/lib/firestore/strategicAxes";
import { subscribeChantiers } from "@/lib/firestore/chantiers";
import { subscribeLevers } from "@/lib/firestore/levers";
import { subscribeIndicators } from "@/lib/firestore/indicators";
import {
  computeCompanyOnboardingSteps,
  countConfidentialityLevelUsage,
  type CompanyOnboardingStepId,
} from "@/lib/companyOnboarding";
import { resolveProgramType } from "@/lib/axisLogic";
import { CompanyOnboardingChecklist } from "@/components/admin/CompanyOnboardingChecklist";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import {
  CompanyFieldsEditor,
  DEFAULT_COMPANY_FORM,
  type CompanyFormState,
} from "@/components/admin/CompanyFieldsEditor";
import { ImpactConfigEditor } from "@/components/admin/ImpactConfigEditor";
import { UsersPanel } from "@/components/admin/UsersPanel";
import { HierarchyEditor } from "@/components/admin/HierarchyEditor";
import { ProgramsPanel } from "@/components/admin/ProgramsPanel";
import { ProgramConfigEditor } from "@/components/admin/ProgramConfigEditor";
import { CompanyDataHistoryPanel } from "@/components/admin/CompanyDataHistoryPanel";
import { CompanyDisplaySettingsPanel } from "@/components/admin/CompanyDisplaySettingsPanel";
import { StrategicPlanOnboarding } from "@/components/admin/StrategicPlanOnboarding";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { normalizeRoleClearance } from "@/lib/confidentiality";

type TabId =
  | "settings"
  | "configuration"
  | "impact-config"
  | "users"
  | "financial-hierarchy"
  | "geographic-hierarchy"
  | "projects"
  | "data";

const TAB_IDS: TabId[] = [
  "settings",
  "configuration",
  "impact-config",
  "users",
  "financial-hierarchy",
  "geographic-hierarchy",
  "projects",
  "data",
];

/** Un `?tab=` d'URL est une donnée non fiable : on ne l'accepte que s'il désigne un onglet réel. */
function isTabId(value: string | null): value is TabId {
  return value != null && (TAB_IDS as string[]).includes(value);
}

/** Comparaison simple (JSON stringify) — suffisant vu la taille du formulaire, et robuste au
 *  fait que confidentialityLevels et roleClearance sont des objets/tableaux "plats". */
function companyFormEquals(a: CompanyFormState, b: CompanyFormState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function companyDetailTabs(
  t: (key: string, fallback?: string) => string
): { id: TabId; label: string; icon: typeof Building2 }[] {
  return [
    { id: "settings", label: t("adminCompanies.tab.settings", "Paramètres"), icon: Building2 },
    {
      id: "configuration",
      label: t("adminCompanies.tab.configuration", "Configuration"),
      icon: SlidersHorizontal,
    },
    {
      id: "impact-config",
      label: t("adminCompanies.tab.impactConfig", "Types & natures"),
      icon: SlidersHorizontal,
    },
    { id: "users", label: t("nav.users", "Utilisateurs"), icon: Users },
    {
      id: "financial-hierarchy",
      label: t("nav.hierarchy", "Arborescence financière"),
      icon: Network,
    },
    {
      id: "geographic-hierarchy",
      label: t("adminCompanies.tab.geoHierarchy", "Arborescence géographique"),
      icon: Globe2,
    },
    { id: "projects", label: t("adminCompanies.tab.programs", "Programmes"), icon: FolderKanban },
    {
      id: "data",
      label: t("adminCompanies.tab.dataHistory", "Données & Historique"),
      icon: BarChart3,
    },
  ];
}

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
  const { t } = useTranslation();
  const TABS = companyDetailTabs(t);
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isGlobalAdmin } = useRole();
  const { showToast } = useToast();
  const companyId = searchParams.get("id") ?? "";
  // Onglet d'arrivée pilotable par l'URL : le sélecteur de programme du Topbar amène le global
  // admin ici directement sur l'onglet « Programmes » du programme qu'il vient de choisir (voir
  // components/shared/ProgramSwitcher.tsx). Sans paramètre, comportement historique : « Paramètres ».
  const urlTab = searchParams.get("tab");
  const urlManageProgram = searchParams.get("manageProgram");
  // `?onboarding=strategic` : posé par `/admin/companies` juste après la CRÉATION d'une entreprise
  // — propose en tête de page de démarrer son plan stratégique (import Excel en option primaire,
  // saisie manuelle en secondaire), voir `StrategicPlanOnboarding`.
  const showStrategicOnboarding = searchParams.get("onboarding") === "strategic";

  const [companies, setCompanies] = useState<Company[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<TabId>(() => (isTabId(urlTab) ? urlTab : "settings"));
  // Ouvre le formulaire UsersPanel avec « Admin entreprise » pré-coché (étape 2 de la mise en place).
  const [createAdminSignal, setCreateAdminSignal] = useState(0);
  const [form, setForm] = useState<CompanyFormState>(DEFAULT_COMPANY_FORM);
  const [saving, setSaving] = useState(false);

  // Ré-appliqué à chaque changement de `?tab=` (et pas seulement au montage) : arriver ici depuis
  // le Topbar alors qu'on y est déjà ne remonte pas le composant. La dépendance sur `urlTab` seul
  // garantit qu'un clic manuel sur un autre onglet n'est jamais écrasé.
  useEffect(() => {
    if (isTabId(urlTab)) setTab(urlTab);
  }, [urlTab]);

  useEffect(() => {
    const unsub = subscribeCompanies((list) => {
      setCompanies(list);
      setLoaded(true);
    }, companyId);
    return unsub;
  }, [companyId]);

  const company = useMemo(() => companies.find((c) => c.id === companyId), [companies, companyId]);

  // Données de la checklist « Mise en place » (voir lib/companyOnboarding.ts) et du décompte
  // d'usage des niveaux de confidentialité (avertissement au retrait/renommage d'un niveau).
  // Abonnements scopés sur l'entreprise, réservés au global admin (seul profil admis ici).
  const [companyUsers, setCompanyUsers] = useState<AuthUser[]>([]);
  const [companyPrograms, setCompanyPrograms] = useState<Program[]>([]);
  const [companyAxes, setCompanyAxes] = useState<StrategicAxis[]>([]);
  const [companyChantiers, setCompanyChantiers] = useState<Chantier[]>([]);
  const [companyLevers, setCompanyLevers] = useState<Lever[]>([]);
  const [companyIndicators, setCompanyIndicators] = useState<Indicator[]>([]);
  useEffect(() => {
    if (!isGlobalAdmin || !companyId) return;
    const unsubs = [
      subscribeUsers(setCompanyUsers, companyId),
      subscribePrograms(setCompanyPrograms, companyId),
      subscribeStrategicAxes(companyId, setCompanyAxes),
      subscribeChantiers(companyId, setCompanyChantiers),
      subscribeLevers(setCompanyLevers, companyId),
      subscribeIndicators(companyId, setCompanyIndicators),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [isGlobalAdmin, companyId]);

  const onboardingSteps = useMemo(
    () =>
      computeCompanyOnboardingSteps({
        company,
        users: companyUsers,
        programs: companyPrograms,
        axes: companyAxes,
      }),
    [company, companyUsers, companyPrograms, companyAxes]
  );
  const hasCompanyAdmin = onboardingSteps.find((s) => s.id === "companyAdmin")?.done ?? false;
  const levelUsage = useMemo(
    () =>
      countConfidentialityLevelUsage({
        levers: companyLevers,
        axes: companyAxes,
        chantiers: companyChantiers,
        indicators: companyIndicators,
        users: companyUsers,
      }),
    [companyLevers, companyAxes, companyChantiers, companyIndicators, companyUsers]
  );

  /** Bouton d'une étape de la checklist : ouvre l'onglet concerné puis fait défiler jusqu'à la
   *  section (l'onglet n'est rendu qu'après le changement d'état, d'où le léger différé). */
  const goToOnboardingStep = (step: CompanyOnboardingStepId) => {
    const scrollTo = (elementId: string) =>
      window.setTimeout(
        () =>
          document
            .getElementById(elementId)
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        50
      );
    if (step === "strategicPlan" && company) {
      const strategic = companyPrograms.find((p) => resolveProgramType(p) === "strategic");
      // Pas encore de programme stratégique : parcours d'import Excel (crée le programme à la
      // confirmation). Sinon, fiche du programme existant — ne jamais en créer un second.
      router.replace(
        strategic
          ? `/admin/companies/detail?id=${encodeURIComponent(company.id)}&tab=projects&manageProgram=${encodeURIComponent(strategic.id)}`
          : `/admin/companies/detail?id=${encodeURIComponent(company.id)}&onboarding=strategic`
      );
      if (strategic) setTab("projects");
      scrollTo(strategic ? "company-detail-tabs" : "company-strategic-onboarding");
      return;
    }
    const target: Record<CompanyOnboardingStepId, TabId> = {
      company: "settings",
      companyAdmin: "users",
      settings: "projects",
      confidentiality: "settings",
      strategicPlan: "projects",
    };
    setTab(target[step]);
    if (step === "companyAdmin" && !hasCompanyAdmin) setCreateAdminSignal((n) => n + 1);
    scrollTo(step === "confidentiality" ? "company-confidentiality-levels" : "company-detail-tabs");
  };

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
      confidentialityLevels: company.confidentialityLevels ?? [],
      directions: company.directions ?? [],
      roleClearance: normalizeRoleClearance(
        company.roleClearance,
        company.confidentialityLevels ?? []
      ),
      riskThresholds: company.riskThresholds?.map((t) => ({
        level: t.level,
        minAmount: String(t.minAmount / 1000),
        delayDays: t.delayDays != null ? String(t.delayDays) : "",
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
      confidentialityLevels: company.confidentialityLevels ?? [],
      directions: company.directions ?? [],
      roleClearance: normalizeRoleClearance(
        company.roleClearance,
        company.confidentialityLevels ?? []
      ),
      riskThresholds: company.riskThresholds?.map((t) => ({
        level: t.level,
        minAmount: String(t.minAmount / 1000),
        delayDays: t.delayDays != null ? String(t.delayDays) : "",
      })),
    });
  }, [company]);

  // Réservé au global admin : redirige tout autre profil (ceinture + bretelles en plus du guard
  // AppShell, qui n'autorise déjà cette route qu'à admin — voir AppShell.tsx).
  useEffect(() => {
    if (!isGlobalAdmin) {
      router.replace("/admin/companies");
    }
  }, [isGlobalAdmin, router]);

  const saveSettings = async () => {
    if (!company || !form.name.trim()) return;
    setSaving(true);
    try {
      // Ne jamais assigner un champ optionnel à `undefined` explicitement — Firestore `setDoc`
      // rejette toute clé valant `undefined` (voir le bug identique corrigé sur
      // AuthUser.confidentialityClearance dans UsersPanel.tsx) : on omet la clé plutôt que de la
      // mettre à `undefined`. Pour `riskThresholds` : on ne l'inclut que s'il a été
      // chargé/renseigné dans le formulaire (voir baselineForm/useEffect ci-dessus, qui
      // l'hydratent depuis `company`), et `delayDays` par seuil n'est ajouté que s'il est saisi.
      await saveCompany({
        ...company,
        name: form.name,
        industry: form.industry,
        fyStart: form.fyStart,
        fyEnd: form.fyEnd,
        confidentialityLevels: form.confidentialityLevels,
        directions: form.directions,
        roleClearance: form.roleClearance,
        ...(form.riskThresholds
          ? {
              riskThresholds: form.riskThresholds.map((t) => ({
                level: t.level,
                minAmount: Number(t.minAmount) * 1000,
                ...(t.delayDays.trim() !== "" ? { delayDays: Number(t.delayDays) } : {}),
              })),
            }
          : {}),
      });
    } catch (err) {
      console.error("[betrack] échec de l'enregistrement des paramètres entreprise :", err);
      showToast(
        t("adminCompanies.saveFailedTitle", "Échec de l'enregistrement"),
        t("adminCompanies.settingsSaveFailedBody", "Les paramètres n'ont pas pu être sauvegardés."),
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  if (!isGlobalAdmin) return null;

  if (!companyId) {
    return (
      <div className="space-y-4">
        <GuardedLink
          href="/admin/companies"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-bp-coral"
        >
          <ArrowLeft size={14} />{" "}
          {t("adminCompanies.backToList", "Retour à la liste des entreprises")}
        </GuardedLink>
        <div className="rounded-xl border border-border bg-bg-elevated p-8 text-center text-sm text-text-secondary">
          {t("adminCompanies.noneSelected", "Aucune entreprise sélectionnée.")}
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
          <ArrowLeft size={14} />{" "}
          {t("adminCompanies.backToList", "Retour à la liste des entreprises")}
        </GuardedLink>
        <div className="rounded-xl border border-border bg-bg-elevated p-8 text-center text-sm text-text-secondary">
          {t("adminCompanies.notFound", "Entreprise introuvable ({id}).").replace(
            "{id}",
            companyId
          )}
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
          <ArrowLeft size={12} /> {t("adminCompanies.allCompanies", "Toutes les entreprises")}
        </GuardedLink>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Building2 size={22} className="text-bp-coral" />
          <h1 className="text-xl font-bold text-text-primary">
            {company?.name ?? t("adminCompanies.fallbackName", "Entreprise")}
          </h1>
          {company && (
            <span className="rounded-full bg-bg-surface px-2 py-0.5 text-xs text-text-secondary">
              {company.industry}
            </span>
          )}
        </div>
      </div>

      {company && (
        <CompanyOnboardingChecklist steps={onboardingSteps} onGoTo={goToOnboardingStep} />
      )}

      {showStrategicOnboarding && company && (
        <div id="company-strategic-onboarding" className="scroll-mt-4">
          <StrategicPlanOnboarding
            companyId={company.id}
            onManual={() =>
              router.replace(
                `/admin/companies/detail?id=${encodeURIComponent(company.id)}&tab=projects`
              )
            }
            onOpenProgram={(programId) =>
              router.replace(
                `/admin/companies/detail?id=${encodeURIComponent(company.id)}&tab=projects&manageProgram=${encodeURIComponent(programId)}`
              )
            }
            onDismiss={() =>
              router.replace(`/admin/companies/detail?id=${encodeURIComponent(company.id)}`)
            }
          />
        </div>
      )}

      <div
        id="company-detail-tabs"
        className="flex snap-x scroll-mt-4 gap-2 overflow-x-auto border-b border-border pb-2"
      >
        {TABS.map((tabDef) => {
          const Icon = tabDef.icon;
          const active = tab === tabDef.id;
          return (
            <button
              key={tabDef.id}
              onClick={() => setTab(tabDef.id)}
              className={`flex min-h-10 shrink-0 snap-start items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-bp-coral text-white"
                  : "border border-border text-text-secondary hover:bg-bg-elevated"
              }`}
            >
              <Icon size={14} /> {tabDef.label}
            </button>
          );
        })}
      </div>

      {!company ? (
        <p className="text-sm text-text-secondary">{t("adminCompanies.loading", "Chargement…")}</p>
      ) : (
        <div>
          {tab === "settings" && (
            <div className="space-y-4">
              <CompanyFieldsEditor
                value={form}
                onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
                levelUsage={levelUsage}
              />
              <button
                onClick={saveSettings}
                disabled={saving}
                className="rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90 disabled:opacity-50"
              >
                {saving
                  ? t("adminCompanies.saving", "Enregistrement…")
                  : t("common.save", "Enregistrer")}
              </button>
              <CompanyDisplaySettingsPanel companyId={company.id} />
            </div>
          )}
          {tab === "configuration" && <ProgramConfigEditor companyId={company.id} />}
          {tab === "impact-config" && <ImpactConfigEditor companyId={company.id} />}
          {tab === "users" && (
            <div className="space-y-3">
              {/* Étape 2 de la mise en place : le premier accès client EST le compte admin
                  d'entreprise. Création via le formulaire unique de UsersPanel (pas de doublon). */}
              {!hasCompanyAdmin && (
                <div className="flex items-start gap-2 rounded-lg border border-bp-coral/40 bg-bp-coral/5 p-3 text-xs text-text-primary">
                  <UserPlus size={14} className="mt-0.5 shrink-0 text-bp-coral" />
                  <div className="flex-1 space-y-2">
                    <p>
                      {t(
                        "admin.onboarding.companyAdmin.hintShort",
                        "Aucun admin d'entreprise pour ce client. Créez son premier accès : il gérera ensuite ses utilisateurs et leurs habilitations de confidentialité."
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => setCreateAdminSignal((n) => n + 1)}
                      className="rounded-md bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                    >
                      {t("admin.onboarding.companyAdmin.create", "Créer l'admin entreprise")}
                    </button>
                  </div>
                </div>
              )}
              <UsersPanel
                scopeCompanyId={company.id}
                createCompanyAdminSignal={createAdminSignal}
              />
            </div>
          )}
          {tab === "financial-hierarchy" && (
            <HierarchyEditor companies={companies} companyId={company.id} domain="financial" />
          )}
          {tab === "geographic-hierarchy" && (
            <HierarchyEditor companies={companies} companyId={company.id} domain="geographic" />
          )}
          {tab === "projects" && (
            <ProgramsPanel companyId={company.id} initialManagedProgramId={urlManageProgram} />
          )}
          {tab === "data" && <CompanyDataHistoryPanel company={company} />}
        </div>
      )}
    </div>
  );
}
