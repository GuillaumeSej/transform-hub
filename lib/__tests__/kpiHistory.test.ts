import { describe, expect, it, vi } from "vitest";
import {
  availableYears,
  buildHistoryRows,
  effectiveResponsibleRoles,
  filterByYear,
  isMarketKpi,
  measurementGap,
  periodYear,
  submitIndicatorValue,
} from "@/lib/kpiHistory";
import type { IndicatorMeasurement } from "@/types";

const m = (period: string, reportedAt: string, value?: number): IndicatorMeasurement => ({
  id: period + reportedAt,
  companyId: "c",
  indicatorId: "i",
  period,
  value,
  reportedBy: "u",
  reportedAt,
});

describe("kpiHistory", () => {
  it("periodYear / availableYears / filterByYear", () => {
    expect(periodYear("2025-Q3")).toBe(2025);
    expect(periodYear("x")).toBeUndefined();
    const ms = [m("2025-12", "a"), m("2026-01", "b")];
    expect(availableYears(ms, new Date("2026-09-01"))).toEqual([2026, 2025]);
    expect(filterByYear(ms, 2025)).toHaveLength(1);
    expect(filterByYear(ms, "all")).toHaveLength(2);
  });
  it("gap et tri", () => {
    expect(measurementGap(19, 25)).toBe(-6);
    expect(measurementGap(undefined, 25)).toBeUndefined();
    const rows = buildHistoryRows([m("2026-01", "a", 3), m("2026-02", "b", 30)], 25, "up");
    expect(rows[0].measurement.period).toBe("2026-02");
    expect(rows[0].favorable).toBe(true);
    expect(rows[1].favorable).toBe(false);
  });
  it("KPI marché : CTO ajouté", () => {
    expect(isMarketKpi({ axisId: "a" })).toBe(true);
    expect(isMarketKpi({ axisId: "a", chantierId: "c" })).toBe(false);
    expect(
      effectiveResponsibleRoles({ axisId: "a", responsibleRoles: ["pmo" as never] })
    ).toContain("cto");
  });
  it("submitIndicatorValue omet les undefined", async () => {
    const add = vi.fn(async (x: unknown) => x);
    await submitIndicatorValue(add, {
      indicatorId: "i",
      period: "2026",
      reportedBy: "u",
      note: "  ",
    });
    expect(add).toHaveBeenCalledWith({ indicatorId: "i", period: "2026", reportedBy: "u" });
  });
});
