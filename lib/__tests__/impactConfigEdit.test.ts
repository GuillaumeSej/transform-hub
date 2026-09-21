import { describe, expect, it } from "vitest";
import {
  addLeverType,
  addNature,
  cleanNatures,
  countLeversByNature,
  countLeversByType,
  moveItem,
  renameLeverType,
  updateNature,
} from "../impactConfigEdit";

describe("impactConfigEdit", () => {
  it("moveItem réordonne", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a"], 0, 3)).toEqual(["a"]);
  });
  it("addLeverType dédoublonne", () => {
    expect(addLeverType(["A"], " a ")).toEqual(["A"]);
    expect(addLeverType(["A"], " B ")).toEqual(["A", "B"]);
  });
  it("renameLeverType refuse doublon/vide", () => {
    expect(renameLeverType(["A", "B"], 0, "b")).toEqual(["A", "B"]);
    expect(renameLeverType(["A", "B"], 0, "C")).toEqual(["C", "B"]);
  });
  it("comptages", () => {
    expect(countLeversByType([{ type: "A" }, { type: "A" }, {}])).toEqual({ A: 2 });
    expect(
      countLeversByNature([
        { impacts: [{ natureId: "x" }, { natureId: "x" }] },
        { impacts: [{ natureId: "x" }, {}] },
      ])
    ).toEqual({ x: 2 });
  });
  it("id de nature stable au renommage", () => {
    const l = addNature([], "Énergie verte", "cost", () => 0.5);
    expect(l[0].id).toMatch(/^nat-energie-verte-/);
    const r = updateNature(l, l[0].id, { label: "Autre", appliesTo: "both" });
    expect(r[0]).toEqual({ id: l[0].id, label: "Autre", appliesTo: "both" });
    expect(cleanNatures([{ ...r[0], label: " " }])).toEqual([]);
  });
});
