export type Role =
  "admin" | "admin_entreprise" | "cto" | "sponsor" | "lever" | "finance" | "hr" | "ops";

/** Compte de test (voir lib/auth.ts) — login réel par identifiant/mot de passe, mais toujours
 * des comptes de démo (mot de passe unique "test" pour les 6 + admin). */
export type AuthUser = {
  username: string;
  password: string;
  role: Role;
  firstName: string;
  lastName: string;
  name: string; // nom affiché + utilisé pour filtrer "mes leviers" (Lever.owner)
  /** Identifiant de l'entreprise (client) à laquelle cet utilisateur appartient.
   *  null = admin global (voit toutes les entreprises). */
  companyId?: string | null;
};

// Cycle de vie unique d'un levier, affiché partout en L1-L5 (voir lib/status-config.ts) :
// idea=L1 Idée, qualified=L2 Qualifié, validated=L3 Validé, in_progress=L4 Planifié,
// delivered=L5 Réalisé (+ cancelled=Annulé, hors cycle).
export type LeverStatus =
  "idea" | "qualified" | "validated" | "in_progress" | "delivered" | "cancelled";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type PriorityLevel = "low" | "medium" | "high" | "critical";
export type AlertType = "red" | "amber" | "green" | "blue";
export type ActionStatus = "todo" | "in_progress" | "done" | "delayed";

/** Type de dépendance entre leviers/sous-leviers (sémantique planning classique). */
export type DependencyType = "FS" | "SS" | "FF" | "SF";

export type LeverDependency = {
  targetId: string; // lever id (L###) ou sous-levier id (SL###), résolu par préfixe
  type: DependencyType;
};

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

/** Instantané des chiffres financiers d'un levier/sous-levier, utilisé pour figer le plan initial
 * (à L3 · Validé) et pour la réactualisation (à partir de L4 · Planifié). */
export type FinancialSnapshot = {
  grossSavings: number; // €M
  netSavings: number; // €M
  opexOneOff: number; // €M
  opexRec: number; // €M/an
  capex: number; // €M
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
  // Centre de coût du levier lorsqu'il n'a AUCUN sous-levier. S'il a des sous-leviers, l'impact
  // se lit sur chaque sous-levier (poste de dépense + BU, voir SubLever) — ce champ est alors
  // ignoré côté affichage au profit de la liste réelle des postes de dépense des sous-leviers.
  costCenter: string;
  pnlMap: string; // PnlAccount id
  start: string; // ISO date
  end: string; // ISO date
  status: LeverStatus;
  progress: number; // 0-100
  priority: PriorityLevel;
  risk: RiskLevel;
  grossSavings: number; // €M
  netSavings: number; // €M
  opexOneOff: number; // €M
  opexRec: number; // €M/an
  capex: number; // €M
  fteImpact: number; // positive = hires, negative = departures
  popImpacted: number;
  // Plan initial figé automatiquement au passage en L3 · Validé — plus jamais modifiable ensuite.
  lockedPlan?: FinancialSnapshot;
  // Prévisions réactualisées, éditables uniquement à partir de L4 · Planifié (initialisées à
  // lockedPlan à l'entrée en L4, puis ajustables librement).
  reforecast?: FinancialSnapshot;
  companyId?: string | null;
  dependencies: LeverDependency[]; // suivies + alertées, jamais décalées automatiquement
  description: string;
  createdAt: string;
  lastUpdate: string;
  // Plan d'action propre au levier, utilisé seulement s'il n'a AUCUN sous-levier (impact sur un
  // centre de coût unique). Les leviers à impacts multiples ont leurs actions sur chaque SubLever
  // (voir BeTrackData.subLevers, filtré par leverId — pas de nesting ici).
  actions?: LeverAction[];
  /** Niveau de confidentialité (doit correspondre à une valeur de Company.confidentialityLevels).
   *  Non défini = visible par tous les rôles de l'entreprise. */
  confidentialityLevel?: string;
  /** Statut juste avant le passage à "cancelled", capturé automatiquement par updateLever — sert
   *  à brancher précisément l'annulation à la bonne étape dans le Sankey chronologique, sans
   *  reconstituer l'étape à partir de `progress` (imprécis). Non défini si le levier n'a jamais
   *  été annulé. */
  cancelledAtStage?: LeverStatus;
  /** Id du HierarchyNode (maille la plus fine, ex. Cost Center) — dérive tous les niveaux
   *  intermédiaires de Company.hierarchyLevels par remontée de parentId. Coexiste avec l'ancien
   *  `costCenter` (texte libre, conservé pour compat) : quand hierarchyLeafId est défini, c'est
   *  lui qui fait foi pour l'affichage de l'arborescence complète. */
  hierarchyLeafId?: string;
  /** Id du Project (voir types Project) auquel ce levier est rattaché, pour la ventilation
   *  "par projet" (en plus de la ventilation existante "par workstream"). */
  projectId?: string;
};

