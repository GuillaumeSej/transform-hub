import { describe, it, expect } from "vitest";
import {
  HR_WIDGET_REGISTRY,
  buildHrDefaultLayout,
  moveWidget,
  cycleSpan,
  addHrWidget,
  addHrWidgetWithCustomView,
  addCustomViewToHrInstance,
  removeHrWidget,
  setHrWidgetSpan,
  setHrWidgetView,
  getHrWidgetDef,
  resolveHrCustomViews,
  resolveHrActiveCustomView,
  type HrWidgetInstance,
} from "@/lib/hrDashboardWidgets";

describe("hrDashboardWidgets — buildHrDefaultLayout", () => {
  it("has one instance per registry entry, in registry order", () => {
    const layout = buildHrDefaultLayout();
    expect(layout).toHaveLength(HR_WIDGET_REGISTRY.length);
    layout.forEach((w, i) => {
      expect(w.type).toBe(HR_WIDGET_REGISTRY[i].type);
      expect(w.span).toBe(HR_WIDGET_REGISTRY[i].defaultSpan);
    });
  });

  it("seeds defaultCustomViews for builder-enabled widget types", () => {
    const layout = buildHrDefaultLayout();
    const dept = layout.find((w) => w.type === "department-breakdown")!;
    expect(dept.customViews).toHaveLength(1);
    expect(dept.view).toBe("detail");
    const country = layout.find((w) => w.type === "country-breakdown")!;
    expect(country.view).toBe("country");
  });

  it("non-builder widgets have no customViews field", () => {
    const layout = buildHrDefaultLayout();
    expect(layout.find((w) => w.type === "fte-waterfall")?.customViews).toBeUndefined();
    expect(layout.find((w) => w.type === "department-table")?.customViews).toBeUndefined();
  });
});

// moveWidget / cycleSpan sont réimportés tels quels depuis lib/dashboardWidgets.ts (déjà couverts
// par lib/__tests__/dashboardWidgets.test.ts) — un test de fumée suffit ici pour vérifier qu'ils
// fonctionnent bien avec des types RH.
describe("hrDashboardWidgets — moveWidget / cycleSpan (réimportés)", () => {
  it("moveWidget reorders HR widget instances", () => {
    const layout = buildHrDefaultLayout();
    const next = moveWidget(layout, 0, 2);
    expect(next[0].type).toBe(layout[1].type);
  });

  it("cycleSpan cycles within the allowed sizes", () => {
    expect(cycleSpan("M", ["M", "XL"])).toBe("XL");
  });
});

describe("hrDashboardWidgets — addHrWidget / removeHrWidget / setHrWidgetSpan", () => {
  it("adds a widget not already present, at the end, with its default span", () => {
    const layout = removeHrWidget(buildHrDefaultLayout(), "pse-summary");
    const next = addHrWidget(layout, "pse-summary");
    const added = next[next.length - 1];
    expect(added.type).toBe("pse-summary");
    expect(added.span).toBe("M");
  });

  it("allows adding a duplicate of an already-present type, with a distinct instanceId", () => {
    const layout = buildHrDefaultLayout();
    const next = addHrWidget(layout, "pse-summary");
    expect(next).toHaveLength(layout.length + 1);
    const dup = next.filter((w) => w.type === "pse-summary");
    expect(dup).toHaveLength(2);
    expect(dup[0].instanceId).not.toBe(dup[1].instanceId);
  });

  it("returns the same array reference for an unknown widget type", () => {
    const layout = buildHrDefaultLayout();
    expect(addHrWidget(layout, "not-a-real-type" as never)).toBe(layout);
  });

  it("removeHrWidget filters by instanceId", () => {
    const layout = buildHrDefaultLayout();
    const next = removeHrWidget(layout, "fte-waterfall");
    expect(next.some((w) => w.instanceId === "fte-waterfall")).toBe(false);
    expect(next).toHaveLength(layout.length - 1);
  });

  it("setHrWidgetSpan updates only the targeted instance", () => {
    const layout = buildHrDefaultLayout();
    const next = setHrWidgetSpan(layout, "pse-summary", "XL");
    expect(next.find((w) => w.instanceId === "pse-summary")?.span).toBe("XL");
    expect(next.find((w) => w.instanceId === "fte-waterfall")?.span).toBe(
      layout.find((w) => w.instanceId === "fte-waterfall")?.span
    );
  });

  it("setHrWidgetView updates only the targeted instance", () => {
    const layout = buildHrDefaultLayout();
    const next = setHrWidgetView(layout, "country-breakdown", "some-other-view");
    expect(next.find((w) => w.instanceId === "country-breakdown")?.view).toBe("some-other-view");
    expect(next.find((w) => w.instanceId === "department-breakdown")?.view).toBe(
      layout.find((w) => w.instanceId === "department-breakdown")?.view
    );
  });
});

