import { isLeverVisibleForClearance, resolveConfidentialityClearance } from "@/lib/leversLogic";
import { isAnyAdmin } from "@/lib/roleProfiles";
// Import circulaire assumé (strategicApprovals importe ce module) : `levelRole` n'est appelé qu'à
// l'exécution, jamais pendant l'évaluation des modules.
import { levelRole } from "@/lib/strategicApprovals";
import type {
  ApprovalChainStep,
  AxeCreateApprovalPayload,
  ChantierCreateApprovalPayload,
  ProjetCreateApprovalPayload,
  StaffingUpdateApprovalPayload,
  StrategicApproval,
  StrategicApprovalData,
} from "@/lib/strategicApprovals";
import type { AuthUser, Chantier, Role, StrategicAxis } from "@/types";

/**
 * CONFIDENTIALITÉ DES DEMANDES DE VALIDATION du Plan Stratégique (décision PO, OPTION A) — module
 * PUR, point de vérité de « ce valideur / ce lecteur est-il habilité sur la cible de la demande ? ».
 *
 * Habilitation sur une cible = même règle que le masquage d'affichage (lib/strategicConfidentiality.ts,
 * appliqué par `useStrategicData`) : TOUS les niveaux qui protègent la cible doivent être
 * accessibles — chantier : son niveau + celui de CHACUN de ses axes ; projet / ligne ETP : ceux de
 * son chantier ; indicateur : son niveau + ceux de son chantier (indicateur de chantier) ou de son
 * axe (indicateur d'axe) ; axe : son niveau. Création de chantier / d'axe : le chantier / l'axe
 * DEMANDÉ (payload). Les admins sont toujours habilités.
 *
 * Usages :
 *  - ROUTAGE (`resolveApprovalRoute`, `routeKpiCorrection`) : un valideur non habilité n'est
 *    jamais retenu dans la chaîne — palier sauté vers le valideur habilité suivant, à défaut un
 *    admin (`approvalChain` / `fallbackApprovalChain`, lib/strategicHierarchy.ts) ;
 *  - LECTURE des demandes déjà en attente (`clearedApproval`) : un palier routé à un non-habilité
 *    est traité de la même façon (le non-habilité ne la voit plus et ne peut plus la décider) ;
 *  - AFFICHAGE (`maskApprovalForReader`) : pour un lecteur non habilité, nom de la cible et
 *    contenu avant/après remplacés par « Élément hors de votre périmètre ».
 *
 * Cible introuvable (supprimée depuis) : niveaux SNAPSHOTÉS à la demande
 * (`StrategicApproval.targetConfidentiality`) ; à défaut (demande d'avant ce lot), aucune
 * restriction n'est déductible — comportement historique conservé.
 */

/** Paramètres de confidentialité de l'entreprise (`Company.roleClearance` /
 *  `Company.confidentialityLevels`). Sur `StrategicApprovalData.confidentiality` : `undefined` =
 *  non fourni (appelants historiques : seules les habilitations individuelles comptent), `null` =
 *  en cours de chargement. */
export type StrategicConfidentialityConfig = {
  roleClearance?: Partial<Record<Role, string | string[]>>;
  levels?: string[];
};

/** Libellé (français, repli i18n `strategicApprovals.outOfScope`) d'une cible hors habilitation. */
export const OUT_OF_SCOPE_APPROVAL_LABEL = "Élément hors de votre périmètre";
export const OUT_OF_SCOPE_APPROVAL_KEY = "strategicApprovals.outOfScope";

/** Ce qu'il faut de la demande pour résoudre sa cible. */
export type ApprovalTargetRef = Pick<StrategicApproval, "kind" | "targetType" | "targetId"> &
  Partial<Pick<StrategicApproval, "payload" | "targetConfidentiality">>;

type TargetData = Pick<
  StrategicApprovalData,
  "axes" | "chantiers" | "chantierActions" | "indicators"
> &
  Partial<Pick<StrategicApprovalData, "program">>;

type ClearanceUser = Pick<AuthUser, "username"> &
  Partial<
    Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin" | "confidentialityClearance">
  >;

function uniqLevels(levels: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const l of levels) if (l && !out.includes(l)) out.push(l);
  return out;
}

