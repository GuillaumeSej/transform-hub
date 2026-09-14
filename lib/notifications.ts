import {
  isLeverOwnedBy,
  isLeverSponsoredBy,
  isLeverVisibleForClearance,
  resolveConfidentialityClearance,
} from "@/lib/leversLogic";
import { hasRole } from "@/lib/roleProfiles";
import type { Alert, AuthUser, BeTrackData, Company, Lever } from "@/types";

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function alertCompanyId(alert: Alert, data: BeTrackData): string | null | undefined {
  if (alert.companyId !== undefined) return alert.companyId;
  const lever = data.levers.find((item) => item.id === alert.scope);
  return lever?.companyId;
}

export function resolveAlertLever(alert: Alert, data: BeTrackData): Lever | undefined {
  return data.levers.find((lever) => lever.id === alert.scope);
}

export function canUserAccessLever(
  user: AuthUser,
  lever: Lever,
  company?: Company,
  workstreams: BeTrackData["workstreams"] = []
): boolean {
  if (user.isGlobalAdmin) return true;
  if (user.companyId !== lever.companyId) return false;
  if (user.isCompanyAdmin) return true;

  const clearance = resolveConfidentialityClearance(user, company?.roleClearance);
  if (!isLeverVisibleForClearance(lever.confidentialityLevel, clearance)) return false;
  // Comparaison via `isLeverOwnedBy`/`isLeverSponsoredBy` (voir lib/leversLogic.ts, seules
  // implémentations partagées par tous les call sites de cette question) : lien id-based en
  // priorité si réconcilié, repli sur la comparaison de noms normalisée sinon. Les deux gates sont
  // indépendantes (AND) : un utilisateur peut cumuler un rôle "lever" sur un programme et un rôle
  // "sponsor" sur un autre (voir round multi-profils), les deux restrictions s'appliquent alors.
  if (hasRole(user, "lever") && !isLeverOwnedBy(lever, user)) return false;
  if (hasRole(user, "sponsor")) {
    const workstreamSponsorUsername = workstreams.find((w) => w.id === lever.ws)?.sponsorUsername;
    if (!isLeverSponsoredBy(lever, workstreamSponsorUsername, user)) return false;
  }
  return true;
}

export function deriveAlertRecipients(
  alert: Alert,
  users: AuthUser[],
  data: BeTrackData,
  companies: Company[]
): string[] {
  const companyId = alertCompanyId(alert, data);
  const directLever = resolveAlertLever(alert, data);
  const workstreamLevers = data.workstreams.some((workstream) => workstream.id === alert.scope)
    ? data.levers.filter((lever) => lever.ws === alert.scope)
    : [];

  return users
    .filter((user) => {
      if (user.isGlobalAdmin) return true;
      if (!companyId || user.companyId !== companyId) return false;
      const company = companies.find((item) => item.id === user.companyId);
      if (directLever) return canUserAccessLever(user, directLever, company, data.workstreams);
      if (workstreamLevers.length > 0) {
        return workstreamLevers.some((lever) =>
          canUserAccessLever(user, lever, company, data.workstreams)
        );
      }
      return user.isCompanyAdmin || hasRole(user, "cto");
    })
    .map((user) => normalize(user.username))
    .filter(Boolean)
    .sort();
}

export function targetAlerts(
  alerts: Alert[],
  user: AuthUser | null | undefined,
  users: AuthUser[],
  data: BeTrackData,
  companies: Company[]
): Alert[] {
  if (!user) return [];
  const username = normalize(user.username);
  return alerts
    .map((alert) => {
      const recipients = deriveAlertRecipients(alert, users, data, companies);
      return { ...alert, recipientUsernames: recipients };
    })
    .filter((alert) => alert.recipientUsernames?.includes(username));
}
