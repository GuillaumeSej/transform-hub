import { afterAll, describe, expect, it, vi } from "vitest";
import * as engine from "@/lib/engine";
import { financeTotals } from "@/lib/dashboardSavings";
import {
  bucketInvestVsSavingsByPeriod,
  bucketSavingsByPeriod,
  engagedVsUpcomingRows,
} from "@/lib/financeCosts";
import { waterfallStepSummary } from "@/lib/chartPreview";
import { formatFteValue } from "@/lib/hrEngine";
import { leverToExcelRow } from "@/lib/leverExcel";
import { validateLeverImportRows } from "@/lib/leverExcelImport";
import type {
  BeTrackData,
  HierarchyLevelDef,
  HierarchyNode,
  Lever,
  LeverImpact,
  LeverStatus,
} from "@/types";

/**
 * Lot 5 — corrections du module PLAN DE PERFORMANCE (constats de l'audit de contrôle, points 1 à
 * 10). Chaque test documente la valeur AVANT correction (commentaire « avant : … ») et la valeur
 * attendue après. Date du jour FIGÉE au 03/10/2026 ; exercice du programme avril → mars (FY26/27 =
 * avril 2026 – mars 2027), sauf mention contraire.
 */

const TODAY = new Date(2026, 9, 3);
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(TODAY);
afterAll(() => {
  vi.useRealTimers();
});

const FY_APRIL = 3; // mois (0-11) de début d'exercice

const lever = (over: Partial<Lever> = {}): Lever =>
  ({
    id: "L1",
    code: "L1",
    name: "Levier",
    ws: "WS",
    pnlMap: "P1",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "in_progress",
    grossSavings: 0,
    netSavings: 0,
    opexOneOff: 0,
    opexRec: 0,
    capex: 0,
    fteImpact: 0,
    progress: 0,
    dependencies: [],
    actions: [],
    ...over,
  }) as unknown as Lever;
const imp = (id: string, over: Partial<LeverImpact>): LeverImpact => ({
  id,
  label: id,
  type: "saving",
  nature: "opex_rec",
  amount: 1,
  ...over,
});
const data = (levers: Lever[], fyStart = "2026-04-01"): BeTrackData =>
  ({
    program: { fyStart, fyEnd: "2027-03-31" },
    workstreams: [],
    levers,
    pnlAccounts: [],
    workforce: { movements: [], employees: [] },
  }) as unknown as BeTrackData;
const levels: HierarchyLevelDef[] = [{ key: "pl", label: "P&L", order: 0 }];
const node = (id: string): HierarchyNode => ({
  id,
  companyId: "C",
  code: id,
  label: id,
  levelKey: "pl",
  parentId: null,
  domain: "financial",
});

const pnl = (d: BeTrackData, f?: engine.PnlPeriodFilter) => {
  const pts = engine.pnlImpactDetailed(d, f, undefined, undefined, TODAY);
  const sum = (k: "plan" | "reforecast" | "realized") => pts.reduce((s, p) => s + p[k], 0);
  return { plan: sum("plan"), reforecast: sum("reforecast"), realized: sum("realized") };
};
const table = (d: BeTrackData, period?: engine.PnlPeriodFilter) =>
  financeTotals(
    engine.financeByHierarchyLevel(d, { hierarchyLevels: levels }, 0, [node("A")], {
      period,
      unrounded: true,
      today: TODAY,
      fyStartMonth: FY_APRIL,
    })
  );
const fy = (year: string): engine.PnlPeriodFilter => ({ year, fyStartMonth: FY_APRIL });

// ─── 1. Gain coché réalisé AVANT sa date : compté dans l'exercice en cours ─────────────────────

