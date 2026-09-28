import { describe, expect, it } from "vitest";
import {
  currentFTE,
  currentHeadcount,
  etpRowBreakdown,
  formatFteValue,
  formatHeadcount,
  headcountAtStart,
  realizedExitEmployeeIds,
  scopeEmployees,
  targetFTE,
} from "@/lib/hrEngine";
import type { Employee, Workforce, WorkforceMovement } from "@/types";

function emp(id: string, fte: number, department = "IT", country = "France"): Employee {
  return {
    id,
    name: id,
    region: "EU",
    country,
    department,
    direction: "D",
    hrOwner: "HR",
    func: "F",
    team: department,
    bu: "BU",
    entity: "E",
    level: "Local",
    fte,
    salary: 50000,
    hireDate: "2020-01-01",
    retirement: "",
  };
}

function mv(overrides: Partial<WorkforceMovement>): WorkforceMovement {
  return {
    id: "M",
    empId: null,
    label: "m",
    leverId: "L1",
    type: "Attrition",
    fte: 1,
    department: "IT",
    country: "France",
    hrOwner: "HR",
    plannedDate: "2026-03-01",
    actualDate: null,
    status: "Planifié",
    hrValidated: false,
    inPSE: false,
    salaryImpact: 0,
    savings: 0,
    cost: 0,
    ...overrides,
  };
}

// 5 fiches (4,5 ETP : une personne à mi-temps) ; 1 départ forcé réalisé (lié à E1), 1 attrition
// réalisée non liée à une fiche, 1 recrutement réalisé, 1 recrutement planifié, 1 départ abandonné.
const employees = [emp("E1", 1), emp("E2", 1), emp("E3", 0.5), emp("E4", 1, "HR"), emp("E5", 1)];
const movements = [
  mv({ id: "M1", empId: "E1", type: "Départ forcé", status: "Réalisé" }),
  mv({ id: "M1b", empId: "E1", type: "Attrition", status: "Réalisé" }), // doublon sur E1
  mv({ id: "M2", type: "Attrition", status: "Réalisé", fte: 0.5 }),
  mv({ id: "M3", type: "Recrutement", status: "Réalisé" }),
  mv({ id: "M4", type: "Recrutement", status: "Planifié" }),
  mv({ id: "M5", empId: "E2", type: "Départ forcé", status: "Abandonné" }),
  mv({ id: "M6", empId: "E5", type: "Transfert sortant", status: "Réalisé", toDepartment: "HR" }),
];
const wf: Workforce = {
  totalFTE: 4.5,
  massSalary: 0,
  budgetSalary: 0,
  departments: [],
  employees,
  movements,
};

describe("headcount helpers (audit effectifs #2)", () => {
  it("headcountAtStart: baseline ETP + number of employee records", () => {
    expect(headcountAtStart(wf)).toEqual({ fte: 4.5, persons: 5 });
    expect(headcountAtStart({ totalFTE: 12, employees: [] })).toEqual({ fte: 12, persons: null });
    expect(headcountAtStart({ totalFTE: NaN, employees: [] })).toEqual({ fte: 0, persons: null });
  });

  it("currentHeadcount: ETP = currentFTE, persons = records − realized exits + realized hires", () => {
    const now = currentHeadcount(wf);
    // 4,5 − 1 − 1 (E1 comptée deux fois en ETP, comme currentFTE) − 0,5 + 1 = 2
    expect(now.fte).toBe(Math.round(currentFTE(wf) * 10) / 10);
    // personnes : 5 − 1 (E1, dédoublonnée) − 1 (attrition sans fiche) + 1 (recrutement) = 4
    expect(now.persons).toBe(4);
  });

  it("currentHeadcount: no roster → persons null, ETP still computed", () => {
    const now = currentHeadcount({ ...wf, employees: [] });
    expect(now.persons).toBeNull();
    expect(now.fte).toBe(Math.round(currentFTE(wf) * 10) / 10);
  });

  it("realizedExitEmployeeIds ignores abandoned, planned and transfers", () => {
    expect(Array.from(realizedExitEmployeeIds(movements))).toEqual(["E1"]);
  });

  it("scopeEmployees filters by department/country, null for workstream", () => {
    expect(scopeEmployees(employees, { department: ["HR"] })?.map((e) => e.id)).toEqual(["E4"]);
    expect(scopeEmployees(employees, {})?.length).toBe(5);
    expect(scopeEmployees(employees, { workstream: ["WS1"] })).toBeNull();
  });

  it("etpRowBreakdown splits rows into employee records (incl. departed) and positions to recruit", () => {
    const rows = [
      ...employees.map((e) => ({ employee: e })),
      { employee: null },
      { employee: null },
    ];
    expect(etpRowBreakdown(rows, movements)).toEqual({
      total: 7,
      employees: 5,
      departed: 1,
      recruitments: 2,
    });
  });

  it("targetFTE stays the single target definition", () => {
    // cible = 4,5 − 1 − 1 − 0,5 + 1 + 1 (transferts neutres, abandonné exclu)
    expect(targetFTE(wf)).toBe(4);
  });

  it("formats ETP with the app locale (French decimals) and labels persons explicitly", () => {
    expect(formatFteValue(21.1, "fr")).toBe("21,1");
    expect(formatFteValue(21.14, "en")).toBe("21.1");
    expect(formatFteValue(-0.01, "fr")).toBe("0");
    const t = (_key: string, fallback?: string) => fallback ?? "";
    expect(formatHeadcount({ fte: 109, persons: 113 }, t, "fr")).toBe("109 ETP (113 personnes)");
    expect(formatHeadcount({ fte: 99.7, persons: null }, t, "fr")).toBe("99,7 ETP");
  });
});
