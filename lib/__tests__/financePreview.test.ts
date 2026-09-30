import { describe, it, expect } from "vitest";
import * as engine from "@/lib/engine";
import {
  costCommitmentSplit,
  leverAmounts,
  pnlLeverContributionsByAccount,
} from "@/lib/financePreview";
import { costsByHierarchyNode, isCostEngaged } from "@/lib/financeCosts";
import type { ActionImpact, BeTrackData, HierarchyNode, Lever } from "@/types";

const TODAY = new Date("2026-06-15");

function lever(overrides: Partial<Lever>): Lever {
  return {
    id: "L1",
    code: "L1",
    programId: "p1",
    type: "Sourcing",
    name: "Levier un",
    ws: "WS-01",
    owner: "O",
    ownerInit: "O",
    sponsor: "S",
    sponsorInit: "S",
    geography: "Europe",
    country: "France",
    entity: "E",
    function: "F",
    costCenter: "CC",
    pnlMap: "PNL01",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "in_progress",
    progress: 50,
    risk: "low",
    grossSavings: 0,
    netSavings: 0,
    opexOneOff: 0,
    opexRec: 0,
    capex: 0,
    fteImpact: 0,
    dependencies: [],
    description: "",
    createdAt: "2026-01-01",
    lastUpdate: "2026-06-01",
    actions: [],
    ...overrides,
  };
}

function impact(overrides: Partial<ActionImpact>): ActionImpact {
  return { id: "I", label: "i", type: "cost", nature: "oneoff", amount: 1, ...overrides };
}

function makeData(levers: Lever[]): BeTrackData {
  return {
    program: {
      id: "P01",
      name: "P",
      sponsor: "CEO",
      target: 50,
      currency: "€M",
      fyStart: "2026-01-01",
      fyEnd: "2026-12-31",
      baselineEBIT: 100,
      revenue: 500,
    },
    workstreams: [
      { id: "WS-01", name: "WS", sponsor: "S", function: "F", color: "#000", target: 1 },
    ],
    leverStatuses: [],
    riskLevels: [],
    leverTypes: [],
    geographies: [],
    functions: [],
    pnlAccounts: [
      { id: "PNL01", name: "Compte Un", baseline: 0, sign: 1 },
      { id: "PNL02", name: "Compte Deux", baseline: 0, sign: 1 },
    ],
    levers,
    workforce: {
      totalFTE: 0,
      massSalary: 0,
      budgetSalary: 0,
      departments: [],
      employees: [],
      movements: [],
    },
    operations: {
      lines: [],
      kpisBaseline: { oeeAvg: 0, throughput: 0, scrapRate: 0, otd: 0 },
      kpisTarget: { oeeAvg: 0, throughput: 0, scrapRate: 0, otd: 0 },
      kpisActual: { oeeAvg: 0, throughput: 0, scrapRate: 0, otd: 0 },
    },
    alerts: [],
    audit: [],
    comments: {},
  };
}

describe("financePreview — leverAmounts", () => {
  it("agrège par levier, ignore les montants nuls, garde code et nom", () => {
    const a = lever({ id: "A", code: "A1", name: "Alpha" });
    const b = lever({ id: "B", code: "B1", name: "Beta" });
    const out = leverAmounts([
      { lever: a, amount: 0.1 },
      { lever: b, amount: 0.3 },
      { lever: a, amount: 0.25 },
      { lever: b, amount: 0 },
    ]);
    expect(out).toEqual([
      { id: "A", code: "A1", name: "Alpha", value: 0.35 },
      { id: "B", code: "B1", name: "Beta", value: 0.3 },
    ]);
  });
});

