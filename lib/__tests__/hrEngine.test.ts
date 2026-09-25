import { describe, expect, it } from "vitest";
import {
  MOVEMENT_TYPES,
  ALERT_KIND_SEVERITY,
  alertPrimaryBreakdown,
  alertedMovementIds,
  primaryAlertKindByMovement,
  bucketByLever,
  currentFTE,
  deltaByDepartment,
  deriveWorkforceBaseline,
  fteBridge,
  fteBridgeSummary,
  fteEffect,
  fteOpening,
  ftePositionsByDimension,
  hrToday,
  knownDepartments,
  movementAlerts,
  movementBreakdownByDimension,
  movementRealizationByDimension,
  movementsByCountry,
  movementsByDepartment,
  movementsByType,
  plannedFTE,
  pseSummary,
  realizedSalarySavings,
  salaryBridge,
  scopeWorkforceBaseline,
  targetFTE,
  transferDepartmentLegs,
  withDerivedWorkforceBaseline,
} from "@/lib/hrEngine";
import type { MovementAlert } from "@/lib/hrEngine";
import { loadedAnnualSalary } from "@/lib/hrFinancials";
import type { Employee, Lever, Workforce, WorkforceMovement } from "@/types";

function makeLever(overrides: Partial<Lever>): Lever {
  return {
    id: "L001",
    code: "L001",
    programId: "p1",
    type: "Sourcing",
    name: "Test Lever",
    ws: "WS-01",
    owner: "Test Owner",
    ownerInit: "TO",
    sponsor: "Test Sponsor",
    sponsorInit: "TS",
    geography: "Europe",
    country: "France",
    entity: "Entity A",
    function: "Procurement",
    costCenter: "CC01",
    pnlMap: "COGS",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "in_progress",
    progress: 50,
    risk: "low",
    grossSavings: 1,
    netSavings: 1,
    opexOneOff: 0,
    opexRec: 0,
    capex: 0,
    fteImpact: -4,
    popImpacted: "",
    dependencies: [],
    description: "",
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
    ...overrides,
  };
}

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
        makeMovement({ id: "M2", type: "Recrutement", fte: 4, status: "À faire" }),
        makeMovement({ id: "M3", type: "Attrition", fte: 2, status: "Réalisé" }),
      ],
    });
    expect(plannedFTE(wf)).toBe(150 - 10 + 4 - 2);
  });
});

describe("hrEngine — targetFTE (définition unique « Effectif cible », m3)", () => {
  it("is the baseline when there is no movement (department fteTargets are ignored)", () => {
    expect(targetFTE(makeWorkforce())).toBe(100);
  });

  it("adds the planned (lockedPlan) FTE impact of active movements, transfers neutral", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      movements: [
        makeMovement({
          id: "M1",
          type: "Départ forcé",
          fte: 2,
          lockedPlan: { fte: 3, salaryImpact: 0, savings: 0, cost: 0 },
        }),
        makeMovement({ id: "M2", type: "Recrutement", fte: 1 }),
        makeMovement({ id: "M3", type: "Transfert entrant", fte: 5 }),
        makeMovement({ id: "M4", type: "Attrition", fte: 4, status: "Abandonné" }),
      ],
    });
    expect(targetFTE(wf)).toBe(100 - 3 + 1);
  });
});

describe("hrEngine — hrToday (B1)", () => {
  it("returns the real LOCAL date by default (not a frozen demo date)", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(hrToday()).toBe(expected);
    expect(hrToday()).not.toBe("2026-06-22");
  });

  it("accepts an override (ISO string or Date) for tests / demos", () => {
    expect(hrToday("2026-06-22")).toBe("2026-06-22");
    expect(hrToday("2026-06-22T23:59:00Z")).toBe("2026-06-22");
    expect(hrToday(new Date(2027, 0, 5))).toBe("2027-01-05");
    // Valeur invalide : ignorée, repli sur la date réelle.
    expect(hrToday("n/a")).toBe(hrToday());
  });

  it("drives the default reference date of movement alerts", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const plannedDate = hrToday(tomorrow);
    const alerts = movementAlerts(
      makeWorkforce({ movements: [makeMovement({ id: "M1", plannedDate })] }),
      []
    );
    expect(alerts.find((a) => a.movement.id === "M1")?.detail).toEqual({
      reason: "due",
      daysLeft: 1,
    });
  });
});

function makeEmployee(overrides: Partial<Employee>): Employee {
  return {
    id: "E1",
    name: "Alice",
    region: "EU",
    country: "France",
    department: "IT",
    direction: "DSI",
    hrOwner: "HR",
    func: "Dev",
    team: "T",
    bu: "BU",
    entity: "E",
    level: "Local",
    fte: 1,
    salary: 50000,
    hireDate: "2020-01-01",
    retirement: "2050-01-01",
    ...overrides,
  };
}

