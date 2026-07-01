import type { Role, RoleDefinition } from "@/types";

/** Portage fidèle de `roles` (legacy/index.html) — nav différente par persona. */
export const roles: Record<Role, RoleDefinition> = {
  cto: {
    label: "Chief Transformation Officer",
    short: "CTO",
    nav: [
      { id: "dashboard", icon: "PieChart", label: "Executive Dashboard" },
      { id: "workstreams", icon: "Layers", label: "Workstreams" },
      { id: "levers", icon: "Target", label: "Lever Library" },
      { id: "scenarios", icon: "FlaskConical", label: "Scenarios" },
      { id: "reporting", icon: "BarChart3", label: "Reporting" },
      { id: "governance", icon: "TriangleAlert", label: "Risks & Alerts", badge: "alerts" },
    ],
  },
  sponsor: {
    label: "Workstream Sponsor",
    short: "Sponsor",
    nav: [
      { id: "workstreams", icon: "Layers", label: "My Workstream" },
      { id: "levers", icon: "Target", label: "Lever Pipeline" },
      { id: "scenarios", icon: "FlaskConical", label: "What-if Scenarios" },
      { id: "reporting", icon: "BarChart3", label: "Performance" },
    ],
  },
  lever: {
    label: "Lever Owner",
    short: "PM",
    nav: [
      { id: "levers", icon: "Target", label: "My Levers" },
      { id: "reporting", icon: "ListChecks", label: "Action Plans" },
      { id: "governance", icon: "MessageCircle", label: "Collaboration" },
    ],
  },
  finance: {
    label: "Finance Controller",
    short: "Finance",
    nav: [
      { id: "finance", icon: "LineChart", label: "Finance Module" },
      { id: "levers", icon: "Target", label: "Lever Library" },
      { id: "scenarios", icon: "FlaskConical", label: "Scenarios" },
      { id: "governance", icon: "History", label: "Audit Trail" },
    ],
  },
  hr: {
    label: "HR Director",
    short: "HR",
    nav: [
      { id: "hr", icon: "Users", label: "HR Module" },
      { id: "levers", icon: "Target", label: "Lever Library" },
      { id: "reporting", icon: "BarChart3", label: "Reporting" },
    ],
  },
  ops: {
    label: "Operations Manager",
    short: "Ops",
    nav: [
      { id: "operations", icon: "Factory", label: "Operations Module" },
      { id: "levers", icon: "Target", label: "Linked Levers" },
      { id: "reporting", icon: "BarChart3", label: "KPI Reporting" },
    ],
  },
};

export const PAGE_ROUTES: Record<string, string> = {
  dashboard: "/dashboard",
  workstreams: "/workstreams",
  levers: "/levers",
  scenarios: "/scenarios",
  reporting: "/reporting",
  governance: "/governance",
  finance: "/finance",
  hr: "/hr",
  operations: "/operations",
};
