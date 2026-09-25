import {
  assertMilestoneStillPassable,
  axisDecisionMakers,
  computeIndicatorStatus,
  displayMilestoneId,
  isStrategicLeadOf,
  latestMeasurement,
} from "@/lib/axisLogic";
import { samePeriod } from "@/lib/indicatorPeriod";
import { kpiCorrectionApprover, kpiHierarchyContext } from "@/lib/kpiCorrectionRouting";
import { MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import { hasRole, isAnyAdmin } from "@/lib/roleProfiles";
import {
  approvalChain,
  type ApprovalStep,
  type HierarchyContext,
  type StrategicLevel,
} from "@/lib/strategicHierarchy";
import type {
  Alert,
  AuditEntry,
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierStaffing,
  Indicator,
  IndicatorMeasurement,
  MilestoneId,
  Role,
  StrategicAxis,
} from "@/types";

/**
 * Validation stratégique — modèle + logique PURE (aucun accès Firestore/React ici ; la persistance
 * est dans lib/firestore/strategicApprovals.ts, l'API React dans lib/hooks/useStrategicApprovals.ts).
 *
 * ═══ API POUR L'UI (modèle à CHAÎNE, règles PO « données de pilotage ») ═══════════════════════
 * Hiérarchie (lib/strategicHierarchy.ts) : pilote du plan > sponsor d'axe > sponsor de chantier
 *   > responsable projet > contributeurs. Une demande est validée par les niveaux AU-DESSUS de son
 *   auteur, dans l'ordre (N+1 puis N+2), niveaux vides sautés, jamais par l'auteur.
 *
 *   Nombre de validations (`requiredValidations`, `KIND_VALIDATIONS`, `fieldCategory`) :
 *    - 2 (pilotage) : kpi_value (auteur traité au moins comme sponsor de chantier → sponsor d'axe
 *      puis pilote), milestone, projet_create / projet_delete (auteur au moins responsable projet →
 *      sponsor de chantier puis sponsor d'axe), chantier_create / chantier_delete (auteur au moins
 *      sponsor de chantier → sponsor d'axe puis pilote), projet_update / chantier_update de
 *      catégorie "pilotage" (avancement déclaré = check-lists de jalon, budget, consommé, poids du
 *      projet dans le chantier, grille d'effort, enveloppe…) ;
 *    - 1 (N+1) : projet_update / chantier_update de catégorie "planning" (dates, livrables :
 *      échéance/statut/ajout/retrait, dépendances…) ou "designation" (responsable, contributeurs,
 *      sponsor, pilote) ;
 *    - 0 (libre) : libellés, descriptions, commentaires (dont commentaires de livrables).
 *
 *   Chaîne SNAPSHOTÉE à la création (`StrategicApproval.chain` + `stepIndex`) : elle ne bouge plus
 *   si les responsables changent ensuite. Décideurs d'un palier : l'un de `chain[stepIndex]
 *   .usernames`, ou un ADMIN (contournement, comme le Plan Transfo — y compris quand tous les
 *   usernames du palier ont disparu/été désactivés : un admin débloque toujours). Le pilote ne
 *   décide QUE son propre palier (plus d'escalade strategic_lead sur les demandes à chaîne).
 *   Personne — admin compris — ne décide sa propre demande ; une personne ayant déjà validé un
 *   palier ne valide pas le suivant (hors admin). Un refus à n'importe quel palier CLÔT la demande.
 *   Chaîne vide (auteur pilote, personne au-dessus) ou auteur ADMIN → application directe.
 *
 *   Côté UI :
 *    - avant d'agir : `sa.needsApproval(kind, target, undefined, payload)` (hook) — false ⇒
 *      appliquer directement ; true ⇒ `sa.request(kind, target, payload, reason?)`. Les flux
 *      prêts à l'emploi de lib/strategicApprovalFlows.ts font ce choix eux-mêmes (préférés) ;
 *    - « sera validé par X puis Y » : `previewApprovalChain(kind, actor, target, payload, data)` ;
 *    - édition de champs : `splitPatchByCategory(entity, before, patch)` / `fieldCategory(...)`
 *      / `requiredValidations(category)` ;
 *    - badges « en attente » : `pendingOn(approvals, target, field?)` / `isPendingOn(...)` ;
 *      « étape x/2 » : `approvalStepInfo(approval)` / `stepLabel(approval)` ; qui doit agir :
 *      `pendingApproversOf(approval)` ; droit de décider : `canDecide` / `canDecideStep` ;
 *    - décision : `sa.approve(id, comment?)` / `sa.reject(id, comment)` — le hook fait avancer le
 *      palier (`decideApproval`) et n'applique l'effet qu'à la DERNIÈRE validation.
 *   Demandes d'AVANT ce modèle (sans `chain`) : relues et décidées avec l'ancien comportement
 *   (approbateur unique `approverUsernames`, escalade strategic_lead, admin), voir ci-dessous.
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Ancien modèle (demandes SANS `chain`, conservé pour relecture) — qui valide quoi :
 *  - "milestone"       passage de jalon d'un projet      → responsable (pilote) du CHANTIER
 *  - "kpi_value"       valeur KPI renseignée             → responsable du plan (strategic_lead)
 *                      CORRECTION/SUPPRESSION d'une mesure (`payload.measurementId`) → responsable
 *                      du CHANTIER du KPI (repli axe → plan), voir lib/kpiCorrectionRouting.ts ;
 *                      les responsables supérieurs sont INFORMÉS (`informUsernames`)
 *  - "projet_create"   projet ajouté à un chantier       → DOUBLE validation séquentielle : pilote
 *                                                          du CHANTIER PUIS responsable de l'AXE
 *                                                          (voir "Double validation" ci-dessous)
 *  - "projet_delete"   suppression d'un projet           → responsable du CHANTIER
 *  - "chantier_delete" suppression d'un chantier         → responsable de l'AXE
 * Repli en cascade quand le responsable nominal n'est pas renseigné : pilote de chantier → owner
 * d'axe → strategic_lead. Un admin peut toujours décider ; le strategic_lead du programme aussi
 * (escalade). Personne (hors admin) ne décide sa propre demande.
 *
 * Double validation de "projet_create" (round <n>, retour PO : « il faut un double go-ahead ») :
 * le modèle `StrategicApproval` ne porte qu'UNE décision (`approverRole`/`status`) — pas de chaîne
 * multi-signatures. Plutôt que de redessiner le moteur (partagé, testé), on ENCHAÎNE deux demandes
 * du MÊME kind "projet_create", distinguées par `payload.stage` :
 *   1. `stage: "chantier"` → approbateur = pilote du chantier (repli cascade `chantierLevel()` :
 *      axe puis strategic_lead si pas de pilote). Son approbation NE crée PAS le projet : voir
 *      `applyApprovedPayload` (effets vides pour ce stage) et `nextProjetCreateApproval`, appelée
 *      par `useStrategicApprovals.decide()` juste après, qui enchaîne la 2e demande.
 *   2. `stage: "axis"` (ou ABSENT — c'est le format d'avant cette fonctionnalité, relu tel quel :
 *      compatible par construction) → approbateur = responsable de l'axe (`axisLevel()`, même
 *      repli que l'ancien schéma à un seul palier). Son approbation crée réellement le projet.
 * Cas particuliers gérés (voir `createProjetFlow` et `nextProjetCreateApproval`) :
 *   - Si le CRÉATEUR est déjà l'un des deux paliers (ex. il EST le pilote), ce palier n'est jamais
 *     formellement demandé (il agit directement) ; s'il est admin/strategic_lead ou les DEUX
 *     paliers à la fois, la création est immédiate, sans aucune demande (comme avant).
 *   - Si le créateur (déjà validé au palier chantier par quelqu'un d'autre) s'avère être LUI-MÊME
 *     le responsable d'axe résolu pour le palier 2, ce palier ne peut de toute façon pas être
 *     décidé par lui (`canDecide` interdit de décider sa propre demande) : on ne le crée pas, le
 *     projet est créé directement à la place.
 *   - Si aucun palier axe n'est résolvable (aucun owner d'axe, aucun strategic_lead), idem : pas de
 *     2e demande, création directe (repli documenté ci-dessus, jamais de blocage définitif).
 */

export type StrategicApprovalKind =
  | "milestone"
  | "kpi_value"
  | "projet_create"
  | "projet_update"
  | "projet_delete"
  | "chantier_create"
  | "chantier_update"
  | "chantier_delete";

export const STRATEGIC_APPROVAL_KINDS: StrategicApprovalKind[] = [
  "milestone",
  "kpi_value",
  "projet_create",
  "projet_update",
  "projet_delete",
  "chantier_create",
  "chantier_update",
  "chantier_delete",
];

/** Catégorie d'une modification (règles PO) : "pilotage" = 2 validations, "planning" et
 *  "designation" = 1 validation (N+1), "free" = aucune. */
export type ValidationCategory = "pilotage" | "planning" | "designation" | "free";
export type GatedCategory = Exclude<ValidationCategory, "free">;

export type StrategicApprovalTargetType = "axe" | "chantier" | "projet" | "indicateur";
export type StrategicApprovalStatus = "pending" | "approved" | "rejected";

export type StrategicApprovalTarget = {
  type: StrategicApprovalTargetType;
  id: string;
  /** Libellé lisible au moment de la demande (survit à la suppression de la cible). */
  name?: string;
};

export type MilestoneApprovalPayload = {
  targetMilestone: MilestoneId;
  fromMilestone?: MilestoneId;
};
/** `measurementId` (optionnel) : la demande CORRIGE une mesure déjà publiée (même doc réécrit,
 *  saisie d'origine conservée) ; avec `remove: true` elle la SUPPRIME. Absent = nouvelle valeur
 *  (format historique, relu tel quel). */
export type KpiValueApprovalPayload = {
  period: string;
  value?: number;
  note?: string;
  measurementId?: string;
  remove?: boolean;
  /** Correction/suppression : valeur, période et commentaire AVANT (texte des notifications). */
  previousValue?: number;
  previousPeriod?: string;
  previousNote?: string;
  /** Valeur initialement demandée quand l'approbateur l'a AJUSTÉE avant d'accepter. */
  requestedValue?: number;
};
/** Palier de la double validation d'un `"projet_create"` (voir l'en-tête du fichier) :
 *  `"chantier"` = 1er palier (pilote du chantier), `"axis"` = palier terminal (responsable de
 *  l'axe) — celui qui crée réellement le projet. */
export type ProjetCreateStage = "chantier" | "axis";
/** `action` complet (avec son `id` déjà généré : l'application est idempotente). `staffing`
 *  (round 29, optionnel) : lignes ETP bufferisées dans le formulaire de création
 *  (`StaffingDraftTable.tsx`) — déjà des `ChantierStaffing` complètes, `actionId` = `action.id`
 *  ci-dessus. Absent/vide pour toute demande d'avant round 29 (relecture d'anciennes demandes en
 *  base) — traité comme une liste vide partout où lu. `stage` (round <n>, double validation,
 *  optionnel) : ABSENT = format d'avant cette fonctionnalité, traité comme `"axis"` (palier
 *  terminal, comportement historique inchangé pour toute demande déjà en base). */
export type ProjetCreateApprovalPayload = {
  action: ChantierAction;
  staffing?: ChantierStaffing[];
  stage?: ProjetCreateStage;
};
export type DeleteApprovalPayload = { name?: string };
/** Modification de champs d'un projet (target = projet). `patch` ne contient que des champs d'UNE
 *  même `category` (voir `splitPatchByCategory`) ; `before` = valeurs de ces champs au moment de la
 *  demande — à l'approbation finale, un champ modifié entre-temps rend la demande PÉRIMÉE. */
export type ProjetUpdateApprovalPayload = {
  patch: Partial<ChantierAction>;
  before: Partial<ChantierAction>;
  category: GatedCategory;
};
/** Idem pour un chantier (target = chantier). */
export type ChantierUpdateApprovalPayload = {
  patch: Partial<Chantier>;
  before: Partial<Chantier>;
  category: GatedCategory;
};
/** Création de chantier (target = axe de rattachement principal, `chantier.axisIds[0]`) :
 *  `chantier` complet, id déjà généré (application idempotente). */
export type ChantierCreateApprovalPayload = { chantier: Chantier };
export type StrategicApprovalPayload =
  | MilestoneApprovalPayload
  | KpiValueApprovalPayload
  | ProjetCreateApprovalPayload
  | ProjetUpdateApprovalPayload
  | ChantierUpdateApprovalPayload
  | ChantierCreateApprovalPayload
  | DeleteApprovalPayload;

/** Un palier de la chaîne de validation, snapshoté à la demande. `decided*` renseignés quand le
 *  palier a été validé (ou refusé : le refus clôt la demande). */
export type ApprovalChainStep = {
  level: StrategicLevel;
  usernames: string[];
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: string;
  decision?: "approved" | "rejected";
  decisionComment?: string;
};

export type StrategicApproval = {
  id: string;
  companyId: string;
  programId: string;
  kind: StrategicApprovalKind;
  targetType: StrategicApprovalTargetType;
  targetId: string;
  targetName?: string;
  payload: StrategicApprovalPayload;
  requestedBy: string; // username
  requestedByName?: string;
  requestedAt: string; // ISO
  approverRole: Role;
  /** Approbateur nominal résolu à la demande (premier de `approverUsernames`), peut être absent. */
  approverUsername?: string;
  approverUsernames: string[];
  status: StrategicApprovalStatus;
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: string;
  decisionComment?: string;
  /** Motif saisi par le demandeur. */
  reason?: string;
  /** Enregistrement d'INFORMATION (pas une demande) : action appliquée directement par un
   *  responsable habilité (ex. correction KPI par le pilote du chantier), créé déjà `"approved"`
   *  (`decidedBy` = acteur) pour notifier `informUsernames`. Exclu de « Mes demandes ». */
  direct?: boolean;
  /** Responsables à INFORMER de l'action appliquée (alerte « Valeur KPI corrigée … »). */
  informUsernames?: string[];
  /** Chaîne de validation (modèle à paliers, voir l'en-tête). ABSENTE = demande d'avant ce modèle
   *  (approbateur unique, comportement historique). `approverRole`/`approverUsername`/
   *  `approverUsernames` reflètent toujours le palier COURANT (compat des lecteurs existants). */
  chain?: ApprovalChainStep[];
  /** Index du palier courant dans `chain` (0 par défaut). */
  stepIndex?: number;
};

/** Ce que la résolution d'approbateur a besoin de connaître du plan (déjà scopé programme). */
export type StrategicApprovalData = {
  programId?: string | null;
  axes: StrategicAxis[];
  chantiers: Chantier[];
  chantierActions: ChantierAction[];
  indicators: Indicator[];
  measurements?: IndicatorMeasurement[];
  users?: Pick<AuthUser, "username" | "name" | "profiles">[];
};

export type ResolvedApprover = {
  role: Role;
  usernames: string[];
  username?: string;
};

type Actor = Pick<AuthUser, "username" | "profiles" | "isGlobalAdmin" | "isCompanyAdmin">;

// ─── Résolution ─────────────────────────────────────────────────────────────────────────────

/** Programme d'une cible (via son chantier/axe/indicateur), sinon `data.programId`. */
export function resolveTargetProgramId(
  target: StrategicApprovalTarget,
  data: StrategicApprovalData
): string | undefined {
  let programId: string | undefined;
  if (target.type === "chantier") {
    programId = data.chantiers.find((c) => c.id === target.id)?.programId;
  } else if (target.type === "projet") {
    const action = data.chantierActions.find((a) => a.id === target.id);
    programId = data.chantiers.find((c) => c.id === action?.chantierId)?.programId;
  } else if (target.type === "axe") {
    programId = data.axes.find((a) => a.id === target.id)?.programId;
  } else {
    programId = data.indicators.find((i) => i.id === target.id)?.programId;
  }
  return programId ?? data.programId ?? undefined;
}

function chantierOfTarget(
  target: StrategicApprovalTarget,
  data: StrategicApprovalData
): Chantier | undefined {
  if (target.type === "chantier") return data.chantiers.find((c) => c.id === target.id);
  if (target.type === "projet") {
    const action = data.chantierActions.find((a) => a.id === target.id);
    return data.chantiers.find((c) => c.id === action?.chantierId);
  }
  if (target.type === "indicateur") {
    const indicator = data.indicators.find((i) => i.id === target.id);
    return data.chantiers.find((c) => c.id === indicator?.chantierId);
  }
  return undefined;
}

function axisOwners(axisIds: string[], axes: StrategicAxis[]): string[] {
  const out: string[] = [];
  for (const id of axisIds) {
    const axis = axes.find((a) => a.id === id);
    if (!axis) continue;
    // Le sponsor de l'axe (rôle unique) décide.
    for (const u of axisDecisionMakers(axis)) if (!out.includes(u)) out.push(u);
  }
  return out;
}

function strategicLeadUsernames(programId: string | undefined, data: StrategicApprovalData) {
  return (data.users ?? [])
    .filter((u) => isStrategicLeadOf({ programId: programId ?? "" }, u))
    .map((u) => u.username);
}

/** LEGACY (demandes sans `chain`, et repli défensif de `buildApproval` quand la chaîne calculée
 *  est vide) — approbateur UNIQUE attendu pour une demande de ce `kind` sur cette cible.
 *  `stage` : UNIQUEMENT significatif pour `"projet_create"` (double validation, voir l'en-tête) —
 *  `"chantier"` résout le pilote du chantier (repli cascade vers l'axe), `"axis"` (ou absent, pour
 *  rester identique au comportement d'avant cette fonctionnalité) résout le responsable de l'axe.
 *  Ignoré pour tous les autres kinds. */
export function resolveApprover(
  kind: StrategicApprovalKind,
  target: StrategicApprovalTarget,
  data: StrategicApprovalData,
  stage?: ProjetCreateStage,
  ctx?: { payload?: StrategicApprovalPayload; requestedBy?: string }
): ResolvedApprover {
  const programId = resolveTargetProgramId(target, data);
  const lead = (): ResolvedApprover => {
    const usernames = strategicLeadUsernames(programId, data);
    return { role: "strategic_lead", usernames, username: usernames[0] };
  };
  const chantier = chantierOfTarget(target, data);

  const axisLevel = (): ResolvedApprover => {
    const axisIds = target.type === "axe" ? [target.id] : (chantier?.axisIds ?? []);
    const owners = axisOwners(axisIds, data.axes);
    return owners.length
      ? { role: "axis_sponsor", usernames: owners, username: owners[0] }
      : lead();
  };
  const chantierLevel = (): ResolvedApprover =>
    chantier?.pilote
      ? { role: "chantier_owner", usernames: [chantier.pilote], username: chantier.pilote }
      : axisLevel();

  switch (kind) {
    case "kpi_value": {
      // Correction/suppression d'une mesure publiée : responsable du chantier du KPI (repli axe →
      // plan), voir lib/kpiCorrectionRouting.ts. Saisie d'une nouvelle valeur : plan (inchangé).
      const p = ctx?.payload as KpiValueApprovalPayload | undefined;
      const indicator = data.indicators.find((i) => i.id === target.id);
      if (p?.measurementId && indicator) {
        const a = kpiCorrectionApprover(indicator, data, ctx?.requestedBy);
        if (!a.usernames.length) return lead();
        const role: Role =
          a.level === "chantier"
            ? "chantier_owner"
            : a.level === "axis"
              ? "axis_sponsor"
              : "strategic_lead";
        return { role, usernames: a.usernames, username: a.usernames[0] };
      }
      return lead();
    }
    case "milestone":
    case "projet_delete":
    case "projet_update":
      return chantierLevel();
    case "chantier_delete":
    case "chantier_update":
    case "chantier_create":
      return axisLevel();
    case "projet_create":
      // Double validation (voir l'en-tête) : palier "chantier" = pilote (repli axe/lead) ; palier
      // "axis" ou absent = responsable de l'axe (repli lead), IDENTIQUE à l'ancien schéma à un seul
      // palier — une demande relue depuis avant cette fonctionnalité (sans `payload.stage`) résout
      // donc exactement comme avant.
      return stage === "chantier" ? chantierLevel() : axisLevel();
  }
}

// ─── Classification des modifications (règles PO) ──────────────────────────────────────────

/** Nombre de validations requis par catégorie. */
export function requiredValidations(category: ValidationCategory): 0 | 1 | 2 {
  return category === "pilotage" ? 2 : category === "free" ? 0 : 1;
}

/** Catégorie de chaque champ d'un PROJET. Champs techniques (`id`, `companyId`,
 *  `milestoneApproval` — posé par le flux de jalon) : jamais modifiables par une demande, retirés
 *  des patchs. Champ inconnu (ajouté plus tard au modèle) : "planning" par défaut (1 validation —
 *  ni libre par accident, ni bloqué à 2). */
const PROJET_FIELD_CATEGORY: Record<string, ValidationCategory> = {
  name: "free",
  description: "free",
  // Pilotage : avancement déclaré (check-lists de jalon, actions ajoutées/retirées qui changent
  // l'avancement et la porte de passage), budgets, consommés, poids dans l'avancement du chantier,
  // rattachement (déplacer un projet change la hiérarchie qui le valide).
  milestones: "pilotage",
  customMilestoneActions: "pilotage",
  excludedMilestoneItems: "pilotage",
  budget: "pilotage",
  consumedBudget: "pilotage",
  consumedFte: "pilotage",
  chantierWeightPct: "pilotage",
  chantierId: "pilotage",
  // Planning : dates, livrables (échéance/statut — voir `deliverablesCategory`), prérequis…
  start: "planning",
  end: "planning",
  deliverables: "planning",
  prerequisites: "planning",
  status: "planning",
  indicatorId: "planning",
  // Désignations.
  owner: "designation",
  contributors: "designation",
  sponsor: "designation",
};
const PROJET_INTERNAL_FIELDS = new Set(["id", "companyId", "milestoneApproval"]);

/** Catégorie de chaque champ d'un CHANTIER (même règle par défaut). Le chantier n'a pas de stade
 *  propre (avancement dérivé de ses projets) : ce qui le « fait bouger » — enveloppe, consommés,
 *  critères de succès atteints, grille d'effort, axes — est du pilotage, jamais modifiable seul par
 *  le sponsor de chantier. */
const CHANTIER_FIELD_CATEGORY: Record<string, ValidationCategory> = {
  name: "free",
  description: "free",
  successCriteria: "free",
  allocatedBudget: "pilotage",
  consumedBudget: "pilotage",
  consumedFte: "pilotage",
  successKpis: "pilotage",
  effort: "pilotage",
  axisIds: "pilotage",
  stage: "pilotage",
  milestones: "pilotage",
  dependencies: "planning",
  pilote: "designation",
  sponsorName: "designation",
  responsibleRoles: "designation",
  confidentialityLevel: "designation",
};
const CHANTIER_INTERNAL_FIELDS = new Set([
  "id",
  "companyId",
  "programId",
  "createdAt",
  "lastUpdate",
]);

export type PatchEntity = "projet" | "chantier";

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(stripUndefined(a) ?? null) === JSON.stringify(stripUndefined(b) ?? null);
}

