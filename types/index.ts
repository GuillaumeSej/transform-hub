/**
 * Rôle "opérationnel" applicatif d'un utilisateur — union FERMÉE, référencée partout (permissions
 * de page via `lib/nav-config.ts`, profils d'utilisateur, `Indicator.responsibleRoles`,
 * `Chantier.responsibleRoles`).
 *
 * Les 6 premières valeurs sont les rôles historiques du Plan Performance. Les 6 suivantes portent
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
 * Round 25 : le COMEX dispose désormais D'UN profil individuel connectable, `comex_member`
 * (lecture seule) — voir son commentaire ci-dessous. Le COMEX reste par ailleurs, comme avant, un
 * organe de gouvernance COLLECTIF : `comex_member` sert à donner à UN membre (ou son délégué/
 * assistant) un accès de consultation nominatif, pas à représenter l'organe lui-même.
 *
 * `admin` (super-admin global) et `admin_entreprise` (admin d'entreprise) n'en font PAS partie :
 * ce ne sont pas des "profils métier" mais des habilitations additives, portées par
 * `AuthUser.isGlobalAdmin`/`isCompanyAdmin` — voir le commentaire sur `AuthUser` ci-dessous.
 *
 * Vue consolidée multi-programmes (fondation) : deux rôles Plan Performance scopés au niveau
 * PROGRAMME (pas workstream, contrairement à `sponsor`) ont été ajoutés :
 *   - `program_sponsor` : sponsor d'UN OU PLUSIEURS programmes Performance (`Program.sponsor`,
 *                          `AuthUser.username`) — même visualisation/nav que `cto`, mais restreint
 *                          aux programmes dont il est sponsor (voir
 *                          `lib/consolidatedProgramAccess.ts::getConsolidatedPerformancePrograms`).
 *   - `program_owner`   : owner d'UN OU PLUSIEURS programmes Performance (`Program.owner`,
 *                          `AuthUser.username`) — même mécanique, restreinte aux programmes dont il
 *                          est owner.
 * Noms choisis pour ne pas collisionner avec `sponsor` (rôle historique scopé WORKSTREAM via
 * `Workstream.sponsorUsername`, voir `lib/leversLogic.ts::isLeverSponsoredBy`) : le préfixe
 * `program_` marque sans ambiguïté le scope PROGRAMME. Comme `cto`, ce sont des rôles rattachables
 * à un `programId` précis sur leur `ProfileAssignment` (round multi-profils multi-programmes) —
 * mais leur périmètre de VISIBILITÉ pour la vue consolidée se déduit de `Program.sponsor`/
 * `Program.owner`, PAS de `ProfileAssignment.programId` (qui reste le mécanisme du sélecteur
 * mono-programme existant, voir `getAuthorizedPrograms`).
 */
export type Role =
  | "cto"
  | "sponsor"
  | "lever"
  | "finance"
  | "hr"
  | "ops"
  | "program_sponsor"
  | "program_owner"
  | "strategic_lead"
  | "axis_sponsor"
  | "chantier_owner"
  | "chantier_contributor"
  | "internal_comm"
  | "budget_control"
  | "comex_member";

/** Les 6 rôles historiques du Plan Performance, PLUS `program_sponsor`/`program_owner` (fondation
 *  vue consolidée) et `comex_member` (round 25) — voir son commentaire juste en dessous de
 *  `STRATEGIC_ROLES` : c'est le seul rôle qui figure dans LES DEUX tableaux
 *  `PERFORMANCE_ROLES`/`STRATEGIC_ROLES` à la fois. */
export const PERFORMANCE_ROLES: Role[] = [
  "cto",
  "sponsor",
  "lever",
  "finance",
  "hr",
  "ops",
  "program_sponsor",
  "program_owner",
  "comex_member",
];

/** Les 6 rôles du Plan Stratégique (organigramme 3-5-15), PLUS `comex_member` (round 25).
 *
 * `comex_member` ("Membre du COMEX") est VOLONTAIREMENT présent dans `PERFORMANCE_ROLES` ET
 * `STRATEGIC_ROLES` : c'est le premier rôle transverse aux deux pistes (lecture seule sur les
 * deux, demande PO explicite), là où les 12 autres rôles sont chacun strictement mono-piste.
 * `isPerformanceRole`/`isStrategicRole` (lib/roleProfiles.ts) testent l'appartenance à CE tableau,
 * pas une propriété portée par le rôle lui-même — un rôle présent dans les deux tableaux est donc
 * "vu" comme appartenant aux deux pistes par ce code, ce qui est le comportement recherché ici :
 * un profil `comex_member` donné (une entrée `ProfileAssignment`, avec son `programId` optionnel)
 * peut être rattaché à un programme Performance OU Stratégique — `assertValidProfiles` (voir
 * lib/roleProfiles.ts) continue de s'appliquer normalement à CHAQUE piste (au plus un profil
 * `comex_member` par programme, ou un profil "tous programmes" non combinable avec un autre profil
 * de la même piste) : un utilisateur peut ainsi cumuler un profil `comex_member` Performance ET un
 * profil `comex_member` Stratégique (deux entrées distinctes), exactement comme il pourrait déjà
 * cumuler un profil Performance et un profil Stratégique d'un autre rôle. Alternative envisagée et
 * écartée : un mécanisme dédié "rôle transverse" en dehors de ces deux tableaux aurait demandé de
 * changer la signature d'`assertValidProfiles`/`isPerformanceRole`/`isStrategicRole` pour un seul
 * rôle sur 13, alors que la duplication ci-dessus réutilise ces fonctions telles quelles. */
export const STRATEGIC_ROLES: Role[] = [
  "strategic_lead",
  "axis_sponsor",
  "chantier_owner",
  "chantier_contributor",
  "internal_comm",
  "budget_control",
  "comex_member",
];

/** Un profil métier assigné à un utilisateur : un rôle, optionnellement rattaché à un programme
 *  précis (plan de perf ou plan stratégique) de son entreprise. `programId` non défini = le rôle
 *  s'applique à l'entreprise sans être lié à un programme particulier (cas des comptes de démo /
 *  entreprises n'ayant qu'un seul programme d'un type donné). */
