import { describe, it, expect } from "vitest";
import {
  realizedSavings,
  realizedFte,
  worstRisk,
  stageCounts,
  sankeyData,
  sankeyChronology,
  actionProgress,
  recomputeLeverProgress,
  pnlImpact,
  byGeo,
  byFunction,
  fmtCurr,
  fmtPct,
  fmtInt,
} from "@/lib/engine";
import type { BeTrackData, Lever, SubLever, LeverStatus } from "@/types";

const baseLever: Lever = {
  id: "L001",
  code: "L001",
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
  priority: "medium",
  risk: "low",
  grossSavings: 10,
  netSavings: 8,
  opexOneOff: 1,
  opexRec: 0.5,
  capex: 2,
  fteImpact: -5,
  popImpacted: 100,
  dependencies: [],
  description: "Test lever",
  createdAt: "2026-01-01",
  lastUpdate: "2026-06-01",
  actions: [],
};

function makeData(overrides?: Partial<BeTrackData>): BeTrackData {
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
    workstreams: [],
    leverStatuses: [],
    riskLevels: [],
    priorityLevels: [],
    leverTypes: [],
    geographies: [],
    functions: [],
    pnlAccounts: [],
    levers: [],
    subLevers: [],
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
    scenarios: [],
    activeScenario: "",
    ...overrides,
  };
}

describe("engine — realizedSavings", () => {
  it("returns 0 for cancelled levers", () => {
    const lever = { ...baseLever, status: "cancelled" as LeverStatus };
    expect(realizedSavings(lever, makeData())).toBe(0);
  });

  it("computes netSavings × progress%", () => {
    const lever = { ...baseLever, netSavings: 10, progress: 40 };
    expect(realizedSavings(lever, makeData())).toBe(4);
  });

  it("rounds to 2 decimals", () => {
    const lever = { ...baseLever, netSavings: 3.33, progress: 33 };
    expect(realizedSavings(lever, makeData())).toBe(1.1);
  });
});

describe("engine — realizedFte", () => {
  it("returns 0 for cancelled levers", () => {
    const lever = { ...baseLever, status: "cancelled" as LeverStatus };
    expect(realizedFte(lever)).toBe(0);
  });

  it("computes fteImpact × progress%", () => {
    const lever = { ...baseLever, fteImpact: -10, progress: 60 };
    expect(realizedFte(lever)).toBe(-6);
  });
});

describe("engine — worstRisk", () => {
  it("returns low for empty array", () => {
    expect(worstRisk([])).toBe("low");
  });

  it("returns the worst risk from a list", () => {
    const levers = [
      { ...baseLever, risk: "low" as const },
      { ...baseLever, id: "L002", risk: "critical" as const },
      { ...baseLever, id: "L003", risk: "medium" as const },
    ];
    expect(worstRisk(levers)).toBe("critical");
  });
});

describe("engine — stageCounts", () => {
  it("counts levers per stage", () => {
    const data = makeData({
      levers: [
        { ...baseLever, status: "idea" },
        { ...baseLever, id: "L002", status: "idea" },
        { ...baseLever, id: "L003", status: "in_progress" },
        { ...baseLever, id: "L004", status: "cancelled" },
      ],
    });
    const counts = stageCounts(data);
    expect(counts.find((c) => c.status === "idea")?.count).toBe(2);
    expect(counts.find((c) => c.status === "in_progress")?.count).toBe(1);
    expect(counts.find((c) => c.status === "cancelled")?.count).toBe(1);
    expect(counts.find((c) => c.status === "delivered")?.count).toBe(0);
  });
});

describe("engine — sankeyData", () => {
  it("returns empty links when no levers", () => {
    const sankey = sankeyData(makeData());
    expect(sankey.links).toHaveLength(0);
  });

  it("creates links for each stage with levers", () => {
    const data = makeData({
      levers: [
        { ...baseLever, status: "idea" },
        { ...baseLever, id: "L002", status: "delivered" },
      ],
    });
    const sankey = sankeyData(data);
    expect(sankey.links.length).toBeGreaterThanOrEqual(2);
  });
});

