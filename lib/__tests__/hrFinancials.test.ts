import { describe, it, expect } from "vitest";
import {
  DEFAULT_SOCIAL_CHARGES_RATE,
  FORCED_DEPARTURE_MULTIPLIER,
  computeMovementEuros,
  computeMovementFinancials,
  getSocialChargesRate,
  loadedAnnualSalary,
  netEconomy,
  netEconomyTotal,
  severanceEstimate,
  tenureYears,
} from "@/lib/hrFinancials";
import type { WorkforceMovement } from "@/types";

describe("hrFinancials — getSocialChargesRate", () => {
  it("returns the default rate when the company has no rate configured", () => {
    expect(getSocialChargesRate(undefined)).toBe(DEFAULT_SOCIAL_CHARGES_RATE);
    expect(getSocialChargesRate(null)).toBe(DEFAULT_SOCIAL_CHARGES_RATE);
    expect(getSocialChargesRate({})).toBe(DEFAULT_SOCIAL_CHARGES_RATE);
  });

  it("uses the company-configured rate when present", () => {
    expect(getSocialChargesRate({ socialChargesRate: 0.6 })).toBe(0.6);
  });

  it("falls back to the default for invalid rates", () => {
    expect(getSocialChargesRate({ socialChargesRate: -1 })).toBe(DEFAULT_SOCIAL_CHARGES_RATE);
    expect(getSocialChargesRate({ socialChargesRate: NaN })).toBe(DEFAULT_SOCIAL_CHARGES_RATE);
  });
});

describe("hrFinancials — loadedAnnualSalary", () => {
  it("applies the charges rate on top of the gross salary", () => {
    expect(loadedAnnualSalary(100_000, 0.45)).toBe(145_000);
  });

  it("never goes negative for a negative gross salary", () => {
    expect(loadedAnnualSalary(-5000, 0.45)).toBe(0);
  });
});

describe("hrFinancials — tenureYears", () => {
  it("returns 0 when hireDate is missing", () => {
    expect(tenureYears(undefined, "2026-06-22")).toBe(0);
    expect(tenureYears(null, "2026-06-22")).toBe(0);
  });

  it("computes fractional years of service", () => {
    expect(tenureYears("2016-06-22", "2026-06-22")).toBeCloseTo(10, 1);
  });

  it("returns 0 for a hire date in the future relative to refDate", () => {
    expect(tenureYears("2027-01-01", "2026-06-22")).toBe(0);
  });
});

describe("hrFinancials — severanceEstimate", () => {
  it("applies 1/4 month per year up to 10 years", () => {
    expect(severanceEstimate(120_000, 4)).toBe(4 * 0.25 * 10_000);
  });

  it("applies 1/3 month per year beyond 10 years", () => {
    const expected = Math.round(10 * 0.25 * 10_000 + 5 * (1 / 3) * 10_000);
    expect(severanceEstimate(120_000, 15)).toBe(expected);
  });

  it("returns 0 for no tenure", () => {
    expect(severanceEstimate(120_000, 0)).toBe(0);
  });
});

