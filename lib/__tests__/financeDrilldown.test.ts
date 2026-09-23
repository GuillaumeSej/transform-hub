import { describe, expect, it } from "vitest";
import {
  drillLevelInfo,
  popDrillPath,
  pruneDrillPath,
  shouldDrillDown,
  truncateDrillPath,
  type DrillStep,
} from "@/lib/financeDrilldown";

const path: DrillStep[] = [
  { id: "pnl-1", label: "Compte P&L 1" },
  { id: "agg-1", label: "Agrégat 1" },
  { id: "cc-1", label: "Centre de coût 1" },
];

describe("drillLevelInfo", () => {
  it("renvoie niveau 1/N à la racine", () => {
    expect(drillLevelInfo(0, 3)).toEqual({
      levelNumber: 1,
      totalLevels: 3,
      remaining: 2,
      isLastLevel: false,
    });
  });

  it("signale le dernier niveau", () => {
    expect(drillLevelInfo(2, 3)).toMatchObject({ levelNumber: 3, remaining: 0, isLastLevel: true });
  });

  it("borne la profondeur si la config a moins de niveaux que le chemin", () => {
    expect(drillLevelInfo(5, 2)).toMatchObject({ levelNumber: 2, isLastLevel: true });
    expect(drillLevelInfo(0, 0)).toMatchObject({ levelNumber: 1, totalLevels: 1 });
  });
});

describe("shouldDrillDown", () => {
  it("descend si enfants et niveau suivant disponible", () => {
    expect(shouldDrillDown(0, 3, true)).toBe(true);
    expect(shouldDrillDown(1, 3, true)).toBe(true);
  });

  it("ouvre le détail au dernier niveau ou sans enfants", () => {
    expect(shouldDrillDown(2, 3, true)).toBe(false);
    expect(shouldDrillDown(0, 3, false)).toBe(false);
  });
});

describe("truncateDrillPath / popDrillPath", () => {
  it("-1 ramène à la racine", () => {
    expect(truncateDrillPath(path, -1)).toEqual([]);
  });

  it("garde les étapes jusqu'à la miette cliquée incluse", () => {
    expect(truncateDrillPath(path, 0)).toEqual([path[0]]);
    expect(truncateDrillPath(path, 1)).toEqual([path[0], path[1]]);
  });

  it("pop remonte d'un niveau et reste stable à la racine", () => {
    expect(popDrillPath(path)).toEqual([path[0], path[1]]);
    expect(popDrillPath([])).toEqual([]);
  });
});

describe("pruneDrillPath", () => {
  it("conserve le chemin si toutes les étapes existent", () => {
    expect(pruneDrillPath(path, () => true)).toBe(path);
  });

  it("coupe au premier élément introuvable", () => {
    expect(pruneDrillPath(path, (step) => step.id !== "agg-1")).toEqual([path[0]]);
    expect(pruneDrillPath(path, (_s, depth) => depth < 2)).toEqual([path[0], path[1]]);
  });
});
