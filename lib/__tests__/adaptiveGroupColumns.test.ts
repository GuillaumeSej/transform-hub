import { describe, expect, it } from "vitest";
import { computeGroupColumns, groupBlockWidth } from "@/lib/hooks/useAdaptiveGroupColumns";

const MOVEMENT = {
  cellWidth: 20,
  cellGap: 4,
  groupGap: 12,
  groupChrome: 14,
  minCols: 4,
  maxCols: 20,
};

describe("computeGroupColumns", () => {
  it("élargit un groupe unique jusqu'au plafond (bloc large et bas)", () => {
    expect(
      computeGroupColumns({ ...MOVEMENT, groupCount: 1, maxCells: 60, containerWidth: 1000 })
    ).toBe(20);
  });

  it("garde des colonnes compactes quand il y a beaucoup de groupes", () => {
    expect(
      computeGroupColumns({ ...MOVEMENT, groupCount: 12, maxCells: 30, containerWidth: 1000 })
    ).toBe(4);
  });

  it("réduit les colonnes à mesure que le nombre de groupes augmente", () => {
    const one = computeGroupColumns({
      ...MOVEMENT,
      groupCount: 1,
      maxCells: 80,
      containerWidth: 900,
    });
    const three = computeGroupColumns({
      ...MOVEMENT,
      groupCount: 3,
      maxCells: 80,
      containerWidth: 900,
    });
    expect(one).toBeGreaterThan(three);
    expect(three).toBeGreaterThanOrEqual(4);
  });

  it("ne dépasse pas le nombre de tuiles et équilibre la dernière ligne", () => {
    expect(
      computeGroupColumns({ ...MOVEMENT, groupCount: 1, maxCells: 6, containerWidth: 1000 })
    ).toBe(6);
    // 21 tuiles, plafond 20 → 2 lignes → 11 colonnes plutôt que 20 + 1.
    expect(
      computeGroupColumns({ ...MOVEMENT, groupCount: 1, maxCells: 21, containerWidth: 1000 })
    ).toBe(11);
  });

  it("utilise la largeur de repli avant la première mesure", () => {
    expect(
      computeGroupColumns({ ...MOVEMENT, groupCount: 2, maxCells: 40, containerWidth: 0 })
    ).toBeGreaterThan(4);
  });

  it("calcule la largeur d'un bloc", () => {
    expect(groupBlockWidth(4, MOVEMENT)).toBe(4 * 20 + 3 * 4 + 14);
  });
});
