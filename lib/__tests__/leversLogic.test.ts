import { describe, it, expect } from "vitest";
import {
  applyPlanLock,
  createAction,
  updateAction,
  createLever,
  updateLever,
  resolveConfidentialityClearance,
  isLeverVisibleForClearance,
  canUserViewLever,
  isLeverOwnedBy,
  isLeverSponsoredBy,
  isLeverCtoOf,
  requestLeverApproval,
  approveLeverApprovalStep,
  rejectLeverApproval,
} from "@/lib/leversLogic";
import type { Lever, LeverStatus } from "@/types";

describe("canUserViewLever", () => {
  const user = {
    profiles: [{ role: "lever" as const }],
    name: "Test Lever Owner",
    username: "test.lever.owner",
    companyId: "c1",
  };

  it("allows a lever owner to access their own lever", () => {
    expect(canUserViewLever(user, { ...baseLever, companyId: "c1" }, {})).toBe(true);
  });

  it("blocks a lever owner from a different owner's lever", () => {
    expect(
      canUserViewLever(user, { ...baseLever, owner: "Another Owner", companyId: "c1" }, {})
    ).toBe(false);
  });
});

describe("canUserViewLever — sponsor scoping", () => {
  const sponsorUser = {
    profiles: [{ role: "sponsor" as const }],
    name: "Test Sponsor",
    username: "test.sponsor",
    companyId: "c1",
  };
  const workstreams = [
    { id: "WS-01", sponsorUsername: "test.sponsor" },
    { id: "WS-02", sponsorUsername: "someone.else" },
  ];

  it("allows a sponsor to view a lever of a workstream they sponsor", () => {
    expect(
      canUserViewLever(sponsorUser, { ...baseLever, ws: "WS-01", companyId: "c1" }, {}, workstreams)
    ).toBe(true);
  });

  it("allows a sponsor to view a lever they individually sponsor, even in another workstream", () => {
    expect(
      canUserViewLever(
        sponsorUser,
        { ...baseLever, ws: "WS-02", sponsorUsername: "test.sponsor", companyId: "c1" },
        {},
        workstreams
      )
    ).toBe(true);
  });

  it("blocks a sponsor from a lever they neither sponsor nor whose workstream they sponsor", () => {
    expect(
      canUserViewLever(
        sponsorUser,
        { ...baseLever, ws: "WS-02", sponsorUsername: "someone.else", companyId: "c1" },
        {},
        workstreams
      )
    ).toBe(false);
  });

  it("without workstreams passed in, falls back to individual sponsor match only", () => {
    expect(
      canUserViewLever(
        sponsorUser,
        { ...baseLever, ws: "WS-01", sponsor: "Nobody", companyId: "c1" },
        {}
        // no workstreams arg
      )
    ).toBe(false);
  });
});

describe("isLeverSponsoredBy", () => {
  const user = { name: "Test Sponsor", username: "test.sponsor" };

  it("matches via the workstream's sponsorUsername", () => {
    expect(isLeverSponsoredBy({ sponsor: "Nobody" }, "test.sponsor", user)).toBe(true);
  });

  it("matches via the lever's own sponsorUsername, even without a workstream match", () => {
    expect(
      isLeverSponsoredBy({ sponsor: "Nobody", sponsorUsername: "test.sponsor" }, undefined, user)
    ).toBe(true);
  });

  it("falls back to normalized name comparison for legacy (un-reconciled) levers", () => {
    expect(isLeverSponsoredBy({ sponsor: "Test Sponsor" }, undefined, user)).toBe(true);
    expect(isLeverSponsoredBy({ sponsor: "Someone Else" }, undefined, user)).toBe(false);
  });

  it("an id-based sponsorUsername mismatch denies access regardless of the name", () => {
    expect(
      isLeverSponsoredBy(
        { sponsor: "Test Sponsor", sponsorUsername: "someone.else" },
        undefined,
        user
      )
    ).toBe(false);
  });
});

