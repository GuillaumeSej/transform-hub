import { describe, expect, it } from "vitest";
import {
  classifyMovementAction,
  classifyMovementExecution,
  movementProgressByDimension,
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

  it("retains the movements behind each dimension/status cell for drill-down", () => {
    const rows = salaryExecutionByDimension(
      [
        movement({ id: "M1", function: "Finance", status: "À faire", plannedDate: "2026-06-01" }),
        movement({ id: "M2", function: "Finance", status: "À faire", plannedDate: "2026-06-05" }),
        movement({ id: "M3", function: "Finance", status: "Abandonné" }),
      ],
      "function",
      programs,
      "2026-06-22"
    );
    const finance = rows.find((row) => row.label === "Finance")!;
    expect(finance.overdue.movements.map((m) => m.id).sort()).toEqual(["M1", "M2"]);
    expect(finance.abandoned.movements.map((m) => m.id)).toEqual(["M3"]);
    expect(finance.dueSoon.movements).toEqual([]);
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

  it("retains the movements behind each (type, status) cell for drill-down", () => {
    const rows = movementStatusByType(
      [
        movement({ id: "M1", type: "Recrutement", status: "Réalisé" }),
        movement({ id: "M2", type: "Recrutement", status: "Réalisé" }),
        movement({ id: "M3", type: "Recrutement", status: "Abandonné" }),
      ],
      {},
      "2026-06-22"
    );
    const recrutement = rows.find((row) => row.type === "Recrutement")!;
    expect(recrutement.movementsByStatus.realized.map((m) => m.id).sort()).toEqual(["M1", "M2"]);
    expect(recrutement.movementsByStatus.abandoned.map((m) => m.id)).toEqual(["M3"]);
    expect(recrutement.movementsByStatus.overdue).toEqual([]);
  });
});

describe("movementProgressByDimension", () => {
  const today = "2026-06-22";
  const sample = [
    movement({ id: "A", status: "Abandonné", department: "IT", plannedDate: "2026-01-01" }),
    movement({ id: "R", status: "Réalisé", department: "IT", plannedDate: "2026-01-01" }),
    movement({ id: "O", status: "Planifié", department: "IT", plannedDate: "2026-06-21" }),
    // Pile 90 jours après `today` → ≤ 90 j ; 91 jours → > 90 j.
    movement({ id: "S", status: "À faire", department: "IT", plannedDate: "2026-09-20" }),
    movement({ id: "L", status: "Planifié", department: "IT", plannedDate: "2026-09-21" }),
    movement({ id: "T", status: "Planifié", department: "HR", plannedDate: "2026-06-22" }),
  ];

  it("buckets movements into the 5 statuses with the 90-day boundary", () => {
    const rows = movementProgressByDimension(sample, "department", {}, today);
    const itRow = rows.find((row) => row.label === "IT")!;
    expect(itRow.counts).toEqual({ abandoned: 1, realized: 1, overdue: 1, dueSoon: 1, later: 1 });
    expect(itRow.total).toBe(5);
    expect(itRow.movementsByStatus.dueSoon.map((m) => m.id)).toEqual(["S"]);
    expect(itRow.movementsByStatus.later.map((m) => m.id)).toEqual(["L"]);
    // Date prévue = aujourd'hui → pas en retard, à venir ≤ 90 j.
    expect(rows.find((row) => row.label === "HR")!.counts.dueSoon).toBe(1);
  });

  it("sorts groups by total and supports program / country dimensions", () => {
    const rows = movementProgressByDimension(sample, "department", {}, today);
    expect(rows.map((row) => row.label)).toEqual(["IT", "HR"]);
    const byProgram = movementProgressByDimension(
      [...sample, movement({ id: "X", programId: undefined })],
      "program",
      { p1: "Transformation 2026" },
      today
    );
    expect(byProgram.map((row) => row.label)).toEqual(["Transformation 2026", "Non renseigné"]);
    const byCountry = movementProgressByDimension(sample, "country", {}, today);
    expect(byCountry).toHaveLength(1);
    expect(byCountry[0].total).toBe(6);
  });
});
