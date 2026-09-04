/**
 * Rôle applicatif d'un utilisateur — union FERMÉE, référencée partout (permissions de page via
 * `lib/nav-config.ts`, création d'utilisateur, `Indicator.responsibleRoles`,
 * `Chantier.responsibleRoles`).
 *
 * Les 8 premières valeurs sont les rôles historiques du Plan Performance. Les 6 suivantes portent
 * l'organigramme du Plan Stratégique (méthodologie 3-5-15, axes → chantiers) défini par le PO :
 *   - `strategic_lead`      : Pilote du plan stratégique (un seul par plan) — rend compte de
 *                             l'avancement global au COMEX, anime les instances de pilotage.
 *   - `axis_sponsor`        : Sponsor d'un axe — responsable de l'avancement et du budget de SON
 *                             axe, arbitre les propositions de ses responsables de chantier.
 *   - `chantier_owner`      : Responsable de chantier — garant de l'avancement et de la qualité de
 *                             SON chantier, plan de travail, risques, coûts/bénéfices.
 *   - `chantier_contributor`: Contributeur, exécute au sein d'un chantier.
 *   - `internal_comm`       : Communication interne — cadre et pilote la communication sur
 *                             l'avancement des chantiers.
 *   - `budget_control`      : Contrôle de gestion — consolidation des indicateurs et contrôle
 *                             budgétaire, en appui du pilote.
 * Le COMEX n'y figure PAS : c'est un organe de gouvernance collectif, pas un profil individuel
 * connectable à l'application.
 */
export type Role =
  | "admin"
  | "admin_entreprise"
  | "cto"
  | "sponsor"
  | "lever"
  | "finance"
  | "hr"
  | "ops"
  | "strategic_lead"
  | "axis_sponsor"
  | "chantier_owner"
  | "chantier_contributor"
  | "internal_comm"
  | "budget_control";

/** Compte de test (voir lib/auth.ts) — login réel par identifiant/mot de passe, mais toujours
 * des comptes de démo (mot de passe unique "test" pour les 8 comptes/rôles). */
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
  /** Habilitation de confidentialité INDIVIDUELLE, surcharge Company.roleClearance[role] quand
   *  définie (voir Company.confidentialityLevels). Non défini = hérite du niveau de son rôle.
   *  "all" = accès à tous les niveaux de confidentialité de l'entreprise, quel que soit le rôle.
   *  string[] (peut être vide = "aucun") = liste explicite des niveaux autorisés pour CET
   *  utilisateur. Sans effet pour admin/admin_entreprise (toujours accès total). */
  confidentialityClearance?: "all" | string[];
  /** Direction/service métier de rattachement (round 4, filtres Plan Stratégique — voir
   *  `Company.directions`). Contraint à la liste de l'entreprise via un `<select>`, jamais du texte
   *  libre, pour que le filtre par direction matche réellement une valeur existante. */
  direction?: string;
};

// Cycle de vie unique d'un levier, affiché partout en L1-L5 (voir lib/status-config.ts) :
// idea=L1 Idée, qualified=L2 Qualifié, validated=L3 Validé, in_progress=L4 Planifié,
// delivered=L5 Réalisé (+ cancelled=Annulé, hors cycle).
export type LeverStatus =
  "idea" | "qualified" | "validated" | "in_progress" | "delivered" | "cancelled";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AlertType = "red" | "amber" | "green" | "blue";
export type ActionStatus = "todo" | "in_progress" | "done" | "delayed";

/** Type de dépendance entre leviers (sémantique planning classique). */
export type DependencyType = "FS" | "SS" | "FF" | "SF";

export type LeverDependency = {
  targetId: string; // lever id (L###)
  type: DependencyType;
};

/** Nature du gain, pour les lignes d'impact de type "saving" : baisse de coût, hausse de chiffre
 *  d'affaires, ou impact BFR (besoin en fonds de roulement). Non pertinent pour les impacts de
 *  type "cost" (déjà classés par `nature`, voir ActionImpact). */
export type SavingType = "cost_reduction" | "revenue_increase" | "working_capital";

/** Règle de reconnaissance dans le temps d'un coût/gain : "smoothing" = reconnu linéairement
 *  entre le début de l'action et la date milestone (CAPEX ou gain) ; "one_shot" = reconnu à 100%
 *  à la date milestone. Réglable par défaut au niveau entreprise (Company.defaultRecognition),
 *  surchargeable par ligne d'impact (ActionImpact.recognition). */
export type RecognitionMode = "smoothing" | "one_shot";

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
  /** Thème fonctionnel dominant (informatif, pas contraignant). Un workstream peut impacter
   *  plusieurs fonctions — la fonction réelle est sur chaque levier (Lever.function). */
  function?: string;
  color: string;
  target: number; // €M
};

