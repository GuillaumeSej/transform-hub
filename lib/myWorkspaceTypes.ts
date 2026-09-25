/**
 * Contrat de données du portail « Mon espace » (page `/me`) — V1 en lecture seule, SANS
 * messagerie. Le moteur (`lib/myWorkspace.ts`, pur, testé) agrège, pour l'utilisateur courant,
 * ce qui existe déjà dans BeTrack (files de validation, alertes ciblées, alertes mouvements RH,
 * projets/actions de chantier, mesures d'indicateurs…) ; la page (`app/(app)/me/page.tsx`) ne
 * fait que l'afficher. Aucune nouvelle donnée n'est stockée.
 */

/** Plan d'origine de l'élément. */
export type WorkspacePlan = "performance" | "strategic";

/** Gravité : `critical` = en retard / bloquant, `warning` = à échéance proche ou décision
 *  attendue, `info` = à venir. */
export type WorkspaceSeverity = "critical" | "warning" | "info";

/** Famille de l'élément — sert à l'icône, au filtre par type et au regroupement. */
export type WorkspaceItemSource =
  | "leverApproval" // porte de validation de levier (file `useApprovalQueue`)
  | "realizedApproval" // impact réalisé à valider (finance)
  | "milestoneApproval" // jalon de projet à valider (Plan Stratégique)
  | "strategicApproval" // demande de validation stratégique (création/suppression…)
  | "leverAlert" // alerte levier ciblée sur l'utilisateur (cloche)
  | "hrMovement" // mouvement RH en alerte (profil RH)
  | "chantierAction" // projet / action de chantier dont l'utilisateur est owner
  | "indicatorMeasurement" // mesure d'indicateur à saisir
  | "blockedValidation"; // (vue pilotage CTO) validation en attente chez quelqu'un d'autre

export type WorkspaceItem = {
  /** Identifiant stable, unique dans le portail (ex. `leverApproval:<leverId>:<gate>`). */
  id: string;
  source: WorkspaceItemSource;
  plan: WorkspacePlan;
  severity: WorkspaceSeverity;
  /** Libellé déjà traduit, court (« Valider le passage M2 → M3 »). */
  title: string;
  /** Contexte déjà traduit (code + nom du levier / chantier / programme). */
  context: string;
  /** Échéance ISO `YYYY-MM-DD` si l'élément en a une. */
  dueDate?: string;
  /** Jours de retard (> 0) si l'échéance est dépassée. */
  daysLate?: number;
  /** Depuis combien de jours l'élément attend (validations bloquées, vue CTO). */
  waitingDays?: number;
  /** Personne chez qui l'élément est bloqué (vue CTO, `AuthUser.username` ou libellé). */
  waitingOn?: string;
  /** Route interne vers le détail (ex. `/levers/detail?id=…`, `/validation`). */
  href: string;
  programId?: string;
};

export type WorkspaceHealth = "green" | "amber" | "red" | "neutral";

export type WorkspacePerimeterEntry = {
  id: string;
  kind: "program" | "lever" | "axis" | "chantier" | "action";
  plan: WorkspacePlan;
  /** Libellé déjà traduit (code + nom). */
  label: string;
  /** Rôle de l'utilisateur sur cet objet, déjà traduit (« Responsable », « Sponsor »…). */
  role: string;
  health: WorkspaceHealth;
  /** Avancement 0-100 si pertinent. */
  progressPct?: number;
  href: string;
};

export type MyWorkspace = {
  /** À faire maintenant — en retard puis à échéance, tri : severity, puis daysLate desc, puis dueDate. */
  todo: WorkspaceItem[];
  /** À venir (échéance dans la fenêtre `upcomingDays`, par défaut 28 j), tri par dueDate. */
  upcoming: WorkspaceItem[];
  /** Vue pilotage (CTO / program_sponsor / program_owner / admin) : validations en attente chez
   *  d'autres depuis plus de `blockedAfterDays` (7 j par défaut). Vide pour les autres profils. */
  blocked: WorkspaceItem[];
  /** Mon périmètre : pour la vue pilotage, une ligne par programme ; sinon les objets où
   *  l'utilisateur a un rôle. */
  perimeter: WorkspacePerimeterEntry[];
  /** true = vue pilotage (CTO & assimilés) : exceptions plutôt que listes exhaustives. */
  pilotView: boolean;
};

export const EMPTY_WORKSPACE: MyWorkspace = {
  todo: [],
  upcoming: [],
  blocked: [],
  perimeter: [],
  pilotView: false,
};
