import { describe, expect, it } from "vitest";
import {
  MOVEMENT_TYPES,
  bucketByLever,
  currentFTE,
  deltaByDepartment,
  fteBridge,
  fteBridgeSummary,
  fteEffect,
  ftePositionsByDimension,
  movementBreakdownByDimension,
  movementRealizationByDimension,
  movementsByCountry,
  movementsByDepartment,
  movementsByType,
  plannedFTE,
  pseSummary,
  realizedSalarySavings,
  targetFTE,
} from "@/lib/hrEngine";
import type { Lever, Workforce, WorkforceMovement } from "@/types";

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

describe("hrEngine — MOVEMENT_TYPES", () => {
  it("exposes the 5 Gooduelle categories in the expected order", () => {
    expect(MOVEMENT_TYPES).toEqual([
      "Recrutement",
      "Attrition",
      "Départ forcé",
      "Transfert entrant",
      "Transfert sortant",
    ]);
  });
});

describe("hrEngine — fteEffect (5-types)", () => {
  it("Recrutement contributes +fte", () => {
    expect(fteEffect(makeMovement({ type: "Recrutement", fte: 2 }))).toBe(2);
  });

  it("Attrition and Départ forcé contribute −fte", () => {
    expect(fteEffect(makeMovement({ type: "Attrition", fte: 2 }))).toBe(-2);
    expect(fteEffect(makeMovement({ type: "Départ forcé", fte: 3 }))).toBe(-3);
  });

  it("Transfert entrant/sortant contribute 0 (internal mobility)", () => {
    expect(fteEffect(makeMovement({ type: "Transfert entrant", fte: 5, toDepartment: "HR" }))).toBe(
      0
    );
    expect(fteEffect(makeMovement({ type: "Transfert sortant", fte: 4 }))).toBe(0);
  });
});

describe("hrEngine — fteEffect defensive fallback (legacy Firestore data)", () => {
  it("returns 0 for an unknown movement type (Aug 2026 migration filet)", () => {
    // Reproduit un mouvement Firestore antérieur à la migration 5-types Gooduelle.
    const legacy = makeMovement({
      type: "Suppression" as unknown as WorkforceMovement["type"],
      fte: 3,
    });
    expect(fteEffect(legacy)).toBe(0);
  });

  it("does not propagate NaN through currentFTE when a legacy type is present", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [
        makeMovement({
          type: "Suppression" as unknown as WorkforceMovement["type"],
          fte: 5,
          status: "Réalisé",
        }),
        makeMovement({ id: "M2", type: "Recrutement", fte: 3, status: "Réalisé" }),
      ],
    });
    // "Suppression" (legacy inconnu) → 0. "Recrutement" (connu) → +3.
    expect(currentFTE(wf)).toBe(103);
    expect(Number.isFinite(currentFTE(wf))).toBe(true);
  });

  it("does not propagate NaN through fteBridge either", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [
        makeMovement({
          type: "Suppression" as unknown as WorkforceMovement["type"],
          fte: 5,
          plannedDate: "2026-03-01",
        }),
      ],
    });
    const buckets = fteBridge(wf, "month");
    // Tous les deltas et cumulatifs doivent rester finis.
    buckets.forEach((b) => {
      expect(Number.isFinite(b.delta)).toBe(true);
      expect(Number.isFinite(b.cumulative)).toBe(true);
    });
  });
});

describe("hrEngine — currentFTE", () => {
  it("returns baseline when no realized movements", () => {
    expect(currentFTE(makeWorkforce({ totalFTE: 200 }))).toBe(200);
  });

  it("adds realized recrutements and subtracts realized departures", () => {
    const wf = makeWorkforce({
      totalFTE: 200,
      movements: [
        makeMovement({ type: "Départ forcé", fte: 5, status: "Réalisé" }),
        makeMovement({ id: "M2", type: "Recrutement", fte: 3, status: "Réalisé" }),
        makeMovement({ id: "M3", type: "Transfert entrant", fte: 2, status: "Réalisé" }),
        makeMovement({ id: "M4", type: "Départ forcé", fte: 1, status: "Planifié" }),
      ],
    });
    // Baseline 200, − 5 (Départ forcé réalisé) + 3 (Recrutement réalisé) + 0 (transfert) = 198
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
        makeMovement({ id: "M2", type: "Recrutement", fte: 4, status: "En cours" }),
        makeMovement({ id: "M3", type: "Attrition", fte: 2, status: "Réalisé" }),
      ],
    });
    expect(plannedFTE(wf)).toBe(150 - 10 + 4 - 2);
  });
});