export type LeverAction = {
  id: string;
  name: string;
  start: string; // ISO date
  end: string; // ISO date
  cost: number; // €K
  status: ActionStatus;
};

/** Un sous-levier = l'impact d'un levier sur UN poste de dépense/BU unique, avec son propre plan
 * d'action. Un levier avec plusieurs postes de dépense impactés se décompose en plusieurs
 * sous-leviers ; un levier à impact unique n'en a pas besoin (voir Lever.actions). */
export type SubLever = {
  id: string;
  leverId: string;
  name: string;
  // Owner propre au sous-levier (optionnel) — à défaut, l'owner du levier parent s'applique.
  owner?: string;
  ownerInit?: string;
  // Poste de dépense impacté (remplace l'ancien "centre de coût" unique) + BU associée.
  expensePost: string;
  businessUnit: string;
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
  priority: PriorityLevel;
  risk: RiskLevel;
  lockedPlan?: FinancialSnapshot;
  reforecast?: FinancialSnapshot;
  companyId?: string | null;
  dependencies: LeverDependency[];
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
  department: string; // FK Department.name
  direction: string; // direction organisationnelle (ex. "Direction Industrielle")
  hrOwner: string; // RH local responsable de l'employé
  func: string;
  team: string;
  bu: string;
  entity: string;
  level: "Global" | "Régional" | "Local";
  fte: number;
  salary: number; // € brut annuel
  hireDate: string; // ISO date
  retirement: string;
};

export type MovementType = "Redéploiement" | "Reconversion" | "Suppression" | "Recrutement";
export type MovementStatus = "Planifié" | "En cours" | "Réalisé";

