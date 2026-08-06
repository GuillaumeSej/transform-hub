import { describe, expect, it } from "vitest";
import { generateFiscalYears } from "@/lib/fiscalYear";

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
});
