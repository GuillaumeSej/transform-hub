import { describe, it, expect } from "vitest";
import {
  DASHBOARD_WIDGET_REGISTRY,
  buildDefaultLayout,
  moveWidget,
  cycleSpan,
  addWidget,
  removeWidget,
  setWidgetSpan,
  getWidgetDef,
} from "@/lib/dashboardWidgets";

describe("dashboardWidgets — buildDefaultLayout", () => {
  it("has one instance per registry entry, in registry order", () => {
    const layout = buildDefaultLayout();
    expect(layout).toHaveLength(DASHBOARD_WIDGET_REGISTRY.length);
    layout.forEach((w, i) => {
      expect(w.type).toBe(DASHBOARD_WIDGET_REGISTRY[i].type);
      expect(w.span).toBe(DASHBOARD_WIDGET_REGISTRY[i].defaultSpan);
    });
  });
});

describe("dashboardWidgets — moveWidget", () => {
  it("moves an item forward", () => {
    expect(moveWidget(["a", "b", "c", "d"], 0, 3)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item backward", () => {
    expect(moveWidget(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
  });

  it("is a no-op when indices are equal or out of range", () => {
    const list = ["a", "b", "c"];
    expect(moveWidget(list, 1, 1)).toBe(list);
    expect(moveWidget(list, -1, 2)).toBe(list);
    expect(moveWidget(list, 0, 5)).toBe(list);
  });

  it("does not mutate the original array", () => {
    const list = ["a", "b", "c"];
    moveWidget(list, 0, 2);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("dashboardWidgets — cycleSpan", () => {
  it("cycles S -> M -> L -> XL -> S when all sizes allowed", () => {
    const allowed = ["S", "M", "L", "XL"] as const;
    expect(cycleSpan("S", [...allowed])).toBe("M");
    expect(cycleSpan("M", [...allowed])).toBe("L");
    expect(cycleSpan("L", [...allowed])).toBe("XL");
    expect(cycleSpan("XL", [...allowed])).toBe("S");
  });

  it("skips disallowed sizes", () => {
    expect(cycleSpan("M", ["M", "XL"])).toBe("XL");
    expect(cycleSpan("XL", ["M", "XL"])).toBe("M");
  });
});

describe("dashboardWidgets — addWidget / removeWidget / setWidgetSpan", () => {
  it("adds a widget not already present, at the end, with its default span", () => {
    const layout = removeWidget(buildDefaultLayout(), "pnl");
    const next = addWidget(layout, "pnl");
    expect(next[next.length - 1]).toEqual({ instanceId: "pnl", type: "pnl", span: "M" });
  });

  it("does not add a duplicate of an already-present type", () => {
    const layout = buildDefaultLayout();
    expect(addWidget(layout, "pnl")).toBe(layout);
  });

  it("removeWidget filters by instanceId", () => {
    const layout = buildDefaultLayout();
    const next = removeWidget(layout, "alerts");
    expect(next.some((w) => w.instanceId === "alerts")).toBe(false);
    expect(next).toHaveLength(layout.length - 1);
  });

  it("setWidgetSpan updates only the targeted instance", () => {
    const layout = buildDefaultLayout();
    const next = setWidgetSpan(layout, "pnl", "XL");
    expect(next.find((w) => w.instanceId === "pnl")?.span).toBe("XL");
    expect(next.find((w) => w.instanceId === "alerts")?.span).toBe(
      layout.find((w) => w.instanceId === "alerts")?.span
    );
  });
});

describe("dashboardWidgets — getWidgetDef", () => {
  it("finds a known widget", () => {
    expect(getWidgetDef("s-curve")?.label).toContain("S-Curve");
  });

  it("returns undefined for an unknown type", () => {
    expect(getWidgetDef("does-not-exist")).toBeUndefined();
  });
});
