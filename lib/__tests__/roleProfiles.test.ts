import { describe, it, expect } from "vitest";
import {
  assertValidProfiles,
  getPerformanceProfiles,
  getStrategicProfiles,
  hasRole,
  isReadOnlyUser,
} from "@/lib/roleProfiles";
import { resolveConfidentialityClearance } from "@/lib/leversLogic";
import type { ProfileAssignment } from "@/types";

describe("assertValidProfiles — round multi-profils multi-programmes", () => {
  it("allows zero or one profile per track", () => {
    expect(() => assertValidProfiles([])).not.toThrow();
    expect(() => assertValidProfiles([{ role: "lever" }])).not.toThrow();
    expect(() =>
      assertValidProfiles([{ role: "lever" }, { role: "strategic_lead" }])
    ).not.toThrow();
  });

  it("allows two Performance-track profiles on two DIFFERENT programs", () => {
    const profiles: ProfileAssignment[] = [
      { role: "lever", programId: "p1" },
      { role: "finance", programId: "p2" },
    ];
    expect(() => assertValidProfiles(profiles)).not.toThrow();
  });

  it("allows two Strategic-track profiles on two different programs", () => {
    const profiles: ProfileAssignment[] = [
      { role: "chantier_owner", programId: "p1" },
      { role: "axis_sponsor", programId: "p2" },
    ];
    expect(() => assertValidProfiles(profiles)).not.toThrow();
  });

  it("rejects two Performance-track profiles on the SAME program", () => {
    const profiles: ProfileAssignment[] = [
      { role: "lever", programId: "p1" },
      { role: "finance", programId: "p1" },
    ];
    expect(() => assertValidProfiles(profiles)).toThrow(/un seul profil/i);
  });

  it("rejects mixing a global (no programId) profile with a scoped one on the same track", () => {
    const profiles: ProfileAssignment[] = [{ role: "lever" }, { role: "finance", programId: "p1" }];
    expect(() => assertValidProfiles(profiles)).toThrow(/tous les programmes/i);
  });

  it("rejects two global profiles on the same track (both unscoped)", () => {
    const profiles: ProfileAssignment[] = [{ role: "lever" }, { role: "finance" }];
    expect(() => assertValidProfiles(profiles)).toThrow(/tous les programmes/i);
  });
});

describe("getPerformanceProfiles / getStrategicProfiles", () => {
  it("returns all matching profiles, not just the first", () => {
    const user = {
      profiles: [
        { role: "lever" as const, programId: "p1" },
        { role: "finance" as const, programId: "p2" },
        { role: "chantier_owner" as const, programId: "p1" },
      ],
    };
    expect(getPerformanceProfiles(user)).toHaveLength(2);
    expect(getStrategicProfiles(user)).toHaveLength(1);
  });

  it("returns an empty array for a user with no matching profiles", () => {
    expect(getPerformanceProfiles({ profiles: [] })).toEqual([]);
    expect(getPerformanceProfiles(null)).toEqual([]);
  });
});

describe("hasRole — multi-profile safe", () => {
  it("finds a role anywhere among multiple profiles", () => {
    const user = {
      profiles: [
        { role: "finance" as const, programId: "p1" },
        { role: "lever" as const, programId: "p2" },
      ],
    };
    expect(hasRole(user, "lever")).toBe(true);
    expect(hasRole(user, "hr")).toBe(false);
  });
});

describe("resolveConfidentialityClearance — unions across multiple profiles of the same track", () => {
  it("unions roleClearance levels across all Performance-track profiles", () => {
    const user = {
      profiles: [
        { role: "lever" as const, programId: "p1" },
        { role: "finance" as const, programId: "p2" },
      ],
    };
    const roleClearance = { lever: ["confidential"], finance: ["secret"] };
    const result = resolveConfidentialityClearance(user, roleClearance, "performance");
    expect(result).not.toBe("all");
    expect((result as string[]).sort()).toEqual(["confidential", "secret"]);
  });

  it("an explicit individual override still takes priority over the union", () => {
    const user = {
      profiles: [{ role: "lever" as const, programId: "p1" }],
      confidentialityClearance: "all" as const,
    };
    expect(resolveConfidentialityClearance(user, { lever: ["confidential"] }, "performance")).toBe(
      "all"
    );
  });
});

describe("isReadOnlyUser — round 25 (gate d'édition COMEX)", () => {
  it("is read-only when the user's ONLY profile is comex_member", () => {
    expect(isReadOnlyUser({ profiles: [{ role: "comex_member" }] })).toBe(true);
  });

  it("is read-only when comex_member is held on both tracks (two profiles, both comex_member)", () => {
    expect(
      isReadOnlyUser({
        profiles: [
          { role: "comex_member", programId: "p1" },
          { role: "comex_member", programId: "p2" },
        ],
      })
    ).toBe(true);
  });

  it("is NOT read-only when the user also holds an edit-granting role alongside comex_member", () => {
    expect(
      isReadOnlyUser({
        profiles: [
          { role: "comex_member", programId: "p1" },
          { role: "chantier_owner", programId: "p2" },
        ],
      })
    ).toBe(false);
  });

  it("is NOT read-only for an ordinary business role", () => {
    expect(isReadOnlyUser({ profiles: [{ role: "lever" }] })).toBe(false);
  });

  it("is NOT read-only for a user with no profiles at all", () => {
    expect(isReadOnlyUser({ profiles: [] })).toBe(false);
    expect(isReadOnlyUser(null)).toBe(false);
    expect(isReadOnlyUser(undefined)).toBe(false);
  });

  it("an admin is never read-only, even with only a comex_member profile", () => {
    expect(isReadOnlyUser({ profiles: [{ role: "comex_member" }], isGlobalAdmin: true })).toBe(
      false
    );
    expect(isReadOnlyUser({ profiles: [{ role: "comex_member" }], isCompanyAdmin: true })).toBe(
      false
    );
  });
});
