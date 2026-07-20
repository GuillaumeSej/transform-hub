import { describe, it, expect } from "vitest";
import {
  fteEffect,
  currentFTE,
  plannedFTE,
  targetFTE,
  fteBridge,
  movementsByDepartment,
  movementsByCountry,
  movementsByType,
  pseSummary,
  deltaByDepartment,
  realizedSalarySavings,
} from "@/lib/hrEngine";
import type { Workforce, WorkforceMovement } from "@/types";

function makeMovement(overrides: Partial<WorkforceMovement>): WorkforceMovement {
  return {
    id: "M001",
    empId: "E001",
    label: "Test Movement",
    leverId: "L001",
    type: "Suppression",
    fte: 1,
    department: "IT",
    toDepartment: undefined,
    country: "France",
    hrOwner: "HR",
    plannedDate: "2026-03-01",
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

function makeWorkforce(overrides?: Partial<Workforce>): Workforce {
  return {
    totalFTE: 100,
    massSalary: 8,
    budgetSalary: 9,
    departments: [
      { name: "IT", fte: 50, fteTarget: 45 },
      { name: "HR", fte: 30, fteTarget: 32 },
      { name: "Finance", fte: 20, fteTarget: 20 },
    ],
    employees: [],
    movements: [],
    ...overrides,
  };
}

describe("hrEngine — fteEffect", () => {
  it("returns -fte for Suppression", () => {
    const m = makeMovement({ type: "Suppression", fte: 3 });
    expect(fteEffect(m)).toBe(-3);
  });

  it("returns +fte for Recrutement", () => {
    const m = makeMovement({ type: "Recrutement", fte: 2 });
    expect(fteEffect(m)).toBe(2);
  });

  it("returns 0 for Redéploiement", () => {
    const m = makeMovement({ type: "Redéploiement", fte: 5, toDepartment: "HR" });
    expect(fteEffect(m)).toBe(0);
  });

  it("returns 0 for Reconversion", () => {
    const m = makeMovement({ type: "Reconversion", fte: 4, toDepartment: "Finance" });
    expect(fteEffect(m)).toBe(0);
  });
});

describe("hrEngine — currentFTE", () => {
  it("returns baseline when no realized movements", () => {
    const wf = makeWorkforce({ totalFTE: 200 });
    expect(currentFTE(wf)).toBe(200);
  });

  it("adds realized Suppression and Recrutement to baseline", () => {
    const wf = makeWorkforce({
      totalFTE: 200,
      movements: [
        makeMovement({ type: "Suppression", fte: 5, status: "Réalisé" }),
        makeMovement({ id: "M002", type: "Recrutement", fte: 3, status: "Réalisé" }),
        makeMovement({ id: "M003", type: "Redéploiement", fte: 2, status: "Réalisé" }),
        makeMovement({ id: "M004", type: "Suppression", fte: 1, status: "Planifié" }),
      ],
    });
    expect(currentFTE(wf)).toBe(198);
  });
});

describe("hrEngine — plannedFTE", () => {
  it("returns baseline when no movements", () => {
    const wf = makeWorkforce({ totalFTE: 150 });
    expect(plannedFTE(wf)).toBe(150);
  });

  it("applies all movements regardless of status", () => {
    const wf = makeWorkforce({
      totalFTE: 150,
      movements: [
        makeMovement({ type: "Suppression", fte: 10, status: "Planifié" }),
        makeMovement({ id: "M002", type: "Recrutement", fte: 4, status: "En cours" }),
        makeMovement({ id: "M003", type: "Suppression", fte: 2, status: "Réalisé" }),
      ],
    });
    expect(plannedFTE(wf)).toBe(142);
  });
});

describe("hrEngine — targetFTE", () => {
  it("sums department fteTargets", () => {
    const wf = makeWorkforce({
      departments: [
        { name: "IT", fte: 50, fteTarget: 40 },
        { name: "HR", fte: 30, fteTarget: 35 },
      ],
    });
    expect(targetFTE(wf)).toBe(75);
  });

  it("returns 0 for empty departments", () => {
    const wf = makeWorkforce({ departments: [] });
    expect(targetFTE(wf)).toBe(0);
  });
});

describe("hrEngine — fteBridge", () => {
  it("returns 12 buckets for month granularity", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [
        makeMovement({ type: "Suppression", fte: 2, plannedDate: "2026-03-15" }),
      ],
    });
    const buckets = fteBridge(wf, "month");
    expect(buckets).toHaveLength(12);
  });

  it("returns 4 buckets for quarter granularity", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [
        makeMovement({ type: "Suppression", fte: 2, plannedDate: "2026-03-15" }),
      ],
    });
    const buckets = fteBridge(wf, "quarter");
    expect(buckets).toHaveLength(4);
  });

  it("correctly buckets movements and accumulates", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [
        makeMovement({ type: "Suppression", fte: 3, plannedDate: "2026-02-10" }),
        makeMovement({ id: "M002", type: "Recrutement", fte: 1, plannedDate: "2026-05-20" }),
      ],
    });
    const monthly = fteBridge(wf, "month");
    expect(monthly[1].delta).toBe(-3);
    expect(monthly[4].delta).toBe(1);
    expect(monthly[1].cumulative).toBe(97);
    expect(monthly[4].cumulative).toBe(98);
  });

  it("buckets by quarter grouping months correctly", () => {
    const wf = makeWorkforce({
      totalFTE: 200,
      movements: [
        makeMovement({ type: "Suppression", fte: 5, plannedDate: "2026-01-15" }),
        makeMovement({ id: "M002", type: "Suppression", fte: 3, plannedDate: "2026-04-10" }),
        makeMovement({ id: "M003", type: "Recrutement", fte: 2, plannedDate: "2026-08-20" }),
      ],
    });
    const quarterly = fteBridge(wf, "quarter");
    expect(quarterly[0].delta).toBe(-5);
    expect(quarterly[1].delta).toBe(-3);
    expect(quarterly[2].delta).toBe(2);
    expect(quarterly[0].cumulative).toBe(195);
    expect(quarterly[1].cumulative).toBe(192);
    expect(quarterly[2].cumulative).toBe(194);
  });

  it("skips movements with invalid dates", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [
        makeMovement({ type: "Suppression", fte: 5, plannedDate: "" }),
      ],
    });
    const buckets = fteBridge(wf, "month");
    expect(buckets.every((b) => b.delta === 0)).toBe(true);
  });
});

