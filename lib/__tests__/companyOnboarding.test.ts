import { describe, expect, it } from "vitest";
import {
  computeCompanyOnboardingSteps,
  countConfidentialityLevelUsage,
  isActiveCompanyAdmin,
  moveLevel,
  renameLevel,
} from "@/lib/companyOnboarding";

const byId = (steps: ReturnType<typeof computeCompanyOnboardingSteps>) =>
  Object.fromEntries(steps.map((s) => [s.id, s]));

describe("computeCompanyOnboardingSteps", () => {
  it("brand-new company: only step 1 done", () => {
    const steps = computeCompanyOnboardingSteps({
      company: { id: "c1", confidentialityLevels: [] },
      users: [],
      programs: [],
      axes: [],
    });
    expect(steps.map((s) => s.id)).toEqual([
      "company",
      "companyAdmin",
      "settings",
      "confidentiality",
      "strategicPlan",
    ]);
    expect(steps.map((s) => s.done)).toEqual([true, false, false, false, false]);
  });

  it("no company: nothing done", () => {
    const steps = computeCompanyOnboardingSteps({
      company: null,
      users: [{ companyId: "c1", isCompanyAdmin: true }],
      programs: [{ id: "p1", companyId: "c1" }],
      axes: [],
    });
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it("fully set up company: all done, counts scoped to the company", () => {
    const steps = byId(
      computeCompanyOnboardingSteps({
        company: { id: "c1", confidentialityLevels: ["Public", "Secret"] },
        users: [
          { companyId: "c1", isCompanyAdmin: true },
          { companyId: "c1", isCompanyAdmin: false },
          { companyId: "c2", isCompanyAdmin: true },
        ],
        programs: [
          { id: "p1", companyId: "c1", type: "strategic" },
          { id: "p2", companyId: "c1" },
          { id: "p3", companyId: "c2", type: "strategic" },
        ],
        axes: [
          { companyId: "c1", programId: "p1" },
          { companyId: "c1", programId: "p1" },
          { companyId: "c2", programId: "p3" },
        ],
      })
    );
    expect(steps.companyAdmin).toEqual({ id: "companyAdmin", done: true, count: 1 });
    expect(steps.settings.count).toBe(2);
    expect(steps.confidentiality).toEqual({ id: "confidentiality", done: true, count: 2 });
    expect(steps.strategicPlan).toEqual({ id: "strategicPlan", done: true, count: 2 });
  });

  it("disabled admins and legacy role format", () => {
    const disabledOnly = byId(
      computeCompanyOnboardingSteps({
        company: { id: "c1" },
        users: [{ companyId: "c1", isCompanyAdmin: true, disabled: true }],
        programs: [],
        axes: [],
      })
    );
    expect(disabledOnly.companyAdmin.done).toBe(false);
    const legacy = { companyId: "c1", role: "admin_entreprise" } as never;
    expect(
      byId(
        computeCompanyOnboardingSteps({
          company: { id: "c1" },
          users: [legacy],
          programs: [],
          axes: [],
        })
      ).companyAdmin.done
    ).toBe(true);
  });

  it("strategic plan requires an axis on a STRATEGIC program", () => {
    const steps = byId(
      computeCompanyOnboardingSteps({
        company: { id: "c1" },
        users: [],
        programs: [{ id: "perf", companyId: "c1", type: "performance" }],
        axes: [{ companyId: "c1", programId: "perf" }],
      })
    );
    expect(steps.settings.done).toBe(true);
    expect(steps.strategicPlan.done).toBe(false);
  });

  it("blank level names do not count", () => {
    const steps = byId(
      computeCompanyOnboardingSteps({
        company: { id: "c1", confidentialityLevels: ["  "] },
        users: [],
        programs: [],
        axes: [],
      })
    );
    expect(steps.confidentiality.done).toBe(false);
  });
});

describe("isActiveCompanyAdmin", () => {
  it("flags", () => {
    expect(isActiveCompanyAdmin({ isCompanyAdmin: true })).toBe(true);
    expect(isActiveCompanyAdmin({ isCompanyAdmin: false })).toBe(false);
    expect(isActiveCompanyAdmin({ isCompanyAdmin: true, disabled: true })).toBe(false);
  });
});

describe("countConfidentialityLevelUsage", () => {
  it("counts entities and individual clearances by level name", () => {
    const usage = countConfidentialityLevelUsage({
      levers: [{ confidentialityLevel: "Secret" }, {}],
      axes: [{ confidentialityLevel: "Secret" }],
      chantiers: [{ confidentialityLevel: "Restreint" }],
      indicators: [{ confidentialityLevel: null }],
      users: [
        { confidentialityClearance: "all" },
        { confidentialityClearance: "Restreint" },
        { confidentialityClearance: ["Secret", "Secret"] },
        {},
      ],
    });
    expect(usage).toEqual({ Secret: 3, Restreint: 2 });
  });

  it("empty sources", () => {
    expect(countConfidentialityLevelUsage({})).toEqual({});
  });
});

describe("moveLevel", () => {
  it("swaps with neighbour, ignores out-of-bounds moves", () => {
    expect(moveLevel(["A", "B", "C"], 1, -1)).toEqual(["B", "A", "C"]);
    expect(moveLevel(["A", "B", "C"], 1, 1)).toEqual(["A", "C", "B"]);
    expect(moveLevel(["A", "B"], 0, -1)).toEqual(["A", "B"]);
    expect(moveLevel(["A", "B"], 1, 1)).toEqual(["A", "B"]);
  });
});

describe("renameLevel", () => {
  it("renames in the scale and in the role clearance matrix (new + legacy formats)", () => {
    const result = renameLevel(
      ["Public", "Secret"],
      { cto: "Secret", finance: ["Public", "Secret"], hr: "Public" },
      "Secret",
      " Très secret "
    );
    expect(result).toEqual({
      levels: ["Public", "Très secret"],
      roleClearance: { cto: "Très secret", finance: ["Public", "Très secret"], hr: "Public" },
    });
  });

  it("rejects empty, duplicate or unknown names", () => {
    expect(renameLevel(["A", "B"], {}, "A", "  ")).toBeNull();
    expect(renameLevel(["A", "B"], {}, "A", "B")).toBeNull();
    expect(renameLevel(["A", "B"], {}, "Z", "C")).toBeNull();
  });
});
