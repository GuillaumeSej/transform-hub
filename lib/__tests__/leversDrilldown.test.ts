import { describe, expect, it } from "vitest";
import { leversDrilldownParams, leversFilterParamForDimension } from "@/lib/leversDrilldown";

const none = { financial: false, geographic: false };
const both = { financial: true, geographic: true };

describe("leversFilterParamForDimension", () => {
  it("maps plain dimensions to their f_ key", () => {
    expect(leversFilterParamForDimension("status", none)).toBe("f_status");
    expect(leversFilterParamForDimension("ws", both)).toBe("f_ws");
  });

  it("legacy geography keys only without a geographic hierarchy", () => {
    expect(leversFilterParamForDimension("geography", none)).toBe("f_geography");
    expect(leversFilterParamForDimension("country", both)).toBeUndefined();
  });

  it("P&L account ↔ financial hierarchy levels", () => {
    expect(leversFilterParamForDimension("pnlAccount", none)).toBe("f_pnl");
    expect(leversFilterParamForDimension("pnlAccount", both)).toBeUndefined();
    expect(leversFilterParamForDimension("hierarchy:macro", both)).toBe("f_hierarchy_macro");
    expect(leversFilterParamForDimension("hierarchy:macro", none)).toBeUndefined();
  });

  it("unknown dimensions → no filter", () => {
    expect(leversFilterParamForDimension("lever", none)).toBeUndefined();
    expect(leversFilterParamForDimension("program", none)).toBeUndefined();
  });
});

describe("leversDrilldownParams", () => {
  it("drops pivot fallback labels", () => {
    expect(leversDrilldownParams("owner", "Non renseigné", none)).toEqual({});
    expect(leversDrilldownParams("owner", "Alice", none)).toEqual({ f_owner: "Alice" });
  });
});