export type PnlAccount = {
  id: string;
  name: string;
  baseline: number; // €M
  sign: 1 | -1;
  computed?: boolean;
  selectable?: boolean;
};

/** Instantané des chiffres financiers d'un levier/sous-levier, utilisé pour figer le plan initial
 * (à l'étape "validated" — décision de lancement) et pour la réactualisation (à partir de
 * l'étape "in_progress" — déploiement). */
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
  costCenter: string;
  pnlMap: string; // PnlAccount id
  start: string; // ISO date
  end: string; // ISO date
  status: LeverStatus;
  progress: number; // 0-100
  /** Calculé automatiquement depuis les alertes liées à ce levier (voir
   *  engine.computeLeverRisk / alertEngine.generateAlerts), plutôt que saisi à la main — source
   *  de vérité = montants à risque (Alert.impactEur) des alertes ouvertes. Le champ reste stocké
   *  (dernier calcul) pour affichage synchrone sans recalcul systématique. */
  risk: RiskLevel;
  grossSavings: number; // €M
  netSavings: number; // €M
  opexOneOff: number; // €M
  opexRec: number; // €M/an
  capex: number; // €M
  fteImpact: number; // positive = hires, negative = departures
  popImpacted: number;
  // Plan initial figé automatiquement au passage à l'étape "validated" — plus jamais modifiable ensuite.
  lockedPlan?: FinancialSnapshot;
  // Prévisions réactualisées, éditables uniquement à partir de l'étape "in_progress" (initialisées
  // à lockedPlan à l'entrée dans cette étape, puis ajustables librement).
  reforecast?: FinancialSnapshot;
  companyId?: string | null;
  dependencies: LeverDependency[]; // suivies + alertées, jamais décalées automatiquement
  description: string;
  createdAt: string;
  lastUpdate: string;
  // Plan d'action du levier — liste plate d'actions ; chaque action peut porter plusieurs lignes
  // d'impact (poste de dépense/BU compris via ActionImpact.costCenter/entity), plus de niveau
  // sous-levier intermédiaire.
  actions?: LeverAction[];
  /** Niveau de confidentialité (doit correspondre à une valeur de Company.confidentialityLevels).
   *  Non défini = visible par tous les rôles de l'entreprise. */
  confidentialityLevel?: string;
  /** Date de passage en M5 (delivered), renseignée automatiquement. Sert à ventiler les gains
   *  réalisés par période dans le P&L. Non définie si le levier n'a jamais atteint M5. */
  deliveredDate?: string;
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
  /** Maille la plus fine de l'arborescence géographique configurée pour l'entreprise. */
  geographyLeafId?: string;
  /** Id du Program (voir type Program) auquel ce levier est rattaché. Le dashboard exécutif est
   *  scopé à un Program sélectionné : un levier sans programId n'apparaît sur aucun dashboard. */
  programId?: string;
};

/** Ligne d'impact d'une action — décrit UN effet financier/RH sur UN poste de coût.
 *  Une action peut avoir plusieurs lignes d'impact (ex: consulting fees + licence + réduction ETP).
 *  Ce sont des attributs de l'action, pas un 3ème niveau de navigation. */
export type ActionImpact = {
  id: string;
  label: string; // "Consulting fees", "Réduction ETP comptables"
  type: "cost" | "saving";
  /** Pour les coûts : CAPEX, OPEX récurrent, ou One-off. Ignoré pour les savings. */
  nature: "capex" | "opex_rec" | "oneoff";
  amount: number; // €M — toujours positif, le type détermine le signe
  fteCount?: number; // ETP (négatif = réduction)
  pnlMap?: string; // compte P&L (hérite du levier si absent)
  costCenter?: string;
  entity?: string; // entité légale (hérite du levier si absent)
  /** Nature du gain (uniquement pour type="saving") : baisse de coût / hausse de CA / impact BFR. */
  savingType?: SavingType;
  /** Pour nature="capex" — date à laquelle le CAPEX est supposé engagé à 100% (jusqu'ici confondue
   *  avec les dates de l'action elle-même). */
  capexDeploymentDate?: string; // ISO date
  /** Pour type="saving" — date/milestone d'encaissement réel du gain (peut être postérieure à la
   *  fin de l'action). */
  gainDate?: string; // ISO date
  /** Surcharge manuelle du mode de reconnaissance ; non défini = hérite de
   *  Company.defaultRecognition (ou "smoothing" si l'entreprise n'a rien configuré). */
  recognition?: RecognitionMode;
  /** Commentaires libres sur cette ligne d'impact (ex. méthode de calcul, hypothèses). */
  comments?: Comment[];
};

