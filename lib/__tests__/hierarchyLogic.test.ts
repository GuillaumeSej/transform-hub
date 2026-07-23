import { describe, it, expect } from "vitest";
import { resolveHierarchyPath } from "@/lib/hierarchyLogic";
import type { HierarchyLevelDef, HierarchyNode } from "@/types";

const levels3: HierarchyLevelDef[] = [
  { key: "business_unit", label: "Business Unit", order: 0 },
  { key: "department", label: "Département", order: 1 },
  { key: "cost_center", label: "Centre de coût", order: 2 },
];

const nodes3: HierarchyNode[] = [
  {
    id: "bu1",
    companyId: "c1",
    levelKey: "business_unit",
    code: "BU-IND",
    label: "BU Industrie",
    parentId: null,
  },
  {
    id: "dep1",
    companyId: "c1",
    levelKey: "department",
    code: "DEP-PROC",
    label: "Procurement",
    parentId: "bu1",
  },
  {
    id: "cc1",
    companyId: "c1",
    levelKey: "cost_center",
    code: "CC-001",
    label: "Achats directs",
    parentId: "dep1",
  },
];

describe("hierarchyLogic — resolveHierarchyPath", () => {
  it("resolves a full 3-level chain macro -> fine", () => {
    const path = resolveHierarchyPath("cc1", nodes3, levels3);
    expect(path).toHaveLength(3);
    expect(path.map((p) => p.levelKey)).toEqual(["business_unit", "department", "cost_center"]);
    expect(path[0]).toEqual({ levelKey: "business_unit", label: "BU Industrie", code: "BU-IND" });
    expect(path[2]).toEqual({ levelKey: "cost_center", label: "Achats directs", code: "CC-001" });
  });

  it("returns an empty array for an unknown leafId", () => {
    expect(resolveHierarchyPath("does-not-exist", nodes3, levels3)).toEqual([]);
  });

  it("returns an empty array when leafId is empty/falsy", () => {
    expect(resolveHierarchyPath("", nodes3, levels3)).toEqual([]);
  });

  it("returns an empty array when nodes are not loaded yet", () => {
    expect(resolveHierarchyPath("cc1", [], levels3)).toEqual([]);
  });

  it("works for a company configured with a single level", () => {
    const levels1: HierarchyLevelDef[] = [
      { key: "cost_center", label: "Centre de coût", order: 0 },
    ];
    const nodes1: HierarchyNode[] = [
      {
        id: "cc-only",
        companyId: "c2",
        levelKey: "cost_center",
        code: "CC-X",
        label: "Centre X",
        parentId: null,
      },
    ];
    const path = resolveHierarchyPath("cc-only", nodes1, levels1);
    expect(path).toHaveLength(1);
    expect(path[0]).toEqual({ levelKey: "cost_center", label: "Centre X", code: "CC-X" });
  });

  it("guards against a parentId cycle instead of looping forever", () => {
    const cyclic: HierarchyNode[] = [
      { id: "a", companyId: "c1", levelKey: "business_unit", code: "A", label: "A", parentId: "b" },
      { id: "b", companyId: "c1", levelKey: "department", code: "B", label: "B", parentId: "a" },
    ];
    const path = resolveHierarchyPath("a", cyclic, levels3);
    expect(path.length).toBeLessThanOrEqual(2);
  });
});