describe("1 — réalisé coché avant sa date : dans l'exercice en cours, Σ exercices = total", () => {
  const approved = { status: "approved" } as LeverImpact["realizedApproval"];
  // 1,9 réalisé par la date (mai 2026) + 0,7 coché « Réalisé » et validé, daté du 01/02/2027.
  const l = lever({
    impacts: [
      imp("g1", { amount: 1.9, gainDate: "2026-05-01", hierarchyLeafId: "A" }),
      imp("g2", {
        amount: 0.7,
        gainDate: "2027-02-01",
        status: "done",
        realizedApproval: approved,
        hierarchyLeafId: "A",
      }),
    ],
  });
  const d = data([l]);

  it("réalisé total (KPI, courbe en S, tableau sans filtre) = 2,6 — inchangé", () => {
    expect(engine.realizedSavings(l)).toBe(2.6);
    expect(pnl(d).realized).toBeCloseTo(2.6, 6);
    expect(table(d).realized).toBeCloseTo(2.6, 6);
    // Courbe en S : le 0,7 est daté à aujourd'hui (jamais dans le futur).
    const parts = engine.leverRealizedByDate(l, TODAY);
    expect(parts.find((p) => p.amount === 0.7)?.date.getTime()).toBe(TODAY.getTime());
  });

  it("P&L et tableau Finance par exercice : FY26/27 = 2,6 (avant : 1,9), FY27/28 = 0", () => {
    expect(pnl(d, fy("2026")).realized).toBeCloseTo(2.6, 6); // avant : 1,9
    expect(table(d, fy("2026")).realized).toBeCloseTo(2.6, 6); // avant : 1,9
    expect(pnl(d, fy("2027")).realized).toBe(0);
    expect(table(d, fy("2027")).realized).toBe(0);
    // Somme des exercices = total.
    expect(pnl(d, fy("2026")).realized + pnl(d, fy("2027")).realized).toBeCloseTo(
      pnl(d).realized,
      6
    );
  });

  it("trimestre en cours (Q3 FY26/27 = oct.–déc.) : le 0,7 compte au mois courant (1/12)", () => {
    const q3 = { ...fy("2026"), quarter: "Q3" };
    // 1,9 × 1/12 (octobre) + 0,7 × 1/12 (ramené à octobre) ; avant : 1,9 / 12 seulement.
    expect(pnl(d, q3).realized).toBeCloseTo(2.6 / 12, 4);
    expect(pnl(d, { ...fy("2026"), quarter: "Q4" }).realized).toBe(0);
  });

  it("réalisé daté APRÈS l'exercice en cours (2028) : compté dans FY26/27 (avant : nulle part)", () => {
    const far = lever({
      impacts: [
        imp("g", {
          amount: 0.7,
          gainDate: "2028-06-01",
          status: "done",
          realizedApproval: approved,
          hierarchyLeafId: "A",
        }),
      ],
    });
    const dd = data([far]);
    expect(pnl(dd, fy("2026")).realized).toBeCloseTo(0.7, 6); // avant : 0
    expect(table(dd, fy("2026")).realized).toBeCloseTo(0.7, 6); // avant : 0
    expect(pnl(dd, fy("2028")).realized).toBe(0);
    // Plan / réactualisé gardent leur plage (exercice FY28/29), inchangés.
    expect(pnl(dd, fy("2026")).reforecast).toBe(0);
    expect(pnl(dd, fy("2028")).reforecast).toBeCloseTo(0.7, 6);
  });
});

// ─── 2. % du KPI « CAPEX & coûts ponctuels » sur montants NON arrondis ─────────────────────────

describe("2 — engagedCostsPct calculé sur les montants non arrondis", () => {
  const past = "2026-03-01";
  const future = "2027-03-01";
  const l = lever({
    impacts: [
      imp("c1", { type: "cost", nature: "capex", amount: 1.25, capexDeploymentDate: past }),
      imp("c2", { type: "cost", nature: "capex", amount: 1.25, capexDeploymentDate: future }),
    ],
  });
  it("50 % (comme le donut) — avant : 52 % (1,3 / 2,5 arrondis)", () => {
    const s = engine.programSummary(data([l]));
    expect(s.engagedCosts).toBe(1.3); // affichage arrondi au dixième
    expect(s.reforecastCosts).toBe(2.5);
    expect(Math.round((s.engagedCosts / s.reforecastCosts) * 100)).toBe(52); // ancien calcul
    expect(s.engagedCostsPct).toBe(50);
    const donut = engagedVsUpcomingRows(data([l]), TODAY);
    expect(Math.round((donut.engaged / donut.total) * 100)).toBe(s.engagedCostsPct);
  });
});

// ─── 3. Engagé d'un levier macro sur ses coûts RÉACTUALISÉS ────────────────────────────────────

