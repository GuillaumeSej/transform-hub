import type { Role, RoleDefinition } from "@/types";

/** Portage fidèle de `roles` (legacy/index.html) — nav différente par persona. */
export const roles: Record<Role, RoleDefinition> = {
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
};
