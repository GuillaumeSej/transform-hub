import { describe, expect, it } from "vitest";
import {
  approvalTargetHref,
  axisDetailHref,
  chantierHref,
  indicatorHref,
  leverLinkMode,
  planIndicatorDeepLink,
  projetHref,
} from "@/lib/strategicLinks";

const data = {
  axes: [{ id: "ax1" }],
  chantiers: [{ id: "ch1" }],
  chantierActions: [{ id: "p1", chantierId: "ch1" }],
  indicators: [{ id: "k1" }],
};

describe("strategic hrefs", () => {
  it("builds encoded deep links", () => {
    expect(axisDetailHref("a b")).toBe("/levers/detail?id=a%20b");
    expect(chantierHref("ch1")).toBe("/levers?chantier=ch1");
    expect(projetHref("ch1", "p1")).toBe("/levers?chantier=ch1&action=p1");
    expect(indicatorHref("k1")).toBe("/kpi?indicator=k1");
  });
});

describe("approvalTargetHref", () => {
  it("links each target type to its object", () => {
    expect(approvalTargetHref({ targetType: "axe", targetId: "ax1" }, data)).toBe(
      "/levers/detail?id=ax1"
    );
    expect(approvalTargetHref({ targetType: "chantier", targetId: "ch1" }, data)).toBe(
      "/levers?chantier=ch1"
    );
    expect(approvalTargetHref({ targetType: "projet", targetId: "p1" }, data)).toBe(
      "/levers?chantier=ch1&action=p1"
    );
    expect(approvalTargetHref({ targetType: "indicateur", targetId: "k1" }, data)).toBe(
      "/kpi?indicator=k1"
    );
  });

  it("returns null for objects not (yet / anymore) in the program", () => {
    expect(approvalTargetHref({ targetType: "axe", targetId: "new" }, data)).toBeNull();
    expect(approvalTargetHref({ targetType: "projet", targetId: "gone" }, data)).toBeNull();
    expect(approvalTargetHref({ targetType: "chantier", targetId: "" }, data)).toBeNull();
  });
});

describe("leverLinkMode", () => {
  it("navigates directly outside strategic mode", () => {
    expect(
      leverLinkMode({
        leverProgramId: "perf",
        activeProgramType: "performance",
        selectableProgramIds: [],
      })
    ).toEqual({ mode: "navigate" });
  });

  it("switches to the lever's program from a strategic program when selectable", () => {
    expect(
      leverLinkMode({
        leverProgramId: "perf",
        activeProgramType: "strategic",
        selectableProgramIds: ["perf", "strat"],
      })
    ).toEqual({ mode: "switch", programId: "perf" });
  });

  it("falls back to plain text when the lever's program cannot be selected", () => {
    expect(
      leverLinkMode({
        leverProgramId: "perf",
        activeProgramType: "strategic",
        selectableProgramIds: ["strat"],
      })
    ).toEqual({ mode: "text" });
    expect(
      leverLinkMode({
        leverProgramId: undefined,
        activeProgramType: "strategic",
        selectableProgramIds: ["strat"],
      })
    ).toEqual({ mode: "text" });
  });
});

describe("planIndicatorDeepLink", () => {
  it("reports indicators outside the loaded scope", () => {
    expect(
      planIndicatorDeepLink({ targetId: "x", scopeIds: ["k1"], filteredIds: ["k1"], view: "cards" })
    ).toEqual({ kind: "notFound" });
  });

  it("scrolls when the card is already visible", () => {
    expect(
      planIndicatorDeepLink({
        targetId: "k1",
        scopeIds: ["k1"],
        filteredIds: ["k1"],
        view: "cards",
      })
    ).toEqual({ kind: "scroll" });
  });

  it("clears filters and/or switches to cards when the card is hidden", () => {
    expect(
      planIndicatorDeepLink({ targetId: "k1", scopeIds: ["k1"], filteredIds: [], view: "cards" })
    ).toEqual({ kind: "reveal", clearFilters: true, switchToCards: false });
    expect(
      planIndicatorDeepLink({
        targetId: "k1",
        scopeIds: ["k1"],
        filteredIds: ["k1"],
        view: "table",
      })
    ).toEqual({ kind: "reveal", clearFilters: false, switchToCards: true });
  });
});
