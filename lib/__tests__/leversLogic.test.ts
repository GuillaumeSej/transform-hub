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
  leverAccessDenialReason,
  isLeverOwnedBy,
  isLeverSponsoredBy,
  isLeverCtoOf,
  requestLeverApproval,
  approveLeverGate,
  rejectLeverApproval,
  allActionsDone,
  enforceDeliveredRule,
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

  it("prefixes the id with companyId so it never collides with another tenant's bare id", () => {
    // Cas ACME réel : leviers historiques L001…L021 (ids nus), alors que L022 existe déjà chez
    // une autre entreprise — un id nu "L022" faisait refuser l'écriture par firestore.rules.
    const existing = Array.from({ length: 21 }, (_, i) => ({
      ...baseLever,
      id: `L${String(i + 1).padStart(3, "0")}`,
      companyId: "c1",
    }));
    const result = createLever(
      existing as Lever[],
      { ...omitBaseLever(), companyId: "c1" },
      "user"
    );
    expect(result.lever.id).toBe("c1-L022");
    expect(result.lever.companyId).toBe("c1");
  });

  it("creates audit entry", () => {
    const result = createLever([], omitBaseLever(), "alice");
    expect(result.auditEntries).toHaveLength(1);
    expect(result.auditEntries[0].action).toBe("created");
    expect(result.auditEntries[0].user).toBe("alice");
  });
});

