import { describe, expect, it } from "vitest";
import {
  movementRhythmSeries,
  movementRhythmAxisDomains,
  netEconomySeries,
  salarySavingsSeries,
  socialCostSeries,
} from "@/lib/hrTimeSeries";
import { hrProgramSummary } from "@/lib/hrProgramSummary";
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
  it("propagates annual salary impact monthly from actual/planned start dates", () => {
    const range = { from: "2026-01-01", to: "2026-12-31" };
    const buckets = salarySavingsSeries(
      [
        makeMovement({
          id: "M1",
          status: "Réalisé",
          plannedDate: "2026-02-15",
          actualDate: "2026-03-01",
          salaryImpact: -120000,
        }),
        makeMovement({
          id: "M2",
          status: "Planifié",
          plannedDate: "2026-09-15",
          salaryImpact: -240000,
        }),
      ],
      "month",
      range,
      "2026-06-22"
    );
    expect(buckets).toHaveLength(12);
    const feb = buckets.find((b) => b.label.startsWith("févr."))!;
    const mar = buckets.find((b) => b.label.startsWith("mars"))!;
    const sep = buckets.find((b) => b.label.startsWith("sept."))!;
    expect(feb.actualPlusForecast).toBe(0);
    expect(mar.actualPlusForecast).toBeCloseTo(0.01, 3);
    expect(sep.actualPlusForecast).toBeCloseTo(0.03, 3);
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

  it("plan uses lockedPlan salary impact and prorates it", () => {
    const range = { from: "2026-01-01", to: "2026-12-31" };
    const buckets = salarySavingsSeries(
      [
        makeMovement({
          id: "M1",
          plannedDate: "2026-03-15",
          salaryImpact: -60000,
          lockedPlan: { fte: 1, salaryImpact: -100000, savings: 100000, cost: 10000 },
        }),
      ],
      "month",
      range,
      "2026-06-22"
    );
    const mar = buckets.find((b) => b.label.startsWith("mars"))!;
    expect(mar.plan).toBeCloseTo(0.1 / 12, 3);
  });

  it("excludes abandoned movements from actual+forecast but preserves them in the initial plan", () => {
    const range = { from: "2026-01-01", to: "2026-12-31" };
    const buckets = salarySavingsSeries(
      [makeMovement({ status: "Abandonné", salaryImpact: -120000 })],
      "month",
      range,
      "2026-06-22"
    );
    expect(buckets.every((bucket) => bucket.actualPlusForecast === 0)).toBe(true);
    expect(buckets.some((bucket) => bucket.plan > 0)).toBe(true);
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
    expect(feb.actualForecast).toBeCloseTo(0.02, 3);
    expect(apr.actualForecast).toBeCloseTo(0.03, 3);
    expect(apr.cumulActualForecast).toBeCloseTo(0.05, 3);
  });

  it("uses movement.cost rather than lockedPlan/reforecast cost and actualDate when realized", () => {
    const range = { from: "2026-01-01", to: "2026-12-31" };
    const buckets = socialCostSeries(
      [
        makeMovement({
          status: "Réalisé",
          plannedDate: "2026-02-01",
          actualDate: "2026-04-01",
          cost: 30000,
          lockedPlan: { fte: 1, salaryImpact: -1, savings: 1, cost: 10000 },
          reforecast: { fte: 1, salaryImpact: -1, savings: 1, cost: 50000 },
        }),
      ],
      "month",
      range
    );
    expect(buckets.find((b) => b.label.startsWith("févr."))?.actualForecast).toBe(0);
    expect(buckets.find((b) => b.label.startsWith("avr."))?.actualForecast).toBeCloseTo(0.03, 3);
    expect(buckets.find((b) => b.label.startsWith("févr."))?.plan).toBeCloseTo(0.01, 3);
  });
});