describe("hrEngine — targetFTE", () => {
  it("sums department fteTargets", () => {
    expect(targetFTE(makeWorkforce())).toBe(45 + 32 + 20);
  });
});

describe("hrEngine — fteBridge", () => {
  it("returns 12 monthly buckets across the year (labels include the year)", () => {
    const wf = makeWorkforce({
      movements: [makeMovement({ plannedDate: "2026-03-15" })],
    });
    const buckets = fteBridge(wf, "month");
    expect(buckets).toHaveLength(12);
    expect(buckets[2].label).toBe("Mar 2026");
  });

  it("returns 4 quarterly buckets across the year", () => {
    const wf = makeWorkforce({
      movements: [makeMovement({ plannedDate: "2026-03-15" })],
    });
    expect(fteBridge(wf, "quarter")).toHaveLength(4);
  });

  it("byType decomposes deltas by movement type", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [
        makeMovement({ id: "M1", type: "Départ forcé", fte: 3, plannedDate: "2026-02-10" }),
        makeMovement({ id: "M2", type: "Recrutement", fte: 1, plannedDate: "2026-02-20" }),
        makeMovement({ id: "M3", type: "Attrition", fte: 1, plannedDate: "2026-02-25" }),
      ],
    });
    const buckets = fteBridge(wf, "month");
    const feb = buckets.find((b) => b.label === "Fév 2026");
    expect(feb?.delta).toBe(-3 + 1 - 1);
    expect(feb?.byType["Départ forcé"]).toBe(-3);
    expect(feb?.byType["Recrutement"]).toBe(1);
    expect(feb?.byType["Attrition"]).toBe(-1);
    expect(feb?.byType["Transfert entrant"]).toBe(0);
  });

  it("dateRange filters buckets to the requested window", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ id: "M1", plannedDate: "2026-02-10" }),
        makeMovement({ id: "M2", plannedDate: "2027-08-01" }),
      ],
    });
    const buckets = fteBridge(wf, "year", { from: "2027-01-01", to: "2027-12-31" });
    expect(buckets).toHaveLength(1);
    expect(buckets[0].label).toBe("2027");
  });

  it("cumulative reflects the running FTE after each bucket", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [
        makeMovement({ id: "M1", type: "Départ forcé", fte: 3, plannedDate: "2026-02-10" }),
        makeMovement({ id: "M2", type: "Recrutement", fte: 1, plannedDate: "2026-05-15" }),
      ],
    });
    const buckets = fteBridge(wf, "month");
    expect(buckets[1].cumulative).toBe(97);
    expect(buckets[4].cumulative).toBe(98);
    expect(buckets[11].cumulative).toBe(98);
  });

  it("skips movements with invalid dates", () => {
    const wf = makeWorkforce({
      movements: [makeMovement({ plannedDate: "" })],
    });
    const buckets = fteBridge(wf, "month");
    expect(buckets.every((b) => b.movements.length === 0)).toBe(true);
  });
});

describe("hrEngine — fteBridgeSummary (pont ETP)", () => {
  it("computes opening, contributions by type, and closing", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [
        makeMovement({ id: "M1", type: "Départ forcé", fte: 3, plannedDate: "2026-02-10" }),
        makeMovement({ id: "M2", type: "Recrutement", fte: 2, plannedDate: "2026-03-05" }),
        makeMovement({ id: "M3", type: "Attrition", fte: 1, plannedDate: "2026-04-01" }),
      ],
    });
    const summary = fteBridgeSummary(wf);
    expect(summary.opening).toBe(100);
    expect(summary.closing).toBe(100 - 3 + 2 - 1);
    const contribByType = Object.fromEntries(summary.contributions.map((c) => [c.type, c.delta]));
    expect(contribByType["Départ forcé"]).toBe(-3);
    expect(contribByType["Recrutement"]).toBe(2);
    expect(contribByType["Attrition"]).toBe(-1);
  });
});

