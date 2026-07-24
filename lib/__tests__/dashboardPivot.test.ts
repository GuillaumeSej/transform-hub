import { describe, it, expect } from "vitest";
import {
  METRIC_REGISTRY,
  DIMENSION_REGISTRY,
  getMetricDef,
  getDimensionDef,
  getAvailableDimensions,
  pivotByDimensions,
  type PivotRow,
} from "@/lib/dashboardPivot";
import type { BeTrackData, HierarchyLevelDef, HierarchyNode, Lever, LeverStatus } from "@/types";

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
    priorityLevels: [],
    leverTypes: [],
    geographies: [],
    functions: [],
    pnlAccounts: [{ id: "PNL01", name: "Compte Un", baseline: 0, sign: 1 }],
    levers,
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
  };
}

describe("dashboardPivot — registries", () => {
  it("exposes stable metric keys", () => {
    const keys = METRIC_REGISTRY.map((m) => m.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "netSavings",
        "grossSavings",
        "realizedSavings",
        "fteImpact",
        "progress",
        "capex",
        "opexOneOff",
        "opexRec",
        "leverCount",
      ])
    );
  });

  it("exposes stable dimension keys", () => {
    const keys = DIMENSION_REGISTRY.map((d) => d.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "type",
        "ws",
        "owner",
        "sponsor",
        "geography",
        "country",
        "entity",
        "function",
        "priority",
        "risk",
        "status",
        "project",
        "pnlAccount",
      ])
    );
  });

  it("getMetricDef/getDimensionDef return undefined for unknown keys", () => {
    expect(getMetricDef("does-not-exist")).toBeUndefined();
    expect(getDimensionDef("does-not-exist")).toBeUndefined();
  });

  it("getAvailableDimensions adds one dimension per hierarchy level, ordered", () => {
    const levels: HierarchyLevelDef[] = [
      { key: "cost_center", label: "Centre de coût", order: 1 },
      { key: "business_unit", label: "Business Unit", order: 0 },
    ];
    const dims = getAvailableDimensions(levels);
    const hierarchyDims = dims.filter((d) => d.key.startsWith("hierarchy:"));
    expect(hierarchyDims.map((d) => d.label)).toEqual(["Business Unit", "Centre de coût"]);
  });

  it("getDimensionDef resolves a hierarchy dimension key when the level exists", () => {
    const levels: HierarchyLevelDef[] = [
      { key: "business_unit", label: "Business Unit", order: 0 },
    ];
    expect(getDimensionDef("hierarchy:business_unit", levels)?.label).toBe("Business Unit");
    expect(getDimensionDef("hierarchy:unknown_level", levels)).toBeUndefined();
  });
});

describe("dashboardPivot — pivotByDimensions (1 dimension)", () => {
  it("sums a numeric metric by a single dimension", () => {
    const data = makeData([
      { ...baseLever, id: "L001", country: "France", netSavings: 6 },
      { ...baseLever, id: "L002", country: "France", netSavings: 2 },
      { ...baseLever, id: "L003", country: "Germany", netSavings: 4 },
    ]);
    const rows = pivotByDimensions(data, "netSavings", ["country"]) as PivotRow[];
    const france = rows.find((r) => r.key === "France")!;
    const germany = rows.find((r) => r.key === "Germany")!;
    expect(france.value).toBe(8);
    expect(france.count).toBe(2);
    expect(germany.value).toBe(4);
    // Triées par valeur décroissante.
    expect(rows[0].key).toBe("France");
  });

  it("counts levers by a single dimension for the leverCount metric", () => {
    const data = makeData([
      { ...baseLever, id: "L001", function: "IT" },
      { ...baseLever, id: "L002", function: "IT" },
      { ...baseLever, id: "L003", function: "HR" },
    ]);
    const rows = pivotByDimensions(data, "leverCount", ["function"]) as PivotRow[];
    expect(rows.find((r) => r.key === "IT")?.value).toBe(2);
    expect(rows.find((r) => r.key === "HR")?.value).toBe(1);
  });

  it("averages the progress metric rather than summing it", () => {
    const data = makeData([
      { ...baseLever, id: "L001", function: "IT", progress: 20 },
      { ...baseLever, id: "L002", function: "IT", progress: 60 },
    ]);
    const rows = pivotByDimensions(data, "progress", ["function"]) as PivotRow[];
    expect(rows.find((r) => r.key === "IT")?.value).toBe(40);
  });

  it("excludes cancelled levers, matching the legacy engine aggregation helpers", () => {
    const data = makeData([
      { ...baseLever, id: "L001", country: "France", netSavings: 6 },
      {
        ...baseLever,
        id: "L002",
        country: "France",
        netSavings: 100,
        status: "cancelled" as LeverStatus,
      },
    ]);
    const rows = pivotByDimensions(data, "netSavings", ["country"]) as PivotRow[];
    expect(rows.find((r) => r.key === "France")?.value).toBe(6);
  });
});

