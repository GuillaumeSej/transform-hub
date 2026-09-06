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

/** Le profil Plan Performance de l'utilisateur, s'il en a un. */
export function getPerformanceProfile(
  user: Pick<AuthUser, "profiles"> | null | undefined
): ProfileAssignment | undefined {
  return user?.profiles?.find((p) => isPerformanceRole(p.role));
}

/** Le profil Plan Stratégique de l'utilisateur, s'il en a un. */
export function getStrategicProfile(
  user: Pick<AuthUser, "profiles"> | null | undefined
): ProfileAssignment | undefined {
  return user?.profiles?.find((p) => isStrategicRole(p.role));
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
    const wantedType: ProgramType = isStrategicRole(profile.role) ? "strategic" : "performance";
    for (const program of companyPrograms) {
      if (resolveProgramTypeLocal(program) === wantedType) allowedIds.add(program.id);
    }
  }
  return companyPrograms.filter((p) => allowedIds.has(p.id));
}

/**
 * Valide la contrainte du round multi-profils : au plus UN profil Plan Performance et au plus UN
 * profil Plan Stratégique (jamais deux du même type). Utilisée par l'UI admin (UsersPanel) avant
 * d'enregistrer — lève une erreur avec un message FR directement affichable si violée.
 */
export function assertValidProfiles(profiles: ProfileAssignment[]): void {
  const perfCount = profiles.filter((p) => isPerformanceRole(p.role)).length;
  const stratCount = profiles.filter((p) => isStrategicRole(p.role)).length;
  if (perfCount > 1) {
    throw new Error("Un utilisateur ne peut avoir qu'un seul profil Plan Performance à la fois.");
  }
  if (stratCount > 1) {
    throw new Error("Un utilisateur ne peut avoir qu'un seul profil Plan Stratégique à la fois.");
  }
}