export type LeverAction = {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  ownerInit?: string;
  start: string; // ISO date
  end: string; // ISO date
  cost: number; // €K — legacy, conservé pour compat
  status: ActionStatus;
  deliveredDate?: string; // date de passage en "done"
  /** Lignes d'impact financier (tableau embarqué). Chaque ligne porte son propre
   *  mapping P&L, centre de coût, et entité. Le levier parent consolide automatiquement
   *  ses KPIs depuis la somme des impacts de toutes ses actions. */
  impacts?: ActionImpact[];
};

export type Department = {
  name: string;
  fte: number;
  fteTarget: number;
};

/** Baseline ETP explicite pour une dimension sans référentiel natif dans la base ETP détaillée
 * (pays, workstream). La somme par dimension doit égaler Workforce.totalFTE. */
export type WorkforceDimensionBaseline = {
  key: string;
  label: string;
  fte: number;
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

/**
 * Typologie des mouvements RH, alignée sur la vue "OD Monitoring" de Gooduelle (5 types).
 * Migration effectuée en Août 2026 depuis l'ancienne typologie 4-types
 * (`Redéploiement | Reconversion | Suppression | Recrutement`) :
 *   - `Suppression` → `Départ forcé` (indemnités majorées).
 *   - `Redéploiement` / `Reconversion` → `Transfert entrant` (avec `requiresRetraining=false/true`).
 *   - `Recrutement` inchangé.
 *   - `Attrition` (nouveau) : départ volontaire, préavis seul, pas d'indemnité de rupture.
 *   - `Transfert sortant` (nouveau) : mobilité vers un département hors du périmètre monitoré. */
export type MovementType =
  "Recrutement" | "Attrition" | "Départ forcé" | "Transfert entrant" | "Transfert sortant";
export type MovementStatus = "Réalisé" | "Planifié" | "À faire" | "Abandonné";

/** Dispositif social associé à une réduction de poste. La liste couvre les mécanismes courants
 * tout en gardant `Autre` pour les politiques client spécifiques. */
export type SocialScheme = "PSE" | "RC" | "RCC" | "PDV" | "Autre";

/** Snapshot financier d'un mouvement RH — figé à la validation initiale (`lockedPlan`) puis
 *  réactualisé au fur et à mesure (`reforecast`). Mirror du pattern `FinancialSnapshot` du levier
 *  mais adapté aux €/an et non aux €M (l'unité utilisée sur `WorkforceMovement.salaryImpact`). */
export type WorkforceMovementSnapshot = {
  /** ETP concernés (positif). L'effet signé sur l'effectif est dérivé du type via `fteEffect`. */
  fte: number;
  /** Impact masse salariale €/an (négatif = économie récurrente). */
  salaryImpact: number;
  /** Économies run-rate annualisées (€, ≥ 0). */
  savings: number;
  /** Coût social one-off (€, ≥ 0) = ENR (Éléments Non Récurrents). */
  cost: number;
};

export type WorkforceMovement = {
  id: string;
  /** null = Recrutement (le collaborateur n'existe pas encore dans la base) */
  empId: string | null;
  /** Nom de l'employé concerné, ou intitulé du poste pour un Recrutement */
  label: string;
  leverId: string;
  /** Workstream de rattachement — champ direct (peuplé au moment de la saisie), pas dérivé du
   *  levier associé. Permet le filtrage transverse du dashboard RH sans jointure. */
  workstream?: string;
  /** Fonction (métier / département fonctionnel) — champ direct, même logique que `workstream`. */
  function?: string;
  /** Programme de rattachement — permet de scoper le dashboard RH à un programme (miroir du
   *  dashboard exécutif). Le programme d'un mouvement est en principe celui du levier associé. */
  programId?: string;
  type: MovementType;
  /** ETP concernés (positif) — l'effet sur l'effectif total est signé par le type :
   *  `Attrition` / `Départ forcé` = −fte, `Recrutement` = +fte, `Transfert entrant`/`Transfert
   *  sortant` = 0 (transfert interne). Voir `lib/hrEngine.ts::fteEffect`. */
  fte: number;
  department: string;
  /** Département d'arrivée (Transfert entrant / Transfert sortant) */
  toDepartment?: string;
  country: string;
  hrOwner: string;
  plannedDate: string;
  actualDate: string | null;
  status: MovementStatus;
  /** Validation RH que le mouvement a réellement eu lieu (distincte du statut opérationnel) */
  hrValidated: boolean;
  /** Mouvement inclus dans le Plan de Sauvegarde de l'Emploi (Départs forcés) */
  inPSE?: boolean;
  /** Dispositif social utilisé pour la réduction de poste (PSE, rupture conventionnelle, etc.).
   * `inPSE` reste synchronisé pour la compatibilité des calculs et widgets existants. */
  socialScheme?: SocialScheme;
  /** Impact masse salariale €/an (négatif = économie) */
  salaryImpact: number;
  savings: number; // € économies run-rate attendues
  cost: number; // € coût one-off (indemnités, formation, recrutement) — synonyme d'ENR
  /** Uniquement pour `Transfert entrant`/`Transfert sortant` : `true` = reconversion nécessitant
   *  une formation lourde, `false`/absent = simple redéploiement interne (formation courte). */
  requiresRetraining?: boolean;
  /** Snapshot figé à la validation du mouvement — jamais modifié après. Utilisé comme référence
   *  "cible bottom-up" pour les KPI du dashboard RH (Impact ETP / Économies / Coûts sociaux /
   *  Économies nettes). Non défini avant la validation ou pour des mouvements importés bruts. */
  lockedPlan?: WorkforceMovementSnapshot;
  /** Snapshot réactualisé — mis à jour au fil de la vie du mouvement (échéance repoussée, coût
   *  révisé…). Initialisé à `lockedPlan` à la validation, éditable ensuite. Sert de "reforecast"
   *  pour les KPI. Non défini si aucune réactualisation. */
  reforecast?: WorkforceMovementSnapshot;
  comment?: string;
};

export type Workforce = {
  totalFTE: number;
  massSalary: number; // €M
  budgetSalary: number; // €M
  departments: Department[];
  countryBaselines?: WorkforceDimensionBaseline[];
  workstreamBaselines?: WorkforceDimensionBaseline[];
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
  scope: string; // lever, sub-lever or workstream id
  /** Libellé lisible du `scope`, quand l'identifiant brut n'est pas parlant pour un humain.
   *  Absent côté Plan Performance (les ids de leviers `L###` se lisent tels quels) ; renseigné
   *  pour les alertes synthétiques du Plan Stratégique, dont les scopes sont des ids générés
   *  (`CH-…`, `IND-…`) — voir components/shared/AppShell.tsx. */
  scopeLabel?: string;
  title: string;
  desc: string;
  actorRole: string;
  /** Impact € sur le run-rate (négatif = perte de valeur, positif = gain). */
  impactEur?: number;
  /** Nom du responsable associé à l'alerte (lever owner, sponsor...). */
  owner?: string;
  /** Origine de l'alerte : saisie manuelle ou auto-générée par le moteur. */
  source?: "manual" | "auto";
  /** Entreprise propriétaire de l'alerte. */
  companyId?: string | null;
  /** Utilisateurs destinataires, calculés depuis leur profil et leur accès au scope. */
  recipientUsernames?: string[];
  /** Auteur d'une alerte manuelle. */
  createdByUsername?: string;
  /** Date ISO de création, distincte du libellé historique `ts`. */
  createdAt?: string;
  /** Une alerte manuelle peut explicitement masquer les alertes auto du même scope. */
  suppressAutomaticAlerts?: boolean;
  /** false = "À traiter" (défaut), true = "Résolu" pour tous les destinataires. */
  resolved?: boolean;
  resolvedAt?: string;
  resolvedByUsername?: string;
};

export type AlertState = {
  alertId: string;
  companyId?: string | null;
  resolved: boolean;
  resolvedAt?: string;
  resolvedByUsername?: string;
};

export type ManualAlertInput = Pick<Alert, "type" | "scope" | "title" | "desc"> & {
  impactEur?: number;
  suppressAutomaticAlerts: boolean;
};

export type SetAlertResolved = (
  alertId: string,
  resolved: boolean,
  user: AuthUser,
  alertCompanyId?: string | null
) => void;

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

// ─── Multi-tenant: Company / Program / Lifecycle Configuration ───────────────

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
  /** Liste des directions/services métier de l'entreprise (round 4, filtres Plan Stratégique) —
   *  même pattern que `confidentialityLevels` juste au-dessus : une liste éditable par l'admin,
   *  référencée par `AuthUser.direction`. Non conditionnée au type de programme (comme
   *  `confidentialityLevels`), donc sans impact sur le Plan Performance. */
  directions?: string[];
  /** Pour chaque rôle, la liste des niveaux de confidentialityLevels auxquels il a accès
   *  (en plus des leviers sans niveau défini, toujours visibles). admin/admin_entreprise ne
   *  sont jamais filtrés (accès total) — pas besoin de les lister ici. */
  roleClearance?: Partial<Record<Role, string[]>>;
  /** Arborescence de maille financière configurée en début de mission, du plus macro (proche du
   *  compte P&L) au plus fin. Les leviers/sous-leviers ne renseignent que la maille la plus fine
   *  (voir Lever.hierarchyLeafId) ; les niveaux intermédiaires sont dérivés via HierarchyNode. */
  hierarchyLevels?: HierarchyLevelDef[];
  /** Arborescence géographique indépendante et de profondeur libre. */
  geographyHierarchyLevels?: HierarchyLevelDef[];
  /** Taux de charges sociales patronales appliqué au salaire brut pour obtenir le "salaire
   *  chargé" utilisé dans le calcul EUR mécanisme-dépendant des mouvements RH (voir
   *  lib/hrFinancials.ts). Varie fortement selon pays/statut/convention collective — ASSUMPTION :
   *  non défini = valeur par défaut ~45% (ordre de grandeur France, cadre), à ajuster projet par
   *  projet selon la politique RH réelle du client. */
  socialChargesRate?: number;
  /** Mode de reconnaissance par défaut appliqué aux nouvelles lignes d'impact de cette entreprise,
   *  quand la ligne ne surcharge pas explicitement ActionImpact.recognition. Non défini =
   *  "smoothing". */
  defaultRecognition?: RecognitionMode;
  /** Seuils de segmentation du risque d'un levier en fonction du cumul des montants (€, valeur
   *  absolue de Alert.impactEur) des alertes ouvertes qui lui sont liées (voir
   *  engine.computeLeverRisk). Non défini = seuils par défaut (voir DEFAULT_RISK_THRESHOLDS dans
   *  lib/engine.ts). */
  riskThresholds?: { level: RiskLevel; minAmount: number }[];
};

