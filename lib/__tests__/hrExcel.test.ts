import { describe, expect, it } from "vitest";
import { movementToExcelRow, parseMovementRow } from "@/lib/hrExcel";
import type { BeTrackData, WorkforceMovement } from "@/types";

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
  socialScheme: "RC",
  inPSE: false,
  salaryImpact: -80000,
  savings: 80000,
  cost: 20000,
  comment: "À confirmer",
};

const data = {
  levers: [
    {
      id: "L001",
      code: "FIN-001",
      owner: "Marc Dubois",
      ws: "WS-FIN",
      function: "Finance",
      programId: "p1",
    },
  ],
  workforce: { employees: [{ id: "EMP001" }], departments: [{ name: "Finance" }] },
} as unknown as BeTrackData;

describe("hrExcel movement social scheme", () => {
  it("exports social scheme and initiative owner", () => {
    const row = movementToExcelRow(movement, data);
    expect(row["Dispositif social"]).toBe("RC");
    expect(row["Owner Initiative"]).toBe("Marc Dubois");
    expect(row["Programme"]).toBe("p1");
  });

  it("imports a social scheme and linked lever metadata", () => {
    const parsed = parseMovementRow(
      {
        "ID mouvement": "MV001",
        Matricule: "EMP001",
        "Employé / Poste": "Alice",
        Type: "Départ forcé",
        "Levier (code)": "FIN-001",
        "Dispositif social": "RCC",
        Statut: "Planifié",
        Département: "Finance",
        Pays: "France",
      },
      data,
      2
    );
    expect(parsed.values?.socialScheme).toBe("RCC");
    expect(parsed.values?.inPSE).toBe(false);
    expect(parsed.values?.workstream).toBe("WS-FIN");
    expect(parsed.values?.programId).toBe("p1");
  });

  it("keeps backward compatibility with the legacy PSE boolean", () => {
    const parsed = parseMovementRow(
      {
        "Employé / Poste": "Alice",
        Type: "Départ forcé",
        PSE: "Oui",
        Statut: "Planifié",
      },
      data,
      2
    );
    expect(parsed.values?.socialScheme).toBe("PSE");
    expect(parsed.values?.inPSE).toBe(true);
  });
});
