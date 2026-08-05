import { describe, it, expect } from "vitest";
import {
  EMPTY_HR_DIMENSION_CONTEXT,
  HR_METRIC_REGISTRY,
  HR_DIMENSION_REGISTRY,
  getHrMetricDef,
  getHrDimensionDef,
  pivotWorkforceByDimension,
  type HrDimensionContext,
} from "@/lib/hrDashboardPivot";
import type {
  Company,
  Employee,
  HierarchyLevelDef,
  HierarchyNode,
  WorkforceMovement,
} from "@/types";

function makeMovement(overrides: Partial<WorkforceMovement>): WorkforceMovement {
  return {
    id: "M001",
    empId: "E001",
    label: "Test movement",
    leverId: "L001",
    type: "Départ forcé",
    fte: 1,
    department: "Supply Chain",
    country: "France",
    hrOwner: "Alice",
    plannedDate: "2026-03-15",
    actualDate: null,
    status: "Planifié",
    hrValidated: false,
    inPSE: false,
    salaryImpact: -50000,
    savings: 50000,
    cost: 10000,
    ...overrides,
  };
}

describe("hrDashboardPivot — registries", () => {
  it("getHrMetricDef finds known metrics (including new netEconomy)", () => {
    [
      "fteImpact",
      "salarySavings",
      "socialCost",
      "netEconomy",
      "netFirstYearImpact",
      "movementCount",
    ].forEach((key) => {
      expect(getHrMetricDef(key)?.label).toBeDefined();
    });
  });

  it("socialCost label uses the ENR (Gooduelle) vocabulary", () => {
    expect(getHrMetricDef("socialCost")?.label).toMatch(/ENR/);
  });

  it("getHrDimensionDef finds known dimensions (including region + fiscalYear)", () => {
    [
      "type",
      "department",
      "toDepartment",
      "country",
      "region",
      "hrOwner",
      "status",
      "pse",
      "plannedMonth",
      "plannedQuarter",
      "fiscalYear",
    ].forEach((key) => {
      expect(getHrDimensionDef(key)?.label).toBeDefined();
    });
  });

  it("HR_METRIC_REGISTRY / HR_DIMENSION_REGISTRY have unique keys", () => {
    expect(new Set(HR_METRIC_REGISTRY.map((m) => m.key)).size).toBe(HR_METRIC_REGISTRY.length);
    expect(new Set(HR_DIMENSION_REGISTRY.map((d) => d.key)).size).toBe(
      HR_DIMENSION_REGISTRY.length
    );
  });
});

describe("hrDashboardPivot — pivotWorkforceByDimension (5-types Gooduelle)", () => {
  const movements: WorkforceMovement[] = [
    makeMovement({
      id: "M1",
      type: "Départ forcé",
      department: "Supply Chain",
      country: "France",
      fte: 2,
      salaryImpact: -100000,
      savings: 100000,
      cost: 20000,
    }),
    makeMovement({
      id: "M2",
      type: "Recrutement",
      department: "IT",
      country: "France",
      fte: 1,
      salaryImpact: 60000,
      savings: 0,
      cost: 9000,
    }),
    makeMovement({
      id: "M3",
      type: "Transfert entrant",
      department: "Supply Chain",
      toDepartment: "IT",
      country: "Germany",
      fte: 1,
      salaryImpact: 0,
      savings: 0,
      cost: 3000,
    }),
  ];

  it("groups by dimension and sorts descending", () => {
    const rows = pivotWorkforceByDimension(movements, "movementCount", "department");
    expect(rows.map((r) => r.key).sort()).toEqual(["IT", "Supply Chain"]);
    expect(rows.find((r) => r.key === "Supply Chain")?.count).toBe(2);
  });

  it("fteImpact signed by movement type (5-types)", () => {
    const rows = pivotWorkforceByDimension(movements, "fteImpact", "type");
    expect(rows.find((r) => r.key === "Départ forcé")?.value).toBe(-2);
    expect(rows.find((r) => r.key === "Recrutement")?.value).toBe(1);
    expect(rows.find((r) => r.key === "Transfert entrant")?.value).toBe(0);
  });

  it("salarySavings / socialCost / netEconomy / netFirstYearImpact aggregate persisted fields", () => {
    const savings = pivotWorkforceByDimension(movements, "salarySavings", "country");
    expect(savings.find((r) => r.key === "France")?.value).toBe(100000);

    const cost = pivotWorkforceByDimension(movements, "socialCost", "country");
    expect(cost.find((r) => r.key === "France")?.value).toBe(29000);

    const net = pivotWorkforceByDimension(movements, "netEconomy", "country");
    // France: (100000 - 20000) + (0 - 9000) = 71000
    expect(net.find((r) => r.key === "France")?.value).toBe(71000);

    const netY1 = pivotWorkforceByDimension(movements, "netFirstYearImpact", "country");
    // France: (-100000 + 20000) + (60000 + 9000) = -11000
    expect(netY1.find((r) => r.key === "France")?.value).toBe(-11000);
  });

  it("unknown metric or dimension returns empty array", () => {
    expect(pivotWorkforceByDimension(movements, "not-a-metric", "department")).toEqual([]);
    expect(pivotWorkforceByDimension(movements, "movementCount", "not-a-dimension")).toEqual([]);
  });

  it("empty input returns empty array", () => {
    expect(pivotWorkforceByDimension([], "movementCount", "department")).toEqual([]);
  });

  it("blank dimension value falls back to placeholder label", () => {
    const withBlank = [...movements, makeMovement({ id: "M4", department: "" })];
    const rows = pivotWorkforceByDimension(withBlank, "movementCount", "department");
    expect(rows.some((r) => r.label === "Non renseigné")).toBe(true);
  });

  it("toDepartment falls back to 'Non applicable' when absent", () => {
    const rows = pivotWorkforceByDimension(movements, "movementCount", "toDepartment");
    expect(rows.some((r) => r.label === "Non applicable")).toBe(true);
    expect(rows.some((r) => r.label === "IT")).toBe(true);
  });

  it("plannedMonth / plannedQuarter derive readable labels from plannedDate", () => {
    const month = pivotWorkforceByDimension(movements, "movementCount", "plannedMonth");
    expect(month.some((r) => r.label === "Mar 2026")).toBe(true);
    const quarter = pivotWorkforceByDimension(movements, "movementCount", "plannedQuarter");
    expect(quarter.some((r) => r.label === "T1 2026")).toBe(true);
  });
});

