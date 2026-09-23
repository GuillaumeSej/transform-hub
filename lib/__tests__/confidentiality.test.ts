import { describe, expect, it } from "vitest";
import {
  accessibleLevels,
  isLevelAccessible,
  levelBelow,
  normalizeClearanceLevel,
  normalizeRoleClearance,
} from "@/lib/confidentiality";
import { isLeverVisibleForClearance, resolveConfidentialityClearance } from "@/lib/leversLogic";

// Ordered from least to most restricted (Company.confidentialityLevels convention).
const LEVELS = ["Public", "Restreint", "Confidentiel", "Secret"];

describe("confidentiality — normalizeClearanceLevel (backward compatibility)", () => {
  it("keeps a single known level as-is", () => {
    expect(normalizeClearanceLevel("Confidentiel", LEVELS)).toBe("Confidentiel");
  });

  it("normalizes a legacy array to its highest-access (most restricted) level", () => {
    expect(normalizeClearanceLevel(["Public", "Confidentiel"], LEVELS)).toBe("Confidentiel");
    expect(normalizeClearanceLevel(["Secret", "Public"], LEVELS)).toBe("Secret");
  });

  it("ignores unknown levels and returns undefined when nothing valid remains", () => {
    expect(normalizeClearanceLevel(["Obsolète", "Restreint"], LEVELS)).toBe("Restreint");
    expect(normalizeClearanceLevel(["Obsolète"], LEVELS)).toBeUndefined();
    expect(normalizeClearanceLevel("Obsolète", LEVELS)).toBeUndefined();
    expect(normalizeClearanceLevel([], LEVELS)).toBeUndefined();
    expect(normalizeClearanceLevel(undefined, LEVELS)).toBeUndefined();
    expect(normalizeClearanceLevel(null, LEVELS)).toBeUndefined();
  });

  it("normalizes a whole roleClearance map, dropping roles without a valid level", () => {
    expect(
      normalizeRoleClearance(
        { cto: ["Public", "Secret"], lever: "Restreint", finance: [], hr: ["Obsolète"] },
        LEVELS
      )
    ).toEqual({ cto: "Secret", lever: "Restreint" });
  });
});

describe("confidentiality — hierarchical access", () => {
  it("a level grants itself and every lower level", () => {
    expect(accessibleLevels("Confidentiel", LEVELS)).toEqual([
      "Public",
      "Restreint",
      "Confidentiel",
    ]);
    expect(accessibleLevels("Public", LEVELS)).toEqual(["Public"]);
    expect(accessibleLevels(undefined, LEVELS)).toEqual([]);
  });

  it("isLevelAccessible compares ranks (user >= item); unlevelled items are always visible", () => {
    expect(isLevelAccessible("Restreint", "Confidentiel", LEVELS)).toBe(true);
    expect(isLevelAccessible("Confidentiel", "Confidentiel", LEVELS)).toBe(true);
    expect(isLevelAccessible("Secret", "Confidentiel", LEVELS)).toBe(false);
    expect(isLevelAccessible(undefined, undefined, LEVELS)).toBe(true);
    expect(isLevelAccessible("Obsolète", "Secret", LEVELS)).toBe(false);
  });

  it("levelBelow returns the next lower level", () => {
    expect(levelBelow("Confidentiel", LEVELS)).toBe("Restreint");
    expect(levelBelow("Public", LEVELS)).toBeUndefined();
  });
});

describe("resolveConfidentialityClearance — hierarchical when the company scale is given", () => {
  it("expands a single individual level to all lower levels", () => {
    const user = { profiles: [{ role: "cto" as const }], confidentialityClearance: "Restreint" };
    expect(resolveConfidentialityClearance(user, {}, "performance", LEVELS)).toEqual([
      "Public",
      "Restreint",
    ]);
  });

  it("normalizes a legacy individual array to its max level, then expands", () => {
    const user = {
      profiles: [{ role: "cto" as const }],
      confidentialityClearance: ["Public", "Confidentiel"],
    };
    const clearance = resolveConfidentialityClearance(user, {}, "performance", LEVELS);
    // "Restreint" was never ticked in the legacy data but is now granted (lower than Confidentiel).
    expect(clearance).toEqual(["Public", "Restreint", "Confidentiel"]);
    expect(isLeverVisibleForClearance("Secret", clearance)).toBe(false);
  });

  it("keeps [] as 'no access' and 'all' as full access", () => {
    const none = { profiles: [{ role: "cto" as const }], confidentialityClearance: [] as string[] };
    expect(resolveConfidentialityClearance(none, { cto: "Secret" }, "performance", LEVELS)).toEqual(
      []
    );
    const all = { profiles: [{ role: "cto" as const }], confidentialityClearance: "all" as const };
    expect(resolveConfidentialityClearance(all, {}, "performance", LEVELS)).toBe("all");
  });

  it("role fallback takes the highest level across all of the user's profiles (legacy or new)", () => {
    const user = {
      profiles: [
        { role: "lever" as const, programId: "p1" },
        { role: "finance" as const, programId: "p2" },
      ],
      confidentialityClearance: undefined,
    };
    expect(
      resolveConfidentialityClearance(
        user,
        { lever: "Restreint", finance: ["Public", "Confidentiel"] },
        "performance",
        LEVELS
      )
    ).toEqual(["Public", "Restreint", "Confidentiel"]);
  });
});
