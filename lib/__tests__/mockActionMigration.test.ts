import { describe, expect, it } from "vitest";
import { mockData, legacySubLevers } from "@/data/mockData";
import { migrateMockLeversToActions } from "@/lib/mockActionMigration";

describe("mockActionMigration", () => {
  const migrated = migrateMockLeversToActions(mockData.levers, legacySubLevers);

  it("creates enriched actions for every lever", () => {
    expect(migrated).toHaveLength(mockData.levers.length);
    migrated.forEach((lever) => {
      expect(lever.actions?.length ?? 0).toBeGreaterThan(0);
      expect((lever.actions ?? []).some((action) => (action.impacts ?? []).length > 0)).toBe(true);
    });
  });

  it("keeps action and impact ids unique", () => {
    const actionIds = migrated.flatMap((lever) => (lever.actions ?? []).map((action) => action.id));
    const impactIds = migrated.flatMap((lever) =>
      (lever.actions ?? []).flatMap((action) => (action.impacts ?? []).map((impact) => impact.id))
    );
    expect(new Set(actionIds).size).toBe(actionIds.length);
    expect(new Set(impactIds).size).toBe(impactIds.length);
  });

  it("preserves already enriched user actions exactly", () => {
    const enriched = migrated[0];
    const edited = {
      ...enriched,
      actions: (enriched.actions ?? []).map((action, index) =>
        index === 0
          ? {
              ...action,
              name: "Action modifiée par l'utilisateur",
              impacts: (action.impacts ?? []).map((impact, impactIndex) =>
                impactIndex === 0 ? { ...impact, amount: impact.amount + 0.37 } : impact
              ),
            }
          : action
      ),
    };
    const remigrated = migrateMockLeversToActions([edited], []);
    expect(remigrated[0].actions).toEqual(edited.actions);
  });

  it("preserves parent lever KPIs and progress", () => {
    migrated.forEach((lever) => {
      const original = mockData.levers.find((candidate) => candidate.id === lever.id)!;
      expect(lever.progress).toBe(original.progress);
      expect(lever.netSavings).toBe(original.netSavings);
      expect(lever.capex).toBe(original.capex);
      expect(lever.opexOneOff).toBe(original.opexOneOff);
      expect(lever.opexRec).toBe(original.opexRec);
      expect(lever.fteImpact).toBe(original.fteImpact);
    });
  });

  it("preserves former sub-lever actions and enriches each with impacts", () => {
    const parentIds = new Set(legacySubLevers.map((sub) => sub.leverId));
    parentIds.forEach((leverId) => {
      const expected = legacySubLevers
        .filter((sub) => sub.leverId === leverId)
        .reduce((sum, sub) => sum + Math.max(1, sub.actions.length), 0);
      const lever = migrated.find((candidate) => candidate.id === leverId)!;
      expect(lever.actions).toHaveLength(expected);
    });
  });

  it("preserves each parent lever net savings after consolidating migrated actions", () => {
    // netSavings = savings − opexRec (voir lib/leverConsolidate.ts) : le CAPEX et l'OPEX one-off
    // ne rentrent plus dans le calcul, seul l'OPEX récurrent est déduit des savings.
    const round = (value: number) => Math.round(value * 100) / 100;
    migrated.forEach((lever) => {
      const net = (lever.actions ?? []).reduce(
        (sum, action) =>
          sum +
          (action.impacts ?? []).reduce((actionSum, impact) => {
            if (impact.type === "saving") return actionSum + impact.amount;
            if (impact.nature === "opex_rec") return actionSum - impact.amount;
            return actionSum;
          }, 0),
        0
      );
      expect(round(net)).toBe(round(lever.netSavings));
    });
  });

  it("reconciles every migrated lever's impacts to the cent with its own financial fields", () => {
    // Garde-fou de non-régression : pour CHAQUE levier du seed (pas un exemple isolé), la somme des
    // impacts d'actions (correctement signés/typés, convention netSavings = savings − opexRec de
    // lib/leverConsolidate.ts) doit reconstituer exactement capex/opexOneOff/opexRec/netSavings tels
    // que saisis sur le levier — à la faveur de `alignActionsToLeverFinancials`, qui corrige tout
    // écart de répartition/arrondi en fin de migration.
    const round = (value: number) => Math.round(value * 100) / 100;
    migrated.forEach((lever) => {
      const actions = lever.actions ?? [];
      let saving = 0;
      let capex = 0;
      let opexOneOff = 0;
      let opexRec = 0;
      for (const action of actions) {
        for (const impact of action.impacts ?? []) {
          if (impact.type === "saving") saving += impact.amount;
          else if (impact.nature === "capex") capex += impact.amount;
          else if (impact.nature === "oneoff") opexOneOff += impact.amount;
          else if (impact.nature === "opex_rec") opexRec += impact.amount;
        }
      }
      expect(round(saving - opexRec)).toBe(round(lever.netSavings));
      expect(round(capex)).toBe(round(lever.capex));
      expect(round(opexOneOff)).toBe(round(lever.opexOneOff));
      expect(round(opexRec)).toBe(round(lever.opexRec));
    });
  });

  it("never folds a positive (recruitment) fteImpact onto a saving impact line", () => {
    // Un fteImpact positif est un coût (recrutement), jamais un gain financier : il doit être porté
    // par une ligne de coût (opex_rec), pas par la ligne de savings — voir mockActionMigration.ts.
    migrated
      .filter((lever) => lever.fteImpact > 0)
      .forEach((lever) => {
        const savingFte = (lever.actions ?? [])
          .flatMap((action) => action.impacts ?? [])
          .filter((impact) => impact.type === "saving")
          .reduce((sum, impact) => sum + (impact.fteCount ?? 0), 0);
        expect(savingFte).toBe(0);

        const costFte = (lever.actions ?? [])
          .flatMap((action) => action.impacts ?? [])
          .filter((impact) => impact.type === "cost" && impact.nature === "opex_rec")
          .reduce((sum, impact) => sum + (impact.fteCount ?? 0), 0);
        expect(costFte).toBe(lever.fteImpact);
      });
  });

  it("promotes legacy sub-lever dependencies to parent levers", () => {
    const source = {
      ...mockData.levers[0],
      id: "L-A",
      dependencies: [],
    };
    const target = {
      ...mockData.levers[1],
      id: "L-B",
      dependencies: [],
    };
    const subA = {
      ...legacySubLevers[0],
      id: "SL-A",
      leverId: "L-A",
      dependencies: [{ targetId: "SL-B", type: "FS" as const }],
    };
    const subB = {
      ...legacySubLevers[1],
      id: "SL-B",
      leverId: "L-B",
      dependencies: [],
    };

    const result = migrateMockLeversToActions([source, target], [subA, subB]);
    expect(result.find((lever) => lever.id === "L-A")?.dependencies).toEqual([
      { targetId: "L-B", type: "FS" },
    ]);
  });

  it("drops dependencies between former sub-levers of the same parent lever", () => {
    const parent = {
      ...mockData.levers[0],
      id: "L-A",
      dependencies: [],
    };
    const subA = {
      ...legacySubLevers[0],
      id: "SL-A1",
      leverId: "L-A",
      dependencies: [{ targetId: "SL-A2", type: "FS" as const }],
    };
    const subB = {
      ...legacySubLevers[1],
      id: "SL-A2",
      leverId: "L-A",
      dependencies: [],
    };

    const result = migrateMockLeversToActions([parent], [subA, subB]);
    expect(result[0].dependencies).toEqual([]);
  });
});
