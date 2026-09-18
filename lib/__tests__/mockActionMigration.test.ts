import { describe, expect, it } from "vitest";
import { migrateMockLeversToActions, type LegacySubLever } from "@/lib/mockActionMigration";
import type { Lever } from "@/types";

const baseLever: Lever = {
  id: "L001",
  code: "L001",
  programId: "p1",
  type: "Sourcing",
  name: "Optimisation achats",
  ws: "WS-01",
  owner: "Test Lever Owner",
  ownerInit: "TL",
  sponsor: "Test Sponsor",
  sponsorInit: "TS",
  geography: "Europe",
  country: "France",
  entity: "Entity A",
  function: "Procurement",
  costCenter: "CC01",
  pnlMap: "COGS",
  start: "2026-01-01",
  end: "2026-12-31",
  status: "in_progress",
  progress: 50,
  risk: "low",
  grossSavings: 1.3,
  netSavings: 1.1,
  opexOneOff: 0.1,
  opexRec: 0.2,
  capex: 0.3,
  fteImpact: -4,
  popImpacted: "",
  dependencies: [],
  description: "Levier de test sans historique de sous-leviers.",
  createdAt: "2026-01-01",
  lastUpdate: "2026-06-01",
};

// Un levier de "recrutement" (fteImpact positif) : sert à vérifier que ce genre d'ETP n'est
// jamais replié sur la même ligne d'impact que les savings — voir le test dédié plus bas.
const hiringLever: Lever = {
  ...baseLever,
  id: "L002",
  code: "L002",
  name: "Montée en compétence — recrutement support",
  netSavings: 0.5,
  grossSavings: 0.6,
  opexOneOff: 0.05,
  opexRec: 0.1,
  capex: 0,
  fteImpact: 2,
};

function legacySub(overrides: Partial<LegacySubLever>): LegacySubLever {
  return {
    id: "SL001",
    leverId: "L001",
    name: "Sous-levier de test",
    expensePost: "CC01",
    businessUnit: "Procurement",
    pnlMap: "COGS",
    grossSavings: 0.6,
    netSavings: 0.5,
    opexOneOff: 0.05,
    opexRec: 0.1,
    capex: 0.15,
    fteImpact: -2,
    popImpacted: 10,
    start: "2026-01-01",
    end: "2026-06-30",
    status: "in_progress",
    dependencies: [],
    actions: [],
    ...overrides,
  };
}

describe("mockActionMigration", () => {
  const migrated = migrateMockLeversToActions([baseLever, hiringLever], []);

  it("creates enriched actions for every lever", () => {
    expect(migrated).toHaveLength(2);
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
    const source = [baseLever, hiringLever];
    migrated.forEach((lever) => {
      const original = source.find((candidate) => candidate.id === lever.id)!;
      expect(lever.progress).toBe(original.progress);
      expect(lever.netSavings).toBe(original.netSavings);
      expect(lever.capex).toBe(original.capex);
      expect(lever.opexOneOff).toBe(original.opexOneOff);
      expect(lever.opexRec).toBe(original.opexRec);
      expect(lever.fteImpact).toBe(original.fteImpact);
    });
  });

  it("preserves former sub-lever actions and enriches each with impacts", () => {
    const subs = [
      legacySub({ id: "SL001", leverId: "L001" }),
      legacySub({
        id: "SL002",
        leverId: "L001",
        actions: [
          {
            id: "A1",
            name: "Cadrage",
            start: "2026-01-01",
            end: "2026-02-28",
            status: "done",
            weight: 1,
          },
          {
            id: "A2",
            name: "Déploiement",
            start: "2026-03-01",
            end: "2026-06-30",
            status: "todo",
            weight: 2,
          },
        ],
      }),
    ];
    const result = migrateMockLeversToActions([baseLever], subs);
    const lever = result.find((candidate) => candidate.id === "L001")!;
    // SL001 n'a pas d'historique d'actions -> devient 1 action unique ; SL002 a 2 actions détaillées.
    expect(lever.actions).toHaveLength(3);
  });

  it("preserves each parent lever net savings after consolidating migrated actions", () => {
    // netSavings = savings − capex (voir lib/leverConsolidate.ts) : l'OPEX one-off et l'OPEX
    // récurrent ne rentrent plus dans le calcul, seul le CAPEX est déduit des savings.
    const round = (value: number) => Math.round(value * 100) / 100;
    migrated.forEach((lever) => {
      const net = (lever.actions ?? []).reduce(
        (sum, action) =>
          sum +
          (action.impacts ?? []).reduce((actionSum, impact) => {
            if (impact.type === "saving") return actionSum + impact.amount;
            if (impact.nature === "capex") return actionSum - impact.amount;
            return actionSum;
          }, 0),
        0
      );
      expect(round(net)).toBe(round(lever.netSavings));
    });
  });

  it("reconciles every migrated lever's impacts to the cent with its own financial fields", () => {
    // Garde-fou de non-régression : pour CHAQUE levier (pas un exemple isolé), la somme des
    // impacts d'actions (correctement signés/typés, convention netSavings = savings − capex de
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
      expect(round(saving - capex)).toBe(round(lever.netSavings));
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
    const source = { ...baseLever, id: "L-A", dependencies: [] };
    const target = { ...baseLever, id: "L-B", dependencies: [] };
    const subA = legacySub({
      id: "SL-A",
      leverId: "L-A",
      dependencies: [{ targetId: "SL-B", type: "FS" as const }],
    });
    const subB = legacySub({ id: "SL-B", leverId: "L-B", dependencies: [] });

    const result = migrateMockLeversToActions([source, target], [subA, subB]);
    expect(result.find((lever) => lever.id === "L-A")?.dependencies).toEqual([
      { targetId: "L-B", type: "FS" },
    ]);
  });

  it("drops dependencies between former sub-levers of the same parent lever", () => {
    const parent = { ...baseLever, id: "L-A", dependencies: [] };
    const subA = legacySub({
      id: "SL-A1",
      leverId: "L-A",
      dependencies: [{ targetId: "SL-A2", type: "FS" as const }],
    });
    const subB = legacySub({ id: "SL-A2", leverId: "L-A", dependencies: [] });

    const result = migrateMockLeversToActions([parent], [subA, subB]);
    expect(result[0].dependencies).toEqual([]);
  });
});