describe("hrEngine — bucketByLever", () => {
  it("groups a bucket's movements by lever", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ id: "M1", leverId: "L001", plannedDate: "2026-02-10" }),
        makeMovement({ id: "M2", leverId: "L001", plannedDate: "2026-02-15" }),
        makeMovement({ id: "M3", leverId: "L002", plannedDate: "2026-02-20" }),
      ],
    });
    const buckets = fteBridge(wf, "month");
    const feb = buckets.find((b) => b.label === "Fév 2026")!;
    const levers: Lever[] = [];
    const grouped = bucketByLever(feb, levers);
    expect(grouped).toHaveLength(2);
    expect(grouped.find((g) => g.leverId === "L001")?.movements).toHaveLength(2);
  });
});

describe("hrEngine — movementsByDepartment (5-types)", () => {
  it("aggregates the 5 categories per department", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ id: "M1", type: "Départ forcé", fte: 2, department: "IT" }),
        makeMovement({ id: "M2", type: "Attrition", fte: 1, department: "IT" }),
        makeMovement({ id: "M3", type: "Recrutement", fte: 3, department: "HR" }),
        makeMovement({
          id: "M4",
          type: "Transfert entrant",
          fte: 2,
          department: "IT",
          toDepartment: "HR",
        }),
      ],
    });
    const rows = movementsByDepartment(wf);
    const it = rows.find((r) => r.department === "IT")!;
    expect(it.forcedDepartures).toBe(2);
    expect(it.attritions).toBe(1);
    expect(it.exits).toBe(3);
    expect(it.transfertSortants).toBe(2);
    const hr = rows.find((r) => r.department === "HR")!;
    expect(hr.recrutements).toBe(3);
    expect(hr.transfertEntrants).toBe(2);
  });
});

describe("hrEngine — ftePositionsByDimension", () => {
  it("computes current, target and landing by country", () => {
    const wf = makeWorkforce({
      countryBaselines: [
        { key: "France", label: "France", fte: 60 },
        { key: "Germany", label: "Germany", fte: 40 },
      ],
      movements: [
        makeMovement({
          id: "M1",
          type: "Départ forcé",
          country: "France",
          fte: 3,
          status: "Réalisé",
          lockedPlan: { fte: 3, salaryImpact: -1, savings: 1, cost: 0 },
        }),
        makeMovement({
          id: "M2",
          type: "Recrutement",
          country: "Germany",
          fte: 2,
          status: "Planifié",
          lockedPlan: { fte: 2, salaryImpact: 1, savings: 0, cost: 0 },
          reforecast: { fte: 1.5, salaryImpact: 1, savings: 0, cost: 0 },
        }),
      ],
    });
    const rows = ftePositionsByDimension(wf, "country");
    expect(rows.find((row) => row.key === "France")).toMatchObject({
      current: 57,
      target: 57,
      landing: 57,
    });
    expect(rows.find((row) => row.key === "Germany")).toMatchObject({
      current: 40,
      target: 42,
      landing: 41.5,
    });
  });

  it("moves FTE from source to destination for department transfers", () => {
    const wf = makeWorkforce({
      departments: [
        { name: "IT", fte: 50, fteTarget: 45 },
        { name: "HR", fte: 30, fteTarget: 35 },
      ],
      movements: [
        makeMovement({
          type: "Transfert entrant",
          department: "IT",
          toDepartment: "HR",
          fte: 4,
          status: "Réalisé",
        }),
      ],
    });
    const rows = ftePositionsByDimension(wf, "department");
    expect(rows.find((row) => row.key === "IT")?.current).toBe(46);
    expect(rows.find((row) => row.key === "HR")?.current).toBe(34);
  });
});

describe("hrEngine — movementBreakdownByDimension", () => {
  it("groups the five movement types by country", () => {
    const rows = movementBreakdownByDimension(
      [
        makeMovement({ id: "M1", type: "Recrutement", country: "France", fte: 2 }),
        makeMovement({ id: "M2", type: "Attrition", country: "France", fte: 1 }),
      ],
      "country"
    );
    expect(rows[0]).toMatchObject({ label: "France", recrutements: 2, attritions: 1, net: 1 });
  });
});

