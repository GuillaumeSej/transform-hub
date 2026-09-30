import { describe, expect, it } from "vitest";
import { hrKpiDetail, leverCoverageRows, type HrKpiKey } from "@/lib/hrKpiDetail";
import { hrProgramSummary, targetMovementFteImpact } from "@/lib/hrProgramSummary";
import { fteCoverage } from "@/lib/fteCoverage";
import type { Lever, WorkforceMovement } from "@/types";

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
    leverId: "L1",
    type: "Départ forcé",
    fte: 1,
    department: "IT",
    country: "France",
    hrOwner: "HR",
    plannedDate: "2026-03-01",
    actualDate: null,
    status: "Planifié",
    hrValidated: false,
    salaryImpact: -50000,
    savings: 50000,
    cost: 10000,
    ...overrides,
  };
}

const levers: Lever[] = [
  makeLever({ id: "L1", code: "ORG-001", name: "Réorganisation", fteImpact: -5 }),
  makeLever({ id: "L2", code: "ORG-002", name: "Offshoring", fteImpact: -2 }),
  makeLever({ id: "L3", code: "ORG-003", name: "Sans mouvement", fteImpact: -3 }),
  makeLever({ id: "L4", code: "ORG-004", name: "Neutre", fteImpact: 0 }),
];

const movements: WorkforceMovement[] = [
  makeMovement({ id: "M1", leverId: "L1", status: "Réalisé", fte: 1, salaryImpact: -61234.4 }),
  makeMovement({
    id: "M2",
    leverId: "L1",
    type: "Attrition",
    fte: 0.5,
    department: "Finance",
    salaryImpact: -30000.6,
    cost: 0,
    lockedPlan: { fte: 0.5, salaryImpact: -31000, savings: 31000, cost: 0 },
  }),
  makeMovement({
    id: "M3",
    leverId: "L2",
    type: "Recrutement",
    fte: 1,
    salaryImpact: 45000,
    savings: 0,
    cost: 5000.4,
    department: "",
  }),
  makeMovement({ id: "M4", leverId: "L2", status: "Abandonné", fte: 3, salaryImpact: -999999 }),
  makeMovement({ id: "M5", leverId: "UNKNOWN", fte: 2, salaryImpact: -80000, cost: 20000 }),
  makeMovement({
    id: "M6",
    leverId: "L1",
    type: "Transfert sortant",
    fte: 1,
    salaryImpact: 0,
    cost: 0,
  }),
  makeMovement({
    id: "M7",
    leverId: "L2",
    fte: 1,
    reforecast: { fte: 1, salaryImpact: -40000, savings: 40000, cost: 7000 },
  }),
];

const KPIS: HrKpiKey[] = ["fte", "salarySavings", "socialCost", "netEconomy"];

