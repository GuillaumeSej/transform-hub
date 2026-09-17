import * as engine from "@/lib/engine";
import { consolidateLeverFromActions } from "@/lib/leverConsolidate";
import type { CascadeShift } from "@/lib/engine";
import { STATUS_ORDER } from "@/lib/status-config";
import type {
  AuditEntry,
  AuthUser,
  Comment,
  FinancialSnapshot,
  Lever,
  LeverAction,
  LeverApproval,
  LeverApprovalStep,
  Role,
  Workstream,
} from "@/types";
import {
  getPerformanceProfiles,
  getStrategicProfiles,
  hasRole,
  isAnyAdmin,
} from "@/lib/roleProfiles";

/**
 * Résout la liste des niveaux de confidentialité auxquels un utilisateur non-admin a accès,
 * en appliquant la précédence : habilitation INDIVIDUELLE (AuthUser.confidentialityClearance)
 * prioritaire quand définie, sinon repli sur l'habilitation de son profil (Company.roleClearance).
 * Ne s'applique pas à un admin (global ou entreprise, accès total, géré par l'appelant en amont).
 *  - user.confidentialityClearance === "all"  -> accès à tous les niveaux
 *  - user.confidentialityClearance: string[]  -> exactement cette liste (même vide = aucun accès)
 *  - user.confidentialityClearance === undefined -> repli sur roleClearance[profil] (ou [])
 * `planType` précise QUELLE piste consulter pour ce repli (un utilisateur peut avoir un/des
 * profil(s) Plan Performance et un/des profil(s) Plan Stratégique distincts) — "performance" par
 * défaut, pour les appelants historiques (leviers du Plan de Performance).
 *
 * Round multi-profils multi-programmes : un utilisateur peut désormais avoir PLUSIEURS profils
 * sur la piste concernée (un par programme, ex. "lever" sur programme A + "finance" sur programme
 * B) — le repli unione les `roleClearance[role]` de TOUS ces profils (le plus permissif l'emporte)
 * plutôt que de ne lire que le premier trouvé, pour ne pas amputer silencieusement l'accès d'un
 * des rôles cumulés. */
export function resolveConfidentialityClearance(
  user: Pick<AuthUser, "profiles" | "confidentialityClearance"> | null | undefined,
  roleClearance: Partial<Record<Role, string[]>> | undefined,
  planType: "performance" | "strategic" = "performance"
): "all" | string[] {
  if (!user) return [];
  if (user.confidentialityClearance === "all") return "all";
  if (Array.isArray(user.confidentialityClearance)) return user.confidentialityClearance;
  const profiles =
    planType === "strategic" ? getStrategicProfiles(user) : getPerformanceProfiles(user);
  const levels = new Set<string>();
  for (const profile of profiles) {
    const forRole = roleClearance?.[profile.role];
    if (forRole) forRole.forEach((level) => levels.add(level));
  }
  return Array.from(levels);
}

/** Un levier confidentiel est-il visible pour cette habilitation (résolue via
 * resolveConfidentialityClearance) ? Un niveau non défini sur le levier est toujours visible. */
export function isLeverVisibleForClearance(
  confidentialityLevel: string | undefined,
  clearance: "all" | string[]
): boolean {
  if (!confidentialityLevel) return true;
  if (clearance === "all") return true;
  return clearance.includes(confidentialityLevel);
}

/**
 * Un utilisateur est-il le propriétaire de ce levier ? Point d'entrée UNIQUE pour cette question,
 * réutilisé par `canUserViewLever` ci-dessous, `lib/notifications.ts::canUserAccessLever` et le
 * filtre "mes leviers" de `app/(app)/levers/LeversPagePerformance.tsx` — round "ownership réel" :
 * avant ce round, ces trois call sites réimplémentaient chacun leur propre comparaison de chaînes
 * (`===` strict à deux endroits, `.trim().toLowerCase()` au troisième), ce qui pouvait silencieusement
 * masquer un levier à son propriétaire réel en cas de simple différence de casse/espace.
 *
 * Priorité au lien robuste : si `lever.ownerUsername` est défini (levier réconcilié, voir doc-comment
 * `Lever.ownerUsername` dans `types/index.ts`), comparaison EXACTE avec `user.username` — deux
 * identifiants système, pas du texte libre, donc pas de normalisation nécessaire. Sinon (levier
 * legacy jamais réconcilié), repli sur l'ancienne comparaison fragile `lever.owner === user.name`
 * (comportement historique inchangé, pour ne pas casser la visibilité des leviers existants).
 */