/** Un niveau de l'arborescence financière P&L → Cost Center, configuré par entreprise.
 *  `order` 0 = le plus macro (juste sous le compte P&L), le plus grand = la maille la plus fine
 *  (celle effectivement saisie dans le fichier des leviers). */
export type HierarchyDomain = "financial" | "geographic";
export type HierarchySemantic = "pnl" | "legal_entity" | "country" | "region" | "continent";

export type HierarchyLevelDef = {
  key: string; // slug stable, ex. "business_unit", "cost_center"
  label: string; // libellé affiché, ex. "Business Unit", "Centre de coût"
  order: number;
  /** Sémantique facultative permettant d'alimenter les champs et vues standard. */
  semantic?: HierarchySemantic;
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
  /** Les nœuds historiques sans domaine sont financiers. */
  domain?: HierarchyDomain;
  /** Métadonnées des lignes P&L, utilisées uniquement au niveau semantic="pnl". */
  financial?: {
    baseline: number;
    sign: 1 | -1;
    computed?: boolean;
    selectable?: boolean;
  };
};

/** Un Programme = un regroupement de leviers rattaché à une entreprise (renommé depuis "Project"
 *  pour coller au vocabulaire métier). Le dashboard exécutif est scopé à un Program sélectionné
 *  (voir app/(app)/dashboard/page.tsx) — distinct de ProgramConfig plus haut, qui est un vestige
 *  de l'ancien modèle mono-programme global, conservé pour compat de fyStart/fyEnd/target au
 *  niveau entreprise. */
