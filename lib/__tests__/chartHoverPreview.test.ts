import { describe, it, expect } from "vitest";
import {
  leverCellPreview,
  leversByField,
  mainLeverAlert,
  metricValueFormatter,
  pivotLeverRanking,
  sharePct,
  stagePreviews,
  summarizeLeverGroup,
} from "@/lib/chartHoverPreview";
import { leversInPivotCell, pivotByDimensions } from "@/lib/dashboardPivot";
import { marimekko2D, marimekko2DLevers, realizedSavings } from "@/lib/engine";
import type { Marimekko2DColumn } from "@/lib/engine";
import type { Alert, BeTrackData, Lever } from "@/types";

const baseLever: Lever = {
  id: "L001",
  code: "L001",
  programId: "p1",
  type: "Sourcing",
  name: "Levier 1",
  ws: "WS-01",
  owner: "O",
  ownerInit: "O",
  sponsor: "S",
  sponsorInit: "S",
  geography: "Europe",
  country: "France",
  entity: "Entity A",
  function: "Achats",
  costCenter: "CC01",
  pnlMap: "PNL01",
  start: "2026-01-01",
  end: "2026-12-31",
  status: "in_progress",
  progress: 50,
  risk: "low",
  grossSavings: 10,
  netSavings: 8,
  opexOneOff: 0,
  opexRec: 0,
  capex: 0,
  fteImpact: 0,
  dependencies: [],
  description: "",
  createdAt: "2026-01-01",
  lastUpdate: "2026-06-01",
  actions: [],
};

const lever = (over: Partial<Lever>): Lever => ({ ...baseLever, ...over });

function makeData(levers: Lever[]): BeTrackData {
  return {
    workstreams: [
      { id: "WS-01", name: "Chantier Un", sponsor: "S", function: "F", color: "#000", target: 1 },
      { id: "WS-02", name: "Chantier Deux", sponsor: "S", function: "F", color: "#000", target: 1 },
    ],
    pnlAccounts: [],
    levers,
  } as unknown as BeTrackData;
}

const alert = (over: Partial<Alert>): Alert => ({
  id: "A",
  type: "amber",
  ts: "2026-09-29",
  scope: "L001",
  title: "Alerte",
  desc: "",
  actorRole: "system",
  ...over,
});

describe("summarizeLeverGroup", () => {
  it("sums realized / reforecast / planned and keeps the 3 biggest levers by |value|", () => {
    const levers = [
      lever({ id: "A", code: "A", netSavings: 1 }),
      lever({ id: "B", code: "B", netSavings: -5 }),
      lever({ id: "C", code: "C", netSavings: 3 }),
      lever({ id: "D", code: "D", netSavings: 2 }),
      lever({ id: "E", code: "E", netSavings: 0 }),
    ];
    const s = summarizeLeverGroup(levers);
    expect(s.count).toBe(5);
    expect(s.reforecast).toBe(1);
    expect(s.planned).toBe(1);
    expect(s.realized).toBe(levers.reduce((acc, l) => acc + realizedSavings(l), 0));
    expect(s.top.map((l) => l.code)).toEqual(["B", "C", "D"]);
    expect(s.top[0].value).toBe(-5);
  });

  it("ranks with a custom metric and drops zero-valued levers", () => {
    const levers = [lever({ id: "A", fteImpact: 0 }), lever({ id: "B", fteImpact: 4 })];
    const s = summarizeLeverGroup(levers, (l) => l.fteImpact);
    expect(s.top).toEqual([{ id: "B", code: "L001", name: "Levier 1", value: 4 }]);
  });
});

describe("sharePct", () => {
  it("returns the percentage, or null for a zero total", () => {
    expect(sharePct(1, 4)).toBe(25);
    expect(sharePct(1, 0)).toBeNull();
  });
});

describe("stagePreviews", () => {
  it("values each stage at its reforecast net and computes the pipeline share without cancelled", () => {
    const data = makeData([
      lever({ id: "A", status: "in_progress", netSavings: 3 }),
      lever({ id: "B", status: "in_progress", netSavings: 1 }),
      lever({ id: "C", status: "delivered", netSavings: 4 }),
      lever({ id: "D", status: "cancelled", netSavings: 10 }),
    ]);
    const p = stagePreviews(data);
    expect(p.in_progress.count).toBe(2);
    expect(p.in_progress.value).toBe(4);
    expect(p.in_progress.pipelineShare).toBe(50);
    expect(p.delivered.pipelineShare).toBe(50);
    expect(p.cancelled.count).toBe(1);
    expect(p.cancelled.pipelineShare).toBeNull();
  });
});

