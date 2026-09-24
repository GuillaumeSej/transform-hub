import { describe, it, expect } from "vitest";
import {
  attachChildren,
  financeTotals,
  limitSegments,
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
  it("planifié initial = plan figé abandonnés COMPRIS ; réactualisé sans les abandonnés (audit C2)", () => {
    const t = savingsTriple([lever({}), lever({ id: "C", status: "cancelled" })]);
    expect(t.planned).toBe(16);
    expect(t.reforecast).toBe(12);
  });
});

describe("waterfallBars", () => {
  const w: SavingsWaterfall = {
    steps: [
      { key: "initial", label: "Initial", kind: "total", value: 100, cumulative: 100 },
      { key: "reforecast", label: "Réactualisé", kind: "delta", value: -4, cumulative: 96 },
      { key: "cancelled", label: "Annulé", kind: "delta", value: -6, cumulative: 90 },
      { key: "target", label: "Cible", kind: "total", value: 90, cumulative: 90 },
      { key: "gross", label: "Brut", kind: "total", value: 95, cumulative: 95 },
      { key: "opexRec", label: "OPEX récurrent", kind: "delta", value: -5, cumulative: 90 },
      { key: "net", label: "Net", kind: "total", value: 90, cumulative: 90 },
    ],
    initial: 100,
    reforecastDelta: -4,
    cancelled: 6,
    target: 90,
    realized: 30,
    remaining: 60,
    gross: 95,
    opexRec: 5,
  };
  const by = (bars: ReturnType<typeof waterfallBars>, k: string) => bars.find((b) => b.key === k)!;
  it("builds two groups separated by a gap; both loop", () => {
    const bars = waterfallBars(w, [{ value: 3 }, { value: 2 }]);
    expect(bars.map((b) => b.key)).toEqual([
      "initial",
      "reforecast",
      "cancelled",
      "target",
      "gap",
      "gross",
      "opexRec",
      "net",
    ]);
    expect(by(bars, "gap").group).toBe("gap");
    expect(by(bars, "initial")).toMatchObject({ base: 0, up: 100, group: "plan" });
    expect(by(bars, "reforecast")).toMatchObject({ base: 96, down: 4, up: 0 });
    expect(by(bars, "cancelled")).toMatchObject({ base: 90, down: 6 });
    expect(by(bars, "target")).toMatchObject({ realized: 30, remaining: 60, up: 0 });
    // initial + Δ réactualisé − annulé = cible
    expect(100 + by(bars, "reforecast").value + by(bars, "cancelled").value).toBe(
      by(bars, "target").value
    );
    // brut − OPEX = net : le sommet de la barre OPEX rejoint le brut
    const opex = by(bars, "opexRec");
    expect(opex.base + opex.seg.reduce((s2, v) => s2 + v, 0)).toBe(by(bars, "gross").up);
    expect(by(bars, "gross").up - 5).toBe(by(bars, "net").up);
  });
  it("adjusts opex segments so they always sum to the OPEX total", () => {
    const opex = by(waterfallBars(w, [{ value: 3 }, { value: 1.6 }]), "opexRec");
    expect(opex.seg.reduce((s2, v) => s2 + v, 0)).toBeCloseTo(5, 5);
  });
  it("target bar loops on the same numbers as savingsTriple", () => {
    const levers = [
      lever({}),
      lever({ id: "B", lockedPlan: undefined, netSavings: 4, reforecast: undefined }),
    ];
    const triple = savingsTriple(levers);
    const bar = by(
      waterfallBars({
        ...w,
        target: triple.reforecast,
        realized: triple.realized,
        steps: [
          {
            key: "target",
            label: "x",
            kind: "total",
            value: triple.reforecast,
            cumulative: triple.reforecast,
          },
        ],
      }),
      "target"
    );
    expect(bar.realized + bar.remaining).toBeCloseTo(triple.reforecast, 1);
  });
});

describe("limitSegments", () => {
  it("keeps the biggest and folds the rest into Autres (total preserved)", () => {
    const segs = Array.from({ length: 9 }, (_, i) => ({
      key: `k${i}`,
      label: `L${i}`,
      value: i + 1,
    }));
    const out = limitSegments(segs, 6, "Autres");
    expect(out).toHaveLength(6);
    expect(out[5]).toMatchObject({ label: "Autres", value: 10 });
    expect(out.reduce((s, x) => s + x.value, 0)).toBe(45);
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