describe("3 — engagé d'un levier macro = coûts réactualisés × avancement", () => {
  const l = lever({
    capex: 3,
    opexOneOff: 1,
    actions: [
      { id: "A1", name: "a", start: "2026-01-01", end: "2026-02-01", status: "done" },
      { id: "A2", name: "b", start: "2026-01-01", end: "2027-02-01", status: "todo" },
    ] as Lever["actions"],
    reforecast: { grossSavings: 0, netSavings: 0, opexOneOff: 1, opexRec: 0, capex: 5 },
  });
  it("(5 + 1) × 50 % = 3 — avant : (3 + 1) × 50 % = 2 sur un total de 6", () => {
    expect(engine.leverEngagedInvestCost(l, TODAY)).toBe(3); // avant : 2
    const s = engine.programSummary(data([l]));
    expect(s.reforecastCosts).toBe(6);
    expect(s.engagedCostsPct).toBe(50); // avant : 33 %
    const donut = engagedVsUpcomingRows(data([l]), TODAY);
    expect(donut.engaged).toBe(3);
    expect(donut.upcoming).toBe(3);
  });
});

// ─── 4 & 5. Dépendances : montant réactualisé, leviers abandonnés ignorés ──────────────────────

describe("4 / 5 — alertes de dépendance", () => {
  // A (bloqué) dépend de B (bloqueur, FS) : B finit après le début de A → contrainte violée.
  const A = (over: Partial<Lever> = {}) =>
    lever({
      id: "A",
      name: "A",
      start: "2026-06-01",
      end: "2026-12-31",
      netSavings: 1, // net STOCKÉ, périmé
      reforecast: { grossSavings: 2.5, netSavings: 2.5, opexOneOff: 0, opexRec: 0, capex: 0 },
      dependencies: [{ targetId: "B", type: "FS" }],
      ...over,
    });
  const B = (over: Partial<Lever> = {}) =>
    lever({ id: "B", name: "B", start: "2026-01-01", end: "2026-09-30", ...over });

  it("4 — montant à risque = réactualisé − réalisé : 2,5 (avant : 1, net stocké)", () => {
    const alerts = engine.dependencyAlerts(data([A(), B()]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].impactEur).toBe(2.5); // avant : 1
  });

  it("5 — levier abandonné en SOURCE : aucune alerte (avant : 1 alerte, 1,5 M€ à risque)", () => {
    const cancelled = A({
      status: "cancelled" as LeverStatus,
      netSavings: 1.5,
      reforecast: undefined,
    });
    expect(engine.dependencyAlerts(data([cancelled, B()]))).toEqual([]);
  });

  it("5 — levier abandonné en CIBLE : aucune alerte, ni décalage en cascade", () => {
    const d = data([A(), B({ status: "cancelled" as LeverStatus })]);
    expect(engine.dependencyAlerts(d)).toEqual([]);
    expect(engine.computeCascadeShift("B", "2026-09-30", "2026-11-30", d).impactedLevers).toEqual(
      []
    );
  });
});

// ─── 6. Levier macro dans « Invest vs Savings » (même règle que le P&L) ─────────────────────────

describe("6 — levier macro (sans impact) dans Invest vs Savings", () => {
  const macro = lever({
    start: "2026-01-01",
    end: "2026-06-30",
    grossSavings: 1.5,
    netSavings: 1.2,
    opexRec: 0.3,
  });
  const d = data([macro], "2026-01-01");

  it("flux récurrent sans fin depuis son début (au-delà de sa fin) — avant : aucune période", () => {
    const pts = bucketInvestVsSavingsByPeriod(d, "year", 0);
    expect(pts.map((p) => p.sortKey)).toEqual(["2026"]); // avant : []
    expect(pts[0]).toMatchObject({ grossSavings: 1.5, opexRecStarted: 0.3, netSavings: 1.2 });
    // Run-rate : 1/12 par mois, y compris après la fin du levier (juin).
    const q = bucketInvestVsSavingsByPeriod(d, "quarter", 0);
    expect(q.map((p) => p.netSavings)).toEqual([0.3, 0.3, 0.3, 0.3]);
  });

  it("net Invest vs Savings = réactualisé du P&L sur l'exercice (1,2 ; avant : 0 contre 1,2)", () => {
    const p = bucketInvestVsSavingsByPeriod(d, "year", 0)[0];
    expect(pnl(d, { year: "2026" }).reforecast).toBe(1.2);
    expect(p.netSavings).toBeCloseTo(pnl(d, { year: "2026" }).reforecast, 6);
  });
});

// ─── 7. Courbe en S : trimestres FISCAUX, alignés sur la Finance ───────────────────────────────