describe("mainLeverAlert / leverCellPreview", () => {
  it("picks the most severe open alert, then the largest amount", () => {
    const alerts = [
      alert({ id: "1", type: "amber", impactEur: 900_000 }),
      alert({ id: "2", type: "red", impactEur: 10_000 }),
      alert({ id: "3", type: "red", impactEur: 50_000 }),
      alert({ id: "4", type: "red", impactEur: 9_000_000, resolved: true }),
      alert({ id: "5", type: "red", impactEur: 9_000_000, scope: "L999" }),
    ];
    expect(mainLeverAlert("L001", alerts)?.id).toBe("3");
    expect(mainLeverAlert("L002", alerts)).toBeUndefined();
  });

  it("aggregates engine values for a lever cell", () => {
    const l = lever({
      actions: [
        { id: "a1", name: "a", start: "2026-01-01", end: "2026-02-01", status: "done" },
        { id: "a2", name: "b", start: "2026-01-01", end: "2026-02-01", status: "todo" },
      ],
    });
    const p = leverCellPreview(l, [alert({ type: "red", impactEur: 600_000 })]);
    expect(p.actionCount).toBe(2);
    expect(p.actionProgress).toBe(50);
    expect(p.reforecast).toBe(8);
    expect(p.risk.level).toBe("critical");
    expect(p.mainAlert?.type).toBe("red");
  });
});

describe("group resolvers match the chart aggregations", () => {
  const data = makeData([
    lever({ id: "A", function: "Achats", country: "France", netSavings: 2 }),
    lever({ id: "B", function: "Achats", country: "Espagne", netSavings: 3 }),
    lever({ id: "C", function: "RH", country: "France", ws: "WS-02", netSavings: 1 }),
    lever({ id: "D", function: "Achats", country: "France", status: "cancelled" }),
  ]);

  it("marimekko2DLevers returns the levers behind each legacy segment", () => {
    const cols: Marimekko2DColumn[] = marimekko2D(data, "function-country");
    for (const col of cols) {
      expect(marimekko2DLevers(data, "function-country", col.key)).toHaveLength(
        col.segments.reduce((s, seg) => s + seg.count, 0)
      );
      for (const seg of col.segments)
        expect(marimekko2DLevers(data, "function-country", col.key, seg.key)).toHaveLength(
          seg.count
        );
    }
  });

  it("leversInPivotCell returns the levers behind each generic pivot cell", () => {
    const cols = pivotByDimensions(data, "netSavings", ["ws", "country"]) as Marimekko2DColumn[];
    expect(cols.length).toBeGreaterThan(0);
    for (const col of cols)
      for (const seg of col.segments)
        expect(leversInPivotCell(data, ["ws", "country"], [col.key, seg.key])).toHaveLength(
          seg.count
        );
    expect(leversInPivotCell(data, ["ws", "country"], ["Chantier Un"])).toHaveLength(2);
    expect(leversInPivotCell(data, ["unknown"], ["x"])).toEqual([]);
  });

  it("leversByField mirrors byCountry / byFunction (active levers only)", () => {
    expect(leversByField(data, "country", "France").map((l) => l.id)).toEqual(["A", "C"]);
    expect(leversByField(data, "function", "Achats").map((l) => l.id)).toEqual(["A", "B"]);
  });
});

describe("metric formatting", () => {
  it("formats counts, progress, FTE and amounts", () => {
    expect(metricValueFormatter("leverCount")(3.2)).toBe("3");
    expect(metricValueFormatter("progress")(42.4)).toMatch(/^42\s?%$/);
    expect(metricValueFormatter("netSavings")(1.5)).toMatch(/1[,.]5/);
  });

  it("ranks top levers by the metric, except lever count (reforecast net)", () => {
    expect(pivotLeverRanking("leverCount").rank).toBeUndefined();
    expect(pivotLeverRanking("fteImpact").rank?.(lever({ fteImpact: 7 }))).toBe(7);
    expect(pivotLeverRanking(undefined).rank).toBeUndefined();
  });
});
