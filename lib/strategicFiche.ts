import { advanceMilestone, milestonePassageTarget } from "@/lib/axisLogic";
import {
  approvalStepInfo,
  isPilotOrAdmin,
  pendingOn,
  splitPatchByCategory,
  type GatedCategory,
  type PatchEntity,
  type StrategicApproval,
  type StrategicApprovalTarget,
} from "@/lib/strategicApprovals";
import {
  authorLevel,
  canDesignate,
  STRATEGIC_LEVELS,
  type HierarchyContext,
  type StrategicLevel,
} from "@/lib/strategicHierarchy";
import type { AuthUser, Chantier, ChantierAction, StrategicAxis } from "@/types";

/**
 * Aide PURE aux fiches du Plan Stratégique (axe / chantier / projet) : droits d'édition par niveau
 * hiérarchique, libellés « sera validé par X puis Y », badges « en attente de validation », message
 * de résultat d'un flux (`updateProjetFlow` / `updateChantierFlow` …). Aucune dépendance React :
 * les composants passent leurs gabarits traduits (`t(key, fallback)`) en paramètre.
 */

type Person = { username: string; name?: string };

const rank = (level: StrategicLevel | null) => (level ? STRATEGIC_LEVELS.indexOf(level) : -1);

/** Nom affiché d'un utilisateur (repli sur le username brut). */
export function displayName(username: string, users: Person[] | undefined): string {
  return users?.find((u) => u.username === username)?.name || username;
}

/** Remplace les `{clé}` d'un gabarit traduit. */
export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Libellé d'une chaîne de validation : paliers séparés par `joiner` (« puis »), personnes d'un
 *  même palier séparées par « / ». Vide si la chaîne est vide. */
export function chainLabel(
  steps: { usernames: string[] }[] | undefined,
  users: Person[] | undefined,
  joiner: string
): string {
  return (steps ?? [])
    .map((s) => s.usernames.map((u) => displayName(u, users)).join(" / "))
    .filter(Boolean)
    .join(` ${joiner} `);
}

// ─── Droits ─────────────────────────────────────────────────────────────────────────────────

export type FicheRightsInput = {
  username: string | null | undefined;
  isAdmin: boolean;
  /** `isReadOnlyUser(user, programId, "strategic")` : aucun contrôle d'édition. */
  readOnly: boolean;
  ctx: HierarchyContext;
};

export type ProjetRights = {
  /** Contributeurs, responsable projet et au-dessus (sponsors, pilote) + admin. */
  canEdit: boolean;
  /** Suppression : responsable projet et au-dessus. */
  canDelete: boolean;
  /** Désignation du responsable projet : sponsor de chantier et au-dessus. */
  canDesignateOwner: boolean;
  /** Désignation des contributeurs : responsable projet et au-dessus. */
  canDesignateContributors: boolean;
  level: StrategicLevel | null;
};

const NO_PROJET_RIGHTS: ProjetRights = {
  canEdit: false,
  canDelete: false,
  canDesignateOwner: false,
  canDesignateContributors: false,
  level: null,
};

/** Droits d'un utilisateur sur un PROJET (`ctx.projet` renseigné). */
export function projetRights({ username, isAdmin, readOnly, ctx }: FicheRightsInput): ProjetRights {
  if (!username || readOnly) return NO_PROJET_RIGHTS;
  const level = authorLevel(username, ctx);
  return {
    canEdit: isAdmin || level != null,
    canDelete: isAdmin || rank(level) >= rank("projectOwner"),
    canDesignateOwner: canDesignate("projectOwner", username, ctx, isAdmin),
    canDesignateContributors: canDesignate("contributors", username, ctx, isAdmin),
    level,
  };
}

export type ChantierRights = {
  /** Sponsor de chantier et au-dessus (sponsor d'axe, pilote) + admin — ses propres saisies de
   *  pilotage restent soumises à validation (règle PO : jamais seul). */
  canEdit: boolean;
  /** Désignation du sponsor de chantier (`pilote`, et `sponsorName`) : pilote du plan / admin. */
  canDesignateSponsor: boolean;
  /** Désignation d'un responsable projet à la création : sponsor de chantier et au-dessus. */
  canDesignateProjectOwner: boolean;
  level: StrategicLevel | null;
};

