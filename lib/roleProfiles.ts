import {
  PERFORMANCE_ROLES,
  STRATEGIC_ROLES,
  type AuthUser,
  type ProfileAssignment,
  type Role,
} from "@/types";

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