describe("hrDashboardPivot — dimension context (region + fiscalYear)", () => {
  const employees: Employee[] = [
    {
      id: "E100",
      name: "Alice",
      region: "EMEA",
      country: "France",
      department: "IT",
      direction: "Dir IT",
      hrOwner: "HR",
      func: "Engineer",
      team: "A",
      bu: "BU1",
      entity: "E1",
      level: "Global",
      fte: 1,
      salary: 60000,
      hireDate: "2020-01-01",
      retirement: "",
    },
  ];

  const geographyLevels: HierarchyLevelDef[] = [
    { key: "region", label: "Région", order: 0, semantic: "region" },
    { key: "country", label: "Pays", order: 1, semantic: "country" },
  ];

  const geographyNodes: HierarchyNode[] = [
    {
      id: "N-REG-APAC",
      companyId: "c1",
      levelKey: "region",
      code: "APAC",
      label: "APAC",
      parentId: null,
      domain: "geographic",
    },
    {
      id: "N-CTR-JP",
      companyId: "c1",
      levelKey: "country",
      code: "Japan",
      label: "Japan",
      parentId: "N-REG-APAC",
      domain: "geographic",
    },
  ];

  const company: Company = {
    id: "c1",
    name: "Test",
    industry: "Test",
    createdAt: "2026-01-01",
    fyStart: "2026-07-01",
    fyEnd: "2027-06-30",
  };

  const ctx: HrDimensionContext = {
    employees,
    geographyNodes,
    geographyLevels,
    activeCompany: company,
  };

  it("region dimension resolves via employee.region when empId points to a known employee", () => {
    const movements = [
      makeMovement({ empId: "E100", country: "France" }),
      makeMovement({ id: "M2", empId: null, country: "Japan" }),
    ];
    const rows = pivotWorkforceByDimension(movements, "movementCount", "region", ctx);
    const labels = rows.map((r) => r.label);
    expect(labels).toContain("EMEA");
    expect(labels).toContain("APAC");
  });

  it("region dimension falls back to country when no hierarchy configured", () => {
    const movements = [makeMovement({ empId: null, country: "France" })];
    const rows = pivotWorkforceByDimension(
      movements,
      "movementCount",
      "region",
      EMPTY_HR_DIMENSION_CONTEXT
    );
    expect(rows.some((r) => r.label === "France")).toBe(true);
  });

  it("fiscalYear dimension uses activeCompany.fyStart when available", () => {
    const movements = [
      makeMovement({ plannedDate: "2026-06-15" }),
      makeMovement({ id: "M2", plannedDate: "2026-08-15" }),
    ];
    const rows = pivotWorkforceByDimension(movements, "movementCount", "fiscalYear", ctx);
    const labels = rows.map((r) => r.label);
    expect(labels).toContain("FY25/26");
    expect(labels).toContain("FY26/27");
  });

  it("fiscalYear dimension falls back to placeholder when no company", () => {
    const rows = pivotWorkforceByDimension(
      [makeMovement({ plannedDate: "2026-06-15" })],
      "movementCount",
      "fiscalYear",
      EMPTY_HR_DIMENSION_CONTEXT
    );
    expect(rows.some((r) => r.label === "Non renseigné")).toBe(true);
  });
});