describe("isLeverOwnedBy", () => {
  const user = { name: "Test Lever Owner", username: "test.lever.owner" };

  it("takes the id-based match (ownerUsername) when set, even if the name differs", () => {
    expect(
      isLeverOwnedBy({ owner: "Some Stale Name", ownerUsername: "test.lever.owner" }, user)
    ).toBe(true);
  });

  it("denies access on an ownerUsername mismatch, regardless of the owner name", () => {
    expect(isLeverOwnedBy({ owner: "Test Lever Owner", ownerUsername: "someone.else" }, user)).toBe(
      false
    );
  });

  it("falls back to the free-text name comparison when ownerUsername is not set", () => {
    expect(isLeverOwnedBy({ owner: "Test Lever Owner", ownerUsername: undefined }, user)).toBe(
      true
    );
  });

  it("denies access on a name mismatch when ownerUsername is not set", () => {
    expect(isLeverOwnedBy({ owner: "Another Owner", ownerUsername: undefined }, user)).toBe(false);
  });
});

const baseLever: Lever = {
  id: "L001",
  code: "L001",
  programId: "p1",
  type: "Sourcing",
  name: "Test Lever",
  ws: "WS-01",
  owner: "Test Lever Owner",
  ownerInit: "TL",
  sponsor: "Test Sponsor",
  sponsorInit: "TS",
  geography: "Europe",
  country: "France",
  entity: "Entity A",
  function: "Supply Chain",
  costCenter: "CC01",
  pnlMap: "PNL01",
  start: "2026-01-01",
  end: "2026-12-31",
  status: "idea",
  progress: 0,
  risk: "low",
  grossSavings: 10,
  netSavings: 8,
  opexOneOff: 1,
  opexRec: 0.5,
  capex: 2,
  fteImpact: -5,
  popImpacted: "",
  dependencies: [],
  description: "Test lever",
  createdAt: "2026-01-01",
  lastUpdate: "2026-06-01",
  actions: [],
};

function makeLever(status: LeverStatus, overrides?: Partial<Lever>): Lever {
  return {
    ...baseLever,
    ...overrides,
    status,
  };
}

describe("leversLogic — applyPlanLock", () => {
  it("does nothing for status before L2 (qualified)", () => {
    const lever = makeLever("idea");
    const result = applyPlanLock(lever);
    expect(result.lockedPlan).toBeUndefined();
    expect(result.reforecast).toBeUndefined();
  });

  it("locks plan at L2 (qualified)", () => {
    const lever = makeLever("qualified", {
      grossSavings: 10,
      netSavings: 8,
      opexOneOff: 1,
      opexRec: 0.5,
      capex: 2,
    });
    const result = applyPlanLock(lever);
    expect(result.lockedPlan).toBeDefined();
    expect(result.lockedPlan?.grossSavings).toBe(10);
    expect(result.lockedPlan?.netSavings).toBe(8);
    expect(result.lockedPlan?.opexOneOff).toBe(1);
    expect(result.lockedPlan?.opexRec).toBe(0.5);
    expect(result.lockedPlan?.capex).toBe(2);
    expect(result.reforecast).toBeUndefined();
  });

  it("initializes reforecast at L4 (in_progress) from lockedPlan", () => {
    const lever = makeLever("in_progress", {
      grossSavings: 15,
      netSavings: 12,
      opexOneOff: 2,
      opexRec: 1,
      capex: 3,
    });
    const result = applyPlanLock(lever);
    expect(result.lockedPlan).toBeDefined();
    expect(result.lockedPlan?.grossSavings).toBe(15);
    expect(result.reforecast).toBeDefined();
    expect(result.reforecast?.grossSavings).toBe(15);
  });

  it("initializes reforecast from snapshot when no lockedPlan at L4+", () => {
    const lever = makeLever("in_progress");
    const result = applyPlanLock(lever);
    expect(result.reforecast).toBeDefined();
    expect(result.reforecast?.grossSavings).toBe(lever.grossSavings);
  });

  it("does not overwrite existing lockedPlan", () => {
    const lever = makeLever("qualified", {
      lockedPlan: {
        grossSavings: 5,
        netSavings: 4,
        opexOneOff: 0,
        opexRec: 0,
        capex: 0,
      },
    });
    const result = applyPlanLock(lever);
    expect(result.lockedPlan?.grossSavings).toBe(5);
  });

  it("does not overwrite existing reforecast", () => {
    const lever = makeLever("in_progress", {
      lockedPlan: { grossSavings: 10, netSavings: 8, opexOneOff: 1, opexRec: 0.5, capex: 2 },
      reforecast: { grossSavings: 12, netSavings: 10, opexOneOff: 1, opexRec: 0.5, capex: 2 },
    });
    const result = applyPlanLock(lever);
    expect(result.reforecast?.grossSavings).toBe(12);
  });

  it("does nothing for cancelled status", () => {
    const lever = makeLever("cancelled");
    const result = applyPlanLock(lever);
    expect(result.lockedPlan).toBeUndefined();
    expect(result.reforecast).toBeUndefined();
  });
});

