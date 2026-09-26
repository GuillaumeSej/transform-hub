import { describe, it, expect } from "vitest";
import {
  assertValidProfiles,
  getPerformanceProfiles,
  getAuthorizedPrograms,
  getStrategicProfiles,
  hasRole,
  isCrossTrackRole,
  isPerformanceRole,
  isReadOnlyUser,
  canAccessPerformanceProgram,
  isStrategicRole,
  normalizeLegacyProfiles,
} from "@/lib/roleProfiles";
import { resolveConfidentialityClearance } from "@/lib/leversLogic";
import type { ProfileAssignment, Program } from "@/types";

describe("program_sponsor / program_owner — fondation vue consolidée (nouveaux rôles Plan Performance)", () => {
  it("are Performance-track roles, not Strategic", () => {
    expect(isPerformanceRole("program_sponsor")).toBe(true);
    expect(isPerformanceRole("program_owner")).toBe(true);
  });

  it("are counted by getPerformanceProfiles like any other Performance role", () => {
    const user = {
      profiles: [
        { role: "program_sponsor" as const, programId: "p1" },
        { role: "program_owner" as const, programId: "p2" },
      ],
    };
    expect(getPerformanceProfiles(user)).toHaveLength(2);
    expect(getStrategicProfiles(user)).toHaveLength(0);
  });

  it("follow the same one-profile-per-program constraint as other Performance roles", () => {
    expect(() =>
      assertValidProfiles([
        { role: "program_sponsor", programId: "p1" },
        { role: "program_owner", programId: "p1" },
      ])
    ).toThrow(/un seul profil/i);
    expect(() =>
      assertValidProfiles([
        { role: "program_sponsor", programId: "p1" },
        { role: "program_owner", programId: "p2" },
      ])
    ).not.toThrow();
  });
});

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

describe("rôles Plan Stratégique — décision PO (hr transverse, projet_contributor, rôles supprimés)", () => {
  it("hr and comex_member are cross-track; projet_contributor is strategic only", () => {
    expect(isCrossTrackRole("hr")).toBe(true);
    expect(isCrossTrackRole("comex_member")).toBe(true);
    expect(isCrossTrackRole("strategic_lead")).toBe(false);
    expect(isStrategicRole("projet_contributor")).toBe(true);
    expect(isPerformanceRole("projet_contributor")).toBe(false);
  });

  it("normalizeLegacyProfiles maps internal_comm/budget_control to comex_member (same program) and dedupes", () => {
    const legacy = [
      { role: "internal_comm", programId: "s1" },
      { role: "comex_member", programId: "s1" },
      { role: "budget_control" },
      { role: "hr", programId: "p1" },
    ] as unknown as ProfileAssignment[];
    expect(normalizeLegacyProfiles(legacy)).toEqual([
      { role: "comex_member", programId: "s1" },
      { role: "comex_member" },
      { role: "hr", programId: "p1" },
    ]);
  });

  it("isReadOnlyUser(user, programId): read-only when only comex_member/hr on that program", () => {
    const user = {
      profiles: [
        { role: "hr" as const, programId: "s1" },
        { role: "chantier_owner" as const, programId: "s2" },
      ],
    };
    expect(isReadOnlyUser(user, "s1", "strategic")).toBe(true);
    expect(isReadOnlyUser(user, "s2", "strategic")).toBe(false);
    // Sans programme : comportement historique (hr ne verrouille pas).
    expect(isReadOnlyUser(user)).toBe(false);
    expect(isReadOnlyUser({ profiles: [{ role: "hr" }] }, "s1", "strategic")).toBe(true);
    expect(isReadOnlyUser({ profiles: [{ role: "hr" }], isCompanyAdmin: true }, "s1")).toBe(false);
    // Profil "tous programmes" d'une autre piste : ignoré quand le type est connu.
    const mixed = {
      profiles: [{ role: "lever" as const }, { role: "hr" as const, programId: "s1" }],
    };
    expect(isReadOnlyUser(mixed, "s1", "strategic")).toBe(true);
  });

  it("getAuthorizedPrograms: a programId-less comex_member/hr profile sees BOTH program types (COMEX bug fix)", () => {
    const programs = [
      { id: "p1", type: "performance" },
      { id: "s1", type: "strategic" },
    ] as unknown as Program[];
    for (const role of ["comex_member", "hr"] as const) {
      expect(getAuthorizedPrograms({ profiles: [{ role }] }, programs).map((p) => p.id)).toEqual([
        "p1",
        "s1",
      ]);
    }
    expect(
      getAuthorizedPrograms({ profiles: [{ role: "axis_sponsor" }] }, programs).map((p) => p.id)
    ).toEqual(["s1"]);
  });

  it("assertValidProfiles: a cross-track profile scoped to a program counts only in that program's track when types are given", () => {
    const profiles: ProfileAssignment[] = [
      { role: "hr", programId: "p1" },
      { role: "strategic_lead", programId: "s1" },
      { role: "cto", programId: "p2" },
    ];
    expect(() =>
      assertValidProfiles(profiles, { p1: "performance", p2: "performance", s1: "strategic" })
    ).not.toThrow();
    expect(() =>
      assertValidProfiles([
        { role: "hr", programId: "s1" },
        { role: "strategic_lead", programId: "s1" },
      ])
    ).toThrow();
  });
});

