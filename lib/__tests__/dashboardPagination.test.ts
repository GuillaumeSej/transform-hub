import { describe, expect, it } from "vitest";
import { paginateDashboardItems } from "@/lib/dashboardPagination";

describe("dashboardPagination", () => {
  it("returns every item across pages", () => {
    const items = Array.from({ length: 17 }, (_, index) => index + 1);
    expect(paginateDashboardItems(items, 0, 8).items).toEqual(items.slice(0, 8));
    expect(paginateDashboardItems(items, 1, 8).items).toEqual(items.slice(8, 16));
    expect(paginateDashboardItems(items, 2, 8).items).toEqual([17]);
  });

  it("clamps an obsolete page after filtering", () => {
    const result = paginateDashboardItems(["a", "b"], 4, 8);
    expect(result).toEqual({ items: ["a", "b"], page: 0, pageCount: 1 });
  });

  it("keeps a valid empty state", () => {
    expect(paginateDashboardItems([], 2, 0)).toEqual({ items: [], page: 0, pageCount: 1 });
  });
});
