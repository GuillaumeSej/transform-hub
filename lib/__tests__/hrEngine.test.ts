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
  fiscalYearBucket,
  fiscalYearRange,
  movementRhythm,
  resolveMovementRegion,
} from "@/lib/hrEngine";
import type {
  Employee,
  HierarchyLevelDef,
  HierarchyNode,
  Workforce,
  WorkforceMovement,
} from "@/types";

function makeMovement(overrides: Partial<WorkforceMovement>): WorkforceMovement {
  return {
    id: "M001",
    empId: "E001",
    label: "Test Movement",
    leverId: "L001",
    type: "Départ forcé",
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

describe("hrEngine — fteEffect (5-types Gooduelle)", () => {
  it("returns -fte for Départ forcé", () => {
    expect(fteEffect(makeMovement({ type: "Départ forcé", fte: 3 }))).toBe(-3);
  });

  it("returns -fte for Attrition", () => {
    expect(fteEffect(makeMovement({ type: "Attrition", fte: 2 }))).toBe(-2);
  });

  it("returns +fte for Recrutement", () => {
    expect(fteEffect(makeMovement({ type: "Recrutement", fte: 2 }))).toBe(2);
  });

  it("returns 0 for Transfert entrant (internal mobility)", () => {
    expect(fteEffect(makeMovement({ type: "Transfert entrant", fte: 5, toDepartment: "HR" }))).toBe(
      0
    );
  });

  it("returns 0 for Transfert sortant", () => {
    expect(
      fteEffect(makeMovement({ type: "Transfert sortant", fte: 4, toDepartment: "Finance" }))
    ).toBe(0);
  });
});

describe("hrEngine — currentFTE", () => {
  it("returns baseline when no realized movements", () => {
    const wf = makeWorkforce({ totalFTE: 200 });
    expect(currentFTE(wf)).toBe(200);
  });

  it("adds realized departures and hires to baseline, ignoring transfers and planned", () => {
    const wf = makeWorkforce({
      totalFTE: 200,
      movements: [
        makeMovement({ type: "Départ forcé", fte: 5, status: "Réalisé" }),
        makeMovement({ id: "M002", type: "Recrutement", fte: 3, status: "Réalisé" }),
        makeMovement({ id: "M003", type: "Transfert entrant", fte: 2, status: "Réalisé" }),
        makeMovement({ id: "M004", type: "Départ forcé", fte: 1, status: "Planifié" }),
      ],
    });
    expect(currentFTE(wf)).toBe(198);
  });
});

describe("hrEngine — plannedFTE", () => {
  it("returns baseline when no movements", () => {
    expect(plannedFTE(makeWorkforce({ totalFTE: 150 }))).toBe(150);
  });

  it("applies all movements regardless of status", () => {
    const wf = makeWorkforce({
      totalFTE: 150,
      movements: [
        makeMovement({ type: "Départ forcé", fte: 10, status: "Planifié" }),
        makeMovement({ id: "M002", type: "Recrutement", fte: 4, status: "En cours" }),
        makeMovement({ id: "M003", type: "Attrition", fte: 2, status: "Réalisé" }),
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
    expect(targetFTE(makeWorkforce({ departments: [] }))).toBe(0);
  });
});

describe("hrEngine — fteBridge", () => {
  it("returns 12 buckets for month granularity", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [makeMovement({ type: "Départ forcé", fte: 2, plannedDate: "2026-03-15" })],
    });
    expect(fteBridge(wf, "month")).toHaveLength(12);
  });

  it("returns 4 buckets for quarter granularity", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [makeMovement({ type: "Départ forcé", fte: 2, plannedDate: "2026-03-15" })],
    });
    expect(fteBridge(wf, "quarter")).toHaveLength(4);
  });

  it("correctly buckets movements and accumulates", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [
        makeMovement({ type: "Départ forcé", fte: 3, plannedDate: "2026-02-10" }),
        makeMovement({ id: "M002", type: "Recrutement", fte: 1, plannedDate: "2026-05-20" }),
      ],
    });
    const monthly = fteBridge(wf, "month");
    expect(monthly[1].delta).toBe(-3);
    expect(monthly[4].delta).toBe(1);
    expect(monthly[1].cumulative).toBe(97);
    expect(monthly[4].cumulative).toBe(98);
  });

  it("byType decomposition matches Gooduelle 5 categories", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [
        makeMovement({ type: "Départ forcé", fte: 2, plannedDate: "2026-02-10" }),
        makeMovement({ id: "M002", type: "Attrition", fte: 1, plannedDate: "2026-02-15" }),
        makeMovement({ id: "M003", type: "Recrutement", fte: 3, plannedDate: "2026-02-20" }),
        makeMovement({
          id: "M004",
          type: "Transfert entrant",
          fte: 5,
          plannedDate: "2026-02-25",
          toDepartment: "HR",
        }),
      ],
    });
    const monthly = fteBridge(wf, "month");
    expect(monthly[1].byType["Départ forcé"]).toBe(-2);
    expect(monthly[1].byType["Attrition"]).toBe(-1);
    expect(monthly[1].byType["Recrutement"]).toBe(3);
    expect(monthly[1].byType["Transfert entrant"]).toBe(0); // signed by fteEffect = 0
    expect(monthly[1].byType["Transfert sortant"]).toBe(0);
    expect(monthly[1].delta).toBe(0);
  });

  it("year granularity uses fiscal year buckets when fyStart provided", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [
        makeMovement({ type: "Départ forcé", fte: 2, plannedDate: "2026-06-01" }),
        makeMovement({ id: "M002", type: "Départ forcé", fte: 3, plannedDate: "2026-08-01" }),
      ],
    });
    // fyStart 1er juillet : le premier mouvement (juin) est en FY25/26, le second (août) en FY26/27
    const yearly = fteBridge(wf, "year", "2026-07-01");
    expect(yearly.map((b) => b.label)).toContain("FY25/26");
    expect(yearly.map((b) => b.label)).toContain("FY26/27");
    const fy25 = yearly.find((b) => b.label === "FY25/26");
    const fy26 = yearly.find((b) => b.label === "FY26/27");
    expect(fy25?.delta).toBe(-2);
    expect(fy26?.delta).toBe(-3);
  });

  it("year granularity falls back to calendar year when fyStart missing", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [
        makeMovement({ type: "Départ forcé", fte: 2, plannedDate: "2026-06-01" }),
        makeMovement({ id: "M002", type: "Départ forcé", fte: 3, plannedDate: "2027-02-01" }),
      ],
    });
    const yearly = fteBridge(wf, "year");
    expect(yearly.map((b) => b.label)).toEqual(["2026", "2027"]);
    expect(yearly[0].delta).toBe(-2);
    expect(yearly[1].delta).toBe(-3);
  });

  it("skips movements with invalid dates", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [makeMovement({ type: "Départ forcé", fte: 5, plannedDate: "" })],
    });
    expect(fteBridge(wf, "month").every((b) => b.delta === 0)).toBe(true);
  });
});

