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
  migrateInitiativeHealthWidget,
  reorderInitiativeHealthWidget,
  migrateEconomiesSectionLayout,
  type DashboardWidgetInstance,
} from "@/lib/dashboardWidgets";

describe("dashboardWidgets — buildDefaultLayout", () => {
  it("has one instance per non-excluded registry entry, in registry order", () => {
    const layout = buildDefaultLayout();
    const includedDefs = DASHBOARD_WIDGET_REGISTRY.filter((d) => !d.excludeFromDefault);
    expect(layout).toHaveLength(includedDefs.length);
    layout.forEach((w, i) => {
      expect(w.type).toBe(includedDefs[i].type);
      expect(w.span).toBe(includedDefs[i].defaultSpan);
    });
  });

  it("includes initiative health with a persisted per-instance grouping view", () => {
    const widget = buildDefaultLayout().find((w) => w.type === "initiative-health");
    expect(widget).toMatchObject({ view: "workstream", span: "XL" });
  });

  it("excludeFromDefault widgets are still in the registry (available in picker)", () => {
    const excluded = DASHBOARD_WIDGET_REGISTRY.filter((d) => d.excludeFromDefault);
    expect(excluded.length).toBeGreaterThan(0);
    const layout = buildDefaultLayout();
    excluded.forEach((d) => {
      expect(layout.find((w) => w.type === d.type)).toBeUndefined();
    });
  });
});

describe("dashboardWidgets — initiative health layout migration", () => {
  it("adds the widget once to a legacy layout", () => {
    const legacy = buildDefaultLayout().filter((w) => w.type !== "initiative-health");
    const migrated = migrateInitiativeHealthWidget(legacy, false);
    expect(migrated.filter((w) => w.type === "initiative-health")).toHaveLength(1);
  });

  it("does not re-add a widget deliberately removed after migration", () => {
    const legacy = buildDefaultLayout().filter((w) => w.type !== "initiative-health");
    expect(migrateInitiativeHealthWidget(legacy, true)).toBe(legacy);
  });
});

describe("dashboardWidgets — initiative health reorder migration", () => {
  /** Helper : produit un layout hypothétique où `initiative-health` est en dernière position,
   *  reproduisant l'état des layouts persistés avant Août 2026 (avant la remontée en position 3). */
  const legacyOrder = (): DashboardWidgetInstance[] => {
    const layout = buildDefaultLayout();
    const initiativeHealth = layout.find((w) => w.type === "initiative-health")!;
    const withoutIt = layout.filter((w) => w.type !== "initiative-health");
    return [...withoutIt, initiativeHealth];
  };

  it("moves initiative-health right after 'risk-center'", () => {
    const before = legacyOrder();
    const after = reorderInitiativeHealthWidget(before, false);
    const alertsIdx = after.findIndex((w) => w.type === "risk-center");
    const healthIdx = after.findIndex((w) => w.type === "initiative-health");
    expect(healthIdx).toBe(alertsIdx + 1);
    // Aucun widget perdu ni dupliqué
    expect(after).toHaveLength(before.length);
    expect(after.filter((w) => w.type === "initiative-health")).toHaveLength(1);
  });

  it("is a no-op when the migration has already been applied", () => {
    const before = legacyOrder();
    expect(reorderInitiativeHealthWidget(before, true)).toBe(before);
  });

  it("does not reintroduce initiative-health if the user has removed it", () => {
    const legacy = buildDefaultLayout().filter((w) => w.type !== "initiative-health");
    const after = reorderInitiativeHealthWidget(legacy, false);
    expect(after.find((w) => w.type === "initiative-health")).toBeUndefined();
    expect(after).toBe(legacy);
  });

  it("falls back to 'portfolio-funnel' when 'risk-center' has been removed", () => {
    const before = legacyOrder().filter((w) => w.type !== "risk-center");
    const after = reorderInitiativeHealthWidget(before, false);
    const funnelIdx = after.findIndex((w) => w.type === "portfolio-funnel");
    const healthIdx = after.findIndex((w) => w.type === "initiative-health");
    expect(healthIdx).toBe(funnelIdx + 1);
  });

  it("does not move initiative-health if neither 'risk-center' nor 'portfolio-funnel' is present", () => {
    const before: DashboardWidgetInstance[] = [
      { instanceId: "s-curve", type: "s-curve", span: "M" },
      {
        instanceId: "initiative-health",
        type: "initiative-health",
        span: "XL",
        view: "workstream",
      },
    ];
    const after = reorderInitiativeHealthWidget(before, false);
    expect(after).toBe(before);
  });
});