/** Livrables : seuls les commentaires/libellés ont changé → libre ; sinon (échéance, statut,
 *  ajout, retrait) → planning. */
function deliverablesCategory(before: unknown, after: unknown): ValidationCategory {
  const strip = (list: unknown) =>
    (Array.isArray(list) ? list : []).map((d: Record<string, unknown>) => {
      const { comments: _c, label: _l, ...rest } = d ?? {};
      void _c;
      void _l;
      return rest;
    });
  return sameValue(strip(before), strip(after)) ? "free" : "planning";
}

/** Catégorie d'UN champ modifié (`before`/`after` : valeurs du champ, pour les livrables). */
export function fieldCategory(
  entity: PatchEntity,
  field: string,
  before?: unknown,
  after?: unknown
): ValidationCategory {
  if (entity === "projet" && field === "deliverables") return deliverablesCategory(before, after);
  const table = entity === "projet" ? PROJET_FIELD_CATEGORY : CHANTIER_FIELD_CATEGORY;
  return table[field] ?? "planning";
}

/** Nombre de validations pour un changement de champ (raccourci UI). */
export function requiredValidationsForField(
  entity: PatchEntity,
  field: string,
  before?: unknown,
  after?: unknown
): 0 | 1 | 2 {
  return requiredValidations(fieldCategory(entity, field, before, after));
}

