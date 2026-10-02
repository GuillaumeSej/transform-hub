import { describe, expect, it } from "vitest";
import { fiscalYearStartISO, generateFiscalYears } from "@/lib/fiscalYear";

describe("fiscalYear — generateFiscalYears", () => {
  it("returns an empty array when program is null", () => {
    expect(generateFiscalYears(null, "2026-01-01", "2028-12-31")).toEqual([]);
  });

  it("labels calendar-year FYs as 'FYyyyy'", () => {
    const fys = generateFiscalYears(
      { fyStart: "2026-01-01", fyEnd: "2026-12-31" },
      "2026-01-01",
      "2027-12-31"
    );
    expect(fys.map((f) => f.label)).toContain("FY2026");
    expect(fys.map((f) => f.label)).toContain("FY2027");
  });

  it("labels mid-year FYs as 'FYyy/yy+1'", () => {
    const fys = generateFiscalYears(
      { fyStart: "2026-07-01", fyEnd: "2027-06-30" },
      "2026-05-01",
      "2028-05-01"
    );
    const labels = fys.map((f) => f.label);
    expect(labels).toContain("FY26/27");
    expect(labels).toContain("FY27/28");
  });

  it("start/end ISO bracket the requested range", () => {
    const fys = generateFiscalYears(
      { fyStart: "2026-07-01", fyEnd: "2027-06-30" },
      "2026-01-01",
      "2027-12-31"
    );
    const fy26 = fys.find((f) => f.label === "FY26/27");
    expect(fy26?.startISO).toBe("2026-07-01");
    expect(fy26?.endISO).toBe("2027-06-30");
  });

  it("exercice commençant le 29/02 : borné au dernier jour du mois les années non bissextiles", () => {
    const fys = generateFiscalYears(
      { fyStart: "2024-02-29", fyEnd: "2025-02-27" },
      "2024-03-01",
      "2028-12-31"
    );
    const byLabel = Object.fromEntries(fys.map((f) => [f.label, [f.startISO, f.endISO]]));
    // Plus jamais de « 2025-02-29 » (date inexistante).
    expect(fys.map((f) => f.startISO)).not.toContain("2025-02-29");
    expect(byLabel["FY24/25"]).toEqual(["2024-02-29", "2025-02-27"]);
    expect(byLabel["FY25/26"]).toEqual(["2025-02-28", "2026-02-27"]);
    expect(byLabel["FY27/28"]).toEqual(["2027-02-28", "2028-02-28"]);
    expect(byLabel["FY28/29"]).toEqual(["2028-02-29", "2029-02-27"]);
    // Exercices contigus : chaque début = lendemain de la fin précédente.
    for (let i = 1; i < fys.length; i++) {
      const prevEnd = new Date(`${fys[i - 1].endISO}T00:00:00Z`);
      prevEnd.setUTCDate(prevEnd.getUTCDate() + 1);
      expect(prevEnd.toISOString().slice(0, 10)).toBe(fys[i].startISO);
    }
  });

  it("fiscalYearStartISO borne le jour au dernier jour du mois", () => {
    expect(fiscalYearStartISO(2025, 2, 29)).toBe("2025-02-28");
    expect(fiscalYearStartISO(2028, 2, 29)).toBe("2028-02-29");
    expect(fiscalYearStartISO(2026, 4, 31)).toBe("2026-04-30");
    expect(fiscalYearStartISO(2026, 7, 1)).toBe("2026-07-01");
  });
});