describe("hrEngine — movementsByDepartment", () => {
  it("aggregates suppressions, recrutements, and transferts per department", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ type: "Suppression", fte: 3, department: "IT" }),
        makeMovement({ id: "M002", type: "Recrutement", fte: 2, department: "HR" }),
        makeMovement({
          id: "M003",
          type: "Redéploiement",
          fte: 1,
          department: "IT",
          toDepartment: "Finance",
        }),
      ],
    });
    const result = movementsByDepartment(wf);
    const itRow = result.find((r) => r.department === "IT");
    const hrRow = result.find((r) => r.department === "HR");
    const finRow = result.find((r) => r.department === "Finance");
    expect(itRow?.suppressions).toBe(3);
    expect(itRow?.transferts).toBe(1);
    expect(hrRow?.recrutements).toBe(2);
    expect(finRow?.transferts).toBe(1);
  });

  it("returns sorted by suppressions descending", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ type: "Suppression", fte: 1, department: "HR" }),
        makeMovement({ id: "M002", type: "Suppression", fte: 5, department: "IT" }),
      ],
    });
    const result = movementsByDepartment(wf);
    expect(result[0].department).toBe("IT");
    expect(result[1].department).toBe("HR");
  });
});

describe("hrEngine — movementsByCountry", () => {
  it("aggregates fte and count per country", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ type: "Suppression", fte: 2, country: "France" }),
        makeMovement({ id: "M002", type: "Recrutement", fte: 3, country: "France" }),
        makeMovement({ id: "M003", type: "Suppression", fte: 1, country: "Germany" }),
      ],
    });
    const result = movementsByCountry(wf);
    const fr = result.find((r) => r.country === "France");
    const de = result.find((r) => r.country === "Germany");
    expect(fr?.fte).toBe(5);
    expect(fr?.count).toBe(2);
    expect(de?.fte).toBe(1);
    expect(de?.count).toBe(1);
  });

  it("returns sorted by fte descending", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ type: "Suppression", fte: 1, country: "Germany" }),
        makeMovement({ id: "M002", type: "Suppression", fte: 5, country: "France" }),
      ],
    });
    const result = movementsByCountry(wf);
    expect(result[0].country).toBe("France");
  });
});

