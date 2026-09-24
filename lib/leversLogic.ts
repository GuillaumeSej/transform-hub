import * as engine from "@/lib/engine";
import { consolidateLeverFromActions } from "@/lib/leverConsolidate";
import { migrateLeverImpacts } from "@/lib/leverImpactMigration";
import type { CascadeShift } from "@/lib/engine";
import { STATUS_ORDER, gatedStatusesFor, nextGateFor } from "@/lib/status-config";
import type {
  AuditEntry,
  AuthUser,
  Comment,
  FinancialSnapshot,
  Lever,
  ActionStatus,
  LeverStatus,
  LeverAction,
  LeverApproval,
  LeverApprovalGate,
  LifecycleStage,
  Role,
  Workstream,
} from "@/types";
import {
  getPerformanceProfiles,
  getStrategicProfiles,
  hasRole,
  isAnyAdmin,
} from "@/lib/roleProfiles";
import { accessibleLevels, normalizeClearanceLevel } from "@/lib/confidentiality";

/**
 * Résout la liste des niveaux de confidentialité auxquels un utilisateur non-admin a accès,
 * en appliquant la précédence : habilitation INDIVIDUELLE (AuthUser.confidentialityClearance)
 * prioritaire quand définie, sinon repli sur l'habilitation de son profil (Company.roleClearance).
 * Ne s'applique pas à un admin (global ou entreprise, accès total, géré par l'appelant en amont).
 *  - user.confidentialityClearance === "all"  -> accès à tous les niveaux
 *  - user.confidentialityClearance: string    -> ce niveau + tous les niveaux inférieurs
 *  - user.confidentialityClearance: []        -> aucun accès
 *  - user.confidentialityClearance: string[]  -> LEGACY, normalisé vers son niveau le plus haut
 *  - user.confidentialityClearance === undefined -> repli sur roleClearance[profil] (ou [])
 * `planType` précise QUELLE piste consulter pour ce repli (un utilisateur peut avoir un/des
 * profil(s) Plan Performance et un/des profil(s) Plan Stratégique distincts) — "performance" par
 * défaut, pour les appelants historiques (leviers du Plan de Performance).
 *
 * `orderedLevels` = `Company.confidentialityLevels` (du moins au plus restreint). Quand fourni,
 * la résolution est HIÉRARCHIQUE (voir `lib/confidentiality.ts`) : l'habilitation est ramenée à
 * un niveau unique (le plus haut), puis étendue à tous les niveaux inférieurs. Sans échelle
 * fournie, repli sur l'ancienne sémantique "liste exacte" (aucune expansion possible).
 *
 * Round multi-profils multi-programmes : un utilisateur peut désormais avoir PLUSIEURS profils
 * sur la piste concernée (un par programme, ex. "lever" sur programme A + "finance" sur programme
 * B) — le repli retient l'habilitation la plus permissive de TOUS ces profils (union / niveau max)
 * plutôt que de ne lire que le premier trouvé, pour ne pas amputer silencieusement l'accès d'un
 * des rôles cumulés. */
export function resolveConfidentialityClearance(
  user: Pick<AuthUser, "profiles" | "confidentialityClearance"> | null | undefined,
  roleClearance: Partial<Record<Role, string | string[]>> | undefined,
  planType: "performance" | "strategic" = "performance",
  orderedLevels?: string[]
): "all" | string[] {
  if (!user) return [];
  const override = user.confidentialityClearance;
  if (override === "all") return "all";
  let raw: string[];
  if (override !== undefined) {
    raw = Array.isArray(override) ? override : [override];
  } else {
    const profiles =
      planType === "strategic" ? getStrategicProfiles(user) : getPerformanceProfiles(user);
    const levels = new Set<string>();
    for (const profile of profiles) {
      const forRole = roleClearance?.[profile.role];
      if (forRole == null) continue;
      (Array.isArray(forRole) ? forRole : [forRole]).forEach((level) => levels.add(level));
    }
    raw = Array.from(levels);
  }
  if (!orderedLevels || orderedLevels.length === 0) return raw;
  return accessibleLevels(normalizeClearanceLevel(raw, orderedLevels), orderedLevels);
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
 *  voit un levier soit parce qu'il sponsorise le workstream parent (`workstream`,
 *  résolu par l'appelant depuis `Workstream.sponsorUsername`), soit parce qu'il est identifié
 *  individuellement comme sponsor du levier (`lever.sponsorUsername`, priorité au lien id-based si
 *  réconcilié, repli sur la comparaison de noms fragile sinon — mêmes règles que `owner`). */
export function isLeverSponsoredBy(
  lever: Pick<Lever, "sponsor" | "sponsorUsername">,
  /** Workstream parent (ou directement son `sponsorUsername`, forme historique). Un workstream
   *  sans `sponsorUsername` (sponsor saisi en texte, jamais rattaché à un compte — cas des données
   *  ACME) est reconnu par son NOM, comme `lever.sponsor` ci-dessous : sinon ses vrais sponsors ne
   *  voyaient aucun levier de leur chantier. */
  workstream: string | (Pick<Workstream, "sponsorUsername"> & { sponsor?: string }) | undefined,
  user: Pick<AuthUser, "name" | "username">
): boolean {
  const ws = typeof workstream === "string" ? { sponsorUsername: workstream } : workstream;
  if (ws?.sponsorUsername) {
    if (ws.sponsorUsername === user.username) return true;
  } else if (ws && "sponsor" in ws && ws.sponsor) {
    if (normalizeOwnerName(ws.sponsor) === normalizeOwnerName(user.name)) return true;
  }
  if (lever.sponsorUsername) return lever.sponsorUsername === user.username;
  return normalizeOwnerName(lever.sponsor) === normalizeOwnerName(user.name);
}

/** Même principe qu'`isLeverOwnedBy`/`isLeverSponsoredBy`, pour le rôle "cto" — utilisé par la
 *  validation d'une porte du cycle de vie (`approveLeverGate`, voir plus bas). Un
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
  roleClearance: Partial<Record<Role, string | string[]>> | undefined,
  workstreams: (Pick<Workstream, "id" | "sponsorUsername"> & { sponsor?: string })[] = [],
  /** `Company.confidentialityLevels` — active la résolution hiérarchique (voir
   *  `resolveConfidentialityClearance`). */
  confidentialityLevels?: string[]
): boolean {
  return (
    leverAccessDenialReason(user, lever, roleClearance, workstreams, confidentialityLevels) === null
  );
}

