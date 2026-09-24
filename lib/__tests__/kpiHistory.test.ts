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
  applyMeasurementEdit,
  findPeriodCollision,
  isBaseline,
  measurementLabel,
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

describe("correction d'une mesure", () => {
  const base: IndicatorMeasurement = {
    id: "A",
    companyId: "c",
    indicatorId: "i",
    period: "2026-01",
    value: 5,
    note: "n",
    reportedBy: "u",
    reportedAt: "2026-01-02T00:00:00Z",
  };
  const b: IndicatorMeasurement = { ...base, id: "B", period: "2026-02", value: 6 };
  const other: IndicatorMeasurement = { ...base, id: "C", indicatorId: "j", period: "2026-03" };

  it("findPeriodCollision : même indicateur, autre mesure, période trimée", () => {
    const all = [base, b, other];
    expect(findPeriodCollision(all, "i", " 2026-02 ", "A")?.id).toBe("B");
    expect(findPeriodCollision(all, "i", "2026-02", "B")).toBeUndefined();
    expect(findPeriodCollision(all, "i", "2026-03", "A")).toBeUndefined();
    expect(findPeriodCollision(all, "i", "2026-01")?.id).toBe("A");
  });

  it("applyMeasurementEdit : conserve la saisie d'origine, pose updatedBy/At", () => {
    expect(applyMeasurementEdit(base, { value: 8 }, "v", "T")).toEqual({
      ...base,
      value: 8,
      updatedBy: "v",
      updatedAt: "T",
    });
    const cleared = applyMeasurementEdit(base, { note: "  ", period: " 2026-05 " }, "v", "T");
    expect(cleared).toEqual({
      id: "A",
      companyId: "c",
      indicatorId: "i",
      period: "2026-05",
      value: 5,
      reportedBy: "u",
      reportedAt: "2026-01-02T00:00:00Z",
      updatedBy: "v",
      updatedAt: "T",
    });
    expect(cleared && "note" in cleared).toBe(false);
    expect(applyMeasurementEdit(base, { value: null, note: null }, "v", "T")).toBeNull();
    expect(applyMeasurementEdit(base, { period: " " }, "v", "T")).toBeNull();
  });

  it("isBaseline / measurementLabel", () => {
    expect(isBaseline(base, [b, base])).toBe(true);
    expect(isBaseline(b, [b, base])).toBe(false);
    expect(measurementLabel({ value: 3 }, "%")).toBe("3 %");
    expect(measurementLabel({ note: "qual" })).toBe("qual");
    expect(measurementLabel({})).toBe("—");
  });
});