export type SplitPatch<T> = Record<ValidationCategory, Partial<T>>;

/**
 * Répartit un patch par catégorie, en ne gardant que les champs RÉELLEMENT modifiés par rapport à
 * `before` (et jamais les champs techniques). L'UI applique `free` directement et soumet chaque
 * autre partie non vide (voir `updateProjetFlow` / `updateChantierFlow`).
 */
export function splitPatchByCategory<T extends object>(
  entity: PatchEntity,
  before: T,
  patch: Partial<T>
): SplitPatch<T> {
  const out: SplitPatch<T> = { pilotage: {}, planning: {}, designation: {}, free: {} };
  const internal = entity === "projet" ? PROJET_INTERNAL_FIELDS : CHANTIER_INTERNAL_FIELDS;
  for (const [key, value] of Object.entries(patch)) {
    if (internal.has(key)) continue;
    const prev = (before as Record<string, unknown>)[key];
    if (sameValue(prev, value)) continue;
    const cat = fieldCategory(entity, key, prev, value);
    (out[cat] as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** Nombre de validations requis par kind (hors *_update, qui dépendent de la catégorie). */
export const KIND_VALIDATIONS: Record<StrategicApprovalKind, 1 | 2> = {
  milestone: 2,
  kpi_value: 2,
  projet_create: 2,
  projet_update: 2,
  projet_delete: 2,
  chantier_create: 2,
  chantier_update: 2,
  chantier_delete: 2,
};

/** Niveau plancher de l'auteur par kind (voir `approvalChain`) : un KPI est traité comme saisi au
 *  moins par un sponsor de chantier ; créer/supprimer un projet relève au moins du responsable
 *  projet ; créer/supprimer un chantier au moins du sponsor de chantier. */
const KIND_FLOOR: Partial<Record<StrategicApprovalKind, StrategicLevel>> = {
  kpi_value: "chantierSponsor",
  projet_create: "projectOwner",
  projet_delete: "projectOwner",
  chantier_create: "chantierSponsor",
  chantier_delete: "chantierSponsor",
};

function validationCount(
  kind: StrategicApprovalKind,
  payload: StrategicApprovalPayload | undefined
): 0 | 1 | 2 {
  if (kind === "projet_update" || kind === "chantier_update") {
    const category = (payload as ProjetUpdateApprovalPayload | undefined)?.category ?? "pilotage";
    return requiredValidations(category);
  }
  return KIND_VALIDATIONS[kind];
}

// ─── Chaîne de validation ───────────────────────────────────────────────────────────────────

function axesOf(axisIds: string[] | undefined, data: StrategicApprovalData): StrategicAxis[] {
  return (axisIds ?? [])
    .map((id) => data.axes.find((a) => a.id === id))
    .filter((a): a is StrategicAxis => !!a);
}

/**
 * Contexte hiérarchique (lib/strategicHierarchy.ts) d'une demande : axe(s), chantier, projet et
 * pilotes du programme de la cible. Projet création : `projet` absent (le futur responsable ne
 * valide pas la création de son propre projet). KPI : voir `kpiHierarchyContext`.
 */
export function hierarchyContextFor(
  kind: StrategicApprovalKind,
  target: StrategicApprovalTarget,
  data: StrategicApprovalData,
  payload?: StrategicApprovalPayload,
  requestedBy?: string
): HierarchyContext {
  const programId = resolveTargetProgramId(target, data);
  const pilots = strategicLeadUsernames(programId, data);
  if (kind === "kpi_value" || target.type === "indicateur") {
    const indicator = data.indicators.find((i) => i.id === target.id);
    if (!indicator) return { pilots };
    return kpiHierarchyContext(indicator, { ...data, programId }, requestedBy);
  }
  if (kind === "chantier_create") {
    const created = (payload as ChantierCreateApprovalPayload | undefined)?.chantier;
    const axisIds = created?.axisIds?.length ? created.axisIds : [target.id];
    const axes = axesOf(axisIds, data);
    return { axis: axes[0] ?? null, axes, pilots };
  }
  if (target.type === "axe") {
    const axes = axesOf([target.id], data);
    return { axis: axes[0] ?? null, axes, pilots };
  }
  const chantier = chantierOfTarget(target, data);
  const axes = axesOf(chantier?.axisIds, data);
  const projet =
    target.type === "projet" && kind !== "projet_create"
      ? (data.chantierActions.find((a) => a.id === target.id) ?? null)
      : null;
  return { axis: axes[0] ?? null, axes, chantier: chantier ?? null, projet, pilots };
}

/**
 * Chaîne de validation d'une demande de `author` (paliers N+1 puis N+2 selon le kind/la
 * catégorie). Vide ⇒ application directe : auteur ADMIN, catégorie libre, ou personne au-dessus
 * (le pilote du plan). Utiliser pour l'aperçu « sera validé par X puis Y » (`previewApprovalChain`).
 */
export function computeApprovalChain(
  kind: StrategicApprovalKind,
  author: Pick<Actor, "username"> & Partial<Actor>,
  target: StrategicApprovalTarget,
  data: StrategicApprovalData,
  payload?: StrategicApprovalPayload
): ApprovalStep[] {
  if (isAnyAdmin(author as Actor)) return [];
  const count = validationCount(kind, payload);
  if (count === 0) return [];
  const ctx = hierarchyContextFor(kind, target, data, payload, author.username);
  return approvalChain(author.username, ctx, count, KIND_FLOOR[kind]);
}

/** Alias UI : paliers qu'aurait une demande de `actor` (vide = application directe). */
export function previewApprovalChain(
  kind: StrategicApprovalKind,
  actor: Actor | null | undefined,
  target: StrategicApprovalTarget,
  payload: StrategicApprovalPayload | undefined,
  data: StrategicApprovalData
): ApprovalStep[] {
  if (!actor) return [];
  return computeApprovalChain(kind, actor, target, data, payload);
}

/** Rôle affiché d'un niveau (compat `approverRole`). */
const LEVEL_ROLE: Record<StrategicLevel, Role> = {
  pilot: "strategic_lead",
  axisSponsor: "axis_sponsor",
  chantierSponsor: "chantier_owner",
  projectOwner: "chantier_contributor",
  contributor: "chantier_contributor",
};

export function levelRole(level: StrategicLevel): Role {
  return LEVEL_ROLE[level];
}

function isLeadOfProgram(user: Actor | null | undefined, programId: string | undefined): boolean {
  return (
    !!user &&
    hasRole(user, "strategic_lead") &&
    isStrategicLeadOf({ programId: programId ?? "" }, user)
  );
}

/** LEGACY : l'utilisateur est-il un approbateur légitime (hors règle d'auto-décision) ? */
function isApproverFor(
  user: Actor | null | undefined,
  approver: ResolvedApprover,
  programId: string | undefined
): boolean {
  if (!user) return false;
  if (isAnyAdmin(user)) return true;
  if (approver.usernames.includes(user.username)) return true;
  return isLeadOfProgram(user, programId);
}

/**
 * L'acteur doit-il passer par une demande ? `false` ⇒ appliquer directement : acteur ADMIN, ou
 * chaîne vide (catégorie libre, ou personne au-dessus de lui — le pilote du plan). `payload` :
 * nécessaire pour `projet_update`/`chantier_update` (catégorie) et `chantier_create` (axes) ;
 * ignoré sinon. `stage` : LEGACY (ancienne double validation de `projet_create` par demandes
 * enchaînées), ignoré — le modèle à chaîne couvre les deux paliers dans UNE demande.
 */
export function needsApproval(
  kind: StrategicApprovalKind,
  actor: Actor | null | undefined,
  target: StrategicApprovalTarget,
  data: StrategicApprovalData,
  stage?: ProjetCreateStage,
  payload?: StrategicApprovalPayload
): boolean {
  void stage;
  if (!actor) return true;
  if (isAnyAdmin(actor)) return false;
  return computeApprovalChain(kind, actor, target, data, payload).length > 0;
}

/** Palier courant (demande à chaîne), sinon `undefined`. */
export function currentStep(approval: StrategicApproval): ApprovalChainStep | undefined {
  if (!approval.chain?.length) return undefined;
  return approval.chain[Math.min(approval.stepIndex ?? 0, approval.chain.length - 1)];
}

/** Usernames qui doivent agir MAINTENANT (palier courant ; legacy : `approverUsernames`). Vide
 *  pour une demande close. Sert à « bloqué chez … », « en attente de … ». */
export function pendingApproversOf(approval: StrategicApproval): string[] {
  if (approval.status !== "pending") return [];
  const step = currentStep(approval);
  if (step) return step.usernames;
  return approval.approverUsernames?.length
    ? approval.approverUsernames
    : approval.approverUsername
      ? [approval.approverUsername]
      : [];
}

/** Paliers déjà validés (demande à chaîne). */
function priorDeciders(approval: StrategicApproval): string[] {
  const idx = approval.stepIndex ?? 0;
  return (approval.chain ?? [])
    .slice(0, idx)
    .map((s) => s.decidedBy)
    .filter((u): u is string => !!u);
}

/**
 * Demande à chaîne : `user` peut-il décider le palier COURANT ? L'un des usernames du palier, ou un
 * admin ; jamais le demandeur (admin compris) ; jamais une personne ayant déjà validé un palier
 * précédent (sauf admin). Pas d'escalade strategic_lead : le pilote ne décide que SON palier.
 */
export function canDecideStep(
  user: Actor | null | undefined,
  approval: StrategicApproval
): boolean {
  if (!user || approval.status !== "pending" || !approval.chain?.length) return false;
  if (approval.requestedBy === user.username) return false;
  if (isAnyAdmin(user)) return true;
  if (priorDeciders(approval).includes(user.username)) return false;
  return currentStep(approval)?.usernames.includes(user.username) ?? false;
}

/** `user` peut-il approuver/refuser cette demande (encore en attente) — palier courant pour une
 *  demande à chaîne (`canDecideStep`), règle historique sinon (approbateur, strategic_lead du
 *  programme, admin — admin pouvant même décider sa propre demande legacy). */
export function canDecide(
  user: Actor | null | undefined,
  approval: StrategicApproval,
  data: StrategicApprovalData
): boolean {
  if (!user || approval.status !== "pending") return false;
  if (approval.chain?.length) return canDecideStep(user, approval);
  if (isAnyAdmin(user)) return true;
  if (approval.requestedBy === user.username) return false;
  const stage =
    approval.kind === "projet_create"
      ? (approval.payload as ProjetCreateApprovalPayload).stage
      : undefined;
  const resolved = resolveApprover(
    approval.kind,
    { type: approval.targetType, id: approval.targetId, name: approval.targetName },
    data,
    stage,
    { payload: approval.payload, requestedBy: approval.requestedBy }
  );
  const usernames = Array.from(new Set([...resolved.usernames, ...approval.approverUsernames]));
  return isApproverFor(user, { ...resolved, usernames }, approval.programId);
}

export type ApprovalStepInfo = {
  /** Palier courant, 1-based (= total quand la demande est close après validation complète). */
  current: number;
  total: number;
  level?: StrategicLevel;
  usernames: string[];
};

/** « Étape x/n » d'une demande à chaîne ; `undefined` pour une demande legacy (pas d'étapes). */
export function approvalStepInfo(approval: StrategicApproval): ApprovalStepInfo | undefined {
  if (!approval.chain?.length) return undefined;
  const total = approval.chain.length;
  const idx = Math.min(approval.stepIndex ?? 0, total - 1);
  return {
    current: idx + 1,
    total,
    level: approval.chain[idx].level,
    usernames: approval.status === "pending" ? approval.chain[idx].usernames : [],
  };
}

/** Libellé court « Étape 1/2 » (vide pour une demande legacy ou à un seul palier). */
export function stepLabel(approval: StrategicApproval): string {
  const info = approvalStepInfo(approval);
  if (!info || info.total < 2) return "";
  return `Étape ${info.current}/${info.total}`;
}

/** Champs concernés par une demande EN ATTENTE (pour les badges « en attente » par champ). */
function pendingFields(approval: StrategicApproval): string[] {
  switch (approval.kind) {
    case "projet_update":
    case "chantier_update":
      return Object.keys((approval.payload as ProjetUpdateApprovalPayload).patch ?? {});
    case "milestone":
      return ["milestones"];
    default:
      return [];
  }
}

/**
 * Demandes EN ATTENTE sur une cible (et, si `field` est donné, sur ce champ précis : les
 * `*_update` qui le modifient, `milestone` pour "milestones"). Les suppressions portent sur toute
 * la cible (renvoyées quel que soit `field`). Une création de projet cible son CHANTIER parent.
 */
export function pendingOn(
  approvals: StrategicApproval[] | undefined,
  target: Pick<StrategicApprovalTarget, "type" | "id">,
  field?: string
): StrategicApproval[] {
  return (approvals ?? []).filter((a) => {
    if (a.status !== "pending" || a.targetType !== target.type || a.targetId !== target.id) {
      return false;
    }
    if (field === undefined) return true;
    if (a.kind === "projet_delete" || a.kind === "chantier_delete") return true;
    return pendingFields(a).includes(field);
  });
}

export function isPendingOn(
  approvals: StrategicApproval[] | undefined,
  target: Pick<StrategicApprovalTarget, "type" | "id">,
  field?: string
): boolean {
  return pendingOn(approvals, target, field).length > 0;
}

// ─── Construction ───────────────────────────────────────────────────────────────────────────

export function newApprovalId(): string {
  return `SA-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Retire récursivement les `undefined` (Firestore les refuse dans `setDoc`). */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Construit une demande (non persistée). Modèle à CHAÎNE par défaut : la chaîne est calculée
 * depuis le demandeur (`computeApprovalChain`) et SNAPSHOTÉE (`chain`, `stepIndex: 0`), les champs
 * `approver*` reflétant le 1er palier. `chain` explicite : utilisé tel quel ; `chain: null` ⇒
 * demande LEGACY à approbateur unique (`resolveApprover`) — réservé aux demandes enchaînées de
 * l'ancien modèle (`nextProjetCreateApproval`) et aux enregistrements d'information.
 * Repli défensif : si la chaîne calculée est VIDE (l'appelant aurait dû appliquer directement,
 * voir `needsApproval`), la demande est construite en legacy plutôt que sans décideur.
 */
export function buildApproval(input: {
  kind: StrategicApprovalKind;
  target: StrategicApprovalTarget;
  payload: StrategicApprovalPayload;
  reason?: string;
  companyId: string;
  programId: string;
  /** Le demandeur ; ses drapeaux admin (s'ils sont fournis) comptent : admin ⇒ chaîne vide. */
  requester: Pick<AuthUser, "username" | "name"> &
    Partial<Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin">>;
  data: StrategicApprovalData;
  id?: string;
  now?: string;
  chain?: ApprovalStep[] | null;
}): StrategicApproval {
  const chain =
    input.chain === null
      ? []
      : (input.chain ??
        computeApprovalChain(input.kind, input.requester, input.target, input.data, input.payload));
  if (chain.length) {
    return stripUndefined({
      id: input.id ?? newApprovalId(),
      companyId: input.companyId,
      programId: input.programId,
      kind: input.kind,
      targetType: input.target.type,
      targetId: input.target.id,
      targetName: input.target.name,
      payload: input.payload,
      requestedBy: input.requester.username,
      requestedByName: input.requester.name,
      requestedAt: input.now ?? new Date().toISOString(),
      approverRole: levelRole(chain[0].level),
      approverUsername: chain[0].usernames[0],
      approverUsernames: chain[0].usernames,
      status: "pending" as const,
      reason: input.reason?.trim() || undefined,
      chain: chain.map((s) => ({ level: s.level, usernames: [...s.usernames] })),
      stepIndex: 0,
    });
  }
  const stage =
    input.kind === "projet_create"
      ? (input.payload as ProjetCreateApprovalPayload).stage
      : undefined;
  const approver = resolveApprover(input.kind, input.target, input.data, stage, {
    payload: input.payload,
    requestedBy: input.requester.username,
  });
  return stripUndefined({
    id: input.id ?? newApprovalId(),
    companyId: input.companyId,
    programId: input.programId,
    kind: input.kind,
    targetType: input.target.type,
    targetId: input.target.id,
    targetName: input.target.name,
    payload: input.payload,
    requestedBy: input.requester.username,
    requestedByName: input.requester.name,
    requestedAt: input.now ?? new Date().toISOString(),
    approverRole: approver.role,
    approverUsername: approver.username,
    approverUsernames: approver.usernames,
    status: "pending" as const,
    reason: input.reason?.trim() || undefined,
  });
}

/**
 * Enregistrement d'INFORMATION d'une correction/suppression KPI appliquée DIRECTEMENT par un
 * responsable habilité (voir lib/kpiCorrectionRouting.ts) : déjà `"approved"` par l'acteur,
 * `direct: true`, destinataires dans `informUsernames`. Aucun effet à appliquer (la mesure est déjà
 * écrite par l'appelant) — sert uniquement aux alertes et à l'historique.
 */
export function buildDirectKpiCorrectionRecord(input: {
  target: StrategicApprovalTarget;
  payload: KpiValueApprovalPayload;
  informUsernames: string[];
  companyId: string;
  programId: string;
  actor: Pick<AuthUser, "username" | "name">;
  data: StrategicApprovalData;
  id?: string;
  now?: string;
}): StrategicApproval {
  const now = input.now ?? new Date().toISOString();
  const base = buildApproval({
    kind: "kpi_value",
    target: input.target,
    payload: input.payload,
    companyId: input.companyId,
    programId: input.programId,
    requester: input.actor,
    data: input.data,
    id: input.id,
    now,
    chain: null,
  });
  return stripUndefined({
    ...base,
    status: "approved" as const,
    decidedBy: input.actor.username,
    decidedByName: input.actor.name,
    decidedAt: now,
    direct: true,
    informUsernames: input.informUsernames.filter((u) => u !== input.actor.username),
  });
}

/** Texte de notification d'une correction/suppression KPI appliquée :
 *  « Valeur KPI corrigée : <KPI> <période> <ancienne> → <nouvelle> par <nom> ». */
export function kpiCorrectionNoticeText(
  approval: StrategicApproval,
  data: StrategicApprovalData
): { title: string; desc: string; i18n: NonNullable<Alert["i18n"]> } {
  const p = approval.payload as KpiValueApprovalPayload;
  const indicator = data.indicators.find((i) => i.id === approval.targetId);
  const kpi = indicator?.name ?? approval.targetName ?? approval.targetId;
  const unit = indicator?.unit ? ` ${indicator.unit}` : "";
  const fmt = (v: number | undefined, note?: string) =>
    v !== undefined ? `${v}${unit}` : (note ?? "—");
  const actorName = approval.direct
    ? displayName(approval.requestedBy, data.users, approval.requestedByName)
    : displayName(approval.decidedBy, data.users, approval.decidedByName);
  const period = p.previousPeriod ?? p.period;
  const old = fmt(p.previousValue, p.previousNote);
  if (p.remove) {
    return {
      title: `Mesure KPI supprimée · ${kpi}`,
      desc: `Mesure KPI supprimée : ${kpi} ${period} ${old} par ${actorName}.`,
      i18n: {
        titleKey: "strategicApprovals.alert.kpiRemovedTitle",
        descKey: "strategicApprovals.alert.kpiRemovedDesc",
        vars: { kpi, period, old, actor: actorName },
      },
    };
  }
  const periodText =
    p.previousPeriod && p.previousPeriod !== p.period
      ? `${p.previousPeriod} → ${p.period}`
      : p.period;
  const requesterName = !approval.direct
    ? displayName(approval.requestedBy, data.users, approval.requestedByName)
    : undefined;
  const requested = requesterName ? ` (demandé par ${requesterName})` : "";
  const value = fmt(p.value, p.note);
  return {
    title: `Valeur KPI corrigée · ${kpi}`,
    desc: `Valeur KPI corrigée : ${kpi} ${periodText} ${old} → ${value} par ${actorName}${requested}.`,
    i18n: {
      titleKey: "strategicApprovals.alert.kpiCorrectedTitle",
      descKey: requesterName
        ? "strategicApprovals.alert.kpiCorrectedDescRequested"
        : "strategicApprovals.alert.kpiCorrectedDesc",
      vars: {
        kpi,
        period: periodText,
        old,
        value,
        actor: actorName,
        requester: requesterName ?? "",
      },
    },
  };
}

// ─── Décision (palier) ──────────────────────────────────────────────────────────────────────

export type ApprovalDecisionResult = {
  /** La demande après décision (à persister). */
  approval: StrategicApproval;
  /** true ⇒ la demande est CLOSE (dernier palier validé, ou refus) : appliquer les effets
   *  (`applyApprovedPayload` / `applyRejectedPayload`). false ⇒ palier suivant, rien à appliquer. */
  final: boolean;
};

/**
 * Décision PURE d'un palier (ne vérifie PAS le droit : appeler `canDecide` avant).
 *  - Demande à chaîne : le palier courant est horodaté (`decidedBy`…). Refus ⇒ demande close
 *    "rejected". Validation d'un palier intermédiaire ⇒ `stepIndex + 1`, `approver*` = palier
 *    suivant, statut toujours "pending". Validation du dernier palier ⇒ "approved".
 *  - Demande legacy : décision unique (comportement historique).
 * Les champs `decidedBy`/`decidedAt`/`decisionComment` de la demande ne sont posés qu'à la clôture.
 */
export function decideApproval(
  approval: StrategicApproval,
  decider: Pick<AuthUser, "username" | "name">,
  status: "approved" | "rejected",
  comment?: string,
  now: string = new Date().toISOString()
): ApprovalDecisionResult {
  const decisionComment = comment?.trim() || undefined;
  const closed = (): StrategicApproval =>
    stripUndefined({
      ...approval,
      status,
      decidedBy: decider.username,
      decidedByName: decider.name,
      decidedAt: now,
      decisionComment,
    });
  if (!approval.chain?.length) return { approval: closed(), final: true };
  const idx = Math.min(approval.stepIndex ?? 0, approval.chain.length - 1);
  const chain = approval.chain.map((s, i) =>
    i === idx
      ? stripUndefined({
          ...s,
          decidedBy: decider.username,
          decidedByName: decider.name,
          decidedAt: now,
          decision: status,
          decisionComment,
        })
      : s
  );
  const isLast = idx === approval.chain.length - 1;
  if (status === "rejected" || isLast) {
    return { approval: { ...closed(), chain, stepIndex: idx }, final: true };
  }
  const next = chain[idx + 1];
  return {
    approval: stripUndefined({
      ...approval,
      chain,
      stepIndex: idx + 1,
      approverRole: levelRole(next.level),
      approverUsername: next.usernames[0],
      approverUsernames: next.usernames,
    }),
    final: false,
  };
}

// ─── Effets ─────────────────────────────────────────────────────────────────────────────────

/** Écritures à exécuter (par le hook) pour appliquer une décision. Idempotentes (ids stables). */
export type ApprovalEffects = {
  saveActions: ChantierAction[];
  deleteActionIds: string[];
  deleteChantierIds: string[];
  saveMeasurements: IndicatorMeasurement[];
  /** Mesures à supprimer — alimenté uniquement par un `"kpi_value"` de suppression approuvé. */
  deleteMeasurementIds: string[];
  saveIndicators: Indicator[];
  /** Lignes ETP à écrire (round 29) — alimenté uniquement par `"projet_create"` quand la demande
   *  approuvée porte un `payload.staffing` (voir `ProjetCreateApprovalPayload`). Vide dans tous les
   *  autres cas, y compris pour les demandes d'avant round 29. */
  saveStaffing: ChantierStaffing[];
  /** Chantiers à écrire — `"chantier_create"` / `"chantier_update"` approuvés. */
  saveChantiers: Chantier[];
};

function emptyEffects(): ApprovalEffects {
  return {
    saveActions: [],
    deleteActionIds: [],
    deleteChantierIds: [],
    saveMeasurements: [],
    deleteMeasurementIds: [],
    saveIndicators: [],
    saveStaffing: [],
    saveChantiers: [],
  };
}

/** Un champ modifié par la demande a changé depuis (valeur actuelle ≠ `before`) → périmée. */
function assertNotStale(current: object, before: object | undefined, patch: object): void {
  if (!before) return;
  for (const key of Object.keys(patch)) {
    if (!(key in before)) continue;
    const now = (current as Record<string, unknown>)[key];
    const then = (before as Record<string, unknown>)[key];
    if (!sameValue(now, then)) {
      throw new Error(
        `Le champ « ${key} » a été modifié depuis la demande : demande périmée, à refaire`
      );
    }
  }
}

function withoutMilestoneApproval(action: ChantierAction): ChantierAction {
  const copy = { ...action };
  delete copy.milestoneApproval;
  return copy;
}

/**
 * Effets de la DEMANDE elle-même : pour un jalon, pose `milestoneApproval` sur le projet (le
 * marqueur "en attente" déjà affiché par l'UI existante). Sans effet pour les autres kinds.
 */
export function applyRequestSideEffects(
  approval: StrategicApproval,
  data: StrategicApprovalData
): ApprovalEffects {
  const effects = emptyEffects();
  if (approval.kind === "milestone") {
    const action = data.chantierActions.find((a) => a.id === approval.targetId);
    const payload = approval.payload as MilestoneApprovalPayload;
    if (action) {
      effects.saveActions.push({
        ...action,
        milestoneApproval: {
          targetMilestone: payload.targetMilestone,
          requestedBy: approval.requestedBy,
          requestedAt: approval.requestedAt,
        },
      });
    }
  }
  return effects;
}

/**
 * Applique l'effet d'une demande APPROUVÉE : valide le jalon, publie la valeur KPI, crée le projet,
 * supprime le projet/chantier (avec ses projets). Lève si la cible a disparu ou est périmée.
 */
export function applyApprovedPayload(
  approval: StrategicApproval,
  data: StrategicApprovalData
): ApprovalEffects {
  const effects = emptyEffects();
  switch (approval.kind) {
    case "milestone": {
      const action = data.chantierActions.find((a) => a.id === approval.targetId);
      if (!action) throw new Error("Projet introuvable : il a peut-être été supprimé");
      const { targetMilestone } = approval.payload as MilestoneApprovalPayload;
      const before = action.milestones ?? {
        currentMilestone: "E0" as MilestoneId,
        passedMilestones: [] as MilestoneId[],
        checklists: {},
      };
      if (
        MILESTONE_ORDER.indexOf(targetMilestone) <= MILESTONE_ORDER.indexOf(before.currentMilestone)
      ) {
        throw new Error(
          `Le projet est déjà au jalon ${displayMilestoneId(before.currentMilestone)} ou au-delà : demande périmée`
        );
      }
      // La check-list du jalon courant a pu régresser depuis la demande : on RE-VÉRIFIE la porte
      // (`canPassMilestone`, même fusion que la demande) au moment de l'approbation — lève sinon.
      assertMilestoneStillPassable(action, data.chantiers, data.chantierActions);
      const passed = before.passedMilestones.includes(before.currentMilestone)
        ? before.passedMilestones
        : [...before.passedMilestones, before.currentMilestone];
      effects.saveActions.push(
        withoutMilestoneApproval({
          ...action,
          milestones: { ...before, currentMilestone: targetMilestone, passedMilestones: passed },
        })
      );
      return effects;
    }
    case "kpi_value": {
      const indicator = data.indicators.find((i) => i.id === approval.targetId);
      if (!indicator) throw new Error("Indicateur introuvable : il a peut-être été supprimé");
      const p = approval.payload as KpiValueApprovalPayload;
      const decidedAt = approval.decidedAt ?? new Date().toISOString();
      const all = data.measurements ?? [];
      if (p.measurementId) {
        // Correction / suppression d'une mesure déjà publiée.
        const existing = all.find((m) => m.id === p.measurementId);
        if (!existing) throw new Error("Mesure introuvable : elle a peut-être été supprimée");
        const others = all.filter((m) => m.id !== existing.id);
        let next: IndicatorMeasurement[] = others;
        if (p.remove) {
          effects.deleteMeasurementIds.push(existing.id);
        } else {
          if (
            others.some(
              (m) => m.indicatorId === existing.indicatorId && samePeriod(m.period, p.period)
            )
          ) {
            throw new Error(`Une mesure existe déjà pour la période ${p.period} : demande périmée`);
          }
          const { value: _v, note: _n, updatedBy: _ub, updatedAt: _ua, ...rest } = existing;
          void _v;
          void _n;
          void _ub;
          void _ua;
          const corrected: IndicatorMeasurement = stripUndefined({
            ...rest,
            period: p.period,
            value: p.value,
            note: p.note,
            updatedBy: approval.requestedBy,
            updatedAt: decidedAt,
          });
          effects.saveMeasurements.push(corrected);
          next = [...others, corrected];
        }
        const status = computeIndicatorStatus(indicator, next);
        if (status !== indicator.status) {
          effects.saveIndicators.push({ ...indicator, status, lastUpdate: decidedAt.slice(0, 10) });
        }
        return effects;
      }
      // Nouvelle valeur sur une période DÉJÀ renseignée entre-temps (autre saisie approuvée ou
      // directe) : jamais de second document pour la même période — la valeur approuvée REMPLACE
      // la mesure existante (mise à jour de ce document, saisie d'origine conservée, correction
      // tracée), exactement comme un remplacement proposé à la saisie.
      const taken = all.find(
        (m) => m.indicatorId === indicator.id && samePeriod(m.period, p.period)
      );
      let measurement: IndicatorMeasurement;
      if (taken) {
        const { value: _v, note: _n, ...rest } = taken;
        void _v;
        void _n;
        measurement = stripUndefined({
          ...rest,
          value: p.value,
          note: p.note,
          updatedBy: approval.requestedBy,
          updatedAt: decidedAt,
        });
      } else {
        measurement = stripUndefined({
          id: `IM-${approval.id}`,
          companyId: approval.companyId,
          indicatorId: indicator.id,
          period: p.period,
          value: p.value,
          note: p.note,
          reportedBy: approval.requestedBy,
          reportedAt: decidedAt,
        });
      }
      effects.saveMeasurements.push(measurement);
      const others = (data.measurements ?? []).filter((m) => m.id !== measurement.id);
      const status = computeIndicatorStatus(indicator, [...others, measurement]);
      if (status !== indicator.status) {
        effects.saveIndicators.push({
          ...indicator,
          status,
          lastUpdate: (approval.decidedAt ?? new Date().toISOString()).slice(0, 10),
        });
      }
      return effects;
    }
    case "projet_create": {
      const payload = approval.payload as ProjetCreateApprovalPayload;
      if (payload.stage === "chantier" && !approval.chain?.length) {
        // LEGACY — palier 1/2 (pilote du chantier) : pas de création ici — `useStrategicApprovals.decide()`
        // enchaîne juste après sur `nextProjetCreateApproval` (2e demande, palier "axis"), ou crée
        // directement si ce palier s'avère inutile (voir cette fonction). Voir l'en-tête du fichier.
        return effects;
      }
      const { action, staffing } = payload;
      if (!data.chantiers.some((c) => c.id === action.chantierId)) {
        throw new Error("Chantier introuvable : il a peut-être été supprimé");
      }
      effects.saveActions.push({ ...action, companyId: approval.companyId });
      // Round 29 : le brouillon ETP saisi à la création (absent des demandes antérieures) suit le
      // projet — `actionId`/`companyId` réaffirmés sur `action.id`/`approval.companyId` (même
      // logique défensive que `saveActions` ci-dessus) plutôt que de faire confiance à ce que le
      // payload portait déjà.
      for (const s of staffing ?? []) {
        effects.saveStaffing.push({ ...s, actionId: action.id, companyId: approval.companyId });
      }
      return effects;
    }
    case "projet_delete": {
      effects.deleteActionIds.push(approval.targetId);
      return effects;
    }
    case "chantier_delete": {
      effects.deleteChantierIds.push(approval.targetId);
      // Pas d'orphelins : les projets du chantier partent avec lui.
      for (const a of data.chantierActions) {
        if (a.chantierId === approval.targetId) effects.deleteActionIds.push(a.id);
      }
      return effects;
    }
    case "projet_update": {
      const action = data.chantierActions.find((a) => a.id === approval.targetId);
      if (!action) throw new Error("Projet introuvable : il a peut-être été supprimé");
      const { patch, before } = approval.payload as ProjetUpdateApprovalPayload;
      assertNotStale(action, before, patch);
      const next = { ...action };
      for (const key of Object.keys(patch)) {
        if (PROJET_INTERNAL_FIELDS.has(key)) continue;
        // `null` = champ vidé par le demandeur (voir updateEntityFlow) → effacement.
        const value = (patch as Record<string, unknown>)[key];
        (next as Record<string, unknown>)[key] = value === null ? undefined : value;
      }
      effects.saveActions.push(stripUndefined(next));
      return effects;
    }
    case "chantier_update": {
      const chantier = data.chantiers.find((c) => c.id === approval.targetId);
      if (!chantier) throw new Error("Chantier introuvable : il a peut-être été supprimé");
      const { patch, before } = approval.payload as ChantierUpdateApprovalPayload;
      assertNotStale(chantier, before, patch);
      const next = { ...chantier };
      for (const key of Object.keys(patch)) {
        if (CHANTIER_INTERNAL_FIELDS.has(key)) continue;
        // `null` = champ vidé par le demandeur (voir updateEntityFlow) → effacement.
        const value = (patch as Record<string, unknown>)[key];
        (next as Record<string, unknown>)[key] = value === null ? undefined : value;
      }
      const decidedAt = approval.decidedAt ?? new Date().toISOString();
      effects.saveChantiers.push(stripUndefined({ ...next, lastUpdate: decidedAt.slice(0, 10) }));
      return effects;
    }
    case "chantier_create": {
      const { chantier } = approval.payload as ChantierCreateApprovalPayload;
      if (!chantier.axisIds?.some((id) => data.axes.some((a) => a.id === id))) {
        throw new Error("Axe introuvable : il a peut-être été supprimé");
      }
      effects.saveChantiers.push({
        ...chantier,
        companyId: approval.companyId,
        programId: chantier.programId || approval.programId,
      });
      return effects;
    }
  }
}

/** Effets d'un REFUS : un jalon refusé retire le marqueur "en attente" du projet. */
export function applyRejectedPayload(
  approval: StrategicApproval,
  data: StrategicApprovalData
): ApprovalEffects {
  const effects = emptyEffects();
  if (approval.kind === "milestone") {
    const action = data.chantierActions.find((a) => a.id === approval.targetId);
    if (action?.milestoneApproval) effects.saveActions.push(withoutMilestoneApproval(action));
  }
  return effects;
}

/**
 * À appeler par `useStrategicApprovals.decide()` juste après l'APPROBATION d'un `"projet_create"`
 * palier `"chantier"` (voir l'en-tête du fichier) : construit la 2e demande, palier `"axis"`, avec
 * le MÊME payload (action/staffing), même cible, même demandeur d'origine (`approval.requestedBy`).
 * Retourne `undefined` quand ce 2e palier serait inutile ou indécidable — l'appelant doit alors
 * créer le projet directement (via `applyApprovedPayload` avec `payload.stage` forcé à `"axis"`) :
 *  - aucun responsable d'axe NI strategic_lead résolvable (repli documenté : jamais de blocage) ;
 *  - le demandeur d'origine EST lui-même ce responsable d'axe (ou le strategic_lead du programme) :
 *    il ne pourrait de toute façon pas décider sa propre demande (`canDecide`), la lui reposer
 *    bloquerait pour rien.
 * Pure : ne persiste rien (l'appelant fait `saveStrategicApproval` + l'audit "requested").
 */
export function nextProjetCreateApproval(
  approval: StrategicApproval,
  data: StrategicApprovalData
): StrategicApproval | undefined {
  if (approval.kind !== "projet_create" || approval.status !== "approved") return undefined;
  const payload = approval.payload as ProjetCreateApprovalPayload;
  if (payload.stage !== "chantier") return undefined;
  const target: StrategicApprovalTarget = {
    type: approval.targetType,
    id: approval.targetId,
    name: approval.targetName,
  };
  const axisApprover = resolveApprover("projet_create", target, data, "axis");
  if (axisApprover.usernames.length === 0) return undefined;
  const requesterUser = data.users?.find((u) => u.username === approval.requestedBy);
  // Note : pas besoin de tester l'admin ici — un demandeur admin n'aurait jamais atteint le palier
  // "chantier" en premier lieu (`createProjetFlow` l'aurait créé directement, voir cette fonction).
  const requesterIsAxisApprover =
    axisApprover.usernames.includes(approval.requestedBy) ||
    isLeadOfProgram(
      requesterUser ? { username: requesterUser.username, profiles: requesterUser.profiles } : null,
      approval.programId
    );
  if (requesterIsAxisApprover) return undefined;
  return buildApproval({
    kind: "projet_create",
    target,
    payload: { ...payload, stage: "axis" },
    reason: approval.reason,
    companyId: approval.companyId,
    programId: approval.programId,
    requester: {
      username: approval.requestedBy,
      name: approval.requestedByName ?? approval.requestedBy,
    },
    data,
    chain: null,
  });
}

// ─── Description (UI) ───────────────────────────────────────────────────────────────────────

export type ApprovalDescription = {
  subject: string;
  /** Valeur actuelle (absente pour une création). */
  before?: string;
  /** Valeur demandée (absente pour une suppression : l'UI affiche "Supprimé"). */
  after?: string;
};

export function describeApproval(
  approval: StrategicApproval,
  data: StrategicApprovalData
): ApprovalDescription {
  const subject = approval.targetName ?? approval.targetId;
  switch (approval.kind) {
    case "milestone": {
      const p = approval.payload as MilestoneApprovalPayload;
      const action = data.chantierActions.find((a) => a.id === approval.targetId);
      const from = p.fromMilestone ?? action?.milestones?.currentMilestone ?? "E0";
      return {
        subject,
        before: displayMilestoneId(from),
        after: displayMilestoneId(p.targetMilestone),
      };
    }
    case "kpi_value": {
      const p = approval.payload as KpiValueApprovalPayload;
      const indicator = data.indicators.find((i) => i.id === approval.targetId);
      const unit = indicator?.unit ? ` ${indicator.unit}` : "";
      if (p.measurementId) {
        const existing = (data.measurements ?? []).find((m) => m.id === p.measurementId);
        const before =
          p.previousPeriod !== undefined
            ? `${p.previousValue ?? p.previousNote ?? "—"}${p.previousValue !== undefined ? unit : ""} (${p.previousPeriod})`
            : existing
              ? `${existing.value ?? "—"}${unit} (${existing.period})`
              : undefined;
        return {
          subject,
          before,
          after: p.remove ? undefined : `${p.value ?? "—"}${unit} (${p.period})`,
        };
      }
      const latest = latestMeasurement(approval.targetId, data.measurements ?? []);
      return {
        subject,
        before: latest?.value !== undefined ? `${latest.value}${unit}` : undefined,
        after: `${p.value ?? "—"}${unit} (${p.period})`,
      };
    }
    case "projet_create": {
      const { action, stage } = approval.payload as ProjetCreateApprovalPayload;
      // `before` détourné pour porter le PALIER de la double validation (voir l'en-tête du
      // fichier) plutôt qu'une "valeur avant" (une création n'en a pas) : le seul moyen, sans
      // toucher `StrategicApprovalsPanel.tsx`, de distinguer visuellement les deux demandes
      // "projet_create" d'un même projet plutôt que d'afficher deux cartes identiques.
      const stageLabel =
        stage === "chantier"
          ? "Validation du pilote de chantier"
          : stage === "axis"
            ? "Validation du responsable d'axe"
            : undefined;
      return {
        subject: action.name || subject,
        before: stageLabel,
        after: `${action.start} → ${action.end}`,
      };
    }
    case "projet_update":
    case "chantier_update": {
      const p = approval.payload as ProjetUpdateApprovalPayload;
      const keys = Object.keys(p.patch ?? {});
      const fmt = (src: Record<string, unknown> | undefined) =>
        keys.map((k) => `${k} : ${formatFieldValue(src?.[k])}`).join(" ; ");
      return {
        subject,
        before: fmt(p.before as Record<string, unknown>),
        after: fmt(p.patch as Record<string, unknown>),
      };
    }
    case "chantier_create": {
      const { chantier } = approval.payload as ChantierCreateApprovalPayload;
      return { subject: chantier?.name || subject, after: chantier?.name || subject };
    }
    default: {
      const p = approval.payload as DeleteApprovalPayload;
      return { subject: p.name ?? subject, before: p.name ?? subject };
    }
  }
}

/** Valeur de champ lisible (description avant/après d'une modification). */
function formatFieldValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "string")) return v.join(", ") || "—";
    return `${v.length} élément(s)`;
  }
  return "(modifié)";
}

// ─── Audit ──────────────────────────────────────────────────────────────────────────────────

/** `"step_approved"` : un palier INTERMÉDIAIRE validé (la demande reste en attente du suivant). */
export type ApprovalEvent = "requested" | "approved" | "rejected" | "step_approved";

function displayName(
  username: string | undefined,
  users: StrategicApprovalData["users"],
  fb?: string
) {
  if (!username) return fb ?? "—";
  return users?.find((u) => u.username === username)?.name ?? fb ?? username;
}

function verbPhrase(approval: StrategicApproval, pastTense: boolean): string {
  const name = approval.targetName ?? approval.targetId;
  switch (approval.kind) {
    case "milestone": {
      const p = approval.payload as MilestoneApprovalPayload;
      const to = displayMilestoneId(p.targetMilestone);
      return pastTense
        ? `a fait passer le projet « ${name} » au jalon ${to}`
        : `le passage du projet « ${name} » au jalon ${to}`;
    }
    case "kpi_value": {
      const p = approval.payload as KpiValueApprovalPayload;
      if (p.measurementId && p.remove) {
        return pastTense
          ? `a supprimé la mesure ${p.value ?? "—"} (${p.period}) de l'indicateur « ${name} »`
          : `la suppression de la mesure ${p.value ?? "—"} (${p.period}) de l'indicateur « ${name} »`;
      }
      if (p.measurementId) {
        return pastTense
          ? `a corrigé la mesure en ${p.value ?? "—"} (${p.period}) sur l'indicateur « ${name} »`
          : `la correction de la mesure en ${p.value ?? "—"} (${p.period}) de l'indicateur « ${name} »`;
      }
      return pastTense
        ? `a renseigné ${p.value ?? "—"} (${p.period}) sur l'indicateur « ${name} »`
        : `la valeur ${p.value ?? "—"} (${p.period}) de l'indicateur « ${name} »`;
    }
    case "projet_create": {
      // Suffixe de palier (voir `describeApproval`) — vide pour une demande d'avant la double
      // validation (`payload.stage` absent) : texte inchangé par rapport à l'ancien schéma.
      const { stage } = approval.payload as ProjetCreateApprovalPayload;
      const suffix =
        stage === "chantier"
          ? " (validation du pilote de chantier)"
          : stage === "axis"
            ? " (validation du responsable d'axe)"
            : "";
      return pastTense
        ? `a ajouté le projet « ${name} »${suffix}`
        : `l'ajout du projet « ${name} »${suffix}`;
    }
    case "projet_delete":
      return pastTense
        ? `a supprimé le projet « ${name} »`
        : `la suppression du projet « ${name} »`;
    case "chantier_delete":
      return pastTense
        ? `a supprimé le chantier « ${name} »`
        : `la suppression du chantier « ${name} »`;
    case "projet_update":
      return pastTense
        ? `a modifié le projet « ${name} » (${updateFieldsText(approval)})`
        : `la modification du projet « ${name} » (${updateFieldsText(approval)})`;
    case "chantier_update":
      return pastTense
        ? `a modifié le chantier « ${name} » (${updateFieldsText(approval)})`
        : `la modification du chantier « ${name} » (${updateFieldsText(approval)})`;
    case "chantier_create": {
      const created = (approval.payload as ChantierCreateApprovalPayload).chantier?.name ?? name;
      return pastTense
        ? `a créé le chantier « ${created} »`
        : `la création du chantier « ${created} »`;
    }
  }
}

