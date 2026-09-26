/**
 * Règles métier pures (sans Firebase) sur l'état des comptes — MIRROR de
 * transform-hub/lib/userAccountAdmin.ts (`isActiveCompanyAdmin` / `isLastActiveCompanyAdmin`),
 * qui applique les mêmes garde-fous côté UI. Le backend reste l'autorité : l'UI ne fait que
 * griser les actions interdites.
 */

export type AccountFlags = {
  role?: string;
  isCompanyAdmin?: boolean;
  disabled?: boolean;
};

/** Admin d'entreprise ACTIF (nouveau format `isCompanyAdmin` ou legacy `role: "admin_entreprise"`). */
export function isActiveCompanyAdmin(data: AccountFlags): boolean {
  return (
    (data.isCompanyAdmin === true || data.role === "admin_entreprise") && data.disabled !== true
  );
}

/**
 * `true` si `targetSlug` est le DERNIER admin d'entreprise actif parmi `companyAccounts` (tous
 * les documents `adminUsers` de la même entreprise, cible comprise) — le désactiver laisserait
 * l'entreprise sans personne pour gérer ses comptes.
 */
export function isLastActiveCompanyAdmin(
  targetSlug: string,
  companyAccounts: { slug: string; data: AccountFlags }[]
): boolean {
  const target = companyAccounts.find((a) => a.slug === targetSlug);
  if (!target || !isActiveCompanyAdmin(target.data)) return false;
  return !companyAccounts.some((a) => a.slug !== targetSlug && isActiveCompanyAdmin(a.data));
}

/** Habilitation admin d'ENTREPRISE portée par un compte, active ou non (nouveau format ou legacy).
 *  Même définition que `carriesCompanyAdmin` dans firestore.rules. */
export function carriesCompanyAdmin(data: AccountFlags | undefined): boolean {
  return data?.isCompanyAdmin === true || data?.role === "admin_entreprise";
}

/** Action d'administration d'un compte exposée par admin-api. */
export type AccountAction = "delete" | "disable" | "enable" | "rename" | "reset_password";

/**
 * Motif de refus (message français, `null` = autorisé) d'une action sur un compte — MIRROR de la
 * protection des pairs admins de firestore.rules (`adminUsers` : `keepsPeerCompanyAdmin`, règle de
 * suppression) :
 *  - jamais sur son PROPRE compte pour une suppression ou une désactivation (renommer / changer son
 *    mot de passe / générer son lien de réinitialisation restent permis) ;
 *  - un admin d'entreprise (appelant non admin global) ne peut ni supprimer, ni désactiver /
 *    réactiver, ni renommer, ni réinitialiser le mot de passe d'un AUTRE admin d'entreprise : ces
 *    actions passent par un admin global.
 * Le verrou « compte admin global » est appliqué séparément (`authz.ts::assertCanActOnTarget`).
 */
export function accountActionDenial(
  caller: { slug: string; isGlobalAdmin: boolean },
  targetSlug: string,
  target: AccountFlags | undefined,
  action: AccountAction
): string | null {
  const self = caller.slug === targetSlug;
  if (self && action === "delete") return "Vous ne pouvez pas supprimer votre propre compte.";
  if (self && action === "disable") return "Vous ne pouvez pas désactiver votre propre compte.";
  if (self || caller.isGlobalAdmin) return null;
  if (carriesCompanyAdmin(target)) {
    return "Seul un administrateur global peut agir sur le compte d'un autre administrateur d'entreprise.";
  }
  return null;
}