describe("hrEngine — movementsByType", () => {
  it("returns type breakdown excluding types with 0 count", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ type: "Suppression", fte: 3 }),
        makeMovement({ id: "M002", type: "Suppression", fte: 2 }),
        makeMovement({ id: "M003", type: "Recrutement", fte: 1 }),
      ],
    });
    const result = movementsByType(wf);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.type === "Suppression")?.count).toBe(2);
    expect(result.find((r) => r.type === "Suppression")?.fte).toBe(5);
    expect(result.find((r) => r.type === "Recrutement")?.count).toBe(1);
  });

  it("returns empty array for no movements", () => {
    const wf = makeWorkforce({ movements: [] });
    expect(movementsByType(wf)).toHaveLength(0);
  });
});

describe("hrEngine — pseSummary", () => {
  it("computes PSE summary from inPSE movements", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ type: "Suppression", fte: 2, inPSE: true, status: "En cours", cost: 50000, hrValidated: false }),
        makeMovement({ id: "M002", type: "Suppression", fte: 3, inPSE: true, status: "Réalisé", cost: 80000, hrValidated: true }),
        makeMovement({ id: "M003", type: "Suppression", fte: 1, inPSE: false, status: "Réalisé", cost: 30000 }),
        makeMovement({ id: "M004", type: "Recrutement", fte: 1, inPSE: true, status: "Planifié", cost: 10000, hrValidated: false }),
      ],
    });
    const result = pseSummary(wf);
    expect(result.postes).toBe(6);
    expect(result.enCours).toBe(1);
    expect(result.realises).toBe(1);
    expect(result.valides).toBe(1);
    expect(result.coutTotal).toBe(140000);
    expect(result.coutEngage).toBe(80000);
  });

  it("returns zeros for no PSE movements", () => {
    const wf = makeWorkforce({ movements: [makeMovement({ inPSE: false })] });
    const result = pseSummary(wf);
    expect(result.postes).toBe(0);
    expect(result.enCours).toBe(0);
    expect(result.realises).toBe(0);
    expect(result.valides).toBe(0);
    expect(result.coutTotal).toBe(0);
    expect(result.coutEngage).toBe(0);
  });
});

describe("hrEngine — deltaByDepartment", () => {
  it("computes landing and gapToTarget for each department", () => {
    const wf = makeWorkforce({
      departments: [
        { name: "IT", fte: 50, fteTarget: 45 },
        { name: "HR", fte: 30, fteTarget: 32 },
      ],
      movements: [
        makeMovement({ type: "Suppression", fte: 3, department: "IT" }),
        makeMovement({ id: "M002", type: "Recrutement", fte: 1, department: "HR" }),
      ],
    });
    const result = deltaByDepartment(wf);
    const it = result.find((r) => r.name === "IT");
    const hr = result.find((r) => r.name === "HR");
    expect(it?.landing).toBe(47);
    expect(it?.gapToTarget).toBe(2);
    expect(hr?.landing).toBe(31);
    expect(hr?.gapToTarget).toBe(-1);
  });

  it("accounts for redeployments between departments", () => {
    const wf = makeWorkforce({
      departments: [
        { name: "IT", fte: 50, fteTarget: 45 },
        { name: "Finance", fte: 20, fteTarget: 20 },
      ],
      movements: [
        makeMovement({
          type: "Redéploiement",
          fte: 2,
          department: "IT",
          toDepartment: "Finance",
        }),
      ],
    });
    const result = deltaByDepartment(wf);
    const it = result.find((r) => r.name === "IT");
    const fin = result.find((r) => r.name === "Finance");
    expect(it?.landing).toBe(48);
    expect(fin?.landing).toBe(22);
  });
});

describe("hrEngine — realizedSalarySavings", () => {
  it("returns 0 when no realized movements", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ salaryImpact: -50000, status: "Planifié" }),
        makeMovement({ id: "M002", salaryImpact: -30000, status: "En cours" }),
      ],
    });
    expect(realizedSalarySavings(wf)).toBe(0);
  });

  it("sums positive savings (negative salaryImpact) from realized movements only", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ salaryImpact: -50000, status: "Réalisé" }),
        makeMovement({ id: "M002", salaryImpact: -30000, status: "Réalisé" }),
        makeMovement({ id: "M003", salaryImpact: 20000, status: "Réalisé" }),
        makeMovement({ id: "M004", salaryImpact: -40000, status: "Planifié" }),
      ],
    });
    expect(realizedSalarySavings(wf)).toBe(80000);
  });

  it("ignores positive salaryImpact (costs)", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ salaryImpact: 100000, status: "Réalisé" }),
      ],
    });
    expect(realizedSalarySavings(wf)).toBe(0);
  });

  it("returns 0 for empty movements", () => {
    const wf = makeWorkforce({ movements: [] });
    expect(realizedSalarySavings(wf)).toBe(0);
  });
});