describe("dashboardWidgets — economies section migration", () => {
  /** Helper : produit un layout hypothétique reproduisant l'état persisté avant Sept 2026 —
   *  `portfolio-funnel` et `marimekko` en span "M", `marimekko` juste après `portfolio-funnel`
   *  (avant que `initiative-health` ne soit inséré entre les deux). */
  const legacyEconomiesLayout = (): DashboardWidgetInstance[] => {
    const layout = buildDefaultLayout();
    const marimekko = layout.find((w) => w.type === "marimekko")!;
    const withoutMarimekko = layout
      .filter((w) => w.type !== "marimekko")
      .map((w) => (w.type === "portfolio-funnel" ? { ...w, span: "M" as const } : w));
    const funnelIdx = withoutMarimekko.findIndex((w) => w.type === "portfolio-funnel");
    return [
      ...withoutMarimekko.slice(0, funnelIdx + 1),
      { ...marimekko, span: "M" as const },
      ...withoutMarimekko.slice(funnelIdx + 1),
    ];
  };

  it("widens portfolio-funnel and marimekko to XL and repositions marimekko after initiative-health", () => {
    const before = legacyEconomiesLayout();
    const after = migrateEconomiesSectionLayout(before, false);
    expect(after.find((w) => w.type === "portfolio-funnel")?.span).toBe("XL");
    expect(after.find((w) => w.type === "marimekko")?.span).toBe("XL");
    const healthIdx = after.findIndex((w) => w.type === "initiative-health");
    const marimekkoIdx = after.findIndex((w) => w.type === "marimekko");
    expect(marimekkoIdx).toBe(healthIdx + 1);
    // Aucun widget perdu ni dupliqué
    expect(after).toHaveLength(before.length);
  });

  it("is a no-op when the migration has already been applied", () => {
    const before = legacyEconomiesLayout();
    expect(migrateEconomiesSectionLayout(before, true)).toBe(before);
  });

  it("does not override a manually-chosen span other than M", () => {
    const before = legacyEconomiesLayout().map((w) =>
      w.type === "portfolio-funnel" ? { ...w, span: "L" as const } : w
    );
    const after = migrateEconomiesSectionLayout(before, false);
    expect(after.find((w) => w.type === "portfolio-funnel")?.span).toBe("L");
  });

  it("falls back to positioning marimekko before savings-trajectory when initiative-health is absent", () => {
    const before = legacyEconomiesLayout().filter((w) => w.type !== "initiative-health");
    const after = migrateEconomiesSectionLayout(before, false);
    const trajectoryIdx = after.findIndex((w) => w.type === "savings-trajectory");
    const marimekkoIdx = after.findIndex((w) => w.type === "marimekko");
    expect(marimekkoIdx).toBe(trajectoryIdx - 1);
  });

  it("leaves marimekko's position unchanged (span-only fix) when neither anchor is present", () => {
    const before: DashboardWidgetInstance[] = [
      { instanceId: "s-curve", type: "s-curve", span: "M" },
      { instanceId: "marimekko", type: "marimekko", span: "M", view: "function-country" },
    ];
    const after = migrateEconomiesSectionLayout(before, false);
    expect(after.map((w) => w.type)).toEqual(["s-curve", "marimekko"]);
    expect(after.find((w) => w.type === "marimekko")?.span).toBe("XL");
  });

  it("returns the layout unchanged (aside from the funnel span fix) when marimekko is absent", () => {
    const before = legacyEconomiesLayout().filter((w) => w.type !== "marimekko");
    const after = migrateEconomiesSectionLayout(before, false);
    expect(after.find((w) => w.type === "portfolio-funnel")?.span).toBe("XL");
    expect(after.find((w) => w.type === "marimekko")).toBeUndefined();
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
    const layout = removeWidget(buildDefaultLayout(), "workstream-table");
    const next = addWidget(layout, "workstream-table");
    const added = next[next.length - 1];
    expect(added.type).toBe("workstream-table");
    expect(added.span).toBe("XL");
  });

  it("allows adding a duplicate of an already-present type, with a distinct instanceId", () => {
    const layout = buildDefaultLayout();
    const next = addWidget(layout, "workstream-table");
    expect(next).toHaveLength(layout.length + 1);
    const wtInstances = next.filter((w) => w.type === "workstream-table");
    expect(wtInstances).toHaveLength(2);
    expect(wtInstances[0].instanceId).not.toBe(wtInstances[1].instanceId);
  });

  it("returns the same array reference for an unknown widget type", () => {
    const layout = buildDefaultLayout();
    expect(addWidget(layout, "not-a-real-type" as never)).toBe(layout);
  });

  it("removeWidget filters by instanceId", () => {
    const layout = buildDefaultLayout();
    const next = removeWidget(layout, "risk-center");
    expect(next.some((w) => w.instanceId === "risk-center")).toBe(false);
    expect(next).toHaveLength(layout.length - 1);
  });

  it("setWidgetSpan updates only the targeted instance", () => {
    const layout = buildDefaultLayout();
    const next = setWidgetSpan(layout, "workstream-table", "L");
    expect(next.find((w) => w.instanceId === "workstream-table")?.span).toBe("L");
    expect(next.find((w) => w.instanceId === "risk-center")?.span).toBe(
      layout.find((w) => w.instanceId === "risk-center")?.span
    );
  });
});