/** Droits d'un utilisateur sur un CHANTIER (`ctx` SANS `projet`). */
export function chantierRights({
  username,
  isAdmin,
  readOnly,
  ctx,
}: FicheRightsInput): ChantierRights {
  if (!username || readOnly) {
    return {
      canEdit: false,
      canDesignateSponsor: false,
      canDesignateProjectOwner: false,
      level: null,
    };
  }
  const chantierCtx: HierarchyContext = { ...ctx, projet: null };
  const level = authorLevel(username, chantierCtx);
  return {
    canEdit: isAdmin || rank(level) >= rank("chantierSponsor"),
    canDesignateSponsor: canDesignate("chantierSponsor", username, chantierCtx, isAdmin),
    canDesignateProjectOwner: canDesignate("projectOwner", username, chantierCtx, isAdmin),
    level,
  };
}

/** Désignation du sponsor d'axe (`StrategicAxis.owner`) : pilote du plan / admin. */
export function canDesignateAxisSponsor({
  username,
  isAdmin,
  readOnly,
  ctx,
}: FicheRightsInput): boolean {
  if (!username || readOnly) return false;
  return canDesignate("axisSponsor", username, ctx, isAdmin);
}

// ─── Champs modifiés / en attente ─────────────────────────────────────────────────────────────

/** Champs RÉELLEMENT modifiés par `patch` (toutes catégories, champs techniques exclus). */
export function changedFields<T extends object>(
  entity: PatchEntity,
  current: T,
  patch: Partial<T>
): string[] {
  const split = splitPatchByCategory(entity, current, patch);
  return [
    ...Object.keys(split.free),
    ...Object.keys(split.pilotage),
    ...Object.keys(split.planning),
    ...Object.keys(split.designation),
  ];
}

/** Catégories soumises à validation touchées par `patch` (ordre : pilotage, planning, désignation). */
export function gatedCategoriesOf<T extends object>(
  entity: PatchEntity,
  current: T,
  patch: Partial<T>
): GatedCategory[] {
  const split = splitPatchByCategory(entity, current, patch);
  return (["pilotage", "planning", "designation"] as GatedCategory[]).filter(
    (c) => Object.keys(split[c]).length > 0
  );
}

/** Champs modifiés par `patch` qui ont DÉJÀ une demande en attente (conflit à refuser). */
export function conflictingFields<T extends object>(
  approvals: StrategicApproval[] | undefined,
  target: Pick<StrategicApprovalTarget, "type" | "id">,
  entity: PatchEntity,
  current: T,
  patch: Partial<T>
): string[] {
  return changedFields(entity, current, patch).filter(
    (field) => pendingOn(approvals, target, field).length > 0
  );
}

export type PendingFieldInfo = {
  approval: StrategicApproval;
  /** Étape courante / total (demande à chaîne) ; absents pour une demande legacy. */
  current?: number;
  total?: number;
  /** Personnes attendues au palier courant. */
  approvers: string[];
  /** Valeur proposée par la demande pour ce champ (`undefined` si non applicable). */
  value: unknown;
};

/** Première demande en attente portant sur `field` de la cible (modification ou jalon). */
export function pendingFieldInfo(
  approvals: StrategicApproval[] | undefined,
  target: Pick<StrategicApprovalTarget, "type" | "id">,
  field: string
): PendingFieldInfo | undefined {
  const approval = pendingOn(approvals, target, field).find(
    (a) => a.kind === "projet_update" || a.kind === "chantier_update" || a.kind === "milestone"
  );
  if (!approval) return undefined;
  const info = approvalStepInfo(approval);
  const payload = approval.payload as { patch?: Record<string, unknown>; targetMilestone?: string };
  const value = approval.kind === "milestone" ? payload.targetMilestone : payload.patch?.[field];
  return {
    approval,
    ...(info ? { current: info.current, total: info.total } : {}),
    approvers: info
      ? info.usernames
      : approval.approverUsernames?.length
        ? approval.approverUsernames
        : approval.approverUsername
          ? [approval.approverUsername]
          : [],
    value,
  };
}

