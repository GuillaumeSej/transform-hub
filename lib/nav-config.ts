import type { Role, RoleDefinition } from "@/types";

/** Portage fidèle de `roles` (legacy/index.html) — nav différente par persona.
 *
 * i18n : `label`/`short` (au niveau du rôle) et chaque `nav[].label` sont désormais des CLÉS de
 * traduction (voir `lib/i18n/dictionaries/*.ts`), pas des libellés littéraux — ce fichier reste la
 * seule source de vérité pour la structure de nav par rôle, résolue via `t()` au point de
 * consommation (Sidebar.tsx, Topbar.tsx, AppShell.tsx, login/page.tsx). Les `id` restent des
 * identifiants internes stables, jamais traduits. */
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
      { id: "levers", icon: "Target", label: "nav.leverLibrary" },
    ],
  },
  sponsor: {
    label: "roles.sponsor.label",
    short: "roles.sponsor.short",
    nav: [
      { id: "workstreams", icon: "Layers", label: "nav.workstreamDashboard" },
      { id: "levers", icon: "Target", label: "nav.leverPipeline" },
    ],
  },
  lever: {
    label: "roles.lever.label",
    short: "roles.lever.short",
    nav: [{ id: "levers", icon: "Target", label: "nav.myLevers" }],
  },
  finance: {
    label: "roles.finance.label",
    short: "roles.finance.short",
    nav: [
      { id: "finance", icon: "LineChart", label: "nav.financeModule" },
      { id: "levers", icon: "Target", label: "nav.leverLibrary" },
    ],
  },
  hr: {
    label: "roles.hr.label",
    short: "roles.hr.short",
    nav: [
      { id: "hr", icon: "PieChart", label: "nav.hrDashboard" },
      { id: "hr-etp", icon: "Users", label: "nav.hrEtp" },
      { id: "levers", icon: "Target", label: "nav.leverLibrary" },
    ],
  },
  ops: {
    label: "roles.ops.label",
    short: "roles.ops.short",
    nav: [
      { id: "operations", icon: "Factory", label: "nav.operationsModule" },
      { id: "levers", icon: "Target", label: "nav.linkedLevers" },
    ],
  },
};

export const PAGE_ROUTES: Record<string, string> = {
  dashboard: "/dashboard",
  workstreams: "/workstreams",
  levers: "/levers",
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
