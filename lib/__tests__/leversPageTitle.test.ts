import { describe, expect, it } from "vitest";
import { leversPageTitleKey, resolveUserNav } from "@/lib/nav-config";
import type { AuthUser } from "@/types";

const u = (...roles: string[]) =>
  ({
    username: "u",
    name: "u",
    companyId: "c1",
    profiles: roles.map((role, i) => ({ role, programId: `p${i}` })),
  }) as unknown as AuthUser;

describe("leversPageTitleKey — /levers title = sidebar label of the 'levers' item", () => {
  it.each([
    ["cto", "nav.leverLibrary"],
    ["program_sponsor", "nav.leverLibrary"],
    ["lever", "nav.myLevers"],
    ["sponsor", "nav.leverPipeline"], // QA : nav « Leviers par étape », titre « Mes leviers »
    ["finance", "nav.leverLibrary"],
    ["ops", "nav.linkedLevers"],
  ])("%s → %s", (role, key) => {
    const user = u(role);
    expect(leversPageTitleKey(user)).toBe(key);
    expect(resolveUserNav(user).find((i) => i.id === "levers")?.label).toBe(key);
  });

  it("multi-profile user: same winning profile as the sidebar (first profile)", () => {
    expect(leversPageTitleKey(u("sponsor", "lever"))).toBe("nav.leverPipeline");
    expect(leversPageTitleKey(u("lever", "sponsor"))).toBe("nav.myLevers");
  });

  it("falls back to the library title without a 'levers' nav item", () => {
    expect(leversPageTitleKey(null)).toBe("nav.leverLibrary");
    expect(leversPageTitleKey({ profiles: [], isGlobalAdmin: true } as unknown as AuthUser)).toBe(
      "nav.leverLibrary"
    );
  });
});