/** Toutes les demandes EN ATTENTE sur une cible (tous kinds), les plus anciennes d'abord. */
export function pendingRequestsOn(
  approvals: StrategicApproval[] | undefined,
  target: Pick<StrategicApprovalTarget, "type" | "id">
): StrategicApproval[] {
  return [...pendingOn(approvals, target)].sort((a, b) =>
    a.requestedAt.localeCompare(b.requestedAt)
  );
}

/** Valeur proposée lisible (usernames → noms). */
export function formatPendingValue(value: unknown, users: Person[] | undefined): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string") return displayName(value, users);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) {
      return value.map((v) => displayName(v as string, users)).join(", ") || "—";
    }
    return `${value.length}`;
  }
  return "…";
}

/** « En attente de validation (étape 1/2) » selon le gabarit fourni (`{current}`/`{total}`),
 *  ou le gabarit sans étape pour une demande legacy / à un seul palier. */
export function pendingBadgeLabel(
  info: Pick<PendingFieldInfo, "current" | "total">,
  templates: { withStep: string; plain: string }
): string {
  if (info.current !== undefined && info.total !== undefined && info.total > 1) {
    return fillTemplate(templates.withStep, { current: info.current, total: info.total });
  }
  return templates.plain;
}

// ─── Jalon appliqué directement ───────────────────────────────────────────────────────────────

/**
 * Passage de jalon APPLIQUÉ DIRECTEMENT (`milestoneFlow` → "applied" : admin / pilote du programme,
 * seuls habilités à ne pas passer par une demande à chaîne) : patch qui avance réellement le jalon
 * (`currentMilestone` → jalon suivant, ancien jalon ajouté à `passedMilestones`, aucun marqueur
 * `milestoneApproval` laissé en base). Lève si l'acteur n'est ni admin ni pilote du programme du
 * chantier, ou si les prérequis ne sont pas complets. `axes` : conservé pour compatibilité.
 */
export function directMilestoneAdvance(
  action: ChantierAction,
  user: Pick<AuthUser, "username" | "profiles" | "isGlobalAdmin" | "isCompanyAdmin">,
  chantiers: Chantier[],
  actions: ChantierAction[],
  axes?: Pick<StrategicAxis, "id" | "owner">[]
): Pick<ChantierAction, "milestones" | "milestoneApproval"> {
  void axes;
  const chantier = chantiers.find((c) => c.id === action.chantierId);
  if (!isPilotOrAdmin(user, chantier?.programId)) {
    throw new Error(
      "Seuls le pilote du plan et les administrateurs appliquent directement un passage de jalon"
    );
  }
  const { targetMilestone } = milestonePassageTarget(action, chantiers, actions);
  return advanceMilestone(action, targetMilestone);
}

// ─── Résultat d'un flux ─────────────────────────────────────────────────────────────────────

export type FlowResultLike = {
  outcome: "applied" | "pending" | "partial" | "noop";
  requests?: Pick<StrategicApproval, "chain">[];
};

/** Message de toast pour un résultat de flux. Gabarits : `pending`/`partial` reçoivent `{chain}`
 *  (chaînes des demandes créées, dédoublonnées, séparées par « ; »). `noop` → `null`. */
export function flowOutcomeMessage(
  result: FlowResultLike,
  users: Person[] | undefined,
  templates: { applied: string; pending: string; partial: string; joiner: string },
  /** Chaîne prévue (aperçu) quand le flux ne renvoie pas les demandes (jalon, création…). */
  fallbackChain?: { usernames: string[] }[]
): string | null {
  if (result.outcome === "noop") return null;
  if (result.outcome === "applied") return templates.applied;
  const chains = (result.requests ?? [])
    .map((r) => chainLabel(r.chain, users, templates.joiner))
    .filter(Boolean);
  if (!chains.length && fallbackChain?.length) {
    chains.push(chainLabel(fallbackChain, users, templates.joiner));
  }
  const chain = Array.from(new Set(chains)).join(" ; ") || "—";
  return fillTemplate(result.outcome === "partial" ? templates.partial : templates.pending, {
    chain,
  });
}