function axisLevels(axisIds: string[] | undefined, axes: StrategicAxis[]): (string | undefined)[] {
  return (axisIds ?? []).map((id) => axes.find((a) => a.id === id)?.confidentialityLevel);
}

function chantierLevels(
  chantier: Pick<Chantier, "axisIds" | "confidentialityLevel">,
  axes: StrategicAxis[]
): (string | undefined)[] {
  return [chantier.confidentialityLevel, ...axisLevels(chantier.axisIds, axes)];
}

/**
 * Niveaux de confidentialité qui protègent la cible d'une demande (tous doivent être accessibles),
 * `[]` = cible non confidentielle, `null` = cible introuvable sans snapshot (rien à déduire).
 * Résolus sur le programme COMPLET (`data.program`) quand il est fourni.
 */
export function approvalTargetLevels(ref: ApprovalTargetRef, data: TargetData): string[] | null {
  const src = data.program ?? data;
  const axes = src.axes;
  if (ref.kind === "axe_create") {
    const axis = (ref.payload as AxeCreateApprovalPayload | undefined)?.axis;
    if (axis) return uniqLevels([axis.confidentialityLevel]);
  }
  if (ref.kind === "chantier_create") {
    const created = (ref.payload as ChantierCreateApprovalPayload | undefined)?.chantier;
    if (created) return uniqLevels(chantierLevels(created, axes));
  }
  const levels = strategicTargetLevels(
    ref.targetType,
    ref.targetId,
    src,
    (ref.payload as StaffingUpdateApprovalPayload | undefined)?.line?.chantierId ??
      (ref.payload as ProjetCreateApprovalPayload | undefined)?.action?.chantierId
  );
  if (levels) return levels;
  return ref.targetConfidentiality ? uniqLevels(ref.targetConfidentiality) : null;
}

/**
 * Niveaux de confidentialité qui protègent un élément du Plan Stratégique (même règle d'héritage
 * que l'affichage, voir l'en-tête), `[]` = non confidentiel, `null` = élément introuvable dans
 * `data`. `fallbackChantierId` : chantier d'un projet pas (ou plus) présent dans `data`. Sert aux
 * demandes (`approvalTargetLevels`) et au journal d'audit (lib/strategicAuditClearance.ts).
 */
export function strategicTargetLevels(
  type: StrategicApproval["targetType"],
  id: string,
  data: Pick<TargetData, "axes" | "chantiers" | "chantierActions" | "indicators">,
  fallbackChantierId?: string
): string[] | null {
  const axes = data.axes;
  const chantierById = (cid: string | undefined) =>
    cid ? data.chantiers.find((c) => c.id === cid) : undefined;
  let levels: (string | undefined)[] | null = null;
  switch (type) {
    case "axe": {
      const axis = axes.find((a) => a.id === id);
      if (axis) levels = [axis.confidentialityLevel];
      break;
    }
    case "chantier": {
      const chantier = chantierById(id);
      if (chantier) levels = chantierLevels(chantier, axes);
      break;
    }
    case "projet": {
      const action = data.chantierActions.find((a) => a.id === id);
      const chantier = chantierById(action?.chantierId ?? fallbackChantierId);
      if (chantier) levels = chantierLevels(chantier, axes);
      break;
    }
    case "indicateur": {
      const indicator = data.indicators.find((i) => i.id === id);
      if (indicator) {
        const chantier = chantierById(indicator.chantierId);
        levels = [
          indicator.confidentialityLevel,
          ...(indicator.chantierId
            ? chantier
              ? chantierLevels(chantier, axes)
              : []
            : axisLevels([indicator.axisId], axes)),
        ];
      }
      break;
    }
  }
  return levels ? uniqLevels(levels) : null;
}

/** Union de niveaux (null = inconnu, ignoré ; les deux null → null). */
export function unionLevels(...lists: (string[] | null | undefined)[]): string[] | null {
  const known = lists.filter((l): l is string[] => Array.isArray(l));
  return known.length ? uniqLevels(known.flat()) : null;
}

/** Les niveaux `levels` sont-ils tous accessibles à cette habilitation ? */
export function levelsAccessibleTo(levels: string[], clearance: "all" | string[]): boolean {
  return levelsAccessible(levels, clearance);
}

