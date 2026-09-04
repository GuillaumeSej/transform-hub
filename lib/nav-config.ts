import type { Role, RoleDefinition } from "@/types";

/** Portage fidèle de `roles` (prototype HTML historique, depuis retiré du repo) — nav différente
 * par persona.
 *
 * i18n : `label`/`short` (au niveau du rôle) et chaque `nav[].label` sont désormais des CLÉS de
 * traduction (voir `lib/i18n/dictionaries/*.ts`), pas des libellés littéraux — ce fichier reste la
 * seule source de vérité pour la structure de nav par rôle, résolue via `t()` au point de
 * consommation (Sidebar.tsx, Topbar.tsx, AppShell.tsx, login/page.tsx). Les `id` restent des
 * identifiants internes stables, jamais traduits.
 *
 * Type de programme : un item peut être restreint à certains types de programme
 * (`NavItem.programTypes`) et/ou changer de libellé selon le type actif
 * (`NavItem.labelByProgramType`) — voir `lib/hooks/useActiveProgram.tsx`. Un item SANS
 * `programTypes` reste visible pour tous les types (comportement historique). Concrètement :
 *   - `"levers"` sert les DEUX plans (même route `/levers`, routeur interne selon le type),
 *     simplement relabelé « Axes stratégiques » en mode stratégique ;
 *   - `"kpi"` (nouveau) n'existe que pour un Plan Stratégique ;
 *   - Finance / RH / Base ETP / Workstreams / Opérations n'ont pas de sens sans leviers et sont
 *     donc réservés au Plan Performance. */