export type Program = {
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
  /** Type de programme, choisi À LA CRÉATION et figé ensuite (voir components/admin/
   *  ProgramsPanel.tsx). `undefined` = "performance" (comportement historique, avant
   *  l'introduction du Plan Stratégique) — toujours lire via `resolveProgramType()`
   *  (lib/axisLogic.ts) plutôt que de tester `type === "performance"` directement. */
  type?: ProgramType;
};

// ─── Plan Stratégique (méthodologie 3-5-15 : Vision → Axes → Chantiers → Actions) ─────────────
//
// Modèle PARALLÈLE au modèle Performance (Lever/LeverAction), volontairement pas généricisé :
// un axe stratégique n'a pas de notion financière (CAPEX/OPEX/gains) et son cycle de vie
// (MaturityStageConfig, configurable par PROGRAMME) n'a rien à voir avec le cycle de vie des
// leviers (LifecycleConfig, union fermée LeverStatus, scopé par ENTREPRISE).

/** Un programme est soit un Plan Performance (leviers financiers), soit un Plan Stratégique
 *  (axes/chantiers/indicateurs). Une même entreprise peut porter les deux simultanément. */
export type ProgramType = "performance" | "strategic";

/** Une étape du cycle de maturité d'un axe/chantier — à la CMMI/PPAP, nombre d'étapes libre et
 *  configurable PAR PROGRAMME (deux programmes de la même entreprise peuvent avoir des cycles de
 *  longueurs différentes). À ne pas confondre avec `LifecycleStage`, qui est l'équivalent
 *  Performance : union fermée `LeverStatus`, scopé entreprise, non extensible. */
export type MaturityStageConfig = {
  /** Slug libre (ex. "planned", "in_progress") — PAS une union fermée. */
  id: string;
  programId: string;
  companyId: string;
  /** 1..N, définit l'ordre du cycle. */
  order: number;
  label: string;
  /** État de sortie hors cycle linéaire (ex. "Atteint" / "Non atteint"). */
  isTerminal?: boolean;
};

