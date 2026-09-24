import { describe, it, expect } from "vitest";
import { consolidateLeverFromActions } from "@/lib/leverConsolidate";
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
  popImpacted: "",
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

describe("leverConsolidate — consolidateLeverFromActions (netSavings = savings − recurring OPEX)", () => {
  it("returns undefined when no action has impacts (manual entry lever)", () => {
    expect(consolidateLeverFromActions({ ...baseLever, actions: [] })).toBeUndefined();
  });

  it("netSavings ignores CAPEX entirely (net = savings − recurring OPEX), no temporal weighting", () => {
    const lever: Lever = {
      ...baseLever,
      actions: [
        action({
          impacts: [
            impact({ id: "s1", type: "saving", amount: 10 }),
            impact({
              id: "c1",
              type: "cost",
              nature: "capex",
              amount: 2,
              capexDeploymentDate: "2026-01-01",
            }),
          ],
        }),
      ],
    };
    const result = consolidateLeverFromActions(lever);
    expect(result?.netSavings).toBe(10); // CAPEX (2) hors net
    expect(result?.capex).toBe(2);
  });

  it("one-off OPEX never affects netSavings; recurring OPEX is deducted", () => {
    const lever: Lever = {
      ...baseLever,
      actions: [
        action({
          end: "2026-01-01",
          impacts: [
            impact({ id: "s1", type: "saving", amount: 10 }),
            impact({ id: "c1", type: "cost", nature: "oneoff", amount: 2 }),
            impact({ id: "c2", type: "cost", nature: "opex_rec", amount: 1 }),
          ],
        }),
      ],
    };
    const result = consolidateLeverFromActions(lever);
    expect(result?.netSavings).toBe(9); // 10 − 1 (OPEX rec) ; one-off exclu
    expect(result?.opexOneOff).toBe(2);
    expect(result?.opexRec).toBe(1);
  });

  it("sums capex across multiple actions face-value without touching netSavings", () => {
    const lever: Lever = {
      ...baseLever,
      actions: [
        action({
          id: "A1",
          end: "2026-01-01",
          impacts: [
            impact({
              id: "c1",
              type: "cost",
              nature: "capex",
              amount: 1,
              capexDeploymentDate: "2026-01-01",
            }),
          ],
        }),
        action({
          id: "A2",
          end: "2027-01-01",
          impacts: [
            impact({
              id: "c2",
              type: "cost",
              nature: "capex",
              amount: 3,
              capexDeploymentDate: "2027-01-01",
            }),
          ],
        }),
      ],
    };
    const result = consolidateLeverFromActions(lever);
    // CAPEX (1 + 3) hors net annualisé
    expect(result?.netSavings).toBe(0);
    expect(result?.capex).toBe(4);
  });
});