function updateFieldsText(approval: StrategicApproval): string {
  return Object.keys((approval.payload as ProjetUpdateApprovalPayload).patch ?? {}).join(", ");
}

type NestedText = { key: string; fallback: string; vars: Record<string, string | number> };

/** Équivalent i18n du groupe nominal de `verbPhrase(approval, false)` : clé + gabarit français de
 *  repli + variables, résolu à l'affichage (lib/alertText.ts) dans la langue active. */
function nounPhraseI18n(approval: StrategicApproval): NestedText {
  const name = approval.targetName ?? approval.targetId;
  const k = "strategicApprovals.phrase.";
  switch (approval.kind) {
    case "milestone": {
      const p = approval.payload as MilestoneApprovalPayload;
      return {
        key: k + "milestone",
        fallback: "le passage du projet « {name} » au jalon {to}",
        vars: { name, to: displayMilestoneId(p.targetMilestone) },
      };
    }
    case "kpi_value": {
      const p = approval.payload as KpiValueApprovalPayload;
      const vars = { name, value: p.value ?? "—", period: p.period };
      if (p.measurementId && p.remove)
        return {
          key: k + "kpiRemove",
          fallback: "la suppression de la mesure {value} ({period}) de l'indicateur « {name} »",
          vars,
        };
      if (p.measurementId)
        return {
          key: k + "kpiCorrect",
          fallback: "la correction de la mesure en {value} ({period}) de l'indicateur « {name} »",
          vars,
        };
      return {
        key: k + "kpiValue",
        fallback: "la valeur {value} ({period}) de l'indicateur « {name} »",
        vars,
      };
    }
    case "projet_create": {
      const { stage } = approval.payload as ProjetCreateApprovalPayload;
      if (stage === "chantier")
        return {
          key: k + "projetCreateChantier",
          fallback: "l'ajout du projet « {name} » (validation du pilote de chantier)",
          vars: { name },
        };
      if (stage === "axis")
        return {
          key: k + "projetCreateAxis",
          fallback: "l'ajout du projet « {name} » (validation du responsable d'axe)",
          vars: { name },
        };
      return { key: k + "projetCreate", fallback: "l'ajout du projet « {name} »", vars: { name } };
    }
    case "projet_delete":
      return {
        key: k + "projetDelete",
        fallback: "la suppression du projet « {name} »",
        vars: { name },
      };
    case "chantier_delete":
      return {
        key: k + "chantierDelete",
        fallback: "la suppression du chantier « {name} »",
        vars: { name },
      };
    case "projet_update":
      return {
        key: k + "projetUpdate",
        fallback: "la modification du projet « {name} » ({fields})",
        vars: { name, fields: updateFieldsText(approval) },
      };
    case "chantier_update":
      return {
        key: k + "chantierUpdate",
        fallback: "la modification du chantier « {name} » ({fields})",
        vars: { name, fields: updateFieldsText(approval) },
      };
    case "chantier_create":
      return {
        key: k + "chantierCreate",
        fallback: "la création du chantier « {name} »",
        vars: {
          name: (approval.payload as ChantierCreateApprovalPayload).chantier?.name ?? name,
        },
      };
  }
}

