import { describe, expect, it } from "vitest";
import {
  canonicalizeRowKeys,
  excelRowNumber,
  isoFromExcelSerial,
  normalizeHeaderKey,
  parseCellDate,
  parseCellNumber,
} from "@/lib/excelParse";

const num = (v: unknown) => {
  const r = parseCellNumber(v);
  return r === undefined ? undefined : r.ok ? r.value : "ERR";
};
const date = (v: unknown) => {
  const r = parseCellDate(v);
  return r === undefined ? undefined : r.ok ? r.value : "ERR";
};

describe("parseCellNumber", () => {
  it("lit les formats français et anglais", () => {
    expect(num("0,5")).toBe(0.5);
    expect(num("1 500,5")).toBe(1500.5);
    expect(num("45 000")).toBe(45000);
    expect(num("45 000,50")).toBe(45000.5);
    expect(num("1.500,5")).toBe(1500.5);
    expect(num("1,500.50")).toBe(1500.5);
    expect(num("1,500,000")).toBe(1500000);
    expect(num("12,5 %")).toBe(12.5);
    expect(num("1 500 €")).toBe(1500);
    expect(num("(1 500)")).toBe(-1500);
    expect(num("-3,5")).toBe(-3.5);
    expect(num(2.5)).toBe(2.5);
  });
  it("vide = undefined, illisible = erreur (jamais de valeur par défaut)", () => {
    expect(num("")).toBeUndefined();
    expect(num("  ")).toBeUndefined();
    expect(num(null)).toBeUndefined();
    expect(num("abc")).toBe("ERR");
    expect(num("0x10")).toBe("ERR");
    expect(num("1e3")).toBe("ERR");
  });
});

describe("parseCellDate", () => {
  it("lit séries Excel, ISO, JJ/MM/AAAA et Date", () => {
    expect(date(46112)).toBe("2026-03-31");
    expect(date(46112.08)).toBe("2026-03-31");
    expect(date("46112")).toBe("2026-03-31");
    expect(date("2026-03-31")).toBe("2026-03-31");
    expect(date("2026-3-31")).toBe("2026-03-31");
    expect(date("2026-03-31T00:00:00")).toBe("2026-03-31");
    expect(date("31/03/2026")).toBe("2026-03-31");
    expect(date(" 01/03/2026 ")).toBe("2026-03-01");
    expect(date(new Date(2026, 2, 31))).toBe("2026-03-31");
  });
  it("rejette les dates impossibles ou ambiguës", () => {
    expect(date("31/02/2026")).toBe("ERR");
    expect(date("2026-13-45")).toBe("ERR");
    expect(date("03/31/2026")).toBe("ERR");
    expect(date("March 31, 2026")).toBe("ERR");
    expect(date("1")).toBe("ERR");
    expect(date("")).toBeUndefined();
  });
  it("série Excel sans décalage de fuseau", () => {
    expect(isoFromExcelSerial(45658)).toBe("2025-01-01");
  });
});

describe("en-têtes et lignes", () => {
  it("normalise casse, accents et espaces", () => {
    expect(normalizeHeaderKey("  Libellé ")).toBe("libelle");
    expect(normalizeHeaderKey("Date  de départ")).toBe("date de depart");
  });
  it("réécrit les clés vers les en-têtes attendus et liste les inconnues", () => {
    const { row, unknown } = canonicalizeRowKeys(
      { "code ": "A1", libelle: "X", Extra: 1, __rowNum__: 4 },
      ["Code", "Libellé"]
    );
    expect(row).toEqual({ Code: "A1", Libellé: "X", Extra: 1 });
    expect(unknown).toEqual(["Extra"]);
  });
  it("numéro de ligne Excel via __rowNum__", () => {
    expect(excelRowNumber({ __rowNum__: 4 }, 0)).toBe(5);
    expect(excelRowNumber({}, 3)).toBe(5);
  });
});