describe("hrTimeSeries — netEconomySeries", () => {
  it("computes recurring salary savings minus one-off cost", () => {
    const range = { from: "2026-01-01", to: "2026-12-31" };
    const buckets = netEconomySeries(
      [makeMovement({ id: "M1", plannedDate: "2026-02-01", salaryImpact: -120000, cost: 30000 })],
      "month",
      range
    );
    const feb = buckets.find((b) => b.label.startsWith("févr."))!;
    const mar = buckets.find((b) => b.label.startsWith("mars"))!;
    expect(feb.actualForecast).toBeCloseTo(-0.02, 3);
    expect(mar.actualForecast).toBeCloseTo(0.01, 3);
    expect(mar.cumulActualForecast).toBeCloseTo(-0.01, 3);
  });

  it("handles negative periods (cost > savings)", () => {
    const range = { from: "2026-01-01", to: "2026-06-30" };
    const buckets = netEconomySeries(
      [makeMovement({ plannedDate: "2026-02-01", salaryImpact: -120000, cost: 30000 })],
      "month",
      range
    );
    const feb = buckets.find((b) => b.label.startsWith("févr."))!;
    expect(feb.actualForecast).toBeCloseTo(-0.02, 3);
  });

  it("reconciles net exactly with savings minus ENR for period and cumulative values", () => {
    const range = { from: "2026-01-01", to: "2026-12-31" };
    const movements = [
      makeMovement({ plannedDate: "2026-02-01", salaryImpact: -120000, cost: 30000 }),
      makeMovement({
        id: "M2",
        plannedDate: "2026-04-01",
        salaryImpact: 60000,
        cost: 10000,
        lockedPlan: { fte: 1, salaryImpact: 48000, savings: 0, cost: 8000 },
      }),
    ];
    const savings = salarySavingsSeries(movements, "month", range, "2026-06-22");
    const enr = socialCostSeries(movements, "month", range);
    const net = netEconomySeries(movements, "month", range);
    net.forEach((bucket, index) => {
      expect(bucket.actualForecast).toBeCloseTo(
        savings[index].actualPlusForecast - enr[index].actualForecast,
        3
      );
      expect(bucket.plan).toBeCloseTo(savings[index].plan - enr[index].plan, 3);
      expect(bucket.cumulActualForecast).toBeCloseTo(
        savings[index].cumulActualForecast - enr[index].cumulActualForecast,
        3
      );
      expect(bucket.cumulPlan).toBeCloseTo(savings[index].cumulPlan - enr[index].cumulPlan, 3);
    });
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

  it("uses the algebraic sum of all visible bars as period net", () => {
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
    expect(feb.net).toBe(0);
  });

  it("reconciles the final cumulative target with the Impact ETP KPI", () => {
    const range = { from: "2026-01-01", to: "2026-12-31" };
    const movements = [
      makeMovement({
        id: "M1",
        type: "Départ forcé",
        plannedDate: "2026-02-01",
        lockedPlan: { fte: 3, salaryImpact: -1, savings: 1, cost: 0 },
      }),
      makeMovement({
        id: "M2",
        type: "Recrutement",
        plannedDate: "2026-03-01",
        lockedPlan: { fte: 1.5, salaryImpact: 1, savings: 0, cost: 0 },
      }),
      makeMovement({
        id: "M3",
        type: "Transfert entrant",
        plannedDate: "2026-04-01",
        lockedPlan: { fte: 8, salaryImpact: 0, savings: 0, cost: 0 },
      }),
    ];
    const buckets = movementRhythmSeries(movements, "month", range);
    expect(buckets[buckets.length - 1].cumulNet).toBe(hrProgramSummary(movements).fte.target);
  });
});

describe("hrTimeSeries — movementRhythmAxisDomains", () => {
  it("uses stacked positive/negative totals rather than individual series", () => {
    const domains = movementRhythmAxisDomains([
      {
        label: "T1 2026",
        startISO: "2026-01-01",
        endISO: "2026-03-31",
        byType: {
          Recrutement: 1,
          Attrition: -1,
          "Départ forcé": -2,
          "Transfert entrant": 2,
          "Transfert sortant": -1,
        },
        net: -2,
        cumulNet: -2,
      },
    ]);
    // Pile positive +3 et négative -4, puis marge/arrondi lisible → ±5.
    expect(domains.period).toEqual([-5, 5]);
  });

  it("adds headroom and rounds cumulative values to readable bounds", () => {
    const domains = movementRhythmAxisDomains([
      {
        label: "T4 2028",
        startISO: "2028-10-01",
        endISO: "2028-12-31",
        byType: {
          Recrutement: 1,
          Attrition: 0,
          "Départ forcé": -1,
          "Transfert entrant": 2,
          "Transfert sortant": 0,
        },
        net: 0,
        cumulNet: -16.1,
      },
    ]);
    expect(domains.cumulative).toEqual([-20, 20]);
    expect(domains.cumulative[0]).toBe(-domains.cumulative[1]);
  });
});
