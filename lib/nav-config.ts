import { getPerformanceProfile, getStrategicProfile } from "@/lib/roleProfiles";
import type { AuthUser, NavItem, Role, RoleDefinition } from "@/types";

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
 *   - `"effectifs"` (besoin vs disponible par équipe sur les chantiers, round 13) n'existe que
 *     pour un Plan Stratégique — à ne pas confondre avec `"hr"` (dashboard RH complet, mouvements
 *     compris) ci-dessous, qui reste réservé au Plan Performance et porte une tout autre donnée ;
 *   - `"hr-etp"` (base ETP nominative, `Employee[]`) fait exception depuis le round 13 : la base
 *     est scopée ENTREPRISE (pas programme, voir `lib/hooks/useCompanyDepartments.ts`), donc SANS
 *     `programTypes` sur cet item précis — visible pour les rôles `cto`/`hr`/`strategic_lead` et
 *     les admins (voir `ADMIN_NAV_DEFINITIONS` plus bas), quel que soit le programme actif ; c'est
 *     elle qui alimente désormais `"effectifs"` (comparaison besoin/disponible par équipe) ;
 *   - Finance / RH (dashboard) / Workstreams / Opérations n'ont pas de sens sans leviers et
 *     restent donc réservés au Plan Performance. */
export const roles: Record<Role, RoleDefinition> = {
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
      { id: "effectifs", icon: "Users", label: "nav.effectifs", programTypes: ["strategic"] },
      {
        id: "finance",
        icon: "LineChart",
        label: "nav.financeModule",
        programTypes: ["performance"],
      },
      { id: "hr", icon: "Users", label: "nav.hrDashboard", programTypes: ["performance"] },
      // Round 13 : plus de `programTypes` sur "hr-etp" — la base ETP est scopée ENTREPRISE, pas
      // programme (voir lib/hooks/useCompanyDepartments.ts), donc visible que le programme actif
      // soit Performance ou Stratégique (contrairement à "hr" ci-dessus, le dashboard RH complet,
      // qui reste lui réservé au Plan Performance).
      { id: "hr-etp", icon: "Users", label: "nav.hrEtp" },
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
      { id: "effectifs", icon: "Users", label: "nav.effectifs", programTypes: ["strategic"] },
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
      { id: "effectifs", icon: "Users", label: "nav.effectifs", programTypes: ["strategic"] },
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
      { id: "effectifs", icon: "Users", label: "nav.effectifs", programTypes: ["strategic"] },
    ],
  },
  hr: {
    label: "roles.hr.label",
    short: "roles.hr.short",
    nav: [
      { id: "hr", icon: "PieChart", label: "nav.hrDashboard", programTypes: ["performance"] },
      // Round 13 : voir le commentaire identique sur le rôle `cto` ci-dessus.
      { id: "hr-etp", icon: "Users", label: "nav.hrEtp" },
      {
        id: "levers",
        icon: "Target",
        label: "nav.leverLibrary",
        labelByProgramType: { strategic: "nav.axes" },
      },
      { id: "kpi", icon: "LineChart", label: "nav.kpi", programTypes: ["strategic"] },
      { id: "effectifs", icon: "Users", label: "nav.effectifs", programTypes: ["strategic"] },
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
      { id: "effectifs", icon: "Users", label: "nav.effectifs", programTypes: ["strategic"] },
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
      { id: "effectifs", icon: "Users", label: "nav.effectifs", programTypes: ["strategic"] },
      // Round 13 : le pilote du Plan Stratégique peut désormais consulter/compléter la base ETP
      // entreprise (Plan Performance) — voir les commentaires identiques sur `cto`/`hr` ci-dessus.
      { id: "hr-etp", icon: "Users", label: "nav.hrEtp" },
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
      { id: "effectifs", icon: "Users", label: "nav.effectifs", programTypes: ["strategic"] },
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
      { id: "effectifs", icon: "Users", label: "nav.effectifs", programTypes: ["strategic"] },
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
      { id: "effectifs", icon: "Users", label: "nav.effectifs", programTypes: ["strategic"] },
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
      { id: "effectifs", icon: "Users", label: "nav.effectifs", programTypes: ["strategic"] },
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
      { id: "effectifs", icon: "Users", label: "nav.effectifs", programTypes: ["strategic"] },
    ],
  },
};