describe("7 — libellés de trimestre de la courbe en S = trimestres fiscaux", () => {
  const l = lever({ impacts: [imp("g", { amount: 1, gainDate: "2026-10-15" })] });

  it("exercice avril–mars : « Q1 FY26/27 » … (avant : « Q2 2026 », « Q3 2026 », « Q4 2026 », « Q1 2027 »)", () => {
    const q = engine.savingsSeries(data([l]), "quarter", TODAY);
    expect(q.map((p) => p.month)).toEqual(["Q1 FY26/27", "Q2 FY26/27", "Q3 FY26/27", "Q4 FY26/27"]);
    // Octobre 2026 = « Q3 FY26/27 », même libellé que la Finance (avant : « Q4 2026 »).
    const finance = bucketSavingsByPeriod(data([l]), "quarter", FY_APRIL);
    expect(finance[0].period).toBe("Q3 FY26/27");
    expect(q[2].month).toBe(finance[0].period);
  });

  it("exercice civil : libellés inchangés (« Q1 2026 » …)", () => {
    const q = engine.savingsSeries(data([l], "2026-01-01"), "quarter", TODAY);
    expect(q.map((p) => p.month)).toEqual(["Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"]);
  });
});

// ─── 8. Aperçu de la cascade : `before` non arrondi ────────────────────────────────────────────

describe("8 — waterfallStepSummary : « avant » non arrondi avant l'affichage", () => {
  it("0,04 (avant : 0, arrondi au dixième)", () => {
    const wf = {
      steps: [
        { key: "initial", label: "", kind: "total", value: 0.06, cumulative: 0.06 },
        { key: "reforecast", label: "", kind: "delta", value: 0.02, cumulative: 0.06 },
      ],
      initial: 0.06,
      gross: 0,
    } as unknown as engine.SavingsWaterfall;
    expect(waterfallStepSummary(wf, "reforecast")!.before).toBeCloseTo(0.04, 9); // avant : 0
  });
});

// ─── 9. ETP non numérique affiché « — » ─────────────────────────────────────────────────────────

describe("9 — formatFteValue : NaN → « — »", () => {
  it("NaN / Infinity → « — » (avant : « 0 ») ; vrais zéros et valeurs inchangés", () => {
    expect(formatFteValue(NaN, "fr")).toBe("—"); // avant : "0"
    expect(formatFteValue(Infinity, "fr")).toBe("—");
    expect(formatFteValue(0, "fr")).toBe("0");
    expect(formatFteValue(-0.01, "fr")).toBe("0");
    expect(formatFteValue(21.14, "fr")).toBe("21,1");
  });
});

// ─── 10. Levier abandonné : une seule valeur de net réactualisé ────────────────────────────────

describe("10 — net réactualisé d'un levier abandonné : 0 partout (liste, export, P&L)", () => {
  const cancelled = lever({
    id: "c1-L001",
    code: "PROC-001",
    programId: "p1",
    status: "cancelled" as LeverStatus,
    grossSavings: 1.5,
    netSavings: 1.5,
  });

  it("liste / export = 0 (avant : 1,5) = P&L / tableau Finance", () => {
    expect(engine.displayedReforecastNet(cancelled).value).toBe(1.5); // valeur brute (fiche)
    expect(engine.leverReforecastNetValue(cancelled)).toBe(0); // avant (liste) : 1,5
    const row = leverToExcelRow(cancelled, data([cancelled]), []);
    expect(row["Impact estimé net (€M)"]).toBe(0); // avant : 1,5
    expect(row["Planifié initial"]).toBe(1.5); // le plan initial garde les abandonnés
    expect(pnl(data([cancelled])).reforecast).toBe(0);
    expect(table(data([cancelled])).reforecast).toBe(0);
  });

  it("ré-import du fichier exporté : net stocké conservé, aucune modification ni alerte", () => {
    const row = leverToExcelRow(cancelled, data([cancelled]), [], undefined, undefined, [
      { id: "p1", name: "Programme 1" },
    ]);
    const preview = validateLeverImportRows(
      { leviers: [row], actions: null, impacts: null },
      {
        levers: [cancelled],
        workstreams: [],
        pnlAccounts: [{ id: "P1", name: "P1", baseline: 0, sign: -1 }],
      },
      "c1",
      [{ id: "p1", name: "Programme 1" }]
    );
    expect(preview.errors).toEqual([]);
    // Aucune alerte « valeur calculée modifiée » sur le net (fichier 0 = valeur du moteur 0).
    expect(preview.warnings.map((w) => w.vars?.field)).not.toContain("Impact estimé net (€M)");
    // Le 0 exporté n'écrase pas le net stocké de 1,5 (base du « Planifié initial »).
    expect(preview.toUpsert.every((r) => r.netSavings === 1.5)).toBe(true);
  });
});
