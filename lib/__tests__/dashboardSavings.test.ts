import { describe, it, expect } from "vitest";
import {
  attachChildren,
  financeTotals,
  savingsTriple,
  seriesToBridge,
  sortFinanceRows,
  waterfallBars,
} from "@/lib/dashboardSavings";
import type { SavingsWaterfall, FinanceHierarchyRow } from "@/lib/engine";
import type { HierarchyNode, Lever } from "@/types";

const lever = (o: Partial<Lever>): Lever =>
  ({
    id: "L",
    status: "in_progress",
    netSavings: 10,
    lockedPlan: { netSavings: 8 },
    reforecast: { netSavings: 12 },
    progress: 50,
    ...o,
  }) as unknown as Lever;

describe("savingsTriple", () => {
  it("excludes cancelled levers and uses locked plan / reforecast", () => {
    const t = savingsTriple([lever({}), lever({ id: "C", status: "cancelled" })]);
    expect(t.planned).toBe(8);
    expect(t.reforecast).toBe(12);
  });
});

describe("waterfallBars", () => {
  const w: SavingsWaterfall = {
    steps: [
      { key: "initial", label: "Planifié initial", kind: "total", value: 100, cumulative: 100 },
      { key: "reforecast", label: "Réactualisé", kind: "delta", value: 10, cumulative: 110 },
      { key: "cancelled", label: "Annulé", kind: "delta", value: -20, cumulative: 90 },
      { key: "late", label: "En retard", kind: "delta", value: -10, cumulative: 80 },
      { key: "costs", label: "Coûts", kind: "delta", value: -5, cumulative: 75 },
      { key: "expected", label: "Total attendu", kind: "total", value: 75, cumulative: 75 },
    ],
    expected: 75,
    realized: 30,
    remaining: 45,
  };
  it("builds floating bars and splits the final bar", () => {
    const bars = waterfallBars(w);
    expect(bars[0]).toMatchObject({ base: 0, up: 100 });
    expect(bars[1]).toMatchObject({ base: 100, up: 10 });
    expect(bars[2]).toMatchObject({ base: 90, down: 20 });
    expect(bars[5]).toMatchObject({ realized: 30, remaining: 45, up: 0 });
  });
});

describe("finance table helpers", () => {
  const row = (id: string, planned: number, realized: number): FinanceHierarchyRow => ({
    nodeId: id,
    code: id,
    label: id,
    planned,
    reforecast: planned,
    cancelled: 0,
    late: 0,
    realized,
  });
  it("sorts and totals", () => {
    const rows = [row("b", 5, 1), row("a", 10, 2)];
    expect(sortFinanceRows(rows, "planned", "desc")[0].nodeId).toBe("a");
    expect(sortFinanceRows(rows, "label", "asc")[0].nodeId).toBe("a");
    expect(financeTotals(rows)).toMatchObject({ planned: 15, realized: 3 });
  });
  it("attaches children to parents", () => {
    const nodes = [
      { id: "c1", parentId: "p1" },
      { id: "c2", parentId: "p2" },
    ] as HierarchyNode[];
    const tree = attachChildren([row("p1", 1, 0)], [row("c1", 1, 0), row("c2", 1, 0)], nodes);
    expect(tree[0].children.map((c) => c.nodeId)).toEqual(["c1"]);
  });
});

describe("seriesToBridge", () => {
  it("projects the shared series without changing values", () => {
    expect(
      seriesToBridge([
        { month: "Jan", actualDelta: 2, actual: 2 },
        { month: "Feb", actualDelta: 0, actual: null },
      ])
    ).toEqual([
      { quarter: "Jan", delta: 2, cumulative: 2 },
      { quarter: "Feb", delta: 0, cumulative: null },
    ]);
  });
});