describe("hrFinancials — computeMovementFinancials (5-types Gooduelle)", () => {
  const chargesRate = 0.45;

  it("Départ forcé: full salary savings, negative salaryImpact, severance + notice cost × 1.2 multiplier", () => {
    const fin = computeMovementFinancials({
      type: "Départ forcé",
      grossSalary: 60_000,
      chargesRate,
      tenure: 5,
      inPSE: false,
    });
    const loadedSalary = Math.round(60_000 * 1.45);
    expect(fin.loadedSalary).toBe(loadedSalary);
    expect(fin.salarySavings).toBe(loadedSalary);
    expect(fin.salaryImpact).toBe(-loadedSalary);
    expect(fin.socialCost).toBeGreaterThan(0);
    // The multiplier should elevate cost above pure severance+notice
    const severance = severanceEstimate(loadedSalary, 5);
    const notice = Math.round((2 / 12) * loadedSalary);
    expect(fin.socialCost).toBe(Math.round((severance + notice) * FORCED_DEPARTURE_MULTIPLIER));
  });

  it("Départ forcé: inPSE adds an overhead", () => {
    const base = { type: "Départ forcé" as const, grossSalary: 60_000, chargesRate, tenure: 8 };
    const withoutPSE = computeMovementFinancials({ ...base, inPSE: false });
    const withPSE = computeMovementFinancials({ ...base, inPSE: true });
    expect(withPSE.socialCost).toBeGreaterThan(withoutPSE.socialCost);
    expect(withPSE.salaryImpact).toBe(withoutPSE.salaryImpact);
  });

  it("Départ forcé: longer tenure increases social cost", () => {
    const short = computeMovementFinancials({
      type: "Départ forcé",
      grossSalary: 60_000,
      chargesRate,
      tenure: 1,
    });
    const long = computeMovementFinancials({
      type: "Départ forcé",
      grossSalary: 60_000,
      chargesRate,
      tenure: 12,
    });
    expect(long.socialCost).toBeGreaterThan(short.socialCost);
  });

  it("Attrition: full savings, minimal social cost (0.5 month notice, no severance, no PSE overhead)", () => {
    const fin = computeMovementFinancials({
      type: "Attrition",
      grossSalary: 60_000,
      chargesRate,
      tenure: 10, // ignored for Attrition
    });
    const loadedSalary = Math.round(60_000 * 1.45);
    expect(fin.salarySavings).toBe(loadedSalary);
    expect(fin.salaryImpact).toBe(-loadedSalary);
    // Attrition social cost = ~0.5 month of loaded salary
    expect(fin.socialCost).toBe(Math.round((0.5 / 12) * loadedSalary));
  });

  it("Attrition social cost is MUCH lower than Départ forcé for the same tenure", () => {
    const attrition = computeMovementFinancials({
      type: "Attrition",
      grossSalary: 60_000,
      chargesRate,
      tenure: 8,
    });
    const forced = computeMovementFinancials({
      type: "Départ forcé",
      grossSalary: 60_000,
      chargesRate,
      tenure: 8,
    });
    expect(attrition.socialCost).toBeLessThan(forced.socialCost);
    expect(attrition.salarySavings).toBe(forced.salarySavings); // same run-rate savings
  });

  it("Recrutement: positive salaryImpact, zero savings, recruitment+onboarding cost", () => {
    const fin = computeMovementFinancials({
      type: "Recrutement",
      grossSalary: 50_000,
      chargesRate,
    });
    const loadedSalary = Math.round(50_000 * 1.45);
    expect(fin.loadedSalary).toBe(loadedSalary);
    expect(fin.salarySavings).toBe(0);
    expect(fin.salaryImpact).toBe(loadedSalary);
    expect(fin.socialCost).toBeGreaterThan(0);
  });

  it("Transfert entrant/sortant without retraining: light transition cost, zero salaryImpact", () => {
    const inFin = computeMovementFinancials({
      type: "Transfert entrant",
      grossSalary: 55_000,
      chargesRate,
    });
    const outFin = computeMovementFinancials({
      type: "Transfert sortant",
      grossSalary: 55_000,
      chargesRate,
    });
    expect(inFin.salarySavings).toBe(0);
    expect(inFin.salaryImpact).toBe(0);
    expect(outFin.salarySavings).toBe(0);
    expect(outFin.salaryImpact).toBe(0);
    // Same rate 5% for both when requiresRetraining is false
    expect(inFin.socialCost).toBe(outFin.socialCost);
    expect(inFin.socialCost).toBeGreaterThan(0);
  });

  it("Transfert entrant with requiresRetraining=true has heavier transition cost", () => {
    const light = computeMovementFinancials({
      type: "Transfert entrant",
      grossSalary: 55_000,
      chargesRate,
      requiresRetraining: false,
    });
    const heavy = computeMovementFinancials({
      type: "Transfert entrant",
      grossSalary: 55_000,
      chargesRate,
      requiresRetraining: true,
    });
    expect(heavy.socialCost).toBeGreaterThan(light.socialCost);
    // Same salary impact structure
    expect(heavy.salarySavings).toBe(light.salarySavings);
    expect(heavy.salaryImpact).toBe(light.salaryImpact);
  });
});

