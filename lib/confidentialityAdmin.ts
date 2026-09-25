/**
 * Helpers PURS de l'écran « Confidentialité » de l'admin d'entreprise (onglet de /admin/users).
 *
 * Modèle (décision PO) : BearingPoint (admin global) DÉFINIT l'échelle `Company.confidentialityLevels`
 * lors de la mise en place ; l'admin d'entreprise décide QUI accède à quel niveau :
 *  (a) niveau par défaut de chaque rôle (`Company.roleClearance[role]`) ;
 *  (b) surcharge individuelle (`AuthUser.confidentialityClearance`).
 * Toute la sémantique hiérarchique vit dans `lib/confidentiality.ts` — ce module ne fait que
 * construire les données d'affichage/édition.
 */
import type { AuthUser, ProgramType, Role } from "@/types";
import { PERFORMANCE_ROLES, STRATEGIC_ROLES } from "@/types";
import { levelRank, normalizeClearanceLevel, normalizeRoleClearance } from "@/lib/confidentiality";
import { isAnyAdmin } from "@/lib/roleProfiles";

type RoleClearanceMap = Partial<Record<Role, string | string[]>> | null | undefined;

/** Ordre d'affichage canonique des rôles (Performance, puis Stratégique, `comex_member` une fois). */
const ROLE_ORDER: Role[] = Array.from(new Set<Role>([...PERFORMANCE_ROLES, ...STRATEGIC_ROLES]));

/**
 * Niveau HÉRITÉ des rôles d'un utilisateur (sans surcharge individuelle) : le niveau le plus haut
 * parmi les `roleClearance` de TOUS ses profils (toutes pistes confondues — valeur d'affichage ;
 * la résolution effective par piste reste `resolveConfidentialityClearance`). undefined = aucun.
 */
export function inheritedRoleLevel(
  profiles: AuthUser["profiles"] | null | undefined,
  roleClearance: RoleClearanceMap,
  orderedLevels: string[]
): string | undefined {
  const normalized = normalizeRoleClearance(roleClearance, orderedLevels);
  let best = -1;
  for (const p of profiles ?? [])
    best = Math.max(best, levelRank(normalized[p.role], orderedLevels));
  return best >= 0 ? orderedLevels[best] : undefined;
}

export type UserClearanceSummary =
  | { kind: "admin" }
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "level"; level: string }
  | { kind: "inherit"; level: string | undefined };

/** Résumé de l'habilitation d'un utilisateur (surcharge individuelle ou héritage de ses rôles). */
export function describeUserClearance(
  user: Pick<
    AuthUser,
    "profiles" | "confidentialityClearance" | "isGlobalAdmin" | "isCompanyAdmin"
  >,
  roleClearance: RoleClearanceMap,
  orderedLevels: string[]
): UserClearanceSummary {
  if (isAnyAdmin(user)) return { kind: "admin" };
  const c = user.confidentialityClearance;
  if (c === undefined) {
    return {
      kind: "inherit",
      level: inheritedRoleLevel(user.profiles, roleClearance, orderedLevels),
    };
  }
  if (c === "all") return { kind: "all" };
  const level = normalizeClearanceLevel(c, orderedLevels);
  return level ? { kind: "level", level } : { kind: "none" };
}

/** Utilisateurs (non admin) portant une surcharge individuelle, triés par nom. */
export function usersWithClearanceOverride<
  U extends Pick<
    AuthUser,
    "name" | "profiles" | "confidentialityClearance" | "isGlobalAdmin" | "isCompanyAdmin"
  >,
>(users: U[]): U[] {
  return users
    .filter((u) => !isAnyAdmin(u) && u.confidentialityClearance !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type RoleClearanceRow = { role: Role; level: string | undefined; userCount: number };

/**
 * Lignes de la matrice rôle -> niveau par défaut : rôles RÉELLEMENT portés par un utilisateur de
 * l'entreprise ∪ tous les rôles des modules activés (types de programme présents) ∪ rôles déjà
 * configurés dans `roleClearance` (pour ne jamais masquer une valeur existante). Ordre canonique.
 */
export function buildRoleClearanceMatrix(
  users: Pick<AuthUser, "profiles">[],
  enabledProgramTypes: ProgramType[],
  roleClearance: RoleClearanceMap,
  orderedLevels: string[]
): RoleClearanceRow[] {
  const normalized = normalizeRoleClearance(roleClearance, orderedLevels);
  const counts = new Map<Role, number>();
  for (const u of users) {
    new Set((u.profiles ?? []).map((p) => p.role)).forEach((role) =>
      counts.set(role, (counts.get(role) ?? 0) + 1)
    );
  }
  const wanted = new Set<Role>(counts.keys());
  if (enabledProgramTypes.includes("performance")) PERFORMANCE_ROLES.forEach((r) => wanted.add(r));
  if (enabledProgramTypes.includes("strategic")) STRATEGIC_ROLES.forEach((r) => wanted.add(r));
  (Object.keys(normalized) as Role[]).forEach((r) => wanted.add(r));
  return ROLE_ORDER.filter((r) => wanted.has(r)).map((role) => ({
    role,
    level: normalized[role],
    userCount: counts.get(role) ?? 0,
  }));
}

/** Nouvelle matrice (normalisée, sans tableaux legacy) après choix du niveau d'un rôle ("" = aucun). */
export function withRoleLevel(
  roleClearance: RoleClearanceMap,
  role: Role,
  level: string,
  orderedLevels: string[]
): Partial<Record<Role, string>> {
  const next = normalizeRoleClearance(roleClearance, orderedLevels);
  if (level && orderedLevels.includes(level)) next[role] = level;
  else delete next[role];
  return next;
}