describe("hrEngine — fiscalYearBucket", () => {
  it("returns FYyear when fyStart is January 1st (calendar year)", () => {
    expect(fiscalYearBucket("2026-06-15", "2026-01-01")).toBe("FY2026");
    expect(fiscalYearBucket("2027-02-01", "2026-01-01")).toBe("FY2027");
  });

  it("returns FYnn/nn+1 when fyStart is mid-year", () => {
    expect(fiscalYearBucket("2026-07-01", "2026-07-01")).toBe("FY26/27");
    expect(fiscalYearBucket("2026-06-30", "2026-07-01")).toBe("FY25/26");
    expect(fiscalYearBucket("2027-06-30", "2026-07-01")).toBe("FY26/27");
    expect(fiscalYearBucket("2027-07-01", "2026-07-01")).toBe("FY27/28");
  });

  it("returns null on invalid inputs", () => {
    expect(fiscalYearBucket(null, "2026-07-01")).toBeNull();
    expect(fiscalYearBucket("2026-06-01", null)).toBeNull();
    expect(fiscalYearBucket("bad-date", "2026-07-01")).toBeNull();
  });
});

describe("hrEngine — fiscalYearRange", () => {
  it("generates all fiscal years between two dates", () => {
    const range = fiscalYearRange("2026-07-01", "2026-01-01", "2028-12-31");
    const labels = range.map((r) => r.label);
    expect(labels).toEqual(["FY25/26", "FY26/27", "FY27/28", "FY28/29"]);
  });

  it("returns empty array when fyStart missing", () => {
    expect(fiscalYearRange(null, "2026-01-01", "2027-01-01")).toEqual([]);
  });
});