type LeverInput = Omit<Lever, "id" | "createdAt" | "lastUpdate">;

function omitBaseLever(): LeverInput {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, createdAt, lastUpdate, ...rest } = baseLever;
  return rest;
}

describe("leversLogic — createLever", () => {
  it("creates a lever with auto-generated id", () => {
    const result = createLever([], omitBaseLever(), "testuser");
    expect(result.lever.id).toBe("L001");
    expect(result.lever.createdAt).toBeDefined();
    expect(result.lever.lastUpdate).toBeDefined();
    expect(result.levers).toHaveLength(1);
  });

  it("generates sequential ids", () => {
    const existing = [
      { ...baseLever, id: "L001" },
      { ...baseLever, id: "L003" },
    ];
    const result = createLever(existing as Lever[], omitBaseLever(), "user");
    expect(result.lever.id).toBe("L004");
  });

  it("creates audit entry", () => {
    const result = createLever([], omitBaseLever(), "alice");
    expect(result.auditEntries).toHaveLength(1);
    expect(result.auditEntries[0].action).toBe("created");
    expect(result.auditEntries[0].user).toBe("alice");
  });
});

describe("leversLogic — updateLever (status change & plan lock triggering)", () => {
  it("updates status from idea to in_progress and triggers plan lock", () => {
    const levers = [makeLever("idea")];
    const result = updateLever(levers, "L001", { status: "in_progress" }, "user");
    expect(result.lever.status).toBe("in_progress");
    expect(result.lever.reforecast).toBeDefined();
  });

  it("triggers lockedPlan when status reaches qualified via the approval cascade bypass", () => {
    // Round "cascade de validation" : le seul chemin légitime vers status="qualified" est
    // approveLeverApprovalStep (dernière étape CTO), qui patche `approval` ET `status` dans le
    // même appel — voir le garde-fou documenté dans updateLever.
    const levers = [makeLever("idea", { grossSavings: 20, netSavings: 15 })];
    const result = updateLever(
      levers,
      "L001",
      { status: "qualified", approval: undefined },
      "user"
    );
    expect(result.lever.status).toBe("qualified");
    expect(result.lever.lockedPlan).toBeDefined();
    expect(result.lever.lockedPlan?.grossSavings).toBe(20);
    expect(result.lever.lockedPlan?.netSavings).toBe(15);
  });

  it("silently ignores a direct status:'qualified' patch that bypasses the approval cascade", () => {
    const levers = [makeLever("idea", { grossSavings: 20, netSavings: 15, progress: 10 })];
    const result = updateLever(levers, "L001", { status: "qualified", progress: 40 }, "user");
    // Le champ status est ignoré silencieusement...
    expect(result.lever.status).toBe("idea");
    expect(result.lever.lockedPlan).toBeUndefined();
    // ...mais les autres champs légitimes du même patch s'appliquent quand même.
    expect(result.lever.progress).toBe(40);
  });

  it("protects financial fields once lockedPlan exists", () => {
    const levers = [
      makeLever("qualified", {
        lockedPlan: { grossSavings: 10, netSavings: 8, opexOneOff: 1, opexRec: 0.5, capex: 2 },
        grossSavings: 10,
        netSavings: 8,
      }),
    ];
    const result = updateLever(levers, "L001", { grossSavings: 99, netSavings: 99 }, "user");
    expect(result.lever.grossSavings).toBe(10);
    expect(result.lever.netSavings).toBe(8);
  });

  it("creates audit entries for changed fields", () => {
    const levers = [makeLever("idea")];
    const result = updateLever(levers, "L001", { status: "qualified", owner: "New Owner" }, "user");
    expect(result.auditEntries.length).toBeGreaterThanOrEqual(1);
    expect(result.auditEntries[0].user).toBe("user");
  });

  it("throws for non-existent lever", () => {
    expect(() => updateLever([], "L999", { status: "qualified" }, "user")).toThrow(
      'Lever "L999" introuvable'
    );
  });

  it("captures cancelledAtStage with the status left when cancelling", () => {
    const levers = [makeLever("in_progress")];
    const result = updateLever(levers, "L001", { status: "cancelled" }, "user");
    expect(result.lever.status).toBe("cancelled");
    expect(result.lever.cancelledAtStage).toBe("in_progress");
  });

  it("does not set cancelledAtStage on non-cancelling updates", () => {
    const levers = [makeLever("idea")];
    const result = updateLever(levers, "L001", { status: "qualified" }, "user");
    expect(result.lever.cancelledAtStage).toBeUndefined();
  });

  it("does not overwrite cancelledAtStage on further updates once cancelled", () => {
    const levers = [makeLever("cancelled", { cancelledAtStage: "validated" })];
    const result = updateLever(levers, "L001", { owner: "New Owner" }, "user");
    expect(result.lever.cancelledAtStage).toBe("validated");
  });
});