describe("hrKpiDetail", () => {
  it.each(KPIS)("%s — totals are exactly hrProgramSummary(movements)[kpi]", (kpi) => {
    expect(hrKpiDetail(kpi, movements, levers).totals).toEqual(hrProgramSummary(movements)[kpi]);
  });

  it.each(KPIS)("%s — breakdowns sum to totals (rounding tolerance per movement)", (kpi) => {
    const d = hrKpiDetail(kpi, movements, levers);
    const unit = kpi === "fte" ? 0.1 : 1;
    const tolerance = unit * movements.length;
    for (const rows of [d.byLever, d.byType, d.byDepartment]) {
      const sum = (f: "realized" | "target" | "reforecast") => rows.reduce((s, r) => s + r[f], 0);
      expect(Math.abs(sum("target") - d.totals.target)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(sum("realized") - d.totals.realized)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(sum("reforecast") - d.totals.reforecast)).toBeLessThanOrEqual(tolerance);
    }
    const movSum = d.movements.reduce((s, r) => s + r.target, 0);
    expect(Math.abs(movSum - d.totals.target)).toBeLessThanOrEqual(tolerance);
  });

  it("excludes abandoned movements everywhere", () => {
    for (const kpi of KPIS) {
      const d = hrKpiDetail(kpi, movements, levers);
      const ids = [
        ...d.movements.map((r) => r.movement.id),
        ...d.byLever.flatMap((r) => r.movementIds),
        ...d.byType.flatMap((r) => r.movementIds),
        ...d.byDepartment.flatMap((r) => r.movementIds),
      ];
      expect(ids).not.toContain("M4");
    }
  });

  it("labels levers, unknown lever group and empty department", () => {
    const d = hrKpiDetail("salarySavings", movements, levers);
    const l1 = d.byLever.find((r) => r.key === "L1");
    expect(l1).toMatchObject({
      label: "ORG-001 — Réorganisation",
      leverCode: "ORG-001",
      leverId: "L1",
    });
    const none = d.byLever.find((r) => r.key === "");
    expect(none).toMatchObject({ label: "Sans levier", movementIds: ["M5"] });
    expect(none?.leverId).toBeUndefined();
    expect(d.byDepartment.find((r) => r.key === "—")?.movementIds).toEqual(["M3"]);
    expect(d.byType.map((r) => r.label)).toContain("Recrutement");
  });

  it("sorts rows and movements by |target| desc and drops non-contributing movements", () => {
    const d = hrKpiDetail("fte", movements, levers);
    for (const rows of [d.byLever, d.byType, d.byDepartment, d.movements]) {
      const abs = rows.map((r) => Math.abs(r.target));
      expect(abs).toEqual([...abs].sort((a, b) => b - a));
    }
    // Transfert : neutre sur l'ETP → absent de la fiche ETP.
    expect(d.movements.map((r) => r.movement.id)).not.toContain("M6");
    expect(d.byType.find((r) => r.key === "Transfert sortant")).toBeUndefined();
  });

  it("per-movement values match hrProgramSummary of that single movement", () => {
    for (const kpi of KPIS) {
      for (const row of hrKpiDetail(kpi, movements, levers).movements) {
        const s = hrProgramSummary([row.movement])[kpi];
        expect(row.target).toBe(s.target);
        expect(row.realized).toBe(s.realized);
      }
    }
  });

  it("returns empty breakdowns for no movements", () => {
    const d = hrKpiDetail("netEconomy", [], levers);
    expect(d.totals).toEqual(hrProgramSummary([]).netEconomy);
    expect(d.byLever).toEqual([]);
    expect(d.movements).toEqual([]);
  });
});

describe("leverCoverageRows", () => {
  it("remaining matches fteCoverage for each lever", () => {
    const rows = leverCoverageRows(levers, movements);
    for (const row of rows) {
      const lever = levers.find((l) => l.id === row.leverId)!;
      const movFte = movements
        .filter((m) => m.leverId === lever.id)
        .reduce((s, m) => s + targetMovementFteImpact(m), 0);
      const cov = fteCoverage(lever.fteImpact, movFte);
      expect(row.remaining).toBe(cov.remaining);
      expect(row.movementFte).toBe(cov.movementFte);
      expect(row.leverFte).toBe(cov.leverFte);
    }
  });

  it("keeps only levers with ambition or attached FTE movements, sorted by remaining desc", () => {
    const rows = leverCoverageRows(levers, movements);
    expect(rows.map((r) => r.leverId)).not.toContain("L4");
    expect(rows.map((r) => r.leverId)).toContain("L3");
    const remaining = rows.map((r) => r.remaining);
    expect(remaining).toEqual([...remaining].sort((a, b) => b - a));
    // L1 : transfert (impact 0) non listé ; L2 : abandonné exclu.
    expect(rows.find((r) => r.leverId === "L1")?.movementIds).toEqual(["M1", "M2"]);
    expect(rows.find((r) => r.leverId === "L2")?.movementIds).toEqual(["M3", "M7"]);
  });

  it("an opposite-direction movement increases remaining", () => {
    const lever = makeLever({ id: "LX", code: "X", name: "X", fteImpact: -2 });
    const exit = makeMovement({ id: "A", leverId: "LX", fte: 1 });
    const hire = makeMovement({ id: "B", leverId: "LX", type: "Recrutement", fte: 1 });
    const [base] = leverCoverageRows([lever], [exit]);
    const [withHire] = leverCoverageRows([lever], [exit, hire]);
    expect(base.remaining).toBe(1);
    expect(withHire.remaining).toBe(2);
  });

  it("lists a lever without ambition when it has attached FTE movements", () => {
    const lever = makeLever({ id: "LZ", code: "Z", name: "Z", fteImpact: 0 });
    const rows = leverCoverageRows([lever], [makeMovement({ id: "A", leverId: "LZ" })]);
    expect(rows).toEqual([
      {
        leverId: "LZ",
        leverCode: "Z",
        leverName: "Z",
        leverFte: 0,
        movementFte: -1,
        remaining: 0,
        movementIds: ["A"],
      },
    ]);
  });
});