describe("hrEngine — movementRhythm", () => {
  it("produces monthly buckets with byType breakdown and running cumulative", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [
        makeMovement({ type: "Départ forcé", fte: 2, plannedDate: "2026-02-15" }),
        makeMovement({ id: "M002", type: "Recrutement", fte: 3, plannedDate: "2026-03-10" }),
      ],
    });
    const rhythm = movementRhythm(wf, "month");
    expect(rhythm).toHaveLength(12);
    expect(rhythm[1].net).toBe(-2);
    expect(rhythm[2].net).toBe(3);
    expect(rhythm[1].cumulativeNet).toBe(-2);
    expect(rhythm[2].cumulativeNet).toBe(1);
    expect(rhythm[1].byType["Départ forcé"]).toBe(-2);
    expect(rhythm[2].byType["Recrutement"]).toBe(3);
  });
});

describe("hrEngine — resolveMovementRegion", () => {
  const employees: Employee[] = [
    {
      id: "E100",
      name: "Alice",
      region: "EMEA",
      country: "France",
      department: "IT",
      direction: "Dir IT",
      hrOwner: "HR",
      func: "Engineer",
      team: "A",
      bu: "BU1",
      entity: "E1",
      level: "Global",
      fte: 1,
      salary: 60000,
      hireDate: "2020-01-01",
      retirement: "",
    },
  ];

  const geographyLevels: HierarchyLevelDef[] = [
    { key: "region", label: "Région", order: 0, semantic: "region" },
    { key: "country", label: "Pays", order: 1, semantic: "country" },
  ];

  const geographyNodes: HierarchyNode[] = [
    {
      id: "N-REG-APAC",
      companyId: "c1",
      levelKey: "region",
      code: "APAC",
      label: "APAC",
      parentId: null,
      domain: "geographic",
    },
    {
      id: "N-CTR-JP",
      companyId: "c1",
      levelKey: "country",
      code: "Japan",
      label: "Japan",
      parentId: "N-REG-APAC",
      domain: "geographic",
    },
  ];

  it("returns employee region when empId points to a known employee", () => {
    const m = makeMovement({ empId: "E100", country: "Japan" });
    expect(resolveMovementRegion(m, { employees, geographyNodes: [], geographyLevels: [] })).toBe(
      "EMEA"
    );
  });

  it("resolves region via country hierarchy when no empId (recrutement)", () => {
    const m = makeMovement({ empId: null, country: "Japan" });
    const result = resolveMovementRegion(m, { employees: [], geographyNodes, geographyLevels });
    expect(result).toBe("APAC");
  });

  it("falls back to raw country when no hierarchy configured", () => {
    const m = makeMovement({ empId: null, country: "France" });
    expect(
      resolveMovementRegion(m, { employees: [], geographyNodes: [], geographyLevels: [] })
    ).toBe("France");
  });

  it("falls back to raw country when country not found in hierarchy", () => {
    const m = makeMovement({ empId: null, country: "Zimbabwe" });
    expect(resolveMovementRegion(m, { employees: [], geographyNodes, geographyLevels })).toBe(
      "Zimbabwe"
    );
  });
});

describe("hrEngine — movementsByDepartment", () => {
  it("aggregates exits (attrition + departs forcés), recrutements, transferts per department", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ type: "Départ forcé", fte: 3, department: "IT" }),
        makeMovement({ id: "M002", type: "Attrition", fte: 1, department: "IT" }),
        makeMovement({ id: "M003", type: "Recrutement", fte: 2, department: "HR" }),
        makeMovement({
          id: "M004",
          type: "Transfert entrant",
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
    expect(itRow?.exits).toBe(4);
    expect(itRow?.transferts).toBe(1);
    expect(hrRow?.recrutements).toBe(2);
    expect(finRow?.transferts).toBe(1);
  });

  it("returns sorted by exits descending", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ type: "Départ forcé", fte: 1, department: "HR" }),
        makeMovement({ id: "M002", type: "Départ forcé", fte: 5, department: "IT" }),
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
        makeMovement({ type: "Départ forcé", fte: 2, country: "France" }),
        makeMovement({ id: "M002", type: "Recrutement", fte: 3, country: "France" }),
        makeMovement({ id: "M003", type: "Départ forcé", fte: 1, country: "Germany" }),
      ],
    });
    const result = movementsByCountry(wf);
    expect(result.find((r) => r.country === "France")?.fte).toBe(5);
    expect(result.find((r) => r.country === "France")?.count).toBe(2);
    expect(result.find((r) => r.country === "Germany")?.fte).toBe(1);
  });
});

