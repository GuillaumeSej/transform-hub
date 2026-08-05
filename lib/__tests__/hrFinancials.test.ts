import { describe, it, expect } from "vitest";
import {
  DEFAULT_SOCIAL_CHARGES_RATE,
  computeMovementEuros,
  computeMovementFinancials,
  getSocialChargesRate,
  loadedAnnualSalary,
  severanceEstimate,
  tenureYears,
} from "@/lib/hrFinancials";

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
    const loadedSalary = 120_000; // 10k/month
    expect(severanceEstimate(loadedSalary, 4)).toBe(4 * 0.25 * 10_000);
  });

  it("applies 1/3 month per year beyond 10 years", () => {
    const loadedSalary = 120_000; // 10k/month
    const expected = Math.round(10 * 0.25 * 10_000 + 5 * (1 / 3) * 10_000);
    expect(severanceEstimate(loadedSalary, 15)).toBe(expected);
  });

  it("returns 0 for no tenure", () => {
    expect(severanceEstimate(120_000, 0)).toBe(0);
  });
});

describe("hrFinancials — computeMovementFinancials", () => {
  const chargesRate = 0.45;

  it("Suppression: computes salary savings on the loaded salary, negative salaryImpact, and a severance + notice cost", () => {
    const fin = computeMovementFinancials({
      type: "Suppression",
      grossSalary: 60_000,
      chargesRate,
      tenure: 5,
      inPSE: false,
    });
    const loadedSalary = 60_000 * 1.45;
    expect(fin.loadedSalary).toBe(Math.round(loadedSalary));
    expect(fin.salarySavings).toBe(fin.loadedSalary);
    expect(fin.salaryImpact).toBe(-fin.loadedSalary);
    // cost = severance (5 * 0.25 month) + 2 months notice, both > 0
    expect(fin.socialCost).toBeGreaterThan(0);
    expect(fin.netFirstYearImpact).toBe(fin.salaryImpact + fin.socialCost);
  });

  it("Suppression: inPSE adds an overhead on top of the non-PSE cost", () => {
    const base = { type: "Suppression" as const, grossSalary: 60_000, chargesRate, tenure: 8 };
    const withoutPSE = computeMovementFinancials({ ...base, inPSE: false });
    const withPSE = computeMovementFinancials({ ...base, inPSE: true });
    expect(withPSE.socialCost).toBeGreaterThan(withoutPSE.socialCost);
    // Only the PSE overhead differs — salaryImpact/savings unaffected by the PSE flag.
    expect(withPSE.salaryImpact).toBe(withoutPSE.salaryImpact);
    expect(withPSE.salarySavings).toBe(withoutPSE.salarySavings);
  });

  it("Suppression: longer tenure increases the social cost", () => {
    const short = computeMovementFinancials({
      type: "Suppression",
      grossSalary: 60_000,
      chargesRate,
      tenure: 1,
    });
    const long = computeMovementFinancials({
      type: "Suppression",
      grossSalary: 60_000,
      chargesRate,
      tenure: 12,
    });
    expect(long.socialCost).toBeGreaterThan(short.socialCost);
  });

  it("Recrutement: positive salaryImpact (added payroll cost), zero savings, recruitment+onboarding cost", () => {
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
    expect(fin.netFirstYearImpact).toBe(fin.salaryImpact + fin.socialCost);
  });

  it("Redéploiement: no FTE reduction so no salary savings, zero salaryImpact, light transition cost", () => {
    const fin = computeMovementFinancials({
      type: "Redéploiement",
      grossSalary: 55_000,
      chargesRate,
    });
    expect(fin.salarySavings).toBe(0);
    expect(fin.salaryImpact).toBe(0);
    expect(fin.socialCost).toBeGreaterThan(0);
    expect(fin.netFirstYearImpact).toBe(fin.socialCost);
  });

  it("Reconversion: no salary savings, zero salaryImpact, heavier transition cost than Redéploiement", () => {
    const grossSalary = 55_000;
    const redeploiement = computeMovementFinancials({
      type: "Redéploiement",
      grossSalary,
      chargesRate,
    });
    const reconversion = computeMovementFinancials({
      type: "Reconversion",
      grossSalary,
      chargesRate,
    });
    expect(reconversion.salarySavings).toBe(0);
    expect(reconversion.salaryImpact).toBe(0);
    expect(reconversion.socialCost).toBeGreaterThan(redeploiement.socialCost);
  });
});

describe("hrFinancials — computeMovementEuros", () => {
  it("maps computeMovementFinancials onto the WorkforceMovement EUR fields", () => {
    const result = computeMovementEuros(
      "Suppression",
      60_000,
      { socialChargesRate: 0.45 },
      { tenure: 5 }
    );
    const fin = computeMovementFinancials({
      type: "Suppression",
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
});
