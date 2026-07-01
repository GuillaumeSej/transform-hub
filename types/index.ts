export type Role = "cto" | "sponsor" | "lever" | "finance" | "hr" | "ops";

export type LeverStatus =
  "idea" | "qualified" | "validated" | "in_progress" | "delivered" | "cancelled";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type PriorityLevel = "low" | "medium" | "high" | "critical";
export type MaturityLevel = "L1" | "L2" | "L3" | "L4" | "L5";
export type AlertType = "red" | "amber" | "green" | "blue";
export type ActionStatus = "todo" | "in_progress" | "done" | "delayed";

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
  type: string; // catégorie du levier (ex: Sourcing, Digitalisation, Réorganisation...)
  name: string;
  ws: string; // Workstream id
  owner: string;
  ownerInit: string;
  sponsor: string;
  sponsorInit: string;
  geography: string;
  country: string;
  entity: string;
  function: string;
  costCenter: string;
  pnlMap: string; // PnlAccount id
  start: string; // ISO date
  end: string; // ISO date
  status: LeverStatus;
  progress: number; // 0-100
  maturityLevel: MaturityLevel;
  priority: PriorityLevel;
  risk: RiskLevel;
  grossSavings: number; // €M
  netSavings: number; // €M
  opexOneOff: number; // €M
  opexRec: number; // €M/an
  capex: number; // €M
  fteImpact: number; // positive = hires, negative = departures
  popImpacted: number;
  dependencies: string[]; // lever ids (L###) ou sous-levier ids (SL###), résolus par préfixe
  description: string;
  createdAt: string;
  lastUpdate: string;
  // Plan d'action propre au levier, utilisé seulement s'il n'a AUCUN sous-levier (impact sur un
  // centre de coût unique). Les leviers à impacts multiples ont leurs actions sur chaque SubLever
  // (voir BeTrackData.subLevers, filtré par leverId — pas de nesting ici).
  actions?: LeverAction[];
};

export type LeverAction = {
  id: string;
  name: string;
  start: string; // ISO date
  end: string; // ISO date
  cost: number; // €K
  status: ActionStatus;
};

/** Un sous-levier = l'impact d'un levier sur UN centre de coût unique, avec son propre plan
 * d'action. Un levier avec plusieurs centres de coût impactés se décompose en plusieurs
 * sous-leviers ; un levier à impact unique n'en a pas besoin (voir Lever.actions). */
export type SubLever = {
  id: string;
  leverId: string;
  name: string;
  costCenter: string;
  pnlMap: string; // PnlAccount id
  grossSavings: number; // €M
  netSavings: number; // €M
  opexOneOff: number; // €M
  opexRec: number; // €M/an
  capex: number; // €M
  fteImpact: number;
  popImpacted: number;
  start: string; // ISO date
  end: string; // ISO date
  status: LeverStatus;
  dependencies: string[]; // lever ids (L###) ou sous-levier ids (SL###)
  actions: LeverAction[];
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
  priorityLevels: PriorityLevel[];
  maturityLevels: MaturityLevel[];
  leverTypes: string[];
  geographies: string[];
  functions: string[];
  pnlAccounts: PnlAccount[];
  levers: Lever[];
  subLevers: SubLever[];
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
