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
      { key: "gross", label: "Brut", kind: "total", value: 95, cumulative: 95 },
      { key: "opexRec", label: "OPEX récurrent", kind: "delta", value: -5, cumulative: 90 },
      { key: "target", label: "Net", kind: "total", value: 90, cumulative: 90 },
    ],
    target: 90,
    realized: 30,
    remaining: 60,
    gross: 95,
    opexRec: 5,
  };
  it("builds gross -> floating opex segments -> net target bars that loop", () => {
    const bars = waterfallBars(w, [{ value: 3 }, { value: 2 }]);
    expect(bars[0]).toMatchObject({ base: 0, up: 95 });
    expect(bars[1]).toMatchObject({ base: 90, seg: [3, 2], value: -5 });
    expect(bars[2]).toMatchObject({ realized: 30, remaining: 60, up: 0 });
    // brut − OPEX = net : le sommet de la barre OPEX rejoint le brut
    expect(bars[1].base + bars[1].seg.reduce((s2, v) => s2 + v, 0)).toBe(bars[0].up);
  });
  it("target bar loops on the same numbers as savingsTriple", () => {
    const levers = [
      lever({}),
      lever({ id: "B", lockedPlan: undefined, netSavings: 4, reforecast: undefined }),
    ];
    const triple = savingsTriple(levers);
    const w2: SavingsWaterfall = {
      ...w,
      target: triple.reforecast,
      realized: triple.realized,
      remaining: 0,
    };
    const bar = waterfallBars({
      ...w2,
      steps: [
        {
          key: "target",
          label: "x",
          kind: "total",
          value: triple.reforecast,
          cumulative: triple.reforecast,
        },
      ],
    })[0];
    expect(bar.realized + bar.remaining).toBeCloseTo(triple.reforecast, 1);
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
