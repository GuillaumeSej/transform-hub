import { describe, it, expect } from "vitest";
import {
  buildRoleClearanceMatrix,
  describeUserClearance,
  inheritedRoleLevel,
  usersWithClearanceOverride,
  withRoleLevel,
} from "@/lib/confidentialityAdmin";
import { PERFORMANCE_ROLES, STRATEGIC_ROLES, type AuthUser } from "@/types";

const LEVELS = ["Public", "Restreint", "Confidentiel", "Secret"];

const u = (name: string, extra: Partial<AuthUser> = {}) =>
  ({ name, username: name, profiles: [], ...extra }) as Pick<
    AuthUser,
    | "name"
    | "username"
    | "profiles"
    | "confidentialityClearance"
    | "isGlobalAdmin"
    | "isCompanyAdmin"
  >;

describe("inheritedRoleLevel", () => {
  it("retient le niveau le plus haut parmi les profils (legacy normalisé)", () => {
    expect(
      inheritedRoleLevel(
        [{ role: "lever" }, { role: "finance" }],
        { lever: "Restreint", finance: ["Public", "Confidentiel"] },
        LEVELS
      )
    ).toBe("Confidentiel");
  });
  it("undefined sans profil, sans matrice ou niveau inconnu", () => {
    expect(inheritedRoleLevel([], { lever: "Secret" }, LEVELS)).toBeUndefined();
    expect(inheritedRoleLevel([{ role: "lever" }], undefined, LEVELS)).toBeUndefined();
    expect(inheritedRoleLevel([{ role: "lever" }], { lever: "Inconnu" }, LEVELS)).toBeUndefined();
  });
});

describe("describeUserClearance", () => {
  const rc = { lever: "Restreint" } as const;
  it("admin = accès total", () => {
    expect(describeUserClearance(u("a", { isCompanyAdmin: true }), rc, LEVELS)).toEqual({
      kind: "admin",
    });
  });
  it("hérite du rôle quand pas de surcharge", () => {
    expect(describeUserClearance(u("a", { profiles: [{ role: "lever" }] }), rc, LEVELS)).toEqual({
      kind: "inherit",
      level: "Restreint",
    });
  });
  it("surcharges : all / [] / niveau / legacy", () => {
    expect(
      describeUserClearance(u("a", { confidentialityClearance: "all" }), rc, LEVELS).kind
    ).toBe("all");
    expect(describeUserClearance(u("a", { confidentialityClearance: [] }), rc, LEVELS).kind).toBe(
      "none"
    );
    expect(
      describeUserClearance(u("a", { confidentialityClearance: "Secret" }), rc, LEVELS)
    ).toEqual({ kind: "level", level: "Secret" });
    expect(
      describeUserClearance(
        u("a", { confidentialityClearance: ["Public", "Confidentiel"] }),
        rc,
        LEVELS
      )
    ).toEqual({ kind: "level", level: "Confidentiel" });
  });
});

describe("usersWithClearanceOverride", () => {
  it("ne garde que les non-admins avec surcharge, triés par nom", () => {
    const list = [
      u("Zoé", { confidentialityClearance: "Public" }),
      u("Alice", { confidentialityClearance: [] }),
      u("Bob"),
      u("Admin", { isCompanyAdmin: true, confidentialityClearance: "all" }),
    ];
    expect(usersWithClearanceOverride(list).map((x) => x.name)).toEqual(["Alice", "Zoé"]);
  });
});

describe("buildRoleClearanceMatrix", () => {
  it("rôles utilisés + rôles déjà configurés, ordre canonique, comptage par utilisateur", () => {
    const rows = buildRoleClearanceMatrix(
      [
        { profiles: [{ role: "lever" }, { role: "lever", programId: "p2" }] },
        { profiles: [{ role: "cto" }] },
      ],
      [],
      { finance: ["Public", "Secret"] },
      LEVELS
    );
    expect(rows).toEqual([
      { role: "cto", level: undefined, userCount: 1 },
      { role: "lever", level: undefined, userCount: 1 },
      { role: "finance", level: "Secret", userCount: 0 },
    ]);
  });
  it("module activé => tous ses rôles, comex_member une seule fois", () => {
    const rows = buildRoleClearanceMatrix([], ["performance", "strategic"], {}, LEVELS);
    const roles = rows.map((r) => r.role);
    expect(new Set(roles).size).toBe(roles.length);
    expect(roles.length).toBe(new Set([...PERFORMANCE_ROLES, ...STRATEGIC_ROLES]).size);
    const strategicOnly = buildRoleClearanceMatrix([], ["strategic"], {}, LEVELS).map(
      (r) => r.role
    );
    expect(strategicOnly).toEqual(expect.arrayContaining(STRATEGIC_ROLES));
    expect(strategicOnly).not.toContain("cto");
  });
});

describe("withRoleLevel", () => {
  it("fixe, efface, ignore un niveau hors échelle et normalise le legacy", () => {
    expect(withRoleLevel({ lever: ["Public", "Restreint"] }, "cto", "Secret", LEVELS)).toEqual({
      lever: "Restreint",
      cto: "Secret",
    });
    expect(withRoleLevel({ cto: "Secret" }, "cto", "", LEVELS)).toEqual({});
    expect(withRoleLevel({ cto: "Secret" }, "cto", "Inconnu", LEVELS)).toEqual({});
  });
});