/**
 * Entrée du journal d'audit (admin/history) pour une demande/décision, avec un texte explicite :
 * « X a supprimé le chantier Y — validé par Z ».
 */
export function buildApprovalAuditEntry(
  approval: StrategicApproval,
  event: ApprovalEvent,
  users?: StrategicApprovalData["users"],
  ts?: string
): AuditEntry {
  const requester = displayName(approval.requestedBy, users, approval.requestedByName);
  const decider = displayName(approval.decidedBy, users, approval.decidedByName);
  const base = { ts: ts ?? new Date().toISOString().slice(0, 16).replace("T", " ") };
  const entity = approval.targetId;
  const field = `validation:${approval.kind}`;
  const step = stepLabel(approval);
  const stepSuffix = step ? ` (${step.toLowerCase()})` : "";
  const currentApprovers = () => {
    const names = pendingApproversOf(approval).map((u) => displayName(u, users));
    return names.length ? names.join(" ou ") : approval.approverRole;
  };
  if (event === "step_approved") {
    // `approval` = état APRÈS décision : le palier validé est celui qui précède `stepIndex`.
    const idx = Math.max(0, (approval.stepIndex ?? 1) - 1);
    const validated = approval.chain?.[idx];
    const by = displayName(validated?.decidedBy, users, validated?.decidedByName);
    const total = approval.chain?.length ?? 1;
    const c = validated?.decisionComment ? ` (${validated.decisionComment})` : "";
    return {
      ...base,
      user: by,
      action: "approval_approved",
      entity,
      field,
      old: "pending",
      new: `${by} a validé (étape ${idx + 1}/${total}) ${verbPhrase(approval, false)} demandé(e) par ${requester} — en attente de ${currentApprovers()}${c}`,
    };
  }
  if (event === "requested") {
    const approver = approval.chain?.length
      ? `${currentApprovers()}${stepSuffix}`
      : approval.approverUsername
        ? displayName(approval.approverUsername, users)
        : approval.approverRole;
    return {
      ...base,
      user: requester,
      action: "approval_requested",
      entity,
      field,
      old: "",
      new: `${requester} a demandé ${verbPhrase(approval, false)} — à valider par ${approver}${approval.reason ? ` (motif : ${approval.reason})` : ""}`,
    };
  }
  const comment = approval.decisionComment ? ` (${approval.decisionComment})` : "";
  if (event === "approved") {
    return {
      ...base,
      user: decider,
      action: "approval_approved",
      entity,
      field,
      old: "pending",
      new: `${requester} ${verbPhrase(approval, true)} — validé par ${decider}${comment}`,
    };
  }
  return {
    ...base,
    user: decider,
    action: "approval_rejected",
    entity,
    field,
    old: "pending",
    new: `${decider} a refusé ${verbPhrase(approval, false)} demandé(e) par ${requester}${comment}`,
  };
}

