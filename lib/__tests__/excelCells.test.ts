import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  applyExcelDateColumns,
  excelDateCell,
  excelSerialFromIsoDate,
  isClearMarker,
  readOptionalTextCell,
} from "@/lib/excelCells";
import { parseCellDate, readXlsxWorkbook } from "@/lib/excelParse";

describe("règle cellule vide / tiret", () => {
  it("seul un tiret isolé (- – —) efface", () => {
    expect(isClearMarker("-")).toBe(true);
    expect(isClearMarker(" – ")).toBe(true);
    expect(isClearMarker("—")).toBe(true);
    expect(isClearMarker("--")).toBe(false);
    expect(isClearMarker("-5")).toBe(false);
    expect(isClearMarker("")).toBe(false);
    expect(isClearMarker(-1)).toBe(false);
  });

  it("readOptionalTextCell : vide = conserver, tiret = effacer, sinon valeur", () => {
    expect(readOptionalTextCell("")).toEqual({ kind: "keep" });
    expect(readOptionalTextCell(undefined)).toEqual({ kind: "keep" });
    expect(readOptionalTextCell("-")).toEqual({ kind: "clear" });
    expect(readOptionalTextCell(" Marie ")).toEqual({ kind: "set", value: "Marie" });
  });
});

describe(`vraies cellules date à l'export (fuseau ${process.env.TZ ?? "(système)"})`, () => {
  it("numéro de série exact, calculé sans fuseau", () => {
    expect(excelSerialFromIsoDate("2026-01-01")).toBe(46023);
    expect(excelSerialFromIsoDate("2028-02-29")).toBe(46812);
    expect(excelSerialFromIsoDate("2026-02-30")).toBeUndefined();
    expect(excelSerialFromIsoDate("01/03/2026")).toBeUndefined();
    expect(excelDateCell("2041")).toBe("2041");
    expect(excelDateCell(undefined)).toBe("");
  });

  it("applyExcelDateColumns : écrit puis relit au jour près (Europe/Paris compris)", () => {
    const dates = ["2026-03-31", "2026-10-25", "2027-01-01", "2028-02-29"];
    const ws = XLSX.utils.aoa_to_sheet([
      ["Libellé", "Date fin", "Note"],
      ...dates.map((d) => ["x", d, d]),
      ["y", "", "texte"],
    ]);
    applyExcelDateColumns(XLSX, ws, ["date FIN"]);
    expect(ws["B2"]).toMatchObject({ t: "n", z: "dd/mm/yyyy", w: "31/03/2026" });
    expect(ws["C2"]).toMatchObject({ t: "s", v: "2026-03-31" }); // colonne non visée
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "S");
    const read = readXlsxWorkbook(XLSX, XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(read.Sheets["S"], {
      defval: "",
    });
    const iso = rows.map((r) => {
      const p = parseCellDate(r["Date fin"]);
      return p?.ok ? p.value : r["Date fin"];
    });
    expect(iso).toEqual([...dates, ""]);
    expect(
      XLSX.utils.sheet_to_json<Record<string, unknown>>(read.Sheets["S"], { raw: false })[0][
        "Date fin"
      ]
    ).toBe("31/03/2026");
  });
});