describe("financePreview — costCommitmentSplit", () => {
  it("répartit engagé / à venir (règle isCostEngaged) et OPEX récurrent", () => {
    const l = lever({ status: "in_progress", start: "2026-01-01" });
    const past = impact({ nature: "capex", amount: 2, capexDeploymentDate: "2026-03-01" });
    const future = impact({ nature: "oneoff", amount: 1, capexDeploymentDate: "2027-03-01" });
    const rec = impact({ nature: "opex_rec", amount: 0.5 });
    const rows = [past, future, rec].map((i) => ({ lever: l, impact: i }));
    expect(isCostEngaged(rows[0], TODAY)).toBe(true);
    expect(isCostEngaged(rows[1], TODAY)).toBe(false);
    expect(costCommitmentSplit(rows, TODAY)).toEqual({ engaged: 2, upcoming: 1, recurring: 0.5 });
  });

  it("utilise le montant de la ligne quand il est fourni (ex. part de donut)", () => {
    const l = lever({});
    const rec = impact({ nature: "opex_rec", amount: 5 });
    expect(costCommitmentSplit([{ lever: l, impact: rec, amount: 1.5 }], TODAY).recurring).toBe(
      1.5
    );
  });

  it("les lignes d'une part de donut hiérarchique portent leur impact (aperçu)", () => {
    const nodes: HierarchyNode[] = [
      { id: "N1", code: "N1", label: "Nœud", levelKey: "pnl", parentId: null } as HierarchyNode,
    ];
    const l = lever({
      hierarchyLeafId: "N1",
      impacts: [{ ...impact({ nature: "capex", amount: 2 }), hierarchyLeafId: "N1" }],
    } as Partial<Lever>);
    const [slice] = costsByHierarchyNode(makeData([l]), nodes, "pnl", null);
    expect(slice.rows[0].impact.nature).toBe("capex");
    const split = costCommitmentSplit(slice.rows, TODAY);
    expect(split.engaged + split.upcoming).toBe(2);
  });
});

describe("financePreview — pnlLeverContributionsByAccount", () => {
  const saving = (id: string, amount: number, pnlMap: string) =>
    ({
      ...impact({ id, type: "saving", nature: "opex_rec", amount }),
      pnlMap,
    }) as ActionImpact;
  const l1 = lever({
    id: "L1",
    code: "L1",
    name: "Un",
    impacts: [saving("a", 2, "PNL01"), saving("b", 1, "PNL02")],
  } as Partial<Lever>);
  const l2 = lever({
    id: "L2",
    code: "L2",
    name: "Deux",
    impacts: [saving("c", 4, "PNL01")],
  } as Partial<Lever>);
  const data = makeData([l1, l2]);

  it("la somme des contributions d'un compte égale sa barre (même moteur)", () => {
    for (const period of [undefined, { year: "2026" }, { year: "2026", quarter: "Q3" }]) {
      const bars = engine.pnlImpactDetailed(data, period, undefined, undefined, TODAY);
      const contrib = pnlLeverContributionsByAccount(data, period, undefined, undefined, TODAY);
      for (const bar of bars) {
        const list = contrib.get(bar.accountId) ?? [];
        const sum = (k: "plan" | "reforecast" | "realized") => list.reduce((s, c) => s + c[k], 0);
        expect(sum("plan")).toBeCloseTo(bar.plan, 3);
        expect(sum("reforecast")).toBeCloseTo(bar.reforecast, 3);
        expect(sum("realized")).toBeCloseTo(bar.realized, 3);
      }
    }
  });

  it("value = réalisé − plan, trié par |écart| décroissant", () => {
    const contrib = pnlLeverContributionsByAccount(data, undefined, undefined, undefined, TODAY);
    const pnl01 = contrib.get("PNL01") ?? [];
    expect(pnl01.map((c) => c.id).sort()).toEqual(["L1", "L2"]);
    for (const c of pnl01) expect(c.value).toBeCloseTo(c.realized - c.plan, 4);
    for (let i = 1; i < pnl01.length; i++)
      expect(Math.abs(pnl01[i - 1].value)).toBeGreaterThanOrEqual(Math.abs(pnl01[i].value));
    expect(contrib.get("PNL02")?.map((c) => c.id)).toEqual(["L1"]);
  });
});
