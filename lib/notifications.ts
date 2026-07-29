import { isLeverVisibleForClearance, resolveConfidentialityClearance } from "@/lib/leversLogic";
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

export function canUserAccessLever(user: AuthUser, lever: Lever, company?: Company): boolean {
  if (user.role === "admin") return true;
  if (user.companyId !== lever.companyId) return false;
  if (user.role === "admin_entreprise") return true;

  const clearance = resolveConfidentialityClearance(user, company?.roleClearance);
  if (!isLeverVisibleForClearance(lever.confidentialityLevel, clearance)) return false;
  if (user.role === "lever") return normalize(lever.owner) === normalize(user.name);
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
      if (user.role === "admin") return true;
      if (!companyId || user.companyId !== companyId) return false;
      const company = companies.find((item) => item.id === user.companyId);
      if (directLever) return canUserAccessLever(user, directLever, company);
      if (workstreamLevers.length > 0) {
        return workstreamLevers.some((lever) => canUserAccessLever(user, lever, company));
      }
      return user.role === "admin_entreprise" || user.role === "cto";
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
