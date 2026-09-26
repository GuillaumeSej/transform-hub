import type { ApprovalStep, ChainLevel } from "@/lib/strategicHierarchy";
import type {
  AxeUpdateApprovalPayload,
  ChantierUpdateApprovalPayload,
  IndicatorUpdateApprovalPayload,
  ProjetUpdateApprovalPayload,
  StaffingUpdateApprovalPayload,
  StrategicApproval,
  StrategicApprovalKind,
} from "@/lib/strategicApprovals";

/**
 * Présentation (PURE, sans React) des demandes de validation stratégique à chaîne : stepper
 * « Étape 1 : Sponsor d'axe (Marie) ✓ — Étape 2 : Pilote (Paul) en attente », diff avant → après
 * des `projet_update`/`chantier_update`, aperçu « sera validée par X puis Y ». Les libellés sont
 * renvoyés sous forme `{ key, fallback }` (français) : l'UI les passe à `t(key, fallback)`.
 */

type UserLite = { username: string; name?: string };

/** Libellé français d'un niveau de la hiérarchie (clé `validation.sa.level.<level>`) ; `admin` =
 *  palier de repli (ni hiérarchie ni pilote pour valider). */
export const LEVEL_FALLBACK: Record<ChainLevel, string> = {
  admin: "Administrateur",
  pilot: "Pilote",
  axisSponsor: "Sponsor d'axe",
  chantierSponsor: "Sponsor de chantier",
  projectOwner: "Responsable projet",
  contributor: "Contributeur",
};

/** Clé i18n d'un niveau (`strategicApprovals.level.admin` pour le palier de repli). */
export function levelLabelKey(level: ChainLevel): string {
  if (level === "admin") return "strategicApprovals.level.admin";
  return `validation.sa.level.${level}`;
}

/** Nom affichable d'un username (repli : le username lui-même). */
export function displayUserName(username: string, users?: UserLite[]): string {
  return users?.find((u) => u.username === username)?.name || username;
}

export type ChainStepState = "approved" | "rejected" | "current" | "upcoming" | "skipped";

export type ChainStepView = {
  /** 1-based. */
  index: number;
  level: ChainLevel;
  approverNames: string[];
  state: ChainStepState;
  decidedByName?: string;
  decidedAt?: string;
  comment?: string;
};

/**
 * Paliers d'une demande à chaîne, avec leur état : validé/refusé (qui/quand/commentaire),
 * `current` (palier en attente), `upcoming` (pas encore atteint), `skipped` (jamais atteint car la
 * demande a été refusée plus tôt). Vide pour une demande LEGACY (sans `chain`).
 */
export function chainStepsView(approval: StrategicApproval, users?: UserLite[]): ChainStepView[] {
  const chain = approval.chain ?? [];
  if (!chain.length) return [];
  const current = Math.min(approval.stepIndex ?? 0, chain.length - 1);
  return chain.map((step, i) => {
    let state: ChainStepState;
    if (step.decision === "approved") state = "approved";
    else if (step.decision === "rejected") state = "rejected";
    else if (approval.status === "pending") state = i === current ? "current" : "upcoming";
    else if (approval.status === "approved") state = "approved";
    else state = "skipped";
    return {
      index: i + 1,
      level: step.level,
      approverNames: step.usernames.map((u) => displayUserName(u, users)),
      state,
      decidedByName: step.decidedBy
        ? (step.decidedByName ?? displayUserName(step.decidedBy, users))
        : undefined,
      decidedAt: step.decidedAt,
      comment: step.decisionComment,
    };
  });
}

/**
 * Aperçu « Sponsor d'axe (Marie) puis Pilote (Paul) » d'une chaîne calculée (`previewChain`).
 * `levelLabel` : libellé traduit d'un niveau ; `then` : conjonction traduite (« puis »).
 * Chaîne vide → "" (application directe).
 */
export function chainPreviewText(
  steps: ApprovalStep[],
  users: UserLite[] | undefined,
  levelLabel: (level: ChainLevel) => string,
  then: string
): string {
  return steps
    .map((s) => {
      const names = s.usernames.map((u) => displayUserName(u, users)).join(", ");
      return names ? `${levelLabel(s.level)} (${names})` : levelLabel(s.level);
    })
    .join(` ${then} `);
}

// ─── Diff avant → après (projet_update / chantier_update) ──────────────────────────────────

/** Libellés français des champs (clé `validation.sa.field.<field>`). Champ absent → nom brut. */
export const FIELD_FALLBACK: Record<string, string> = {
  name: "Nom",
  description: "Description",
  start: "Date de début",
  end: "Date de fin",
  status: "Statut",
  owner: "Responsable projet",
  contributors: "Contributeurs",
  deliverables: "Livrables",
  prerequisites: "Prérequis",
  milestones: "Jalons / check-lists",
  customMilestoneActions: "Actions de jalon personnalisées",
  excludedMilestoneItems: "Actions de jalon retirées",
  budget: "Budget",
  consumedBudget: "Budget consommé",
  consumedFte: "ETP consommés",
  chantierWeightPct: "Poids dans le chantier (%)",
  chantierId: "Chantier de rattachement",
  indicatorId: "Indicateur",
  allocatedBudget: "Enveloppe budgétaire",
  successKpis: "KPI de succès",
  successCriteria: "Critères de succès",
  effort: "Grille d'effort",
  axisIds: "Axes de rattachement",
  stage: "Étape",
  dependencies: "Dépendances",
  pilote: "Sponsor de chantier",
  color: "Couleur",
  objective: "Objectif",
  objectiveValue: "Valeur cible",
  direction: "Sens",
  targetSchedule: "Cibles intermédiaires",
  function: "Fonction",
  fte: "ETP",
  note: "Précision",
  startDate: "Début",
  endDate: "Fin",
  actionId: "Projet",
  responsibleRoles: "Rôles responsables",
  confidentialityLevel: "Confidentialité",
};

