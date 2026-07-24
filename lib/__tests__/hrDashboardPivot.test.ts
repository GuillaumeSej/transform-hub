import { describe, it, expect } from "vitest";
import {
  HR_METRIC_REGISTRY,
  HR_DIMENSION_REGISTRY,
  getHrMetricDef,
  getHrDimensionDef,
  pivotWorkforceByDimension,
} from "@/lib/hrDashboardPivot";
import type { WorkforceMovement } from "@/types";

function makeMovement(overrides: Partial<WorkforceMovement>): WorkforceMovement {
  return {
    id: "M001",
    empId: "E001",
    label: "Test movement",
    leverId: "L001",
    type: "Suppression",
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
  it("getHrMetricDef finds known metrics", () => {
    expect(getHrMetricDef("fteImpact")?.label).toBeDefined();
    expect(getHrMetricDef("salarySavings")?.label).toBeDefined();
    expect(getHrMetricDef("socialCost")?.label).toBeDefined();
    expect(getHrMetricDef("netFirstYearImpact")?.label).toBeDefined();
    expect(getHrMetricDef("movementCount")?.label).toBeDefined();
  });

  it("getHrMetricDef returns undefined for an unknown key", () => {
    expect(getHrMetricDef("does-not-exist")).toBeUndefined();
  });

  it("getHrDimensionDef finds known dimensions", () => {
    [
      "type",
      "department",
      "toDepartment",
      "country",
      "hrOwner",
      "status",
      "pse",
      "plannedMonth",
      "plannedQuarter",
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

describe("hrDashboardPivot — pivotWorkforceByDimension", () => {
  const movements: WorkforceMovement[] = [
    makeMovement({
      id: "M1",
      type: "Suppression",
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
      type: "Redéploiement",
      department: "Supply Chain",
      toDepartment: "IT",
      country: "Germany",
      fte: 1,
      salaryImpact: 0,
      savings: 0,
      cost: 3000,
    }),
  ];

  it("groups by dimension and sums the requested metric, sorted descending", () => {
    const rows = pivotWorkforceByDimension(movements, "movementCount", "department");
    expect(rows.map((r) => r.key).sort()).toEqual(["IT", "Supply Chain"]);
    const supplyChain = rows.find((r) => r.key === "Supply Chain")!;
    expect(supplyChain.count).toBe(2);
  });

  it("fteImpact is signed by movement type (Suppression negative, Recrutement positive, transfer 0)", () => {
    const rows = pivotWorkforceByDimension(movements, "fteImpact", "type");
    expect(rows.find((r) => r.key === "Suppression")?.value).toBe(-2);
    expect(rows.find((r) => r.key === "Recrutement")?.value).toBe(1);
    expect(rows.find((r) => r.key === "Redéploiement")?.value).toBe(0);
  });

  it("salarySavings/socialCost/netFirstYearImpact aggregate the persisted fields", () => {
    const savingsRows = pivotWorkforceByDimension(movements, "salarySavings", "country");
    expect(savingsRows.find((r) => r.key === "France")?.value).toBe(100000);

    const costRows = pivotWorkforceByDimension(movements, "socialCost", "country");
    expect(costRows.find((r) => r.key === "France")?.value).toBe(29000);

    const netRows = pivotWorkforceByDimension(movements, "netFirstYearImpact", "country");
    // France: (-100000 + 20000) + (60000 + 9000) = -80000 + 69000 = -11000
    expect(netRows.find((r) => r.key === "France")?.value).toBe(-11000);
  });

  it("unknown metric or dimension key returns an empty array", () => {
    expect(pivotWorkforceByDimension(movements, "not-a-metric", "department")).toEqual([]);
    expect(pivotWorkforceByDimension(movements, "movementCount", "not-a-dimension")).toEqual([]);
  });

  it("empty input returns an empty array", () => {
    expect(pivotWorkforceByDimension([], "movementCount", "department")).toEqual([]);
  });

  it("falls back to a placeholder label for a blank dimension value", () => {
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
    const monthRows = pivotWorkforceByDimension(movements, "movementCount", "plannedMonth");
    expect(monthRows.some((r) => r.label === "Mar 2026")).toBe(true);
    const quarterRows = pivotWorkforceByDimension(movements, "movementCount", "plannedQuarter");
    expect(quarterRows.some((r) => r.label === "T1 2026")).toBe(true);
  });
});
