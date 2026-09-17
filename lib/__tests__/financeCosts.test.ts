import { describe, it, expect } from "vitest";
import {
  bucketCostsByPeriod,
  bucketRecurrentOpexByPeriod,
  flattenCostImpacts,
  isCostEngaged,
  splitByNature,
  splitEngagedVsUpcoming,
} from "@/lib/financeCosts";
import type { ActionImpact, BeTrackData, Lever, LeverAction } from "@/types";

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

function makeData(levers: Lever[]): BeTrackData {
  return {
    program: {
      id: "P01",
      name: "Test Program",
      sponsor: "CEO",
      target: 50,
      currency: "€M",
      fyStart: "2026-01-01",
      fyEnd: "2026-12-31",
      baselineEBIT: 100,
      revenue: 500,
    },
    workstreams: [
      {
        id: "WS-01",
        name: "Workstream Un",
        sponsor: "S",
        function: "F",
        color: "#000",
        target: 10,
      },
    ],
    leverStatuses: [],
    riskLevels: [],
    leverTypes: [],
    geographies: [],
    functions: [],
    pnlAccounts: [{ id: "PNL01", name: "Compte Un", baseline: 0, sign: 1 }],
    levers,
    workforce: {
      totalFTE: 200,
      massSalary: 15,
      budgetSalary: 16,
      departments: [],
      employees: [],
      movements: [],
    },
    operations: {
      lines: [],
      kpisBaseline: { oeeAvg: 0, throughput: 0, scrapRate: 0, otd: 0 },
      kpisTarget: { oeeAvg: 0, throughput: 0, scrapRate: 0, otd: 0 },
      kpisActual: { oeeAvg: 0, throughput: 0, scrapRate: 0, otd: 0 },
    },
    alerts: [],
    audit: [],
    comments: {},
  };
}

const TODAY = new Date("2026-06-15");

describe("financeCosts — flattenCostImpacts", () => {
  it("only keeps type=cost impacts, excludes cancelled levers", () => {
    const lever = {
      ...baseLever,
      actions: [
        action({
          impacts: [
            impact({ id: "c1", type: "cost", amount: 2 }),
            impact({ id: "s1", type: "saving", amount: 5 }),
          ],
        }),
      ],
    };
    const cancelledLever = {
      ...baseLever,
      id: "L002",
      status: "cancelled" as const,
      actions: [action({ impacts: [impact({ id: "c2", type: "cost", amount: 9 })] })],
    };
    const rows = flattenCostImpacts(makeData([lever, cancelledLever]));
    expect(rows).toHaveLength(1);
    expect(rows[0].impact.id).toBe("c1");
  });
});

describe("financeCosts — isCostEngaged", () => {
  it("CAPEX one-shot: engaged once capexDeploymentDate has passed", () => {
    const a = action({ status: "todo" });
    const past = impact({ nature: "capex", capexDeploymentDate: "2026-01-01" });
    const future = impact({ nature: "capex", capexDeploymentDate: "2026-12-01" });
    expect(isCostEngaged({ impact: past, action: a }, TODAY)).toBe(true);
    expect(isCostEngaged({ impact: future, action: a }, TODAY)).toBe(false);
  });

  it("CAPEX smoothed: engaged once capexStartDate has passed", () => {
    const a = action({ status: "todo" });
    const smoothed = impact({
      nature: "capex",
      capexAllocationMode: "smoothed",
      capexStartDate: "2026-03-01",
      capexDeploymentDate: "2026-09-01",
    });
    expect(isCostEngaged({ impact: smoothed, action: a }, TODAY)).toBe(true);
  });

  it("OPEX without a CAPEX date falls back to the action's status/start", () => {
    const oneoff = impact({ nature: "oneoff" });
    expect(isCostEngaged({ impact: oneoff, action: action({ status: "done" }) }, TODAY)).toBe(true);
    expect(isCostEngaged({ impact: oneoff, action: action({ status: "todo" }) }, TODAY)).toBe(
      false
    );
    expect(
      isCostEngaged(
        { impact: oneoff, action: action({ status: "in_progress", start: "2026-01-01" }) },
        TODAY
      )
    ).toBe(true);
    expect(
      isCostEngaged(
        { impact: oneoff, action: action({ status: "in_progress", start: "2026-12-01" }) },
        TODAY
      )
    ).toBe(false);
  });
});

describe("financeCosts — splitEngagedVsUpcoming / splitByNature", () => {
  it("sums engaged vs upcoming, and total = engaged + upcoming", () => {
    const lever = {
      ...baseLever,
      actions: [
        action({
          status: "done",
          impacts: [impact({ id: "c1", nature: "oneoff", amount: 3 })],
        }),
        action({
          status: "todo",
          impacts: [impact({ id: "c2", nature: "oneoff", amount: 4 })],
        }),
      ],
    };
    const split = splitEngagedVsUpcoming(makeData([lever]), TODAY);
    expect(split).toEqual({ engaged: 3, upcoming: 4, total: 7 });
  });

  it("splits by nature: capex / opex_rec / oneoff", () => {
    const lever = {
      ...baseLever,
      actions: [
        action({
          impacts: [
            impact({ id: "c1", nature: "capex", amount: 5, capexDeploymentDate: "2026-01-01" }),
            impact({ id: "c2", nature: "opex_rec", amount: 2 }),
            impact({ id: "c3", nature: "oneoff", amount: 1 }),
          ],
        }),
      ],
    };
    expect(splitByNature(makeData([lever]))).toEqual({ capex: 5, opexRec: 2, oneoff: 1 });
  });
});

describe("financeCosts — bucketCostsByPeriod", () => {
  it("buckets a one-shot cost into its reference month, cumulative increases monotonically", () => {
    const lever = {
      ...baseLever,
      actions: [
        action({
          impacts: [
            impact({ id: "c1", nature: "capex", amount: 3, capexDeploymentDate: "2026-01-15" }),
            impact({ id: "c2", nature: "capex", amount: 2, capexDeploymentDate: "2026-02-10" }),
          ],
        }),
      ],
    };
    const points = bucketCostsByPeriod(makeData([lever]), "month");
    expect(points.map((p) => p.delta)).toEqual([3, 2]);
    expect(points.map((p) => p.cumulative)).toEqual([3, 5]);
  });

  it("prorates a smoothed CAPEX across the months of its allocation period", () => {
    const lever = {
      ...baseLever,
      actions: [
        action({
          impacts: [
            impact({
              id: "c1",
              nature: "capex",
              amount: 3,
              capexAllocationMode: "smoothed",
              capexStartDate: "2026-01-01",
              capexDeploymentDate: "2026-03-01",
            }),
          ],
        }),
      ],
    };
    const points = bucketCostsByPeriod(makeData([lever]), "month");
    // 3 months (Jan, Feb, Mar) => 1€M per month.
    expect(points).toHaveLength(3);
    expect(points.every((p) => p.delta === 1)).toBe(true);
  });
});

describe("financeCosts — bucketRecurrentOpexByPeriod", () => {
  it("only includes opex_rec impacts, bucketed on the action start date", () => {
    const lever = {
      ...baseLever,
      actions: [
        action({
          start: "2026-01-05",
          impacts: [
            impact({ id: "c1", nature: "opex_rec", amount: 1.5 }),
            impact({ id: "c2", nature: "oneoff", amount: 9 }),
          ],
        }),
      ],
    };
    const points = bucketRecurrentOpexByPeriod(makeData([lever]), "year");
    expect(points).toEqual([{ period: "2026", sortKey: "2026", delta: 1.5, cumulative: 1.5 }]);
  });
});