export const roles: Record<Role, RoleDefinition> = {
  admin: {
    label: "roles.admin.label",
    short: "roles.admin.short",
    nav: [
      { id: "admin-companies", icon: "Building2", label: "nav.companies" },
      { id: "admin-lifecycle", icon: "Workflow", label: "nav.lifecycle" },
    ],
  },
  admin_entreprise: {
    label: "roles.admin_entreprise.label",
    short: "roles.admin_entreprise.short",
    nav: [
      { id: "admin-users", icon: "Users", label: "nav.users" },
      { id: "admin-data", icon: "BarChart3", label: "nav.data" },
      { id: "admin-history", icon: "History", label: "nav.history" },
    ],
  },
  cto: {
    label: "roles.cto.label",
    short: "roles.cto.short",
    nav: [
      { id: "dashboard", icon: "PieChart", label: "nav.executiveDashboard" },
      {
        id: "levers",
        icon: "Target",
        label: "nav.leverLibrary",
        labelByProgramType: { strategic: "nav.axes" },
      },
      { id: "kpi", icon: "LineChart", label: "nav.kpi", programTypes: ["strategic"] },
      {
        id: "finance",
        icon: "LineChart",
        label: "nav.financeModule",
        programTypes: ["performance"],
      },
      { id: "hr", icon: "Users", label: "nav.hrDashboard", programTypes: ["performance"] },
      { id: "hr-etp", icon: "Users", label: "nav.hrEtp", programTypes: ["performance"] },
    ],
  },
  sponsor: {
    label: "roles.sponsor.label",
    short: "roles.sponsor.short",
    nav: [
      {
        id: "workstreams",
        icon: "Layers",
        label: "nav.workstreamDashboard",
        programTypes: ["performance"],
      },
      {
        id: "levers",
        icon: "Target",
        label: "nav.leverPipeline",
        labelByProgramType: { strategic: "nav.axes" },
      },
      { id: "kpi", icon: "LineChart", label: "nav.kpi", programTypes: ["strategic"] },
    ],
  },
  lever: {
    label: "roles.lever.label",
    short: "roles.lever.short",
    nav: [
      {
        id: "levers",
        icon: "Target",
        label: "nav.myLevers",
        labelByProgramType: { strategic: "nav.axes" },
      },
      { id: "kpi", icon: "LineChart", label: "nav.kpi", programTypes: ["strategic"] },
    ],
  },
  finance: {
    label: "roles.finance.label",
    short: "roles.finance.short",
    nav: [
      {
        id: "finance",
        icon: "LineChart",
        label: "nav.financeModule",
        programTypes: ["performance"],
      },
      {
        id: "levers",
        icon: "Target",
        label: "nav.leverLibrary",
        labelByProgramType: { strategic: "nav.axes" },
      },
      { id: "kpi", icon: "LineChart", label: "nav.kpi", programTypes: ["strategic"] },
    ],
  },
  hr: {
    label: "roles.hr.label",
    short: "roles.hr.short",
    nav: [
      { id: "hr", icon: "PieChart", label: "nav.hrDashboard", programTypes: ["performance"] },
      { id: "hr-etp", icon: "Users", label: "nav.hrEtp", programTypes: ["performance"] },
      {
        id: "levers",
        icon: "Target",
        label: "nav.leverLibrary",
        labelByProgramType: { strategic: "nav.axes" },
      },
      { id: "kpi", icon: "LineChart", label: "nav.kpi", programTypes: ["strategic"] },
    ],
  },
  ops: {
    label: "roles.ops.label",
    short: "roles.ops.short",
    nav: [
      {
        id: "operations",
        icon: "Factory",
        label: "nav.operationsModule",
        programTypes: ["performance"],
      },
      {
        id: "levers",
        icon: "Target",
        label: "nav.linkedLevers",
        labelByProgramType: { strategic: "nav.axes" },
      },
      { id: "kpi", icon: "LineChart", label: "nav.kpi", programTypes: ["strategic"] },
    ],
  },

  // ─── Rôles du Plan Stratégique (organigramme 3-5-15 : axes → chantiers) ──────────────────────
  // Ces 6 rôles n'ont PAS d'écran dédié pour l'instant : ils servent avant tout de valeurs
  // sélectionnables pour « qui est responsable de quoi » (`Indicator.responsibleRoles`,
  // `Chantier.responsibleRoles`). Ils reçoivent néanmoins tous la MÊME nav minimale — axes
  // (`levers`, relabelé « Axes stratégiques » en mode stratégique) + KPI — plutôt qu'une nav vide,
  // pour deux raisons :
  //   1. techniquement, `nav: []` casse `AppShell` : `allowedRoutes` serait vide et le repli
  //      `PAGE_ROUTES[navItems[0]?.id] ?? "/levers"` renverrait en boucle vers une route elle-même
  //      interdite (voir components/shared/AppShell.tsx) ;
  //   2. fonctionnellement, ces profils ont tous besoin de LIRE l'avancement des axes/chantiers et
  //      les indicateurs — c'est le dénominateur commun de leurs responsabilités (rendre compte,
  //      arbitrer, communiquer, consolider). Les écrans dédiés (vue « mon axe » pour le sponsor,
  //      « mon chantier » pour le responsable de chantier) sont un lot ultérieur.
  strategic_lead: {
    label: "roles.strategicLead.label",
    short: "roles.strategicLead.short",
    nav: [
      {
        id: "levers",
        icon: "Target",
        label: "nav.leverLibrary",
        labelByProgramType: { strategic: "nav.axes" },
      },
      { id: "kpi", icon: "LineChart", label: "nav.kpi", programTypes: ["strategic"] },
    ],
  },
  axis_sponsor: {
    label: "roles.axisSponsor.label",
    short: "roles.axisSponsor.short",
    nav: [
      {
        id: "levers",
        icon: "Target",
        label: "nav.leverLibrary",
        labelByProgramType: { strategic: "nav.axes" },
      },
      { id: "kpi", icon: "LineChart", label: "nav.kpi", programTypes: ["strategic"] },
    ],
  },
  chantier_owner: {
    label: "roles.chantierOwner.label",
    short: "roles.chantierOwner.short",
    nav: [
      {
        id: "levers",
        icon: "Target",
        label: "nav.leverLibrary",
        labelByProgramType: { strategic: "nav.axes" },
      },
      { id: "kpi", icon: "LineChart", label: "nav.kpi", programTypes: ["strategic"] },
    ],
  },
  chantier_contributor: {
    label: "roles.chantierContributor.label",
    short: "roles.chantierContributor.short",
    nav: [
      {
        id: "levers",
        icon: "Target",
        label: "nav.leverLibrary",
        labelByProgramType: { strategic: "nav.axes" },
      },
      { id: "kpi", icon: "LineChart", label: "nav.kpi", programTypes: ["strategic"] },
    ],
  },
  internal_comm: {
    label: "roles.internalComm.label",
    short: "roles.internalComm.short",
    nav: [
      {
        id: "levers",
        icon: "Target",
        label: "nav.leverLibrary",
        labelByProgramType: { strategic: "nav.axes" },
      },
      { id: "kpi", icon: "LineChart", label: "nav.kpi", programTypes: ["strategic"] },
    ],
  },
  budget_control: {
    label: "roles.budgetControl.label",
    short: "roles.budgetControl.short",
    nav: [
      {
        id: "levers",
        icon: "Target",
        label: "nav.leverLibrary",
        labelByProgramType: { strategic: "nav.axes" },
      },
      { id: "kpi", icon: "LineChart", label: "nav.kpi", programTypes: ["strategic"] },
    ],
  },
};

export const PAGE_ROUTES: Record<string, string> = {
  dashboard: "/dashboard",
  workstreams: "/workstreams",
  levers: "/levers",
  kpi: "/kpi",
  finance: "/finance",
  hr: "/hr",
  "hr-etp": "/hr/etp",
  operations: "/operations",
  "admin-companies": "/admin/companies",
  "admin-users": "/admin/users",
  "admin-lifecycle": "/admin/lifecycle",
  "admin-data": "/admin/data",
  "admin-history": "/admin/history",
};