export type ProfileAssignment = {
  role: Role;
  programId?: string;
};

/** Compte de test (voir lib/auth.ts) — login réel par identifiant/mot de passe, mais toujours
 * des comptes de démo (mot de passe unique "test" pour les comptes/rôles historiques).
 *
 * Un utilisateur peut cumuler PLUSIEURS profils métier via `profiles` (round multi-profils
 * multi-programmes) : plusieurs profils d'une même piste (Plan Performance ou Plan Stratégique)
 * sont désormais possibles, à condition qu'ils portent sur des programmes DISTINCTS (ex. rôle
 * "lever" sur le programme A + rôle "finance" sur le programme B) — voir
 * `lib/roleProfiles.ts::assertValidProfiles` pour la règle exacte. Les habilitations
 * d'administration (`isGlobalAdmin`/`isCompanyAdmin`) sont ADDITIVES : elles s'ajoutent aux
 * profils métier plutôt que de les remplacer (ex. un utilisateur peut être à la fois
 * "responsable de levier" ET admin d'entreprise). Voir `lib/roleProfiles.ts` pour les fonctions
 * de lecture/validation de ce modèle (ne pas relire `profiles`/les flags admin à la main ailleurs
 * dans le code — en particulier, préférer `getPerformanceProfiles`/`getStrategicProfiles`
 * (pluriel) à leurs variantes singulières dès qu'il s'agit d'une vérification de permission). */
export type AuthUser = {
  username: string;
  password: string;
  /** Profils métier de l'utilisateur (0 à N entrées — voir contrainte ci-dessus, au plus un profil
   *  par (piste, programme)). Une entreprise peut avoir des comptes sans aucun profil métier
   *  (ex. un compte purement admin_entreprise). */
  profiles: ProfileAssignment[];
  /** Super-admin global (toutes entreprises) — remplace l'ancienne valeur de rôle "admin". */
  isGlobalAdmin?: boolean;
  /** Admin de SON entreprise (companyId) — remplace l'ancienne valeur de rôle "admin_entreprise".
   *  Additif : un admin d'entreprise peut aussi avoir des profils métier dans `profiles`. */
  isCompanyAdmin?: boolean;
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
   *  utilisateur. Sans effet pour un admin (global ou entreprise, toujours accès total). */
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
  /** `AuthUser.username` du sponsor, quand résolu vers un compte réel — même pattern que
   *  `Lever.ownerUsername` : absent/`undefined` = `sponsor` reste du texte libre (jamais
   *  réconcilié) et le scoping du rôle "sponsor" (voir `lib/leversLogic.ts::isLeverSponsoredBy`)
   *  retombe sur la comparaison de noms fragile historique. Quand défini, c'est lui qui fait foi. */
  sponsorUsername?: string;
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
  /** Libellé d'affichage du propriétaire (nom complet). Round "ownership réel" : pour un levier
   *  RÉCONCILIÉ (voir `ownerUsername` ci-dessous et `lib/leverOwnerReconciliation.ts`), ce champ est
   *  un CACHE dénormalisé — recopié depuis `AuthUser.name` une seule fois au moment de la
   *  réconciliation (via `LeverOwnerReconciliationDialog`/`LeverForm`), jamais recalculé en direct à
   *  chaque rendu. Si la réconciliation aboutit à "aucun compte" (rejet explicite ou aucun candidat
   *  choisi), ce champ est vidé ("") plutôt que de conserver le texte libre d'origine — voir
   *  `ownerUsername`. Pour un levier LEGACY jamais passé par la réconciliation, ce champ reste le
   *  texte libre historique tel quel (compat ascendante, voir doc de `ownerUsername`). */
  owner: string;
  ownerInit: string;
  /** Lien AUTHORITATIF vers un compte `AuthUser` réel (valeur = `AuthUser.username`), établi via la
   *  réconciliation propriétaire (`lib/leverOwnerReconciliation.ts::matchLeverOwner`, déclenchée
   *  après import Excel ou depuis `LeverForm` en création/édition manuelle). Un levier est toujours
   *  scopé à une seule `companyId` : `username` seul suffit à désigner le compte sans ambiguïté (pas
   *  besoin du `accountSlug` complet). Absent/`undefined` = levier LEGACY jamais réconcilié (créé
   *  avant ce round, ou réconciliation explicitement résolue à "aucun compte") — dans ce cas, `owner`
   *  reste (ou redevient) du texte libre, et les contrôles d'accès par propriétaire retombent sur la
   *  comparaison de noms fragile historique (voir `lib/leversLogic.ts::isLeverOwnedBy`). Quand ce
   *  champ EST défini, c'est lui qui fait foi pour l'accès (comparaison stricte de deux identifiants
   *  système, `ownerUsername === user.username`, sans normalisation nécessaire) — `owner` n'est plus
   *  alors qu'un libellé d'affichage synchronisé une fois pour toutes à la réconciliation. */
  ownerUsername?: string;
  sponsor: string;
  /** `AuthUser.username` du sponsor, quand résolu vers un compte réel — même pattern que
   *  `ownerUsername` ci-dessus (voir son doc-comment pour le détail du repli legacy). Sert au
   *  scoping du rôle "sponsor" (`lib/leversLogic.ts::isLeverSponsoredBy`), en plus du sponsor du
   *  workstream parent (`Workstream.sponsorUsername`). */
  sponsorUsername?: string;
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
  /** Workstream.id de la population RH concernée par ce levier — catégoriel (round "population
   *  impactée = qui", pas "combien"), remplace l'ancien champ numérique (effectif) qui ne
   *  s'agrégeait de toute façon nulle part dans l'UI (voir engine.programSummary). Chaîne vide =
   *  non renseigné. */
  popImpacted: string;
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
  /** Impacts financiers/ETP du levier (OPEX, CAPEX, gains, ETP) — saisis dès la création du levier,
   *  indépendants des actions. Source de vérité unique des chiffres du levier (voir
   *  `lib/engine.ts::leverImpactTotals`). */
  impacts?: LeverImpact[];
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
  /** Id du Program (voir type Program) auquel ce levier est rattaché — OBLIGATOIRE : un levier ne
   *  peut pas exister sans être rattaché à un programme (LeverForm/l'import Excel l'imposent
   *  désormais). Les leviers antérieurs à cette règle ont été rattrapés une fois via
   *  scripts/backfill-lever-programid.js ; certaines lectures défensives (dashboard exécutif,
   *  export Excel...) conservent malgré tout un repli `?? "Non assigné"` pour rester robustes à un
   *  programme supprimé après coup (orphelin), pas parce que le champ redeviendrait optionnel. */
  programId: string;
  /** Poids déclaratif (0-100) de ce levier dans l'avancement de son workstream, renseigné par le
   *  pilote du workstream (pas calculé). Les poids des leviers d'un même workstream n'ont pas
   *  besoin de sommer à 100 — voir `lib/workstreamLogic.ts::workstreamDeclaredProgress` pour le
   *  calcul de la moyenne pondérée. Non défini = poids implicite égal entre leviers du workstream. */
  workstreamWeightPct?: number;
  /** Demande de validation en cours pour l'une des 3 portes du cycle de vie (M1→M2, M2→M3,
   *  M3→M4 — voir `LeverApprovalGate`) : le porteur du levier soumet, puis le sponsor du
   *  workstream OU le CTO l'approuve (un seul des deux suffit, peu importe lequel agit en
   *  premier — plus de séquence obligatoire à deux étapes). Non défini = pas de demande en cours
   *  (pas encore soumise, ou déjà approuvée/rejetée). Voir lib/leversLogic.ts::requestLeverApproval /
   *  approveLeverGate / rejectLeverApproval. */
  approval?: LeverApproval;
};

