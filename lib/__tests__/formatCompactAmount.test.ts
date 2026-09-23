import { describe, expect, it } from "vitest";
import { formatCompactCurrency, formatPercent } from "@/lib/formatCompactAmount";

/** Espaces insécables (U+00A0 / U+202F) normalisés pour des assertions lisibles. */
const norm = (s: string) => s.replace(/[  ]/g, " ");

describe("formatCompactCurrency", () => {
  it("formate en millions compacts selon la locale", () => {
    expect(norm(formatCompactCurrency(7_732_500, "EUR", "fr"))).toBe("7,7 M €");
    expect(norm(formatCompactCurrency(7_732_500, "EUR", "en"))).toBe("€7.7M");
  });

  it("respecte le nombre de décimales demandé", () => {
    expect(norm(formatCompactCurrency(23_550_000, "EUR", "fr", 2))).toBe("23,55 M €");
  });

  it("retombe sur un suffixe brut pour une devise non ISO", () => {
    expect(norm(formatCompactCurrency(2_000_000, "Points", "fr"))).toBe("2 M Points");
  });
});

describe("formatPercent", () => {
  it("formate un ratio selon la locale", () => {
    expect(norm(formatPercent(0.328, "fr"))).toBe("33 %");
    expect(formatPercent(0.328, "en")).toBe("33%");
    expect(norm(formatPercent(0.0753, "fr", 1))).toBe("7,5 %");
  });
});