export type WorkforceMovement = {
  id: string;
  /** null = Recrutement (le collaborateur n'existe pas encore dans la base) */
  empId: string | null;
  /** Nom de l'employé concerné, ou intitulé du poste pour un Recrutement */
  label: string;
  leverId: string;
  type: MovementType;
  /** ETP concernés (positif) — l'effet sur l'effectif total est signé par le type :
   * Suppression = −fte, Recrutement = +fte, Redéploiement/Reconversion = 0 (transfert). */
  fte: number;
  department: string;
  /** Département d'arrivée (Redéploiement/Reconversion) */
  toDepartment?: string;
  country: string;
  hrOwner: string;
  plannedDate: string;
  actualDate: string | null;
  status: MovementStatus;
  /** Validation RH que le mouvement a réellement eu lieu (distincte du statut opérationnel) */
  hrValidated: boolean;
  /** Mouvement inclus dans le Plan de Sauvegarde de l'Emploi (suppressions) */
  inPSE?: boolean;
  /** Impact masse salariale €/an (négatif = économie) */
  salaryImpact: number;
  savings: number; // € économies run-rate attendues
  cost: number; // € coût one-off (indemnités, formation, recrutement)
  comment?: string;
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
  action: "updated" | "commented" | "completed" | "created" | "validated" | "deleted";
  entity: string; // lever id, mouvement id (MV###) ou employé id (EMP###)
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

// ─── Multi-tenant: Company / Project / Lifecycle Configuration ───────────────

export type Company = {
  id: string;
  name: string;
  industry: string;
  logoUrl?: string;
  createdAt: string;
  /** Configuration temporelle du programme pour cette entreprise */
  fyStart: string; // ISO date "YYYY-01-01"
  fyEnd: string; // ISO date "YYYY-12-31"
  /** Budget CAPEX total alloué au programme (optionnel — souvent déjà cadré ailleurs en amont
   *  de la mission). Si renseigné, le KPI "CAPEX engagé" du dashboard exécutif l'affiche en
   *  regard ("X€M engagés / Y€M budgétés"). */
  capexBudget?: number; // €M
  /** Si false, le module "Plan d'action" (onglet Kanban/Gantt) est désactivé pour cette
   *  entreprise — les utilisateurs voient un message "Module non activé" à la place.
   *  undefined = activé (comportement historique, avant l'introduction du toggle). */
  actionPlanEnabled?: boolean;
  /** Échelle de confidentialité propre à l'entreprise, ordonnée du niveau le moins au plus
   *  restreint (ex. ["Public", "Restreint", "Confidentiel", "Secret"]). Un levier sans
   *  confidentialityLevel n'est restreint pour personne. */
  confidentialityLevels?: string[];
  /** Pour chaque rôle, la liste des niveaux de confidentialityLevels auxquels il a accès
   *  (en plus des leviers sans niveau défini, toujours visibles). admin/admin_entreprise ne
   *  sont jamais filtrés (accès total) — pas besoin de les lister ici. */
  roleClearance?: Partial<Record<Role, string[]>>;
  /** Arborescence de maille financière configurée en début de mission, du plus macro (proche du
   *  compte P&L) au plus fin. Les leviers/sous-leviers ne renseignent que la maille la plus fine
   *  (voir Lever.hierarchyLeafId) ; les niveaux intermédiaires sont dérivés via HierarchyNode. */
  hierarchyLevels?: HierarchyLevelDef[];
};

/** Un niveau de l'arborescence financière P&L → Cost Center, configuré par entreprise.
 *  `order` 0 = le plus macro (juste sous le compte P&L), le plus grand = la maille la plus fine
 *  (celle effectivement saisie dans le fichier des leviers). */
export type HierarchyLevelDef = {
  key: string; // slug stable, ex. "business_unit", "cost_center"
  label: string; // libellé affiché, ex. "Business Unit", "Centre de coût"
  order: number;
};

/** Un nœud concret de l'arborescence (ex. le Cost Center "CC-PROC-001", enfant de la Business
 *  Unit "BU Industrie"). La chaîne de parentId permet de remonter jusqu'au niveau le plus macro
 *  à partir d'une seule maille fine saisie sur un levier. */
export type HierarchyNode = {
  id: string;
  companyId: string;
  levelKey: string; // HierarchyLevelDef.key
  code: string; // code saisi tel quel dans le fichier des leviers pour la maille la plus fine
  label: string;
  parentId: string | null;
};

export type Project = {
  id: string;
  companyId: string;
  name: string;
  sponsor: string;
  target: number;
  currency: string;
  fyStart: string;
  fyEnd: string;
  baselineEBIT: number;
  revenue: number;
  createdAt: string;
};

/** Configuration du cycle de vie par entreprise — chaque client peut personnaliser le
 *  nombre d'étapes, leur nom, et les étapes de validation requises. */
export type LifecycleStage = {
  key: LeverStatus;
  label: string;
  /** true = étape de validation formelle (gate) */
  validationRequired: boolean;
};

export type LifecycleConfig = {
  companyId: string;
  stages: LifecycleStage[];
};

export type BeTrackData = {
  program: ProgramConfig;
  workstreams: Workstream[];
  leverStatuses: LeverStatus[];
  riskLevels: RiskLevel[];
  priorityLevels: PriorityLevel[];
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
