import { describe, expect, it } from "vitest";
import {
  classifyMovementAction,
  classifyMovementExecution,
  fteExecutionByDimension,
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

describe("classifyMovementExecution", () => {
  it("prioritizes realized, then overdue, in progress and upcoming", () => {
    expect(classifyMovementExecution(movement({ status: "Réalisé" }), "2026-06-22")).toBe(
      "realized"
    );
    expect(classifyMovementExecution(movement({ plannedDate: "2026-06-01" }), "2026-06-22")).toBe(
      "overdue"
    );
    expect(classifyMovementExecution(movement({ status: "En cours" }), "2026-06-22")).toBe(
      "inProgress"
    );
    expect(classifyMovementExecution(movement({ status: "Planifié" }), "2026-06-22")).toBe(
      "upcoming"
    );
  });
});

describe("classifyMovementAction", () => {
  it("splits upcoming movements at 90 days and flags pending validation", () => {
    expect(classifyMovementAction(movement({ plannedDate: "2026-09-01" }), "2026-06-22", 90)).toBe(
      "dueSoon"
    );
    expect(classifyMovementAction(movement({ plannedDate: "2027-01-01" }), "2026-06-22", 90)).toBe(
      "later"
    );
    expect(
      classifyMovementAction(movement({ status: "Réalisé", hrValidated: false }), "2026-06-22", 90)
    ).toBe("toValidate");
  });
});

describe("execution aggregations", () => {
  it("aggregates positive ETP volume and signed net impact", () => {
    const rows = fteExecutionByDimension(
      [
        movement({ id: "M1", type: "Départ forcé", fte: 2, status: "Réalisé" }),
        movement({ id: "M2", type: "Recrutement", fte: 3, status: "Réalisé" }),
      ],
      "program",
      programs
    );
    expect(rows[0].realized).toMatchObject({ volume: 5, net: 1, count: 2 });
  });

  it("uses reforecast salary impact for non-realized movements", () => {
    const rows = salaryExecutionByDimension(
      [
        movement({
          status: "En cours",
          reforecast: { fte: 2, salaryImpact: -120000, savings: 120000, cost: 20000 },
        }),
      ],
      "function",
      programs
    );
    expect(rows[0].inProgress.volume).toBeCloseTo(-0.12);
  });
});

describe("ownerActionSummary", () => {
  it("sorts owners by overdue then due soon and exposes the next due date", () => {
    const rows = ownerActionSummary(
      [
        movement({ id: "M1", hrOwner: "Nadia", plannedDate: "2026-06-01" }),
        movement({ id: "M2", hrOwner: "Nadia", plannedDate: "2026-08-01" }),
        movement({ id: "M3", hrOwner: "Petra", plannedDate: "2027-01-01" }),
      ],
      "2026-06-22",
      90
    );
    expect(rows[0].owner).toBe("Nadia");
    expect(rows[0].overdue.count).toBe(1);
    expect(rows[0].dueSoon.count).toBe(1);
    expect(rows[0].nextDueDate).toBe("2026-06-01");
  });
});
