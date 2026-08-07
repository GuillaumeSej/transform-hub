import { describe, expect, it } from "vitest";
import { movementSocialSchemePatch, movementStatusPatch } from "@/lib/workforceLogic";
import type { WorkforceMovement } from "@/types";

const movement: WorkforceMovement = {
  id: "MV001",
  empId: "EMP001",
  label: "Alice",
  leverId: "L001",
  type: "Départ forcé",
  fte: 1,
  department: "Finance",
  country: "France",
  hrOwner: "Nadia",
  plannedDate: "2026-09-30",
  actualDate: null,
  status: "Planifié",
  hrValidated: false,
  salaryImpact: -80000,
  savings: 80000,
  cost: 20000,
};

describe("movementStatusPatch", () => {
  it("sets an effective date when the status becomes Réalisé", () => {
    expect(movementStatusPatch(movement, "Réalisé", "2026-10-05")).toEqual({
      status: "Réalisé",
      actualDate: "2026-10-05",
    });
  });

  it("preserves an existing effective date", () => {
    expect(
      movementStatusPatch({ ...movement, actualDate: "2026-10-01" }, "Réalisé", "2026-10-05")
    ).toEqual({ status: "Réalisé", actualDate: "2026-10-01" });
  });

  it("clears effective date and RH validation when returning to a non-realized status", () => {
    expect(
      movementStatusPatch(
        { ...movement, actualDate: "2026-10-01", status: "Réalisé", hrValidated: true },
        "À faire"
      )
    ).toEqual({ status: "À faire", actualDate: null, hrValidated: false });
  });
});

describe("movementSocialSchemePatch", () => {
  it("synchronizes PSE with the legacy inPSE flag", () => {
    expect(movementSocialSchemePatch("PSE")).toEqual({ socialScheme: "PSE", inPSE: true });
    expect(movementSocialSchemePatch("RC")).toEqual({ socialScheme: "RC", inPSE: false });
  });
});