describe("isReadOnlyUser — Performance program (hr / comex cross-track)", () => {
  it("comex_member-only on a Performance program is read-only (plan and HR pages)", () => {
    const comex = { profiles: [{ role: "comex_member" as const, programId: "p1" }] };
    expect(isReadOnlyUser(comex, "p1", "performance")).toBe(true);
    expect(isReadOnlyUser(comex, "p1", "performance", "hr")).toBe(true);
  });

  it("hr: read-only on levers (plan), NOT on HR pages", () => {
    const hr = { profiles: [{ role: "hr" as const, programId: "p1" }] };
    expect(isReadOnlyUser(hr, "p1", "performance")).toBe(true);
    expect(isReadOnlyUser(hr, "p1", "performance", "plan")).toBe(true);
    expect(isReadOnlyUser(hr, "p1", "performance", "hr")).toBe(false);
    // Profil hr legacy sans programme : lu comme « tous programmes ».
    expect(isReadOnlyUser({ profiles: [{ role: "hr" as const }] }, "p1", "performance", "hr")).toBe(
      false
    );
  });

  it("comex_member + another profile elsewhere: read-only where only comex applies", () => {
    const user = {
      profiles: [
        { role: "comex_member" as const, programId: "p1" },
        { role: "lever" as const, programId: "p2" },
      ],
    };
    expect(isReadOnlyUser(user, "p1", "performance")).toBe(true);
    expect(isReadOnlyUser(user, "p2", "performance")).toBe(false);
  });
});

describe("assertValidProfiles — a single hr profile per user", () => {
  it("rejects two hr profiles, even on distinct programs", () => {
    expect(() =>
      assertValidProfiles(
        [
          { role: "hr", programId: "p1" },
          { role: "hr", programId: "s1" },
        ],
        { p1: "performance", s1: "strategic" }
      )
    ).toThrow(/un seul profil Directeur RH/i);
  });
});

describe("canAccessPerformanceProgram — direct URL to a lever detail", () => {
  it("requires a profile/right on the lever's program", () => {
    const lever = { username: "u", profiles: [{ role: "lever" as const, programId: "p2" }] };
    expect(canAccessPerformanceProgram(lever, "p2")).toBe(true);
    expect(canAccessPerformanceProgram(lever, "p1")).toBe(false);
    const comex = { username: "u", profiles: [{ role: "comex_member" as const, programId: "p1" }] };
    expect(canAccessPerformanceProgram(comex, "p1")).toBe(true);
    const strategicOnly = { username: "u", profiles: [{ role: "axis_sponsor" as const }] };
    expect(canAccessPerformanceProgram(strategicOnly, "p1")).toBe(false);
    expect(canAccessPerformanceProgram({ ...strategicOnly, isCompanyAdmin: true }, "p1")).toBe(
      true
    );
    const cto = { username: "u", profiles: [{ role: "cto" as const, programId: "p9" }] };
    expect(canAccessPerformanceProgram(cto, "p1")).toBe(true);
    const ps = { username: "u", profiles: [{ role: "program_sponsor" as const, programId: "p9" }] };
    expect(canAccessPerformanceProgram(ps, "p1", { sponsor: "u" })).toBe(true);
    expect(canAccessPerformanceProgram(ps, "p1", { sponsor: "x" })).toBe(false);
  });
});
