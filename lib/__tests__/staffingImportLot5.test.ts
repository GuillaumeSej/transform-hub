import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  STAFFING_IMPORT_ISSUES,
  STAFFING_IMPORT_SHEET_NAME,
  buildStaffingExportWorkbook,
  readStaffingImportSheet,
  validateStaffingImportRows,
} from "@/lib/staffingExcelImport";
import { readSpreadsheet } from "@/lib/excelFileRead";
import fr from "@/lib/i18n/dictionaries/fr";
import en from "@/lib/i18n/dictionaries/en";
import de from "@/lib/i18n/dictionaries/de";
import es from "@/lib/i18n/dictionaries/es";
import type { Chantier, ChantierAction, ChantierStaffing } from "@/types";

/**
 * Import Effectifs — lot 5 : colonne « Levier » (vide = rattachement conservé, « - » = retiré)
 * et création identique à une ligne existante (ligne copiée dont l'« ID ligne » a été vidé).
 * Allers-retours .xlsx réels (export → édition → relecture comme l'appli).
 */

const companyId = "C1";
const programId = "P1";
const knownDepartments = ["RH", "IT / SI"];
const fteByTeam: Record<string, number> = { RH: 14, "IT / SI": 3 };

const chantiers: Chantier[] = [
  {
    id: "CH1",
    companyId,
    programId,
    axisIds: ["AX1"],
    name: "Refonte du parcours achats",
    stage: "planned",
    dependencies: [],
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
  },
  {
    id: "CH2",
    companyId,
    programId,
    axisIds: ["AX1"],
    name: "Digitalisation RH",
    stage: "planned",
    dependencies: [],
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
  },
];
const actions: ChantierAction[] = [
  {
    id: "CA1",
    companyId,
    chantierId: "CH1",
    name: "Cartographier le processus actuel",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "planned",
  },
];
const existing: ChantierStaffing[] = [
  {
    id: "ST-A",
    companyId,
    programId,
    chantierId: "CH1",
    function: "RH",
    fte: 1,
    startDate: "2026-01-01",
    endDate: "2026-03-31",
    actionId: "CA1",
    createdAt: "2025-12-01",
  },
  {
    id: "ST-B",
    companyId,
    programId,
    chantierId: "CH1",
    function: "IT / SI",
    fte: 0.5,
    startDate: "2026-03-01",
    endDate: "2026-12-31",
    createdAt: "2025-12-01",
  },
];

/** Export réel → édition des lignes de la feuille ETP → .xlsx → relecture comme l'appli. */
async function exportEditRead(
  edit: (rows: Record<string, unknown>[]) => Record<string, unknown>[] = (r) => r
): Promise<Record<string, unknown>[]> {
  const wb = buildStaffingExportWorkbook(
    XLSX,
    existing,
    chantiers,
    actions,
    knownDepartments,
    fteByTeam
  );
  const ws = wb.Sheets[STAFFING_IMPORT_SHEET_NAME];
  const header = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  wb.Sheets[STAFFING_IMPORT_SHEET_NAME] = XLSX.utils.json_to_sheet(edit(rows), { header });
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return readStaffingImportSheet(XLSX, await readSpreadsheet(bytes, "effectifs.xlsx"));
}

const run = (rows: Record<string, unknown>[]) =>
  validateStaffingImportRows(
    rows,
    companyId,
    programId,
    chantiers,
    actions,
    existing,
    knownDepartments,
    fteByTeam
  );

const onLine = (id: string, patch: Record<string, unknown>) => (rows: Record<string, unknown>[]) =>
  rows.map((r) => (r["ID ligne"] === id ? { ...r, ...patch } : r));

describe(`lot 5 — Effectifs, colonne Levier (fuseau ${process.env.TZ ?? "(système)"})`, () => {
  it("aller-retour sans modification : 0 création, 0 mise à jour, aucune anomalie", async () => {
    const r = run(await exportEditRead());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.rows).toEqual([]);
    expect(r.unchanged).toBe(2);
  });

  it("cellule Levier vidée = rattachement CONSERVÉ (avant : effacé)", async () => {
    const r = run(await exportEditRead(onLine("ST-A", { Levier: "" })));
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([]);
    expect(r.unchanged).toBe(2);
  });

  it('« - » dans Levier = rattachement RETIRÉ (avant : « Levier "-" introuvable »)', async () => {
    const r = run(await exportEditRead(onLine("ST-A", { Levier: "-" })));
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].isUpdate).toBe(true);
    expect(r.rows[0].entry).toMatchObject({ id: "ST-A", chantierId: "CH1", fte: 1 });
    expect(r.rows[0].entry).not.toHaveProperty("actionId");
    // Tiret demi-cadratin (correction automatique d'Excel) : même effet.
    const endash = run(await exportEditRead(onLine("ST-A", { Levier: "–" })));
    expect(endash.errors).toEqual([]);
    expect(endash.rows[0].entry).not.toHaveProperty("actionId");
  });

  it("Levier vide + chantier changé : le levier conservé n'appartient plus au chantier = erreur", async () => {
    const r = run(
      await exportEditRead(onLine("ST-A", { Levier: "", Chantier: "Digitalisation RH" }))
    );
    expect(r.errors.map((e) => e.code)).toEqual(["unknownAction"]);
    expect(r.rows).toEqual([]);
  });
});

describe("lot 5 — Effectifs, copie d'une ligne existante", () => {
  it("ligne copiée avec « ID ligne » vidé, identique à une existante = erreur (avant : créée sans avertissement)", async () => {
    const r = run(
      await exportEditRead((rows) => [
        ...rows,
        { ...rows.find((x) => x["ID ligne"] === "ST-B")!, "ID ligne": "" },
      ])
    );
    expect(r.errors.map((e) => [e.code, e.vars?.id])).toEqual([["duplicateExisting", "ST-B"]]);
    expect(r.errors[0].reason).toBe(
      STAFFING_IMPORT_ISSUES.duplicateExisting.replace("{id}", "ST-B")
    );
    expect(r.rows).toEqual([]);
  });

  it("copie dont une valeur diffère (ETP, dates) : nouvelle ligne légitime", async () => {
    const r = run(
      await exportEditRead((rows) => [
        ...rows,
        {
          ...rows.find((x) => x["ID ligne"] === "ST-B")!,
          "ID ligne": "",
          "Date début": "2026-07-01",
        },
      ])
    );
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.isUpdate)).toEqual([false]);
  });

  it("l'existante change de dates, la copie reprend l'ancienne période : accepté", async () => {
    const r = run(
      await exportEditRead((rows) => {
        const b = rows.find((x) => x["ID ligne"] === "ST-B")!;
        return [
          ...rows.map((x) => (x === b ? { ...b, "Date fin": "2027-06-30" } : x)),
          { ...b, "ID ligne": "" },
        ];
      })
    );
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.isUpdate, x.entry.endDate])).toEqual([
      [true, "2027-06-30"],
      [false, "2026-12-31"],
    ]);
  });

  it("message présent à l'identique en français et traduit", () => {
    expect(fr["staffingImport.issue.duplicateExisting"]).toBe(
      STAFFING_IMPORT_ISSUES.duplicateExisting
    );
    for (const dict of [en, de, es])
      expect(dict["staffingImport.issue.duplicateExisting"]).toBeTruthy();
  });
});