describe("leversLogic — updateLever (status change & plan lock triggering)", () => {
  it("updates status from in_progress to delivered freely (M4→M5 stays ungated)", () => {
    const levers = [makeLever("in_progress")];
    const result = updateLever(levers, "L001", { status: "delivered" }, "user");
    expect(result.lever.status).toBe("delivered");
  });

  it.each(["qualified", "validated", "in_progress"] as const)(
    "triggers lockedPlan/reforecast when status reaches '%s' via the approval bypass",
    (targetStatus) => {
      const levers = [makeLever("idea", { grossSavings: 20, netSavings: 15 })];
      const result = updateLever(
        levers,
        "L001",
        { status: targetStatus, approval: undefined },
        "user"
      );
      expect(result.lever.status).toBe(targetStatus);
      expect(result.lever.lockedPlan).toBeDefined();
    }
  );

  it.each(["qualified", "validated", "in_progress"] as const)(
    "silently ignores a direct status:'%s' patch that bypasses the approval request",
    (targetStatus) => {
      const levers = [makeLever("idea", { grossSavings: 20, netSavings: 15, progress: 10 })];
      const result = updateLever(levers, "L001", { status: targetStatus, progress: 40 }, "user");
      // Le champ status est ignoré silencieusement...
      expect(result.lever.status).toBe("idea");
      expect(result.lever.lockedPlan).toBeUndefined();
      // ...mais les autres champs légitimes du même patch s'appliquent quand même.
      expect(result.lever.progress).toBe(40);
    }
  );

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

  it.each(["qualified", "validated", "in_progress", "delivered"] as const)(
    // Reproduit le bug remonté : le stepper de la fiche détail laissait cliquer "Identifié" (M1)
    // depuis n'importe quelle étape plus avancée — "idea" n'est ni gated (GATED_STATUSES) ni auto
    // (delivered), donc AVANT ce correctif rien ne bloquait cette régression à ce niveau.
    "silently ignores a regressive status patch from '%s' back to 'idea' (M1) — a lever never moves backward in the M1→M5 cycle",
    (fromStatus) => {
      const levers = [makeLever(fromStatus)];
      const result = updateLever(levers, "L001", { status: "idea", owner: "New Owner" }, "user");
      // Le champ status est ignoré silencieusement...
      expect(result.lever.status).toBe(fromStatus);
      // ...mais les autres champs légitimes du même patch s'appliquent quand même.
      expect(result.lever.owner).toBe("New Owner");
    }
  );

  it("still allows cancelling from any active status (cancellation is not a cycle regression)", () => {
    const levers = [makeLever("in_progress")];
    const result = updateLever(levers, "L001", { status: "cancelled" }, "user");
    expect(result.lever.status).toBe("cancelled");
  });

  it("still allows reactivating a cancelled lever (not treated as a cycle regression either)", () => {
    const levers = [makeLever("cancelled", { cancelledAtStage: "validated" })];
    const result = updateLever(levers, "L001", { status: "idea" }, "user");
    expect(result.lever.status).toBe("idea");
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
    // netSavings = brut − OPEX récurrent : le CAPEX (1) reste hors net annualisé.
    expect(result.changedLever?.reforecast).toEqual({
      grossSavings: 3,
      netSavings: 3,
      capex: 1,
      opexOneOff: 0,
      opexRec: 0,
    });
    expect(result.changedLever?.fteImpact).toBe(-4);
  });

  it("no longer weights action progress by financial exposure (simple mean without weightPct)", () => {
    const lever = {
      ...lockedLever,
      actions: [
        {
          id: "A1",
          name: "Petit coût",
          start: "2026-01-01",
          end: "2026-02-01",
          status: "done" as const,
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
    expect(result.changedLever?.progress).toBe(50);
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

describe("validation gates (requestLeverApproval / approveLeverGate / rejectLeverApproval)", () => {
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

  function leverAt(status: LeverStatus, overrides?: Partial<Lever>): Lever {
    return makeLever(status, {
      ownerUsername: "test.lever.owner",
      ws: "WS-01",
      ...overrides,
    });
  }

  describe("requestLeverApproval", () => {
    it.each([
      ["idea", "qualified"],
      ["qualified", "validated"],
      ["validated", "in_progress"],
    ] as const)(
      "lets the lever owner submit a request from '%s', targeting '%s'",
      (fromStatus, gate) => {
        const levers = [leverAt(fromStatus)];
        const result = requestLeverApproval(levers, "L001", owner);
        expect(result.lever.approval?.targetStatus).toBe(gate);
        expect(result.lever.approval?.requestedBy).toBe("test.lever.owner");
        expect(result.auditEntries[0].action).toBe("approval_requested");
      }
    );

    it("lets an admin submit a request on behalf of the owner", () => {
      const levers = [leverAt("idea")];
      const result = requestLeverApproval(levers, "L001", admin);
      expect(result.lever.approval?.targetStatus).toBe("qualified");
    });

    it("throws when the caller is neither the owner nor an admin", () => {
      const levers = [leverAt("idea")];
      expect(() => requestLeverApproval(levers, "L001", stranger)).toThrow();
    });

    it.each(["in_progress", "delivered", "cancelled"] as const)(
      "throws when the lever has no gate ahead (status '%s')",
      (status) => {
        const levers = [leverAt(status)];
        expect(() => requestLeverApproval(levers, "L001", owner)).toThrow();
      }
    );
  });

  describe("approveLeverGate", () => {
    function leverPending(targetStatus: "qualified" | "validated" | "in_progress"): Lever {
      const fromStatus =
        targetStatus === "qualified"
          ? "idea"
          : targetStatus === "validated"
            ? "qualified"
            : "validated";
      return leverAt(fromStatus, {
        approval: {
          targetStatus,
          requestedBy: "test.lever.owner",
          requestedAt: "2026-01-01T00:00:00.000Z",
        },
        grossSavings: 20,
        netSavings: 15,
      });
    }

    it.each(["qualified", "validated", "in_progress"] as const)(
      "closes the gate '%s' directly when the workstream sponsor approves (no intermediate step)",
      (gate) => {
        const levers = [leverPending(gate)];
        const result = approveLeverGate(levers, "L001", sponsor, workstreams);
        expect(result.lever.approval).toBeUndefined();
        expect(result.lever.status).toBe(gate);
        expect(result.auditEntries.some((e) => e.action === "approval_approved")).toBe(true);
      }
    );

    it.each(["qualified", "validated", "in_progress"] as const)(
      "closes the gate '%s' directly when the cto approves (no intermediate step)",
      (gate) => {
        const levers = [leverPending(gate)];
        const result = approveLeverGate(levers, "L001", cto, workstreams);
        expect(result.lever.approval).toBeUndefined();
        expect(result.lever.status).toBe(gate);
      }
    );

    it("triggers lockedPlan when the qualified gate closes", () => {
      const result = approveLeverGate([leverPending("qualified")], "L001", cto, workstreams);
      expect(result.lever.lockedPlan?.netSavings).toBe(15);
    });

    it("throws when neither sponsor nor cto (nor admin) tries to approve", () => {
      const levers = [leverPending("qualified")];
      expect(() => approveLeverGate(levers, "L001", stranger, workstreams)).toThrow();
    });

    it("lets an admin approve any gate", () => {
      const levers = [leverPending("qualified")];
      const result = approveLeverGate(levers, "L001", admin, workstreams);
      expect(result.lever.status).toBe("qualified");
    });

    it("throws when there is no approval request in progress", () => {
      const levers = [leverAt("idea")];
      expect(() => approveLeverGate(levers, "L001", sponsor, workstreams)).toThrow();
    });
  });

  describe("rejectLeverApproval", () => {
    function leverPendingSponsor(): Lever {
      return leverAt("idea", {
        approval: {
          targetStatus: "qualified",
          requestedBy: "test.lever.owner",
          requestedAt: "2026-01-01T00:00:00.000Z",
        },
      });
    }

    it("lets the owner cancel the request, clearing approval", () => {
      const levers = [leverPendingSponsor()];
      const result = rejectLeverApproval(levers, "L001", owner, "changed my mind");
      expect(result.lever.approval).toBeUndefined();
      expect(result.lever.status).toBe("idea");
      expect(result.auditEntries[0].action).toBe("approval_rejected");
      expect(result.auditEntries[0].new).toBe("changed my mind");
    });

    it("lets the workstream sponsor cancel the request", () => {
      const levers = [leverPendingSponsor()];
      const result = rejectLeverApproval(levers, "L001", sponsor, undefined, workstreams);
      expect(result.lever.approval).toBeUndefined();
    });

    it("lets the cto cancel the request", () => {
      const levers = [leverPendingSponsor()];
      const result = rejectLeverApproval(levers, "L001", cto, undefined, workstreams);
      expect(result.lever.approval).toBeUndefined();
    });

    it("lets an admin cancel the request", () => {
      const levers = [leverPendingSponsor()];
      const result = rejectLeverApproval(levers, "L001", admin);
      expect(result.lever.approval).toBeUndefined();
    });

    it("throws when the caller has no standing to cancel", () => {
      const levers = [leverPendingSponsor()];
      expect(() => rejectLeverApproval(levers, "L001", stranger)).toThrow();
    });

    it("throws when there is no request in progress", () => {
      const levers = [leverAt("idea")];
      expect(() => rejectLeverApproval(levers, "L001", owner)).toThrow();
    });
  });
});

describe("leversLogic — règle Réalisé / actions", () => {
  const act = (id: string, pct: number) => ({
    id,
    name: id,
    start: "2026-01-01",
    end: "2026-12-31",
    status: (pct >= 100 ? "done" : "in_progress") as "done" | "in_progress",
    declaredProgressPct: pct,
  });
  it("allActionsDone / enforceDeliveredRule", () => {
    expect(allActionsDone({ actions: [] })).toBe(true);
    expect(allActionsDone({ actions: [act("a", 100), act("b", 50)] })).toBe(false);
    expect(enforceDeliveredRule({ status: "delivered", actions: [act("a", 50)] })).toBe(
      "in_progress"
    );
    expect(enforceDeliveredRule({ status: "delivered", actions: [act("a", 100)] })).toBe(
      "delivered"
    );
  });
  it("bloque le passage à Réalisé et retombe à Exécuté quand une action bouge", () => {
    const lever = makeLever("in_progress", { actions: [act("a", 100), act("b", 50)] });
    const blocked = updateLever([lever], lever.id, { status: "delivered" }, "u");
    expect(blocked.lever.status).toBe("in_progress");
    const done = makeLever("delivered", { actions: [act("a", 100), act("b", 100)] });
    const res = updateAction([done], { leverId: done.id }, "b", { declaredProgressPct: 40 }, "u");
    expect(res.changedLever?.status).toBe("in_progress");
  });
});

describe("leversLogic — sponsor de chantier et motif de refus d'accès", () => {
  const sponsor = {
    profiles: [{ role: "sponsor" as const }],
    name: "Jean Dupont",
    username: "jean.dupont",
    companyId: "c1",
  };
  const lever = { ...baseLever, companyId: "c1", sponsor: "Autre Personne", ws: "WS-OPS" };

  it("reconnaît le sponsor d'un chantier saisi par son seul nom (sans compte rattaché)", () => {
    expect(isLeverSponsoredBy(lever, { sponsor: "Jean Dupont" }, sponsor)).toBe(true);
    expect(isLeverSponsoredBy(lever, { sponsor: "Marie Durand" }, sponsor)).toBe(false);
  });

  it("un compte rattaché au chantier prime sur le nom", () => {
    expect(
      isLeverSponsoredBy(
        lever,
        { sponsor: "Jean Dupont", sponsorUsername: "marie.durand" },
        sponsor
      )
    ).toBe(false);
  });

  it("distingue « hors périmètre » et « confidentialité »", () => {
    const workstreams = [{ id: "WS-OPS", sponsor: "Marie Durand" }];
    expect(leverAccessDenialReason(sponsor, lever, {}, workstreams)).toBe("perimeter");
    expect(
      leverAccessDenialReason(sponsor, lever, {}, [{ id: "WS-OPS", sponsor: "Jean Dupont" }])
    ).toBe(null);
    const owner = { ...sponsor, profiles: [{ role: "lever" as const }] };
    expect(
      leverAccessDenialReason(owner, { ...lever, owner: "Jean Dupont" }, { lever: [] }, [], ["C1"])
    ).toBe(null);
    expect(
      leverAccessDenialReason(
        owner,
        { ...lever, owner: "Jean Dupont", confidentialityLevel: "C2" },
        { lever: "C1" },
        [],
        ["C1", "C2"]
      )
    ).toBe("confidentiality");
    expect(canUserViewLever(sponsor, lever, {}, workstreams)).toBe(false);
  });
  it("refuse (motif « program ») un levier d'un programme sur lequel l'utilisateur n'a aucun droit", () => {
    const ws = [{ id: "WS-OPS", sponsor: "Jean Dupont" }];
    const onP2 = { ...sponsor, profiles: [{ role: "sponsor" as const, programId: "P2" }] };
    const leverP1 = { ...lever, programId: "P1" };
    expect(leverAccessDenialReason(onP2, leverP1, {}, ws)).toBe("program");
    expect(leverAccessDenialReason(onP2, { ...lever, programId: "P2" }, {}, ws)).toBe(null);
    // Lecture seule transverse rattachée au programme : autorisée.
    const comex = { ...sponsor, profiles: [{ role: "comex_member" as const, programId: "P1" }] };
    expect(leverAccessDenialReason(comex, leverP1, {}, ws)).toBe(null);
    // program_sponsor désigné du programme (profil rattaché à un autre programme).
    const ps = { ...sponsor, profiles: [{ role: "program_sponsor" as const, programId: "P2" }] };
    expect(leverAccessDenialReason(ps, leverP1, {}, ws)).toBe("program");
    expect(
      leverAccessDenialReason(ps, leverP1, {}, ws, undefined, [
        { id: "P1", sponsor: "jean.dupont", owner: undefined },
      ])
    ).toBe(null);
    // Admin d'entreprise : jamais refusé pour le programme.
    expect(leverAccessDenialReason({ ...onP2, isCompanyAdmin: true }, leverP1, {}, ws)).toBe(null);
  });
});