/** Les 3 statuts cibles pouvant être protégés par une demande de validation — M4→M5 (delivered)
 *  reste libre, voir `lib/status-config.ts::STATUS_CYCLE`. */
export type LeverApprovalGate = "qualified" | "validated" | "in_progress";

export type LeverApproval = {
  /** Statut que le levier atteindra une fois la demande approuvée. */
  targetStatus: LeverApprovalGate;
  /** Username de l'utilisateur ayant initié la demande de validation. */
  requestedBy: string;
  requestedAt: string;
  /** Renseignés une fois approuvé (informatif — l'objet `approval` est vidé juste après). */
  approvedBy?: string;
  approvedByRole?: "sponsor" | "cto";
  approvedAt?: string;
};

/** Ligne d'impact d'une action — décrit UN effet financier/RH sur UN poste de coût.
 *  Une action peut avoir plusieurs lignes d'impact (ex: consulting fees + licence + réduction ETP).
 *  Ce sont des attributs de l'action, pas un 3ème niveau de navigation. */
export type LeverImpact = {
  id: string;
  label: string; // "Consulting fees", "Réduction ETP comptables"
  /** "cost" = OPEX/CAPEX, "saving" = gain, "fte" = impact ETP (voir `fteDirection`). */
  type: "cost" | "saving" | "fte";
  /** Pour type="cost" : CAPEX, OPEX récurrent, ou OPEX One-off. Ignoré pour "saving"/"fte". */
  nature: "capex" | "opex_rec" | "oneoff";
  amount: number; // €M — toujours positif, le type détermine le signe. Pour type="fte" : salaire chargé total (€M) des ETP concernés.
  fteCount?: number; // ETP — toujours positif, le sens est porté par `fteDirection`
  /** Pour type="fte" : "hire" = recrutement (+ETP, coût), "departure" = départ (-ETP, économie). */
  fteDirection?: "hire" | "departure";
  /** Pour type="saving" : gain récurrent annuel (défaut, seul compté dans les savings) ou gain
   *  ponctuel one-off (affiché à part, JAMAIS agrégé aux savings/gains bruts annualisés). */
  gainRecurrence?: "annual" | "oneoff";
  /** Id d'une entrée de `Company.impactNatures` (nature du coût/du gain : matières premières,
   *  main-d'œuvre...). Paramétrable en admin. */
  natureId?: string;
  /** Technologie impactée — champ libre (utile pour les leviers industriels/opérationnels). */
  technology?: string;
  /** Id du HierarchyNode géographique (maille la plus fine de l'arborescence géographique). */
  geographyLeafId?: string;
  /** Id du HierarchyNode (maille la plus fine, ex. Cost Center) pour CETTE ligne d'impact —
   *  même mécanique que Lever.hierarchyLeafId, mais résolue en priorité sur lui dans
   *  engine.pnlImpactDetailed (un levier peut avoir des gains sur plusieurs comptes P&L
   *  différents selon ses actions). Non défini = l'impact n'est pas encore rattaché (ex. levier
   *  encore trop peu planifié) : il retombe alors dans le bucket "gains non attribués" plutôt que
   *  d'hériter d'un rattachement au niveau du levier, qui n'existe plus à la création. */
  hierarchyLeafId?: string;
  pnlMap?: string; // compte P&L (hérite du levier si absent) — legacy, utilisé seulement si l'entreprise n'a pas d'arborescence financière configurée
  costCenter?: string;
  entity?: string; // entité légale (hérite du levier si absent)
  /** Nature du gain (uniquement pour type="saving") : baisse de coût / hausse de CA / impact BFR. */
  savingType?: SavingType;
  /** Pour nature="capex" — mode de comptabilisation : en une fois ("one_shot", défaut) ou lissé sur
   *  une période ("smoothed"). Ignoré si nature !== "capex". */
  capexAllocationMode?: "one_shot" | "smoothed";
  /** Pour nature="capex" avec capexAllocationMode="smoothed" — début de la période de lissage. */
  capexStartDate?: string; // ISO date
  /** Pour nature="capex" — date à laquelle le CAPEX est supposé engagé à 100% (jusqu'ici confondue
   *  avec les dates de l'action elle-même). En mode "smoothed", sert de date de fin de lissage. */
  capexDeploymentDate?: string; // ISO date
  /** Pour type="saving" — date/milestone d'encaissement réel du gain (peut être postérieure à la
   *  fin de l'action). */
  gainDate?: string; // ISO date
  /** Statut de l'impact : planifié ; réalisé (ponctuel, a eu lieu) ; en cours (récurrent, court depuis
   *  sa date de début). Absent = dérivé de la date de début (`impactStatusOf`, lib/impactStatus.ts). */
  status?: "planned" | "done" | "ongoing";
  /** Date de fin (ETP, ou impact borné) — optionnelle. Le CAPEX lissé utilise `capexDeploymentDate`. */
  endDate?: string; // ISO date
  /** Commentaires libres sur cette ligne d'impact (ex. méthode de calcul, hypothèses). */
  comments?: Comment[];
};