describe("hrEngine — movementsByType (5-types Gooduelle)", () => {
  it("returns type breakdown for the 5 Gooduelle categories", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ type: "Départ forcé", fte: 3 }),
        makeMovement({ id: "M002", type: "Attrition", fte: 2 }),
        makeMovement({ id: "M003", type: "Recrutement", fte: 1 }),
        makeMovement({ id: "M004", type: "Transfert entrant", fte: 4 }),
        makeMovement({ id: "M005", type: "Transfert sortant", fte: 2 }),
      ],
    });
    const result = movementsByType(wf);
    expect(result).toHaveLength(5);
    expect(result.find((r) => r.type === "Départ forcé")?.fte).toBe(3);
    expect(result.find((r) => r.type === "Attrition")?.fte).toBe(2);
    expect(result.find((r) => r.type === "Transfert sortant")?.fte).toBe(2);
  });

  it("returns empty array for no movements", () => {
    expect(movementsByType(makeWorkforce({ movements: [] }))).toHaveLength(0);
  });
});

describe("hrEngine — pseSummary", () => {
  it("computes PSE summary from inPSE movements", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({
          type: "Départ forcé",
          fte: 2,
          inPSE: true,
          status: "En cours",
          cost: 50000,
          hrValidated: false,
        }),
        makeMovement({
          id: "M002",
          type: "Départ forcé",
          fte: 3,
          inPSE: true,
          status: "Réalisé",
          cost: 80000,
          hrValidated: true,
        }),
        makeMovement({
          id: "M003",
          type: "Départ forcé",
          fte: 1,
          inPSE: false,
          status: "Réalisé",
          cost: 30000,
        }),
      ],
    });
    const result = pseSummary(wf);
    expect(result.postes).toBe(5);
    expect(result.enCours).toBe(1);
    expect(result.realises).toBe(1);
    expect(result.valides).toBe(1);
    expect(result.coutTotal).toBe(130000);
    expect(result.coutEngage).toBe(80000);
  });
});

describe("hrEngine — deltaByDepartment", () => {
  it("computes landing and gapToTarget for each department (5-types)", () => {
    const wf = makeWorkforce({
      departments: [
        { name: "IT", fte: 50, fteTarget: 45 },
        { name: "HR", fte: 30, fteTarget: 32 },
      ],
      movements: [
        makeMovement({ type: "Départ forcé", fte: 3, department: "IT" }),
        makeMovement({ id: "M002", type: "Attrition", fte: 1, department: "IT" }),
        makeMovement({ id: "M003", type: "Recrutement", fte: 1, department: "HR" }),
      ],
    });
    const result = deltaByDepartment(wf);
    expect(result.find((r) => r.name === "IT")?.landing).toBe(46);
    expect(result.find((r) => r.name === "HR")?.landing).toBe(31);
  });

  it("accounts for Transfert entrant between departments", () => {
    const wf = makeWorkforce({
      departments: [
        { name: "IT", fte: 50, fteTarget: 45 },
        { name: "Finance", fte: 20, fteTarget: 20 },
      ],
      movements: [
        makeMovement({
          type: "Transfert entrant",
          fte: 2,
          department: "IT",
          toDepartment: "Finance",
        }),
      ],
    });
    const result = deltaByDepartment(wf);
    expect(result.find((r) => r.name === "IT")?.landing).toBe(48);
    expect(result.find((r) => r.name === "Finance")?.landing).toBe(22);
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

  it("sums positive savings from realized movements only", () => {
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
});
