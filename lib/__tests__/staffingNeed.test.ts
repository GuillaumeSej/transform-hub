import { describe, expect, it } from "vitest";
import { averageFte, needMetrics, needSeries, periodBoundsForDate } from "@/lib/staffingNeed";
import type { ChantierStaffing } from "@/types";

const e = (fte: number, startDate?: string, endDate?: string): ChantierStaffing =>
  ({
    id: "x",
    companyId: "c",
    programId: "p",
    chantierId: "ch",
    function: "F",
    fte,
    startDate,
    endDate,
    createdAt: "",
  }) as ChantierStaffing;

describe("staffingNeed", () => {
  it("bornes", () => {
    expect(periodBoundsForDate("2026-05-10", "quarterly")).toEqual({
      label: "2026-Q2",
      start: "2026-04-01",
      end: "2026-06-30",
    });
    expect(periodBoundsForDate("2026-08-01", "semiannual").label).toBe("2026-S2");
    expect(periodBoundsForDate("2026-08-01", "annual").end).toBe("2026-12-31");
  });
  it("moyenne, pas somme brute", () => {
    const y = { start: "2026-01-01", end: "2026-12-31" };
    expect(averageFte([e(2, "2026-01-01", "2026-06-30")], y)).toBeCloseTo(2 * (181 / 365), 5);
    expect(averageFte([e(2, "2026-01-01", "2026-12-31"), e(1, "2026-01-01")], y)).toBeCloseTo(3, 5);
    expect(averageFte([e(1)], y)).toBe(0);
  });
  it("mobilisé et % de staffing", () => {
    const p = periodBoundsForDate("2026-01-15", "quarterly");
    const m = needMetrics([e(2, "2026-01-01", "2026-03-31")], 10, p, "2026-02-14");
    expect(m.needed).toBeCloseTo(2, 5);
    expect(m.mobilised).toBeCloseTo(2, 5);
    expect(m.staffingPct).toBe(100);
    const m2 = needMetrics(
      [e(2, "2026-01-01", "2026-03-31"), e(2, "2026-03-01", "2026-03-31")],
      10,
      p,
      "2026-02-14"
    );
    expect(m2.mobilised).toBeCloseTo(2, 5);
    expect(m2.needed).toBeCloseTo(2 + 2 * (31 / 90), 5);
    expect(m2.staffingPct).toBe(Math.round((2 / m2.needed) * 100));
    expect(needMetrics([], 10, p, "2026-02-14").staffingPct).toBeNull();
  });
  it("série continue selon granularité", () => {
    const s = [e(1, "2026-01-01", "2026-12-31")];
    expect(needSeries(s, 5, "quarterly", "2026-02-01")).toHaveLength(4);
    expect(needSeries(s, 5, "annual", "2026-02-01")).toHaveLength(1);
    expect(needSeries([], 5, "annual", "2026-02-01")).toEqual([]);
  });
});
