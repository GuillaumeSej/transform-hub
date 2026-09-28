import { describe, expect, it } from "vitest";
import { canOpenRoute } from "@/lib/routeAccess";
import type { AuthUser, Role } from "@/types";

const u = (...roles: Role[]) =>
  ({ profiles: roles.map((role) => ({ role })) }) as unknown as AuthUser;

describe("canOpenRoute", () => {
  it("follows the user's nav", () => {
    expect(canOpenRoute(u("cto"), "/finance", "performance")).toBe(true);
    expect(canOpenRoute(u("comex_member"), "/finance", "performance")).toBe(false);
    expect(canOpenRoute(u("comex_member"), "/hr", "performance")).toBe(false);
  });

  it("ignores query string and hash", () => {
    expect(canOpenRoute(u("strategic_lead"), "/kpi?indicator=I1", "strategic")).toBe(true);
    expect(canOpenRoute(u("hr"), "/kpi?indicator=I1", "strategic")).toBe(false);
  });

  it("always allows profile and lever detail, company detail only for global admin", () => {
    expect(canOpenRoute(u("lever"), "/profile")).toBe(true);
    expect(canOpenRoute(u("lever"), "/levers/detail?id=L1")).toBe(true);
    expect(canOpenRoute(u("cto"), "/admin/companies/detail?id=c1")).toBe(false);
    const admin = { profiles: [], isGlobalAdmin: true } as unknown as AuthUser;
    expect(canOpenRoute(admin, "/admin/companies/detail?id=c1")).toBe(true);
  });

  it("no user or no profile → nothing", () => {
    expect(canOpenRoute(null, "/me")).toBe(false);
    expect(canOpenRoute(u(), "/me")).toBe(false);
  });
});
