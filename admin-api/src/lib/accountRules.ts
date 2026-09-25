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
