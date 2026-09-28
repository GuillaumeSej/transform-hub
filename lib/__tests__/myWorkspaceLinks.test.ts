import { describe, expect, it } from "vitest";
import { reachableHref } from "@/lib/myWorkspace";
import type { AuthUser, Role } from "@/types";

const u = (...roles: Role[]) =>
  ({ username: "x", profiles: roles.map((role) => ({ role })) }) as unknown as AuthUser;

describe("reachableHref (Mon espace, audit fix #3)", () => {
  it("keeps the target page when the user can open it", () => {
    expect(reachableHref(u("sponsor"), "performance", "/validation", "/levers/detail?id=L1")).toBe(
      "/validation"
    );
  });

  it("falls back to the object's detail page otherwise", () => {
    expect(reachableHref(u("lever"), "performance", "/validation", "/levers/detail?id=L1")).toBe(
      "/levers/detail?id=L1"
    );
    expect(reachableHref(u("lever"), "performance", "/workstreams", "/levers")).toBe("/levers");
    expect(reachableHref(u("hr"), "strategic", "/kpi?indicator=I1", "/levers/detail?id=AX1")).toBe(
      "/levers/detail?id=AX1"
    );
  });

  it("no reachable page → no link", () => {
    expect(reachableHref(u("lever"), "performance", "/dashboard")).toBeUndefined();
  });
});