describe("dashboardWidgets — configurable widgets (view)", () => {
  it("buildDefaultLayout sets the default view for configurable widgets", () => {
    const layout = buildDefaultLayout();
    expect(layout.find((w) => w.type === "marimekko")?.view).toBe("function-country");
    expect(layout.find((w) => w.type === "workstream-breakdown")?.view).toBe("workstream");
    // geo-breakdown is excludeFromDefault — not in default layout but still in registry
    expect(layout.find((w) => w.type === "geo-breakdown")).toBeUndefined();
  });

  it("non-configurable widgets have no view field", () => {
    const layout = buildDefaultLayout();
    expect(layout.find((w) => w.type === "s-curve")?.view).toBeUndefined();
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
    const next = setWidgetView(layout, "marimekko", "workstream-lever");
    expect(next.find((w) => w.instanceId === "marimekko")?.view).toBe("workstream-lever");
    // Other widgets are unchanged
    expect(next.find((w) => w.instanceId === "workstream-breakdown")?.view).toBe(
      layout.find((w) => w.instanceId === "workstream-breakdown")?.view
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
      "workstream-lever",
    ]);
    const workstreamBreakdown = layout.find((w) => w.type === "workstream-breakdown")!;
    expect(workstreamBreakdown.customViews).toHaveLength(3);
    expect(workstreamBreakdown.view).toBe("workstream");
  });

  it("non-builder widgets have no customViews field", () => {
    const layout = buildDefaultLayout();
    expect(layout.find((w) => w.type === "s-curve")?.customViews).toBeUndefined();
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
    const ws = next.find((w) => w.type === "workstream-breakdown")!;
    expect(ws.customViews).toHaveLength(3);
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
