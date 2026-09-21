import { describe, expect, it } from "vitest";
import { cleanImpacts, impactKindOf, impactKindPatch } from "../impactKinds";
import type { LeverImpact } from "@/types";

const base: LeverImpact = { id: "a", label: "x", type: "cost", nature: "opex_rec", amount: 1 };
describe("impactKinds", () => {
  it("round-trips kinds", () => {
    for (const k of ["opex", "capex", "gain", "fte"] as const) {
      expect(impactKindOf({ ...base, ...impactKindPatch(k) })).toBe(k);
    }
  });
  it("cleans empty rows", () => {
    expect(cleanImpacts([base, { ...base, id: "b", label: "", amount: 0 }])).toHaveLength(1);
  });
});