/** Nav des deux habilitations d'administration (`AuthUser.isGlobalAdmin`/`isCompanyAdmin`), ADDITIVES
 *  aux profils métier (`roles` ci-dessus) plutôt que des valeurs de `Role` — voir le commentaire sur
 *  `AuthUser` dans types/index.ts. Portées séparément de `roles` car ce ne sont plus des membres de
 *  l'union `Role` : un utilisateur peut cumuler un profil métier ET l'une de ces habilitations
 *  (jamais les deux habilitations à la fois en pratique, mais rien ne l'empêche techniquement). */
export const ADMIN_NAV_DEFINITIONS: { global: RoleDefinition; company: RoleDefinition } = {
  global: {
    label: "roles.admin.label",
    short: "roles.admin.short",
    nav: [
      { id: "admin-companies", icon: "Building2", label: "nav.companies" },
      // Round 13 : un admin global n'a pas forcément de profil métier (Performance/Stratégique)
      // qui lui donnerait "hr-etp" par ailleurs — voir la liste d'accès `cto`/`hr`/`strategic_lead`
      // ci-dessus, à laquelle les admins s'ajoutent.
      { id: "hr-etp", icon: "Users", label: "nav.hrEtp" },
    ],
  },
  company: {
    label: "roles.admin_entreprise.label",
    short: "roles.admin_entreprise.short",
    nav: [
      { id: "admin-users", icon: "Users", label: "nav.users" },
      { id: "admin-data", icon: "BarChart3", label: "nav.data" },
      { id: "admin-history", icon: "History", label: "nav.history" },
      { id: "hr-etp", icon: "Users", label: "nav.hrEtp" },
    ],
  },
};

/** Union dédupliquée (par `NavItem.id`, première occurrence conservée) de la nav de TOUS les
 *  profils/habilitations de l'utilisateur : profil Plan Performance, profil Plan Stratégique,
 *  admin global, admin entreprise — dans cet ordre. Point de passage UNIQUE pour cette logique,
 *  consommé par AppShell (garde-fou de routes), Sidebar, Topbar et l'écran de login (page
 *  d'atterrissage post-connexion) : ne pas la dupliquer ailleurs. */
export function resolveUserNav(
  user: Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin"> | null | undefined
): NavItem[] {
  const navLists: NavItem[][] = [];
  const performanceProfile = getPerformanceProfile(user);
  const strategicProfile = getStrategicProfile(user);
  if (performanceProfile) navLists.push(roles[performanceProfile.role].nav);
  if (strategicProfile) navLists.push(roles[strategicProfile.role].nav);
  if (user?.isGlobalAdmin) navLists.push(ADMIN_NAV_DEFINITIONS.global.nav);
  if (user?.isCompanyAdmin) navLists.push(ADMIN_NAV_DEFINITIONS.company.nav);

  const seen = new Set<string>();
  const result: NavItem[] = [];
  for (const list of navLists) {
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}

/** `RoleDefinition` (label/short) à afficher pour l'utilisateur — pour un simple badge texte
 *  (Sidebar/Topbar), PAS pour des vérifications de permission. Priorité : profil Plan Performance,
 *  puis profil Plan Stratégique, puis admin global, puis admin entreprise. `null` = aucun profil ni
 *  habilitation admin (cas théorique, l'appelant doit alors se rabattre sur `user.name`/générique). */
export function getDisplayRoleDefinition(
  user: Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin"> | null | undefined
): RoleDefinition | null {
  const performanceProfile = getPerformanceProfile(user);
  if (performanceProfile) return roles[performanceProfile.role];
  const strategicProfile = getStrategicProfile(user);
  if (strategicProfile) return roles[strategicProfile.role];
  if (user?.isGlobalAdmin) return ADMIN_NAV_DEFINITIONS.global;
  if (user?.isCompanyAdmin) return ADMIN_NAV_DEFINITIONS.company;
  return null;
}

export const PAGE_ROUTES: Record<string, string> = {
  dashboard: "/dashboard",
  workstreams: "/workstreams",
  levers: "/levers",
  kpi: "/kpi",
  effectifs: "/effectifs",
  finance: "/finance",
  hr: "/hr",
  "hr-etp": "/hr/etp",
  operations: "/operations",
  "admin-companies": "/admin/companies",
  "admin-users": "/admin/users",
  "admin-data": "/admin/data",
  "admin-history": "/admin/history",
};
