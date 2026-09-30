import { describe, it, expect } from "vitest";
import { leverGapContributors, topContributors, waterfallStepSummary } from "@/lib/chartPreview";
import type { SavingsWaterfall } from "@/lib/engine";

const wf: SavingsWaterfall = {
  steps: [
    { key: "initial", label: "", kind: "total", value: 20, cumulative: 20 },
    { key: "reforecast", label: "", kind: "delta", value: -3, cumulative: 17 },
    { key: "cancelled", label: "", kind: "delta", value: -2, cumulative: 15 },
    { key: "target", label: "", kind: "total", value: 15, cumulative: 15 },
    { key: "gross", label: "", kind: "total", value: 18, cumulative: 18 },
    { key: "opexRec", label: "", kind: "delta", value: -3, cumulative: 15 },
    { key: "net", label: "", kind: "total", value: 15, cumulative: 15 },
  ],
  initial: 20,
  reforecastDelta: -3,
  cancelled: 2,
  target: 15,
  realized: 6,
  remaining: 9,
  gross: 18,
  opexRec: 3,
} as SavingsWaterfall;

describe("topContributors", () => {
  it("trie par valeur absolue, ignore les montants négligeables et limite à n", () => {
    const out = topContributors(
      [
        { id: "a", value: 1 },
        { id: "b", value: -4 },
        { id: "c", value: 0.01 },
        { id: "d", value: 2 },
        { id: "e", value: 3 },
      ],
      3
    );
    expect(out.map((x) => x.id)).toEqual(["b", "e", "d"]);
  });
  it("ne modifie pas le tableau d'entrée", () => {
    const input = [{ value: 1 }, { value: 5 }];
    topContributors(input);
    expect(input.map((x) => x.value)).toEqual([1, 5]);
  });
});

describe("waterfallStepSummary", () => {
  it("étape delta du groupe plan : avant → après et part du planifié initial", () => {
    expect(waterfallStepSummary(wf, "reforecast")).toEqual({
      kind: "delta",
      value: -3,
      before: 20,
      after: 17,
      share: -0.15,
      shareBase: "initial",
    });
    expect(waterfallStepSummary(wf, "cancelled")).toMatchObject({ before: 17, after: 15 });
  });
  it("OPEX récurrent : du brut au net, part du gain brut", () => {
    const s = waterfallStepSummary(wf, "opexRec")!;
    expect(s.before).toBe(18);
    expect(s.after).toBe(15);
    expect(s.shareBase).toBe("gross");
    expect(s.share).toBeCloseTo(-3 / 18);
  });
  it("totaux : pas de « avant », pas de part pour la référence elle-même", () => {
    expect(waterfallStepSummary(wf, "initial")).toMatchObject({ before: null, share: null });
    expect(waterfallStepSummary(wf, "gross")).toMatchObject({ before: null, share: null });
    expect(waterfallStepSummary(wf, "target")!.share).toBe(0.75);
    expect(waterfallStepSummary(wf, "net")!.share).toBeCloseTo(15 / 18);
  });
  it("étape inconnue (séparateur) → null", () => {
    expect(waterfallStepSummary(wf, "gap")).toBeNull();
  });
});

describe("leverGapContributors", () => {
  it("écart réalisé − réactualisé par levier, trié par importance", () => {
    const out = leverGapContributors({
      target: [
        { name: "A", value: 5 },
        { name: "B", value: 2 },
        { name: "C", value: 1 },
      ],
      realized: [
        { name: "A", value: 4 },
        { name: "B", value: 0 },
        { name: "C", value: 1 },
        { name: "D", value: 0.5 },
      ],
    });
    expect(out).toEqual([
      { id: "B", name: "B", value: -2 },
      { id: "A", name: "A", value: -1 },
      { id: "D", name: "D", value: 0.5 },
    ]);
  });
  it("sans détail par levier → liste vide", () => {
    expect(leverGapContributors(undefined)).toEqual([]);
  });
});