describe("dashboardPivot — pivotByDimensions (2 dimensions)", () => {
  it("returns a Marimekko-shaped breakdown (primary column × secondary segments)", () => {
    const data = makeData([
      { ...baseLever, id: "L001", function: "IT", country: "France", netSavings: 6 },
      { ...baseLever, id: "L002", function: "IT", country: "Germany", netSavings: 2 },
      { ...baseLever, id: "L003", function: "HR", country: "France", netSavings: 4 },
    ]);
    const columns = pivotByDimensions(data, "netSavings", ["function", "country"]) as {
      key: string;
      totalSavings: number;
      widthPct: number;
      segments: { key: string; value: number; heightPct: number }[];
    }[];
    const it = columns.find((c) => c.key === "IT")!;
    const hr = columns.find((c) => c.key === "HR")!;
    expect(it.totalSavings).toBe(8);
    expect(hr.totalSavings).toBe(4);
    expect(columns[0].key).toBe("IT");
    const franceSeg = it.segments.find((s) => s.key === "France")!;
    expect(franceSeg.value).toBe(6);
    expect(franceSeg.heightPct).toBe(75);
  });
});

describe("dashboardPivot — edge cases", () => {
  it("returns an empty array for empty data", () => {
    const data = makeData([]);
    expect(pivotByDimensions(data, "netSavings", ["country"])).toEqual([]);
    expect(pivotByDimensions(data, "netSavings", ["function", "country"])).toEqual([]);
  });

  it("groups missing/empty dimension values under a fallback bucket rather than dropping them", () => {
    const data = makeData([{ ...baseLever, id: "L001", country: "", netSavings: 5 }]);
    const rows = pivotByDimensions(data, "netSavings", ["country"]) as PivotRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(5);
    expect(rows[0].key).not.toBe("");
  });

  it("returns an empty array for an unknown metric or dimension key", () => {
    const data = makeData([{ ...baseLever }]);
    expect(pivotByDimensions(data, "does-not-exist", ["country"])).toEqual([]);
    expect(pivotByDimensions(data, "netSavings", ["does-not-exist"])).toEqual([]);
  });

  it("resolves workstream and project dimensions via lookup context", () => {
    const data = makeData([{ ...baseLever, id: "L001", ws: "WS-01", projectId: "PRJ-1" }]);
    const rows = pivotByDimensions(data, "netSavings", ["ws"]) as PivotRow[];
    expect(rows[0].key).toBe("Workstream Un");
    const projectRows = pivotByDimensions(data, "netSavings", ["project"], {
      projects: [
        {
          id: "PRJ-1",
          companyId: "C1",
          name: "Projet Un",
          sponsor: "S",
          target: 1,
          currency: "€M",
          fyStart: "2026-01-01",
          fyEnd: "2026-12-31",
          baselineEBIT: 1,
          revenue: 1,
          createdAt: "2026-01-01",
        },
      ],
    }) as PivotRow[];
    expect(projectRows[0].key).toBe("Projet Un");
  });

  it("resolves hierarchy dimensions via resolveHierarchyPath, falling back gracefully without nodes", () => {
    const levels: HierarchyLevelDef[] = [
      { key: "business_unit", label: "Business Unit", order: 0 },
    ];
    const nodes: HierarchyNode[] = [
      {
        id: "bu1",
        companyId: "C1",
        levelKey: "business_unit",
        code: "BU1",
        label: "BU Industrie",
        parentId: null,
      },
    ];
    const data = makeData([{ ...baseLever, id: "L001", hierarchyLeafId: "bu1" }]);
    const withNodes = pivotByDimensions(data, "netSavings", ["hierarchy:business_unit"], {
      hierarchyLevels: levels,
      hierarchyNodes: nodes,
    }) as PivotRow[];
    expect(withNodes[0].key).toBe("BU Industrie");

    const withoutNodes = pivotByDimensions(data, "netSavings", ["hierarchy:business_unit"], {
      hierarchyLevels: levels,
    }) as PivotRow[];
    expect(withoutNodes).toHaveLength(1);
  });
});