export type StrategicAxis = {
  id: string;
  companyId: string;
  programId: string;
  name: string;
  description?: string;
  owner?: string;
  color?: string;
  /** Référence un `MaturityStageConfig.id` du programme. Explicite (jamais dérivé en base) pour
   *  laisser ouverte la décision "stage de l'axe piloté vs dérivé de ses chantiers". */
  stage: string;
  /** Optionnel dès le départ pour éviter une migration le jour où la confidentialité par
   *  programme sera tranchée (même champ que `Lever.confidentialityLevel`). */
  confidentialityLevel?: string;
  createdAt: string;
  lastUpdate: string;
};

/** Même sémantique planning que `DependencyType` côté leviers, mais entre CHANTIERS (et
 *  potentiellement inter-axes du même programme). */
export type ChantierDependencyType = "FS" | "SS" | "FF" | "SF";

export type ChantierDependency = {
  /** Id du chantier bloqueur. */
  targetId: string;
  type: ChantierDependencyType;
};

/** Lettre RACI standard (Responsable/Autorité/Consulté/Informé), assignée à une personne sur un
 *  chantier ou un livrable — round 4, demande PO. */
export type RaciLetter = "R" | "A" | "C" | "I";

/** `userId` stocke un `AuthUser.username` (pas d'uid Firebase) — même convention que
 *  `Indicator.additionalAuthorizedUserIds` : c'est la clé primaire "métier" déjà utilisée partout
 *  ailleurs dans l'app pour référencer une personne (voir `canFillIndicator`). */
export type RaciAssignment = { userId: string; letter: RaciLetter };

/** Échelon 1-4 d'une dimension de la grille d'effort (voir `ChantierEffort`) — mêmes 4 échelons
 *  pour les 4 dimensions, libellés distincts par dimension (voir `strategicChantierDetail.effort.*`
 *  dans les dictionnaires i18n). */
export type EffortScore = 1 | 2 | 3 | 4;

/** Grille de notation d'effort d'un chantier — visible UNIQUEMENT sur la fiche chantier dédiée
 *  (round 4), nulle part ailleurs (Kanban, Gantt, cartes d'axe). Les 4 dimensions sont
 *  indépendantes et toutes optionnelles : un chantier peut être noté progressivement. */
export type ChantierEffort = {
  financialImpact?: EffortScore;
  humanImpact?: EffortScore;
  duration?: EffortScore;
  changeManagement?: EffortScore;
};

/** Un chantier = un regroupement d'actions concrètes qui font avancer un axe. Niveau
 *  intermédiaire absent du modèle Performance : c'est lui qui structure le Gantt (un bloc de
 *  Gantt = un chantier, pas une action isolée). */
export type Chantier = {
  id: string;
  companyId: string;
  programId: string;
  axisId: string;
  name: string;
  description?: string;
  /** Référence un `MaturityStageConfig.id` du programme (même référentiel que l'axe). */
  stage: string;
  dependencies: ChantierDependency[];
  /** Rôles habilités à PILOTER ce chantier (mettre à jour son avancement, ses actions, ses
   *  livrables) — pendant de `Indicator.responsibleRoles`, voir `canManageChantier` dans
   *  `lib/axisLogic.ts`. Optionnel et non-bloquant : absent ou vide = aucune restriction, tout
   *  utilisateur qui voit le chantier peut le piloter (comportement historique conservé pour les
   *  chantiers créés avant l'introduction de ce champ). */
  responsibleRoles?: Role[];
  confidentialityLevel?: string;
  /** Sponsor COMEX explicite (round 4, format fiche chantier PERIAL) — remplace l'ancienne
   *  heuristique "responsable dérivé des actions" (`deriveChantierOwner`), incapable de représenter
   *  un sponsor distinct du pilote opérationnel. `AuthUser.username`, saisi via `UserPicker`. */
  sponsorName?: string;
  /** Pilote opérationnel du chantier (distinct du sponsor). `AuthUser.username`. */
  pilote?: string;
  /** Critère de succès en texte libre ("On sera content en [année] si..."), demande PO explicite. */
  successCriteria?: string;
  /** RACI du chantier (personnes attachées, pas rôles applicatifs — voir `RaciAssignment`). */
  raci?: RaciAssignment[];
  /** Grille de notation d'effort — voir `ChantierEffort`, affichée uniquement sur la fiche
   *  chantier dédiée. */
  effort?: ChantierEffort;
  createdAt: string;
  lastUpdate: string;
};

/** Sous-étape temporelle d'un livrable : un livrable peut être produit en plusieurs vagues
 *  disjointes (ex. une première portion de S2 2026 à S2 2027, une seconde de S1 2028 à S2 2029),
 *  chacune avec sa propre plage de dates — d'où une LISTE de phases plutôt qu'un couple
 *  début/fin unique sur le livrable. */