describe("hrEngine — baseline dérivée des employés (B2)", () => {
  const employees = [
    makeEmployee({ id: "E1", department: "IT", country: "France", fte: 1, salary: 50000 }),
    makeEmployee({ id: "E2", department: "IT", country: "Germany", fte: 0.5, salary: 60000 }),
    makeEmployee({ id: "E3", department: "HR", country: "France", fte: 1, salary: 40000 }),
  ];

  it("derives total FTE, loaded salary mass, departments and country baselines", () => {
    const b = deriveWorkforceBaseline(employees);
    expect(b.totalFTE).toBe(2.5);
    const mass =
      (loadedAnnualSalary(50000) + loadedAnnualSalary(60000) + loadedAnnualSalary(40000)) /
      1_000_000;
    expect(b.massSalary).toBeCloseTo(mass, 2);
    expect(b.departments).toEqual([
      { name: "HR", fte: 1, fteTarget: 1 },
      { name: "IT", fte: 1.5, fteTarget: 1.5 },
    ]);
    expect(b.countryBaselines).toEqual([
      { key: "France", label: "France", fte: 2 },
      { key: "Germany", label: "Germany", fte: 0.5 },
    ]);
    expect(b.workstreamBaselines).toEqual([]);
  });

  it("fills only the missing parts of a workforce (explicit baseline wins)", () => {
    const empty = makeWorkforce({ totalFTE: 0, massSalary: 0, departments: [], employees });
    const filled = withDerivedWorkforceBaseline(empty);
    expect(filled.totalFTE).toBe(2.5);
    expect(filled.departments.map((d) => d.name)).toEqual(["HR", "IT"]);
    expect(filled.countryBaselines?.length).toBe(2);

    const explicit = makeWorkforce({ totalFTE: 100, employees });
    const kept = withDerivedWorkforceBaseline(explicit);
    expect(kept.totalFTE).toBe(100);
    expect(kept.departments.map((d) => d.name)).toEqual(["IT", "HR", "Finance"]);
    // Pas d'employés : inchangé.
    const noEmployees = makeWorkforce({ totalFTE: 0, departments: [] });
    expect(withDerivedWorkforceBaseline(noEmployees)).toBe(noEmployees);
  });

  it("lists department options from employees when no explicit baseline exists", () => {
    expect(
      knownDepartments({
        departments: [],
        employees,
        movements: [makeMovement({ department: "Ops", toDepartment: "Sales" })],
      })
    ).toEqual(["HR", "IT", "Ops", "Sales"]);
  });

  it("scopes the baseline to department / country filters, or returns null (M3)", () => {
    const wf = makeWorkforce({ totalFTE: 0, massSalary: 0, departments: [], employees });
    expect(scopeWorkforceBaseline(wf, {})?.totalFTE).toBe(2.5);
    expect(scopeWorkforceBaseline(wf, { department: ["IT"] })?.totalFTE).toBe(1.5);
    expect(scopeWorkforceBaseline(wf, { country: ["France"] })?.totalFTE).toBe(2);
    expect(scopeWorkforceBaseline(wf, { department: ["IT"], country: ["France"] })?.totalFTE).toBe(
      1
    );
    // Workstream : pas de baseline explicite → non scopable.
    expect(scopeWorkforceBaseline(wf, { workstream: ["WS-01"] })).toBeNull();
    const withWs = makeWorkforce({
      workstreamBaselines: [{ key: "WS-01", label: "WS-01", fte: 60 }],
    });
    expect(scopeWorkforceBaseline(withWs, { workstream: ["WS-01"] })?.totalFTE).toBe(60);
    // Baselines départementales explicites prioritaires en mono-dimension.
    expect(scopeWorkforceBaseline(makeWorkforce(), { department: ["IT", "HR"] })?.totalFTE).toBe(
      80
    );
  });
});

