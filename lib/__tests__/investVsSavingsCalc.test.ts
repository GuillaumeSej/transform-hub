import { describe, it, expect } from "vitest";
import { buildInvestVsSavingsCalc, investVsSavingsPayback } from "@/lib/investVsSavingsCalc";
import { bucketInvestVsSavingsByPeriod } from "@/lib/financeCosts";
import type { ActionImpact, BeTrackData, Lever, LeverAction } from "@/types";

function lever(id: string, actions: LeverAction[]): Lever {
  return {
    id,
    code: id,
    name: `Lever ${id}`,
    ws: "WS-01",
    start: "2026-01-01",
    end: "2028-12-31",
    status: "in_progress",
    actions,
  } as unknown as Lever;
}

function action(id: string, start: string, impacts: Partial<ActionImpact>[]): LeverAction {
  return {
    id,
    name: id,
    start,
    end: start,
    status: "in_progress",
    impacts: impacts.map((i, k) => ({
      id: `${id}-${k}`,
      label: "x",
      type: "cost",
      nature: "oneoff",
      amount: 1,
      ...i,
    })) as ActionImpact[],
  };
}

const data = (levers: Lever[]) => ({ levers, workstreams: [] }) as unknown as BeTrackData;

// L1 : 2026 → CAPEX 10 + OPEX ponctuel 2 + OPEX récurrent 1 ; 2027 & 2028 → gains 6 chacun.
// L2 : 2026 → gain 3.
const fixture = data([
  lever("L1", [
    action("A1", "2026-01-05", [
      { nature: "capex", amount: 10, capexDeploymentDate: "2026-02-01" },
      { nature: "oneoff", amount: 2 },
      { nature: "opex_rec", amount: 1 },
    ]),
    action("A2", "2027-01-05", [{ type: "saving", amount: 6, gainDate: "2027-03-01" }]),
    action("A3", "2028-01-05", [{ type: "saving", amount: 6, gainDate: "2028-03-01" }]),
  ]),
  lever("L2", [
    action("B1", "2026-01-05", [{ type: "saving", amount: 3, gainDate: "2026-04-01" }]),
  ]),
]);

describe("investVsSavingsCalc — buildInvestVsSavingsCalc (période)", () => {
  it("reprend les montants du graphique et sépare CAPEX / OPEX ponctuel", () => {
    const calc = buildInvestVsSavingsCalc(fixture, "year", "2026")!;
    const point = bucketInvestVsSavingsByPeriod(fixture, "year")[0];
    expect(calc.scope).toBe("period");
    expect(calc.periodLabel).toBe("2026");
    expect(calc.grossSavings).toBe(point.grossSavings);
    expect(calc.grossSavings).toBe(3);
    expect(calc.opexRec).toBe(1);
    expect(calc.netSavings).toBe(2);
    expect(calc.capex).toBe(10);
    expect(calc.opexOneOff).toBe(2);
    expect(calc.investCost).toBe(12);
    expect(calc.netResult).toBe(point.netPeriodResult);
    expect(calc.netResult).toBe(-10);
    expect(calc.cumulative).toBe(-10);
    expect(calc.roiPct).toBe(-83.3);
  });

  it("classe les leviers par impact absolu sur le résultat net (top 5)", () => {
    const calc = buildInvestVsSavingsCalc(fixture, "year", "2026")!;
    expect(calc.topLevers.map((r) => [r.leverId, r.net])).toEqual([
      ["L1", -13],
      ["L2", 3],
    ]);
  });

  it("renvoie null pour une période inconnue", () => {
    expect(buildInvestVsSavingsCalc(fixture, "year", "2031")).toBeNull();
  });

  it("n'a pas de ROI quand la période n'a aucun investissement", () => {
    expect(buildInvestVsSavingsCalc(fixture, "year", "2027")!.roiPct).toBeNull();
  });
});

describe("investVsSavingsCalc — vue Total et délai de retour", () => {
  it("somme l'horizon complet et fusionne les leviers", () => {
    const calc = buildInvestVsSavingsCalc(fixture, "year", null)!;
    expect(calc.scope).toBe("total");
    expect(calc.periodLabel).toBe("2026 → 2028");
    expect(calc.grossSavings).toBe(15);
    expect(calc.investCost).toBe(12);
    expect(calc.netResult).toBe(2);
    expect(calc.cumulative).toBe(2);
    expect(calc.roiPct).toBe(16.7);
    const l1 = calc.rows.find((r) => r.leverId === "L1")!;
    expect(l1.grossSavings).toBe(12);
    expect(l1.net).toBe(-1);
  });

  it("repère le breakeven (1re période où le cumul repasse ≥ 0)", () => {
    const calc = buildInvestVsSavingsCalc(fixture, "year", "2026")!;
    expect(calc.paybackLabel).toBe("2028");
    expect(calc.paybackPeriods).toBe(3);
    expect(investVsSavingsPayback([])).toBeNull();
  });

  it("renvoie null sans aucune donnée", () => {
    expect(buildInvestVsSavingsCalc(data([]), "year", null)).toBeNull();
  });
});