/** @deprecated Renommé `LeverImpact` — les impacts sont désormais portés par le levier
 *  (`Lever.impacts`), plus par les actions. Alias conservé le temps de la migration. */
export type ActionImpact = LeverImpact;

export type LeverAction = {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  ownerInit?: string;
  start: string; // ISO date
  end: string; // ISO date
  status: ActionStatus;
  deliveredDate?: string; // date de passage en "done"
  /** @deprecated Les impacts ne sont plus portés par les actions mais par `Lever.impacts`.
   *  Champ legacy : lu uniquement par la migration (`lib/leverImpactMigration.ts`) qui remonte
   *  ces lignes sur le levier puis le vide. Ne plus écrire dedans. */
  impacts?: LeverImpact[];
  /** Pondération (0-100) de cette action dans l'avancement du levier. Mode pondéré = TOUTES les
   *  actions du levier ont `weightPct` défini ET la somme vaut 100. Sinon mode "non pondéré"
   *  (moyenne simple des avancements). Voir `lib/engine.ts::leverActionWeighting`. */
  weightPct?: number;
  /** Avancement déclaratif (0-100) de cette action, renseigné par le pilote du levier — distinct
   *  de `status` (étape maturité). Sert au calcul de `leverDeclaredProgress` puis
   *  `workstreamDeclaredProgress` (voir `lib/workstreamLogic.ts`). Non défini = action non encore
   *  déclarée, ignorée du calcul (pas comptée comme 0%). */
  declaredProgressPct?: number;
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
  /** Id du HierarchyNode (maille la plus fine, ex. Centre de coût) — même mécanique que
   *  `Lever.hierarchyLeafId` : permet de rattacher l'impact financier (`salaryImpact`/`savings`/
   *  `cost`) d'un mouvement RH à l'arborescence financière configurée par l'entreprise, pour le
   *  filtrer/ventiler comme un levier. Optionnel — un mouvement sans rattachement fin reste
   *  affiché normalement (aucun changement pour les entreprises sans arborescence configurée). */
  hierarchyLeafId?: string;
  /** Maille la plus fine de l'arborescence géographique configurée pour l'entreprise — même
   *  mécanique que `Lever.geographyLeafId`. Optionnel, coexiste avec le champ `country` en texte
   *  libre ci-dessus (conservé tel quel pour compat / repli entreprises sans arborescence). */
  geographyLeafId?: string;
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
  action:
    | "updated"
    | "commented"
    | "completed"
    | "created"
    | "validated"
    | "deleted"
    // Demande de validation d'un levier (owner → sponsor ou cto), voir
    // lib/leversLogic.ts::requestLeverApproval/approveLeverGate/rejectLeverApproval.
    | "approval_requested"
    | "approval_approved"
    | "approval_rejected";
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
  /** Seuils de segmentation du risque d'un levier en fonction du cumul des montants (€, valeur
   *  absolue de Alert.impactEur) des alertes ouvertes qui lui sont liées (voir
   *  engine.computeLeverRisk). Non défini = seuils par défaut (voir DEFAULT_RISK_THRESHOLDS dans
   *  lib/engine.ts). `delayDays` (optionnel) ajoute un second critère de bascule au niveau, sur
   *  l'ancienneté (en jours) de la plus vieille alerte ouverte du scope — un levier peut ainsi
   *  monter d'un niveau de risque soit par montant, soit par délai dépassé, le plus élevé des
   *  deux étant retenu. Non défini = pas de contrainte de délai pour ce niveau. */
  riskThresholds?: { level: RiskLevel; minAmount: number; delayDays?: number }[];
  /** Types de levier paramétrables (ex. Automatisation, Excellence opérationnelle). Non défini =
   *  `DEFAULT_LEVER_TYPES` (lib/impactConfig.ts). */
  leverTypes?: string[];
  /** Natures de coût/gain paramétrables (ex. matières premières, main-d'œuvre). Non défini =
   *  `DEFAULT_IMPACT_NATURES` (lib/impactConfig.ts). */
  impactNatures?: ImpactNatureDef[];
};

