import {
  getPerformanceProfile,
  getPerformanceProfiles,
  getStrategicProfile,
  getStrategicProfiles,
} from "@/lib/roleProfiles";
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
/** Nav du `cto` — même écrans/périmètre que les deux rôles "programme" de la fondation vue
 *  consolidée (`program_sponsor`/`program_owner`, voir types/index.ts) : SEULE leur VISIBILITÉ
 *  diffère (tous les programmes de l'entreprise pour `cto`, seulement ceux dont l'utilisateur est
 *  sponsor/owner pour les deux autres — voir `lib/consolidatedProgramAccess.ts`), pas la nav.
 *  Facteur commun plutôt que dupliqué trois fois, pour que les trois définitions ne puissent pas
 *  diverger accidentellement au fil des rounds futurs (une modification de la nav CTO doit se
 *  répercuter automatiquement sur les deux nouveaux rôles). */
const CTO_LIKE_NAV: RoleDefinition["nav"] = [
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
  // Portes de validation (voir lib/leversLogic.ts::approveLeverGate) : visible pour cto (tous les
  // programmes) et program_sponsor/program_owner (visibilité restreinte à leurs programmes via
  // lib/consolidatedProgramAccess.ts, même mécanisme que le reste de cette nav partagée),
  // réservé au Plan Performance (pas de porte de validation côté Plan Stratégique). `section:
  // "decision"` regroupe l'item sous son propre séparateur, entre le pilotage courant (items sans
  // section) et les données de référence (`section: "reference"`, ex. "hr-etp" ci-dessous) — voir
  // Sidebar.tsx / SECTION_LABEL_KEYS.
  {
    id: "validation",
    icon: "ShieldCheck",
    label: "nav.validation",
    // Plus de restriction `programTypes` : la page /validation est program-type-aware (portes de
    // levier côté Performance, demandes de validation stratégique côté Stratégique) et
    // `resolveUserNav` ne garde que la 1re occurrence d'un id — un item Performance-only masquait
    // l'item Stratégique des profils cumulés.
    section: "decision",
  },
  // Round 13 : plus de `programTypes` sur "hr-etp" — la base ETP est scopée ENTREPRISE, pas
  // programme (voir lib/hooks/useCompanyDepartments.ts), donc visible que le programme actif
  // soit Performance ou Stratégique (contrairement à "hr" ci-dessus, le dashboard RH complet,
  // qui reste lui réservé au Plan Performance).
  { id: "hr-etp", icon: "Users", label: "nav.hrEtp", section: "reference" },
];

