import { describe, expect, it } from "vitest";
import { buildMovementTableRows } from "@/lib/hrMovementTable";
import type { Lever, Program, WorkforceMovement } from "@/types";

const movement: WorkforceMovement = {
  id: "MV001",
  empId: "EMP001",
  label: "Alice",
  leverId: "L001",
  programId: "p1",
  workstream: "WS-LEGACY",
  type: "Départ forcé",
  fte: 1,
  department: "Finance",
  country: "France",
  hrOwner: "Nadia",
  plannedDate: "2026-09-30",
  actualDate: null,
  status: "Planifié",
  hrValidated: false,
  inPSE: true,
  salaryImpact: -80000,
  savings: 80000,
  cost: 20000,
};

const lever = {
  id: "L001",
  code: "PROC-001",
  name: "Optimisation achats",
  owner: "Marc Dubois",
  ws: "WS-PROC",
  programId: "p1",
} as Lever;

const programs = [{ id: "p1", name: "Transformation Excellence 2026" }] as Program[];

describe("buildMovementTableRows", () => {
  it("resolves program and initiative owner from the linked lever", () => {
    const [row] = buildMovementTableRows([movement], [lever], programs);
    expect(row.programName).toBe("Transformation Excellence 2026");
    expect(row.initiativeOwner).toBe("Marc Dubois");
  });

  it("falls back from inPSE to the PSE social scheme", () => {
    const [row] = buildMovementTableRows([movement], [lever], programs);
    expect(row.socialScheme).toBe("PSE");
  });

  it("returns placeholders when no lever/program is found", () => {
    const [row] = buildMovementTableRows(
      [{ ...movement, leverId: "UNKNOWN", inPSE: false }],
      [],
      []
    );
    expect(row.programName).toBe("—");
    expect(row.initiativeOwner).toBe("—");
    expect(row.socialScheme).toBe("—");
  });
});
