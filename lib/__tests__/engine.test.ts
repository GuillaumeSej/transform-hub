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
  pnlImpactDetailed,
  byGeo,
  byFunction,
  byCountry,
  byProgram,
  marimekko2D,
  sCurve3,
  financialBridge,
  fmtCurr,
  fmtPct,
  fmtInt,
  programSummary,
} from "@/lib/engine";
import { STATUS_LEVEL } from "@/lib/status-config";
import type {
  BeTrackData,
  HierarchyLevelDef,
  HierarchyNode,
  Lever,
  Program,
  LeverStatus,
} from "@/types";

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
    leverTypes: [],
    geographies: [],
    functions: [],
    pnlAccounts: [],
    levers: [],
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
        {
          ...baseLever,
          id: "L002",
          status: "cancelled",
          progress: 20,
          cancelledAtStage: "qualified",
        },
        { ...baseLever, id: "L003", status: "delivered", progress: 100 },
      ],
    });
    const chrono = sankeyChronology(data);
    // Nœuds orphelins (sans lien) sont filtrés — on vérifie juste qu'il y a des nœuds et des liens
    expect(chrono.nodes.length).toBeGreaterThan(5);
    expect(chrono.links.length).toBeGreaterThan(0);
  });

  it("active levers at an intermediate stage do NOT generate flow to the next stage", () => {
    // 1 lever at M2 (qualified) → should NOT flow to M3
    const data = makeData({
      levers: [{ ...baseLever, status: "qualified" }],
    });
    const chrono = sankeyChronology(data);
    const m2NodeIdx = chrono.nodes.findIndex((n) => n.name.includes("M2"));
    const m3NodeIdx = chrono.nodes.findIndex((n) => n.name.includes("M3"));
    // No link from M2 to M3 (the lever is still at M2)
    const linkToM3 = chrono.links.find((l) => l.source === m2NodeIdx && l.target === m3NodeIdx);
    expect(linkToM3).toBeUndefined();
  });

  it("branches a cancelled lever using cancelledAtStage", () => {
    const data = makeData({
      levers: [{ ...baseLever, status: "cancelled", progress: 95, cancelledAtStage: "idea" }],
    });
    const chrono = sankeyChronology(data);
    const ideaExitLabel = `Abandonné après ${STATUS_LEVEL.idea}`;
    const deliveredExitLabel = `Abandonné après ${STATUS_LEVEL.delivered}`;
    expect(chrono.nodes.some((n) => n.name === ideaExitLabel)).toBe(true);
    // Should NOT have a link to Abandonné après M5
    const deliveredExitIdx = chrono.nodes.findIndex((n) => n.name === deliveredExitLabel);
    const linkToDeliveredExit = chrono.links.find((l) => l.target === deliveredExitIdx);
    expect(linkToDeliveredExit).toBeUndefined();
  });

  it("falls back to the progress heuristic for legacy levers without cancelledAtStage", () => {
    const data = makeData({
      levers: [{ ...baseLever, status: "cancelled", progress: 95 }],
    });
    const chrono = sankeyChronology(data);
    const deliveredExitLabel = `Abandonné après ${STATUS_LEVEL.delivered}`;
    expect(chrono.nodes.some((n) => n.name === deliveredExitLabel)).toBe(true);
    // There should be a link to that exit node
    const exitIdx = chrono.nodes.findIndex((n) => n.name === deliveredExitLabel);
    expect(chrono.links.some((l) => l.target === exitIdx && l.value > 0)).toBe(true);
  });

  it("delivered levers flow through all stages to M5", () => {
    const data = makeData({
      levers: [{ ...baseLever, status: "delivered", progress: 100 }],
    });
    const chrono = sankeyChronology(data);
    // Should have links Tous→M1, M1→M2, M2→M3, M3→M4, M4→M5
    expect(chrono.links.length).toBe(5); // 5 links for 1 delivered lever (no abandons)
  });

  it("no links with value 0", () => {
    const data = makeData({
      levers: [
        { ...baseLever, status: "in_progress", progress: 50 },
        { ...baseLever, id: "L002", status: "cancelled", cancelledAtStage: "validated" },
      ],
    });
    const chrono = sankeyChronology(data);
    chrono.links.forEach((l) => expect(l.value).toBeGreaterThan(0));
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
  it("uses lever.actions weighted average when actions exist", () => {
    const lever = {
      ...baseLever,
      progress: 0,
      actions: [
        { id: "a1", name: "A1", start: "", end: "", cost: 0, status: "done" as const },
        { id: "a2", name: "A2", start: "", end: "", cost: 0, status: "done" as const },
      ],
    };
    expect(recomputeLeverProgress(lever)).toBe(100);
  });

  it("falls back to lever.progress when no actions", () => {
    const lever = { ...baseLever, progress: 75, actions: [] };
    expect(recomputeLeverProgress(lever)).toBe(75);
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

describe("engine — byCountry / byProgram", () => {
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

  it("aggregates by program, grouping unassigned levers under 'Non assigné'", () => {
    const programs: Program[] = [
      {
        id: "p1",
        companyId: "c1",
        name: "Programme A",
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
        { ...baseLever, programId: "p1", netSavings: 5, progress: 100 },
        { ...baseLever, id: "L002", netSavings: 3, progress: 100 },
      ],
    });
    const result = byProgram(data, programs);
    expect(result["Programme A"]).toBe(5);
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

  it("groups by workstream then by program (workstream-project pair), unassigned levers bucketed", () => {
    const programs: Program[] = [
      {
        id: "p1",
        companyId: "c1",
        name: "Programme A",
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
        { ...baseLever, id: "L001", ws: "WS-01", programId: "p1", netSavings: 5, progress: 100 },
        { ...baseLever, id: "L002", ws: "WS-01", netSavings: 3, progress: 100 },
      ],
    });
    const columns = marimekko2D(data, "workstream-project", programs);
    expect(columns).toHaveLength(1);
    const segments = columns[0].segments;
    expect(segments.find((s) => s.key === "Programme A")?.value).toBe(5);
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

describe("engine — programSummary (reforecast, coûts, risques, suppressions)", () => {
  it("reforecastTarget falls back netSavings → lockedPlan → reforecast", () => {
    const data = makeData({
      levers: [
        // Pas de plan figé ni reforecast → netSavings courant
        { ...baseLever, id: "L001", netSavings: 8 },
        // Plan figé sans reforecast → lockedPlan.netSavings
        {
          ...baseLever,
          id: "L002",
          netSavings: 6,
          lockedPlan: { grossSavings: 7, netSavings: 5, opexOneOff: 1, opexRec: 0.5, capex: 2 },
        },
        // Reforecast présent → reforecast.netSavings
        {
          ...baseLever,
          id: "L003",
          netSavings: 4,
          lockedPlan: { grossSavings: 5, netSavings: 4, opexOneOff: 1, opexRec: 0.5, capex: 1 },
          reforecast: { grossSavings: 4, netSavings: 3, opexOneOff: 1, opexRec: 0.5, capex: 1 },
        },
      ],
    });
    const s = programSummary(data);
    expect(s.reforecastTarget).toBe(8 + 5 + 3);
  });

  it("plannedCosts uses lockedPlan capex+opexOneOff, engagedCosts scales with progress", () => {
    const data = makeData({
      levers: [
        {
          ...baseLever,
          id: "L001",
          capex: 3,
          opexOneOff: 1,
          progress: 50,
          lockedPlan: { grossSavings: 10, netSavings: 8, opexOneOff: 2, opexRec: 0.5, capex: 4 },
        },
      ],
    });
    const s = programSummary(data);
    expect(s.plannedCosts).toBe(6); // lockedPlan: 4 + 2
    expect(s.engagedCosts).toBe(2); // courant (3+1) × 50%
  });

  it("engagedCosts counts 100% for delivered levers regardless of progress", () => {
    const data = makeData({
      levers: [
        {
          ...baseLever,
          id: "L001",
          status: "delivered" as LeverStatus,
          capex: 2,
          opexOneOff: 1,
          progress: 90,
        },
      ],
    });
    expect(programSummary(data).engagedCosts).toBe(3);
  });

  it("riskCostOverrun and riskSavingsCut compare reforecast vs lockedPlan", () => {
    const plan = { grossSavings: 10, netSavings: 8, opexOneOff: 1, opexRec: 0.5, capex: 2 };
    const data = makeData({
      levers: [
        // Surcoût : reforecast coûts (5) > plan (3)
        {
          ...baseLever,
          id: "L001",
          lockedPlan: plan,
          reforecast: { ...plan, capex: 4 },
        },
        // Savings réduits : reforecast net (6) < plan (8)
        {
          ...baseLever,
          id: "L002",
          lockedPlan: plan,
          reforecast: { ...plan, netSavings: 6 },
        },
        // Ni l'un ni l'autre
        { ...baseLever, id: "L003", lockedPlan: plan, reforecast: { ...plan } },
        // Sans reforecast → jamais compté
        { ...baseLever, id: "L004", lockedPlan: plan },
      ],
    });
    const s = programSummary(data);
    expect(s.riskCostOverrun).toBe(1);
    expect(s.riskSavingsCut).toBe(1);
  });

  it("suppressions aggregate FTE of 'Départ forcé' movements, realized = status Réalisé", () => {
    const data = makeData({
      workforce: {
        totalFTE: 200,
        massSalary: 15,
        budgetSalary: 16,
        departments: [],
        employees: [],
        movements: [
          {
            id: "MV1",
            empId: "EMP1",
            label: "A",
            leverId: "L001",
            type: "Départ forcé",
            fte: 3,
            department: "Prod",
            country: "France",
            hrOwner: "HR",
            plannedDate: "2026-06-30",
            actualDate: "2026-06-15",
            status: "Réalisé",
            hrValidated: true,
            salaryImpact: -100000,
            savings: 100000,
            cost: 20000,
          },
          {
            id: "MV2",
            empId: "EMP2",
            label: "B",
            leverId: "L001",
            type: "Départ forcé",
            fte: 2,
            department: "Prod",
            country: "France",
            hrOwner: "HR",
            plannedDate: "2026-09-30",
            actualDate: null,
            status: "Planifié",
            hrValidated: false,
            salaryImpact: -80000,
            savings: 80000,
            cost: 15000,
          },
          {
            id: "MV3",
            empId: "EMP3",
            label: "C",
            leverId: "L001",
            type: "Recrutement",
            fte: 1,
            department: "IT",
            country: "France",
            hrOwner: "HR",
            plannedDate: "2026-09-30",
            actualDate: null,
            status: "Planifié",
            hrValidated: false,
            salaryImpact: 60000,
            savings: 0,
            cost: 10000,
          },
        ],
      },
    });
    const s = programSummary(data);
    expect(s.suppressionsPlanned).toBe(5); // 3 + 2, le Recrutement est exclu
    expect(s.suppressionsRealized).toBe(3);
  });

  it("cancelled levers are excluded from all cost aggregates", () => {
    const data = makeData({
      levers: [
        { ...baseLever, id: "L001", status: "cancelled" as LeverStatus, capex: 10, opexOneOff: 5 },
      ],
    });
    const s = programSummary(data);
    expect(s.plannedCosts).toBe(0);
    expect(s.engagedCosts).toBe(0);
    expect(s.reforecastCosts).toBe(0);
  });
});

describe("engine — pnlImpactDetailed from action impacts", () => {
  it("uses action-level accounts, timing and delivered status", () => {
    const data = makeData({
      pnlAccounts: [
        { id: "GA", name: "General & Admin", baseline: -10, sign: -1 },
        { id: "COGS", name: "Cost of Goods Sold", baseline: -20, sign: -1 },
      ],
      levers: [
        {
          ...baseLever,
          pnlMap: "GA",
          actions: [
            {
              id: "A1",
              name: "Consulting",
              start: "2026-01-01",
              end: "2026-02-28",
              deliveredDate: "2026-02-15",
              status: "done",
              cost: 50,
              impacts: [
                {
                  id: "I1",
                  label: "Consulting fees",
                  type: "cost",
                  nature: "oneoff",
                  amount: 0.2,
                  pnlMap: "GA",
                },
              ],
            },
            {
              id: "A2",
              name: "Savings",
              start: "2026-02-01",
              end: "2026-03-31",
              status: "todo",
              cost: 0,
              impacts: [
                {
                  id: "I2",
                  label: "Productivity savings",
                  type: "saving",
                  nature: "opex_rec",
                  amount: 1,
                  pnlMap: "COGS",
                },
              ],
            },
          ],
        },
      ],
    });

    const feb = pnlImpactDetailed(data, { year: "2026", quarter: "Q1", month: "Feb" });
    expect(feb).toEqual([
      { accountId: "GA", accountName: "General & Admin", plan: -0.2, realized: -0.2 },
    ]);

    const march = pnlImpactDetailed(data, { year: "2026", quarter: "Q1", month: "Mar" });
    expect(march).toEqual([
      { accountId: "COGS", accountName: "Cost of Goods Sold", plan: 1, realized: 0 },
    ]);
  });
});

describe("engine — pnlImpactDetailed driven by the financial hierarchy", () => {
  const hierarchyLevels: HierarchyLevelDef[] = [
    { key: "pnl_account", label: "Compte P&L", order: 0, semantic: "pnl" },
    { key: "cost_center", label: "Cost Center", order: 1 },
  ];

  const hierarchyNodes: HierarchyNode[] = [
    {
      id: "N-GA",
      companyId: "C1",
      levelKey: "pnl_account",
      code: "GA",
      label: "General & Admin",
      parentId: null,
      domain: "financial",
    },
    {
      id: "N-REV",
      companyId: "C1",
      levelKey: "pnl_account",
      code: "REV",
      label: "Revenue",
      parentId: null,
      domain: "financial",
    },
    {
      id: "N-CC01",
      companyId: "C1",
      levelKey: "cost_center",
      code: "CC01",
      label: "Cost Center 1",
      parentId: "N-GA",
      domain: "financial",
    },
  ];

  it("lists every configured P&L account, including ones with no lever at plan=0/realized=0", () => {
    const data = makeData({
      pnlAccounts: [],
      levers: [
        {
          ...baseLever,
          pnlMap: "SOME_STALE_VALUE", // ignoré : la hiérarchie fait foi dès que hierarchyLeafId est résolu
          hierarchyLeafId: "N-CC01",
          status: "delivered",
          netSavings: 3,
          lockedPlan: { grossSavings: 4, netSavings: 3, opexOneOff: 0, opexRec: 0, capex: 0 },
          deliveredDate: "2026-06-01",
        },
      ],
    });

    const result = pnlImpactDetailed(data, undefined, hierarchyNodes, hierarchyLevels);

    expect(result).toEqual(
      expect.arrayContaining([
        { accountId: "GA", accountName: "General & Admin", plan: 3, realized: 3 },
        { accountId: "REV", accountName: "Revenue", plan: 0, realized: 0 },
      ])
    );
    expect(result).toHaveLength(2);
  });

  it("falls back to lever.pnlMap for a lever without hierarchyLeafId, without dropping it", () => {
    const data = makeData({
      pnlAccounts: [{ id: "COGS", name: "Cost of Goods Sold", baseline: -20, sign: -1 }],
      levers: [
        {
          ...baseLever,
          pnlMap: "COGS",
          hierarchyLeafId: undefined,
          status: "delivered",
          netSavings: 5,
          lockedPlan: { grossSavings: 6, netSavings: 5, opexOneOff: 0, opexRec: 0, capex: 0 },
          deliveredDate: "2026-06-01",
        },
      ],
    });

    const result = pnlImpactDetailed(data, undefined, hierarchyNodes, hierarchyLevels);

    expect(result).toEqual(
      expect.arrayContaining([
        { accountId: "COGS", accountName: "Cost of Goods Sold", plan: 5, realized: 5 },
        { accountId: "GA", accountName: "General & Admin", plan: 0, realized: 0 },
        { accountId: "REV", accountName: "Revenue", plan: 0, realized: 0 },
      ])
    );
    expect(result).toHaveLength(3);
  });

  it("keeps the exact legacy behavior when no financial hierarchy is configured (no hierarchy args)", () => {
    const data = makeData({
      pnlAccounts: [{ id: "COGS", name: "Cost of Goods Sold", baseline: -20, sign: -1 }],
      levers: [
        {
          ...baseLever,
          pnlMap: "COGS",
          hierarchyLeafId: "N-CC01", // ignoré : pas d'arborescence "pnl" passée en paramètre
          status: "delivered",
          netSavings: 5,
          lockedPlan: { grossSavings: 6, netSavings: 5, opexOneOff: 0, opexRec: 0, capex: 0 },
          deliveredDate: "2026-06-01",
        },
      ],
    });

    const withoutHierarchy = pnlImpactDetailed(data);
    const withEmptyHierarchy = pnlImpactDetailed(data, undefined, [], []);
    const expected = [
      { accountId: "COGS", accountName: "Cost of Goods Sold", plan: 5, realized: 5 },
    ];

    expect(withoutHierarchy).toEqual(expected);
    expect(withEmptyHierarchy).toEqual(expected);
  });
});
