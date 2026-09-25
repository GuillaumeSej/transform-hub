import {
  PERFORMANCE_ROLES,
  STRATEGIC_ROLES,
  type AuthUser,
  type Program,
  type ProfileAssignment,
  type ProgramType,
  type Role,
} from "@/types";

// Dupliqué depuis lib/axisLogic.ts (et non importé) : lib/axisLogic.ts importe déjà des fonctions
// de CE fichier (hasAnyRole/isAnyAdmin) — un import dans l'autre sens créerait un cycle. Cette
// fonction est volontairement minuscule (un `??`), la dupliquer ici est plus simple que de casser
// le cycle en la déplaçant dans un troisième fichier partagé.
function resolveProgramTypeLocal(program: Pick<Program, "type"> | null | undefined): ProgramType {
  return program?.type ?? "performance";
}

/**
 * Lecture/validation du modèle multi-profils (round multi-profils — voir le commentaire sur
 * `AuthUser` dans types/index.ts). Point de passage unique : ne pas relire `user.profiles`,
 * `user.isGlobalAdmin`/`isCompanyAdmin` à la main ailleurs, pour que la règle "au plus un profil
 * Plan Perf + un profil Plan Stratégique" reste garantie à un seul endroit.
 */

export function isPerformanceRole(role: Role): boolean {
  return (PERFORMANCE_ROLES as readonly string[]).includes(role);
}

export function isStrategicRole(role: Role): boolean {
  return (STRATEGIC_ROLES as readonly string[]).includes(role);
}

/** Rôle TRANSVERSE aux deux pistes (présent à la fois dans `PERFORMANCE_ROLES` et
 *  `STRATEGIC_ROLES`) : `comex_member` et `hr` (Directeur RH, décision PO « comme en Transfo »).
 *  Un tel profil sans `programId` couvre les programmes des DEUX types. */
export function isCrossTrackRole(role: Role): boolean {
  return isPerformanceRole(role) && isStrategicRole(role);
}

/** Rôles du Plan Stratégique SUPPRIMÉS (décision PO : jamais outillés). Un profil legacy qui les
 *  porte encore est relu comme `comex_member` (lecture seule) sur le MÊME programme. */
export const LEGACY_REMOVED_STRATEGIC_ROLES: readonly string[] = [
  "internal_comm",
  "budget_control",
];

/**
 * Normalisation à la LECTURE des profils stockés (lib/auth.ts, liste admin des utilisateurs) :
 * `internal_comm`/`budget_control` → `comex_member` (même `programId`), puis dédoublonnage exact
 * (rôle + programme) si l'utilisateur avait déjà ce profil COMEX. Les anciens comptes restent ainsi
 * utilisables, en consultation seule, sans migration préalable ; la conversion en base se fait via
 * scripts/migrate-strategic-roles.js (ou au prochain enregistrement du compte dans l'admin).
 */
