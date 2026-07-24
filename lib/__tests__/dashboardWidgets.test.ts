import { describe, it, expect } from "vitest";
import {
  DASHBOARD_WIDGET_REGISTRY,
  buildDefaultLayout,
  moveWidget,
  cycleSpan,
  addWidget,
  addWidgetWithCustomView,
  addCustomViewToInstance,
  removeWidget,
  setWidgetSpan,
  setWidgetView,
  getWidgetDef,
  resolveCustomViews,
  resolveActiveCustomView,
  type DashboardWidgetInstance,
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
    const added = next[next.length - 1];
    expect(added.type).toBe("pnl");
    expect(added.span).toBe("M");
  });

  it("allows adding a duplicate of an already-present type, with a distinct instanceId", () => {
    const layout = buildDefaultLayout();
    const next = addWidget(layout, "pnl");
    expect(next).toHaveLength(layout.length + 1);
    const pnlInstances = next.filter((w) => w.type === "pnl");
    expect(pnlInstances).toHaveLength(2);
    expect(pnlInstances[0].instanceId).not.toBe(pnlInstances[1].instanceId);
  });

  it("returns the same array reference for an unknown widget type", () => {
    const layout = buildDefaultLayout();
    expect(addWidget(layout, "not-a-real-type" as never)).toBe(layout);
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

describe("dashboardWidgets — configurable widgets (view)", () => {
  it("buildDefaultLayout sets the default view for configurable widgets", () => {
    const layout = buildDefaultLayout();
    expect(layout.find((w) => w.type === "marimekko")?.view).toBe("function-country");
    expect(layout.find((w) => w.type === "geo-breakdown")?.view).toBe("country");
    expect(layout.find((w) => w.type === "workstream-breakdown")?.view).toBe("workstream");
  });

  it("non-configurable widgets have no view field", () => {
    const layout = buildDefaultLayout();
    expect(layout.find((w) => w.type === "sankey")?.view).toBeUndefined();
  });

  it("addWidget sets the requested view, or the default when omitted", () => {
    const layout = buildDefaultLayout();
    const withDefault = addWidget(layout, "marimekko");
    expect(withDefault[withDefault.length - 1].view).toBe("function-country");
    const withExplicit = addWidget(layout, "marimekko", "workstream-project");
    expect(withExplicit[withExplicit.length - 1].view).toBe("workstream-project");
  });

  it("setWidgetView updates only the targeted instance", () => {
    const layout = buildDefaultLayout();
    const next = setWidgetView(layout, "marimekko", "workstream-project");
    expect(next.find((w) => w.instanceId === "marimekko")?.view).toBe("workstream-project");
    expect(next.find((w) => w.instanceId === "geo-breakdown")?.view).toBe(
      layout.find((w) => w.instanceId === "geo-breakdown")?.view
    );
  });
});

describe("dashboardWidgets — builder générique (customViews)", () => {
  it("buildDefaultLayout seeds defaultCustomViews for builder widget types", () => {
    const layout = buildDefaultLayout();
    const marimekko = layout.find((w) => w.type === "marimekko")!;
    expect(marimekko.customViews).toHaveLength(2);
    expect(marimekko.customViews?.map((v) => v.id)).toEqual([
      "function-country",
      "workstream-project",
    ]);
    const pnl = layout.find((w) => w.type === "pnl")!;
    expect(pnl.customViews).toHaveLength(1);
    expect(pnl.view).toBe("account");
  });

  it("non-builder widgets have no customViews field", () => {
    const layout = buildDefaultLayout();
    expect(layout.find((w) => w.type === "sankey")?.customViews).toBeUndefined();
  });

  it("addWidgetWithCustomView creates a fresh instance with exactly the requested view", () => {
    const layout = buildDefaultLayout();
    const next = addWidgetWithCustomView(layout, "marimekko", {
      metric: "fteImpact",
      dimensions: ["type", "risk"],
      label: "Impact ETP par type × risque",
    });
    const added = next[next.length - 1];
    expect(added.type).toBe("marimekko");
    expect(added.customViews).toHaveLength(1);
    expect(added.customViews?.[0].metric).toBe("fteImpact");
    expect(added.customViews?.[0].dimensions).toEqual(["type", "risk"]);
    expect(added.view).toBe(added.customViews?.[0].id);
  });

  it("addCustomViewToInstance appends a view to an existing instance and switches to it", () => {
    const layout = buildDefaultLayout();
    const marimekkoId = layout.find((w) => w.type === "marimekko")!.instanceId;
    const next = addCustomViewToInstance(layout, marimekkoId, {
      metric: "leverCount",
      dimensions: ["owner", "sponsor"],
    });
    const updated = next.find((w) => w.instanceId === marimekkoId)!;
    expect(updated.customViews).toHaveLength(3);
    expect(updated.view).toBe(updated.customViews?.[2].id);
    // Les autres instances ne sont pas affectées.
    const geo = next.find((w) => w.type === "geo-breakdown")!;
    expect(geo.customViews).toHaveLength(2);
  });

  it("addCustomViewToInstance materializes legacy defaultCustomViews first if the instance had none", () => {
    const layout: DashboardWidgetInstance[] = [
      { instanceId: "marimekko", type: "marimekko", span: "M", view: "function-country" },
    ];
    const next = addCustomViewToInstance(layout, "marimekko", {
      metric: "capex",
      dimensions: ["country", "function"],
    });
    const updated = next[0];
    expect(updated.customViews).toHaveLength(3);
    expect(updated.customViews?.[0].id).toBe("function-country");
    expect(updated.view).toBe(updated.customViews?.[2].id);
  });

  it("resolveCustomViews falls back to registry defaults when the instance has none", () => {
    const instance: DashboardWidgetInstance = {
      instanceId: "geo-breakdown",
      type: "geo-breakdown",
      span: "M",
      view: "country",
    };
    expect(resolveCustomViews(instance)).toHaveLength(2);
  });

  it("resolveActiveCustomView resolves by id, falling back to the first available view", () => {
    const layout = buildDefaultLayout();
    const marimekko = layout.find((w) => w.type === "marimekko")!;
    expect(resolveActiveCustomView(marimekko)?.id).toBe("function-country");
    const unknownView = { ...marimekko, view: "does-not-exist" };
    expect(resolveActiveCustomView(unknownView)?.id).toBe("function-country");
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
