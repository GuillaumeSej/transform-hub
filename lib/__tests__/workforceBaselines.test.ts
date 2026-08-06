import { describe, expect, it } from "vitest";
import { mockData } from "@/data/mockData";

describe("workforce dimension baselines", () => {
  it("country and workstream baselines each reconcile to total FTE", () => {
    const countryTotal = (mockData.workforce.countryBaselines ?? []).reduce(
      (sum, row) => sum + row.fte,
      0
    );
    const workstreamTotal = (mockData.workforce.workstreamBaselines ?? []).reduce(
      (sum, row) => sum + row.fte,
      0
    );
    expect(countryTotal).toBe(mockData.workforce.totalFTE);
    expect(workstreamTotal).toBe(mockData.workforce.totalFTE);
  });
});
