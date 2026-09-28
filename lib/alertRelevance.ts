/**
 * Pertinence MÉTIER d'une alerte levier (Plan Performance) pour un utilisateur, en plus du ciblage
 * par périmètre d'accès (`targetAlerts`, lib/notifications.ts). Le ciblage répond à « peut-il voir
 * ce levier ? » ; cette règle répond à « cette alerte le concerne-t-elle ? » — ex. un Directeur RH
 * voit les leviers de son programme mais un dépassement de coûts ne relève pas de lui (audit fix #5).
 *
 * Partagée par la cloche du Topbar (components/shared/AppShell.tsx) et « Mon espace »
 * (lib/myWorkspace.ts) pour qu'elles montrent exactement les mêmes alertes.
 *
 * Catégorie d'une alerte (`alertCategory`), d'après `actorRole` :
 *  - `finance`  : alertes financières (dépassement de coûts CAPEX/OPEX one-off, OPEX récurrent,
 *                 savings réduits — `actorRole: "finance"` dans lib/alertEngine.ts) ou alerte
 *                 manuelle saisie par un profil finance ;
 *  - `hr`       : alerte manuelle saisie par un profil RH ;
 *  - `delivery` : tout le reste (retard d'actions, dépendance bloquée, alertes manuelles des
 *                 responsables de levier / chantier…).
 *
 * Rôles Plan Performance → catégories reçues (union sur tous les profils de l'utilisateur) :
 *  - `hr`      → `hr` uniquement (ses sujets sont les mouvements RH, remontés à part) ;
 *  - `finance` → `finance` uniquement (+ ses réalisés à valider, remontés à part) ;
 *  - tout autre rôle (lever, sponsor, cto, ops, program_sponsor/owner, comex_member…) → toutes,
 *    sur son périmètre (déjà borné par `targetAlerts`).
 * Admins et utilisateurs sans profil Performance : inchangé (toutes).
 */
import { getPerformanceProfiles, isAnyAdmin } from "@/lib/roleProfiles";
import type { Alert, AuthUser, Role } from "@/types";

export type AlertCategory = "finance" | "hr" | "delivery";

export function alertCategory(alert: Pick<Alert, "actorRole">): AlertCategory {
  if (alert.actorRole === "finance") return "finance";
  if (alert.actorRole === "hr") return "hr";
  return "delivery";
}

function roleAccepts(role: Role, category: AlertCategory): boolean {
  if (role === "hr") return category === "hr";
  if (role === "finance") return category === "finance";
  return true;
}

export function isAlertRelevantForUser(
  alert: Pick<Alert, "actorRole">,
  user: Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin"> | null | undefined
): boolean {
  if (!user) return false;
  if (isAnyAdmin(user)) return true;
  const roles = getPerformanceProfiles(user).map((p) => p.role);
  if (roles.length === 0) return true;
  const category = alertCategory(alert);
  return roles.some((role) => roleAccepts(role, category));
}

/** Filtre `alerts` sur celles pertinentes pour `user` (voir `isAlertRelevantForUser`). */
export function relevantAlertsFor<T extends Pick<Alert, "actorRole">>(
  alerts: T[],
  user: Parameters<typeof isAlertRelevantForUser>[1]
): T[] {
  return alerts.filter((a) => isAlertRelevantForUser(a, user));
}
