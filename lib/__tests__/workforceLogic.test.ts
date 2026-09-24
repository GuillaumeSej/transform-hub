import { describe, expect, it } from "vitest";
import {
  mergeDerivedWorkforceBaseline,
  mergeWorkforceImport,
  movementSocialSchemePatch,
  movementStatusPatch,
  renameEmployee,
} from "@/lib/workforceLogic";
import type { Employee, WorkforceMovement } from "@/types";

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

describe("renameEmployee (édition du matricule)", () => {
  const emp = (id: string, name: string): Employee => ({
    id,
    name,
    region: "",
    country: "France",
    department: "Finance",
    direction: "",
    hrOwner: "",
    func: "",
    team: "",
    bu: "",
    entity: "",
    level: "Local",
    fte: 1,
    salary: 50000,
    hireDate: "",
    retirement: "",
  });
  const employees = [emp("EMP001", "Alice"), emp("EMP002", "Bob")];
  const movements = [movement, { ...movement, id: "MV002", empId: "EMP002" }];

  it("renomme sans doublon et repointe les mouvements", () => {
    const result = renameEmployee(employees, movements, "EMP001", " EMP100 ", "u");
    expect(result.employees.map((e) => e.id)).toEqual(["EMP100", "EMP002"]);
    expect(result.employees[0].name).toBe("Alice");
    expect(result.movements.map((m) => m.empId)).toEqual(["EMP100", "EMP002"]);
    expect(result.movedMovements).toBe(1);
    expect(result.auditEntries[0]).toMatchObject({ old: "EMP001", new: "EMP100" });
  });

  it("refuse un matricule déjà attribué (pas d'écrasement)", () => {
    expect(() => renameEmployee(employees, movements, "EMP001", "EMP002", "u")).toThrow(
      /déjà attribué/
    );
  });

  it("refuse un matricule vide ou un employé introuvable", () => {
    expect(() => renameEmployee(employees, movements, "EMP001", "  ", "u")).toThrow();
    expect(() => renameEmployee(employees, movements, "EMP999", "EMP100", "u")).toThrow(
      /introuvable/
    );
  });
});

describe("mergeWorkforceImport / mergeDerivedWorkforceBaseline", () => {
  it("upsert par id en une opération", () => {
    const result = mergeWorkforceImport(
      [],
      [movement],
      [],
      [
        { ...movement, fte: 2 },
        { ...movement, id: "MV009" },
      ],
      "u"
    );
    expect(result.movements.map((m) => [m.id, m.fte])).toEqual([
      ["MV001", 2],
      ["MV009", 1],
    ]);
    expect(result.auditEntries.map((a) => a.action)).toEqual(["updated", "created"]);
  });

  it("conserve cibles, départements sans employé et baselines workstream", () => {
    const meta = mergeDerivedWorkforceBaseline(
      {
        totalFTE: 10,
        massSalary: 1,
        budgetSalary: 2,
        departments: [
          { name: "Finance", fte: 5, fteTarget: 4 },
          { name: "Ancien", fte: 3, fteTarget: 3 },
        ],
        countryBaselines: [{ key: "FR", label: "France", fte: 10 }],
        workstreamBaselines: [{ key: "WS1", label: "WS1", fte: 10 }],
      },
      {
        totalFTE: 7,
        massSalary: 0.5,
        departments: [
          { name: "Finance", fte: 6, fteTarget: 6 },
          { name: "IT", fte: 1, fteTarget: 1 },
        ],
        countryBaselines: [{ key: "FR", label: "FR", fte: 7 }],
      }
    );
    expect(meta.totalFTE).toBe(7);
    expect(meta.budgetSalary).toBe(2);
    expect(meta.departments).toEqual([
      { name: "Finance", fte: 6, fteTarget: 4 },
      { name: "IT", fte: 1, fteTarget: 1 },
      { name: "Ancien", fte: 0, fteTarget: 3 },
    ]);
    expect(meta.countryBaselines).toEqual([{ key: "FR", label: "France", fte: 7 }]);
    expect(meta.workstreamBaselines).toEqual([{ key: "WS1", label: "WS1", fte: 10 }]);
  });
});