describe("leversLogic — enriched action consolidation", () => {
  const lockedLever = makeLever("in_progress", {
    progress: 0,
    lockedPlan: { grossSavings: 5, netSavings: 4, opexOneOff: 0.2, opexRec: 0, capex: 1 },
    reforecast: { grossSavings: 5, netSavings: 4, opexOneOff: 0.2, opexRec: 0, capex: 1 },
    actions: [],
  });

  it("creates an action and recomputes the parent reforecast and FTE", () => {
    const result = createAction(
      [lockedLever],
      { leverId: "L001" },
      {
        name: "Déploiement",
        start: "2026-01-01",
        end: "2026-03-31",
        status: "done",
        cost: 0,
        impacts: [
          {
            id: "I-COST",
            label: "Licence",
            type: "cost",
            nature: "capex",
            amount: 1,
          },
          {
            id: "I-SAVE",
            label: "Productivité",
            type: "saving",
            nature: "opex_rec",
            amount: 3,
            fteCount: -4,
          },
        ],
      },
      "alice"
    );

    expect(result.action.deliveredDate).toBeDefined();
    expect(result.changedLever?.progress).toBe(100);
    expect(result.changedLever?.status).toBe("delivered");
    // netSavings = savings − opexRec (lib/leverConsolidate.ts) : le CAPEX (1) ne réduit plus
    // netSavings, il reste calculé/consolidé à part (KPI "CAPEX & coûts one-off").
    expect(result.changedLever?.reforecast).toEqual({
      grossSavings: 3,
      netSavings: 3,
      capex: 1,
      opexOneOff: 0,
      opexRec: 0,
    });
    expect(result.changedLever?.fteImpact).toBe(-4);
  });

  it("weights action progress by financial exposure", () => {
    const lever = {
      ...lockedLever,
      actions: [
        {
          id: "A1",
          name: "Petit coût",
          start: "2026-01-01",
          end: "2026-02-01",
          status: "done" as const,
          cost: 0,
          impacts: [
            {
              id: "I1",
              label: "Petit",
              type: "cost" as const,
              nature: "oneoff" as const,
              amount: 1,
            },
          ],
        },
        {
          id: "A2",
          name: "Gros gain",
          start: "2026-02-01",
          end: "2026-06-01",
          status: "todo" as const,
          cost: 0,
          impacts: [
            {
              id: "I2",
              label: "Gros",
              type: "saving" as const,
              nature: "opex_rec" as const,
              amount: 9,
            },
          ],
        },
      ],
    };

    const result = updateAction([lever], { leverId: "L001" }, "A1", { status: "done" }, "alice");
    expect(result.changedLever?.progress).toBe(10);
  });

  it("clears deliveredDate when a done action is reopened", () => {
    const lever = {
      ...lockedLever,
      actions: [
        {
          id: "A1",
          name: "Action",
          start: "2026-01-01",
          end: "2026-02-01",
          status: "done" as const,
          deliveredDate: "2026-02-01",
          cost: 0,
          impacts: [
            {
              id: "I1",
              label: "Gain",
              type: "saving" as const,
              nature: "opex_rec" as const,
              amount: 2,
            },
          ],
        },
      ],
    };

    const result = updateAction(
      [lever],
      { leverId: "L001" },
      "A1",
      { status: "in_progress" },
      "alice"
    );
    expect(result.action.deliveredDate).toBeUndefined();
  });
});

