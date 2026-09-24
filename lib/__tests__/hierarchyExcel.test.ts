import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  HIERARCHY_IMPORT_ISSUES,
  hierarchyExportFileName,
  hierarchyToExcelRows,
  validateHierarchyImportRows,
  hierarchyNodeToExcelRow,
} from "@/lib/hierarchyExcel";
import { XLSX_READ_OPTIONS } from "@/lib/excelParse";
import fr from "@/lib/i18n/dictionaries/fr";
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

  it("treats a code that already exists for that level as an update (label editable via Excel)", () => {
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
    expect(preview.errors).toEqual([]);
    expect(preview.toCreate).toEqual([]);
    expect(preview.toUpdate).toEqual([{ ...existing[0], label: "Encore" }]);
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

describe("hierarchyExcel — audit du 24/09/2026", () => {
  const pnlLevels: HierarchyLevelDef[] = [
    { key: "business_unit", label: "Business Unit", order: 0 },
    { key: "pnl_line", label: "Ligne P&L", order: 1, semantic: "pnl" },
  ];
  const tree: HierarchyNode[] = [
    {
      id: "bu1",
      companyId: "c1",
      levelKey: "business_unit",
      code: "BU-IND",
      label: "BU Industrie",
      parentId: null,
    },
    {
      id: "p1",
      companyId: "c1",
      levelKey: "pnl_line",
      code: "PNL-ACH",
      label: "Achats",
      parentId: "bu1",
      financial: { baseline: -1500.5, computed: false, selectable: true },
    },
    {
      id: "p2",
      companyId: "c1",
      levelKey: "pnl_line",
      code: "PNL-TOT",
      label: "Total",
      parentId: "bu1",
      financial: { baseline: 0, computed: true },
    },
    // Orphelin : niveau supprimé de la configuration -> non exporté.
    {
      id: "o1",
      companyId: "c1",
      levelKey: "old_level",
      code: "OLD",
      label: "Ancien",
      parentId: null,
    },
  ];

  function viaXlsx(rows: Record<string, string | number>[], headers: string[]) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows, { header: headers }),
      "Arborescence"
    );
    const read = XLSX.read(XLSX.write(wb, { type: "array", bookType: "xlsx" }), XLSX_READ_OPTIONS);
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(read.Sheets["Arborescence"], {
      defval: "",
    });
  }

  it("aller-retour : ré-importer un export inchangé donne 0 erreur et 0 écriture", () => {
    const { rows, headers, orphans } = hierarchyToExcelRows(tree, pnlLevels);
    expect(orphans).toBe(1);
    expect(headers).toContain("Baseline");
    const preview = validateHierarchyImportRows(viaXlsx(rows, headers), pnlLevels, tree, "c1");
    expect(preview.errors).toEqual([]);
    expect(preview.toCreate).toEqual([]);
    expect(preview.toUpdate).toEqual([]);
    expect(preview.unchanged).toBe(3);
  });

  it("données financières importables et modifiables (baseline au format FR)", () => {
    const rows = [
      {
        Niveau: "Ligne P&L",
        Code: "PNL-ACH",
        Libellé: "Achats groupe",
        "Code parent": "BU-IND",
        Baseline: "-2 000,5",
        Calculé: "",
        Sélectionnable: "non",
      },
    ];
    const preview = validateHierarchyImportRows(rows, pnlLevels, tree, "c1");
    expect(preview.errors).toEqual([]);
    expect(preview.toUpdate).toEqual([
      {
        ...tree[1],
        label: "Achats groupe",
        financial: { baseline: -2000.5, computed: false, selectable: false },
      },
    ]);
  });

  it("en-têtes et niveaux tolérants (casse, accents, espaces)", () => {
    const rows = [
      { "  niveau ": "business UNIT", code: "BU-2", LIBELLE: "BU Deux", "code  parent": "" },
      { "  niveau ": "ligne p&l", code: "PNL-X", LIBELLE: "X", "code  parent": "bu-2" },
    ];
    const preview = validateHierarchyImportRows(rows, pnlLevels, [], "c1");
    expect(preview.errors).toEqual([]);
    expect(preview.toCreate).toHaveLength(2);

    const accented = validateHierarchyImportRows(
      [{ Niveau: "departement", Code: "D1", Libellé: "D1", "Code parent": "BU-IND" }],
      levels3,
      [tree[0]],
      "c1"
    );
    expect(accented.errors).toEqual([]);
  });

  it("colonnes obligatoires absentes = erreur fichier explicite", () => {
    const preview = validateHierarchyImportRows(
      [{ Niveau: "Business Unit", Code: "X" }],
      levels3,
      [],
      "c1"
    );
    expect(preview.errors.map((e) => e.code)).toEqual(["missingColumns"]);
    expect(preview.errors[0].reason).toMatch(/Libellé/);
  });

  it("cellules fusionnées = erreur explicite", () => {
    const preview = validateHierarchyImportRows(
      [{ Niveau: "Business Unit", Code: "X", Libellé: "X", "Code parent": "" }],
      levels3,
      [],
      "c1",
      "financial",
      { mergedRanges: ["A2:A5"] }
    );
    expect(preview.errors.map((e) => e.code)).toEqual(["mergedCells"]);
    expect(preview.toCreate).toEqual([]);
  });

  it("numéros de ligne Excel exacts malgré les lignes vides", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Niveau", "Code", "Libellé", "Code parent"],
        [],
        ["Inconnu", "X", "X", ""],
      ]),
      "A"
    );
    const read = XLSX.read(XLSX.write(wb, { type: "array", bookType: "xlsx" }), XLSX_READ_OPTIONS);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(read.Sheets["A"], {
      defval: "",
    });
    const preview = validateHierarchyImportRows(rows, levels3, [], "c1");
    expect(preview.errors[0].rowNumber).toBe(3);
  });

  it("nom de fichier d'export assaini, daté et typé", () => {
    expect(hierarchyExportFileName("Acmé / Groupe: SA?", "geographic", new Date(2026, 8, 24))).toBe(
      "arborescence_geographique_Acme_Groupe_SA_2026-09-24.xlsx"
    );
  });

  it("chaque modèle d'anomalie est présent à l'identique dans fr.ts", () => {
    for (const [code, template] of Object.entries(HIERARCHY_IMPORT_ISSUES)) {
      expect(fr[`adminHierarchy.issue.${code}`], code).toBe(template);
    }
  });
});