function normalizeOwnerName(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

export function isLeverOwnedBy(
  lever: Pick<Lever, "owner" | "ownerUsername">,
  user: Pick<AuthUser, "name" | "username">
): boolean {
  if (lever.ownerUsername) return lever.ownerUsername === user.username;
  return normalizeOwnerName(lever.owner) === normalizeOwnerName(user.name);
}

/** Même principe que `isLeverOwnedBy`, pour le scoping du rôle "sponsor" : un utilisateur sponsor
 *  voit un levier soit parce qu'il sponsorise le workstream parent (`workstreamSponsorUsername`,
 *  résolu par l'appelant depuis `Workstream.sponsorUsername`), soit parce qu'il est identifié
 *  individuellement comme sponsor du levier (`lever.sponsorUsername`, priorité au lien id-based si
 *  réconcilié, repli sur la comparaison de noms fragile sinon — mêmes règles que `owner`). */
export function isLeverSponsoredBy(
  lever: Pick<Lever, "sponsor" | "sponsorUsername">,
  workstreamSponsorUsername: string | undefined,
  user: Pick<AuthUser, "name" | "username">
): boolean {
  if (workstreamSponsorUsername && workstreamSponsorUsername === user.username) return true;
  if (lever.sponsorUsername) return lever.sponsorUsername === user.username;
  return normalizeOwnerName(lever.sponsor) === normalizeOwnerName(user.name);
}

/** Même principe qu'`isLeverOwnedBy`/`isLeverSponsoredBy`, pour le rôle "cto" — utilisé par la
 *  dernière étape de la cascade de validation (`approveLeverApprovalStep`, voir plus bas). Un
 *  profil "cto" sans `programId` (CTO global de l'entreprise, pas rattaché à un programme précis)
 *  habilite sur N'IMPORTE QUEL levier de l'entreprise ; un profil "cto" avec `programId` n'habilite
 *  que sur les leviers de CE programme (`lever.programId`). */
export function isLeverCtoOf(
  lever: Pick<Lever, "programId">,
  user: Pick<AuthUser, "profiles">
): boolean {
  if (!hasRole(user, "cto")) return false;
  return user.profiles.some(
    (p) => p.role === "cto" && (p.programId == null || p.programId === lever.programId)
  );
}

export function canUserViewLever(
  user:
    | Pick<
        AuthUser,
        | "profiles"
        | "isGlobalAdmin"
        | "isCompanyAdmin"
        | "name"
        | "username"
        | "companyId"
        | "confidentialityClearance"
      >
    | null
    | undefined,
  lever: Pick<
    Lever,
    | "owner"
    | "ownerUsername"
    | "sponsor"
    | "sponsorUsername"
    | "ws"
    | "companyId"
    | "confidentialityLevel"
  >,
  roleClearance: Partial<Record<Role, string[]>> | undefined,
  workstreams: Pick<Workstream, "id" | "sponsorUsername">[] = []
): boolean {
  if (!user) return false;
  if (user.isGlobalAdmin) return true;
  if (lever.companyId != null && user.companyId !== lever.companyId) return false;
  if (user.isCompanyAdmin) return true;
  if (hasRole(user, "lever") && !isLeverOwnedBy(lever, user)) return false;
  if (hasRole(user, "sponsor")) {
    const workstreamSponsorUsername = workstreams.find((w) => w.id === lever.ws)?.sponsorUsername;
    if (!isLeverSponsoredBy(lever, workstreamSponsorUsername, user)) return false;
  }
  return isLeverVisibleForClearance(
    lever.confidentialityLevel,
    resolveConfidentialityClearance(user, roleClearance)
  );
}

type PlanLockable = Pick<
  Lever,
  | "status"
  | "lockedPlan"
  | "reforecast"
  | "grossSavings"
  | "netSavings"
  | "opexOneOff"
  | "opexRec"
  | "capex"
>;

function snapshot(entity: PlanLockable): FinancialSnapshot {
  return {
    grossSavings: entity.grossSavings,
    netSavings: entity.netSavings,
    opexOneOff: entity.opexOneOff,
    opexRec: entity.opexRec,
    capex: entity.capex,
  };
}

/** Fige le plan initial dès le passage à l'étape "validated" (une seule fois), puis initialise la
 * réactualisation dès le passage à l'étape "in_progress" (une seule fois, sur la base du plan figé). Ne
 * fait rien si déjà figé/initialisé, ou si le statut n'atteint pas ces paliers. */
export function applyPlanLock<T extends PlanLockable>(entity: T): T {
  let next = entity;
  if (!next.lockedPlan && STATUS_ORDER[next.status] >= STATUS_ORDER.validated) {
    next = { ...next, lockedPlan: snapshot(next) };
  }
  if (!next.reforecast && STATUS_ORDER[next.status] >= STATUS_ORDER.in_progress) {
    next = { ...next, reforecast: next.lockedPlan ?? snapshot(next) };
  }
  return next;
}

/**
 * Logique métier pure du périmètre "leviers" : mêmes règles que l'ancienne couche
 * localStorage (lib/storage.ts, supprimé depuis), mais sans I/O — prend l'état courant (levers) en
 * entrée et retourne le nouvel état + les entités à persister. Permet à useBeTrackData de faire
 * une mise à jour optimiste locale puis d'écrire dans Firestore en tâche de fond.
 */

function nowDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowTs(): string {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

function nextEntityId(prefix: string, existingIds: string[]): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  const maxNum = existingIds.reduce((max, id) => {
    const m = pattern.exec(id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `${prefix}${String(maxNum + 1).padStart(3, "0")}`;
}

function makeAuditEntry(entry: Omit<AuditEntry, "ts">): AuditEntry {
  return { ...entry, ts: nowTs() };
}

/** Recalcule le levier parent depuis son plan d'action : progression pondérée et agrégats
 * financiers/RH. Si le plan initial est déjà figé, les chiffres consolidés alimentent le
 * reforecast ; sinon ils alimentent directement les champs du levier. */
function recomputeLeverProgress(lever: Lever): Lever | undefined {
  const newProgress = engine.recomputeLeverProgress(lever);
  const consolidated = consolidateLeverFromActions(lever);
  const nextStatus =
    newProgress >= 100 && lever.status !== "cancelled" ? "delivered" : lever.status;
  const financialPatch: Partial<Lever> = consolidated
    ? lever.lockedPlan
      ? {
          reforecast: {
            grossSavings: consolidated.grossSavings ?? lever.grossSavings,
            netSavings: consolidated.netSavings ?? lever.netSavings,
            capex: consolidated.capex ?? lever.capex,
            opexOneOff: consolidated.opexOneOff ?? lever.opexOneOff,
            opexRec: consolidated.opexRec ?? lever.opexRec,
          },
          fteImpact: consolidated.fteImpact ?? lever.fteImpact,
        }
      : consolidated
    : {};
  const next: Lever = {
    ...lever,
    ...financialPatch,
    progress: newProgress,
    status: nextStatus,
    ...(nextStatus === "delivered" && !lever.deliveredDate ? { deliveredDate: nowDate() } : {}),
  };

  return JSON.stringify(next) === JSON.stringify(lever) ? undefined : next;
}

export type LeverMutationResult = {
  levers: Lever[];
  lever: Lever;
  auditEntries: AuditEntry[];
};

export function createLever(
  levers: Lever[],
  input: Omit<Lever, "id" | "createdAt" | "lastUpdate">,
  user: string
): LeverMutationResult {
  // `levers` (la liste passée par l'appelant) n'est déjà scopée qu'à l'entreprise courante, MAIS
  // le document Firestore "levers/{id}" n'a lui aucune notion de tenant dans son chemin : deux
  // entreprises dont chacune démarre avec 0 levier génèrent alors indépendamment le même "L001",
  // "L002"... et la seconde à écrire se voit refuser l'écriture par firestore.rules (l'id existe
  // déjà pour l'AUTRE entreprise, dont le `companyId` ne correspond pas). Préfixer par companyId
  // (quand il existe — legacy : un levier historique sans companyId garde le format nu "L001")
  // rend l'id globalement unique sans changer le format "lisible" `L\d+` que l'UI/les exports/les
  // tests s'attendent à trouver à la FIN de l'id (voir la regex ci-dessous, ancrée en fin de
  // chaîne plutôt qu'en début, pour rester compatible avec un id déjà préfixé).
  const maxNum = levers.reduce((max, l) => {
    const m = /L(\d+)$/.exec(l.id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  const seq = `L${String(maxNum + 1).padStart(3, "0")}`;
  const id = input.companyId ? `${input.companyId}-${seq}` : seq;
  const now = nowDate();
  const lever: Lever = applyPlanLock({ ...input, id, createdAt: now, lastUpdate: now });
  return {
    levers: [...levers, lever],
    lever,
    auditEntries: [
      makeAuditEntry({
        user,
        action: "created",
        entity: id,
        field: "lever",
        old: "",
        new: lever.name,
      }),
    ],
  };
}

export function updateLever(
  levers: Lever[],
  id: string,
  patch: Partial<Lever>,
  user: string
): LeverMutationResult {
  const idx = levers.findIndex((l) => l.id === id);
  if (idx === -1) throw new Error(`Lever "${id}" introuvable`);
  const before = levers[idx];

  // Cascade de validation (owner → sponsor → cto, voir requestLeverApproval/
  // approveLeverApprovalStep/rejectLeverApproval plus bas) : le SEUL chemin légitime vers
  // status="validated" est la dernière étape de la cascade (CTO), qui appelle CETTE fonction en
  // interne avec un patch qui touche AUSSI `approval` (pour le vider, cascade terminée) — c'est ce
  // qui distingue ce passage légitime d'un patch direct `{ status: "validated" }` venu d'ailleurs
  // (ex. un bouton de stepper qui court-circuiterait la cascade, un import). Dans ce dernier cas,
  // on ignore SILENCIEUSEMENT le seul champ `status` du patch plutôt que de lever une exception,
  // qui casserait d'autres usages légitimes du même appel (ex. modifier `progress` en même temps).
  // Les autres transitions de statut (idea↔qualified, in_progress, delivered, cancelled) ne sont
  // pas concernées par cette garde et restent librement modifiables par cette voie, comme avant.
  const bypassesApprovalCascade = "approval" in patch;
  let guardedPatch: Partial<Lever> = patch;
  if (patch.status === "validated" && before.status !== "validated" && !bypassesApprovalCascade) {
    guardedPatch = { ...patch };
    delete guardedPatch.status;
  }

  // Une fois le plan initial figé (L3+), les chiffres bruts ne sont plus modifiables par cette
  // voie — seule la réactualisation (patch.reforecast) l'est encore.
  const safePatch = before.lockedPlan
    ? {
        ...guardedPatch,
        grossSavings: before.grossSavings,
        netSavings: before.netSavings,
        opexOneOff: before.opexOneOff,
        opexRec: before.opexRec,
        capex: before.capex,
      }
    : guardedPatch;
  // Annulation : on capture l'étape du cycle de vie quittée, pour que le Sankey chronologique
  // puisse brancher le levier sans avoir à deviner l'étape via une heuristique sur `progress`.
  const cancelledPatch: Partial<Lever> =
    safePatch.status === "cancelled" && before.status !== "cancelled"
      ? { cancelledAtStage: before.status }
      : {};
  const after: Lever = applyPlanLock({
    ...before,
    ...safePatch,
    ...cancelledPatch,
    lastUpdate: nowDate(),
  });
  const nextLevers = [...levers];
  nextLevers[idx] = after;

  const auditEntries: AuditEntry[] = [];
  (Object.keys(safePatch) as (keyof Lever)[]).forEach((field) => {
    if (before[field] !== after[field]) {
      auditEntries.push(
        makeAuditEntry({
          user,
          action: "updated",
          entity: id,
          field: String(field),
          old: before[field] as string | number,
          new: after[field] as string | number,
        })
      );
    }
  });

  return { levers: nextLevers, lever: after, auditEntries };
}

export function upsertLeverByCode(
  levers: Lever[],
  input: Omit<Lever, "id" | "createdAt" | "lastUpdate">,
  user: string
): LeverMutationResult & { created: boolean } {
  const existing = levers.find((l) => l.code === input.code);
  if (existing) {
    return { ...updateLever(levers, existing.id, input, user), created: false };
  }
  return { ...createLever(levers, input, user), created: true };
}

/**
 * Cascade de validation du passage à l'étape "validated" (M3) : porteur du levier → sponsor du
 * workstream → CTO, dans cet ordre — voir `LeverApproval`/`LeverApprovalStep` (types/index.ts) et
 * le garde-fou correspondant dans `updateLever` ci-dessus. Design volontairement simple (pas de
 * configuration par entreprise) : seul le passage à "validated" est concerné, les autres
 * transitions de statut restent librement modifiables via `updateLever` comme avant.
 *
 * `requestLeverApproval` : initie la cascade — appelable uniquement par le porteur du levier
 * (`isLeverOwnedBy`) ou un admin, sur un levier au statut "qualified" (l'étape juste avant
 * "validated"). Le porteur, en demandant la validation, approuve implicitement sa propre étape
 * ("owner") — pas d'étape "owner" séparée à cliquer ensuite, `pendingStep` passe directement à
 * "sponsor".
 */
export function requestLeverApproval(
  levers: Lever[],
  id: string,
  user: Pick<AuthUser, "name" | "username" | "isGlobalAdmin" | "isCompanyAdmin">
): LeverMutationResult {
  const idx = levers.findIndex((l) => l.id === id);
  if (idx === -1) throw new Error(`Lever "${id}" introuvable`);
  const before = levers[idx];
  if (!isAnyAdmin(user) && !isLeverOwnedBy(before, user)) {
    throw new Error(
      `Seul le porteur du levier "${id}" (ou un admin) peut soumettre une demande de validation`
    );
  }
  if (before.status !== "qualified") {
    throw new Error(
      `Le levier "${id}" doit être au statut "qualified" pour soumettre une demande de validation`
    );
  }
  const now = new Date().toISOString();
  const approval: LeverApproval = {
    pendingStep: "sponsor",
    ownerApprovedAt: now,
    requestedBy: user.username,
    requestedAt: now,
  };
  const after: Lever = { ...before, approval };
  const nextLevers = [...levers];
  nextLevers[idx] = after;
  return {
    levers: nextLevers,
    lever: after,
    auditEntries: [
      makeAuditEntry({
        user: user.name,
        action: "approval_requested",
        entity: id,
        field: "approval",
        old: before.status,
        new: "pending:sponsor",
      }),
    ],
  };
}

/**
 * Franchit une étape de la cascade ("sponsor" ou "cto") — vérifie que `lever.approval.pendingStep`
 * correspond bien à `step` et que l'appelant y est habilité (sponsor du workstream du levier ou
 * admin pour "sponsor" ; `isLeverCtoOf` ou admin pour "cto"). À l'étape "cto" (dernière), la
 * cascade est terminée : `approval` est vidé et `status` passe à "validated" en réutilisant
 * `updateLever` (pour ne pas dupliquer `applyPlanLock`/l'audit "updated" sur d'éventuels autres
 * champs déjà en attente) — le patch inclut explicitement `approval: undefined`, ce qui est
 * précisément ce que le garde-fou de `updateLever` accepte comme passage légitime.
 */
export function approveLeverApprovalStep(
  levers: Lever[],
  id: string,
  step: Extract<LeverApprovalStep, "sponsor" | "cto">,
  user: Pick<AuthUser, "name" | "username" | "profiles" | "isGlobalAdmin" | "isCompanyAdmin">,
  workstreams: Pick<Workstream, "id" | "sponsorUsername">[]
): LeverMutationResult {
  const idx = levers.findIndex((l) => l.id === id);
  if (idx === -1) throw new Error(`Lever "${id}" introuvable`);
  const before = levers[idx];
  if (before.approval?.pendingStep !== step) {
    throw new Error(`Le levier "${id}" n'est pas en attente de validation à l'étape "${step}"`);
  }
  const workstreamSponsorUsername = workstreams.find((w) => w.id === before.ws)?.sponsorUsername;
  const authorized =
    isAnyAdmin(user) ||
    (step === "sponsor" && isLeverSponsoredBy(before, workstreamSponsorUsername, user)) ||
    (step === "cto" && isLeverCtoOf(before, user));
  if (!authorized) {
    throw new Error(`Vous n'êtes pas habilité à approuver l'étape "${step}" de ce levier`);
  }

  const now = new Date().toISOString();
  if (step === "sponsor") {
    const after: Lever = {
      ...before,
      approval: { ...before.approval, pendingStep: "cto", sponsorApprovedAt: now },
    };
    const nextLevers = [...levers];
    nextLevers[idx] = after;
    return {
      levers: nextLevers,
      lever: after,
      auditEntries: [
        makeAuditEntry({
          user: user.name,
          action: "approval_approved",
          entity: id,
          field: "approval",
          old: "pending:sponsor",
          new: "pending:cto",
        }),
      ],
    };
  }

  // step === "cto" : cascade terminée — pose ctoApprovedAt (informatif, l'objet est vidé juste
  // après) puis applique le vidage de `approval` et le passage à "validated" via `updateLever`.
  const ctoApprovedApproval: LeverApproval = { ...before.approval, ctoApprovedAt: now };
  const leversWithCtoStamp = [...levers];
  leversWithCtoStamp[idx] = { ...before, approval: ctoApprovedApproval };
  const result = updateLever(
    leversWithCtoStamp,
    id,
    { status: "validated", approval: undefined },
    user.name
  );
  return {
    ...result,
    auditEntries: [
      ...result.auditEntries,
      makeAuditEntry({
        user: user.name,
        action: "approval_approved",
        entity: id,
        field: "approval",
        old: "pending:cto",
        new: "validated",
      }),
    ],
  };
}

/**
 * Annule la cascade en cours — annulable par le porteur du levier, le sponsor OU le cto
 * actuellement en attente (`lever.approval.pendingStep`), ou un admin. Vide `lever.approval` :
 * retour à l'état "qualified" normal, sans pénalité (une nouvelle demande peut être soumise plus
 * tard via `requestLeverApproval`).
 */
export function rejectLeverApproval(
  levers: Lever[],
  id: string,
  user: Pick<AuthUser, "name" | "username" | "profiles" | "isGlobalAdmin" | "isCompanyAdmin">,
  reason?: string,
  workstreams: Pick<Workstream, "id" | "sponsorUsername">[] = []
): LeverMutationResult {
  const idx = levers.findIndex((l) => l.id === id);
  if (idx === -1) throw new Error(`Lever "${id}" introuvable`);
  const before = levers[idx];
  if (!before.approval) {
    throw new Error(`Le levier "${id}" n'a pas de demande de validation en cours`);
  }
  const pendingStep = before.approval.pendingStep;
  const workstreamSponsorUsername = workstreams.find((w) => w.id === before.ws)?.sponsorUsername;
  const authorized =
    isAnyAdmin(user) ||
    isLeverOwnedBy(before, user) ||
    (pendingStep === "sponsor" && isLeverSponsoredBy(before, workstreamSponsorUsername, user)) ||
    (pendingStep === "cto" && isLeverCtoOf(before, user));
  if (!authorized) {
    throw new Error(`Vous n'êtes pas habilité à rejeter la demande de validation de ce levier`);
  }
  const after: Lever = { ...before, approval: undefined };
  const nextLevers = [...levers];
  nextLevers[idx] = after;
  return {
    levers: nextLevers,
    lever: after,
    auditEntries: [
      makeAuditEntry({
        user: user.name,
        action: "approval_rejected",
        entity: id,
        field: "approval",
        old: pendingStep,
        new: reason ?? "",
      }),
    ],
  };
}

export type BulkLeverImportResult = {
  levers: Lever[];
  /** Un élément par levier du lot (créé ou mis à jour), déjà consolidé (plan d'action pris en
   *  compte) — ce qui doit être persisté tel quel en base. */
  changedLevers: Lever[];
  auditEntries: AuditEntry[];
  createdCount: number;
  updatedCount: number;
};

/**
 * Import Excel en masse (voir lib/leverExcelImport.ts) : crée/met à jour chaque levier par Code
 * (même règle que `upsertLeverByCode`), puis pose son plan d'action complet via `writeActions` —
 * qui recalcule la progression et consolide les agrégats financiers depuis les impacts, exactement
 * comme le ferait un utilisateur créant les actions une par une dans l'UI (voir
 * `recomputeLeverProgress`/`consolidateLeverFromActions`). Chaque levier du lot est traité
 * séquentiellement sur le même état accumulé, pour que les leviers plus haut dans le fichier
 * soient visibles (ex. comme cible de dépendance) aux suivants.
 */
export function bulkUpsertLeversByCode(
  levers: Lever[],
  inputs: Omit<Lever, "id" | "createdAt" | "lastUpdate">[],
  user: string
): BulkLeverImportResult {
  let curLevers = levers;
  const changedLevers: Lever[] = [];
  const auditEntries: AuditEntry[] = [];
  let createdCount = 0;
  let updatedCount = 0;

  for (const input of inputs) {
    // Le fichier d'import référence les dépendances par Code (colonne "Dépendances"), pas par id
    // Firestore (inconnu de l'auteur du fichier au moment de le remplir) — on résout ici contre
    // les leviers déjà upsertés dans CE lot + ceux déjà en base, avant écriture. Une dépendance
    // vers un levier qui n'apparaît que PLUS LOIN dans le même fichier reste non résolue (son id
    // n'est alloué qu'à son tour) : limitation documentée dans lib/leverExcelImport.ts.
    const resolvedDependencies = (input.dependencies ?? []).map((d) => {
      const target = curLevers.find((l) => l.code.toLowerCase() === d.targetId.toLowerCase());
      return target ? { ...d, targetId: target.id } : d;
    });
    const upsert = upsertLeverByCode(
      curLevers,
      { ...input, dependencies: resolvedDependencies },
      user
    );
    curLevers = upsert.levers;
    auditEntries.push(...upsert.auditEntries);
    if (upsert.created) createdCount++;
    else updatedCount++;

    const { levers: afterActions, changedLever } = writeActions(
      curLevers,
      { leverId: upsert.lever.id },
      input.actions ?? []
    );
    curLevers = afterActions;
    changedLevers.push(changedLever ?? upsert.lever);
  }

  return { levers: curLevers, changedLevers, auditEntries, createdCount, updatedCount };
}

export type ActionScope = { leverId: string };

export type ActionMutationResult = {
  levers: Lever[];
  changedLever?: Lever;
  action: LeverAction;
  auditEntries: AuditEntry[];
};

function readActions(levers: Lever[], scope: ActionScope): LeverAction[] {
  return levers.find((l) => l.id === scope.leverId)?.actions ?? [];
}

/** Applique le nouveau tableau d'actions sur le lever ciblé par `scope`, puis recalcule sa
 * progression. Retourne toujours le lever touché (même sans changement de progression) pour que
 * l'appelant persiste le nouveau plan d'action. Exportée (en plus de createAction/updateAction/
 * deleteAction, qui l'utilisent pour une seule action à la fois) pour `bulkUpsertLeversByCode`, qui
 * doit poser le plan d'action COMPLET d'un levier importé en une fois. */
export function writeActions(
  levers: Lever[],
  scope: ActionScope,
  actions: LeverAction[]
): { levers: Lever[]; changedLever?: Lever } {
  const idx = levers.findIndex((l) => l.id === scope.leverId);
  if (idx === -1) throw new Error(`Lever "${scope.leverId}" introuvable`);
  let nextLevers = [...levers];
  nextLevers[idx] = { ...levers[idx], actions };

  const lever = nextLevers[idx];
  const recomputed = recomputeLeverProgress(lever);
  const changedLever = recomputed ?? lever;
  if (recomputed) {
    nextLevers = nextLevers.map((l) => (l.id === recomputed.id ? recomputed : l));
  }

  return { levers: nextLevers, changedLever };
}

export function createAction(
  levers: Lever[],
  scope: ActionScope,
  input: Omit<LeverAction, "id">,
  user: string
): ActionMutationResult {
  const allIds = levers.flatMap((l) => l.actions?.map((a) => a.id) ?? []);
  const action: LeverAction = {
    ...input,
    id: nextEntityId("AC", allIds),
    ...(input.status === "done" && !input.deliveredDate ? { deliveredDate: nowDate() } : {}),
  };
  const currentActions = readActions(levers, scope);
  const result = writeActions(levers, scope, [...currentActions, action]);

  const auditEntries = [
    makeAuditEntry({
      user,
      action: "created",
      entity: scope.leverId,
      field: "action",
      old: "",
      new: action.name,
    }),
  ];

  return { ...result, action, auditEntries };
}

export function updateAction(
  levers: Lever[],
  scope: ActionScope,
  actionId: string,
  patch: Partial<LeverAction>,
  user: string
): ActionMutationResult {
  const actions = readActions(levers, scope);
  const idx = actions.findIndex((a) => a.id === actionId);
  if (idx === -1) throw new Error(`Action "${actionId}" introuvable`);
  const before = actions[idx];
  const deliveredDatePatch: Partial<LeverAction> =
    patch.status === "done" && before.status !== "done"
      ? { deliveredDate: patch.deliveredDate ?? nowDate() }
      : patch.status && patch.status !== "done"
        ? { deliveredDate: undefined }
        : {};
  const after = { ...before, ...patch, ...deliveredDatePatch };
  const nextActions = [...actions];
  nextActions[idx] = after;
  const result = writeActions(levers, scope, nextActions);

  const auditEntries = [
    makeAuditEntry({
      user,
      action: "updated",
      entity: scope.leverId,
      field: `action ${after.name}`,
      old: actions[idx].status,
      new: after.status,
    }),
  ];

  return { ...result, action: after, auditEntries };
}

export function deleteAction(
  levers: Lever[],
  scope: ActionScope,
  actionId: string
): { levers: Lever[]; changedLever?: Lever } {
  const actions = readActions(levers, scope).filter((a) => a.id !== actionId);
  return writeActions(levers, scope, actions);
}

export function applyCascadeShift(
  levers: Lever[],
  shifts: CascadeShift[],
  user: string
): {
  levers: Lever[];
  changedLevers: Lever[];
  auditEntries: AuditEntry[];
} {
  let curLevers = levers;
  const changedLevers: Lever[] = [];
  const auditEntries: AuditEntry[] = [];

  shifts.forEach((shift) => {
    const result = updateLever(
      curLevers,
      shift.id,
      { start: shift.newStart, end: shift.newEnd },
      user
    );
    curLevers = result.levers;
    changedLevers.push(result.lever);
    auditEntries.push(...result.auditEntries);
  });

  return { levers: curLevers, changedLevers, auditEntries };
}

export function addComment(
  comments: Record<string, Comment[]>,
  leverId: string,
  text: string,
  user: string
): { comments: Record<string, Comment[]>; leverComments: Comment[]; auditEntry: AuditEntry } {
  const comment: Comment = { user, ts: nowDate(), text };
  const leverComments = [...(comments[leverId] ?? []), comment];
  const nextComments = { ...comments, [leverId]: leverComments };
  const auditEntry = makeAuditEntry({
    user,
    action: "commented",
    entity: leverId,
    field: "comment",
    old: "",
    new: text,
  });
  return { comments: nextComments, leverComments, auditEntry };
}
