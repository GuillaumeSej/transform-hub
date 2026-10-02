import { afterEach, describe, it, expect, vi } from "vitest";
import {
  bucketCostsByPeriod,
  bucketInvestVsSavingsByPeriod,
  bucketRecurrentOpexByPeriod,
  bucketSavingsByPeriod,
  costRowsForPeriod,
  costsByHierarchyNode,
  engagedVsUpcomingRows,
  flattenCostImpacts,
  flattenOneOffGainImpacts,
  flattenSavingImpacts,
  groupCostsByWorkstream,
  investCostRowsBySegment,
  investVsSavingsRowsForPeriod,
  isCostEngaged,
  isInvestNature,
  recurringOpexReconciliation,
  sortedHierarchyLevels,
  splitByNature,
  splitEngagedVsUpcoming,
} from "@/lib/financeCosts";
import { impactYearRange, programSummary } from "@/lib/engine";
import type {
  ActionImpact,
  BeTrackData,
  HierarchyNode,
  Lever,
  LeverAction,
  Workstream,
} from "@/types";

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
  const lv = (o: Partial<Lever>): Lever => ({ ...baseLever, ...o });

  it("CAPEX one-shot: engaged once capexDeploymentDate has passed", () => {
    const l = lv({ status: "in_progress" });
    const past = impact({ nature: "capex", capexDeploymentDate: "2026-01-01" });
    const future = impact({ nature: "capex", capexDeploymentDate: "2026-12-01" });
    expect(isCostEngaged({ impact: past, lever: l }, TODAY)).toBe(true);
    expect(isCostEngaged({ impact: future, lever: l }, TODAY)).toBe(false);
  });

  it("CAPEX smoothed: engaged once capexStartDate has passed", () => {
    const smoothed = impact({
      nature: "capex",
      capexAllocationMode: "smoothed",
      capexStartDate: "2026-03-01",
      capexDeploymentDate: "2026-09-01",
    });
    expect(isCostEngaged({ impact: smoothed, lever: lv({ status: "in_progress" }) }, TODAY)).toBe(
      true
    );
  });

  it("lever not launched yet (audit C5): a past date is not enough, only a ticked cost counts", () => {
    const l = lv({ status: "idea" });
    const past = impact({ nature: "capex", capexDeploymentDate: "2026-01-01" });
    expect(isCostEngaged({ impact: past, lever: l }, TODAY)).toBe(false);
    expect(isCostEngaged({ impact: { ...past, status: "done" }, lever: l }, TODAY)).toBe(true);
    // Coché mais en attente de validation finance, ou décoché : non engagé.
    const pending = {
      ...past,
      status: "done" as const,
      realizedApproval: { status: "pending" as const },
    };
    expect(isCostEngaged({ impact: pending, lever: l }, TODAY)).toBe(false);
    const unticked = { ...past, status: "planned" as const };
    expect(isCostEngaged({ impact: unticked, lever: lv({ status: "delivered" }) }, TODAY)).toBe(
      false
    );
  });

  it("OPEX without a CAPEX date falls back to the lever's status/start", () => {
    const oneoff = impact({ nature: "oneoff" });
    expect(isCostEngaged({ impact: oneoff, lever: lv({ status: "delivered" }) }, TODAY)).toBe(true);
    expect(isCostEngaged({ impact: oneoff, lever: lv({ status: "validated" }) }, TODAY)).toBe(
      false
    );
    expect(
      isCostEngaged(
        { impact: oneoff, lever: lv({ status: "in_progress", start: "2026-01-01" }) },
        TODAY
      )
    ).toBe(true);
    expect(
      isCostEngaged(
        { impact: oneoff, lever: lv({ status: "in_progress", start: "2026-12-01" }) },
        TODAY
      )
    ).toBe(false);
  });
});