// ─── Alertes ────────────────────────────────────────────────────────────────────────────────

export const APPROVAL_ALERT_ROUTE = "/validation";
/** Fenêtre (jours) pendant laquelle une décision reste signalée au demandeur/approbateur. */
export const DECISION_ALERT_WINDOW_DAYS = 14;

/**
 * Alertes DÉRIVÉES des demandes (pas de document `alerts` séparé : toujours cohérentes avec l'état
 * réel, aucun risque de désynchronisation) pour l'utilisateur courant :
 *  - approbateur : « à valider » tant que la demande est en attente ;
 *  - demandeur : « en attente » (bleu) puis « validée »/« refusée » à la décision ;
 *  - approbateur ayant décidé : accusé de décision.
 */
export function buildApprovalAlerts(
  approvals: StrategicApproval[],
  user: Actor | null | undefined,
  data: StrategicApprovalData,
  now: Date = new Date()
): Alert[] {
  if (!user) return [];
  const alerts: Alert[] = [];
  const cutoff = now.getTime() - DECISION_ALERT_WINDOW_DAYS * 86_400_000;
  for (const a of approvals) {
    const requester = displayName(a.requestedBy, data.users, a.requestedByName);
    const decider = displayName(a.decidedBy, data.users, a.decidedByName);
    const label = describeApproval(a, data).subject;
    const phrase = nounPhraseI18n(a);
    const common = {
      scope: a.targetId,
      scopeLabel: label,
      actorRole: a.approverRole,
      source: "auto" as const,
      companyId: a.companyId,
      resolved: false,
    };
    // Information des responsables supérieurs (correction/suppression KPI appliquée), voir
    // lib/kpiCorrectionRouting.ts. Jamais l'acteur (demandeur/décideur) lui-même.
    if (
      a.status === "approved" &&
      (a.informUsernames ?? []).includes(user.username) &&
      a.requestedBy !== user.username &&
      a.decidedBy !== user.username
    ) {
      const decidedAt = a.decidedAt ?? a.requestedAt;
      if (new Date(decidedAt).getTime() >= cutoff) {
        const notice = kpiCorrectionNoticeText(a, data);
        alerts.push({
          ...common,
          id: `strategic-approval-${a.id}-info`,
          type: "blue",
          ts: decidedAt.slice(0, 10),
          createdAt: decidedAt,
          title: notice.title,
          desc: notice.desc,
          i18n: notice.i18n,
        });
      }
    }
    // Enregistrement d'information (action directe) : ni « à valider » ni accusé de décision.
    if (a.direct) continue;
    if (a.status === "pending") {
      if (canDecide(user, a, data)) {
        alerts.push({
          ...common,
          id: `strategic-approval-${a.id}-todo`,
          type: "amber",
          ts: a.requestedAt.slice(0, 10),
          createdAt: a.requestedAt,
          title: `À valider · ${label}`,
          desc: `${requester} demande ${verbPhrase(a, false)}.`,
          i18n: {
            titleKey: "strategicApprovals.alert.todoTitle",
            descKey: "strategicApprovals.alert.todoDesc",
            vars: { label, requester },
            nested: { phrase },
          },
        });
      }
      if (a.requestedBy === user.username) {
        // Demande à chaîne : les approbateurs du palier COURANT (+ « étape x/n »).
        const current = a.chain?.length
          ? pendingApproversOf(a).map((u) => displayName(u, data.users))
          : [];
        const step = stepLabel(a);
        const approver = current.length
          ? `${current.join(" ou ")}${step ? ` (${step.toLowerCase()})` : ""}`
          : a.approverUsername
            ? displayName(a.approverUsername, data.users)
            : a.approverRole;
        alerts.push({
          ...common,
          id: `strategic-approval-${a.id}-wait`,
          type: "blue",
          ts: a.requestedAt.slice(0, 10),
          createdAt: a.requestedAt,
          title: `Demande en attente · ${label}`,
          desc: `Votre demande de ${verbPhrase(a, false)} attend la validation de ${approver}.`,
          i18n: {
            titleKey: "strategicApprovals.alert.waitTitle",
            descKey: "strategicApprovals.alert.waitDesc",
            vars: { label, approver },
            nested: { phrase },
          },
        });
      }
      continue;
    }
    const decidedAt = a.decidedAt ?? a.requestedAt;
    if (new Date(decidedAt).getTime() < cutoff) continue;
    const approved = a.status === "approved";
    const comment = a.decisionComment ? ` — ${a.decisionComment}` : "";
    if (a.requestedBy === user.username) {
      alerts.push({
        ...common,
        id: `strategic-approval-${a.id}-decision`,
        type: approved ? "green" : "red",
        ts: decidedAt.slice(0, 10),
        createdAt: decidedAt,
        title: `${approved ? "Demande validée" : "Demande refusée"} · ${label}`,
        desc: `${decider} a ${approved ? "validé" : "refusé"} ${verbPhrase(a, false)}${comment}.`,
        i18n: {
          titleKey: approved
            ? "strategicApprovals.alert.approvedTitle"
            : "strategicApprovals.alert.rejectedTitle",
          descKey: approved
            ? "strategicApprovals.alert.approvedDesc"
            : "strategicApprovals.alert.rejectedDesc",
          vars: { label, decider, comment },
          nested: { phrase },
        },
      });
    } else if (a.decidedBy === user.username) {
      alerts.push({
        ...common,
        id: `strategic-approval-${a.id}-decided`,
        type: approved ? "green" : "red",
        ts: decidedAt.slice(0, 10),
        createdAt: decidedAt,
        title: `${approved ? "Validation enregistrée" : "Refus enregistré"} · ${label}`,
        desc: `Vous avez ${approved ? "validé" : "refusé"} ${verbPhrase(a, false)} demandé(e) par ${requester}.`,
        i18n: {
          titleKey: approved
            ? "strategicApprovals.alert.decidedApprovedTitle"
            : "strategicApprovals.alert.decidedRejectedTitle",
          descKey: approved
            ? "strategicApprovals.alert.decidedApprovedDesc"
            : "strategicApprovals.alert.decidedRejectedDesc",
          vars: { label, requester },
          nested: { phrase },
        },
      });
    }
  }
  return alerts;
}

