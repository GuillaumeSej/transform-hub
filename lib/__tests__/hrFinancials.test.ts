import { describe, expect, it } from "vitest";
import {
  ATTRITION_NOTICE_MONTHS,
  FORCED_DEPARTURE_MULTIPLIER,
  NOTICE_PERIOD_MONTHS,
  RETRAINING_TRANSITION_RATE,
  TRANSFER_TRANSITION_RATE,
  computeMovementEuros,
  computeMovementFinancials,
  loadedAnnualSalary,
  severanceEstimate,
  tenureYears,
} from "@/lib/hrFinancials";

describe("hrFinancials — loadedAnnualSalary", () => {
  it("returns the gross salary as-is — plus de calcul de charges patronales", () => {
    expect(loadedAnnualSalary(100_000)).toBe(100_000);
  });

  it("never goes negative for a negative gross salary", () => {
    expect(loadedAnnualSalary(-5000)).toBe(0);
  });
});

describe("hrFinancials — tenureYears", () => {
  it("returns 0 when hireDate is missing", () => {
    expect(tenureYears(null, "2026-06-22")).toBe(0);
    expect(tenureYears(undefined, "2026-06-22")).toBe(0);
  });

  it("computes fractional years of service", () => {
    expect(tenureYears("2016-06-22", "2026-06-22")).toBeCloseTo(10, 1);
  });

  it("returns 0 for a hire date in the future", () => {
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

  it("returns 0 for zero tenure", () => {
    expect(severanceEstimate(120_000, 0)).toBe(0);
  });
});

describe("hrFinancials — computeMovementFinancials (5-types Gooduelle)", () => {
  it("Départ forcé: full salary savings, negative salaryImpact, severance + notice with ×1.2 multiplier", () => {
    const fin = computeMovementFinancials({
      type: "Départ forcé",
      grossSalary: 60_000,
      tenure: 5,
      inPSE: false,
    });
    const loadedSalary = 60_000;
    expect(fin.loadedSalary).toBe(loadedSalary);
    expect(fin.salarySavings).toBe(loadedSalary);
    expect(fin.salaryImpact).toBe(-loadedSalary);
    expect(fin.socialCost).toBeGreaterThan(0);
    const severance = severanceEstimate(loadedSalary, 5);
    const notice = Math.round((NOTICE_PERIOD_MONTHS / 12) * loadedSalary);
    expect(fin.socialCost).toBe(Math.round((severance + notice) * FORCED_DEPARTURE_MULTIPLIER));
  });

  it("Départ forcé: inPSE adds an overhead on top of the non-PSE cost", () => {
    const base = { type: "Départ forcé" as const, grossSalary: 60_000, tenure: 8 };
    const withoutPSE = computeMovementFinancials({ ...base, inPSE: false });
    const withPSE = computeMovementFinancials({ ...base, inPSE: true });
    expect(withPSE.socialCost).toBeGreaterThan(withoutPSE.socialCost);
    expect(withPSE.salaryImpact).toBe(withoutPSE.salaryImpact);
  });

  it("Départ forcé: longer tenure increases the social cost", () => {
    const short = computeMovementFinancials({
      type: "Départ forcé",
      grossSalary: 60_000,
      tenure: 1,
    });
    const long = computeMovementFinancials({
      type: "Départ forcé",
      grossSalary: 60_000,
      tenure: 12,
    });
    expect(long.socialCost).toBeGreaterThan(short.socialCost);
  });

  it("Attrition: full savings, minimal social cost (0.5 month notice), no severance, no PSE overhead", () => {
    const fin = computeMovementFinancials({
      type: "Attrition",
      grossSalary: 60_000,
      tenure: 10,
    });
    const loadedSalary = 60_000;
    expect(fin.salarySavings).toBe(loadedSalary);
    expect(fin.salaryImpact).toBe(-loadedSalary);
    expect(fin.socialCost).toBe(Math.round((ATTRITION_NOTICE_MONTHS / 12) * loadedSalary));
  });

  it("Attrition social cost is much lower than Départ forcé for the same tenure", () => {
    const attrition = computeMovementFinancials({
      type: "Attrition",
      grossSalary: 60_000,
      tenure: 8,
    });
    const forced = computeMovementFinancials({
      type: "Départ forcé",
      grossSalary: 60_000,
      tenure: 8,
    });
    expect(attrition.socialCost).toBeLessThan(forced.socialCost);
    expect(attrition.salarySavings).toBe(forced.salarySavings);
  });

  it("Recrutement: positive salaryImpact, zero savings, recruitment + onboarding cost", () => {
    const fin = computeMovementFinancials({
      type: "Recrutement",
      grossSalary: 50_000,
    });
    const loadedSalary = 50_000;
    expect(fin.loadedSalary).toBe(loadedSalary);
    expect(fin.salarySavings).toBe(0);
    expect(fin.salaryImpact).toBe(loadedSalary);
    expect(fin.socialCost).toBeGreaterThan(0);
  });

  it("Transfert entrant/sortant without retraining: light transition cost, zero salaryImpact", () => {
    const inFin = computeMovementFinancials({
      type: "Transfert entrant",
      grossSalary: 55_000,
    });
    const outFin = computeMovementFinancials({
      type: "Transfert sortant",
      grossSalary: 55_000,
    });
    expect(inFin.salarySavings).toBe(0);
    expect(inFin.salaryImpact).toBe(0);
    expect(outFin.salarySavings).toBe(0);
    expect(outFin.salaryImpact).toBe(0);
    expect(inFin.socialCost).toBe(outFin.socialCost);
    const loadedSalary = 55_000;
    expect(inFin.socialCost).toBe(Math.round(TRANSFER_TRANSITION_RATE * loadedSalary));
  });

  it("Transfert entrant with requiresRetraining=true has heavier transition cost", () => {
    const light = computeMovementFinancials({
      type: "Transfert entrant",
      grossSalary: 55_000,
      requiresRetraining: false,
    });
    const heavy = computeMovementFinancials({
      type: "Transfert entrant",
      grossSalary: 55_000,
      requiresRetraining: true,
    });
    const loadedSalary = 55_000;
    expect(heavy.socialCost).toBe(Math.round(RETRAINING_TRANSITION_RATE * loadedSalary));
    expect(heavy.socialCost).toBeGreaterThan(light.socialCost);
  });
});

describe("hrFinancials — computeMovementEuros", () => {
  it("maps computeMovementFinancials onto the persisted EUR fields", () => {
    const result = computeMovementEuros("Départ forcé", 60_000, { tenure: 5 });
    const fin = computeMovementFinancials({
      type: "Départ forcé",
      grossSalary: 60_000,
      tenure: 5,
      inPSE: false,
    });
    expect(result).toEqual({
      salaryImpact: fin.salaryImpact,
      savings: fin.salarySavings,
      cost: fin.socialCost,
    });
  });

  it("uses the gross salary as the loaded salary directly (no charges rate)", () => {
    const result = computeMovementEuros("Recrutement", 40_000);
    expect(result.salaryImpact).toBe(40_000);
  });

  it("passes requiresRetraining through for Transfert", () => {
    const withRe = computeMovementEuros("Transfert entrant", 50_000, {
      requiresRetraining: true,
    });
    const withoutRe = computeMovementEuros("Transfert entrant", 50_000, {
      requiresRetraining: false,
    });
    expect(withRe.cost).toBeGreaterThan(withoutRe.cost);
  });
});
