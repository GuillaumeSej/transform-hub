import { describe, expect, it } from "vitest";
import { formatSignedFr, movementNetBalance } from "@/lib/hrMovementBalance";
import { movementRhythmSeries } from "@/lib/hrTimeSeries";
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

describe("hrMovementBalance — movementNetBalance", () => {
  it("sums entries/exits, neutralizes transfers and excludes abandoned movements", () => {
    const balance = movementNetBalance([
      makeMovement({ id: "R1", type: "Recrutement", fte: 1 }),
      makeMovement({ id: "R2", type: "Recrutement", fte: 0.5 }),
      makeMovement({ id: "A1", type: "Attrition", fte: 1 }),
      makeMovement({ id: "D1", type: "Départ forcé", fte: 1 }),
      makeMovement({ id: "D2", type: "Départ forcé", fte: 1, status: "Abandonné" }),
      makeMovement({ id: "TI", type: "Transfert entrant", fte: 2 }),
      makeMovement({ id: "TO", type: "Transfert sortant", fte: 1 }),
    ]);
    expect(balance.entries).toEqual({ count: 2, fte: 1.5 });
    expect(balance.exits).toEqual({ count: 2, fte: 2 });
    expect(balance.transfersIn).toEqual({ count: 1, fte: 2 });
    expect(balance.transfersOut).toEqual({ count: 1, fte: 1 });
    expect(balance.netFte).toBe(-0.5);
    expect(balance.netHeadcount).toBe(0);
    expect(balance.abandonedCount).toBe(1);
  });

  it("uses the locked plan FTE when present (same target as the KPI and the chart)", () => {
    const balance = movementNetBalance([
      makeMovement({
        type: "Attrition",
        fte: 1,
        lockedPlan: { fte: 0.8, salaryImpact: 0, savings: 0, cost: 0 },
      }),
    ]);
    expect(balance.exits.fte).toBe(0.8);
    expect(balance.netFte).toBe(-0.8);
  });

  it("returns an empty zero balance for no movements (no negative zero)", () => {
    const balance = movementNetBalance([]);
    expect(balance.netFte).toBe(0);
    expect(Object.is(balance.netFte, -0)).toBe(false);
    expect(balance.netHeadcount).toBe(0);
  });

  it("matches the per-period net of movementRhythmSeries", () => {
    const movements = [
      makeMovement({ id: "R1", type: "Recrutement", plannedDate: "2026-02-10", fte: 1 }),
      makeMovement({ id: "A1", type: "Attrition", plannedDate: "2026-02-20", fte: 1 }),
      makeMovement({ id: "D1", type: "Départ forcé", plannedDate: "2026-02-25", fte: 1 }),
      makeMovement({ id: "T1", type: "Transfert sortant", plannedDate: "2026-02-26", fte: 3 }),
    ];
    const buckets = movementRhythmSeries(movements, "month", {
      from: "2026-01-01",
      to: "2026-03-31",
    });
    for (const bucket of buckets) {
      expect(movementNetBalance(bucket.movements).netFte).toBe(bucket.net);
    }
  });
});

describe("hrMovementBalance — formatSignedFr", () => {
  it("prefixes a sign and uses the French decimal comma", () => {
    expect(formatSignedFr(3)).toBe("+3");
    expect(formatSignedFr(-2.5)).toBe("−2,5");
    expect(formatSignedFr(0)).toBe("0");
  });
});
