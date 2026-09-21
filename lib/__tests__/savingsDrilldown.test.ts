import { describe, it, expect } from "vitest";
import {
  buildDrilldownEntries,
  drilldownTotals,
  geographyGroupNode,
  groupEntries,
  UNATTRIBUTED_GROUP_ID,
} from "@/lib/savingsDrilldown";
import { savingsWaterfall } from "@/lib/engine";
import { savingsTriple } from "@/lib/dashboardSavings";
import type { BeTrackData, HierarchyLevelDef, HierarchyNode, Lever } from "@/types";

const snap = (net: number, opexRec = 0) => ({
  grossSavings: net,
  netSavings: net,
  opexOneOff: 0,
  opexRec,
  capex: 0,
});
const lever = (o: Partial<Lever>): Lever =>
  ({
    id: "L",
    name: "Lever",
    ws: "w1",
    status: "in_progress",
    netSavings: 10,
    opexRec: 0,
    progress: 50,
    lockedPlan: snap(10),
    ...o,
  }) as unknown as Lever;

const levels: HierarchyLevelDef[] = [
  { key: "region", label: "Région", order: 0 },
  { key: "country", label: "Pays", order: 1 },
  { key: "site", label: "Site", order: 2 },
];
const node = (id: string, levelKey: string, parentId: string | null): HierarchyNode => ({
  id,
  companyId: "c",
  levelKey,
  code: id,
  label: id.toUpperCase(),
  parentId,
  domain: "geographic",
});
const nodes = [
  node("emea", "region", null),
  node("fr", "country", "emea"),
  node("paris", "site", "fr"),
  node("de", "country", "emea"),
  node("apac", "region", null),
];

describe("buildDrilldownEntries", () => {
  const levers = [
    lever({ id: "A", ws: "w1", reforecast: snap(12, 2) }),
    lever({ id: "B", ws: "w2" }),
    lever({ id: "C", ws: "w2", status: "cancelled", lockedPlan: snap(4) }),
  ];
  it("reforecast keeps only reforecast levers with before/after", () => {
    const e = buildDrilldownEntries("reforecast", levers);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ leverId: "A", before: 10, after: 12, value: 2 });
  });
  it("cancelled keeps only cancelled levers, initial keeps all", () => {
    expect(buildDrilldownEntries("cancelled", levers).map((e) => e.leverId)).toEqual(["C"]);
    expect(buildDrilldownEntries("initial", levers)).toHaveLength(3);
  });
  it("target totals equal savingsTriple / engine waterfall", () => {
    const e = buildDrilldownEntries("target", levers);
    const t = savingsTriple(levers);
    const tot = drilldownTotals(groupEntries(e, "workstream", { workstreams: [] }));
    expect(tot.after).toBe(t.reforecast);
    expect(tot.realized).toBe(t.realized);
    const w = savingsWaterfall({ levers } as unknown as BeTrackData);
    expect(w.target).toBe(t.reforecast);
    expect(w.realized).toBe(t.realized);
  });
  it("opexRec segments by nature, remainder in other", () => {
    const l = lever({
      id: "O",
      reforecast: snap(10, 3),
      impacts: [
        { id: "1", label: "x", type: "cost", nature: "opex_rec", amount: 2, natureId: "lic" },
        { id: "2", label: "y", type: "saving", nature: "opex_rec", amount: 9 },
      ],
    } as Partial<Lever>);
    const [e] = buildDrilldownEntries("opexRec", [l], {
      natureLabel: (id) => (id === "lic" ? "Licences" : "?"),
      labels: { fte: "ETP", other: "Autres" },
    });
    expect(e.segments).toEqual([
      { key: "n:lic", label: "Licences", value: 2 },
      { key: "other", label: "Autres", value: 1 },
    ]);
    expect(e.value).toBe(-3);
  });
});

describe("geography grouping", () => {
  it("resolves ancestor at level, leaf if more macro, null if unattached", () => {
    expect(geographyGroupNode("paris", "country", nodes, levels)?.id).toBe("fr");
    expect(geographyGroupNode("paris", "region", nodes, levels)?.id).toBe("emea");
    expect(geographyGroupNode("emea", "site", nodes, levels)?.id).toBe("emea");
    expect(geographyGroupNode(undefined, "region", nodes, levels)).toBeNull();
  });
  it("groups by level and preserves totals", () => {
    const levers = [
      lever({ id: "A", geographyLeafId: "paris" }),
      lever({ id: "B", geographyLeafId: "de" }),
      lever({ id: "C" }),
    ];
    const e = buildDrilldownEntries("initial", levers);
    const byRegion = groupEntries(e, "geography", {
      workstreams: [],
      geographyLevels: levels,
      geographyNodes: nodes,
      geographyLevelKey: "region",
    });
    expect(byRegion.find((g) => g.id === "emea")?.value).toBe(20);
    expect(byRegion[byRegion.length - 1].id).toBe(UNATTRIBUTED_GROUP_ID);
    const byCountry = groupEntries(e, "geography", {
      workstreams: [],
      geographyLevels: levels,
      geographyNodes: nodes,
      geographyLevelKey: "country",
    });
    expect(byCountry.map((g) => g.id).sort()).toEqual([UNATTRIBUTED_GROUP_ID, "de", "fr"].sort());
    expect(drilldownTotals(byCountry).value).toBe(30);
  });
});