export function normalizeLegacyProfiles(
  profiles: readonly ProfileAssignment[]
): ProfileAssignment[] {
  const out: ProfileAssignment[] = [];
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (!profile || typeof profile.role !== "string") continue;
    const role: Role = LEGACY_REMOVED_STRATEGIC_ROLES.includes(profile.role)
      ? "comex_member"
      : profile.role;
    const key = `${role}|${profile.programId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(profile.programId ? { role, programId: profile.programId } : { role });
  }
  return out;
}

/** Le PREMIER profil Plan Performance de l'utilisateur, s'il en a un — round multi-profils
 *  multi-programmes : un utilisateur peut désormais avoir PLUSIEURS profils Plan Performance
 *  (un par programme, voir `assertValidProfiles`). Ce raccourci singulier reste utile pour un
 *  badge/libellé simple qui n'a pas besoin de distinguer le programme, mais NE DOIT PLUS servir à
 *  une vérification de permission ni à résoudre la nav/clearance — préférer `getPerformanceProfiles`
 *  (pluriel) pour itérer tous les profils de la piste. */
export function getPerformanceProfile(
  user: Pick<AuthUser, "profiles"> | null | undefined
): ProfileAssignment | undefined {
  return user?.profiles?.find((p) => isPerformanceRole(p.role));
}

/** Le PREMIER profil Plan Stratégique de l'utilisateur, s'il en a un — même mise en garde que
 *  `getPerformanceProfile` ci-dessus (la piste Stratégique reste plafonnée à un seul profil pour
 *  l'instant, mais utiliser la variante plurielle reste le choix par défaut le plus sûr). */
export function getStrategicProfile(
  user: Pick<AuthUser, "profiles"> | null | undefined
): ProfileAssignment | undefined {
  return user?.profiles?.find((p) => isStrategicRole(p.role));
}

/** TOUS les profils Plan Performance de l'utilisateur (0, 1 ou plusieurs — un par programme, voir
 *  `assertValidProfiles`). Préférer cette variante à `getPerformanceProfile` (singulier) dès qu'il
 *  s'agit de résoudre la nav, la clearance, ou tout ce qui doit refléter l'ensemble des profils. */
export function getPerformanceProfiles(
  user: Pick<AuthUser, "profiles"> | null | undefined
): ProfileAssignment[] {
  return user?.profiles?.filter((p) => isPerformanceRole(p.role)) ?? [];
}

/** TOUS les profils Plan Stratégique de l'utilisateur — voir `getPerformanceProfiles`. */
export function getStrategicProfiles(
  user: Pick<AuthUser, "profiles"> | null | undefined
): ProfileAssignment[] {
  return user?.profiles?.filter((p) => isStrategicRole(p.role)) ?? [];
}

/** L'utilisateur détient-il CE rôle précis, dans l'un de ses profils ? */
export function hasRole(user: Pick<AuthUser, "profiles"> | null | undefined, role: Role): boolean {
  return !!user?.profiles?.some((p) => p.role === role);
}

/** L'utilisateur détient-il AU MOINS UN de ces rôles, dans l'un de ses profils ? */
export function hasAnyRole(
  user: Pick<AuthUser, "profiles"> | null | undefined,
  roles: readonly Role[]
): boolean {
  return !!user?.profiles?.some((p) => roles.includes(p.role));
}

/** Super-admin global OU admin de sa propre entreprise — les deux habilitations qui, partout dans
 *  le code métier, "court-circuitent" les vérifications de rôle/clearance habituelles. Remplace
 *  les anciennes comparaisons `role === "admin" || role === "admin_entreprise"`. */
/** Import Excel du Plan Stratégique (page Axes stratégiques) : réservé à l'admin BearingPoint
 *  (global), à l'admin de l'entreprise et au pilote stratégique (`strategic_lead`) du programme
 *  affiché — `strategicRole` = rôle stratégique EFFECTIF pour ce programme
 *  (`useStrategicData().strategicRole`). Un import touche tout le plan : les autres profils
 *  modifient leurs propres éléments directement dans l'outil. */
export function canImportStrategicPlan(
  user: Pick<AuthUser, "isGlobalAdmin" | "isCompanyAdmin"> | null | undefined,
  strategicRole: Role | undefined
): boolean {
  return isAnyAdmin(user) || strategicRole === "strategic_lead";
}

export function isAnyAdmin(
  user: Pick<AuthUser, "isGlobalAdmin" | "isCompanyAdmin"> | null | undefined
): boolean {
  return !!user?.isGlobalAdmin || !!user?.isCompanyAdmin;
}

/**
 * Le rôle "actif" de l'utilisateur compte tenu du type de programme actuellement affiché — pour
 * les écrans/fonctions qui n'ont besoin que d'UN SEUL rôle (ex. libellé affiché, clearance par
 * rôle). Ne PAS utiliser pour des vérifications de permission d'accès (préférer `hasRole`/
 * `isAnyAdmin`, qui reflètent tous les profils sans dépendre du contexte affiché).
 */
export function getActiveRole(
  user: Pick<AuthUser, "profiles"> | null | undefined,
  programType: "performance" | "strategic" | null | undefined
): Role | null {
  if (!user?.profiles?.length) return null;
  if (programType === "strategic") return getStrategicProfile(user)?.role ?? user.profiles[0].role;
  if (programType === "performance")
    return getPerformanceProfile(user)?.role ?? user.profiles[0].role;
  return user.profiles[0].role;
}

/** Rôles qui ne donnent JAMAIS de droit d'édition sur les objets d'un plan : `comex_member`
 *  partout ; `hr` sur le Plan Stratégique (il édite la Base ETP, mais consulte le plan). */
const READ_ONLY_PLAN_ROLES: readonly Role[] = ["comex_member", "hr"];

/**
 * L'utilisateur est-il cantonné à la LECTURE SEULE, tous profils confondus ? Round 25 (gate
 * d'édition COMEX) : `comex_member` ("Membre du COMEX", voir son commentaire dans types/index.ts)
 * est le premier rôle de l'app à ne JAMAIS donner de droit d'édition, sur aucune des deux pistes —
 * jusqu'ici aucune gate centrale "cet utilisateur peut-il éditer ?" n'existait, chaque bouton de
 * création/édition/suppression s'affichait inconditionnellement quel que soit le rôle.
 *
 * `true` UNIQUEMENT si TOUS les profils de l'utilisateur sont `comex_member` (un utilisateur qui
 * cumule `comex_member` ET un autre rôle, ex. `chantier_owner` sur un second programme, garde ses
 * droits d'édition — on ne le verrouille pas au prétexte qu'il a AUSSI un profil COMEX). Un
 * utilisateur SANS AUCUN profil (`profiles` vide, ex. compte admin_entreprise pur) n'est pas
 * "cantonné à comex_member" au sens de cette fonction : `false`.
 *
 * Un admin (global ou entreprise) n'est JAMAIS en lecture seule, quels que soient ses profils
 * métier — même court-circuit qu'`isAnyAdmin` partout ailleurs dans ce fichier.
 */
export function isReadOnlyUser(
  user: Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin"> | null | undefined,
  programId?: string | null,
  programType?: ProgramType
): boolean {
  if (isAnyAdmin(user)) return false;
  const profiles = user?.profiles ?? [];
  if (profiles.length === 0) return false;
  // Sans programme : comportement historique (tous profils `comex_member`).
  if (programId == null) return profiles.every((p) => p.role === "comex_member");
  // Par programme (décision PO rôles Plan Stratégique) : seuls comptent les profils qui portent
  // sur CE programme — rattachés à lui, ou "tous programmes" de la piste du programme (toute piste
  // si `programType` n'est pas fourni). Lecture seule si l'utilisateur n'y a AUCUN profil, ou
  // uniquement des profils `comex_member`/`hr`.
  const relevant = profiles.filter((p) => {
    if (p.programId) return p.programId === programId;
    if (!programType) return true;
    return programType === "strategic" ? isStrategicRole(p.role) : isPerformanceRole(p.role);
  });
  return relevant.every((p) => READ_ONLY_PLAN_ROLES.includes(p.role));
}

/**
 * Programmes de l'entreprise que cet utilisateur est autorisé à voir/sélectionner comme
 * "programme actif" (voir `useActiveProgram`/le sélecteur de programme du Topbar) :
 *  - un admin (global ou entreprise) voit TOUS les programmes de l'entreprise (déjà scopés par
 *    l'appelant, qui ne passe que les programmes de la bonne entreprise) ;
 *  - sinon, un utilisateur voit les programmes couverts par SES profils : si un profil précise un
 *    `programId`, seulement CE programme ; sinon (profil non rattaché à un programme précis), tous
 *    les programmes de l'entreprise du MÊME type que ce profil (Plan Perf ou Plan Stratégique) —
 *    cas des entreprises n'ayant qu'un seul programme d'un type donné, ou des comptes de démo.
 * Un utilisateur avec un profil Plan Perf ET un profil Plan Stratégique peut ainsi basculer entre
 * les deux (round multi-profils, demande explicite : "le CTO devrait pouvoir switch entre plan
 * strat et plan de perf").
 */
export function getAuthorizedPrograms(
  user: Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin"> | null | undefined,
  companyPrograms: Program[]
): Program[] {
  if (!user) return [];
  if (isAnyAdmin(user)) return companyPrograms;
  const allowedIds = new Set<string>();
  for (const profile of user.profiles ?? []) {
    if (profile.programId) {
      allowedIds.add(profile.programId);
      continue;
    }
    // Rôle transverse (`comex_member`, `hr`) sans programme : programmes des DEUX types.
    // Correctif : `isStrategicRole` étant vrai pour ces rôles, un profil COMEX "tous programmes"
    // ne voyait auparavant jamais les programmes Performance.
    const cross = isCrossTrackRole(profile.role);
    const wantedType: ProgramType = isStrategicRole(profile.role) ? "strategic" : "performance";
    for (const program of companyPrograms) {
      if (cross || resolveProgramTypeLocal(program) === wantedType) allowedIds.add(program.id);
    }
  }
  return companyPrograms.filter((p) => allowedIds.has(p.id));
}

/**
 * Valide la contrainte du round multi-profils MULTI-PROGRAMMES : un utilisateur peut désormais
 * cumuler PLUSIEURS profils d'une même piste (Plan Performance ou Plan Stratégique), à condition
 * qu'ils portent sur des programmes DISTINCTS (ex. "lever" sur le programme A + "finance" sur le
 * programme B) — ce qui reste interdit, par piste :
 *  - mélanger un profil "global" (sans `programId`, portée "tous les programmes") avec un ou
 *    plusieurs profils scopés à un programme précis : ambigu, un profil global doit rester SEUL
 *    dans sa piste ;
 *  - deux profils de la même piste sur le MÊME programme (avec ou sans rôles différents) : lequel
 *    ferait foi ? Un seul rôle par (piste, programme).
 * Utilisée par l'UI admin (UsersPanel) avant d'enregistrer — lève une erreur avec un message FR
 * directement affichable si violée.
 */
export function assertValidProfiles(
  profiles: ProfileAssignment[],
  /** Type des programmes par id (optionnel) : un profil TRANSVERSE (`comex_member`, `hr`) rattaché
   *  à un programme précis ne compte alors que dans la piste de CE programme (sinon il compterait
   *  dans les deux, et bloquerait à tort, ex., `hr` sur un programme Performance + `strategic_lead`
   *  sur un programme Stratégique). Sans cette table, comportement historique (les deux pistes). */
  programTypeById?: Record<string, ProgramType>
): void {
  // Directeur RH : un seul programme pour l'instant (décision PO) — le profil doit viser un
  // programme précis, jamais « tous les programmes ».
  if (profiles.some((p) => p.role === "hr" && !p.programId)) {
    throw new Error(
      "Le profil Directeur RH doit être rattaché à un programme précis (pas « tous les programmes »)."
    );
  }
  for (const [trackLabel, isTrackRole, trackType] of [
    ["Plan Performance", isPerformanceRole, "performance"],
    ["Plan Stratégique", isStrategicRole, "strategic"],
  ] as const) {
    const trackProfiles = profiles.filter((p) => {
      if (!isTrackRole(p.role)) return false;
      const knownType = p.programId ? programTypeById?.[p.programId] : undefined;
      return !(isCrossTrackRole(p.role) && knownType && knownType !== trackType);
    });
    if (trackProfiles.length <= 1) continue;
    if (trackProfiles.some((p) => !p.programId)) {
      throw new Error(
        `Un profil ${trackLabel} portant sur "tous les programmes" ne peut pas être combiné avec un autre profil ${trackLabel} — retirez l'un des deux, ou limitez chacun à un programme précis.`
      );
    }
    const programIds = trackProfiles.map((p) => p.programId);
    if (new Set(programIds).size !== programIds.length) {
      throw new Error(
        `Un utilisateur ne peut avoir qu'un seul profil ${trackLabel} par programme.`
      );
    }
  }
}