describe("hrEngine — fteBridge", () => {
  it("returns 12 monthly buckets across the year (labels include the year)", () => {
    const wf = makeWorkforce({
      movements: [makeMovement({ plannedDate: "2026-03-15" })],
    });
    const buckets = fteBridge(wf, "month");
    expect(buckets).toHaveLength(12);
    expect(buckets[2].key).toBe("2026-03");
    expect(buckets[2].label).toBe("mars 2026");
    expect(fteBridge(wf, "month", undefined, { locale: "en-GB" })[2].label).toBe("Mar 2026");
    expect(fteBridge(wf, "quarter", undefined, { locale: "de-DE" })[0].label).toBe("Q1 2026");
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
    const feb = buckets.find((b) => b.key === "2026-02");
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

  it("starts a period from the opening FTE (baseline + realized before `from`), M2", () => {
    const wf = makeWorkforce({
      totalFTE: 100,
      massSalary: 8,
      movements: [
        // Réalisé avant la plage : intégré à l'ouverture.
        makeMovement({
          id: "M1",
          type: "Départ forcé",
          fte: 3,
          status: "Réalisé",
          plannedDate: "2026-02-10",
          salaryImpact: -300000,
        }),
        // Non réalisé avant la plage : ignoré.
        makeMovement({ id: "M2", type: "Départ forcé", fte: 2, plannedDate: "2026-03-10" }),
        // Dans la plage.
        makeMovement({ id: "M3", type: "Recrutement", fte: 1, plannedDate: "2026-07-15" }),
      ],
    });
    const range = { from: "2026-07-01", to: "2026-12-31" };
    expect(fteOpening(wf, range)).toBe(97);
    const buckets = fteBridge(wf, "month", range);
    expect(buckets[0].key).toBe("2026-07");
    expect(buckets[0].cumulative).toBe(98);
    expect(buckets[buckets.length - 1].cumulative).toBe(98);
    expect(fteBridgeSummary(wf, range).opening).toBe(97);
    // Masse salariale : ouverture = 8 − 0,3 M€.
    const salary = salaryBridge(wf, "month", range);
    expect(salary[0].key).toBe("2026-07");
    expect(salary[0].cumulative - salary[0].delta).toBeCloseTo(7.7, 2);
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
    const feb = buckets.find((b) => b.key === "2026-02")!;
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
  it("computes baseline, current, target and progress by country", () => {
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
      baseline: 60,
      progressPct: 100,
    });
    expect(rows.find((row) => row.key === "Germany")).toMatchObject({
      current: 40,
      target: 42,
      baseline: 40,
      progressPct: 0,
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

  it("counts movements per series alongside FTE (tooltip 'N pers. · ±X ETP')", () => {
    const rows = movementBreakdownByDimension(
      [
        makeMovement({ id: "M1", type: "Recrutement", country: "France", fte: 0.5 }),
        makeMovement({ id: "M2", type: "Recrutement", country: "France", fte: 1 }),
        makeMovement({ id: "M3", type: "Attrition", country: "France", fte: 1 }),
      ],
      "country"
    );
    expect(rows[0].counts).toEqual({
      recrutements: 2,
      attritions: 1,
      forcedDepartures: 0,
      transfertEntrants: 0,
      transfertSortants: 0,
    });
    expect(rows[0].recrutements).toBe(1.5);
  });

  it("groups movement breakdown by program label", () => {
    const rows = movementBreakdownByDimension(
      [makeMovement({ type: "Recrutement", programId: "p1", fte: 2 })],
      "program",
      { p1: "Transformation 2026" }
    );
    expect(rows[0]).toMatchObject({ label: "Transformation 2026", recrutements: 2 });
  });

  it("retains the underlying movements per row for drill-down (country/program dimension)", () => {
    const recruitment = makeMovement({ id: "M1", type: "Recrutement", country: "France", fte: 2 });
    const attrition = makeMovement({ id: "M2", type: "Attrition", country: "France", fte: 1 });
    const rows = movementBreakdownByDimension([recruitment, attrition], "country");
    expect(rows[0].movements.map((m) => m.id).sort()).toEqual(["M1", "M2"]);
  });

  it(
    "retains the underlying movements per row for drill-down (department dimension) — a " +
      "transfer appears in BOTH the source and destination rows' movements",
    () => {
      const transfer = makeMovement({
        id: "M1",
        type: "Transfert entrant",
        department: "IT",
        toDepartment: "HR",
        fte: 2,
      });
      const rows = movementBreakdownByDimension([transfer], "department");
      const it = rows.find((r) => r.label === "IT")!;
      const hrRow = rows.find((r) => r.label === "HR")!;
      expect(it.movements.map((m) => m.id)).toEqual(["M1"]);
      expect(hrRow.movements.map((m) => m.id)).toEqual(["M1"]);
    }
  );

  it("uses the plan FTE (lockedPlan.fte ?? fte) like the net balance tooltip (M10)", () => {
    const rows = movementBreakdownByDimension(
      [
        makeMovement({
          id: "M1",
          type: "Départ forcé",
          country: "France",
          fte: 1,
          lockedPlan: { fte: 2, salaryImpact: 0, savings: 0, cost: 0 },
        }),
      ],
      "country"
    );
    expect(rows[0].forcedDepartures).toBe(2);
  });

  it("treats a legacy transfer without destination by its stored type in every view (M11)", () => {
    const legacyIn = makeMovement({
      id: "M1",
      type: "Transfert entrant",
      department: "IT",
      toDepartment: undefined,
      fte: 2,
      status: "Réalisé",
    });
    const byDept = movementBreakdownByDimension([legacyIn], "department");
    expect(byDept[0]).toMatchObject({ label: "IT", transfertEntrants: 2, transfertSortants: 0 });
    expect(byDept[0].transferDirections).toEqual({ M1: "in" });
    const byCountry = movementBreakdownByDimension([legacyIn], "country");
    expect(byCountry[0]).toMatchObject({ transfertEntrants: 2, transfertSortants: 0 });
    const positions = ftePositionsByDimension(
      makeWorkforce({ movements: [legacyIn] }),
      "department"
    );
    expect(positions.find((row) => row.key === "IT")?.current).toBe(52);
    expect(movementsByDepartment(makeWorkforce({ movements: [legacyIn] }))[0]).toMatchObject({
      department: "IT",
      transfertEntrants: 2,
      net: 2,
    });
    // Avec destination : sortie source + entrée cible, quel que soit le type enregistré.
    expect(
      transferDepartmentLegs({ type: "Transfert entrant", department: "IT", toDepartment: "HR" })
    ).toEqual([
      { department: "IT", direction: "out" },
      { department: "HR", direction: "in" },
    ]);
  });

  it("keeps zero-net transfers visible in the ETP bridge with counts", () => {
    const summary = fteBridgeSummary(
      makeWorkforce({
        movements: [
          makeMovement({ type: "Transfert entrant", plannedDate: "2026-03-01" }),
          makeMovement({ id: "M2", type: "Transfert sortant", plannedDate: "2026-03-02" }),
        ],
      })
    );
    expect(summary.contributions.find((row) => row.type === "Transfert entrant")).toMatchObject({
      delta: 0,
      count: 1,
    });
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

describe("hrEngine — movementAlerts (garde-fou signe/montant)", () => {
  it("flags a movement whose direction contradicts its lever's targeted fteImpact", () => {
    const lever = makeLever({ id: "L001", code: "L001", fteImpact: -6 }); // levier de réduction
    const movement = makeMovement({
      id: "M1",
      leverId: "L001",
      type: "Recrutement", // effet positif, contraire au levier
      status: "Réalisé",
      plannedDate: "2026-03-01",
      actualDate: "2026-03-01",
      hrValidated: true,
    });
    const alerts = movementAlerts(makeWorkforce({ movements: [movement] }), [lever], "2026-06-01");
    const flagged = alerts.find((a) => a.movement.id === "M1" && a.kind === "leverMismatch");
    expect(flagged).toBeDefined();
    expect(flagged?.message).toContain("sens");
    expect(flagged?.detail).toEqual({
      reason: "signMismatch",
      leverCode: "L001",
      leverName: lever.name,
      movementFte: 1,
      leverFte: -6,
    });
  });

  it("does not flag a movement whose direction matches its lever's targeted fteImpact", () => {
    const lever = makeLever({ id: "L001", code: "L001", fteImpact: -6 });
    const movement = makeMovement({
      id: "M1",
      leverId: "L001",
      type: "Départ forcé", // effet négatif, cohérent avec le levier
      status: "Réalisé",
      plannedDate: "2026-03-01",
      actualDate: "2026-03-01",
      hrValidated: true,
    });
    const alerts = movementAlerts(makeWorkforce({ movements: [movement] }), [lever], "2026-06-01");
    expect(alerts.some((a) => a.movement.id === "M1")).toBe(false);
  });

  it("does not flag a movement linked to a lever with zero fteImpact (no direction to contradict)", () => {
    const lever = makeLever({ id: "L001", code: "L001", fteImpact: 0 });
    const movement = makeMovement({
      id: "M1",
      leverId: "L001",
      type: "Recrutement",
      status: "Réalisé",
      plannedDate: "2026-03-01",
      actualDate: "2026-03-01",
      hrValidated: true,
    });
    const alerts = movementAlerts(makeWorkforce({ movements: [movement] }), [lever], "2026-06-01");
    expect(alerts.some((a) => a.movement.id === "M1")).toBe(false);
  });
});

describe("hrEngine — movementAlerts (réalisé non validé, m1 / M4)", () => {
  it("still checks the lever direction for realized movements awaiting RH validation", () => {
    const lever = makeLever({ id: "L001", code: "L001", fteImpact: -6 });
    const movement = makeMovement({
      id: "M1",
      leverId: "L001",
      type: "Recrutement",
      status: "Réalisé",
      actualDate: "2026-03-01",
      hrValidated: false,
    });
    const alerts = movementAlerts(makeWorkforce({ movements: [movement] }), [lever], "2026-06-01");
    expect(alerts.map((a) => a.kind).sort()).toEqual(["leverMismatch", "toValidate"]);
    // Deux alertes, UN mouvement.
    expect(alertedMovementIds(alerts)).toEqual(["M1"]);
    expect(alertedMovementIds(alerts, "toValidate")).toEqual(["M1"]);
    expect(alertedMovementIds(alerts, ["overdue"])).toEqual([]);
  });
});

describe("hrEngine — alertPrimaryBreakdown (un mouvement = une catégorie principale)", () => {
  it("assigns each alerted movement to its most severe kind so parts sum to the distinct total", () => {
    const m = (id: string) => makeMovement({ id });
    const alerts: MovementAlert[] = [
      // M1 : en retard ET désynchronisé → désynchronisé (plus grave)
      { movement: m("M1"), kind: "overdue", message: "" },
      { movement: m("M1"), kind: "leverMismatch", message: "" },
      { movement: m("M1"), kind: "leverMismatch", message: "" },
      // M2 : à valider ET désynchronisé → désynchronisé
      { movement: m("M2"), kind: "toValidate", message: "" },
      { movement: m("M2"), kind: "leverMismatch", message: "" },
      // M3 : en retard seul
      { movement: m("M3"), kind: "overdue", message: "" },
      // M4 : échéance proche seule
      { movement: m("M4"), kind: "due", message: "" },
    ];
    const primary = primaryAlertKindByMovement(alerts);
    expect(primary.get("M1")).toBe("leverMismatch");
    expect(primary.get("M2")).toBe("leverMismatch");
    expect(primary.get("M3")).toBe("overdue");
    expect(primary.get("M4")).toBe("due");

    const b = alertPrimaryBreakdown(alerts);
    expect(b.total).toBe(alertedMovementIds(alerts).length);
    expect(b.total).toBe(4);
    expect(b.parts).toEqual([
      { kind: "leverMismatch", count: 2 },
      { kind: "overdue", count: 1 },
      { kind: "due", count: 1 },
    ]);
    expect(b.parts.reduce((s, p) => s + p.count, 0)).toBe(b.total);
    expect(ALERT_KIND_SEVERITY).toEqual(["leverMismatch", "overdue", "toValidate", "due"]);
  });

  it("returns an empty breakdown without alerts", () => {
    expect(alertPrimaryBreakdown([])).toEqual({ total: 0, parts: [] });
  });
});

describe("hrEngine — movementAlerts (détail structuré)", () => {
  it("exposes days late / days left for overdue and due movements", () => {
    const lever = makeLever({ id: "L001", code: "L001", fteImpact: -6, end: "2026-12-31" });
    const late = makeMovement({
      id: "M1",
      leverId: "L001",
      type: "Départ forcé",
      status: "Planifié",
      plannedDate: "2026-05-22",
      actualDate: null,
    });
    const soon = makeMovement({
      id: "M2",
      leverId: "L001",
      type: "Départ forcé",
      status: "Planifié",
      plannedDate: "2026-06-04",
      actualDate: null,
    });
    const alerts = movementAlerts(
      makeWorkforce({ movements: [late, soon] }),
      [lever],
      "2026-06-01"
    );
    expect(alerts.find((a) => a.movement.id === "M1")?.detail).toEqual({
      reason: "overdue",
      daysLate: 10,
    });
    expect(alerts.find((a) => a.movement.id === "M2")?.detail).toEqual({
      reason: "due",
      daysLeft: 3,
    });
  });

  it("exposes both dates when a movement is planned after its lever's end", () => {
    const lever = makeLever({
      id: "L001",
      code: "L001",
      fteImpact: -6,
      end: "2026-09-30",
      status: "in_progress",
    });
    const m = makeMovement({
      id: "M1",
      leverId: "L001",
      type: "Départ forcé",
      status: "Planifié",
      plannedDate: "2026-11-15",
      actualDate: null,
    });
    const alerts = movementAlerts(makeWorkforce({ movements: [m] }), [lever], "2026-06-01");
    expect(alerts.find((a) => a.kind === "leverMismatch")?.detail).toMatchObject({
      reason: "afterLeverEnd",
      leverEnd: "2026-09-30",
      plannedDate: "2026-11-15",
    });
  });
});