// ─── Sélecteurs ─────────────────────────────────────────────────────────────────────────────

export type ApprovalBuckets = {
  /** En attente ET que l'utilisateur peut décider MAINTENANT (palier courant d'une demande à
   *  chaîne — un approbateur de l'étape 2 ne la voit qu'une fois l'étape 1 validée). */
  pending: StrategicApproval[];
  /** Demandes émises par l'utilisateur, tous statuts, récentes d'abord. */
  mine: StrategicApproval[];
  /** Demandes décidées visibles de l'utilisateur (émises, décidées par lui — y compris un palier
   *  d'une demande à chaîne —, ou tout pour un admin/strategic_lead), récentes d'abord. */
  history: StrategicApproval[];
};

export function bucketApprovals(
  approvals: StrategicApproval[],
  user: Actor | null | undefined,
  data: StrategicApprovalData
): ApprovalBuckets {
  if (!user) return { pending: [], mine: [], history: [] };
  const byRecent = (a: StrategicApproval, b: StrategicApproval) =>
    (b.decidedAt ?? b.requestedAt).localeCompare(a.decidedAt ?? a.requestedAt);
  const pending = approvals
    .filter((a) => canDecide(user, a, data))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const mine = approvals.filter((a) => !a.direct && a.requestedBy === user.username).sort(byRecent);
  const seesAll = isAnyAdmin(user) || hasRole(user, "strategic_lead");
  const history = approvals
    .filter(
      (a) =>
        a.status !== "pending" &&
        (seesAll ||
          a.requestedBy === user.username ||
          a.decidedBy === user.username ||
          (a.chain ?? []).some((st) => st.decidedBy === user.username) ||
          (a.informUsernames ?? []).includes(user.username))
    )
    .sort(byRecent);
  return { pending, mine, history };
}
