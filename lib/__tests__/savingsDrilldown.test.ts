import { describe, it, expect } from "vitest";
import {
  aggregateSegments,
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
      // Réactualisé = impacts (audit C3) : l'OPEX récurrent vient des impacts (2 + 1), plus du
      // snapshot enregistré ; l'impact sans nature tombe dans « Autres ».
      impacts: [
        { id: "1", label: "x", type: "cost", nature: "opex_rec", amount: 2, natureId: "lic" },
        { id: "3", label: "z", type: "cost", nature: "opex_rec", amount: 1 },
        { id: "2", label: "y", type: "saving", nature: "opex_rec", amount: 9 },
      ],
    } as Partial<Lever>);
    const [e] = buildDrilldownEntries("opexRec", [l], {
      natureLabel: (id) => (id === "lic" ? "Licences" : "?"),
      labels: { fte: "ETP", other: "Autres" },
    });
    expect(e.segments).toEqual([
      { key: "licences", label: "Licences", value: 2 },
      { key: "autres", label: "Autres", value: 1 },
    ]);
    expect(e.value).toBe(-3);
  });
  it("merges same-label segments and folds natureless impacts into one 'other'", () => {
    const mk = (
      id: string,
      imps: Partial<Lever["impacts"] extends (infer I)[] | undefined ? I : never>[]
    ) =>
      lever({
        id,
        reforecast: snap(10, 6),
        impacts: imps.map((x, i) => ({
          id: `${id}${i}`,
          label: "c",
          type: "cost",
          nature: "opex_rec",
          ...x,
        })),
      } as unknown as Partial<Lever>);
    const levers = [
      mk("P", [{ amount: 1, natureId: "a" }, { amount: 2 }, { amount: 1, technology: "SAP" }]),
      mk("Q", [{ amount: 1, natureId: "b" }, { amount: 1 }]),
    ];
    const entries = buildDrilldownEntries("opexRec", levers, {
      natureLabel: () => "Licences", // deux natures distinctes de même libellé
      labels: { fte: "ETP", other: "Non détaillé" },
    });
    const segs = aggregateSegments(entries);
    expect(segs.filter((x) => x.label === "Licences")).toHaveLength(1);
    expect(segs.filter((x) => x.label === "Non détaillé")).toHaveLength(1);
    expect(segs.find((x) => x.label === "SAP")?.value).toBe(1);
    // = OPEX récurrent total des impacts des 2 leviers (4 + 2) — réactualisé = impacts (audit C3).
    expect(segs.reduce((a, x) => a + x.value, 0)).toBeCloseTo(6, 5);
  });
});

describe("détail de la cascade = barres (audit lot 2, point 2)", () => {
  // P : réactualisé (flag `reforecast`), impacts nets 1,2 vs plan figé 1,0 → +0,2.
  // Q : PAS de flag `reforecast`, impacts nets 0,8 (1,3 − OPEX récurrent 0,5) vs plan 1,0 → −0,2 ;
  //     son plan figé porte un OPEX récurrent de 0,65 (périmé : les impacts disent 0,5).
  // C : abandonné, plan figé 0,4.
  const levers = [
    lever({
      id: "P",
      lockedPlan: snap(1),
      reforecast: snap(1),
      impacts: [{ id: "p1", label: "g", type: "saving", nature: "opex_rec", amount: 1.2 }],
    } as Partial<Lever>),
    lever({
      id: "Q",
      lockedPlan: snap(1, 0.65),
      impacts: [
        { id: "q1", label: "g", type: "saving", nature: "opex_rec", amount: 1.3 },
        { id: "q2", label: "o", type: "cost", nature: "opex_rec", amount: 0.5 },
      ],
    } as Partial<Lever>),
    lever({ id: "C", status: "cancelled", lockedPlan: snap(0.4) }),
  ];
  const w = savingsWaterfall({ levers } as unknown as BeTrackData);
  const detailOf = (step: Parameters<typeof buildDrilldownEntries>[0]) =>
    drilldownTotals(
      groupEntries(buildDrilldownEntries(step, levers), "workstream", {
        workstreams: [],
      })
    ).value;

  it("Σ du détail = barre, pour chaque étape", () => {
    expect(w.steps.find((s) => s.key === "reforecast")?.value).toBeCloseTo(0, 5);
    expect(w.opexRec).toBe(0.5);
    // Avant : détail réactualisé +0,2 (seuls les leviers flaggés) et OPEX récurrent −0,65 (plan
    // figé) pour des barres à 0,0 et −0,5.
    expect(detailOf("reforecast")).toBeCloseTo(w.reforecastDelta, 5);
    expect(detailOf("opexRec")).toBeCloseTo(-w.opexRec, 5);
    expect(detailOf("initial")).toBeCloseTo(w.initial, 5);
    expect(detailOf("cancelled")).toBeCloseTo(-w.cancelled, 5);
    expect(detailOf("target")).toBeCloseTo(w.target, 5);
    expect(detailOf("gross")).toBeCloseTo(w.gross, 5);
  });

  it("le delta réactualisé liste tous les leviers actifs qui s'écartent du plan figé", () => {
    const e = buildDrilldownEntries("reforecast", levers);
    expect(e.map((x) => [x.leverId, Math.round(x.value * 100) / 100])).toEqual([
      ["P", 0.2],
      ["Q", -0.2],
    ]);
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