describe("leversLogic — resolveConfidentialityClearance", () => {
  it("returns [] for a null/undefined user", () => {
    expect(resolveConfidentialityClearance(null, { cto: ["public"] })).toEqual([]);
    expect(resolveConfidentialityClearance(undefined, { cto: ["public"] })).toEqual([]);
  });

  it('returns "all" when the individual override is "all"', () => {
    const user = { profiles: [{ role: "cto" as const }], confidentialityClearance: "all" as const };
    expect(resolveConfidentialityClearance(user, { cto: ["public"] })).toBe("all");
  });

  it("returns the individual override array (even empty) when defined, ignoring roleClearance", () => {
    const userEmpty = {
      profiles: [{ role: "cto" as const }],
      confidentialityClearance: [] as string[],
    };
    expect(resolveConfidentialityClearance(userEmpty, { cto: ["public", "secret"] })).toEqual([]);

    const userCustom = {
      profiles: [{ role: "cto" as const }],
      confidentialityClearance: ["secret"],
    };
    expect(resolveConfidentialityClearance(userCustom, { cto: ["public"] })).toEqual(["secret"]);
  });

  it(
    "grants MORE access than the role default when the individual override says so — the " +
      "'additional access from the Users page' use case (e.g. a 'lever' role, which has no " +
      "roleClearance entry at all, given an explicit clearance including a level its role never sees)",
    () => {
      const user = {
        profiles: [{ role: "lever" as const }],
        confidentialityClearance: ["executive-only"],
      };
      // roleClearance has no entry for "lever" at all -> role default would be [] (see next test).
      expect(resolveConfidentialityClearance(user, { cto: ["public"] })).toEqual([
        "executive-only",
      ]);

      // Same idea but via the "all" override: broader than any role's configured levels.
      const userAll = {
        profiles: [{ role: "lever" as const }],
        confidentialityClearance: "all" as const,
      };
      expect(resolveConfidentialityClearance(userAll, { cto: ["public"], lever: ["public"] })).toBe(
        "all"
      );
    }
  );

  it("falls back to Company.roleClearance[role] when the override is undefined", () => {
    const user = { profiles: [{ role: "cto" as const }], confidentialityClearance: undefined };
    expect(resolveConfidentialityClearance(user, { cto: ["public", "secret"] })).toEqual([
      "public",
      "secret",
    ]);
  });

  it("falls back to [] when roleClearance has no entry for the role", () => {
    const user = { profiles: [{ role: "hr" as const }], confidentialityClearance: undefined };
    expect(resolveConfidentialityClearance(user, { cto: ["public"] })).toEqual([]);
    expect(resolveConfidentialityClearance(user, undefined)).toEqual([]);
  });
});

describe("leversLogic — isLeverVisibleForClearance", () => {
  it("is always visible when the lever has no confidentiality level", () => {
    expect(isLeverVisibleForClearance(undefined, [])).toBe(true);
    expect(isLeverVisibleForClearance(undefined, "all")).toBe(true);
  });

  it('is visible for any level when clearance is "all"', () => {
    expect(isLeverVisibleForClearance("secret", "all")).toBe(true);
  });

  it("is visible only if the level is included in the array clearance", () => {
    expect(isLeverVisibleForClearance("secret", ["public"])).toBe(false);
    expect(isLeverVisibleForClearance("secret", ["public", "secret"])).toBe(true);
    expect(isLeverVisibleForClearance("secret", [])).toBe(false);
  });

  it(
    "end-to-end: an individual override that grants MORE than the role default actually " +
      "unlocks a lever the role would otherwise never see",
    () => {
      const roleClearance = { lever: ["public"] };
      const restrictedLever = { confidentialityLevel: "executive-only" };

      // Without an override, the "lever" role only sees "public" -> this lever stays hidden.
      const defaultUser = {
        profiles: [{ role: "lever" as const }],
        confidentialityClearance: undefined,
      };
      const defaultClearance = resolveConfidentialityClearance(defaultUser, roleClearance);
      expect(
        isLeverVisibleForClearance(restrictedLever.confidentialityLevel, defaultClearance)
      ).toBe(false);

      // With an individual override granting the extra level, the same lever becomes visible.
      const upgradedUser = {
        profiles: [{ role: "lever" as const }],
        confidentialityClearance: ["public", "executive-only"],
      };
      const upgradedClearance = resolveConfidentialityClearance(upgradedUser, roleClearance);
      expect(
        isLeverVisibleForClearance(restrictedLever.confidentialityLevel, upgradedClearance)
      ).toBe(true);
    }
  );
});

