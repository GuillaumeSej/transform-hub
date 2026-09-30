import { describe, expect, it } from "vitest";
import { axisColorMap, firstFreeAxisColor } from "@/lib/axisLogic";

describe("couleur d'affichage des axes — couleur charte la plus proche", () => {
  it("remplace chaque couleur historique par la couleur charte libre la plus proche", () => {
    const map = axisColorMap([
      { id: "AX-excop", color: "#7B1E1E", programId: "P1" }, // rouge foncé
      { id: "AX-talents", color: "#8A6D5C", programId: "P1" }, // brun
    ]);
    expect(map.get("AX-excop")).toBe("#991D1F"); // rouge brique
    expect(map.get("AX-talents")).toBe("#806659"); // brun chaud
  });

  it("ne donne jamais la même couleur à deux axes d'un programme tant que la palette suffit", () => {
    const map = axisColorMap([
      { id: "A", color: "#7B1E1E", programId: "P1" },
      { id: "B", color: "#7A1D1D", programId: "P1" },
    ]);
    expect(map.get("A")).not.toBe(map.get("B"));
  });

  it("propose pour un nouvel axe la première couleur charte encore libre", () => {
    expect(firstFreeAxisColor([{ id: "A", color: "#320300", programId: "P1" }])).toBe("#FF3C47");
    expect(firstFreeAxisColor([])).toBe("#320300");
  });
});
