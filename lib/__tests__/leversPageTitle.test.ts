import { describe, expect, it } from "vitest";
import {
  ADMIN_NAV_DEFINITIONS,
  leversPageTitleKey,
  resolveLandingRoute,
  resolveUserNav,
  roles,
} from "@/lib/nav-config";
import type { NavItem, Role } from "@/types";
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

/** Nombre d'en-têtes de section que la Sidebar afficherait (un par changement de section). */
const sectionHeaders = (nav: NavItem[]) =>
  nav
    .filter((item, i) => !!item.section && item.section !== nav[i - 1]?.section)
    .map((i) => i.section);

describe("« Mon espace » in the « Mes actions » (decision) section", () => {
  const allDefs = [
    ...Object.entries(roles).map(([role, def]) => [role, def.nav] as const),
    ["admin-global", ADMIN_NAV_DEFINITIONS.global.nav] as const,
    ["admin-company", ADMIN_NAV_DEFINITIONS.company.nav] as const,
  ];

  it.each(allDefs)(
    "%s: 'me' is in section decision, right before 'validation' if any",
    (_, nav) => {
      const meIndex = nav.findIndex((i) => i.id === "me");
      expect(meIndex).toBeGreaterThanOrEqual(0);
      expect(nav[meIndex].section).toBe("decision");
      const validationIndex = nav.findIndex((i) => i.id === "validation");
      if (validationIndex >= 0) expect(validationIndex).toBe(meIndex + 1);
    }
  );

  it.each(Object.keys(roles) as Role[])(
    "%s: resolved nav has no duplicated section header",
    (role) => {
      const nav = resolveUserNav(u(role));
      const headers = sectionHeaders(nav);
      expect(new Set(headers).size).toBe(headers.length);
      expect(headers).toContain("decision");
      expect(nav[0].id).not.toBe("me");
    }
  );

  it("multi-profile + admin union keeps a single « Mes actions » header", () => {
    const user = {
      ...u("lever", "finance", "axis_sponsor"),
      isGlobalAdmin: true,
      isCompanyAdmin: true,
    } as AuthUser;
    const nav = resolveUserNav(user);
    const headers = sectionHeaders(nav);
    expect(new Set(headers).size).toBe(headers.length);
    const decision = nav.filter((i) => i.section === "decision").map((i) => i.id);
    expect(decision.slice(0, 2)).toEqual(["me", "validation"]);
  });
});

describe("resolveLandingRoute — landing page stays /me", () => {
  it.each(Object.keys(roles) as Role[])("%s → /me", (role) => {
    expect(resolveLandingRoute(resolveUserNav(u(role)))).toBe("/me");
  });

  it("admins → /me", () => {
    expect(
      resolveLandingRoute(
        resolveUserNav({ profiles: [], isGlobalAdmin: true } as unknown as AuthUser)
      )
    ).toBe("/me");
  });

  it("falls back to the first nav item, then /levers", () => {
    expect(resolveLandingRoute([{ id: "kpi", icon: "LineChart", label: "nav.kpi" }])).toBe("/kpi");
    expect(resolveLandingRoute([])).toBe("/levers");
  });
});
