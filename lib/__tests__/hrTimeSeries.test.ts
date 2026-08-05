import { describe, expect, it } from "vitest";
import {
  movementRhythmSeries,
  netEconomySeries,
  salarySavingsSeries,
  socialCostSeries,
} from "@/lib/hrTimeSeries";
import type { WorkforceMovement } from "@/types";

function makeMovement(overrides: Partial<WorkforceMovement>): WorkforceMovement {
  return {
    id: "M001",
    empId: null,
    label: "Test",
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

describe("hrTimeSeries — salarySavingsSeries", () => {
  it("splits actuals (past + Réalisé) from forecasts (future or non-Réalisé)", () => {
    const range = { from: "2026-01-01", to: "2026-12-31" };
    const buckets = salarySavingsSeries(
      [
        makeMovement({ id: "M1", status: "Réalisé", plannedDate: "2026-02-15", savings: 100000 }),
        makeMovement({ id: "M2", status: "Planifié", plannedDate: "2026-09-15", savings: 200000 }),
      ],
      "month",
      range,
      "2026-06-22"
    );
    expect(buckets).toHaveLength(12);
    const feb = buckets.find((b) => b.label.startsWith("févr."))!;
    const sep = buckets.find((b) => b.label.startsWith("sept."))!;
    expect(feb.actualPlusForecast).toBeCloseTo(0.1, 3);
    expect(sep.actualPlusForecast).toBeCloseTo(0.2, 3);
    expect(sep.isFuture).toBe(true);
    expect(feb.isFuture).toBe(false);
  });

  it("cumul is monotonically non-decreasing on positive savings", () => {
    const range = { from: "2026-01-01", to: "2026-12-31" };
    const buckets = salarySavingsSeries(
      [
        makeMovement({ id: "M1", plannedDate: "2026-03-15", savings: 100000 }),
        makeMovement({ id: "M2", plannedDate: "2026-06-15", savings: 200000 }),
      ],
      "month",
      range,
      "2026-06-22"
    );
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].cumulActualForecast).toBeGreaterThanOrEqual(
        buckets[i - 1].cumulActualForecast
      );
    }
  });

  it("plan uses lockedPlan.savings when present", () => {
    const range = { from: "2026-01-01", to: "2026-12-31" };
    const buckets = salarySavingsSeries(
      [
        makeMovement({
          id: "M1",
          plannedDate: "2026-03-15",
          savings: 50000,
          lockedPlan: { fte: 1, salaryImpact: -100000, savings: 100000, cost: 10000 },
        }),
      ],
      "month",
      range,
      "2026-06-22"
    );
    const mar = buckets.find((b) => b.label.startsWith("mars"))!;
    // Plan = lockedPlan.savings 100000 = €0.1M
    expect(mar.plan).toBeCloseTo(0.1, 3);
  });
});

describe("hrTimeSeries — socialCostSeries", () => {
  it("aggregates ENR per period + cumul", () => {
    const range = { from: "2026-01-01", to: "2026-12-31" };
    const buckets = socialCostSeries(
      [
        makeMovement({ id: "M1", plannedDate: "2026-02-01", cost: 20000 }),
        makeMovement({ id: "M2", plannedDate: "2026-04-01", cost: 30000 }),
      ],
      "month",
      range
    );
    const feb = buckets.find((b) => b.label.startsWith("févr."))!;
    const apr = buckets.find((b) => b.label.startsWith("avr."))!;
    expect(feb.enr).toBeCloseTo(0.02, 3);
    expect(apr.enr).toBeCloseTo(0.03, 3);
    expect(apr.cumulEnr).toBeCloseTo(0.05, 3);
  });
});

describe("hrTimeSeries — netEconomySeries", () => {
  it("computes net = savings − cost per period, cumul cumulates", () => {
    const range = { from: "2026-01-01", to: "2026-12-31" };
    const buckets = netEconomySeries(
      [
        makeMovement({ id: "M1", plannedDate: "2026-02-01", savings: 100000, cost: 30000 }),
        makeMovement({ id: "M2", plannedDate: "2026-03-01", savings: 50000, cost: 40000 }),
      ],
      "month",
      range
    );
    const feb = buckets.find((b) => b.label.startsWith("févr."))!;
    const mar = buckets.find((b) => b.label.startsWith("mars"))!;
    expect(feb.net).toBeCloseTo(0.07, 3);
    expect(mar.net).toBeCloseTo(0.01, 3);
    expect(mar.cumulNet).toBeCloseTo(0.08, 3);
  });

  it("handles negative periods (cost > savings)", () => {
    const range = { from: "2026-01-01", to: "2026-06-30" };
    const buckets = netEconomySeries(
      [makeMovement({ plannedDate: "2026-02-01", savings: 10000, cost: 30000 })],
      "month",
      range
    );
    const feb = buckets.find((b) => b.label.startsWith("févr."))!;
    expect(feb.net).toBeCloseTo(-0.02, 3);
  });
});

describe("hrTimeSeries — movementRhythmSeries", () => {
  it("decomposes buckets by the 5 movement types with net + cumul", () => {
    const range = { from: "2026-01-01", to: "2026-12-31" };
    const buckets = movementRhythmSeries(
      [
        makeMovement({ id: "M1", type: "Départ forcé", fte: 3, plannedDate: "2026-02-01" }),
        makeMovement({ id: "M2", type: "Recrutement", fte: 1, plannedDate: "2026-02-15" }),
        makeMovement({ id: "M3", type: "Attrition", fte: 1, plannedDate: "2026-03-10" }),
      ],
      "month",
      range
    );
    const feb = buckets.find((b) => b.label.startsWith("févr."))!;
    expect(feb.byType["Départ forcé"]).toBe(-3);
    expect(feb.byType["Recrutement"]).toBe(1);
    expect(feb.net).toBe(-2);
    const mar = buckets.find((b) => b.label.startsWith("mars"))!;
    expect(mar.byType["Attrition"]).toBe(-1);
    expect(mar.cumulNet).toBe(-3);
  });

  it("transfert entrant is displayed positive, transfert sortant negative for visualization, both net 0 on fteEffect", () => {
    const range = { from: "2026-01-01", to: "2026-12-31" };
    const buckets = movementRhythmSeries(
      [
        makeMovement({ id: "M1", type: "Transfert entrant", fte: 2, plannedDate: "2026-02-01" }),
        makeMovement({ id: "M2", type: "Transfert sortant", fte: 3, plannedDate: "2026-02-15" }),
      ],
      "month",
      range
    );
    const feb = buckets.find((b) => b.label.startsWith("févr."))!;
    expect(feb.byType["Transfert entrant"]).toBe(2);
    expect(feb.byType["Transfert sortant"]).toBe(-3);
    expect(feb.net).toBe(0); // les transferts n'affectent pas l'ETP total
  });
});