/** Habilitation (stratégique) résolue d'un utilisateur — admin : tout. */
export function strategicClearanceOf(
  user: ClearanceUser,
  config: StrategicConfidentialityConfig | null | undefined
): "all" | string[] {
  if (isAnyAdmin(user)) return "all";
  return resolveConfidentialityClearance(
    { profiles: user.profiles ?? [], confidentialityClearance: user.confidentialityClearance },
    config?.roleClearance,
    "strategic",
    config?.levels
  );
}

function levelsAccessible(levels: string[], clearance: "all" | string[]): boolean {
  return levels.every((l) => isLeverVisibleForClearance(l, clearance));
}

/** Fiche complète d'un utilisateur : l'objet fourni, complété par sa fiche dans `data.users`
 *  (profils / habilitation individuelle), l'objet fourni prévalant. */
function withUserRecord(user: ClearanceUser, users: StrategicApprovalData["users"]): ClearanceUser {
  const record = users?.find((u) => u.username === user.username);
  return record ? { ...record, ...stripUndefinedKeys(user) } : user;
}

function stripUndefinedKeys<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(value))
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/**
 * `user` est-il habilité sur la cible de cette demande ? Admin : toujours. Cible non
 * confidentielle ou introuvable sans snapshot : oui (rien à masquer de déductible).
 */
export function isClearedForApproval(
  user: ClearanceUser | null | undefined,
  ref: ApprovalTargetRef,
  data: TargetData & Pick<StrategicApprovalData, "users" | "confidentiality">
): boolean {
  if (!user) return false;
  if (isAnyAdmin(user)) return true;
  const levels = approvalTargetLevels(ref, data);
  if (!levels || levels.length === 0) return true;
  const full = withUserRecord(user, data.users);
  if (isAnyAdmin(full)) return true;
  return levelsAccessible(levels, strategicClearanceOf(full, data.confidentiality));
}

/**
 * Prédicat « ce username est habilité sur la cible » pour construire / relire une chaîne — `undefined`
 * quand la cible n'est pas confidentielle (aucune restriction, comportement historique). Un
 * username inconnu de `data.users` n'est pas habilité (sa fiche est nécessaire pour le savoir).
 */
export function clearedUsernamePredicate(
  ref: ApprovalTargetRef,
  data: TargetData & Pick<StrategicApprovalData, "users" | "confidentiality">
): ((username: string) => boolean) | undefined {
  const levels = approvalTargetLevels(ref, data);
  if (!levels || levels.length === 0) return undefined;
  return (username) => {
    const record = data.users?.find((u) => u.username === username);
    if (!record) return false;
    if (isAnyAdmin(record)) return true;
    return levelsAccessible(levels, strategicClearanceOf(record, data.confidentiality));
  };
}

/** Cible confidentielle (au moins un niveau) — utile pour attendre le chargement des paramètres. */
export function isApprovalTargetConfidential(ref: ApprovalTargetRef, data: TargetData): boolean {
  return (approvalTargetLevels(ref, data) ?? []).length > 0;
}

function adminsOf(users: StrategicApprovalData["users"]): string[] {
  const out: string[] = [];
  for (const u of users ?? []) {
    if ((u.isGlobalAdmin || u.isCompanyAdmin) && !u.disabled && !out.includes(u.username)) {
      out.push(u.username);
    }
  }
  return out;
}

/** Usernames ayant un compte ACTIF (présent dans `users`, non désactivé). */
function activeUsernames(users: StrategicApprovalData["users"]): Set<string> {
  return new Set((users ?? []).filter((u) => !u.disabled).map((u) => u.username));
}

/**
 * Demande EN ATTENTE relue sous la règle de confidentialité (option A, cas des demandes déjà
 * routées à un non-habilité avant ce lot) : sur les paliers NON ENCORE décidés, les valideurs non
 * habilités — et (lot 6) ceux qui n'ont plus de compte actif — sont retirés ; un palier qui n'en
 * garde aucun est SAUTÉ (le palier suivant reçoit la demande) ; si un palier a été sauté, un palier
 * « admin » final reprend la validation perdue (sauf s'il en existe déjà un) — ses admins nommés
 * excluent le demandeur et, s'il en reste d'autres, ceux qui ont déjà validé un palier (sinon
 * l'admin déjà intervenu reprend : un palier de reprise lui reste ouvert, voir `canDecideStep`).
 * `approver*` suivent le palier courant. Idempotente ; renvoie la MÊME référence quand rien ne
 * change (valideurs tous habilités et actifs, utilisateurs ou paramètres pas encore chargés).
 * Demande LEGACY (sans chaîne) : inchangée — `canDecide` refuse un non-habilité et un admin peut
 * toujours décider.
 */
