import { describe, it, expect } from "vitest";
import { validateHierarchyImportRows, hierarchyNodeToExcelRow } from "@/lib/hierarchyExcel";
import type { HierarchyLevelDef, HierarchyNode } from "@/types";

const levels3: HierarchyLevelDef[] = [
  { key: "business_unit", label: "Business Unit", order: 0 },
  { key: "department", label: "Département", order: 1 },
  { key: "cost_center", label: "Centre de coût", order: 2 },
];

describe("hierarchyExcel — validateHierarchyImportRows", () => {
  it("creates a full 3-level tree from rows filled out of order, resolving parents by code", () => {
    const rows = [
      {
        Niveau: "Centre de coût",
        Code: "CC-001",
        Libellé: "Achats directs",
        "Code parent": "DEP-PROC",
      },
      { Niveau: "Business Unit", Code: "BU-IND", Libellé: "BU Industrie", "Code parent": "" },
      { Niveau: "Département", Code: "DEP-PROC", Libellé: "Procurement", "Code parent": "BU-IND" },
    ];
    const preview = validateHierarchyImportRows(rows, levels3, [], "c1");
    expect(preview.errors).toEqual([]);
    expect(preview.toCreate).toHaveLength(3);

    const bu = preview.toCreate.find((n) => n.code === "BU-IND")!;
    const dep = preview.toCreate.find((n) => n.code === "DEP-PROC")!;
    const cc = preview.toCreate.find((n) => n.code === "CC-001")!;
    expect(bu.parentId).toBeNull();
    expect(dep.parentId).toBe(bu.id);
    expect(cc.parentId).toBe(dep.id);
  });

  it("accepts the level label matched case-insensitively, and also matches by level key", () => {
    const rows = [{ Niveau: "business unit", Code: "BU-1", Libellé: "BU One", "Code parent": "" }];
    const preview = validateHierarchyImportRows(rows, levels3, [], "c1");
    expect(preview.errors).toEqual([]);
    expect(preview.toCreate).toHaveLength(1);
  });

  it("rejects a row referencing an unconfigured level", () => {
    const rows = [{ Niveau: "Sous-compte", Code: "X", Libellé: "X", "Code parent": "" }];
    const preview = validateHierarchyImportRows(rows, levels3, [], "c1");
    expect(preview.toCreate).toEqual([]);
    expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0].reason).toMatch(/non configuré/);
    expect(preview.errors[0].rowNumber).toBe(2);
  });

  it("rejects a duplicate code within the same level, within the import", () => {
    const rows = [
      { Niveau: "Business Unit", Code: "BU-IND", Libellé: "BU Industrie", "Code parent": "" },
      { Niveau: "Business Unit", Code: "bu-ind", Libellé: "Doublon", "Code parent": "" },
    ];
    const preview = validateHierarchyImportRows(rows, levels3, [], "c1");
    expect(preview.toCreate).toHaveLength(1);
    expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0].reason).toMatch(/doublon/);
    expect(preview.errors[0].rowNumber).toBe(3);
  });

  it("rejects a code that already exists in Firestore for that level", () => {
    const existing: HierarchyNode[] = [
      {
        id: "bu1",
        companyId: "c1",
        levelKey: "business_unit",
        code: "BU-IND",
        label: "BU Industrie",
        parentId: null,
      },
    ];
    const rows = [
      { Niveau: "Business Unit", Code: "BU-IND", Libellé: "Encore", "Code parent": "" },
    ];
    const preview = validateHierarchyImportRows(rows, levels3, existing, "c1");
    expect(preview.toCreate).toEqual([]);
    expect(preview.errors[0].reason).toMatch(/déjà existant/);
  });

  it("rejects a parentCode that doesn't resolve to any node of the parent level", () => {
    const rows = [
      {
        Niveau: "Département",
        Code: "DEP-PROC",
        Libellé: "Procurement",
        "Code parent": "BU-GHOST",
      },
    ];
    const preview = validateHierarchyImportRows(rows, levels3, [], "c1");
    expect(preview.toCreate).toEqual([]);
    expect(preview.errors[0].reason).toMatch(/introuvable/);
  });

  it("rejects a missing parentCode for a non-macro level", () => {
    const rows = [
      { Niveau: "Département", Code: "DEP-PROC", Libellé: "Procurement", "Code parent": "" },
    ];
    const preview = validateHierarchyImportRows(rows, levels3, [], "c1");
    expect(preview.toCreate).toEqual([]);
    expect(preview.errors[0].reason).toMatch(/obligatoire/);
  });

  it("rejects a parentCode provided on the macro level", () => {
    const rows = [
      {
        Niveau: "Business Unit",
        Code: "BU-IND",
        Libellé: "BU Industrie",
        "Code parent": "SOMETHING",
      },
    ];
    const preview = validateHierarchyImportRows(rows, levels3, [], "c1");
    expect(preview.toCreate).toEqual([]);
    expect(preview.errors[0].reason).toMatch(/ne doit pas avoir/);
  });

  it("rejects rows missing Code or Libellé", () => {
    const rows = [{ Niveau: "Business Unit", Code: "", Libellé: "", "Code parent": "" }];
    const preview = validateHierarchyImportRows(rows, levels3, [], "c1");
    expect(preview.toCreate).toEqual([]);
    expect(preview.errors[0].reason).toMatch(/obligatoires/);
  });

  it("silently skips fully empty rows", () => {
    const rows = [{ Niveau: "", Code: "", Libellé: "", "Code parent": "" }];
    const preview = validateHierarchyImportRows(rows, levels3, [], "c1");
    expect(preview.toCreate).toEqual([]);
    expect(preview.errors).toEqual([]);
  });

  it("resolves an existing Firestore node as parent for a new child row", () => {
    const existing: HierarchyNode[] = [
      {
        id: "bu1",
        companyId: "c1",
        levelKey: "business_unit",
        code: "BU-IND",
        label: "BU Industrie",
        parentId: null,
      },
    ];
    const rows = [
      { Niveau: "Département", Code: "DEP-PROC", Libellé: "Procurement", "Code parent": "BU-IND" },
    ];
    const preview = validateHierarchyImportRows(rows, levels3, existing, "c1");
    expect(preview.errors).toEqual([]);
    expect(preview.toCreate[0].parentId).toBe("bu1");
  });
});

describe("hierarchyExcel — hierarchyNodeToExcelRow", () => {
  it("exports a node with its level label and parent code", () => {
    const bu: HierarchyNode = {
      id: "bu1",
      companyId: "c1",
      levelKey: "business_unit",
      code: "BU-IND",
      label: "BU Industrie",
      parentId: null,
    };
    const dep: HierarchyNode = {
      id: "dep1",
      companyId: "c1",
      levelKey: "department",
      code: "DEP-PROC",
      label: "Procurement",
      parentId: "bu1",
    };
    const nodesById = new Map([
      [bu.id, bu],
      [dep.id, dep],
    ]);
    expect(hierarchyNodeToExcelRow(dep, levels3, nodesById)).toEqual({
      Niveau: "Département",
      Code: "DEP-PROC",
      Libellé: "Procurement",
      "Code parent": "BU-IND",
    });
    expect(hierarchyNodeToExcelRow(bu, levels3, nodesById)).toEqual({
      Niveau: "Business Unit",
      Code: "BU-IND",
      Libellé: "BU Industrie",
      "Code parent": "",
    });
  });
});