/** Motif pour lequel `user` ne peut pas voir `lever` (`null` = accès autorisé) — mêmes règles que
 *  `canUserViewLever`, qui l'utilise. Distinguer le motif permet d'afficher un message juste :
 *  un porteur qui n'est pas responsable du levier voyait « niveau de confidentialité « » »
 *  (vide) alors que le levier n'était simplement pas dans son périmètre. */
export type LeverAccessDenialReason = "no_user" | "other_company" | "perimeter" | "confidentiality";

export function leverAccessDenialReason(
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
  roleClearance: Partial<Record<Role, string | string[]>> | undefined,
  workstreams: (Pick<Workstream, "id" | "sponsorUsername"> & { sponsor?: string })[] = [],
  /** `Company.confidentialityLevels` — active la résolution hiérarchique (voir
   *  `resolveConfidentialityClearance`). */
  confidentialityLevels?: string[]
): LeverAccessDenialReason | null {
  if (!user) return "no_user";
  if (user.isGlobalAdmin) return null;
  if (lever.companyId != null && user.companyId !== lever.companyId) return "other_company";
  if (user.isCompanyAdmin) return null;
  if (hasRole(user, "lever") && !isLeverOwnedBy(lever, user)) return "perimeter";
  if (hasRole(user, "sponsor")) {
    const workstream = workstreams.find((w) => w.id === lever.ws);
    if (!isLeverSponsoredBy(lever, workstream, user)) return "perimeter";
  }
  return isLeverVisibleForClearance(
    lever.confidentialityLevel,
    resolveConfidentialityClearance(user, roleClearance, "performance", confidentialityLevels)
  )
    ? null
    : "confidentiality";
}

/** Leviers visibles sur les vues d'AGRÉGATION du Plan Performance (dashboard exécutif, page
 *  Finance, page Workstreams) — règle UNIQUE pour que leurs totaux se recoupent (audit M2 : la page
 *  Finance chargeait tous les leviers de l'entreprise) : admin → tout ; sinon, habilitation de
 *  confidentialité (`resolveConfidentialityClearance` + `isLeverVisibleForClearance`). */
export function filterAggregateVisibleLevers<T extends Pick<Lever, "confidentialityLevel">>(
  levers: T[],
  user:
    | Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin" | "confidentialityClearance">
    | null
    | undefined,
  company:
    | { roleClearance?: Partial<Record<Role, string | string[]>>; confidentialityLevels?: string[] }
    | null
    | undefined
): T[] {
  if (isAnyAdmin(user)) return levers;
  const clearance = resolveConfidentialityClearance(
    user,
    company?.roleClearance,
    "performance",
    company?.confidentialityLevels
  );
  return levers.filter((l) => isLeverVisibleForClearance(l.confidentialityLevel, clearance));
}

/** Leviers du périmètre programme affiché — même règle que le dashboard exécutif : vue consolidée
 *  → leviers de tous les programmes consolidés ; sinon leviers du programme sélectionné
 *  (`programId` strictement égal ; aucun programme sélectionné → aucun levier). */
