import { describe, expect, it } from "vitest";
import { alertCategory, isAlertRelevantForUser, relevantAlertsFor } from "@/lib/alertRelevance";
import type { AuthUser } from "@/types";

const user = (profiles: AuthUser["profiles"], extra: Partial<AuthUser> = {}) =>
  ({ profiles, ...extra }) as Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin">;

const cost = { actorRole: "finance" }; // AUTO-COST / AUTO-OPEXREC / AUTO-SAVINGS
const delay = { actorRole: "lever" }; // AUTO-DELAY / AUTO-DEP
const hrManual = { actorRole: "hr" };

describe("alertRelevance", () => {
  it("categorises alerts from actorRole", () => {
    expect(alertCategory(cost)).toBe("finance");
    expect(alertCategory(hrManual)).toBe("hr");
    expect(alertCategory(delay)).toBe("delivery");
    expect(alertCategory({ actorRole: "" })).toBe("delivery");
  });

  it("hr: no cost-overrun nor delivery alert", () => {
    const hr = user([{ role: "hr" }]);
    expect(isAlertRelevantForUser(cost, hr)).toBe(false);
    expect(isAlertRelevantForUser(delay, hr)).toBe(false);
    expect(isAlertRelevantForUser(hrManual, hr)).toBe(true);
  });

  it("finance: financial alerts only", () => {
    const fin = user([{ role: "finance" }]);
    expect(relevantAlertsFor([cost, delay, hrManual], fin)).toEqual([cost]);
  });

  it("lever / sponsor / cto / others: every alert (perimeter handled by targetAlerts)", () => {
    for (const role of ["lever", "sponsor", "cto", "program_owner", "ops"] as const) {
      expect(relevantAlertsFor([cost, delay], user([{ role }]))).toHaveLength(2);
    }
  });

  it("multi-profile = union; admins and users without Performance profile unchanged", () => {
    expect(relevantAlertsFor([cost, delay], user([{ role: "hr" }, { role: "finance" }]))).toEqual([
      cost,
    ]);
    expect(
      relevantAlertsFor([cost, delay], user([{ role: "hr" }], { isCompanyAdmin: true }))
    ).toHaveLength(2);
    expect(relevantAlertsFor([cost, delay], user([{ role: "axis_sponsor" }]))).toHaveLength(2);
    expect(isAlertRelevantForUser(cost, null)).toBe(false);
  });
});