describe("hrFinancials — computeMovementEuros", () => {
  it("maps computeMovementFinancials onto the persisted EUR fields", () => {
    const result = computeMovementEuros(
      "Départ forcé",
      60_000,
      { socialChargesRate: 0.45 },
      { tenure: 5 }
    );
    const fin = computeMovementFinancials({
      type: "Départ forcé",
      grossSalary: 60_000,
      chargesRate: 0.45,
      tenure: 5,
      inPSE: false,
    });
    expect(result).toEqual({
      salaryImpact: fin.salaryImpact,
      savings: fin.salarySavings,
      cost: fin.socialCost,
    });
  });

  it("uses the default charges rate when no company is provided", () => {
    const result = computeMovementEuros("Recrutement", 40_000, undefined);
    const loadedSalary = Math.round(40_000 * (1 + DEFAULT_SOCIAL_CHARGES_RATE));
    expect(result.salaryImpact).toBe(loadedSalary);
  });

  it("passes requiresRetraining option through for Transfert", () => {
    const withRe = computeMovementEuros("Transfert entrant", 50_000, undefined, {
      requiresRetraining: true,
    });
    const withoutRe = computeMovementEuros("Transfert entrant", 50_000, undefined, {
      requiresRetraining: false,
    });
    expect(withRe.cost).toBeGreaterThan(withoutRe.cost);
  });
});

// ─── netEconomy (Gooduelle-style) ─────────────────────────────────────────────

function makeMovement(overrides: Partial<WorkforceMovement>): WorkforceMovement {
  return {
    id: "M001",
    empId: null,
    label: "test",
    leverId: "L001",
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
    cost: 15000,
    ...overrides,
  };
}

describe("hrFinancials — netEconomy", () => {
  it("aggregates savings and ENR per month bucket, computes net", () => {
    const movements: WorkforceMovement[] = [
      makeMovement({ plannedDate: "2026-03-10", savings: 50000, cost: 15000 }),
      makeMovement({ id: "M002", plannedDate: "2026-03-20", savings: 30000, cost: 5000 }),
      makeMovement({ id: "M003", plannedDate: "2026-04-05", savings: 40000, cost: 10000 }),
    ];
    const result = netEconomy(movements, "month");
    const mar = result.find((r) => r.label.startsWith("Mar"));
    const apr = result.find((r) => r.label.startsWith("Avr"));
    expect(mar?.grossSavings).toBe(80000);
    expect(mar?.enr).toBe(20000);
    expect(mar?.net).toBe(60000);
    expect(apr?.grossSavings).toBe(40000);
    expect(apr?.enr).toBe(10000);
    expect(apr?.net).toBe(30000);
  });

  it("aggregates by fiscal year when granularity is 'year'", () => {
    const movements: WorkforceMovement[] = [
      makeMovement({ plannedDate: "2026-05-01", savings: 100000, cost: 20000 }),
      makeMovement({ id: "M002", plannedDate: "2026-08-01", savings: 200000, cost: 30000 }),
    ];
    const result = netEconomy(movements, "year", "2026-07-01");
    // May → FY25/26 ; August → FY26/27
    expect(result.find((r) => r.label === "FY25/26")?.net).toBe(80000);
    expect(result.find((r) => r.label === "FY26/27")?.net).toBe(170000);
  });
});

describe("hrFinancials — netEconomyTotal", () => {
  it("returns overall totals", () => {
    const movements: WorkforceMovement[] = [
      makeMovement({ savings: 100000, cost: 30000 }),
      makeMovement({ id: "M002", savings: 50000, cost: 10000 }),
    ];
    const total = netEconomyTotal(movements);
    expect(total.grossSavings).toBe(150000);
    expect(total.enr).toBe(40000);
    expect(total.net).toBe(110000);
  });
});
