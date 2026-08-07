import { describe, expect, it } from "vitest";
import { hrProgramSummary, targetFteFromBaseline } from "@/lib/hrProgramSummary";
import type { WorkforceMovement, WorkforceMovementSnapshot } from "@/types";

function makeMovement(overrides: Partial<WorkforceMovement>): WorkforceMovement {
  return {
    id: "M001",
    empId: "E001",
    label: "Test Movement",
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
    cost: 10000,
    ...overrides,
  };
}

function snapshot(overrides: Partial<WorkforceMovementSnapshot>): WorkforceMovementSnapshot {
  return { fte: 1, salaryImpact: -50000, savings: 50000, cost: 10000, ...overrides };
}

describe("hrProgramSummary", () => {
  it("returns zeros for an empty movement list", () => {
    const s = hrProgramSummary([]);
    expect(s.fte).toEqual({ realized: 0, target: 0, reforecast: 0, progressPct: 0 });
    expect(s.salarySavings.realized).toBe(0);
    expect(s.socialCost.realized).toBe(0);
    expect(s.netEconomy.realized).toBe(0);
  });

  it("aggregates realized values from status='Réalisé' only", () => {
    const s = hrProgramSummary([
      makeMovement({ id: "M1", status: "Réalisé", savings: 100000, cost: 20000, fte: 3 }),
      makeMovement({ id: "M2", status: "Planifié", savings: 50000, cost: 10000, fte: 2 }),
    ]);
    expect(s.salarySavings.realized).toBe(100000);
    expect(s.socialCost.realized).toBe(20000);
    expect(s.netEconomy.realized).toBe(80000);
    // FTE realized : Départ forcé (−) × 3
    expect(s.fte.realized).toBe(-3);
  });

  it("target uses lockedPlan when present, falls back to raw values", () => {
    const s = hrProgramSummary([
      makeMovement({
        id: "M1",
        savings: 50000,
        cost: 10000,
        fte: 2,
        lockedPlan: snapshot({ fte: 3, savings: 100000, cost: 15000 }),
      }),
      makeMovement({ id: "M2", savings: 30000, cost: 5000, fte: 1 }),
    ]);
    // lockedPlan.savings 100000 + brut 30000 = 130000
    expect(s.salarySavings.target).toBe(130000);
    // lockedPlan.cost 15000 + brut 5000 = 20000
    expect(s.socialCost.target).toBe(20000);
    expect(s.netEconomy.target).toBe(130000 - 20000);
  });

  it("reforecast uses reforecast when present, falls back to lockedPlan then raw", () => {
    const s = hrProgramSummary([
      makeMovement({
        id: "M1",
        savings: 50000,
        cost: 10000,
        fte: 2,
        lockedPlan: snapshot({ fte: 3, savings: 100000, cost: 15000 }),
        reforecast: snapshot({ fte: 3, savings: 90000, cost: 18000 }),
      }),
      makeMovement({
        id: "M2",
        savings: 30000,
        cost: 5000,
        fte: 1,
        lockedPlan: snapshot({ savings: 40000, cost: 6000 }),
        // pas de reforecast → repli sur lockedPlan
      }),
    ]);
    expect(s.salarySavings.reforecast).toBe(90000 + 40000);
    expect(s.socialCost.reforecast).toBe(18000 + 6000);
    expect(s.netEconomy.reforecast).toBe(130000 - 24000);
  });

  it("progressPct is realized / target × 100, bounded to [-100, 100]", () => {
    const s = hrProgramSummary([
      makeMovement({
        id: "M1",
        status: "Réalisé",
        savings: 50000,
        cost: 10000,
        fte: 2,
        lockedPlan: snapshot({ fte: 5, savings: 100000, cost: 20000 }),
      }),
    ]);
    expect(s.salarySavings.progressPct).toBe(50);
    expect(s.socialCost.progressPct).toBe(50);
  });

  it("progressPct is 0 when target is 0", () => {
    const s = hrProgramSummary([]);
    expect(s.fte.progressPct).toBe(0);
    expect(s.salarySavings.progressPct).toBe(0);
  });

  it("FTE is signed by movement type (Recrutement +, Attrition/Départ forcé -, transfert 0)", () => {
    const s = hrProgramSummary([
      makeMovement({ id: "M1", type: "Recrutement", fte: 3, status: "Réalisé" }),
      makeMovement({ id: "M2", type: "Attrition", fte: 2, status: "Réalisé" }),
      makeMovement({ id: "M3", type: "Départ forcé", fte: 4, status: "Réalisé" }),
      makeMovement({ id: "M4", type: "Transfert entrant", fte: 5, status: "Réalisé" }),
    ]);
    expect(s.fte.realized).toBe(3 - 2 - 4);
  });

  it("excludes abandoned movements from targets and forecasts", () => {
    const s = hrProgramSummary([
      makeMovement({
        status: "Abandonné",
        savings: 100000,
        cost: 20000,
        lockedPlan: snapshot({ fte: 3, savings: 100000, cost: 20000 }),
      }),
    ]);
    expect(s.salarySavings.target).toBe(0);
    expect(s.socialCost.target).toBe(0);
    expect(s.fte.target).toBe(0);
  });
});

describe("targetFteFromBaseline", () => {
  it("derives the absolute target from baseline plus planned FTE impact", () => {
    expect(targetFteFromBaseline(2840, -16.9)).toBe(2823.1);
  });

  it("falls back safely when an input is not finite", () => {
    expect(targetFteFromBaseline(2840, Number.NaN)).toBe(2840);
    expect(targetFteFromBaseline(Number.NaN, -16.9)).toBe(-16.9);
  });
});
