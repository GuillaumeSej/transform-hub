import { describe, expect, it } from "vitest";
import { formatSignedFr, movementNetBalance } from "@/lib/hrMovementBalance";
import { movementBreakdownByDimension } from "@/lib/hrEngine";
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
    expect(balance.transferNetFte).toBe(1);
    expect(balance.netFte).toBe(-0.5);
    expect(balance.netHeadcount).toBe(0);
    expect(balance.abandonedCount).toBe(1);
  });

  it("keeps transfers out of the net FTE and reports them in a separate transfer balance", () => {
    const balance = movementNetBalance([
      makeMovement({ id: "R1", type: "Recrutement", fte: 1 }),
      makeMovement({ id: "TO1", type: "Transfert sortant", fte: 2 }),
      makeMovement({ id: "TO2", type: "Transfert sortant", fte: 0.5 }),
      makeMovement({ id: "TI", type: "Transfert entrant", fte: 1 }),
    ]);
    expect(balance.netFte).toBe(1);
    expect(balance.transfersIn).toEqual({ count: 1, fte: 1 });
    expect(balance.transfersOut).toEqual({ count: 2, fte: 2.5 });
    expect(balance.transferNetFte).toBe(-1.5);
  });

  it("reads transfer direction relative to the group when a resolver is given", () => {
    // Un transfert IT → HR : sortant pour IT, entrant pour HR, quel que soit son type enregistré.
    const transfer = makeMovement({
      id: "T1",
      type: "Transfert entrant",
      department: "IT",
      toDepartment: "HR",
      fte: 2,
    });
    const rows = movementBreakdownByDimension([transfer], "department");
    const balanceFor = (label: string) => {
      const row = rows.find((r) => r.label === label)!;
      return movementNetBalance(row.movements, {
        transferDirection: (m) => row.transferDirections[m.id],
      });
    };
    const itBalance = balanceFor("IT");
    expect(itBalance.transfersOut).toEqual({ count: 1, fte: 2 });
    expect(itBalance.transfersIn.count).toBe(0);
    expect(itBalance.transferNetFte).toBe(-2);
    expect(itBalance.netFte).toBe(0);
    const hrBalance = balanceFor("HR");
    expect(hrBalance.transfersIn).toEqual({ count: 1, fte: 2 });
    expect(hrBalance.transfersOut.count).toBe(0);
    expect(hrBalance.transferNetFte).toBe(2);
    // Sans résolveur : type enregistré (« Transfert entrant »).
    expect(movementNetBalance([transfer]).transferNetFte).toBe(2);
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
    expect(Object.is(balance.transferNetFte, -0)).toBe(false);
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