export const roles: Record<Role, RoleDefinition> = {
  cto: {
    label: "roles.cto.label",
    short: "roles.cto.short",
    nav: CTO_LIKE_NAV,
  },
  // Fondation vue consolidée multi-programmes (voir types/index.ts) : même nav qu'un `cto` — seule
  // la liste des programmes que `getConsolidatedPerformancePrograms`/`getAuthorizedPrograms` leur
  // rendent visibles diffère, pas les écrans eux-mêmes.
  program_sponsor: {
    label: "roles.programSponsor.label",
    short: "roles.programSponsor.short",
    nav: CTO_LIKE_NAV,
  },
  program_owner: {
    label: "roles.programOwner.label",
    short: "roles.programOwner.short",
    nav: CTO_LIKE_NAV,
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
      {
        id: "validation",
        icon: "ShieldCheck",
        label: "nav.validation",
        programTypes: ["performance"],
        section: "decision",
      },
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
      // File « Réalisés à valider » (impacts cochés réalisés en attente de la finance, audit C4).
      {
        id: "validation",
        icon: "ShieldCheck",
        label: "nav.validation",
        programTypes: ["performance"],
        section: "decision",
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
      { id: "hr-etp", icon: "Users", label: "nav.hrEtp", section: "reference" },
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
      // Round "jalon validation gate" : le pilote stratégique est le SEUL approbateur des demandes
      // de validation de jalon de projet (`ChantierAction.milestoneApproval`, voir
      // `lib/axisLogic.ts::approveMilestoneGate`) — même route/id que `CTO_LIKE_NAV`'s "validation"
      // ci-dessus (la PAGE elle-même est déjà program-type-aware, voir
      // `app/(app)/validation/page.tsx`), ajoutée ICI (nav propre à `strategic_lead`) plutôt que
      // d'ôter le `programTypes: ["performance"]` de `CTO_LIKE_NAV` : changement plus petit/ciblé,
      // suffisant pour le cas courant (`strategic_lead` SEUL, sans profil Performance). Limite
      // connue et acceptée : `resolveUserNav` ne garde que la PREMIÈRE occurrence d'un id (profils
      // Performance résolus avant les profils Stratégiques) — un utilisateur cumulant un profil
      // Performance (`cto`/`program_sponsor`/`program_owner`, seuls rôles à porter "validation" côté
      // Performance) ET `strategic_lead` verrait donc l'item Performance-only l'emporter et
      // resterait sans lien "Validation" en mode Stratégique ; combinaison jugée assez rare pour ne
      // pas justifier de retravailler `resolveUserNav`/`CTO_LIKE_NAV` dans ce lot. `section:
      // "decision"` — même regroupement que `CTO_LIKE_NAV`.
      {
        id: "validation",
        icon: "ShieldCheck",
        label: "nav.validation",
        programTypes: ["strategic"],
        section: "decision",
        badge: "approvals",
      },
      // Round 13 : le pilote du Plan Stratégique peut désormais consulter/compléter la base ETP
      // entreprise (Plan Performance) — voir les commentaires identiques sur `cto`/`hr` ci-dessus.
      { id: "hr-etp", icon: "Users", label: "nav.hrEtp", section: "reference" },
      // Round audit trail Plan Stratégique : réutilise le MÊME id/route qu'`"admin-history"`
      // (ADMIN_NAV_DEFINITIONS.company ci-dessous), pas un item séparé — la page
      // (app/(app)/admin/history/page.tsx) ne teste `isCompanyAdmin` nulle part, elle se contente
      // de scoper le journal à `user.companyId` (voir son composant), donc rien à dupliquer/
      // restructurer pour l'accueillir (exactement le plan déjà noté dans le commentaire de
      // `comex_member` ci-dessous, qui anticipait ce round). `section: "reference"` regroupe
      // l'entrée avec "Base ETP" sous "Données de référence" plutôt qu'avec le pilotage courant —
      // seul `strategic_lead` (pilote) y accède ici, PAS les 5 autres rôles Plan Stratégique ni
      // `comex_member` (demande PO explicite, périmètre de lecture déjà tranché à un round
      // antérieur pour ce dernier).
      { id: "admin-history", icon: "History", label: "nav.history", section: "reference" },
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
      // Validation stratégique (lib/strategicApprovals.ts) : demandes à valider + "Mes demandes".
      {
        id: "validation",
        icon: "ShieldCheck",
        label: "nav.validation",
        programTypes: ["strategic"],
        section: "decision",
        badge: "approvals",
      },
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
      // Validation stratégique (lib/strategicApprovals.ts) : demandes à valider + "Mes demandes".
      {
        id: "validation",
        icon: "ShieldCheck",
        label: "nav.validation",
        programTypes: ["strategic"],
        section: "decision",
        badge: "approvals",
      },
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
      // Validation stratégique (lib/strategicApprovals.ts) : demandes à valider + "Mes demandes".
      {
        id: "validation",
        icon: "ShieldCheck",
        label: "nav.validation",
        programTypes: ["strategic"],
        section: "decision",
        badge: "approvals",
      },
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

  // ─── Membre du COMEX (round 25) — SEUL rôle transverse aux deux pistes (voir PERFORMANCE_ROLES/
  // STRATEGIC_ROLES dans types/index.ts) : lecture seule, nav volontairement réduite aux pages de
  // reporting/consultation des deux plans plutôt qu'aux pages de pilotage opérationnel (finance/
  // hr/operations réservées aux rôles Performance qui les alimentent). "dashboard" est SANS
  // `programTypes` : la route `/dashboard` s'auto-route déjà entre le dashboard exécutif
  // Performance et le dashboard stratégique selon le programme actif (voir
  // `app/(app)/dashboard/page.tsx`), exactement comme `levers` pour `/levers` — un seul item nav
  // sert donc les deux pistes. Cette UI ne fait QUE lister/rendre la nav : l'enforcement réel du
  // caractère lecture-seule (masquage des actions d'édition) est un lot ultérieur, non couvert
  // ici. Round ultérieur prévu : un item nav dédié à l'historique/audit trail (pendant du
  // `"admin-history"` d'ADMIN_NAV_DEFINITIONS ci-dessous, mais visible sans être admin) — il
  // suffira de pousser une entrée supplémentaire dans le tableau `nav` ci-dessous, rien à
  // restructurer pour l'accueillir. Round audit trail Plan Stratégique : ce pattern a depuis été
  // appliqué à `strategic_lead` (voir sa nav ci-dessus) — VOLONTAIREMENT PAS à `comex_member` ici
  // (demande PO explicite : le pilote seul, pas le périmètre de lecture COMEX déjà tranché).
  comex_member: {
    label: "roles.comexMember.label",
    short: "roles.comexMember.short",
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
      // Portes de validation (voir CTO_LIKE_NAV ci-dessus) : un admin peut agir sur n'importe
      // quelle demande en cours (isAnyAdmin, lib/leversLogic.ts::approveLeverGate), doit donc
      // aussi voir la page dédiée. `section: "decision"` — voir le commentaire identique sur
      // CTO_LIKE_NAV ci-dessus.
      { id: "validation", icon: "ShieldCheck", label: "nav.validation", section: "decision" },
      // Round 13 : un admin global n'a pas forcément de profil métier (Performance/Stratégique)
      // qui lui donnerait "hr-etp" par ailleurs — voir la liste d'accès `cto`/`hr`/`strategic_lead`
      // ci-dessus, à laquelle les admins s'ajoutent.
      { id: "hr-etp", icon: "Users", label: "nav.hrEtp", section: "reference" },
    ],
  },
  company: {
    label: "roles.admin_entreprise.label",
    short: "roles.admin_entreprise.short",
    nav: [
      { id: "admin-users", icon: "Users", label: "nav.users" },
      { id: "admin-data", icon: "BarChart3", label: "nav.data" },
      { id: "admin-history", icon: "History", label: "nav.history" },
      { id: "validation", icon: "ShieldCheck", label: "nav.validation", section: "decision" },
      { id: "hr-etp", icon: "Users", label: "nav.hrEtp", section: "reference" },
    ],
  },
};

/** Union dédupliquée (par `NavItem.id`, première occurrence conservée) de la nav de TOUS les
 *  profils/habilitations de l'utilisateur : TOUS les profils Plan Performance (round multi-profils
 *  multi-programmes — un utilisateur peut en avoir plusieurs, un par programme), TOUS les profils
 *  Plan Stratégique, admin global, admin entreprise — dans cet ordre. Point de passage UNIQUE pour
 *  cette logique, consommé par AppShell (garde-fou de routes), Sidebar, Topbar et l'écran de login
 *  (page d'atterrissage post-connexion) : ne pas la dupliquer ailleurs. */
export function resolveUserNav(
  user: Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin"> | null | undefined
): NavItem[] {
  const navLists: NavItem[][] = [];
  for (const profile of getPerformanceProfiles(user)) navLists.push(roles[profile.role].nav);
  for (const profile of getStrategicProfiles(user)) navLists.push(roles[profile.role].nav);
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

/** Clé i18n du titre de la page `/levers` (Plan Performance) : le libellé de l'item de nav
 *  "levers" que l'utilisateur voit dans la barre latérale (même résolution `resolveUserNav`, donc
 *  même profil gagnant en cas de cumul) — la nav fait foi, le titre ne peut plus diverger
 *  (ex. sponsor : « Leviers par étape » dans la nav, pas « Mes leviers »). Repli : bibliothèque. */
export function leversPageTitleKey(
  user: Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin"> | null | undefined
): string {
  return resolveUserNav(user).find((item) => item.id === "levers")?.label ?? "nav.leverLibrary";
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
  validation: "/validation",
};
