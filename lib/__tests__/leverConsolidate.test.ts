import { describe, it, expect } from "vitest";
import { consolidateLeverFromActions, opexRecMultiplier } from "@/lib/leverConsolidate";
import type { ActionImpact, Lever, LeverAction } from "@/types";

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
  status: "in_progress",
  progress: 50,
  risk: "low",
  grossSavings: 0,
  netSavings: 0,
  opexOneOff: 0,
  opexRec: 0,
  capex: 0,
  fteImpact: 0,
  popImpacted: 0,
  dependencies: [],
  description: "Test lever",
  createdAt: "2026-01-01",
  lastUpdate: "2026-06-01",
  actions: [],
};

function action(overrides: Partial<LeverAction>): LeverAction {
  return {
    id: "A1",
    name: "Action test",
    start: "2026-01-01",
    end: "2026-06-01",
    cost: 0,
    status: "in_progress",
    impacts: [],
    ...overrides,
  };
}

function impact(overrides: Partial<ActionImpact>): ActionImpact {
  return {
    id: "IMP1",
    label: "Impact test",
    type: "cost",
    nature: "oneoff",
    amount: 1,
    ...overrides,
  };
}

describe("leverConsolidate — opexRecMultiplier", () => {
  it("returns 1 when fyEnd is absent (face-value, no annualization)", () => {
    expect(opexRecMultiplier("2026-06-01", undefined)).toBe(1);
  });

  it("returns 1 when fyEnd is invalid", () => {
    expect(opexRecMultiplier("2026-06-01", "not-a-date")).toBe(1);
  });

  it("returns the number of remaining years between actionEnd and fyEnd", () => {
    // 2026-01-01 -> 2028-01-01 = ~2 years.
    const years = opexRecMultiplier("2026-01-01", "2028-01-01");
    expect(years).toBeCloseTo(2, 1);
  });

  it("is always at least 1, even if the action ends after fyEnd", () => {
    expect(opexRecMultiplier("2028-01-01", "2026-01-01")).toBe(1);
  });

  it("is always at least 1, even if the action ends just before fyEnd", () => {
    expect(opexRecMultiplier("2026-12-01", "2026-12-31")).toBe(1);
  });
});

describe("leverConsolidate — consolidateLeverFromActions (OPEX récurrent)", () => {
  it("returns undefined when no action has impacts (manual entry lever)", () => {
    expect(consolidateLeverFromActions({ ...baseLever, actions: [] })).toBeUndefined();
  });

  it("without fyEnd: a recurring OPEX cost is counted once, like a one-off (face-value, backward compat)", () => {
    const lever: Lever = {
      ...baseLever,
      actions: [
        action({
          impacts: [
            impact({ id: "s1", type: "saving", amount: 10 }),
            impact({ id: "c1", type: "cost", nature: "opex_rec", amount: 2 }),
          ],
        }),
      ],
    };
    const result = consolidateLeverFromActions(lever);
    expect(result?.netSavings).toBe(8); // 10 - 2, no annualization
    expect(result?.opexRec).toBe(2); // face-value run-rate, unchanged
  });

  it("with fyEnd: a recurring OPEX cost is annualized (multiplied by remaining years) in netSavings, but opexRec (run-rate) stays face-value", () => {
    const lever: Lever = {
      ...baseLever,
      actions: [
        action({
          end: "2026-01-01",
          impacts: [
            impact({ id: "s1", type: "saving", amount: 10 }),
            impact({ id: "c1", type: "cost", nature: "opex_rec", amount: 2 }),
          ],
        }),
      ],
    };
    // 2026-01-01 -> 2028-01-01 = ~2 years remaining.
    const result = consolidateLeverFromActions(lever, "2028-01-01");
    expect(result?.netSavings).toBeCloseTo(10 - 2 * 2, 1); // annualized: 10 - 4 = 6
    expect(result?.opexRec).toBe(2); // run-rate, unaffected by annualization
  });

  it("one-off and capex costs are never annualized, regardless of fyEnd", () => {
    const lever: Lever = {
      ...baseLever,
      actions: [
        action({
          end: "2026-01-01",
          impacts: [
            impact({ id: "s1", type: "saving", amount: 10 }),
            impact({ id: "c1", type: "cost", nature: "oneoff", amount: 2 }),
            impact({
              id: "c2",
              type: "cost",
              nature: "capex",
              amount: 1,
              capexDeploymentDate: "2026-01-01",
            }),
          ],
        }),
      ],
    };
    const result = consolidateLeverFromActions(lever, "2030-01-01");
    expect(result?.netSavings).toBe(7); // 10 - 2 - 1, unaffected by the far-future fyEnd
  });

  it("sums annualized opex_rec across multiple actions with different end dates", () => {
    const lever: Lever = {
      ...baseLever,
      actions: [
        action({
          id: "A1",
          end: "2026-01-01", // ~2 years remaining to fyEnd
          impacts: [impact({ id: "c1", type: "cost", nature: "opex_rec", amount: 1 })],
        }),
        action({
          id: "A2",
          end: "2027-01-01", // ~1 year remaining to fyEnd
          impacts: [impact({ id: "c2", type: "cost", nature: "opex_rec", amount: 3 })],
        }),
      ],
    };
    const result = consolidateLeverFromActions(lever, "2028-01-01");
    // netSavings = 0 (no savings) - (1*2 + 3*1) = -5
    expect(result?.netSavings).toBeCloseTo(-5, 1);
    expect(result?.opexRec).toBe(4); // face-value run-rate sum, unaffected
  });
});