describe("financeCosts — lever-level impacts, fte & one-off", () => {
  it("reads lever.impacts, excludes fte and one-off gains from savings", () => {
    const lever = {
      ...baseLever,
      impacts: [
        impact({ id: "c1", type: "cost", amount: 2 }),
        impact({ id: "f1", type: "fte", amount: 1, fteCount: 2, fteDirection: "hire" }),
        impact({ id: "s1", type: "saving", amount: 5 }),
        impact({ id: "s2", type: "saving", amount: 7, gainRecurrence: "oneoff" }),
      ],
    };
    const d = makeData([lever]);
    expect(flattenCostImpacts(d).map((r) => r.impact.id)).toEqual(["c1"]);
    expect(flattenSavingImpacts(d).map((r) => r.impact.id)).toEqual(["s1"]);
    expect(flattenOneOffGainImpacts(d).map((r) => r.impact.id)).toEqual(["s2"]);
  });
});

describe("financeCosts — splitEngagedVsUpcoming / splitByNature", () => {
  it("sums engaged vs upcoming, and total = engaged + upcoming", () => {
    const l1 = {
      ...baseLever,
      status: "delivered" as const,
      impacts: [impact({ id: "c1", nature: "oneoff", amount: 3 })],
    };
    const l2 = {
      ...baseLever,
      id: "L2",
      status: "validated" as const,
      impacts: [impact({ id: "c2", nature: "oneoff", amount: 4 })],
    };
    const split = splitEngagedVsUpcoming(makeData([l1, l2]), TODAY);
    expect(split).toEqual({ engaged: 3, upcoming: 4, total: 7 });
  });

  it("excludes opex_rec (Invest-only scope, round finance-charts-v2)", () => {
    const lever = {
      ...baseLever,
      actions: [
        action({
          status: "done",
          impacts: [
            impact({ id: "c1", nature: "oneoff", amount: 3 }),
            impact({ id: "c2", nature: "opex_rec", amount: 100 }),
          ],
        }),
      ],
    };
    const split = splitEngagedVsUpcoming(makeData([lever]), TODAY);
    expect(split).toEqual({ engaged: 3, upcoming: 0, total: 3 });
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

describe("financeCosts — isInvestNature", () => {
  it("true for capex/oneoff, false for opex_rec", () => {
    expect(isInvestNature("capex")).toBe(true);
    expect(isInvestNature("oneoff")).toBe(true);
    expect(isInvestNature("opex_rec")).toBe(false);
  });
});

describe("financeCosts — investCostRowsBySegment", () => {
  it("returns only Invest rows (excludes opex_rec) matching the engaged flag", () => {
    const l1 = {
      ...baseLever,
      status: "delivered" as const,
      impacts: [
        impact({ id: "c1", nature: "oneoff", amount: 3 }),
        impact({ id: "c2", nature: "opex_rec", amount: 9 }),
      ],
    };
    const l2 = {
      ...baseLever,
      id: "L2",
      status: "validated" as const,
      impacts: [impact({ id: "c3", nature: "oneoff", amount: 4 })],
    };
    const data = makeData([l1, l2]);
    const engaged = investCostRowsBySegment(data, true, TODAY);
    const upcoming = investCostRowsBySegment(data, false, TODAY);
    expect(engaged.map((r) => r.impact.id)).toEqual(["c1"]);
    expect(upcoming.map((r) => r.impact.id)).toEqual(["c3"]);
  });
});

describe("financeCosts — bucketCostsByPeriod with natureFilter", () => {
  it("excludes opex_rec when filtered to Invest (isInvestNature)", () => {
    const lever = {
      ...baseLever,
      actions: [
        action({
          start: "2026-02-01",
          impacts: [
            impact({ id: "c1", nature: "capex", amount: 3, capexDeploymentDate: "2026-02-15" }),
            impact({ id: "c2", nature: "opex_rec", amount: 100 }),
          ],
        }),
      ],
    };
    const points = bucketCostsByPeriod(makeData([lever]), "month", isInvestNature);
    expect(points).toEqual([{ period: "Feb 2026", sortKey: "2026-01", delta: 3, cumulative: 3 }]);
  });
});

describe("financeCosts — costRowsForPeriod", () => {
  it("returns lever/amount rows attributed to the clicked period, prorating smoothed CAPEX", () => {
    const lever = {
      ...baseLever,
      actions: [
        action({
          impacts: [
            impact({
              id: "c1",
              nature: "capex",
              amount: 6,
              capexAllocationMode: "smoothed",
              capexStartDate: "2026-01-01",
              capexDeploymentDate: "2026-03-01",
            }),
          ],
        }),
      ],
    };
    const data = makeData([lever]);
    const rows = costRowsForPeriod(data, "month", "2026-01", isInvestNature);
    expect(rows).toEqual([{ lever, amount: 2 }]);
  });
});

describe("financeCosts — bucketSavingsByPeriod (run-rate, audit M6)", () => {
  it("spreads an annual gain as a monthly run-rate from its own date, over a 12-month horizon", () => {
    const lever = {
      ...baseLever,
      impacts: [impact({ id: "s1", type: "saving", amount: 12, gainDate: "2026-07-01" })],
    };
    // Horizon : juil. 2026 → juin 2027 (12 mois après la dernière date) ; 1 €M par mois.
    const points = bucketSavingsByPeriod(makeData([lever]), "year");
    expect(points).toEqual([
      { period: "2026", sortKey: "2026", delta: 6, cumulative: 6 },
      { period: "2027", sortKey: "2027", delta: 6, cumulative: 12 },
    ]);
  });

  it("stops the run-rate at the impact's end date, includes FTE departures, falls back to lever end", () => {
    const lever = {
      ...baseLever,
      end: "2026-10-15",
      impacts: [
        impact({
          id: "s1",
          type: "saving",
          amount: 12,
          gainDate: "2026-01-01",
          endDate: "2026-03-31",
        }),
        impact({
          id: "f1",
          type: "fte",
          nature: "opex_rec",
          fteDirection: "departure",
          amount: 2.4,
          gainDate: "2026-01-01",
          endDate: "2026-03-31",
        }),
        // Sans date propre : fin du levier (octobre 2026).
        impact({ id: "s2", type: "saving", amount: 1.2, endDate: "2026-12-31" }),
      ],
    };
    const points = bucketSavingsByPeriod(makeData([lever]), "quarter");
    const q = (k: string) => points.find((p) => p.sortKey === k)?.delta ?? 0;
    expect(q("2026-Q1")).toBe(3.6); // (12 + 2,4) / 12 × 3 mois
    expect(q("2026-Q2")).toBe(0);
    expect(q("2026-Q4")).toBe(0.3); // 1,2 / 12 × 3 mois (oct.-déc.)
  });
});

describe("financeCosts — bucketInvestVsSavingsByPeriod", () => {
  it("combines Invest cost, gross savings and started recurrent OPEX per period", () => {
    const lever = {
      ...baseLever,
      actions: [
        action({
          start: "2026-01-05",
          impacts: [
            impact({ id: "c1", nature: "capex", amount: 4, capexDeploymentDate: "2026-01-20" }),
            impact({ id: "c2", nature: "opex_rec", amount: 1 }),
            impact({ id: "s1", type: "saving", amount: 3, gainDate: "2026-01-25" }),
          ],
        }),
      ],
    };
    const points = bucketInvestVsSavingsByPeriod(makeData([lever]), "year");
    expect(points).toEqual([
      {
        period: "2026",
        sortKey: "2026",
        investCost: 4,
        grossSavings: 3,
        opexRecStarted: 1,
        netSavings: 2,
        netPeriodResult: -2,
        netCumulative: -2,
      },
    ]);
  });

  it("accumulates netPeriodResult across periods into netCumulative, crossing 0 at breakeven", () => {
    const lever = {
      ...baseLever,
      actions: [
        action({
          id: "A1",
          start: "2026-01-05",
          impacts: [
            impact({ id: "c1", nature: "capex", amount: 10, capexDeploymentDate: "2026-01-20" }),
          ],
        }),
        action({
          id: "A2",
          start: "2027-01-05",
          impacts: [impact({ id: "s1", type: "saving", amount: 6, gainDate: "2027-01-25" })],
        }),
        action({
          id: "A3",
          start: "2028-01-05",
          impacts: [impact({ id: "s2", type: "saving", amount: 6, gainDate: "2028-01-25" })],
        }),
      ],
    };
    const points = bucketInvestVsSavingsByPeriod(makeData([lever]), "year");
    // Run-rate (audit M6) : le gain de 2027 court aussi en 2028 (6 + 6), au lieu d'être compté une
    // seule fois l'année de sa date.
    expect(points.map((p) => p.netPeriodResult)).toEqual([-10, 6, 12]);
    expect(points.map((p) => p.netCumulative)).toEqual([-10, -4, 8]);
  });
});

describe("financeCosts — groupCostsByWorkstream", () => {
  it("groups by workstream then lever, sorted by amount descending", () => {
    const leverA = { ...baseLever, id: "L001", code: "L001", name: "Lever A", ws: "WS-01" };
    const leverB = { ...baseLever, id: "L002", code: "L002", name: "Lever B", ws: "WS-02" };
    const workstreams: Workstream[] = [
      { id: "WS-01", name: "Workstream Un", sponsor: "S", color: "#111", target: 10 },
      { id: "WS-02", name: "Workstream Deux", sponsor: "S", color: "#222", target: 10 },
    ];
    const groups = groupCostsByWorkstream(
      [
        { lever: leverA, amount: 2 },
        { lever: leverA, amount: 1 },
        { lever: leverB, amount: 5 },
      ],
      workstreams
    );
    expect(groups).toEqual([
      {
        wsId: "WS-02",
        wsName: "Workstream Deux",
        color: "#222",
        amount: 5,
        levers: [{ leverId: "L002", leverCode: "L002", leverName: "Lever B", amount: 5 }],
      },
      {
        wsId: "WS-01",
        wsName: "Workstream Un",
        color: "#111",
        amount: 3,
        levers: [{ leverId: "L001", leverCode: "L001", leverName: "Lever A", amount: 3 }],
      },
    ]);
  });
});

describe("financeCosts — sortedHierarchyLevels / costsByHierarchyNode", () => {
  const levels = [
    { key: "cost_center", label: "Centre de coût", order: 1 },
    { key: "bu", label: "Business Unit", order: 0 },
  ];

  it("sorts levels by order ascending", () => {
    expect(sortedHierarchyLevels(levels).map((l) => l.key)).toEqual(["bu", "cost_center"]);
  });

  it("aggregates cost amounts per node, resolving the ancestor chain from the lever's leaf node", () => {
    const nodes: HierarchyNode[] = [
      {
        id: "bu1",
        companyId: "c1",
        levelKey: "bu",
        code: "BU1",
        label: "BU Industrie",
        parentId: null,
      },
      {
        id: "cc1",
        companyId: "c1",
        levelKey: "cost_center",
        code: "CC1",
        label: "CC Achats",
        parentId: "bu1",
      },
      {
        id: "cc2",
        companyId: "c1",
        levelKey: "cost_center",
        code: "CC2",
        label: "CC Logistique",
        parentId: "bu1",
      },
    ];
    const leverCC1 = { ...baseLever, id: "L001", hierarchyLeafId: "cc1" };
    const leverCC2 = { ...baseLever, id: "L002", hierarchyLeafId: "cc2" };
    const data = makeData([leverCC1, leverCC2]);
    data.levers[0].actions = [
      action({ impacts: [impact({ id: "c1", nature: "oneoff", amount: 4 })] }),
    ];
    data.levers[1].actions = [
      action({ impacts: [impact({ id: "c2", nature: "oneoff", amount: 6 })] }),
    ];

    // Niveau macro (BU) : les deux leviers remontent au même nœud "bu1".
    const buSlices = costsByHierarchyNode(data, nodes, "bu", null);
    expect(buSlices).toHaveLength(1);
    expect(buSlices[0].node.id).toBe("bu1");
    expect(buSlices[0].amount).toBe(10);
    expect(buSlices[0].hasChildren).toBe(true);

    // Niveau fin (cost center), sous le nœud BU cliqué.
    const ccSlices = costsByHierarchyNode(data, nodes, "cost_center", "bu1");
    expect(
      ccSlices.map((s) => ({ id: s.node.id, amount: s.amount, hasChildren: s.hasChildren }))
    ).toEqual([
      { id: "cc2", amount: 6, hasChildren: false },
      { id: "cc1", amount: 4, hasChildren: false },
    ]);
  });

  it("ignores levers without hierarchyLeafId (no fallback 'unassigned' slice)", () => {
    const nodes: HierarchyNode[] = [
      {
        id: "bu1",
        companyId: "c1",
        levelKey: "bu",
        code: "BU1",
        label: "BU Industrie",
        parentId: null,
      },
    ];
    const lever = { ...baseLever, id: "L001", hierarchyLeafId: undefined };
    const data = makeData([lever]);
    data.levers[0].actions = [
      action({ impacts: [impact({ id: "c1", nature: "oneoff", amount: 4 })] }),
    ];
    expect(costsByHierarchyNode(data, nodes, "bu", null)).toEqual([]);
  });
});

describe("financeCosts — recurringOpexReconciliation (OPEX récurrent Finance vs cascade)", () => {
  it("la cascade = lignes de coût récurrentes + salaires des recrutements ETP", () => {
    const lever: Lever = {
      ...baseLever,
      impacts: [
        { id: "s1", label: "Gain", type: "saving", amount: 10 },
        { id: "c1", label: "Run", type: "cost", nature: "opex_rec", amount: 1.7 },
        { id: "c2", label: "Capex", type: "cost", nature: "capex", amount: 5 },
        {
          id: "f1",
          label: "Recrutement",
          type: "fte",
          fteDirection: "hire",
          fteCount: 3,
          amount: 0.35,
        },
      ] as Lever["impacts"],
    };
    const cancelled: Lever = { ...lever, id: "LX", status: "cancelled" };
    const r = recurringOpexReconciliation(makeData([lever, cancelled]));
    expect(r.costLines).toBe(1.7);
    expect(r.costLines).toBe(splitByNature(makeData([lever])).opexRec);
    expect(r.fteHires).toBe(0.35);
    expect(r.dashboard).toBe(2.05);
    expect(r.other).toBe(0);
  });
});

// ─── Audit lot 2 — cohérence des chiffres entre écrans ────────────────────────────────────────

describe("financeCosts — périodes en EXERCICES fiscaux (audit lot 2, point 1)", () => {
  // Exercice d'avril (fyStartMonth = 3) : un CAPEX de 1,1 en février 2026 tombe dans l'exercice
  // 2025 (FY25/26), un OPEX ponctuel de 1,7 en septembre 2026 dans l'exercice 2026 (FY26/27).
  // Avant : découpage CIVIL — une seule barre « 2026 » de 2,8, alors que le P&L et le tableau de la
  // même page (exercices) affichent 1,1 + 1,7.
  const capexImp = impact({
    id: "c1",
    nature: "capex",
    amount: 1.1,
    capexDeploymentDate: "2026-02-15",
  });
  const oneOffImp = impact({
    id: "c2",
    nature: "oneoff",
    amount: 1.7,
    capexDeploymentDate: "2026-09-01",
  });
  const gainImp = impact({
    id: "s1",
    type: "saving",
    amount: 1.2,
    gainDate: "2026-01-01",
    endDate: "2026-12-31",
  });
  const lever = { ...baseLever, impacts: [capexImp, oneOffImp, gainImp] };
  const data = makeData([lever]);
  const FY_APRIL = 3;

  it("Engagement des coûts : barres par exercice (1,1 | 1,7), plus une année civile de 2,8", () => {
    expect(bucketCostsByPeriod(data, "year", isInvestNature, FY_APRIL)).toEqual([
      { period: "FY25/26", sortKey: "2025", delta: 1.1, cumulative: 1.1 },
      { period: "FY26/27", sortKey: "2026", delta: 1.7, cumulative: 2.8 },
    ]);
    // Même exercice que le moteur du P&L / tableau Finance (`impactYearRange`, exercices).
    expect(impactYearRange(capexImp, lever, FY_APRIL)?.[0]).toBe(2025);
    expect(impactYearRange(oneOffImp, lever, FY_APRIL)?.[0]).toBe(2026);
    // Détail au clic d'une barre = sa valeur.
    const rows = costRowsForPeriod(data, "year", "2025", isInvestNature, FY_APRIL);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(1.1);
  });

  it("trimestres FISCAUX : février = Q4 de l'exercice 2025, septembre = Q2 de l'exercice 2026", () => {
    expect(bucketCostsByPeriod(data, "quarter", isInvestNature, FY_APRIL)).toEqual([
      { period: "Q4 FY25/26", sortKey: "2025-Q4", delta: 1.1, cumulative: 1.1 },
      { period: "Q2 FY26/27", sortKey: "2026-Q2", delta: 1.7, cumulative: 2.8 },
    ]);
  });

  it("Invest vs Savings : investissement et run-rate ventilés par exercice", () => {
    const points = bucketInvestVsSavingsByPeriod(data, "year", FY_APRIL);
    expect(points.map((p) => [p.period, p.investCost, p.grossSavings])).toEqual([
      ["FY25/26", 1.1, 0.3], // janv.-mars 2026 : 3 × 0,1
      ["FY26/27", 1.7, 0.9], // avr.-déc. 2026 : 9 × 0,1
      ["FY27/28", 0, 0], // horizon : 12 mois après la dernière date
    ]);
    const rows = investVsSavingsRowsForPeriod(data, "year", "2025", FY_APRIL);
    expect(rows[0].net).toBe(-0.8);
  });

  it("exercice civil (défaut) : libellés et découpage inchangés", () => {
    expect(bucketCostsByPeriod(data, "year", isInvestNature)).toEqual([
      { period: "2026", sortKey: "2026", delta: 2.8, cumulative: 2.8 },
    ]);
  });
});

describe("financeCosts — donut « Coûts ponctuels » = KPI du dashboard (audit lot 2, point 3)", () => {
  afterEach(() => vi.useRealTimers());

  it("inclut les leviers sans ligne de coût (prorata de l'avancement, comme le KPI)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    // Levier détaillé : CAPEX 1,0 déployé (engagé) + OPEX ponctuel 1,8 à venir.
    const detailed: Lever = {
      ...baseLever,
      id: "LD",
      impacts: [
        impact({ id: "d1", nature: "capex", amount: 1, capexDeploymentDate: "2026-03-01" }),
        impact({ id: "d2", nature: "oneoff", amount: 1.8, capexDeploymentDate: "2026-12-01" }),
      ],
    };
    // Levier « macro » : coûts saisis au niveau du levier (0,4 + 0,1), avancement 60 %.
    const macro: Lever = {
      ...baseLever,
      id: "LM",
      capex: 0.4,
      opexOneOff: 0.1,
      impacts: [],
      actions: [action({ id: "AM", declaredProgressPct: 60 })],
    };
    const data = makeData([detailed, macro]);
    const kpi = programSummary(data);
    expect(kpi.engagedCosts).toBe(1.3);
    expect(kpi.reforecastCosts).toBe(3.3);
    // Avant : 1,0 / 2,8 (36 %) — le levier macro était exclu du donut.
    const split = splitEngagedVsUpcoming(data);
    expect(split).toEqual({ engaged: 1.3, upcoming: 2, total: 3.3 });
    const detail = engagedVsUpcomingRows(data);
    expect(detail.undetailed).toEqual({ engaged: 0.3, upcoming: 0.2, leverCount: 1 });
    // Le détail par chantier / levier retombe sur les segments.
    const sum = (rows: { amount: number }[]) =>
      Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    expect(sum(detail.engagedRows)).toBe(1.3);
    expect(sum(detail.upcomingRows)).toBe(2);
  });
});
