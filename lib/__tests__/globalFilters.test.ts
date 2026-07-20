import { describe, it, expect } from "vitest";
import { matchesGlobalFilters, type GlobalFilters } from "@/lib/hooks/useGlobalFilters";

const EMPTY_FILTERS: GlobalFilters = {
  f_status: "",
  f_ws: "",
  f_function: "",
  f_geography: "",
  f_country: "",
  f_owner: "",
  f_type: "",
  f_priority: "",
  f_risk: "",
  f_endMonth: "",
  f_endQuarter: "",
};

const sampleLever = {
  status: "in_progress",
  ws: "WS-01",
  function: "IT",
  geography: "Europe",
  country: "France",
  owner: "John Doe",
  type: "Digital",
  priority: "high",
  risk: "medium",
  end: "2026-09-15",
};

describe("matchesGlobalFilters", () => {
  it("returns true when no filters are active", () => {
    expect(matchesGlobalFilters(sampleLever, EMPTY_FILTERS)).toBe(true);
  });

  it("filters by status", () => {
    const filters = { ...EMPTY_FILTERS, f_status: "in_progress" };
    expect(matchesGlobalFilters(sampleLever, filters)).toBe(true);
    filters.f_status = "idea";
    expect(matchesGlobalFilters(sampleLever, filters)).toBe(false);
  });

  it("filters by workstream", () => {
    const filters = { ...EMPTY_FILTERS, f_ws: "WS-01" };
    expect(matchesGlobalFilters(sampleLever, filters)).toBe(true);
    filters.f_ws = "WS-02";
    expect(matchesGlobalFilters(sampleLever, filters)).toBe(false);
  });

  it("filters by function", () => {
    const filters = { ...EMPTY_FILTERS, f_function: "IT" };
    expect(matchesGlobalFilters(sampleLever, filters)).toBe(true);
    filters.f_function = "HR";
    expect(matchesGlobalFilters(sampleLever, filters)).toBe(false);
  });

  it("filters by geography", () => {
    const filters = { ...EMPTY_FILTERS, f_geography: "Europe" };
    expect(matchesGlobalFilters(sampleLever, filters)).toBe(true);
    filters.f_geography = "APAC";
    expect(matchesGlobalFilters(sampleLever, filters)).toBe(false);
  });

  it("filters by end month", () => {
    const filters = { ...EMPTY_FILTERS, f_endMonth: "Sep 2026" };
    expect(matchesGlobalFilters(sampleLever, filters)).toBe(true);
    filters.f_endMonth = "Dec 2026";
    expect(matchesGlobalFilters(sampleLever, filters)).toBe(false);
  });

  it("filters by end quarter", () => {
    const filters = { ...EMPTY_FILTERS, f_endQuarter: "Q3 2026" };
    expect(matchesGlobalFilters(sampleLever, filters)).toBe(true);
    filters.f_endQuarter = "Q4 2026";
    expect(matchesGlobalFilters(sampleLever, filters)).toBe(false);
  });

  it("combines multiple filters", () => {
    const filters = {
      ...EMPTY_FILTERS,
      f_status: "in_progress",
      f_function: "IT",
      f_country: "France",
    };
    expect(matchesGlobalFilters(sampleLever, filters)).toBe(true);
    filters.f_country = "Germany";
    expect(matchesGlobalFilters(sampleLever, filters)).toBe(false);
  });
});