export function filterProgramScopedLevers<T extends Pick<Lever, "programId">>(
  levers: T[],
  scope: {
    programId: string | null | undefined;
    isConsolidatedView?: boolean;
    consolidatedProgramIds?: string[];
  }
): T[] {
  if (scope.isConsolidatedView) {
    const ids = new Set(scope.consolidatedProgramIds ?? []);
    return levers.filter((l) => !!l.programId && ids.has(l.programId));
  }
  if (!scope.programId) return [];
  return levers.filter((l) => l.programId === scope.programId);
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
  | "actions"
>;

/** Fige le snapshot financier d'un levier (audit issue #5, "Plan initial" faux/ne correspondant
 *  pas aux lignes d'impact — parfois seulement au CAPEX). Root cause : ce snapshot copiait
 *  auparavant les champs bruts du levier (`entity.grossSavings`/`netSavings`/…) tels quels — or
 *  pour un levier DÉJÀ piloté par un plan d'actions chiffré au moment du gel (import Excel, seed
 *  démo, création directe à un statut avancé), ces champs bruts ne sont pas garantis d'avoir été
 *  synchronisés avec les impacts d'actions avant l'appel à `applyPlanLock` — le gel figeait alors
 *  définitivement une valeur fausse (`updateLever` interdit toute correction ultérieure des champs
 *  bruts une fois `lockedPlan` posé). On consolide donc désormais depuis les impacts d'actions en
 *  priorité quand ils existent, pour figer le VRAI plan initial dès le premier verrouillage. */
function snapshot(entity: PlanLockable): FinancialSnapshot {
  const consolidated = consolidateLeverFromActions(entity as Lever);
  if (consolidated) {
    return {
      grossSavings: consolidated.grossSavings ?? entity.grossSavings,
      netSavings: consolidated.netSavings ?? entity.netSavings,
      opexOneOff: consolidated.opexOneOff ?? entity.opexOneOff,
      opexRec: consolidated.opexRec ?? entity.opexRec,
      capex: consolidated.capex ?? entity.capex,
    };
  }
  return {
    grossSavings: entity.grossSavings,
    netSavings: entity.netSavings,
    opexOneOff: entity.opexOneOff,
    opexRec: entity.opexRec,
    capex: entity.capex,
  };
}

/** Fige le plan initial dès le passage à l'étape "qualified" (UI "Validé", M2 — une seule fois),
 * puis initialise la réactualisation dès le passage à l'étape "in_progress" (une seule fois, sur
 * la base du plan figé). Ne fait rien si déjà figé/initialisé, ou si le statut n'atteint pas ces
 * paliers. Le gel se fait à "qualified" et non "validated" : une fois le projet validé (M2), le
 * gain estimé devient le "planifié original" de référence — "validated" (M3, UI "Planifié")
 * concerne la validation du PLAN D'ACTION, pas celle du projet lui-même. */
export function applyPlanLock<T extends PlanLockable>(entity: T): T {
  let next = entity;
  if (!next.lockedPlan && STATUS_ORDER[next.status] >= STATUS_ORDER.qualified) {
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

/** Recalcule les champs financiers du levier depuis ses impacts (source de vérité unique) :
 *  grossSavings/netSavings/opexOneOff/opexRec/capex/fteImpact. Sans impact, les macro-valeurs
 *  manuelles sont conservées. Si `refreshReforecast` et qu'un reforecast existe, il est aligné sur
 *  les impacts (le plan figé `lockedPlan` n'est JAMAIS touché). Migre au passage d'éventuels
 *  impacts encore portés par les actions. */
export function withImpactTotals(lever: Lever, refreshReforecast = false): Lever {
  const migrated = migrateLeverImpacts(lever);
  const consolidated = consolidateLeverFromActions(migrated);
  if (!consolidated) return migrated;
  const financial = {
    grossSavings: consolidated.grossSavings ?? 0,
    netSavings: consolidated.netSavings ?? 0,
    opexOneOff: consolidated.opexOneOff ?? 0,
    opexRec: consolidated.opexRec ?? 0,
    capex: consolidated.capex ?? 0,
  };
  return {
    ...migrated,
    ...financial,
    fteImpact: consolidated.fteImpact ?? 0,
    ...(refreshReforecast && migrated.reforecast ? { reforecast: financial } : {}),
  };
}

/** Vrai si le levier n'a aucune action (rien à évaluer) ou si TOUTES sont à 100 %. Pur. */
export function allActionsDone(lever: Pick<Lever, "actions">): boolean {
  const actions = lever.actions ?? [];
  return actions.every((a) => engine.actionProgressPct(a) >= 100);
}

/** Règle du statut « Réalisé » (clé "delivered", stade 5 ; libellé configurable par entreprise) :
 *  impossible tant que toutes les actions ne sont pas faites → « Exécuté » ("in_progress").
 *  Renvoie le statut effectif à appliquer. Pur. */
export function enforceDeliveredRule(lever: Pick<Lever, "actions" | "status">): LeverStatus {
  return lever.status === "delivered" && !allActionsDone(lever) ? "in_progress" : lever.status;
}

/** Recalcule le levier parent depuis son plan d'action : avancement (pondéré, actions uniquement),
 *  `lastUpdate`, passage automatique à "delivered" à 100 %. Retourne TOUJOURS le levier à
 *  persister (avec `lastUpdate` rafraîchi).
 *
 *  Passage automatique à « Réalisé » (audit B1) : UNIQUEMENT depuis « Exécuté » (`in_progress`,
 *  M4) — la seule transition du cycle qui n'est pas une porte de validation. Avant, un levier
 *  « Identifié »/« Validé »/« Planifié » dont les actions atteignaient 100 % sautait directement
 *  à « Réalisé », court-circuitant les portes sponsor/CTO (`approveLeverGate`) sans jamais figer
 *  son plan initial. Tout changement de statut repasse par `applyPlanLock` (plan figé +
 *  réactualisation initialisée si le palier est atteint). */
function recomputeLeverProgress(lever: Lever): Lever {
  const base = withImpactTotals(lever);
  const newProgress = engine.recomputeLeverProgress(base);
  let nextStatus: LeverStatus =
    newProgress >= 100 && base.status === "in_progress" && (base.actions?.length ?? 0) > 0
      ? "delivered"
      : base.status;
  // Règle : « Réalisé » (delivered) exige TOUTES les actions faites ; sinon retombe à « Exécuté ».
  if (nextStatus === "delivered" && !allActionsDone(base)) nextStatus = "in_progress";
  const next: Lever = {
    ...base,
    progress: newProgress,
    status: nextStatus,
    lastUpdate: nowDate(),
    ...(nextStatus === "delivered" && !base.deliveredDate ? { deliveredDate: nowDate() } : {}),
  };
  return nextStatus !== base.status ? applyPlanLock(next) : next;
}

/** Règle avancement → statut d'une action (pur). `pct` est borné à 0-100. 100 → "done"
 *  (Réalisé) ; >0 sur une action "todo" → "in_progress" ; quitter 100 → repasse "in_progress". */
export function applyActionProgress(action: LeverAction, pct: number): LeverAction {
  const clamped = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  const next: LeverAction = { ...action, declaredProgressPct: clamped };
  if (clamped >= 100) {
    next.status = "done";
    next.deliveredDate = action.deliveredDate ?? nowDate();
  } else {
    if (action.status === "done") next.status = "in_progress";
    if (action.status === "todo" && clamped > 0) next.status = "in_progress";
    if (next.status !== "done") delete next.deliveredDate;
  }
  return next;
}

/** Règle statut → avancement d'une action (pur) : "done" → 100 ; "todo" → 0 ; "in_progress"
 *  depuis 0/100 efface l'avancement déclaré (retour au défaut statut) ; "delayed" le conserve. */
export function applyActionStatus(action: LeverAction, status: ActionStatus): LeverAction {
  const next: LeverAction = { ...action, status };
  if (status === "done") {
    next.declaredProgressPct = 100;
    next.deliveredDate = action.deliveredDate ?? nowDate();
    return next;
  }
  delete next.deliveredDate;
  if (status === "todo") next.declaredProgressPct = 0;
  else if (
    status === "in_progress" &&
    (action.declaredProgressPct === 0 || action.declaredProgressPct === 100)
  ) {
    delete next.declaredProgressPct;
  }
  return next;
}

/** Après verrouillage du plan : aligne le reforecast sur les impacts (création, ou impacts
 *  modifiés) — le `lockedPlan` n'est jamais modifié. */
function finalizeImpacts(lever: Lever, refresh: boolean): Lever {
  if (!refresh || !lever.reforecast || !(lever.impacts && lever.impacts.length > 0)) return lever;
  return withImpactTotals(lever, true);
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
  const lever: Lever = finalizeImpacts(
    applyPlanLock(withImpactTotals({ ...input, id, createdAt: now, lastUpdate: now })),
    true
  );
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

export type LeverWorkflowOptions = {
  /** Référentiel de cycle de vie du programme du levier : seules les étapes dont l'admin a coché
   *  « validation requise » sont des portes (voir `gatedStatusesFor`). Omis = les 3 portes
   *  historiques (qualified/validated/in_progress). */
  lifecycleStages?: LifecycleStage[];
};

export function updateLever(
  levers: Lever[],
  id: string,
  patch: Partial<Lever>,
  user: string,
  options: LeverWorkflowOptions = {}
): LeverMutationResult {
  const idx = levers.findIndex((l) => l.id === id);
  if (idx === -1) throw new Error(`Lever "${id}" introuvable`);
  const before = levers[idx];

  // Portes de validation (porteur → sponsor OU cto, voir requestLeverApproval/approveLeverGate/
  // rejectLeverApproval plus bas) : le SEUL chemin légitime vers l'un des 3 statuts protégés
  // ("qualified" M2, "validated" M3, "in_progress" M4 — voir `LeverApprovalGate`) est
  // `approveLeverGate`, qui appelle CETTE fonction en interne avec un patch qui touche AUSSI
  // `approval` (pour le vider, porte franchie) — c'est ce qui distingue ce passage légitime d'un
  // patch direct `{ status: "qualified" }` venu d'ailleurs (ex. un bouton de stepper qui
  // court-circuiterait la validation, un import). Dans ce dernier cas, on ignore SILENCIEUSEMENT
  // le seul champ `status` du patch plutôt que de lever une exception, qui casserait d'autres
  // usages légitimes du même appel (ex. modifier `progress` en même temps). Les autres
  // transitions de statut (idea, delivered, cancelled) ne sont pas concernées par cette garde et
  // restent librement modifiables par cette voie, comme avant.
  // Portes effectives : case « validation requise » du référentiel de cycle de vie (admin), sinon
  // les 3 portes historiques quand l'appelant ne fournit pas de référentiel.
  const GATED_STATUSES: readonly LeverApprovalGate[] = gatedStatusesFor(options.lifecycleStages);
  const bypassesApprovalCascade = "approval" in patch;
  let guardedPatch: Partial<Lever> = patch;
  // Une porte est franchie si elle se situe entre le statut de départ (exclu) et la cible
  // (incluse) : viser une étape au-delà d'une porte (ex. « Identifié » → « Planifié » quand seule
  // « Validé » exige une validation, ou « Planifié » → « Réalisé ») ne la contourne pas.
  const crossesGate =
    !!patch.status &&
    patch.status !== before.status &&
    patch.status !== "cancelled" &&
    GATED_STATUSES.some(
      (gate) =>
        STATUS_ORDER[gate] > STATUS_ORDER[before.status] &&
        STATUS_ORDER[gate] <= STATUS_ORDER[patch.status as LeverStatus]
    );
  if (crossesGate && !bypassesApprovalCascade) {
    guardedPatch = { ...patch };
    delete guardedPatch.status;
  }

  // Garde anti-régression (impératif métier) : une fois une étape du cycle M1→M5 franchie, on ne
  // peut plus JAMAIS revenir en arrière (ex. cliquer "Identifié" sur un levier déjà en M3 depuis
  // le stepper de la fiche détail — voir `LeverDetailClientPerformance.tsx`, dont le seul garde-fou
  // était visuel, aucune protection côté données). `STATUS_ORDER` place "cancelled" hors cycle
  // (valeur 0) : l'abandon/la réactivation d'un levier annulé restent volontairement exclus de
  // cette règle (ce n'est pas une régression de maturité, c'est un branchement à part). S'applique
  // à TOUT appelant de `updateLever` (pas seulement le stepper), y compris `approveLeverGate`
  // (qui ne fait de toute façon jamais régresser un statut).
  if (
    guardedPatch.status &&
    guardedPatch.status !== before.status &&
    before.status !== "cancelled" &&
    guardedPatch.status !== "cancelled" &&
    STATUS_ORDER[guardedPatch.status] < STATUS_ORDER[before.status]
  ) {
    if (guardedPatch === patch) guardedPatch = { ...patch };
    delete guardedPatch.status;
  }

  // Un levier ABANDONNÉ ne peut pas passer directement à « Réalisé » : il doit d'abord être
  // réactivé dans le cycle (sinon il serait compté réalisé sans avoir jamais été exécuté).
  if (guardedPatch.status === "delivered" && before.status === "cancelled") {
    if (guardedPatch === patch) guardedPatch = { ...patch };
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
  const deliveredBlocked =
    safePatch.status === "delivered" &&
    before.status !== "delivered" &&
    !allActionsDone({
      actions: ("actions" in safePatch ? safePatch.actions : before.actions) ?? [],
    });
  const impactsPatched = "impacts" in safePatch || "actions" in safePatch;
  const merged: Lever = {
    ...before,
    ...safePatch,
    ...(deliveredBlocked ? { status: before.status } : {}),
    ...cancelledPatch,
    lastUpdate: nowDate(),
  };
  // Impacts = source de vérité : les macro-valeurs (et le reforecast si impacts modifiés) sont
  // recalculées ; le plan figé, lui, reste intact. L'avancement suit toujours les actions.
  let after: Lever = applyPlanLock(withImpactTotals(merged));
  after = finalizeImpacts(after, impactsPatched);
  if ("actions" in safePatch) {
    const progressed = recomputeLeverProgress(after);
    after = { ...after, progress: progressed.progress, status: progressed.status };
    if (progressed.deliveredDate) after.deliveredDate = progressed.deliveredDate;
  }
  // Passage à « Réalisé » (direct ou via le plan d'action) : date de réalisation posée si absente
  // (le P&L et la courbe en S datent le réalisé à `deliveredDate`).
  if (after.status === "delivered" && before.status !== "delivered" && !after.deliveredDate) {
    after = { ...after, deliveredDate: nowDate() };
  }
  // Tout changement de statut (y compris celui produit par le plan d'action) repasse par le gel.
  if (after.status !== before.status) after = applyPlanLock(after);
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

/** Clé de rapprochement d'un Code levier (import/upsert) : insensible à la casse et aux espaces de
 *  bord — même règle que l'aperçu d'import (audit M1 : l'aperçu matchait "proc-001" sur
 *  "PROC-001" mais l'écriture, sensible à la casse, créait un doublon). */
export function normalizeLeverCode(code: string | undefined | null): string {
  return (code ?? "").trim().toLowerCase();
}

function isEmptyish(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Égalité profonde « métier » pour l'import : `undefined`/`null`/`""`/`[]` équivalents, nombres à
 *  1e-9 près, propriétés `undefined` ignorées. Sert à ne pas réécrire un levier inchangé (M2). */
export function importValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isEmptyish(a) && isEmptyish(b)) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => importValueEqual(x, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao).concat(Object.keys(bo).filter((k) => !(k in ao)));
  for (const k of keys) if (!importValueEqual(ao[k], bo[k])) return false;
  return true;
}

/** Champs jamais modifiés par un import : identité/rattachement (`companyId` — M12 : un admin
 *  global sans entreprise active écrasait sinon le rattachement par `null`) et champs pilotés par
 *  les workflows (validation, plan figé, réactualisation, habilitation, arborescences). L'aperçu
 *  d'import recopie ces champs depuis le levier existant ; les ignorer ici évite de réécrire une
 *  valeur périmée si le levier a changé entre l'aperçu et la confirmation. */
const IMPORT_IGNORED_KEYS: ReadonlySet<string> = new Set([
  "id",
  "createdAt",
  "lastUpdate",
  "companyId",
  "approval",
  "lockedPlan",
  "reforecast",
  "cancelledAtStage",
  "deliveredDate",
  "confidentialityLevel",
  "hierarchyLeafId",
  "geographyLeafId",
  "workstreamWeightPct",
  "sponsorUsername",
]);

/** Patch réellement nécessaire pour amener `existing` vers `input` (import Excel) : seuls les
 *  champs qui DIFFÈRENT sont retenus (hors `IMPORT_IGNORED_KEYS`) ; `code` n'est pas réécrit s'il
 *  ne diffère que par la casse. Patch vide = levier inchangé. */
export function leverImportPatch(
  existing: Lever,
  input: Partial<Omit<Lever, "id" | "createdAt" | "lastUpdate">>
): Partial<Lever> {
  const patch: Partial<Lever> = {};
  for (const key of Object.keys(input) as (keyof Lever)[]) {
    if (IMPORT_IGNORED_KEYS.has(key)) continue;
    if (key === "code" && normalizeLeverCode(input.code) === normalizeLeverCode(existing.code)) {
      continue;
    }
    if (!importValueEqual(input[key as keyof typeof input], existing[key])) {
      (patch as Record<string, unknown>)[key] = input[key as keyof typeof input];
    }
  }
  return patch;
}

export function upsertLeverByCode(
  levers: Lever[],
  input: Omit<Lever, "id" | "createdAt" | "lastUpdate">,
  user: string
): LeverMutationResult & { created: boolean; unchanged?: boolean } {
  const key = normalizeLeverCode(input.code);
  const existing = levers.find((l) => normalizeLeverCode(l.code) === key);
  if (existing) {
    const patch = leverImportPatch(existing, input);
    // M2 : ré-import sans changement = aucune écriture, aucune entrée d'audit.
    if (Object.keys(patch).length === 0) {
      return { levers, lever: existing, auditEntries: [], created: false, unchanged: true };
    }
    const result = updateLever(levers, existing.id, patch, user);
    // M2 : `updateLever` réaligne la réactualisation dès que `actions` est dans le patch ; à
    // l'import, on ne la rafraîchit que si les IMPACTS ont réellement changé.
    if (
      !("impacts" in patch) &&
      existing.reforecast &&
      result.lever.reforecast !== existing.reforecast
    ) {
      const lever = { ...result.lever, reforecast: existing.reforecast };
      return {
        ...result,
        levers: result.levers.map((l) => (l.id === lever.id ? lever : l)),
        lever,
        created: false,
      };
    }
    return { ...result, created: false };
  }
  return { ...createLever(levers, input, user), created: true };
}

/**
 * Validation du passage de l'une des 3 portes du cycle de vie — "qualified" (M2, UI "Validé"),
 * "validated" (M3, UI "Planifié") ou "in_progress" (M4, UI "Exécuté") — voir `LeverApproval`/
 * `LeverApprovalGate` (types/index.ts) et le garde-fou correspondant dans `updateLever`
 * ci-dessus. M4→M5 ("delivered") reste libre, atteint automatiquement à 100% du plan d'action.
 * Design volontairement simple (pas de configuration par entreprise) : seules ces 3 portes sont
 * concernées, les autres transitions de statut restent librement modifiables via `updateLever`
 * comme avant.
 *
 * Modèle à approbateur UNIQUE (pas de cascade séquentielle) : le porteur du levier soumet la
 * demande, puis SOIT le sponsor du workstream SOIT le CTO l'approuve — le premier des deux à
 * agir ferme la porte, sans attendre l'autre.
 *
 * `requestLeverApproval` : appelable uniquement par le porteur du levier (`isLeverOwnedBy`) ou un
 * admin, depuis le statut juste avant la porte concernée (`idea` → porte "qualified", `qualified`
 * → porte "validated", `validated` → porte "in_progress" — voir `GATE_BY_STATUS`,
 * lib/status-config.ts).
 */
export function requestLeverApproval(
  levers: Lever[],
  id: string,
  user: Pick<AuthUser, "name" | "username" | "isGlobalAdmin" | "isCompanyAdmin">,
  options: LeverWorkflowOptions = {}
): LeverMutationResult {
  const idx = levers.findIndex((l) => l.id === id);
  if (idx === -1) throw new Error(`Lever "${id}" introuvable`);
  const before = levers[idx];
  if (!isAnyAdmin(user) && !isLeverOwnedBy(before, user)) {
    throw new Error(
      `Seul le porteur du levier "${id}" (ou un admin) peut soumettre une demande de validation`
    );
  }
  const targetStatus = nextGateFor(before.status, options.lifecycleStages);
  if (!targetStatus) {
    throw new Error(
      `Le levier "${id}" ne peut pas être soumis à validation depuis le statut "${before.status}"`
    );
  }
  const now = new Date().toISOString();
  const approval: LeverApproval = {
    targetStatus,
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
        new: `pending:${targetStatus}`,
      }),
    ],
  };
}

/**
 * Approuve la demande de validation en cours — vérifie que l'appelant est habilité (sponsor du
 * workstream du levier, OU `isLeverCtoOf`, OU admin — un seul des deux rôles métier suffit).
 * Ferme directement la porte : `approval` est vidé et `status` passe à `approval.targetStatus`
 * en réutilisant `updateLever` (pour ne pas dupliquer `applyPlanLock`/l'audit "updated" sur
 * d'éventuels autres champs déjà en attente) — le patch inclut explicitement `approval:
 * undefined`, ce qui est précisément ce que le garde-fou de `updateLever` accepte comme passage
 * légitime.
 */
export function approveLeverGate(
  levers: Lever[],
  id: string,
  user: Pick<AuthUser, "name" | "username" | "profiles" | "isGlobalAdmin" | "isCompanyAdmin">,
  workstreams: (Pick<Workstream, "id" | "sponsorUsername"> & { sponsor?: string })[]
): LeverMutationResult {
  const idx = levers.findIndex((l) => l.id === id);
  if (idx === -1) throw new Error(`Lever "${id}" introuvable`);
  const before = levers[idx];
  if (!before.approval) {
    throw new Error(`Le levier "${id}" n'a pas de demande de validation en cours`);
  }
  const parentWorkstream = workstreams.find((w) => w.id === before.ws);
  const isSponsor = isLeverSponsoredBy(before, parentWorkstream, user);
  const isCto = isLeverCtoOf(before, user);
  if (!isAnyAdmin(user) && !isSponsor && !isCto) {
    throw new Error(`Vous n'êtes pas habilité à approuver la demande de validation de ce levier`);
  }

  const now = new Date().toISOString();
  const targetStatus = before.approval.targetStatus;
  const approvedApproval: LeverApproval = {
    ...before.approval,
    approvedBy: user.username,
    approvedByRole: isSponsor ? "sponsor" : isCto ? "cto" : undefined,
    approvedAt: now,
  };
  const leversWithStamp = [...levers];
  leversWithStamp[idx] = { ...before, approval: approvedApproval };
  const result = updateLever(
    leversWithStamp,
    id,
    { status: targetStatus, approval: undefined },
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
        old: `pending:${targetStatus}`,
        new: targetStatus,
      }),
    ],
  };
}

