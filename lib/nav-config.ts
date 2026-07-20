import type { Role, RoleDefinition } from "@/types";

/** Portage fidèle de `roles` (legacy/index.html) — nav différente par persona. */
export const roles: Record<Role, RoleDefinition> = {
  admin: {
    label: "Administrator",
    short: "Admin",
    nav: [
      { id: "admin-companies", icon: "Building2", label: "Entreprises" },
      { id: "admin-projects", icon: "FolderKanban", label: "Projets" },
      { id: "admin-users", icon: "Users", label: "Utilisateurs" },
      { id: "admin-lifecycle", icon: "Workflow", label: "Cycle de vie" },
      { id: "dashboard", icon: "PieChart", label: "Executive Dashboard" },
    ],
  },
  admin_entreprise: {
    label: "Admin Entreprise",
    short: "Admin ENT",
    nav: [
      { id: "admin-users", icon: "Users", label: "Utilisateurs" },
      { id: "admin-lifecycle", icon: "Workflow", label: "Cycle de vie" },
      { id: "admin-history", icon: "History", label: "Historique" },
    ],
  },
  cto: {
    label: "Chief Transformation Officer",
    short: "CTO",
    nav: [
      { id: "dashboard", icon: "PieChart", label: "Executive Dashboard" },
      { id: "levers", icon: "Target", label: "Lever Library" },
    ],
  },
  sponsor: {
    label: "Workstream Sponsor",
    short: "Sponsor",
    nav: [
      { id: "workstreams", icon: "Layers", label: "Workstream Dashboard" },
      { id: "levers", icon: "Target", label: "Lever Pipeline" },
    ],
  },
  lever: {
    label: "Lever Owner",
    short: "PM",
    nav: [{ id: "levers", icon: "Target", label: "My Levers" }],
  },
  finance: {
    label: "Finance Controller",
    short: "Finance",
    nav: [
      { id: "finance", icon: "LineChart", label: "Finance Module" },
      { id: "levers", icon: "Target", label: "Lever Library" },
    ],
  },
  hr: {
    label: "HR Director",
    short: "HR",
    nav: [
      { id: "hr", icon: "PieChart", label: "Dashboard RH" },
      { id: "hr-etp", icon: "Users", label: "Base ETP" },
      { id: "levers", icon: "Target", label: "Lever Library" },
    ],
  },
  ops: {
    label: "Operations Manager",
    short: "Ops",
    nav: [
      { id: "operations", icon: "Factory", label: "Operations Module" },
      { id: "levers", icon: "Target", label: "Linked Levers" },
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
  "admin-projects": "/admin/projects",
  "admin-users": "/admin/users",
  "admin-lifecycle": "/admin/lifecycle",
  "admin-history": "/admin/history",
};
