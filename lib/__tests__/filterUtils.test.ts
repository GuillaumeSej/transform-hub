import { describe, it, expect } from "vitest";
import {
  toArray,
  matchesFilter,
  matchesAnyFilter,
  toggleInSelection,
  serializeFilterValues,
  parseFilterValues,
  summarizeSelection,
} from "@/lib/filterUtils";

describe("filterUtils", () => {
  it("normalise les anciennes valeurs simples", () => {
    expect(toArray("a")).toEqual(["a"]);
    expect(toArray(null)).toEqual([]);
    expect(toArray(["a", "a", ""])).toEqual(["a"]);
  });
  it("sélection vide = pas de filtre", () => {
    expect(matchesFilter("x", [])).toBe(true);
    expect(matchesFilter("x", ["x", "y"])).toBe(true);
    expect(matchesFilter("z", ["x", "y"])).toBe(false);
    expect(matchesFilter("x", "x")).toBe(true);
    expect(matchesAnyFilter(["a", "b"], ["b"])).toBe(true);
    expect(matchesAnyFilter([], ["b"])).toBe(false);
  });
  it("toggle", () => {
    expect(toggleInSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleInSelection(["a", "b"], "a")).toEqual(["b"]);
  });
  it("aller-retour URL, virgules dans les valeurs, rétro-compat", () => {
    const vals = ["Ops, IT", "Finance"];
    expect(parseFilterValues(serializeFilterValues(vals))).toEqual(vals);
    expect(parseFilterValues("Finance")).toEqual(["Finance"]);
    expect(parseFilterValues(null)).toEqual([]);
  });
  it("résumé", () => {
    expect(summarizeSelection([], "Tous")).toBe("Tous");
    expect(summarizeSelection(["a"], "Tous")).toBe("a");
    expect(summarizeSelection(["a", "b"], "Tous")).toBe("2 sélectionnés");
  });
});
