import { describe, expect, it } from "vitest";
import { buildClearancePatch } from "@/components/admin/UsersPanel";

describe("UsersPanel — buildClearancePatch", () => {
  it('omits the key entirely (never sets it to `undefined`) for mode "inherit"', () => {
    const patch = buildClearancePatch("cto", "inherit", []);
    expect(patch).toEqual({});
    expect("confidentialityClearance" in patch).toBe(false);
  });

  it('returns "all" for mode "all", even including levels the role would not normally see', () => {
    expect(buildClearancePatch("lever", "all", [])).toEqual({
      confidentialityClearance: "all",
    });
  });

  it('returns an empty array for mode "none"', () => {
    expect(buildClearancePatch("cto", "none", ["public", "secret"])).toEqual({
      confidentialityClearance: [],
    });
  });

  it(
    'returns the selected levels verbatim for mode "custom" — this is what lets an admin grant a ' +
      "profile MORE access than its role default (additive override, not clamped to the role's levels)",
    () => {
      expect(buildClearancePatch("lever", "custom", ["public", "secret", "top-secret"])).toEqual({
        confidentialityClearance: ["public", "secret", "top-secret"],
      });
    }
  );

  it("has no effect for admin/admin_entreprise (total access regardless of mode)", () => {
    expect(buildClearancePatch("admin", "custom", ["secret"])).toEqual({});
    expect(buildClearancePatch("admin_entreprise", "all", [])).toEqual({});
    expect(buildClearancePatch("admin", "none", [])).toEqual({});
  });
});
