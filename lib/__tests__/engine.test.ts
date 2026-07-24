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
  byCountry,
  byProject,
  marimekko2D,
  bestPracticeGaps,
  sCurve3,
  financialBridge,
  fmtCurr,
  fmtPct,
  fmtInt,
} from "@/lib/engine";
import { STATUS_SHORT_LABEL } from "@/lib/status-config";
import type { BestPracticeRule, BeTrackData, Lever, Project, SubLever, LeverStatus } from "@/types";

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
    ...overrides,
  };
}

describe("engine — realizedSavings", () => {
  it("returns 0 for cancelled levers", () => {
    const lever = { ...baseLever, status: "cancelled" as LeverStatus };
    expect(realizedSavings(lever)).toBe(0);
  });

  it("computes netSavings × progress%", () => {
    const lever = { ...baseLever, netSavings: 10, progress: 40 };
    expect(realizedSavings(lever)).toBe(4);
  });

  it("rounds to 2 decimals", () => {
    const lever = { ...baseLever, netSavings: 3.33, progress: 33 };
    expect(realizedSavings(lever)).toBe(1.1);
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

  it("branches a cancelled lever using cancelledAtStage rather than the progress heuristic", () => {
    // progress=95 would map to the "delivered" stage under the old heuristic, but cancelledAtStage
    // says it was actually cancelled while still at "idea" — the explicit field must win.
    const data = makeData({
      levers: [{ ...baseLever, status: "cancelled", progress: 95, cancelledAtStage: "idea" }],
    });
    const chrono = sankeyChronology(data);
    const ideaExitLabel = `Annulé après ${STATUS_SHORT_LABEL.idea}`;
    const deliveredExitLabel = `Annulé après ${STATUS_SHORT_LABEL.delivered}`;
    expect(chrono.nodes.some((n) => n.name === ideaExitLabel)).toBe(true);
    expect(chrono.nodes.some((n) => n.name === deliveredExitLabel)).toBe(false);
  });

  it("falls back to the progress heuristic for legacy levers without cancelledAtStage", () => {
    const data = makeData({
      levers: [{ ...baseLever, status: "cancelled", progress: 95 }],
    });
    const chrono = sankeyChronology(data);
    const deliveredExitLabel = `Annulé après ${STATUS_SHORT_LABEL.delivered}`;
    expect(chrono.nodes.some((n) => n.name === deliveredExitLabel)).toBe(true);
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
        priority: "medium",
        risk: "low",
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

describe("engine — bestPracticeGaps", () => {
  const baseRule: BestPracticeRule = {
    id: "bpr-1",
    companyId: "c1",
    label: "Test rule",
    description: "Test description",
    active: true,
  };

  it("flags a rule with zero matching non-cancelled levers as a gap", () => {
    const data = makeData({
      levers: [{ ...baseLever, function: "IT" }],
    });
    const rules: BestPracticeRule[] = [{ ...baseRule, matchFunction: "R&D" }];
    const result = bestPracticeGaps(data, rules);
    expect(result).toHaveLength(1);
    expect(result[0].hasMatch).toBe(false);
  });

  it("marks a rule matched when a non-cancelled lever satisfies all criteria", () => {
    const data = makeData({
      levers: [{ ...baseLever, function: "Procurement", ws: "WS-PROC", type: "Sourcing & Achats" }],
    });
    const rules: BestPracticeRule[] = [
      {
        ...baseRule,
        matchFunction: "Procurement",
        matchWorkstreamId: "WS-PROC",
        matchType: "Sourcing & Achats",
      },
    ];
    const result = bestPracticeGaps(data, rules);
    expect(result[0].hasMatch).toBe(true);
  });

  it("ignores cancelled levers when checking for a match", () => {
    const data = makeData({
      levers: [{ ...baseLever, function: "HR", status: "cancelled" as LeverStatus }],
    });
    const rules: BestPracticeRule[] = [{ ...baseRule, matchFunction: "HR" }];
    const result = bestPracticeGaps(data, rules);
    expect(result[0].hasMatch).toBe(false);
  });

  it("skips inactive rules entirely", () => {
    const data = makeData({ levers: [{ ...baseLever, function: "IT" }] });
    const rules: BestPracticeRule[] = [{ ...baseRule, active: false, matchFunction: "R&D" }];
    expect(bestPracticeGaps(data, rules)).toHaveLength(0);
  });
});

describe("engine — sCurve3 granularity", () => {
  it("returns 12 monthly points by default", () => {
    const data = makeData({ levers: [baseLever] });
    expect(sCurve3(data)).toHaveLength(12);
  });

  it("returns 4 quarterly points when granularity is quarter", () => {
    const data = makeData({ levers: [baseLever] });
    const points = sCurve3(data, "quarter");
    expect(points).toHaveLength(4);
    expect(points.map((p) => p.month)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });

  it("quarterly points match the monthly end-of-quarter values", () => {
    const data = makeData({ levers: [baseLever] });
    const monthly = sCurve3(data, "month");
    const quarterly = sCurve3(data, "quarter");
    expect(quarterly[0].planned).toBe(monthly[2].planned);
    expect(quarterly[3].planned).toBe(monthly[11].planned);
  });
});

describe("engine — financialBridge granularity", () => {
  it("groups by quarter by default, matching legacy quarterlyBridge shape", () => {
    const data = makeData({
      levers: [
        { ...baseLever, id: "L001", end: "2026-02-15", status: "in_progress" as LeverStatus },
        { ...baseLever, id: "L002", end: "2026-05-20", status: "in_progress" as LeverStatus },
      ],
    });
    const result = financialBridge(data, "quarter");
    expect(result.map((r) => r.quarter)).toEqual(["Q1 2026", "Q2 2026"]);
  });

  it("groups by month when granularity is month", () => {
    const data = makeData({
      levers: [
        { ...baseLever, id: "L001", end: "2026-02-15", status: "in_progress" as LeverStatus },
        { ...baseLever, id: "L002", end: "2026-05-20", status: "in_progress" as LeverStatus },
      ],
    });
    const result = financialBridge(data, "month");
    expect(result.map((r) => r.quarter)).toEqual(["Feb 2026", "May 2026"]);
  });
});

describe("engine — byCountry / byProject", () => {
  it("aggregates by country", () => {
    const data = makeData({
      levers: [
        { ...baseLever, country: "France", netSavings: 5, progress: 100 },
        { ...baseLever, id: "L002", country: "France", netSavings: 3, progress: 100 },
        { ...baseLever, id: "L003", country: "Germany", netSavings: 2, progress: 100 },
      ],
    });
    const result = byCountry(data);
    expect(result["France"]).toBe(8);
    expect(result["Germany"]).toBe(2);
  });

  it("aggregates by project, grouping unassigned levers under 'Non assigné'", () => {
    const projects: Project[] = [
      {
        id: "p1",
        companyId: "c1",
        name: "Projet A",
        sponsor: "CEO",
        target: 10,
        currency: "€M",
        fyStart: "2026-01-01",
        fyEnd: "2026-12-31",
        baselineEBIT: 0,
        revenue: 0,
        createdAt: "2026-01-01",
      },
    ];
    const data = makeData({
      levers: [
        { ...baseLever, projectId: "p1", netSavings: 5, progress: 100 },
        { ...baseLever, id: "L002", netSavings: 3, progress: 100 },
      ],
    });
    const result = byProject(data, projects);
    expect(result["Projet A"]).toBe(5);
    expect(result["Non assigné"]).toBe(3);
  });
});

describe("engine — marimekko2D", () => {
  it("groups by function then by country (function-country pair)", () => {
    const data = makeData({
      levers: [
        {
          ...baseLever,
          id: "L001",
          function: "IT",
          country: "France",
          netSavings: 6,
          progress: 100,
        },
        {
          ...baseLever,
          id: "L002",
          function: "IT",
          country: "Germany",
          netSavings: 2,
          progress: 100,
        },
        {
          ...baseLever,
          id: "L003",
          function: "HR",
          country: "France",
          netSavings: 4,
          progress: 100,
        },
      ],
    });
    const columns = marimekko2D(data, "function-country");
    const it = columns.find((c) => c.key === "IT")!;
    const hr = columns.find((c) => c.key === "HR")!;
    expect(it.totalSavings).toBe(8);
    expect(hr.totalSavings).toBe(4);
    // Colonnes triées par totalSavings décroissant.
    expect(columns[0].key).toBe("IT");
    const franceSeg = it.segments.find((s) => s.key === "France")!;
    const germanySeg = it.segments.find((s) => s.key === "Germany")!;
    expect(franceSeg.value).toBe(6);
    expect(germanySeg.value).toBe(2);
    // Les segments d'une colonne s'empilent à 100% (poids relatif à la colonne, pas au total).
    expect(Math.round(franceSeg.heightPct + germanySeg.heightPct)).toBe(100);
  });

  it("groups by workstream then by project (workstream-project pair), unassigned levers bucketed", () => {
    const projects: Project[] = [
      {
        id: "p1",
        companyId: "c1",
        name: "Projet A",
        sponsor: "CEO",
        target: 10,
        currency: "€M",
        fyStart: "2026-01-01",
        fyEnd: "2026-12-31",
        baselineEBIT: 0,
        revenue: 0,
        createdAt: "2026-01-01",
      },
    ];
    const data = makeData({
      levers: [
        { ...baseLever, id: "L001", ws: "WS-01", projectId: "p1", netSavings: 5, progress: 100 },
        { ...baseLever, id: "L002", ws: "WS-01", netSavings: 3, progress: 100 },
      ],
    });
    const columns = marimekko2D(data, "workstream-project", projects);
    expect(columns).toHaveLength(1);
    const segments = columns[0].segments;
    expect(segments.find((s) => s.key === "Projet A")?.value).toBe(5);
    expect(segments.find((s) => s.key === "Non assigné")?.value).toBe(3);
  });

  it("excludes cancelled levers", () => {
    const data = makeData({
      levers: [
        { ...baseLever, function: "IT", status: "cancelled" as LeverStatus, netSavings: 10 },
      ],
    });
    expect(marimekko2D(data, "function-country")).toHaveLength(0);
  });
});