describe("hrDashboardWidgets — builder générique (customViews)", () => {
  it("addHrWidgetWithCustomView creates a fresh instance with exactly the requested view", () => {
    const layout = buildHrDefaultLayout();
    const next = addHrWidgetWithCustomView(layout, "department-breakdown", {
      metric: "netFirstYearImpact",
      dimension: "hrOwner",
      label: "Impact net par owner RH",
    });
    const added = next[next.length - 1];
    expect(added.type).toBe("department-breakdown");
    expect(added.customViews).toHaveLength(1);
    expect(added.customViews?.[0].metric).toBe("netFirstYearImpact");
    expect(added.customViews?.[0].dimension).toBe("hrOwner");
    expect(added.view).toBe(added.customViews?.[0].id);
  });

  it("addCustomViewToHrInstance appends a view to an existing instance and switches to it", () => {
    const layout = buildHrDefaultLayout();
    const deptId = layout.find((w) => w.type === "department-breakdown")!.instanceId;
    const next = addCustomViewToHrInstance(layout, deptId, {
      metric: "movementCount",
      dimension: "status",
    });
    const updated = next.find((w) => w.instanceId === deptId)!;
    expect(updated.customViews).toHaveLength(2);
    expect(updated.view).toBe(updated.customViews?.[1].id);
    const country = next.find((w) => w.type === "country-breakdown")!;
    expect(country.customViews).toHaveLength(1);
  });

  it("addCustomViewToHrInstance materializes legacy defaultCustomViews first if the instance had none", () => {
    const layout: HrWidgetInstance[] = [
      { instanceId: "country-breakdown", type: "country-breakdown", span: "M", view: "country" },
    ];
    const next = addCustomViewToHrInstance(layout, "country-breakdown", {
      metric: "salarySavings",
      dimension: "department",
    });
    const updated = next[0];
    expect(updated.customViews).toHaveLength(2);
    expect(updated.customViews?.[0].id).toBe("country");
    expect(updated.view).toBe(updated.customViews?.[1].id);
  });

  it("resolveHrCustomViews falls back to registry defaults when the instance has none", () => {
    const instance: HrWidgetInstance = {
      instanceId: "country-breakdown",
      type: "country-breakdown",
      span: "M",
      view: "country",
    };
    expect(resolveHrCustomViews(instance)).toHaveLength(1);
  });

  it("resolveHrActiveCustomView resolves by id, falling back to the first available view", () => {
    const layout = buildHrDefaultLayout();
    const dept = layout.find((w) => w.type === "department-breakdown")!;
    expect(resolveHrActiveCustomView(dept)?.id).toBe("detail");
    const unknownView = { ...dept, view: "does-not-exist" };
    expect(resolveHrActiveCustomView(unknownView)?.id).toBe("detail");
  });

  it("non-builder widgets resolve to no custom views", () => {
    const layout = buildHrDefaultLayout();
    const waterfall = layout.find((w) => w.type === "fte-waterfall")!;
    expect(resolveHrCustomViews(waterfall)).toEqual([]);
    expect(resolveHrActiveCustomView(waterfall)).toBeUndefined();
  });
});

describe("hrDashboardWidgets — getHrWidgetDef", () => {
  it("finds a known widget", () => {
    expect(getHrWidgetDef("fte-waterfall")?.label).toContain("Trajectoire");
  });

  it("returns undefined for an unknown type", () => {
    expect(getHrWidgetDef("does-not-exist")).toBeUndefined();
  });
});