/**
 * Annule la demande en cours — annulable par le porteur du levier, le sponsor du workstream, le
 * CTO, ou un admin. Vide `lever.approval` : le levier reste à son statut de départ, sans
 * pénalité (une nouvelle demande peut être soumise plus tard via `requestLeverApproval`).
 */
export function rejectLeverApproval(
  levers: Lever[],
  id: string,
  user: Pick<AuthUser, "name" | "username" | "profiles" | "isGlobalAdmin" | "isCompanyAdmin">,
  reason?: string,
  workstreams: (Pick<Workstream, "id" | "sponsorUsername"> & { sponsor?: string })[] = []
): LeverMutationResult {
  const idx = levers.findIndex((l) => l.id === id);
  if (idx === -1) throw new Error(`Lever "${id}" introuvable`);
  const before = levers[idx];
  if (!before.approval) {
    throw new Error(`Le levier "${id}" n'a pas de demande de validation en cours`);
  }
  const targetStatus = before.approval.targetStatus;
  const parentWorkstream = workstreams.find((w) => w.id === before.ws);
  const authorized =
    isAnyAdmin(user) ||
    isLeverOwnedBy(before, user) ||
    isLeverSponsoredBy(before, parentWorkstream, user) ||
    isLeverCtoOf(before, user);
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
        old: `pending:${targetStatus}`,
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
  /** Leviers existants strictement identiques au fichier : ni écrits, ni audités (M2). */
  unchangedCount: number;
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
  let unchangedCount = 0;

  for (const input of inputs) {
    // Le fichier d'import référence les dépendances par Code (colonne "Dépendances"), pas par id
    // Firestore (inconnu de l'auteur du fichier au moment de le remplir) — on résout ici contre
    // les leviers déjà upsertés dans CE lot + ceux déjà en base, avant écriture. Une dépendance
    // vers un levier qui n'apparaît que PLUS LOIN dans le même fichier reste non résolue (son id
    // n'est alloué qu'à son tour) : limitation documentée dans lib/leverExcelImport.ts.
    const resolvedDependencies = (input.dependencies ?? []).map((d) => {
      const target = curLevers.find(
        (l) => normalizeLeverCode(l.code) === normalizeLeverCode(d.targetId)
      );
      return target ? { ...d, targetId: target.id } : d;
    });
    const before = curLevers.find(
      (l) => normalizeLeverCode(l.code) === normalizeLeverCode(input.code)
    );
    const upsert = upsertLeverByCode(
      curLevers,
      { ...input, dependencies: resolvedDependencies },
      user
    );
    if (upsert.unchanged) {
      unchangedCount++;
      continue;
    }
    curLevers = upsert.levers;
    auditEntries.push(...upsert.auditEntries);
    if (upsert.created) createdCount++;
    else updatedCount++;

    // Plan d'action inchangé : `updateLever` a déjà tout recalculé, pas de réécriture des actions.
    if (before && importValueEqual(input.actions ?? [], before.actions ?? [])) {
      changedLevers.push(upsert.lever);
      continue;
    }
    const { levers: afterActions, changedLever } = writeActions(
      curLevers,
      { leverId: upsert.lever.id },
      input.actions ?? []
    );
    curLevers = afterActions;
    changedLevers.push(changedLever ?? upsert.lever);
  }

  return {
    levers: curLevers,
    changedLevers,
    auditEntries,
    createdCount,
    updatedCount,
    unchangedCount,
  };
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
  const nextLevers = [...levers];
  // Toute mutation d'actions recalcule ET persiste l'avancement du levier (+ lastUpdate) ; les
  // éventuels impacts portés par les actions importées sont remontés au niveau levier.
  const hadLegacyImpacts = actions.some((a) => (a.impacts?.length ?? 0) > 0);
  let lever = recomputeLeverProgress({ ...levers[idx], actions });
  if (hadLegacyImpacts) lever = finalizeImpacts(lever, true);
  nextLevers[idx] = lever;
  return { levers: nextLevers, changedLever: lever };
}

