import { describe, expect, it } from "vitest";
import {
  classifyMovementAction,
  classifyMovementExecution,
  movementStatusByType,
  movementStatusGroups,
  ownerActionSummary,
  salaryExecutionByDimension,
} from "@/lib/hrExecution";
import type { Program, WorkforceMovement } from "@/types";

function movement(overrides: Partial<WorkforceMovement>): WorkforceMovement {
  return {
    id: "M1",
    empId: null,
    label: "Test",
    leverId: "L1",
    programId: "p1",
    function: "Finance",
    type: "Départ forcé",
    fte: 2,
    department: "Finance",
    country: "France",
    hrOwner: "Nadia",
    plannedDate: "2026-07-01",
    actualDate: null,
    status: "Planifié",
    hrValidated: false,
    salaryImpact: -100000,
    savings: 100000,
    cost: 20000,
    ...overrides,
  };
}

const programs = [{ id: "p1", name: "Transformation 2026" }] as Program[];

describe("movement execution classification", () => {
  it("returns the four requested statuses and excludes abandoned movements", () => {
    expect(classifyMovementExecution(movement({ status: "Réalisé" }), "2026-06-22")).toBe(
      "realized"
    );
    expect(classifyMovementExecution(movement({ plannedDate: "2026-06-01" }), "2026-06-22")).toBe(
      "overdue"
    );
    expect(classifyMovementExecution(movement({ plannedDate: "2026-09-20" }), "2026-06-22")).toBe(
      "dueSoon"
    );
    expect(classifyMovementExecution(movement({ plannedDate: "2026-09-21" }), "2026-06-22")).toBe(
      "later"
    );
    expect(classifyMovementExecution(movement({ status: "Abandonné" }), "2026-06-22")).toBe(
      "abandoned"
    );
  });

  it("flags realized movements awaiting RH validation", () => {
    expect(classifyMovementAction(movement({ status: "Réalisé", hrValidated: false }))).toBe(
      "toValidate"
    );
  });
});

describe("execution aggregations", () => {
  it("groups movement cells by dimension and excludes abandoned movements", () => {
    const groups = movementStatusGroups(
      [movement({ id: "M1", status: "Réalisé" }), movement({ id: "M2", status: "Abandonné" })],
      "program",
      programs
    );
    expect(groups[0].cells).toHaveLength(2);
    expect(groups[0].cells.map((cell) => cell.execution).sort()).toEqual(["abandoned", "realized"]);
  });

  it("uses the persisted salaryImpact column for every execution status", () => {
    const rows = salaryExecutionByDimension(
      [
        movement({
          id: "M1",
          status: "À faire",
          plannedDate: "2026-06-01",
          salaryImpact: -80000,
          reforecast: { fte: 2, salaryImpact: -120000, savings: 120000, cost: 20000 },
        }),
        movement({
          id: "M2",
          status: "Planifié",
          plannedDate: "2026-08-01",
          salaryImpact: 50000,
          lockedPlan: { fte: 1, salaryImpact: 90000, savings: 0, cost: 10000 },
        }),
      ],
      "function",
      programs,
      "2026-06-22"
    );
    expect(rows[0].overdue.volume).toBeCloseTo(-0.08);
    expect(rows[0].dueSoon.volume).toBeCloseTo(0.05);
    const chartTotal =
      rows[0].realized.volume +
      rows[0].overdue.volume +
      rows[0].dueSoon.volume +
      rows[0].later.volume;
    expect(chartTotal).toBeCloseTo((-80000 + 50000) / 1_000_000);
  });
});

describe("ownerActionSummary", () => {
  it("sorts by overdue then due soon and ignores abandoned movements", () => {
    const rows = ownerActionSummary(
      [
        movement({ id: "M1", hrOwner: "Nadia", plannedDate: "2026-06-01" }),
        movement({ id: "M2", hrOwner: "Nadia", plannedDate: "2026-08-01" }),
        movement({ id: "M3", hrOwner: "Petra", status: "Abandonné" }),
      ],
      "2026-06-22",
      90
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].owner).toBe("Nadia");
    expect(rows[0].overdue.count).toBe(1);
    expect(rows[0].dueSoon.count).toBe(1);
  });

  it("groups all five movement types and five statuses with department/country filters", () => {
    const rows = movementStatusByType(
      [
        movement({ id: "M1", type: "Recrutement", status: "Réalisé", department: "IT" }),
        movement({ id: "M2", type: "Attrition", status: "Abandonné", department: "IT" }),
        movement({ id: "M3", type: "Départ forcé", plannedDate: "2026-06-01", department: "HR" }),
      ],
      { department: "IT", country: "France" },
      "2026-06-22"
    );
    expect(rows.find((row) => row.type === "Recrutement")?.realized).toBe(1);
    expect(rows.find((row) => row.type === "Attrition")?.abandoned).toBe(1);
    expect(rows.find((row) => row.type === "Départ forcé")?.overdue).toBe(0);
    expect(rows).toHaveLength(5);
  });
});