/** Champs dont la valeur est un (ou des) username(s) → noms affichés. */
const USER_FIELDS = new Set(["owner", "contributors", "pilote"]);

export type FieldDiffRow = {
  field: string;
  labelKey: string;
  labelFallback: string;
  before: string;
  after: string;
};

/** Valeur lisible d'un champ. `names` : ids → libellés (utilisateurs, chantiers, axes…). */
export function formatDiffValue(
  field: string,
  value: unknown,
  users?: UserLite[],
  names?: Record<string, string>
): string {
  if (value === undefined || value === null || value === "") return "—";
  const label = (v: string) =>
    USER_FIELDS.has(field) ? displayUserName(v, users) : (names?.[v] ?? v);
  if (typeof value === "string") return label(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "✓" : "✗";
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    if (value.every((x) => typeof x === "string")) return (value as string[]).map(label).join(", ");
    if (value.every((x) => typeof x === "number")) return value.join(", ");
    const labels = value
      .map((x) =>
        x && typeof x === "object"
          ? ((x as Record<string, unknown>).label ?? (x as Record<string, unknown>).name)
          : undefined
      )
      .filter((x): x is string => typeof x === "string" && !!x);
    return labels.length === value.length ? labels.join(", ") : `${value.length} élément(s)`;
  }
  return "(modifié)";
}

const STAFFING_DIFF_FIELDS = ["function", "fte", "note", "startDate", "endDate", "actionId"];

/** Lignes « champ : avant → après » d'une demande de modification (projet, chantier, axe, objectif
 *  KPI, ligne de staffing — création : avant « — », suppression : après « — ») ; vide pour les
 *  autres kinds. */
export function patchDiffRows(
  approval: StrategicApproval,
  users?: UserLite[],
  names?: Record<string, string>
): FieldDiffRow[] {
  let patch: Record<string, unknown>;
  let before: Record<string, unknown>;
  let fields: string[];
  if (approval.kind === "staffing_update") {
    const p = approval.payload as StaffingUpdateApprovalPayload;
    const line = p.line as unknown as Record<string, unknown>;
    const prev = (p.before ?? (p.op === "create" ? {} : p.line)) as unknown as Record<
      string,
      unknown
    >;
    before = p.op === "create" ? {} : prev;
    patch = p.op === "delete" ? {} : line;
    fields = STAFFING_DIFF_FIELDS.filter(
      (f) =>
        (before[f] !== undefined || patch[f] !== undefined) &&
        (p.op !== "update" || JSON.stringify(before[f]) !== JSON.stringify(patch[f]))
    );
  } else if (
    approval.kind === "projet_update" ||
    approval.kind === "chantier_update" ||
    approval.kind === "axe_update" ||
    approval.kind === "indicator_update"
  ) {
    const p = approval.payload as
      | ProjetUpdateApprovalPayload
      | ChantierUpdateApprovalPayload
      | AxeUpdateApprovalPayload
      | IndicatorUpdateApprovalPayload;
    patch = (p.patch ?? {}) as Record<string, unknown>;
    before = (p.before ?? {}) as Record<string, unknown>;
    fields = Object.keys(patch);
  } else return [];
  return fields.map((field) => ({
    field,
    labelKey: `validation.sa.field.${field}`,
    labelFallback: FIELD_FALLBACK[field] ?? field,
    before: formatDiffValue(field, before[field], users, names),
    after: formatDiffValue(field, patch[field], users, names),
  }));
}

/** Libellés français des kinds (clé `validation.sa.kind.<kind>`). */
export const KIND_FALLBACK: Record<StrategicApprovalKind, string> = {
  milestone: "Passage de jalon",
  kpi_value: "Valeur KPI",
  projet_create: "Ajout de projet",
  projet_update: "Modification de projet",
  projet_delete: "Suppression de projet",
  chantier_create: "Création de chantier",
  chantier_update: "Modification de chantier",
  chantier_delete: "Suppression de chantier",
  axe_create: "Création d'axe",
  axe_update: "Modification d'axe",
  indicator_update: "Objectif KPI",
  staffing_update: "Staffing",
};

const NEW_KINDS: StrategicApprovalKind[] = [
  "axe_create",
  "axe_update",
  "indicator_update",
  "staffing_update",
];

/** Clé i18n d'un kind (`strategicApprovals.kind.<kind>` pour les kinds axes/objectif/staffing). */
export function kindLabelKey(kind: StrategicApprovalKind): string {
  if (NEW_KINDS.includes(kind)) return `strategicApprovals.kind.${kind}`;
  return `validation.sa.kind.${kind}`;
}
