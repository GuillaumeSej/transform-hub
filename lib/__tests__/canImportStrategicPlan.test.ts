import { describe, expect, it } from "vitest";
import { canImportStrategicPlan } from "@/lib/roleProfiles";

describe("canImportStrategicPlan", () => {
  it("allows global admin, company admin and strategic lead", () => {
    expect(canImportStrategicPlan({ isGlobalAdmin: true }, undefined)).toBe(true);
    expect(canImportStrategicPlan({ isCompanyAdmin: true }, undefined)).toBe(true);
    expect(canImportStrategicPlan({}, "strategic_lead")).toBe(true);
  });

  it("denies every other strategic profile", () => {
    for (const role of [
      "axis_sponsor",
      "chantier_owner",
      "chantier_contributor",
      "comex_member",
    ] as const) {
      expect(canImportStrategicPlan({}, role)).toBe(false);
    }
    expect(canImportStrategicPlan(null, undefined)).toBe(false);
  });
});
