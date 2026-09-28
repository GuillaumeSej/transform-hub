import { describe, expect, it } from "vitest";
import { budgetAxisIdOf, rollupBudgets } from "@/lib/budgetRollup";

const axes = [{ id: "A1" }, { id: "A2" }];
const chantiers = [
  { id: "C1", axisIds: ["A1"] },
  { id: "C2", axisIds: ["A2", "A1"] }, // multi-axe, primaire A2
  { id: "C3", axisIds: ["DELETED"] }, // aucun axe connu
];
const actions = [
  { id: "P1", chantierId: "C1", budget: 100, consumedBudget: 40 },
  { id: "P2", chantierId: "C1", budget: 50 },
  { id: "P3", chantierId: "C2", budget: 300, consumedBudget: 350 },
  { id: "P4", chantierId: "C3", budget: 7, consumedBudget: 1 },
  { id: "P5", chantierId: "UNKNOWN", budget: 9999, consumedBudget: 9999 },
];

describe("rollupBudgets", () => {
  const r = rollupBudgets(axes, chantiers, actions);

  it("projet = son propre budget/consommé (absent = 0)", () => {
    expect(r.projets.get("P1")).toEqual({ allocated: 100, consumed: 40 });
    expect(r.projets.get("P2")).toEqual({ allocated: 50, consumed: 0 });
  });

  it("chantier = somme de ses projets", () => {
    expect(r.chantiers.get("C1")).toEqual({ allocated: 150, consumed: 40 });
    expect(r.chantiers.get("C2")).toEqual({ allocated: 300, consumed: 350 });
  });

  it("chantier multi-axe attribué à son SEUL axe primaire (jamais double-compté)", () => {
    expect(r.axes.get("A1")).toEqual({ allocated: 150, consumed: 40 });
    expect(r.axes.get("A2")).toEqual({ allocated: 300, consumed: 350 });
    expect(r.chantierAxisId.get("C2")).toBe("A2");
  });

  it("programme = somme des projets distincts = somme des axes + sans axe", () => {
    expect(r.programme).toEqual({ allocated: 457, consumed: 391 });
    expect(r.unattributed).toEqual({ allocated: 7, consumed: 1 });
    let allocated = r.unattributed.allocated;
    let consumed = r.unattributed.consumed;
    r.axes.forEach((f) => {
      allocated += f.allocated;
      consumed += f.consumed;
    });
    expect({ allocated, consumed }).toEqual(r.programme);
  });

  it("ignore les projets dont le chantier est inconnu", () => {
    expect(r.projets.has("P5")).toBe(false);
  });

  it("chantier/axe sans projet = 0, entrées vides = 0", () => {
    expect(rollupBudgets(axes, [{ id: "C9", axisIds: ["A1"] }], []).axes.get("A1")).toEqual({
      allocated: 0,
      consumed: 0,
    });
    expect(rollupBudgets([], [], []).programme).toEqual({ allocated: 0, consumed: 0 });
  });
});

describe("rollupBudgets — chantier sans projet (audit STR-09)", () => {
  it("lit la saisie du chantier si aucun projet ne porte de budget, l'ignore sinon", () => {
    const r = rollupBudgets(
      [{ id: "A1" }],
      [
        { id: "C1", axisIds: ["A1"], allocatedBudget: 999, consumedBudget: 999 },
        { id: "RPA", axisIds: ["A1"], allocatedBudget: 1_100_000, consumedBudget: 385_000 },
      ],
      [
        { id: "P1", chantierId: "C1", budget: 100, consumedBudget: 40 },
        // Projet SANS budget : le chantier garde sa saisie propre (cas réel de CH-rpa).
        { id: "P2", chantierId: "RPA" },
      ]
    );
    expect(r.chantiers.get("C1")).toEqual({ allocated: 100, consumed: 40 });
    expect(r.chantiers.get("RPA")).toEqual({ allocated: 1_100_000, consumed: 385_000 });
    expect(r.axes.get("A1")).toEqual({ allocated: 1_100_100, consumed: 385_040 });
    expect(r.programme).toEqual({ allocated: 1_100_100, consumed: 385_040 });
  });
});

describe("budgetAxisIdOf", () => {
  it("premier axe de axisIds présent dans la liste connue", () => {
    expect(budgetAxisIdOf({ axisIds: ["X", "A2", "A1"] }, new Set(["A1", "A2"]))).toBe("A2");
    expect(budgetAxisIdOf({ axisIds: ["X"] }, new Set(["A1"]))).toBeUndefined();
  });
});