export type DeliverablePhase = {
  id: string;
  start: string; // ISO date
  end: string; // ISO date
  /** Précision libre sur cette phase (non saisie dans le formulaire v1, conservée si présente). */
  note?: string;
};

/** Livrable attendu d'une action de chantier — texte libre (aucune convention « un par ligne »),
 *  éventuellement phasé dans le temps. */
export type Deliverable = {
  id: string;
  label: string;
  phases: DeliverablePhase[];
  /** RACI du livrable — indépendant du RACI du chantier (un livrable peut avoir des personnes
   *  différentes de celles pilotant le chantier dans son ensemble). */
  raci?: RaciAssignment[];
};

export type ChantierAction = {
  id: string;
  companyId: string;
  chantierId: string;
  name: string;
  description?: string;
  owner?: string;
  /** Distinct de `owner` (qui exécute) : qui porte/arbitre l'action côté COMEX/direction. Round 4,
   *  demande PO (fiche chantier façon PERIAL). */
  sponsor?: string;
  start: string; // ISO date
  end: string; // ISO date
  /** Référence un `MaturityStageConfig.id`, comme le chantier — pas de `ActionStatus` dédié. */
  status: string;
  /** Livrables attendus, chacun avec ses propres sous-étapes temporelles. */
  deliverables?: Deliverable[];
  /** Conditions go/no-go avant de pouvoir démarrer cette action — voir `canStartAction`
   *  (lib/axisLogic.ts). v1 purement informatif : rien n'intercepte aujourd'hui un changement de
   *  statut, donc un prérequis non satisfait n'empêche pas la transition, il l'affiche seulement. */
  prerequisites?: ActionPrerequisite[];
};

/** Un prérequis peut cibler une autre action du plan ("action", satisfait quand son étape est
 *  terminale) ou un événement hors plan ("external", ex. un recrutement — satisfait via `done`). */
export type ActionPrerequisiteKind = "action" | "external";

export type ActionPrerequisite = {
  id: string;
  kind: ActionPrerequisiteKind;
  /** Requis quand `kind === "action"` — id d'une `ChantierAction`. */
  targetActionId?: string;
  /** Requis quand `kind === "external"` — libellé libre (ex. "Recrutement du chef de projet"). */
  label?: string;
  /** Pertinent seulement pour `kind === "external"` : un prérequis "action" dérive sa satisfaction
   *  de l'étape de l'action cible, il n'a pas de `done` propre. */
  done?: boolean;
};

export type IndicatorKind = "quantitative" | "qualitative";
export type IndicatorFrequency = "monthly" | "quarterly" | "semiannual" | "annual";
/** Sens d'amélioration attendu : "up" = plus haut vaut mieux, "down" = plus bas vaut mieux. */
export type IndicatorDirection = "up" | "down";
export type IndicatorRiskStatus = "on_track" | "at_risk";

export type Indicator = {
  id: string;
  companyId: string;
  programId: string;
  axisId: string;
  /** Optionnel — absent = indicateur "macro" rattaché directement à l'axe. */
  chantierId?: string;
  name: string;
  kind: IndicatorKind;
  frequency: IndicatorFrequency;
  /** Objectif exprimé en texte libre (toujours renseigné, y compris pour un indicateur
   *  qualitatif où `objectiveValue` n'a pas de sens). */
  objective: string;
  objectiveValue?: number;
  direction?: IndicatorDirection;
  unit?: string;
  /** Rôles autorisés à renseigner cet indicateur — au moins un attendu. Liste DIRECTE de rôles
   *  (pas d'indirection par niveaux comme la confidentialité : c'est une autorisation, pas une
   *  échelle ordonnée). */
  responsibleRoles: Role[];
  /** Comptes individuels autorisés EN PLUS des rôles (username, voir AuthUser.username). */
  additionalAuthorizedUserIds?: string[];
  /** Statut calculé automatiquement (dernière mesure vs objectif) — voir
   *  `lib/axisLogic.ts::computeIndicatorStatus`. */
  status: IndicatorRiskStatus;
  /** Surcharge manuelle du responsable, prioritaire sur `status` (voir `resolveIndicatorStatus`). */
  statusOverride?: IndicatorRiskStatus;
  confidentialityLevel?: string;
  createdAt: string;
  lastUpdate: string;
};

export type IndicatorMeasurement = {
  id: string;
  companyId: string;
  indicatorId: string;
  /** Période de reporting, format libre aligné sur `Indicator.frequency` (ex. "2026-03",
   *  "2026-Q1"). Sert de clé de tri chronologique — d'où un format lexicographiquement ordonné. */
  period: string;
  value?: number;
  note?: string;
  /** Username de l'auteur de la mesure. */
  reportedBy: string;
  reportedAt: string;
};