describe("engine — sankeyChronology", () => {
  it("returns nodes and links for chronology", () => {
    const data = makeData({
      levers: [
        { ...baseLever, status: "in_progress", progress: 50 },
        { ...baseLever, id: "L002", status: "cancelled", progress: 20 },
        { ...baseLever, id: "L003", status: "delivered", progress: 100 },
      ],
    });
    const chrono = sankeyChronology(data);
    expect(chrono.nodes.length).toBeGreaterThan(5);
    expect(chrono.links.length).toBeGreaterThan(0);
  });
});

describe("engine — actionProgress", () => {
  it("returns 0 for empty actions", () => {
    expect(actionProgress([])).toBe(0);
  });

  it("averages by status weight", () => {
    const actions = [
      { id: "a1", name: "A1", start: "", end: "", cost: 0, status: "done" as const },
      { id: "a2", name: "A2", start: "", end: "", cost: 0, status: "todo" as const },
    ];
    expect(actionProgress(actions)).toBe(50);
  });
});

describe("engine — recomputeLeverProgress", () => {
  it("uses sublever weighted average when sublevers exist", () => {
    const lever = { ...baseLever, progress: 0 };
    const subLevers: SubLever[] = [
      {
        id: "SL001",
        leverId: "L001",
        name: "Sub1",
        expensePost: "P1",
        businessUnit: "BU1",
        pnlMap: "PNL01",
        grossSavings: 10,
        netSavings: 8,
        opexOneOff: 0,
        opexRec: 0,
        capex: 0,
        fteImpact: 0,
        popImpacted: 0,
        start: "2026-01-01",
        end: "2026-12-31",
        status: "in_progress",
        dependencies: [],
        actions: [
          { id: "a1", name: "A1", start: "", end: "", cost: 0, status: "done" },
          { id: "a2", name: "A2", start: "", end: "", cost: 0, status: "done" },
        ],
      },
    ];
    expect(recomputeLeverProgress(lever, subLevers)).toBe(100);
  });

  it("uses lever.actions when no sublevers", () => {
    const lever = {
      ...baseLever,
      progress: 0,
      actions: [{ id: "a1", name: "A1", start: "", end: "", cost: 0, status: "done" as const }],
    };
    expect(recomputeLeverProgress(lever, [])).toBe(100);
  });

  it("falls back to lever.progress when no actions", () => {
    const lever = { ...baseLever, progress: 75 };
    expect(recomputeLeverProgress(lever, [])).toBe(75);
  });
});

describe("engine — fmt helpers", () => {
  it("fmtCurr shows M for >= 1", () => {
    expect(fmtCurr(5.2)).toBe("€5.2M");
  });

  it("fmtCurr shows K for < 1", () => {
    expect(fmtCurr(0.5)).toBe("€500K");
  });

  it("fmtCurr shows — for null", () => {
    expect(fmtCurr(null)).toBe("—");
  });

  it("fmtPct rounds", () => {
    expect(fmtPct(33.7)).toBe("34%");
  });

  it("fmtInt formats fr-FR", () => {
    const result = fmtInt(1234567);
    expect(result.replace(/[\s\u00a0\u202f]/g, " ")).toBe("1 234 567");
  });
});

describe("engine — byGeo / byFunction / pnlImpact", () => {
  it("aggregates by geography", () => {
    const data = makeData({
      levers: [
        { ...baseLever, geography: "Europe", netSavings: 5, progress: 100 },
        { ...baseLever, id: "L002", geography: "Europe", netSavings: 3, progress: 100 },
        { ...baseLever, id: "L003", geography: "APAC", netSavings: 2, progress: 100 },
      ],
    });
    const geo = byGeo(data);
    expect(geo["Europe"]).toBe(8);
    expect(geo["APAC"]).toBe(2);
  });

  it("aggregates by function", () => {
    const data = makeData({
      levers: [
        { ...baseLever, function: "IT", netSavings: 4, progress: 100 },
        { ...baseLever, id: "L002", function: "HR", netSavings: 6, progress: 100 },
      ],
    });
    const fn = byFunction(data);
    expect(fn["IT"]).toBe(4);
    expect(fn["HR"]).toBe(6);
  });

  it("aggregates pnl impact", () => {
    const data = makeData({
      levers: [
        { ...baseLever, pnlMap: "PNL01", progress: 100 },
        { ...baseLever, id: "L002", pnlMap: "PNL01", progress: 50 },
      ],
    });
    const pnl = pnlImpact(data);
    expect(pnl["PNL01"]).toBeGreaterThan(0);
  });
});