describe("hrEngine — movementRealizationByDimension", () => {
  it("computes realized, remaining and target ETP by function and type", () => {
    const rows = movementRealizationByDimension(
      [
        makeMovement({
          id: "M1",
          type: "Départ forcé",
          function: "Finance",
          fte: 2,
          status: "Réalisé",
          lockedPlan: { fte: 2, salaryImpact: -1, savings: 1, cost: 0 },
        }),
        makeMovement({
          id: "M2",
          type: "Départ forcé",
          function: "Finance",
          fte: 3,
          status: "Planifié",
          lockedPlan: { fte: 3, salaryImpact: -1, savings: 1, cost: 0 },
          reforecast: { fte: 2.5, salaryImpact: -1, savings: 1, cost: 0 },
        }),
        makeMovement({ id: "M3", type: "Recrutement", function: "Finance", fte: 4 }),
      ],
      "function",
      "Départ forcé"
    );
    expect(rows[0]).toMatchObject({ label: "Finance", realized: 2, remaining: 3, target: 5 });
  });
});

describe("hrEngine — movementsByCountry", () => {
  it("aggregates FTE and count per country, sorted by FTE desc", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ country: "France", fte: 3 }),
        makeMovement({ id: "M2", country: "Germany", fte: 1 }),
        makeMovement({ id: "M3", country: "France", fte: 2 }),
      ],
    });
    const rows = movementsByCountry(wf);
    expect(rows[0]).toEqual({ country: "France", fte: 5, count: 2 });
    expect(rows[1]).toEqual({ country: "Germany", fte: 1, count: 1 });
  });
});

describe("hrEngine — movementsByType", () => {
  it("returns 5-type breakdown of counts and FTE", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ id: "M1", type: "Départ forcé", fte: 2 }),
        makeMovement({ id: "M2", type: "Départ forcé", fte: 3 }),
        makeMovement({ id: "M3", type: "Recrutement", fte: 1 }),
      ],
    });
    const rows = movementsByType(wf);
    expect(rows.find((r) => r.type === "Départ forcé")?.count).toBe(2);
    expect(rows.find((r) => r.type === "Départ forcé")?.fte).toBe(5);
    expect(rows.find((r) => r.type === "Recrutement")?.count).toBe(1);
  });

  it("hides categories with no movement", () => {
    const wf = makeWorkforce({
      movements: [makeMovement({ type: "Recrutement", fte: 1 })],
    });
    const rows = movementsByType(wf);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("Recrutement");
  });
});

describe("hrEngine — deltaByDepartment", () => {
  it("computes landing = current fte + net contributions per department", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ id: "M1", type: "Départ forcé", fte: 3, department: "IT" }),
        makeMovement({ id: "M2", type: "Attrition", fte: 1, department: "IT" }),
        makeMovement({ id: "M3", type: "Recrutement", fte: 2, department: "HR" }),
        makeMovement({
          id: "M4",
          type: "Transfert entrant",
          fte: 5,
          department: "IT",
          toDepartment: "HR",
        }),
      ],
    });
    const rows = deltaByDepartment(wf);
    const it = rows.find((r) => r.name === "IT")!;
    // IT baseline 50, − 3 (départ forcé), − 1 (attrition), − 5 (transfert sortant) = 41
    expect(it.landing).toBe(41);
    const hr = rows.find((r) => r.name === "HR")!;
    // HR baseline 30, + 2 (recrutement), + 5 (transfert entrant) = 37
    expect(hr.landing).toBe(37);
  });
});

describe("hrEngine — pseSummary", () => {
  it("counts PSE-scoped movements and aggregates the cost", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ id: "M1", inPSE: true, status: "Réalisé", cost: 45000 }),
        makeMovement({ id: "M2", inPSE: true, status: "Planifié", cost: 40000 }),
        makeMovement({ id: "M3", inPSE: false, status: "Réalisé", cost: 20000 }),
      ],
    });
    const summary = pseSummary(wf);
    expect(summary.postes).toBe(2);
    expect(summary.coutTotal).toBe(85000);
    expect(summary.coutEngage).toBe(45000);
  });
});

describe("hrEngine — realizedSalarySavings", () => {
  it("sums positive savings from realized movements only", () => {
    const wf = makeWorkforce({
      movements: [
        makeMovement({ salaryImpact: -50000, status: "Réalisé" }),
        makeMovement({ id: "M2", salaryImpact: -30000, status: "Réalisé" }),
        makeMovement({ id: "M3", salaryImpact: 20000, status: "Réalisé" }),
        makeMovement({ id: "M4", salaryImpact: -40000, status: "Planifié" }),
      ],
    });
    expect(realizedSalarySavings(wf)).toBe(80000);
  });
});
