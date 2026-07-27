import { describe, it, expect } from "vitest";
import {
  buildHierarchyForest,
  derivePnlAccounts,
  hierarchyPathValue,
  nodesForDomain,
  resolveHierarchyPath,
} from "@/lib/hierarchyLogic";
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

describe("hierarchyLogic — domains, tree and P&L", () => {
  it("keeps legacy nodes in the financial domain and isolates geography", () => {
    const nodes = [...nodes3, { ...nodes3[0], id: "geo", domain: "geographic" as const }];
    expect(nodesForDomain(nodes, "financial")).toHaveLength(3);
    expect(nodesForDomain(nodes, "geographic")).toHaveLength(1);
  });

  it("builds a stable nested forest", () => {
    const forest = buildHierarchyForest(nodes3, levels3);
    expect(forest).toHaveLength(1);
    expect(forest[0].children[0].children[0].id).toBe("cc1");
  });

  it("derives P&L accounts from the semantic level", () => {
    const levels: HierarchyLevelDef[] = [{ key: "pnl", label: "P&L", order: 0, semantic: "pnl" }];
    const nodes: HierarchyNode[] = [
      {
        id: "p1",
        companyId: "c1",
        domain: "financial",
        levelKey: "pnl",
        code: "REV",
        label: "Revenue",
        parentId: null,
        financial: { baseline: 125, sign: 1, computed: false, selectable: true },
      },
    ];
    expect(derivePnlAccounts(levels, nodes, [])).toEqual([
      { id: "REV", name: "Revenue", baseline: 125, sign: 1, computed: false, selectable: true },
    ]);
  });

  it("keeps legacy accounts that are still referenced by existing levers", () => {
    const levels: HierarchyLevelDef[] = [{ key: "pnl", label: "P&L", order: 0, semantic: "pnl" }];
    const nodes: HierarchyNode[] = [
      {
        id: "p1",
        companyId: "c1",
        domain: "financial",
        levelKey: "pnl",
        code: "NEW",
        label: "New line",
        parentId: null,
        financial: { baseline: 0, sign: 1 },
      },
    ];
    const fallback = [{ id: "OLD", name: "Old line", baseline: 10, sign: 1 as const }];
    expect(
      derivePnlAccounts(levels, nodes, fallback, ["OLD"]).map((account) => account.id)
    ).toEqual(["NEW", "OLD"]);
  });

  it("resolves a semantic geography value from a selected leaf", () => {
    const levels: HierarchyLevelDef[] = [
      { key: "country", label: "Pays", order: 0, semantic: "country" },
      { key: "entity", label: "Entité", order: 1, semantic: "legal_entity" },
    ];
    const nodes: HierarchyNode[] = [
      {
        id: "fr",
        companyId: "c1",
        domain: "geographic",
        levelKey: "country",
        code: "FR",
        label: "France",
        parentId: null,
      },
      {
        id: "acme",
        companyId: "c1",
        domain: "geographic",
        levelKey: "entity",
        code: "ACME",
        label: "Acme France",
        parentId: "fr",
      },
    ];
    expect(hierarchyPathValue("acme", "country", nodes, levels)).toBe("France");
  });
});
