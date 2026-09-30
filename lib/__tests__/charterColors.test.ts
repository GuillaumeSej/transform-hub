import { describe, expect, it } from "vitest";
import { CHARTER_CATEGORICAL, CHARTER_COLORS, toCharterColor } from "../charterColors";

const CHARTER = new Set<string>(Object.values(CHARTER_COLORS));

describe("toCharterColor", () => {
  it("keeps charter colors (case-insensitive, normalised to upper case)", () => {
    expect(toCharterColor("#ff3c47")).toBe("#FF3C47");
    expect(toCharterColor("#421799")).toBe("#421799");
    expect(toCharterColor("#806659")).toBe("#806659");
  });

  it("passes CSS variable references through", () => {
    expect(toCharterColor("var(--bp-warm-taupe)")).toBe("var(--bp-warm-taupe)");
  });

  it("falls back on missing / unreadable values", () => {
    expect(toCharterColor(undefined)).toBe(CHARTER_COLORS.warmTaupe);
    expect(toCharterColor("")).toBe(CHARTER_COLORS.warmTaupe);
    expect(toCharterColor("blueviolet")).toBe(CHARTER_COLORS.warmTaupe);
    expect(toCharterColor(null, CHARTER_COLORS.ink)).toBe(CHARTER_COLORS.ink);
  });

  it("maps legacy off-charter colors to a charter hue family", () => {
    // Anciens défauts admin / palette d'auto-création de l'import Excel leviers.
    expect(toCharterColor("#e5484d")).toBe(CHARTER_COLORS.coralPink);
    expect(toCharterColor("#C8102E")).toBe(CHARTER_COLORS.redBrick);
    expect(toCharterColor("#5B7A9A")).toBe(CHARTER_COLORS.purple);
    expect(toCharterColor("#3b82f6")).toBe(CHARTER_COLORS.purple);
    expect(toCharterColor("#8a2be2")).toBe(CHARTER_COLORS.purple);
    expect(toCharterColor("#4A4A4A")).toBe(CHARTER_COLORS.warmBrown);
    expect(toCharterColor("#8A9A5B")).toBe(CHARTER_COLORS.warmBrown);
    expect(toCharterColor("#f5a623")).toBe(CHARTER_COLORS.warmTaupe);
    expect(toCharterColor("#fff")).toBe(CHARTER_COLORS.warmGray);
  });

  it("always returns a charter color for any hex input", () => {
    for (let i = 0; i < 4096; i += 7) {
      const hex = "#" + i.toString(16).padStart(3, "0");
      expect(CHARTER.has(toCharterColor(hex))).toBe(true);
    }
  });

  it("is deterministic and idempotent", () => {
    for (const c of ["#e5484d", "#2E7D32", "#7C6EF0", "#B8A99A"]) {
      const once = toCharterColor(c);
      expect(toCharterColor(c)).toBe(once);
      expect(toCharterColor(once)).toBe(once);
    }
  });

  it("categorical palette only holds charter colors and excludes the risk coral", () => {
    expect(CHARTER_CATEGORICAL.every((c) => CHARTER.has(c))).toBe(true);
    expect(CHARTER_CATEGORICAL).not.toContain(CHARTER_COLORS.coral);
  });
});
