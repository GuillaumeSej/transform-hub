import { describe, expect, it } from "vitest";
import { mockData } from "@/data/mockData";
import { migrateMockLeversToActions } from "@/lib/mockActionMigration";

describe("mockActionMigration", () => {
  const migrated = migrateMockLeversToActions(mockData.levers, mockData.subLevers);

  it("creates enriched actions for every lever", () => {
    expect(migrated).toHaveLength(mockData.levers.length);
    migrated.forEach((lever) => {
      expect(lever.actions?.length ?? 0).toBeGreaterThan(0);
      expect((lever.actions ?? []).some((action) => (action.impacts ?? []).length > 0)).toBe(true);
    });
  });

  it("keeps action and impact ids unique", () => {
    const actionIds = migrated.flatMap((lever) => (lever.actions ?? []).map((action) => action.id));
    const impactIds = migrated.flatMap((lever) =>
      (lever.actions ?? []).flatMap((action) => (action.impacts ?? []).map((impact) => impact.id))
    );
    expect(new Set(actionIds).size).toBe(actionIds.length);
    expect(new Set(impactIds).size).toBe(impactIds.length);
  });

  it("preserves already enriched user actions exactly", () => {
    const enriched = migrated[0];
    const edited = {
      ...enriched,
      actions: (enriched.actions ?? []).map((action, index) =>
        index === 0
          ? {
              ...action,
              name: "Action modifiée par l'utilisateur",
              impacts: (action.impacts ?? []).map((impact, impactIndex) =>
                impactIndex === 0 ? { ...impact, amount: impact.amount + 0.37 } : impact
              ),
            }
          : action
      ),
    };
    const remigrated = migrateMockLeversToActions([edited], []);
    expect(remigrated[0].actions).toEqual(edited.actions);
  });

  it("preserves parent lever KPIs and progress", () => {
    migrated.forEach((lever) => {
      const original = mockData.levers.find((candidate) => candidate.id === lever.id)!;
      expect(lever.progress).toBe(original.progress);
      expect(lever.netSavings).toBe(original.netSavings);
      expect(lever.capex).toBe(original.capex);
      expect(lever.opexOneOff).toBe(original.opexOneOff);
      expect(lever.opexRec).toBe(original.opexRec);
      expect(lever.fteImpact).toBe(original.fteImpact);
    });
  });

  it("preserves former sub-lever actions and enriches each with impacts", () => {
    const parentIds = new Set(mockData.subLevers.map((sub) => sub.leverId));
    parentIds.forEach((leverId) => {
      const expected = mockData.subLevers
        .filter((sub) => sub.leverId === leverId)
        .reduce((sum, sub) => sum + Math.max(1, sub.actions.length), 0);
      const lever = migrated.find((candidate) => candidate.id === leverId)!;
      expect(lever.actions).toHaveLength(expected);
    });
  });

  it("preserves each parent lever net savings after consolidating migrated actions", () => {
    const round = (value: number) => Math.round(value * 100) / 100;
    migrated.forEach((lever) => {
      const net = (lever.actions ?? []).reduce(
        (sum, action) =>
          sum +
          (action.impacts ?? []).reduce(
            (actionSum, impact) =>
              actionSum + (impact.type === "saving" ? impact.amount : -impact.amount),
            0
          ),
        0
      );
      expect(round(net)).toBe(round(lever.netSavings));
    });
  });

  it("promotes legacy sub-lever dependencies to parent levers", () => {
    const source = {
      ...mockData.levers[0],
      id: "L-A",
      dependencies: [],
    };
    const target = {
      ...mockData.levers[1],
      id: "L-B",
      dependencies: [],
    };
    const subA = {
      ...mockData.subLevers[0],
      id: "SL-A",
      leverId: "L-A",
      dependencies: [{ targetId: "SL-B", type: "FS" as const }],
    };
    const subB = {
      ...mockData.subLevers[1],
      id: "SL-B",
      leverId: "L-B",
      dependencies: [],
    };

    const result = migrateMockLeversToActions([source, target], [subA, subB]);
    expect(result.find((lever) => lever.id === "L-A")?.dependencies).toEqual([
      { targetId: "L-B", type: "FS" },
    ]);
  });

  it("drops dependencies between former sub-levers of the same parent lever", () => {
    const parent = {
      ...mockData.levers[0],
      id: "L-A",
      dependencies: [],
    };
    const subA = {
      ...mockData.subLevers[0],
      id: "SL-A1",
      leverId: "L-A",
      dependencies: [{ targetId: "SL-A2", type: "FS" as const }],
    };
    const subB = {
      ...mockData.subLevers[1],
      id: "SL-A2",
      leverId: "L-A",
      dependencies: [],
    };

    const result = migrateMockLeversToActions([parent], [subA, subB]);
    expect(result[0].dependencies).toEqual([]);
  });
});