export type ImpactNatureDef = {
  id: string;
  label: string;
  /** À quels impacts la nature s'applique : coûts (OPEX/CAPEX), gains, ou les deux. */
  appliesTo: "cost" | "saving" | "both";
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
  /** Niveau facultatif (au plus un par arborescence, en général le plus fin, ex. Centre de coût) :
   *  s'il est optionnel, la maille "effective" affichée dans les filtres/impacts est le niveau
   *  non-optionnel le plus fin ; le niveau optionnel reste saisissable quand il est connu. */
  optional?: boolean;
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
  /** Métadonnées des lignes P&L, utilisées uniquement au niveau semantic="pnl".
   *  Le signe de `baseline` porte la nature du compte (négatif = coût, positif = revenu) — il n'y
   *  a pas de champ `sign` séparé, ce serait redondant et source d'incohérence. */
  financial?: {
    baseline: number;
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
  /** `AuthUser.username` du sponsor (sélectionné via `UserPicker`, restreint aux utilisateurs de
   *  `companyId`) — jamais un texte libre. Optionnel : un programme peut ne pas avoir de sponsor
   *  désigné. Sert aussi de périmètre à la vue consolidée du rôle `program_sponsor` (voir
   *  `lib/consolidatedProgramAccess.ts`). */
  sponsor?: string;
  /** `AuthUser.username` de l'owner (même pattern que `sponsor` ci-dessus : sélectionné via
   *  `UserPicker`, jamais un texte libre). Optionnel. Sert de périmètre à la vue consolidée du rôle
   *  `program_owner` (voir `lib/consolidatedProgramAccess.ts`) — distinct du sponsor : un programme
   *  peut avoir l'un, l'autre, les deux, ou aucun. */
  owner?: string;
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
  /** Module additionnel "Plan d'action" (onglet Kanban/Gantt sur chaque levier), activable par
   *  programme selon les options souscrites par le client. Ne concerne QUE les programmes de
   *  type "performance" (les axes/chantiers stratégiques n'ont pas cet onglet) — ignoré/absent
   *  pour un programme "strategic". `undefined` = activé (comportement historique, avant
   *  l'introduction du toggle, alors porté par `Company.actionPlanEnabled`, retiré depuis :
   *  l'activation se décide par programme, pas globalement pour toute l'entreprise). */
  actionPlanEnabled?: boolean;
  /** Vision/accroche courte du programme (round 12), affichée de façon persistante sur le
   *  dashboard stratégique (`components/strategic/StrategicDashboardView.tsx`) — texte libre,
   *  distinct de `name` (l'intitulé) : "ce qu'on cherche à atteindre" plutôt que "comment le
   *  programme s'appelle". Optionnel, aucune valeur par défaut : un programme sans ambition
   *  déclarée n'affiche simplement rien à cet endroit.
   *
   *  N'a de sens QUE pour un programme "strategic" (retiré du formulaire de création/édition pour
   *  un programme "performance" dans `components/admin/ProgramsPanel.tsx` — un Plan Performance n'a
   *  pas d'"ambition" au sens de cette vision 3-5-15). Champ conservé sur `Program` (pas retiré du
   *  type) car réellement lu par `StrategicDashboardView` : seul son édition côté Performance a été
   *  retirée. */
  ambition?: string;
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
  /** Sponsor de l'axe (`AuthUser.username`, saisi via `UserPicker`, round 25) — rôle unique de
   *  responsabilité sur l'axe (décision explicite : pas de duplication sponsor COMEX / responsable
   *  opérationnel au niveau axe, contrairement à `Chantier.sponsorName`/`Chantier.pilote`). Même
   *  convention que `Chantier.pilote`/`Chantier.sponsorName`/`ChantierAction.owner`/`ChantierAction.sponsor` :
   *  plus du texte libre, un lien résolu vers un compte réel de l'entreprise. `UserPicker` reste
   *  défensif à l'égard des valeurs saisies AVANT cette conversion (texte libre historique, ou
   *  utilisateur depuis retiré de l'entreprise) — voir son commentaire. */
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

/** Un des 5 jalons fixes et nommés de la méthode PMO E0→E4 (round 5, demande PO explicite) —
 *  SYSTÈME PARALLÈLE à `MaturityStageConfig`/`Chantier.stage` (qui reste inchangé et continue de
 *  servir aux axes/actions) : 5 jalons fixes, pas configurables par programme, avec une
 *  sous-structure de check-list riche qui ne rentre pas dans le modèle "stage" simple. Ordre de
 *  passage dans `MILESTONE_ORDER` (voir `lib/milestoneChecklist.ts`). */
export type MilestoneId = "E0" | "E1" | "E2" | "E3" | "E4";

/** Réponse à UN item de check-list d'un jalon donné (le contenu de l'item — libellé, caractère
 *  automatique — est en dur dans `lib/milestoneChecklist.ts`, seule la réponse est persistée ici).
 *  Round 26 : `canPassMilestone` (lib/axisLogic.ts) exige que TOUS les items d'un jalon soient à
 *  `progressPct === 100` pour passer au jalon suivant — il n'y a donc plus d'état "orange" reporté
 *  d'un jalon à l'autre (l'ancien item automatique `auto: "previousOranges"` qui portait ce report
 *  a été retiré, voir `lib/milestoneChecklist.ts`). `progressPct` garde néanmoins sa plage 0-100
 *  (plutôt que d'être réduit à un simple booléen) pour minimiser l'impact sur les documents déjà
 *  persistés et sur le reste du code (`milestoneProgressPct`, l'affichage par pastille 3 teintes,
 *  etc.) qui continue de s'appuyer dessus — une valeur strictement entre 0 et 100 reste affichée en
 *  "orange" (`progressBucket`) et reste saisissable avec un plan d'action, mais elle BLOQUE
 *  désormais `canPassMilestone` exactement comme `0`, elle n'est plus "non-bloquante pour le jalon
 *  courant". */
export type MilestoneChecklistItem = {
  /** Référence un `ChecklistItemDef.itemId` de `lib/milestoneChecklist.ts` (ex. "E0-A1"). */
  itemId: string;
  /** Avancement déclaré par le responsable du LEVIER, 0-100 (round 12) — remplace le feu discret
   *  `ChecklistFlag` à trois niveaux. Pour un item manuel, saisi à la main sur la fiche chantier ;
   *  pour un item `auto` (voir `ChecklistItemDef.auto`), calculé par `resolveMilestoneAutoFlags`
   *  (100 ou 0, jamais de valeur intermédiaire) et jamais stocké tel quel — cette clé, sur un item
   *  auto, ne reflète donc qu'une éventuelle valeur manuelle résiduelle antérieure. Absent = pas
   *  encore déclaré (un item manuel sans `progressPct` bloque `canPassMilestone`, au même titre
   *  qu'un item à 0 ou à toute valeur `!== 100` — voir son commentaire) ; distinct de `0`, qui
   *  signifie "déclaré, à l'arrêt". Round 26 : `canPassMilestone` exige `=== 100` pour CHAQUE item,
   *  voir le commentaire de tête du type. */
  progressPct?: number;
  /** Pertinent seulement quand `progressPct` est strictement entre 0 et 100 (équivalent de l'ancien
   *  `flag === "orange"`) — plan d'action daté et attribué (piège `saveChantier` : omettre cette
   *  clé plutôt que d'y mettre `undefined` quand elle est vide). */
  actionPlan?: { description: string; owner?: string; dueDate?: string };
  /** Un item à progression partielle (0 < progressPct < 100) peut être marqué "soldé" sans changer
   *  sa valeur — purement déclaratif depuis round 26 (n'alimente plus aucun verrou automatique,
   *  l'ancien report `auto: "previousOranges"` ayant été retiré ; conservé comme simple indicateur
   *  "plan d'action pris en charge" sur la fiche). */
  resolved?: boolean;
};

/** État de suivi des jalons E0→E4 d'un chantier (round 5) — additionnel à `Chantier.stage`, pas un
 *  remplacement : voir le commentaire de `MilestoneId`. */
export type ChantierMilestoneState = {
  /** Jalon en cours de traitement, PAS ENCORE validé — c'est celui dont la check-list est ouverte
   *  sur la fiche chantier. */
  currentMilestone: MilestoneId;
  /** Jalons déjà validés, dans l'ordre de passage — la progression affichée du chantier est
   *  `passedMilestones.length * 20` (voir `milestoneProgressPct`), à la place de l'ancien
   *  `chantierProgress()` pondéré par durée d'action (qui reste dans le code mais n'est plus
   *  branché sur ces 3 affichages). */
  passedMilestones: MilestoneId[];
  /** Réponses par jalon — `Partial` car un jalon pas encore atteint n'a pas de check-list saisie. */
  checklists: Partial<Record<MilestoneId, MilestoneChecklistItem[]>>;
};

/** Un chantier = un regroupement d'actions concrètes qui font avancer un axe. Niveau
 *  intermédiaire absent du modèle Performance : c'est lui qui structure le Gantt (un bloc de
 *  Gantt = un chantier, pas une action isolée). */
export type Chantier = {
  id: string;
  companyId: string;
  programId: string;
  /** Axes stratégiques auxquels ce chantier appartient (round 24) — un chantier peut désormais
   *  contribuer à PLUSIEURS axes simultanément. Toujours non-vide : `axisIds[0]` est l'axe
   *  "primaire" au sens interne uniquement (jamais exposé comme concept nommé à l'utilisateur),
   *  utilisé seulement là où un axe unique et déterministe est structurellement requis (ex.
   *  routage d'une notification, repli de propriétaire d'axe). Partout ailleurs, un chantier
   *  multi-axe doit être traité comme appartenant pleinement à CHACUN de ses axes (voir
   *  `lib/axisLogic.ts`). */
  axisIds: string[];
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
  /** Grille de notation d'effort — voir `ChantierEffort`, affichée uniquement sur la fiche
   *  chantier dédiée. */
  effort?: ChantierEffort;
  /** @deprecated Suivi des jalons E0→E4 (round 5) — DÉPLACÉ au niveau de chaque levier
   *  (`ChantierAction.milestones`) en round 7 : un chantier regroupe plusieurs leviers, le suivi
   *  E0→E4 n'a plus de sens agrégé à ce niveau (voir `chantierMilestoneProgressPct` dans
   *  `lib/axisLogic.ts`, moyenne des leviers). Champ conservé pour compat des documents Firestore
   *  existants (aucun script de migration) mais plus LU par le code depuis round 7 — ne pas
   *  réutiliser dans du nouveau code. */
  milestones?: ChantierMilestoneState;
  /** Critères de succès mesurables, en complément de `successCriteria` (texte libre, INCHANGÉ) —
   *  demande PO round 5 : une liste de KPI cochables plutôt qu'un unique paragraphe. */
  successKpis?: {
    id: string;
    label: string;
    achieved?: boolean;
    /** KPI (`Indicator.id`) mesurant ce critère — optionnel (critère purement textuel sinon). */
    indicatorId?: string;
    /** Valeur cible que le chantier vise sur ce KPI (prime sur `Indicator.objectiveValue`). */
    targetValue?: number;
  }[];
  /** Budget alloué au chantier (round 7, demande PO), affiché avec `Program.currency` du programme
   *  actif. Optionnel : `undefined` tant qu'aucun budget n'a été saisi (distinct de 0, qui signifie
   *  "budget nul mais renseigné"). */
  allocatedBudget?: number;
  /** Montant réellement consommé/dépensé sur ce chantier, déclaré manuellement — distinct
   *  d'`allocatedBudget` qui est le montant planifié/cible. Affiché avec `Program.currency` du
   *  programme actif, même convention : `undefined` tant qu'aucun montant n'a été saisi (distinct de
   *  0, qui signifie "consommé nul mais renseigné"). */
  consumedBudget?: number;
  /** ETP réellement consommés sur ce chantier, déclarés manuellement — pendant de `consumedBudget`
   *  mais pour l'effort humain plutôt que le montant financier. Distinct des lignes de besoin
   *  planifié `ChantierStaffing.fte` (voir plus bas dans ce fichier) : pas de ventilation par équipe
   *  ici, une simple valeur globale déclarative. Optionnel : `undefined` tant qu'aucune valeur n'a
   *  été saisie (distinct de 0, qui signifie "ETP consommés nul mais renseigné"). */
  consumedFte?: number;
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
  /** Date d'échéance ISO du livrable, INDÉPENDANTE des `phases` ci-dessus — positionne le losange
   *  du livrable sur l'onglet "Timeline" fusionné de la fiche chantier (round <n>, remplace
   *  l'ancien onglet dédié aux phases). Les `phases` restent éditables comme sous-étapes internes
   *  mais ne sont plus dessinées en Gantt dans cette timeline. Absent = livrable sans échéance
   *  déclarée, invisible sur la timeline (mais toujours listé dans l'onglet "Leviers"). */
  dueDate?: string;
  /** Statut à 3 états du livrable — RÉUTILISE `ProjetKanbanStatus` (pas de nouvel enum, voir son
   *  commentaire) : `undefined` traité comme "todo". Colore le losange sur la timeline (todo →
   *  rouge, in_progress → ambre, done → vert). */
  status?: ProjetKanbanStatus;
  /** Mini fil de commentaires embarqué directement dans le document (round <n>) — distinct du
   *  système de commentaires leviers/sub-levers du module Plan Performance (collection Firestore
   *  séparée) ; ici un simple tableau, pas de sous-collection. */
  comments?: {
    id: string;
    text: string;
    /** Username de l'auteur si connu (voir `resolveUserLabel`) — absent si non renseigné. */
    author?: string;
    createdAt: string; // ISO datetime
  }[];
};

/**
 * Demande de validation de jalon en cours pour UN projet (`ChantierAction`, round "jalon validation
 * gate") — pendant stratégique de `LeverApproval` (voir son commentaire ci-dessus), adapté :
 * contrairement au Plan Performance (3 des transitions de statut seulement, sponsor OU cto), le
 * Plan Stratégique protège TOUTES les transitions de jalon (E0→E1, E1→E2, E2→E3, E3→E4), avec un
 * SEUL rôle approbateur, `strategic_lead` (le "pilote stratégique"), scopé à son programme exactement
 * comme `cto` côté Performance (voir `lib/axisLogic.ts::isStrategicLeadOf`, pendant d'
 * `isLeverCtoOf`). Voir `lib/axisLogic.ts::requestMilestoneApproval`/`approveMilestoneGate`/
 * `rejectMilestoneApproval` pour la logique métier complète. Non défini = pas de demande en cours
 * (pas encore soumise, ou déjà approuvée/rejetée).
 */
export type ChantierMilestoneApproval = {
  /** Jalon que le projet atteindra une fois la demande approuvée — toujours celui qui suit
   *  immédiatement `ChantierMilestoneState.currentMilestone` au moment de la demande (voir
   *  `MILESTONE_ORDER`, lib/milestoneChecklist.ts). */
  targetMilestone: MilestoneId;
  /** Username de l'utilisateur ayant initié la demande de validation — le propriétaire du projet
   *  (`ChantierAction.owner`) ou un admin, voir `requestMilestoneApproval`. */
  requestedBy: string;
  requestedAt: string;
  /** Renseignés une fois approuvé (informatif — l'objet `milestoneApproval` est vidé juste après,
   *  même convention que `LeverApproval.approvedBy`/`approvedAt`). */
  approvedBy?: string;
  approvedAt?: string;
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
  /** Suivi des jalons E0→E4 (round 7) — même type que l'ancien `Chantier.milestones` (voir son
   *  commentaire `@deprecated`), réutilisé tel quel mais désormais porté par le LEVIER plutôt que
   *  le chantier : un chantier regroupe plusieurs leviers, chacun avance à son propre rythme dans
   *  la méthode E0→E4. Absent sur un levier créé avant l'introduction de ce suivi, ou avant round
   *  7 : traité comme "encore à E0, rien de répondu" par les lecteurs plutôt que de migrer les
   *  documents existants.
   *
   *  Round 18 : ce suivi E0→E4 s'applique désormais UNIVERSELLEMENT, que le levier ait ou non un
   *  `indicatorId` — l'ancien aiguillage vers un kanban 3-états pour les leviers sans KPI a été
   *  supprimé (le PO a tranché pour un système unique, plus simple à piloter). */
  milestones?: ChantierMilestoneState;
  /** Demande de validation de jalon en cours — voir `ChantierMilestoneApproval` ci-dessus. Non
   *  défini = pas de demande en cours. Le SEUL chemin légitime pour faire progresser
   *  `milestones.currentMilestone`/`passedMilestones` une fois `canPassMilestone` satisfait (voir
   *  lib/axisLogic.ts) : `requestMilestoneApproval` (propriétaire du projet ou admin) puis
   *  `approveMilestoneGate` (`strategic_lead` scopé au programme, ou admin). */
  milestoneApproval?: ChantierMilestoneApproval;
  /** Poids déclaratif (0-100) de ce PROJET dans l'avancement de son chantier, renseigné par le
   *  pilote du chantier (`Chantier.pilote`) — pendant stratégique de `Lever.workstreamWeightPct`
   *  (voir son commentaire ci-dessus), même sémantique : les poids des projets d'un même chantier
   *  n'ont pas besoin de sommer à 100, voir `lib/axisLogic.ts::chantierDeclaredProgress` pour le
   *  calcul de la moyenne pondérée. Non défini = poids implicite égal entre projets du chantier. */
  chantierWeightPct?: number;
  /** Lien optionnel vers un `Indicator` (KPI) de l'axe ou du chantier de ce levier — round 8, statut
   *  round 18 : purement informatif, n'aiguille plus aucun système de suivi (le suivi E0→E4 via
   *  `milestones` ci-dessus s'applique à tous les leviers, avec ou sans KPI rattaché). Liste des KPI
   *  proposés à un levier donné (décision PO) : indicateurs "macro" d'UN DES axes du chantier
   *  (round 24 : `chantier.axisIds.includes(Indicator.axisId) && !Indicator.chantierId`, un chantier
   *  multi-axe propose les macro-KPI de CHACUN de ses axes) + indicateurs déjà rattachés à CE
   *  chantier précis (`Indicator.chantierId === chantier.id`) — jamais un indicateur d'un axe
   *  totalement étranger au chantier. */
  indicatorId?: string;
  /** Budget alloué à ce LEVIER (round 12), affiché avec `Program.currency` du programme actif —
   *  pendant de `Chantier.allocatedBudget` mais au niveau du levier plutôt que du chantier (les
   *  deux coexistent : un budget de levier n'est pas déduit du budget du chantier, voir
   *  `sumProjetBudgets` dans `lib/axisLogic.ts` pour l'agrégat). Optionnel : `undefined` tant
   *  qu'aucun budget n'a été saisi (distinct de 0, qui signifie "budget nul mais renseigné"). */
  budget?: number;
  /** Montant réellement consommé/dépensé sur ce LEVIER, déclaré manuellement — distinct de `budget`
   *  qui est le montant planifié/cible, même logique que `Chantier.consumedBudget` mais au niveau du
   *  levier plutôt que du chantier. Optionnel : `undefined` tant qu'aucun montant n'a été saisi
   *  (distinct de 0, qui signifie "consommé nul mais renseigné"). */
  consumedBudget?: number;
  /** ETP réellement consommés sur ce LEVIER, déclarés manuellement — pendant de `Chantier.consumedFte`
   *  mais au niveau du levier plutôt que du chantier. Optionnel : `undefined` tant qu'aucune valeur
   *  n'a été saisie (distinct de 0, qui signifie "ETP consommés nul mais renseigné"). */
  consumedFte?: number;
};

/** Statut à 3 états — introduit round 8 pour le "kanban classique" d'un projet sans KPI rattaché
 *  (`ChantierAction.kanbanStatus`), supprimé round 18 quand le PO a unifié tous les projets sur le
 *  suivi E0→E4. Le type SURVIT néanmoins : il reste utilisé par `Deliverable.status`, un concept
 *  totalement différent (le statut d'UN livrable, pas le système de suivi global d'un projet) — ne
 *  pas re-brancher ce type sur un quelconque aiguillage au niveau projet. Même FORME que
 *  `ActionStatus` du Plan Performance (`components/shared/ActionKanban.tsx`, gabarit visuel suivi
 *  pour le composant équivalent côté Plan Stratégique) mais type entièrement SÉPARÉ — ne jamais
 *  importer/réutiliser `ActionStatus` ici, les deux domaines restent strictement indépendants (voir
 *  le commentaire de tête de `lib/axisLogic.ts`). Pas de valeur "delayed" (contrairement à
 *  `ActionStatus`) : ce statut est un simple aiguillage, la notion de retard n'a pas de sens ici. */
export type ProjetKanbanStatus = "todo" | "in_progress" | "done";

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
// Répond au besoin « combien d'ETP, et de quelle équipe, sont mobilisés sur ce chantier / cet
// axe / ce programme, et est-ce cohérent avec ce que la base ETP (Plan Performance,
// app/(app)/hr/etp) montre réellement dans cette équipe ? ». Volontairement DISJOINT de `Role`
// (ligne 1) : `Role` dit qui a le droit de se connecter et d'agir dans l'app, le champ `function`
// de `ChantierStaffing` ci-dessous dit à quelle équipe appartient le besoin en ETP staffé.
//
// Round 13 : l'ancienne union fermée `StaffingFunction` (9 valeurs figées, RH/Finance/IT/...) a
// été RETIRÉE — c'est désormais la base ETP ENTREPRISE (`Employee.department`, module RH/Workforce
// du Plan Performance, voir lib/workforceLogic.ts::fteByDepartment) qui fait foi pour la liste des
// équipes disponibles, jamais l'inverse. `ChantierStaffing.function` est donc un texte libre dont
// la valeur est censée correspondre à un `Employee.department` existant (le sélecteur de saisie,
// `ChantierStaffingEditor.tsx`, ne propose QUE les départements réellement présents dans la base
// ETP de l'entreprise) — ce qui permet de comparer le BESOIN déclaré ici (`fte`, sommé par équipe)
// au DISPONIBLE réel de cette équipe (somme des `Employee.fte` de ce département), affiché sur
// `app/(app)/effectifs/EffectifsPageClient.tsx`. Le champ reste un `string` (pas de FK stricte) :
// une entreprise sans base ETP encore saisie, ou une ligne historique dont le département a depuis
// été renommé/supprimé côté RH, doit rester lisible plutôt que de casser l'affichage.

/** Une ligne de staffing = UNE équipe (`function`, voir note ci-dessus) et son volume d'ETP sur UN
 *  chantier. Plusieurs lignes coexistent sur un même chantier (1 ligne RH + 1 ligne Finance = 2
 *  ETP), et rien n'interdit deux lignes de la même équipe (deux vagues de renfort saisies
 *  séparément) : les agrégats somment `fte`, ils ne comptent pas les lignes. */
export type ChantierStaffing = {
  id: string;
  companyId: string;
  programId: string;
  chantierId: string;
  /** Nom d'équipe/département — voir note de tête de section. Censé correspondre à un
   *  `Employee.department` de la base ETP entreprise, jamais une valeur figée dans ce type. */
  function: string;
  /** Nombre d'ETP, décimal accepté (0.5 = mi-temps). Positif. */
  fte: number;
  /** Précision libre (nom de la personne, périmètre, fonction réelle derrière "autre"…). */
  note?: string;
  /** Date de début du staffing (ISO), round 7 — permet de répartir les ETP par période
   *  (trimestre/semestre/année, voir `staffingPeriodBuckets` dans `lib/axisLogic.ts`). Absente =
   *  staffing "non daté" : compté dans les totaux globaux mais ignoré par la vue par période. */
  startDate?: string;
  /** Date de fin du staffing (ISO), round 7 — optionnelle même quand `startDate` est renseignée
   *  (staffing sans échéance connue). */
  endDate?: string;
  /** Lien optionnel vers un levier précis (`ChantierAction.id`) de ce même chantier, round 7 — un
   *  staffing transverse au chantier (pas rattaché à un levier particulier) reste valide sans ce
   *  champ. */
  actionId?: string;
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
  badge?: "alerts" | "approvals";
  /** Types de programme pour lesquels cet item est pertinent. `undefined` = tous les types
   *  (comportement historique). Ex. `["performance"]` sur Finance/RH/Workstreams/Opérations,
   *  qui n'ont pas de sens sans leviers. */
  programTypes?: ProgramType[];
  /** Surcharge du `label` selon le type de programme actif — ex. l'item "levers" s'intitule
   *  "Feuille de route" quand le programme actif est stratégique (même route, même page). */
  labelByProgramType?: Partial<Record<ProgramType, string>>;
  /** Regroupement visuel optionnel dans la barre latérale (ex. séparer les données de
   *  référence du pilotage courant). `undefined` = pas de rupture affichée (comportement
   *  historique, liste plate). Un séparateur avec libellé apparaît dès que la section change
   *  d'un item au suivant. */
  section?: string;
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
