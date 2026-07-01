export type Role = "cto" | "sponsor" | "lever" | "finance" | "hr" | "ops";

export type LeverStatus =
  "idea" | "qualified" | "validated" | "in_progress" | "delivered" | "cancelled";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AlertType = "red" | "amber" | "green" | "blue";

export type ProgramConfig = {
  id: string;
  name: string;
  sponsor: string;
  target: number; // €M total savings target
  currency: string;
  fyStart: string;
  fyEnd: string;
  baselineEBIT: number; // €M
  revenue: number; // €M
};

export type Workstream = {
  id: string;
  name: string;
  sponsor: string;
  function: string;
  color: string;
  target: number; // €M
};

export type PnlAccount = {
  id: string;
  name: string;
  baseline: number; // €M
  sign: 1 | -1;
  computed?: boolean;
};

export type Lever = {
  id: string;
  code: string;
  name: string;
  ws: string; // Workstream id
  owner: string;
  ownerInit: string;
  geography: string;
  country: string;
  entity: string;
  function: string;
  pnlMap: string; // PnlAccount id
  start: string; // ISO date
  end: string; // ISO date
  status: LeverStatus;
  progress: number; // 0-100
  risk: RiskLevel;
  grossSavings: number; // €M
  netSavings: number; // €M
  opexOneOff: number; // €M
  opexRec: number; // €M/an
  capex: number; // €M
  fteImpact: number; // positive = hires, negative = departures
  popImpacted: number;
  dependencies: string[]; // lever ids
  description: string;
  createdAt: string;
  lastUpdate: string;
};

export type Department = {
  name: string;
  fte: number;
  fteTarget: number;
};

export type Employee = {
  id: string;
  name: string;
  region: string;
  country: string;
  func: string;
  team: string;
  bu: string;
  entity: string;
  level: "Global" | "Régional" | "Local";
  fte: number;
  salary: number;
  retirement: string;
};

export type WorkforceMovement = {
  id: string;
  empId: string;
  leverId: string;
  type: "Redéploiement" | "Reconversion" | "Suppression";
  plannedDate: string;
  actualDate: string | null;
  savings: number; // €
  cost: number; // €
  status: "Planifié" | "En cours" | "Réalisé";
};

export type Workforce = {
  totalFTE: number;
  massSalary: number; // €M
  budgetSalary: number; // €M
  departments: Department[];
  employees: Employee[];
  movements: WorkforceMovement[];
};

export type ProductionLine = {
  id: string;
  name: string;
  oee: number;
  avail: number;
  perf: number;
  qual: number;
  status: "running" | "maintenance" | "stopped";
  leverIds: string[];
};

export type OperationsKPISet = {
  oeeAvg: number;
  throughput: number;
  scrapRate: number;
  otd: number;
};

export type Operations = {
  lines: ProductionLine[];
  kpisBaseline: OperationsKPISet;
  kpisTarget: OperationsKPISet;
  kpisActual: OperationsKPISet;
};

export type Alert = {
  id: string;
  type: AlertType;
  ts: string;
  scope: string; // lever id or workstream id
  title: string;
  desc: string;
  actorRole: string;
};

export type AuditEntry = {
  ts: string;
  user: string;
  action: "updated" | "commented" | "completed" | "created";
  entity: string; // lever id
  field: string;
  old: string | number;
  new: string | number;
};

export type Comment = {
  user: string;
  ts: string;
  text: string;
};

export type Scenario = {
  id: string;
  name: string;
  description: string;
  modifiers: {
    progressBoost?: number;
    riskDelay?: number;
    savingsMultiplier?: number;
  };
};

export type BeTrackData = {
  program: ProgramConfig;
  workstreams: Workstream[];
  leverStatuses: LeverStatus[];
  riskLevels: RiskLevel[];
  geographies: string[];
  functions: string[];
  pnlAccounts: PnlAccount[];
  levers: Lever[];
  workforce: Workforce;
  operations: Operations;
  alerts: Alert[];
  audit: AuditEntry[];
  comments: Record<string, Comment[]>;
  scenarios: Scenario[];
  activeScenario: string;
};

export type NavItem = {
  id: string;
  icon: string;
  label: string;
  badge?: "alerts";
};

export type RoleDefinition = {
  label: string;
  short: string;
  nav: NavItem[];
};

export type ProgramSummary = {
  target: number;
  realized: number;
  progressPct: number;
  capex: number;
  opex: number;
  fteImpact: number;
  popImpacted: number;
  leverCount: number;
  onTrack: number;
  atRisk: number;
  critical: number;
  delivered: number;
};

export type WorkstreamSummary = {
  target: number;
  realized: number;
  progressPct: number;
  capex: number;
  opex: number;
  leverCount: number;
  avgProgress: number;
  worstRisk: RiskLevel;
};
