import { describe, expect, it } from "vitest";
import {
  departmentContributors,
  isUnfavourableGap,
  shareOfTotal,
  sumAbs,
  topContributors,
} from "@/lib/hrChartPreview";
import { fteEffect } from "@/lib/hrEngine";
import type { WorkforceMovement } from "@/types";

function makeMovement(overrides: Partial<WorkforceMovement>): WorkforceMovement {
  return {
    id: "M001",
    empId: null,
    label: "Test",
    leverId: "L001",
    type: "Départ forcé",
    fte: 1,
    department: "IT",
    country: "France",
    hrOwner: "HR",
    plannedDate: "2026-03-01",
    actualDate: null,
    status: "Planifié",
    hrValidated: false,
    salaryImpact: -50000,
    savings: 50000,
    cost: 10000,
    ...overrides,
  };
}

describe("hrChartPreview — shareOfTotal / sumAbs", () => {
  it("returns the share in points, using absolute values", () => {
    expect(shareOfTotal(25, 100)).toBe(25);
    expect(shareOfTotal(-5, 20)).toBe(25);
    expect(shareOfTotal(5, -20)).toBe(25);
  });

  it("returns null for a zero or non-finite total", () => {
    expect(shareOfTotal(3, 0)).toBeNull();
    expect(shareOfTotal(3, Number.NaN)).toBeNull();
    expect(shareOfTotal(Number.POSITIVE_INFINITY, 10)).toBeNull();
  });

  it("sums absolute values and ignores non-finite ones", () => {
    expect(sumAbs([3, -2, Number.NaN, 0.5])).toBe(5.5);
    expect(sumAbs([])).toBe(0);
  });
});

describe("hrChartPreview — topContributors", () => {
  it("groups, sorts by absolute value and keeps the top 3", () => {
    const items = [
      { k: "A", v: 1 },
      { k: "B", v: -5 },
      { k: "A", v: 2 },
      { k: "C", v: 4 },
      { k: "D", v: 0.5 },
    ];
    expect(
      topContributors(
        items,
        (i) => i.k,
        (i) => i.v
      )
    ).toEqual([
      { key: "B", label: "B", value: -5 },
      { key: "C", label: "C", value: 4 },
      { key: "A", label: "A", value: 3 },
    ]);
  });

  it("drops zero contributions, excluded keys and maps empty keys to « Non renseigné »", () => {
    const items = [
      { k: "A", v: 2 },
      { k: "A", v: -2 },
      { k: "", v: 1 },
      { k: "Self", v: 9 },
    ];
    expect(
      topContributors(
        items,
        (i) => i.k,
        (i) => i.v,
        { exclude: ["Self"] }
      )
    ).toEqual([{ key: "Non renseigné", label: "Non renseigné", value: 1 }]);
  });

  it("honours a custom limit and breaks ties by label", () => {
    const items = [
      { k: "Z", v: 1 },
      { k: "M", v: 1 },
      { k: "A", v: 1 },
    ];
    expect(
      topContributors(
        items,
        (i) => i.k,
        (i) => i.v,
        { limit: 2 }
      ).map((c) => c.key)
    ).toEqual(["A", "M"]);
  });
});

describe("hrChartPreview — departmentContributors", () => {
  it("ranks departments by the signed FTE effect of their movements", () => {
    const movements = [
      makeMovement({ id: "1", department: "IT", type: "Départ forcé", fte: 2 }),
      makeMovement({ id: "2", department: "Finance", type: "Recrutement", fte: 1 }),
      makeMovement({ id: "3", department: "IT", type: "Attrition", fte: 1 }),
      makeMovement({ id: "4", department: "RH", type: "Transfert sortant", fte: 3 }),
    ];
    expect(departmentContributors(movements, fteEffect)).toEqual([
      { key: "IT", label: "IT", value: -3 },
      { key: "Finance", label: "Finance", value: 1 },
    ]);
  });
});

describe("hrChartPreview — isUnfavourableGap", () => {
  it("flags a shortfall when higher is better (savings)", () => {
    expect(isUnfavourableGap(-0.2)).toBe(true);
    expect(isUnfavourableGap(0.2)).toBe(false);
  });

  it("flags an overrun when lower is better (costs)", () => {
    expect(isUnfavourableGap(0.2, false)).toBe(true);
    expect(isUnfavourableGap(-0.2, false)).toBe(false);
  });

  it("never flags a zero or non-finite gap", () => {
    expect(isUnfavourableGap(0)).toBe(false);
    expect(isUnfavourableGap(Number.NaN, false)).toBe(false);
  });
});