// ─── Staffing des chantiers (ETP par grande fonction) ─────────────────────────────────────────
//
// Répond au besoin « combien d'ETP, et de quelle direction métier, sont mobilisés sur ce
// chantier / cet axe / ce programme ? ». Volontairement DISJOINT de `Role` (ligne 1) : `Role`
// dit qui a le droit de se connecter et d'agir dans l'app, `StaffingFunction` dit à quelle
// direction métier appartient une personne staffée. Les deux référentiels n'ont ni la même
// granularité ni le même cycle de vie — les confondre obligerait à créer un rôle de connexion
// « Juridique » ou « Achats » pour pouvoir staffer ces fonctions.

/** Grandes fonctions/directions métier mobilisables sur un chantier. Union fermée (et non texte
 *  libre) : c'est la clé d'agrégation de la page Effectifs — un libellé libre produirait autant
 *  de « fonctions » que d'orthographes saisies. "autre" est la porte de sortie pour les cas non
 *  couverts, précisable via `ChantierStaffing.note`. */
export type StaffingFunction =
  | "rh"
  | "finance"
  | "it"
  | "marketing"
  | "commercial"
  | "juridique"
  | "operations"
  | "achats"
  | "autre";

/** Une ligne de staffing = UNE fonction et son volume d'ETP sur UN chantier. Plusieurs lignes
 *  coexistent sur un même chantier (1 RH + 1 Finance = 2 ETP), et rien n'interdit deux lignes de
 *  la même fonction (deux vagues de renfort saisies séparément) : les agrégats somment `fte`, ils
 *  ne comptent pas les lignes. */
export type ChantierStaffing = {
  id: string;
  companyId: string;
  programId: string;
  /** Dénormalisé depuis le chantier : la page Effectifs agrège par axe sans avoir à recharger ni
   *  à joindre la collection `chantiers`. Un chantier ne change jamais d'axe dans l'UI actuelle,
   *  cette copie ne peut donc pas diverger. */
  axisId: string;
  chantierId: string;
  function: StaffingFunction;
  /** Nombre d'ETP, décimal accepté (0.5 = mi-temps). Positif. */
  fte: number;
  /** Précision libre (nom de la personne, périmètre, fonction réelle derrière "autre"…). */
  note?: string;
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
  leverTypes: string[];
  geographies: string[];
  functions: string[];
  pnlAccounts: PnlAccount[];
  levers: Lever[];
  workforce: Workforce;
  operations: Operations;
  alerts: Alert[];
  alertStates?: Record<string, AlertState>;
  audit: AuditEntry[];
  comments: Record<string, Comment[]>;
};

export type NavItem = {
  id: string;
  icon: string;
  label: string;
  badge?: "alerts";
  /** Types de programme pour lesquels cet item est pertinent. `undefined` = tous les types
   *  (comportement historique). Ex. `["performance"]` sur Finance/RH/Workstreams/Opérations,
   *  qui n'ont pas de sens sans leviers. */
  programTypes?: ProgramType[];
  /** Surcharge du `label` selon le type de programme actif — ex. l'item "levers" s'intitule
   *  "Axes stratégiques" quand le programme actif est stratégique (même route, même page). */
  labelByProgramType?: Partial<Record<ProgramType, string>>;
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
  /** Cible réactualisée : Σ reforecast.netSavings ?? lockedPlan.netSavings ?? netSavings —
   *  même logique de repli que la courbe "Réactualisé" de la S-curve (sCurve3). */
  reforecastTarget: number;
  /** Coûts d'implémentation plan initial : Σ lockedPlan.(capex + opexOneOff), repli sur les
   *  valeurs courantes tant que le plan n'est pas figé (avant L3). OPEX récurrent exclu. */
  plannedCosts: number;
  /** Coûts engagés à date : Σ (capex + opexOneOff) × progress% — ASSUMPTION : engagement
   *  proportionnel à l'avancement, cohérent avec realizedSavings(). */
  engagedCosts: number;
  /** Coûts réactualisés : Σ reforecast.(capex + opexOneOff) ?? plan. */
  reforecastCosts: number;
  /** Nb de leviers en retard planning (progression réelle < attendue de plus de 10 pts,
   *  même seuil que underperformers()). */
  riskDelay: number;
  /** Nb de leviers dont les coûts réactualisés dépassent le plan initial. */
  riskCostOverrun: number;
  /** Nb de leviers dont les savings réactualisés sont inférieurs au plan initial. */
  riskSavingsCut: number;
  /** Suppressions de postes prévues (Σ ETP des mouvements RH type "Départ forcé"). */
  suppressionsPlanned: number;
  /** Suppressions de postes réalisées (statut "Réalisé"). */
  suppressionsRealized: number;
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