export function clearedApproval(
  approval: StrategicApproval,
  data: TargetData & Pick<StrategicApprovalData, "users" | "confidentiality">
): StrategicApproval {
  if (approval.status !== "pending" || !approval.chain?.length) return approval;
  if (!(data.users?.length ?? 0) || data.confidentiality === null) return approval;
  const isCleared = clearedUsernamePredicate(approval, data);
  const active = activeUsernames(data.users);
  const eligible = (u: string) => active.has(u) && (!isCleared || isCleared(u));
  const idx = Math.min(approval.stepIndex ?? 0, approval.chain.length - 1);
  const head = approval.chain.slice(0, idx);
  const tail: ApprovalChainStep[] = [];
  let changed = false;
  let skipped = false;
  for (const step of approval.chain.slice(idx)) {
    if (step.level === "admin" || step.usernames.length === 0) {
      tail.push(step);
      continue;
    }
    const usernames = step.usernames.filter((u) => eligible(u));
    if (usernames.length === step.usernames.length) {
      tail.push(step);
      continue;
    }
    changed = true;
    if (usernames.length === 0) {
      skipped = true;
      continue;
    }
    tail.push({ ...step, usernames });
  }
  if (!changed) return approval;
  if (skipped && !tail.some((s) => s.level === "admin")) {
    const prior = head.map((s) => s.decidedBy);
    const admins = adminsOf(data.users).filter((u) => u !== approval.requestedBy);
    const fresh = admins.filter((u) => !prior.includes(u));
    tail.push({ level: "admin", usernames: fresh.length ? fresh : admins });
  }
  const chain = [...head, ...tail];
  const current = chain[idx];
  return {
    ...approval,
    chain,
    stepIndex: idx,
    approverRole: levelRole(current.level),
    approverUsername: current.usernames[0],
    approverUsernames: current.usernames,
  };
}

/** Créations de chantier EN ATTENTE rattachées à l'axe `axisId` que `reader` peut voir (fiche
 *  d'axe) : un chantier demandé confidentiel n'est listé — nom compris — qu'aux habilités. */
export function pendingChantierCreationsOnAxis(
  approvals: StrategicApproval[],
  axisId: string,
  reader: ClearanceUser | null | undefined,
  data: TargetData & Pick<StrategicApprovalData, "users" | "confidentiality">
): StrategicApproval[] {
  return approvals.filter(
    (a) =>
      a.kind === "chantier_create" &&
      !!(a.payload as ChantierCreateApprovalPayload).chantier?.axisIds?.includes(axisId) &&
      isClearedForApproval(reader, a, data)
  );
}

/**
 * Copie d'AFFICHAGE d'une demande pour un lecteur NON habilité sur sa cible (sinon la demande
 * telle quelle) : type, dates, statut, demandeur/décideurs et paliers conservés ; nom de la cible
 * remplacé par `OUT_OF_SCOPE_APPROVAL_LABEL`, contenu (payload avant/après, montants, motif,
 * commentaires) retiré. `masked: true` — jamais persistée.
 */
export function maskApprovalForReader(
  approval: StrategicApproval,
  reader: ClearanceUser | null | undefined,
  data: TargetData & Pick<StrategicApprovalData, "users" | "confidentiality">
): StrategicApproval {
  if (isClearedForApproval(reader, approval, data)) return approval;
  return {
    ...approval,
    targetName: OUT_OF_SCOPE_APPROVAL_LABEL,
    payload: {} as StrategicApproval["payload"],
    reason: undefined,
    decisionComment: undefined,
    chain: approval.chain?.map((s) => ({ ...s, decisionComment: undefined })),
    masked: true,
  };
}