export function createAction(
  levers: Lever[],
  scope: ActionScope,
  input: Omit<LeverAction, "id">,
  user: string
): ActionMutationResult {
  const allIds = levers.flatMap((l) => l.actions?.map((a) => a.id) ?? []);
  const draft: LeverAction = { ...input, id: nextEntityId("AC", allIds) };
  const action: LeverAction =
    input.declaredProgressPct !== undefined
      ? applyActionProgress(draft, input.declaredProgressPct)
      : input.status === "done"
        ? applyActionStatus(draft, "done")
        : draft;
  if (input.status === "done" && input.deliveredDate) action.deliveredDate = input.deliveredDate;
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
  // Règles statut <-> avancement (voir applyActionStatus/applyActionProgress). Si le patch fixe
  // explicitement les deux, on les respecte tels quels.
  let after: LeverAction;
  const hasStatus = patch.status !== undefined && patch.status !== before.status;
  const hasPct = patch.declaredProgressPct !== undefined;
  if (hasPct && !hasStatus) {
    after = applyActionProgress({ ...before, ...patch }, patch.declaredProgressPct as number);
  } else if (hasStatus && !hasPct) {
    after = applyActionStatus({ ...before, ...patch }, patch.status as ActionStatus);
    if (patch.status === "done" && patch.deliveredDate) after.deliveredDate = patch.deliveredDate;
  } else {
    after = { ...before, ...patch };
    if (after.status === "done" && !after.deliveredDate) after.deliveredDate = nowDate();
    if (after.status !== "done") delete after.deliveredDate;
  }
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