describe("isLeverCtoOf", () => {
  const lever = { programId: "p1" };

  it("returns true for a global CTO profile (no programId)", () => {
    const user = { profiles: [{ role: "cto" as const }] };
    expect(isLeverCtoOf(lever, user)).toBe(true);
  });

  it("returns true for a CTO profile scoped to the lever's program", () => {
    const user = { profiles: [{ role: "cto" as const, programId: "p1" }] };
    expect(isLeverCtoOf(lever, user)).toBe(true);
  });

  it("returns false for a CTO profile scoped to a different program", () => {
    const user = { profiles: [{ role: "cto" as const, programId: "p2" }] };
    expect(isLeverCtoOf(lever, user)).toBe(false);
  });

  it("returns false for a user without the cto role", () => {
    const user = { profiles: [{ role: "lever" as const }] };
    expect(isLeverCtoOf(lever, user)).toBe(false);
  });
});

describe("approval cascade (requestLeverApproval / approveLeverApprovalStep / rejectLeverApproval)", () => {
  const owner = {
    name: "Test Lever Owner",
    username: "test.lever.owner",
    profiles: [{ role: "lever" as const }],
  };
  const sponsor = {
    name: "Test Sponsor",
    username: "test.sponsor",
    profiles: [{ role: "sponsor" as const }],
  };
  const cto = {
    name: "Test Cto",
    username: "test.cto",
    profiles: [{ role: "cto" as const }],
  };
  const stranger = {
    name: "Stranger",
    username: "stranger",
    profiles: [{ role: "lever" as const }],
  };
  const admin = {
    name: "Admin",
    username: "admin",
    profiles: [],
    isGlobalAdmin: true,
  };
  const workstreams = [{ id: "WS-01", sponsorUsername: "test.sponsor" }];

  function qualifiedLever(overrides?: Partial<Lever>): Lever {
    return makeLever("idea", {
      ownerUsername: "test.lever.owner",
      ws: "WS-01",
      ...overrides,
    });
  }

  describe("requestLeverApproval", () => {
    it("lets the lever owner submit a request, moving pendingStep to sponsor", () => {
      const levers = [qualifiedLever()];
      const result = requestLeverApproval(levers, "L001", owner);
      expect(result.lever.approval?.pendingStep).toBe("sponsor");
      expect(result.lever.approval?.requestedBy).toBe("test.lever.owner");
      expect(result.lever.approval?.ownerApprovedAt).toBeDefined();
      expect(result.auditEntries[0].action).toBe("approval_requested");
    });

    it("lets an admin submit a request on behalf of the owner", () => {
      const levers = [qualifiedLever()];
      const result = requestLeverApproval(levers, "L001", admin);
      expect(result.lever.approval?.pendingStep).toBe("sponsor");
    });

    it("throws when the caller is neither the owner nor an admin", () => {
      const levers = [qualifiedLever()];
      expect(() => requestLeverApproval(levers, "L001", stranger)).toThrow();
    });

    it("throws when the lever is not at status 'idea'", () => {
      const levers = [makeLever("qualified", { ownerUsername: "test.lever.owner" })];
      expect(() => requestLeverApproval(levers, "L001", owner)).toThrow();
    });
  });

  describe("approveLeverApprovalStep", () => {
    function leverPendingSponsor(overrides?: Partial<Lever>): Lever {
      return qualifiedLever({
        approval: {
          pendingStep: "sponsor",
          ownerApprovedAt: "2026-01-01T00:00:00.000Z",
          requestedBy: "test.lever.owner",
          requestedAt: "2026-01-01T00:00:00.000Z",
        },
        ...overrides,
      });
    }

    it("moves pendingStep from sponsor to cto when the workstream sponsor approves", () => {
      const levers = [leverPendingSponsor()];
      const result = approveLeverApprovalStep(levers, "L001", "sponsor", sponsor, workstreams);
      expect(result.lever.approval?.pendingStep).toBe("cto");
      expect(result.lever.approval?.sponsorApprovedAt).toBeDefined();
      expect(result.lever.status).toBe("idea");
    });

    it("throws when a non-sponsor tries to approve the sponsor step", () => {
      const levers = [leverPendingSponsor()];
      expect(() =>
        approveLeverApprovalStep(levers, "L001", "sponsor", stranger, workstreams)
      ).toThrow();
    });

    it("throws when approving the wrong step (cto tries to approve while pendingStep is sponsor)", () => {
      const levers = [leverPendingSponsor()];
      expect(() => approveLeverApprovalStep(levers, "L001", "cto", cto, workstreams)).toThrow();
    });

    it("completes the cascade at the cto step: clears approval and sets status to qualified with lockedPlan", () => {
      const levers = [
        leverPendingSponsor({
          approval: {
            pendingStep: "cto",
            ownerApprovedAt: "2026-01-01T00:00:00.000Z",
            sponsorApprovedAt: "2026-01-02T00:00:00.000Z",
            requestedBy: "test.lever.owner",
            requestedAt: "2026-01-01T00:00:00.000Z",
          },
          grossSavings: 20,
          netSavings: 15,
        }),
      ];
      const result = approveLeverApprovalStep(levers, "L001", "cto", cto, workstreams);
      expect(result.lever.approval).toBeUndefined();
      expect(result.lever.status).toBe("qualified");
      expect(result.lever.lockedPlan?.netSavings).toBe(15);
      expect(result.auditEntries.some((e) => e.action === "approval_approved")).toBe(true);
    });

    it("throws when a non-cto tries to approve the cto step", () => {
      const levers = [
        leverPendingSponsor({
          approval: {
            pendingStep: "cto",
            ownerApprovedAt: "2026-01-01T00:00:00.000Z",
            sponsorApprovedAt: "2026-01-02T00:00:00.000Z",
            requestedBy: "test.lever.owner",
            requestedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ];
      expect(() =>
        approveLeverApprovalStep(levers, "L001", "cto", stranger, workstreams)
      ).toThrow();
    });
  });

  describe("rejectLeverApproval", () => {
    function leverPendingSponsor(): Lever {
      return qualifiedLever({
        approval: {
          pendingStep: "sponsor",
          ownerApprovedAt: "2026-01-01T00:00:00.000Z",
          requestedBy: "test.lever.owner",
          requestedAt: "2026-01-01T00:00:00.000Z",
        },
      });
    }

    it("lets the owner cancel the cascade, clearing approval", () => {
      const levers = [leverPendingSponsor()];
      const result = rejectLeverApproval(levers, "L001", owner, "changed my mind");
      expect(result.lever.approval).toBeUndefined();
      expect(result.lever.status).toBe("idea");
      expect(result.auditEntries[0].action).toBe("approval_rejected");
      expect(result.auditEntries[0].new).toBe("changed my mind");
    });

    it("lets the pending sponsor cancel the cascade", () => {
      const levers = [leverPendingSponsor()];
      const result = rejectLeverApproval(levers, "L001", sponsor, undefined, workstreams);
      expect(result.lever.approval).toBeUndefined();
    });

    it("lets an admin cancel the cascade", () => {
      const levers = [leverPendingSponsor()];
      const result = rejectLeverApproval(levers, "L001", admin);
      expect(result.lever.approval).toBeUndefined();
    });

    it("throws when the caller has no standing to cancel", () => {
      const levers = [leverPendingSponsor()];
      expect(() => rejectLeverApproval(levers, "L001", stranger)).toThrow();
    });

    it("throws when there is no cascade in progress", () => {
      const levers = [qualifiedLever()];
      expect(() => rejectLeverApproval(levers, "L001", owner)).toThrow();
    });
  });
});
