import { describe, expect, it } from "vitest";
import { forcedDeparturesBySocialScheme } from "@/lib/hrSocialPlan";
import type { WorkforceMovement } from "@/types";

function movement(overrides: Partial<WorkforceMovement>): WorkforceMovement {
  return {
    id: "M1",
    empId: null,
    label: "Test",
    leverId: "L1",
    type: "Départ forcé",
    fte: 1,
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

describe("forcedDeparturesBySocialScheme", () => {
  it("counts one movement per forced departure by scheme and status", () => {
    const rows = forcedDeparturesBySocialScheme([
      movement({ id: "M1", socialScheme: "PSE", status: "Réalisé" }),
      movement({ id: "M2", socialScheme: "PSE", status: "À faire" }),
      movement({ id: "M3", socialScheme: "RC", status: "Abandonné" }),
      movement({ id: "M4", type: "Recrutement", socialScheme: undefined }),
    ]);
    expect(rows.find((row) => row.scheme === "PSE")).toMatchObject({ realized: 1, planned: 1 });
    expect(rows.find((row) => row.scheme === "RC")?.abandoned).toBe(1);
  });
});
