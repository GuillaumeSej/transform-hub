import { financeTotals, savingsTriple } from "@/lib/dashboardSavings";
import { describe, it, expect } from "vitest";
import * as engine from "@/lib/engine";
import {
  applyActionProgress,
  applyActionStatus,
  createLever,
  updateAction,
  updateLever,
  createAction,
} from "@/lib/leversLogic";
import { migrateLeverImpacts, migrateLeversImpacts } from "@/lib/leverImpactMigration";
import {
  DEFAULT_IMPACT_NATURES,
  DEFAULT_LEVER_TYPES,
  getImpactNatures,
  getLeverTypes,
} from "@/lib/impactConfig";
import { leverToExcelRow, leverImpactsToExcelRows } from "@/lib/leverExcel";
import type { BeTrackData, HierarchyNode, Lever, LeverAction, LeverImpact } from "@/types";

const lever = (over: Partial<Lever> = {}): Lever => ({
  id: "L001",
  code: "L001",
  programId: "p1",
  type: "Sourcing",
  name: "T",
  ws: "WS",
  owner: "o",
  ownerInit: "o",
  sponsor: "s",
  sponsorInit: "s",
  geography: "EU",
  country: "FR",
  entity: "E",
  function: "F",
  costCenter: "CC",
  pnlMap: "P1",
  start: "2026-01-01",
  end: "2026-12-31",
  status: "in_progress",
  progress: 0,
  risk: "low",
  grossSavings: 0,
  netSavings: 0,
  opexOneOff: 0,
  opexRec: 0,
  capex: 0,
  fteImpact: 0,
  popImpacted: "",
  dependencies: [],
  description: "",
  createdAt: "2026-01-01",
  lastUpdate: "2026-01-01",
  actions: [],
  ...over,
});
const act = (id: string, over: Partial<LeverAction> = {}): LeverAction => ({
  id,
  name: id,
  start: "2026-01-01",
  end: "2026-06-30",
  status: "todo",
  ...over,
});
const imp = (id: string, over: Partial<LeverImpact>): LeverImpact => ({
  id,
  label: id,
  type: "saving",
  nature: "opex_rec",
  amount: 1,
  ...over,
});
const data = (levers: Lever[]): BeTrackData =>
  ({
    program: { fyStart: "2026-01-01", fyEnd: "2026-12-31" },
    workstreams: [],
    levers,
    pnlAccounts: [],
    workforce: { movements: [], employees: [] },
    alerts: [],
  }) as unknown as BeTrackData;

describe("impactConfig", () => {
  it("defaults and company override", () => {
    expect(getLeverTypes()).toBe(DEFAULT_LEVER_TYPES);
    expect(getLeverTypes({ leverTypes: ["X"] })).toEqual(["X"]);
    expect(getImpactNatures()).toBe(DEFAULT_IMPACT_NATURES);
    const costOnly = getImpactNatures(undefined, "cost");
    expect(costOnly.every((n) => n.appliesTo !== "saving")).toBe(true);
    expect(getImpactNatures(undefined, "saving").some((n) => n.appliesTo === "cost")).toBe(false);
  });
});

describe("leverImpactMigration", () => {
  const l = lever({
    actions: [
      act("A1", {
        impacts: [imp("I1", { hierarchyLeafId: "n1", amount: 3 }), imp("I2", { amount: 2 })],
      }),
      act("A2", { impacts: [imp("I1", { amount: 99 })] }),
    ],
  });
  it("moves, dedupes, keeps fields and clears action impacts", () => {
    const m = migrateLeverImpacts(l);
    expect(m.impacts?.map((i) => i.id)).toEqual(["I1", "I2"]);
    expect(m.impacts?.[0].hierarchyLeafId).toBe("n1");
    expect(m.impacts?.[0].amount).toBe(3);
    expect(m.actions?.every((a) => !("impacts" in a))).toBe(true);
  });
  it("is idempotent and reference-stable", () => {
    const m = migrateLeverImpacts(l);
    expect(migrateLeverImpacts(m)).toBe(m);
    const arr = [m];
    expect(migrateLeversImpacts(arr)).toBe(arr);
  });
  it("levier qui a déjà ses impacts : les anciens impacts d'action (doublons) sont écartés (audit C3)", () => {
    // Cas ACME COM-001 : détail « ENR » sur le levier (3,42 brut) + business case « SEED » resté
    // sur les actions (1,15 + 2,15) pour les mêmes gains — la fusion doublait le net (3,3 → 6,6).
    const m = migrateLeverImpacts(
      lever({
        impacts: [imp("ENR-01", { amount: 2.23 }), imp("ENR-02", { amount: 1.19 })],
        actions: [
          act("A1", { impacts: [imp("SEED-DONE", { amount: 1.15 })] }),
          act("A2", { impacts: [imp("SEED-PENDING", { amount: 2.15 })] }),
        ],
      })
    );
    expect(m.impacts?.map((i) => i.id)).toEqual(["ENR-01", "ENR-02"]);
    expect(m.actions?.every((a) => !("impacts" in a))).toBe(true);
    expect(engine.leverImpactTotals(m).grossAnnual).toBeCloseTo(3.42);
  });
});

describe("leverImpactTotals", () => {
  it("computes gross/net/one-off/fte with the net = gross - recurring OPEX rule", () => {
    const t = engine.leverImpactTotals(
      lever({
        impacts: [
          imp("g", { amount: 10 }),
          imp("g1", { amount: 4, gainRecurrence: "oneoff" }),
          imp("cx", { type: "cost", nature: "capex", amount: 3 }),
          imp("o1", { type: "cost", nature: "oneoff", amount: 1 }),
          imp("or", { type: "cost", nature: "opex_rec", amount: 0.5 }),
          imp("dep", { type: "fte", fteDirection: "departure", amount: 2, fteCount: 10 }),
          imp("hire", { type: "fte", fteDirection: "hire", amount: 0.6, fteCount: 3 }),
        ],
      })
    );
    expect(t.grossAnnual).toBe(12); // 10 + 2 (departures)
    expect(t.oneOffGains).toBe(4);
    expect(t.capex).toBe(3);
    expect(t.opexOneOff).toBe(1);
    expect(t.opexRec).toBe(1.1); // 0.5 + hire salary
    expect(t.fteNet).toBe(-7);
    expect(t.netAnnual).toBe(10.9); // 12 − 1.1 : CAPEX (3) et OPEX one-off (1) ignorés
  });
  it("net = gross − recurring OPEX; CAPEX and one-off OPEX never enter the annualized net", () => {
    const gainOnly = engine.leverImpactTotals([imp("g", { amount: 10 })]);
    const withCapex = engine.leverImpactTotals([
      imp("g", { amount: 10 }),
      imp("cx", { type: "cost", nature: "capex", amount: 7 }),
      imp("oo", { type: "cost", nature: "oneoff", amount: 5 }),
    ]);
    expect(withCapex.netAnnual).toBe(gainOnly.netAnnual);
    expect(withCapex.netAnnual).toBe(10);
    const withOpex = engine.leverImpactTotals([
      imp("g", { amount: 10 }),
      imp("cx", { type: "cost", nature: "capex", amount: 7 }),
      imp("or", { type: "cost", nature: "opex_rec", amount: 2.5 }),
    ]);
    expect(withOpex.netAnnual).toBe(7.5);
    expect(withOpex.netAnnual).toBe(withOpex.grossAnnual - withOpex.opexRec);
  });
});

describe("action weighting & progress", () => {
  it("weighted only when all weights present and sum to 100", () => {
    const ok = { actions: [act("a", { weightPct: 70 }), act("b", { weightPct: 30 })] };
    expect(engine.leverActionWeighting(ok).mode).toBe("weighted");
    expect(
      engine.leverActionWeighting({
        actions: [act("a", { weightPct: 70 }), act("b", { weightPct: 20 })],
      }).mode
    ).toBe("unweighted");
    expect(
      engine.leverActionWeighting({ actions: [act("a", { weightPct: 100 }), act("b")] }).mode
    ).toBe("unweighted");
  });
  it("progress: weighted, unweighted mean, empty, declared overrides status", () => {
    const w = {
      actions: [
        act("a", { weightPct: 80, status: "done" }),
        act("b", { weightPct: 20, declaredProgressPct: 50, status: "in_progress" }),
      ],
    };
    expect(engine.leverActionProgress(w)).toBe(90);
    expect(engine.leverActionProgress({ actions: [act("a", { status: "done" }), act("b")] })).toBe(
      50
    );
    expect(engine.leverActionProgress({ actions: [] })).toBe(0);
    expect(engine.actionProgressPct(act("a", { status: "in_progress" }))).toBe(50);
  });
  it("never depends on gains", () => {
    const l = lever({
      impacts: [imp("g", { amount: 100 })],
      actions: [act("a", { status: "done" }), act("b")],
    });
    expect(engine.leverActionProgress(l)).toBe(50);
  });
});

describe("applyActionProgress / applyActionStatus", () => {
  it("todo -> in_progress when progress goes >0; 100 -> done", () => {
    expect(applyActionProgress(act("a"), 20).status).toBe("in_progress");
    const done = applyActionProgress(act("a"), 100);
    expect(done.status).toBe("done");
    expect(done.deliveredDate).toBeTruthy();
    expect(applyActionProgress(done, 60).status).toBe("in_progress");
    expect(applyActionProgress(done, 60).deliveredDate).toBeUndefined();
  });
  it("status done -> 100, todo -> 0", () => {
    expect(applyActionStatus(act("a"), "done").declaredProgressPct).toBe(100);
    expect(
      applyActionStatus(act("a", { declaredProgressPct: 40, status: "in_progress" }), "todo")
        .declaredProgressPct
    ).toBe(0);
  });
});

describe("action mutations persist progress and lastUpdate", () => {
  it("changing an action's stage returns the lever to persist with new progress, no undefined keys", () => {
    const l = lever({ actions: [act("A1"), act("A2")] });
    const r = updateAction([l], { leverId: "L001" }, "A1", { status: "done" }, "u");
    expect(r.changedLever?.progress).toBe(50);
    expect(r.levers[0].progress).toBe(50);
    expect(r.changedLever?.actions?.[0].declaredProgressPct).toBe(100);
    expect(JSON.stringify(r.changedLever)).not.toContain("undefined");
    // reopening
    const r2 = updateAction(r.levers, { leverId: "L001" }, "A1", { status: "todo" }, "u");
    expect(r2.changedLever?.progress).toBe(0);
    expect("deliveredDate" in r2.changedLever!.actions![0]).toBe(false);
  });
  it("declared progress patch moves status and lever progress", () => {
    const l = lever({ actions: [act("A1")] });
    const r = updateAction([l], { leverId: "L001" }, "A1", { declaredProgressPct: 40 }, "u");
    expect(r.action.status).toBe("in_progress");
    expect(r.changedLever?.progress).toBe(40);
  });
  it("createAction recomputes progress; all done -> delivered", () => {
    const l = lever({ actions: [act("A1", { status: "done", declaredProgressPct: 100 })] });
    const r = createAction(
      [l],
      { leverId: "L001" },
      act("x", { status: "done" }) as Omit<LeverAction, "id">,
      "u"
    );
    expect(r.changedLever?.progress).toBe(100);
    expect(r.changedLever?.status).toBe("delivered");
  });
});

describe("lever financials recomputed from impacts", () => {
  it("createLever/updateLever recompute macro fields; manual values kept without impacts", () => {
    const { lever: created, levers } = createLever(
      [],
      {
        ...lever({ status: "idea", grossSavings: 99 }),
        impacts: [imp("g", { amount: 5 }), imp("c", { type: "cost", nature: "capex", amount: 1 })],
      } as never,
      "u"
    );
    expect(created.grossSavings).toBe(5);
    expect(created.netSavings).toBe(5); // CAPEX (1) hors net annualisé
    expect(created.capex).toBe(1);
    const manual = createLever(
      [],
      { ...lever({ status: "idea", grossSavings: 7, netSavings: 6 }) } as never,
      "u"
    );
    expect(manual.lever.netSavings).toBe(6);
    const upd = updateLever(levers, created.id, { impacts: [imp("g", { amount: 8 })] }, "u");
    expect(upd.lever.grossSavings).toBe(8);
    expect(upd.lever.netSavings).toBe(8);
  });
  it("locked plan stays frozen while reforecast follows impacts", () => {
    const { lever: c, levers } = createLever(
      [],
      { ...lever({ status: "in_progress" }), impacts: [imp("g", { amount: 10 })] } as never,
      "u"
    );
    expect(c.lockedPlan?.netSavings).toBe(10);
    const u = updateLever(levers, c.id, { impacts: [imp("g", { amount: 6 })] }, "u");
    expect(u.lever.lockedPlan?.netSavings).toBe(10);
    expect(u.lever.reforecast?.netSavings).toBe(6);
    expect(u.lever.netSavings).toBe(6);
  });
});

describe("cancelled levers are excluded from every aggregate", () => {
  const good = lever({
    id: "G",
    status: "in_progress",
    netSavings: 5,
    grossSavings: 5,
    capex: 1,
    opexRec: 1,
    fteImpact: -2,
    pnlMap: "P1",
    geography: "EU",
    function: "F",
    country: "FR",
    end: "2026-03-15",
  });
  const bad = lever({
    id: "C",
    status: "cancelled",
    netSavings: 50,
    grossSavings: 50,
    capex: 9,
    opexRec: 9,
    fteImpact: -20,
    pnlMap: "P1",
    geography: "EU",
    function: "F",
    country: "FR",
    end: "2026-03-15",
    impacts: [imp("z", { amount: 50 })],
  });
  const d = data([good, bad]);
  it("summaries and breakdowns", () => {
    const s = engine.programSummary(d);
    expect(s.target).toBe(5);
    expect(s.capex).toBe(1);
    expect(s.fteImpact).toBe(-2);
    expect(engine.workstreamSummary(d, "WS").target).toBe(5);
    expect(engine.byGeo(d)).toEqual({ EU: 0 });
    expect(engine.realizedSavings(bad)).toBe(0);
    expect(engine.realizedFte(bad)).toBe(0);
    // P&L aligné sur les totaux leviers (audit M5) : plan = planifié initial (abandonnés compris,
    // comme `plannedInitialNet`), réactualisé = leviers actifs seulement.
    expect(engine.pnlImpactDetailed(d).reduce((s2, p) => s2 + p.plan, 0)).toBe(55);
    expect(engine.pnlImpactDetailed(d).reduce((s2, p) => s2 + p.reforecast, 0)).toBe(5);
  });
  it("series, bridge, marimekko (seul le planifié initial inclut les abandonnés)", () => {
    const series = engine.savingsSeries(d, "month", new Date("2026-12-31"));
    // Planifié initial : abandonnés compris (audit C2) ; leur perte est dans l'ajustement.
    expect(series[11].planned).toBe(55);
    expect(series[11].reforecast).toBe(5);
    expect(series[11].gap.cancelled).toBe(50);
    expect(series[11].gap.adjustment).toBe(-50);
    expect(engine.programSummary(d).plannedInitial).toBe(55);
    // Même chiffre partout : KPI = cascade = courbe = somme des plans figés (plannedInitialNet).
    expect(engine.savingsWaterfall(d).steps[0].value).toBe(55);
    expect(engine.plannedInitialNet(d.levers)).toBe(55);
    expect(
      engine.marimekko2D(d, "function-country").reduce((s2, c) => s2 + c.totalSavings, 0)
    ).toBe(5);
    expect(engine.impactTrajectory(bad).points).toHaveLength(0);
  });
  it("waterfall = brut − OPEX récurrent = net, cancelled excluded", () => {
    const w = engine.savingsWaterfall(d);
    expect(w.steps.map((x) => x.key)).toEqual([
      "initial",
      "reforecast",
      "cancelled",
      "target",
      "gross",
      "opexRec",
      "net",
    ]);
    expect(w.target).toBe(5);
    expect(w.gross - w.opexRec).toBeCloseTo(w.target, 1);
    expect(w.steps.find((x) => x.key === "target")?.value).toBe(w.target);
  });
});

describe("impactTrajectory (J-curve)", () => {
  const l = lever({
    start: "2026-01-15",
    end: "2026-06-30",
    impacts: [
      imp("cx", {
        type: "cost",
        nature: "capex",
        amount: 12,
        capexAllocationMode: "smoothed",
        capexStartDate: "2026-01-01",
        capexDeploymentDate: "2026-06-01",
      }),
      imp("cx1", { type: "cost", nature: "capex", amount: 6, capexDeploymentDate: "2026-02-01" }),
      imp("or", {
        type: "cost",
        nature: "opex_rec",
        amount: 1.2,
        capexDeploymentDate: "2026-03-01",
      }),
      imp("oo", { type: "cost", nature: "oneoff", amount: 2, capexDeploymentDate: "2026-03-01" }),
      imp("g", { amount: 24, gainDate: "2026-07-01" }),
      imp("g1", { amount: 5, gainDate: "2026-08-01", gainRecurrence: "oneoff" }),
      imp("h", {
        type: "fte",
        fteDirection: "departure",
        amount: 1,
        fteCount: 4,
        gainDate: "2026-07-01",
      }),
    ],
  });
  const t = engine.impactTrajectory(l, { granularity: "month", today: new Date("2026-05-10") });
  const at = (p: string) => t.points.find((x) => x.period === p)!;
  it("smooths CAPEX vs one-shot", () => {
    expect(at("Jan 2026").capex).toBe(2); // 12/6 months
    expect(at("Feb 2026").capex).toBe(8); // 2 + 6 one-shot
    expect(at("Jun 2026").capex).toBe(2);
    expect(at("Jul 2026").capex).toBe(0);
  });
  it("books recurring OPEX at start and each anniversary, one-off once", () => {
    expect(at("Mar 2026").opexRec).toBe(1.2);
    expect(at("Dec 2026").opexRec).toBe(0);
    expect(at("Mar 2027").opexRec).toBe(1.2);
    expect(at("Mar 2026").opexOneOff).toBe(2);
    expect(at("Apr 2026").opexOneOff).toBe(0);
  });
  it("annual gains recur, one-off separate", () => {
    expect(at("Jul 2026").gains).toBeCloseTo(24 + 1, 2); // gain annualisé + salaire des départs
    expect(at("Jul 2027").gains).toBeCloseTo(25, 2); // réannualisé à l'anniversaire
    expect(at("Aug 2026").oneOffGains).toBe(5);
    expect(at("Sep 2026").oneOffGains).toBe(0);
    expect(at("Sep 2026").gains).toBe(0);
  });
  it("cumulativeNet (trésorerie) vs cumulativeNetRecurring (savings) and fte/todayIndex work", () => {
    const last = t.points[t.points.length - 1];
    // cumulativeNet (vue trésorerie) = gains + oneOffGains − opexOneOff − opexRec − capex.
    // cumulativeNetRecurring (vue savings, cohérente avec netAnnual/realizedSavings) = gains −
    // opexRec seulement (jamais CAPEX/OPEX one-off, voir le doc-comment du type dans engine.ts).
    // opexRec s'annule dans la différence (présent identiquement des deux côtés) : il ne reste que
    // oneOffGains − opexOneOff − capex = 5 (gain "g1") − 2 (coût "oo") − 18 (capex "cx" + "cx1").
    expect(last.cumulativeNet - last.cumulativeNetRecurring).toBeCloseTo(5 - 2 - 18, 5);
    expect(at("Dec 2026").fte).toBe(-4);
    expect(t.points[t.todayIndex].period).toBe("May 2026");
    expect(
      engine.impactTrajectory(l, { granularity: "year", today: new Date("2026-05-10") }).points[0]
        .period
    ).toBe("2026");
  });
});

describe("savingsSeries: single source for S-curve and bridge", () => {
  const today = new Date("2026-08-15");
  const late = lever({
    id: "A",
    status: "in_progress",
    netSavings: 10,
    end: "2026-04-30",
    actions: [act("a", { end: "2026-04-30", status: "in_progress", declaredProgressPct: 40 })],
    // status explicite "planned" + date passée (< today = 2026-08-15) : impact non réalisé alors
    // que sa date est dépassée → fait basculer le levier "en retard" (isLeverLate, engine.ts).
    impacts: [imp("g", { amount: 10, gainDate: "2026-04-30", status: "planned" })],
  });
  const done = lever({
    id: "B",
    status: "delivered",
    progress: 100,
    netSavings: 6,
    end: "2026-06-30",
    deliveredDate: "2026-06-10",
    impacts: [imp("g", { amount: 6 })],
  });
  const d = data([late, done]);
  it("actual matches programSummary.realized and bridge cumulative", () => {
    const s = engine.savingsSeries(d, "month", today);
    const lastShown = s[7];
    expect(lastShown.actual).toBe(engine.programSummary(d).realized);
    expect(engine.sCurve3(d, "month")[0]).toEqual({
      month: "Jan 2026",
      planned: 0,
      reforecast: 0,
      actual: expect.anything(),
    });
  });
  it("gap is signed réalisé − planifié (positif = gain, négatif = perte) and splits performance/delay", () => {
    const s = engine.savingsSeries(d, "month", today);
    const p = s[7];
    // total = réalisé − planifié initial (jamais réactualisé − réalisé comme avant le round 5).
    expect(p.gap.total).toBeCloseTo((p.actual ?? 0) - p.planned, 1);
    // adjustment ("écart de performance") = réactualisé − planifié initial.
    expect(p.gap.adjustment).toBeCloseTo(p.reforecast - p.planned, 1);
    // delay = réalisé − réactualisé EN ENTIER (round 8 : plus filtré aux seuls leviers "en retard").
    expect(p.gap.delay).toBeCloseTo((p.actual ?? 0) - p.reforecast, 1);
    expect(p.gap.delay).toBeLessThan(0);
    // Identité de construction : total = adjustment + delay exactement (plus de résidu "other").
    expect(p.gap.total).toBeCloseTo(p.gap.adjustment + p.gap.delay, 1);
    expect(s[10].actual).toBeNull();
  });
});

describe("savingsWaterfall & financeByHierarchyLevel", () => {
  const nodes: HierarchyNode[] = [
    { id: "bu1", companyId: "c", levelKey: "bu", code: "BU1", label: "BU 1", parentId: null },
    { id: "cc1", companyId: "c", levelKey: "cc", code: "CC1", label: "CC 1", parentId: "bu1" },
    { id: "cc2", companyId: "c", levelKey: "cc", code: "CC2", label: "CC 2", parentId: "bu1" },
  ];
  const company = {
    hierarchyLevels: [
      { key: "bu", label: "BU", order: 0 },
      { key: "cc", label: "CC", order: 1 },
    ],
  };
  const a = lever({
    id: "A",
    hierarchyLeafId: "cc1",
    netSavings: 10,
    lockedPlan: { grossSavings: 10, netSavings: 10, opexOneOff: 0, opexRec: 0, capex: 0 },
    reforecast: { grossSavings: 8, netSavings: 8, opexOneOff: 0, opexRec: 1, capex: 0 },
    status: "in_progress",
    end: "2026-01-31",
  });
  const b = lever({ id: "B", hierarchyLeafId: "cc2", netSavings: 4, status: "cancelled" });
  const c = lever({ id: "C", netSavings: 3, status: "in_progress" });
  const d = data([a, b, c]);
  it("waterfall arithmetic: gross − recurring OPEX = net target (same as savingsTriple)", () => {
    const w = engine.savingsWaterfall(d);
    const v = (k: string) => w.steps.find((s) => s.key === k)!.value;
    expect(v("target")).toBe(11); // A réactualisé 8 + C 3 ; B annulé exclu
    expect(w.target).toBe(v("target"));
    expect(v("opexRec")).toBe(-w.opexRec);
    expect(w.opexRec).toBeGreaterThanOrEqual(1); // A : 1 (réactualisé) + OPEX de C
    expect(v("gross")).toBeCloseTo(v("target") + w.opexRec, 1);
    expect(v("gross") + v("opexRec")).toBeCloseTo(v("target"), 1);
    expect(w.remaining).toBe(Math.round((w.target - w.realized) * 10) / 10);
    expect(v("net")).toBe(v("target"));
  });
  it("group A loops: initial + Δ réactualisé − annulé = cible", () => {
    const w = engine.savingsWaterfall(d);
    const v = (k: string) => w.steps.find((s) => s.key === k)!.value;
    expect(v("initial")).toBe(17); // A 10 + B 4 (annulé) + C 3 : plan figé de tous les leviers
    expect(v("cancelled")).toBe(-4);
    expect(v("reforecast")).toBe(-2); // A 10 -> 8
    expect(v("initial") + v("reforecast") + v("cancelled")).toBeCloseTo(v("target"), 5);
    expect(v("target")).toBe(engine.savingsWaterfall(d).target);
  });
  it("waterfall target/realized equal savingsTriple (same numbers as dashboard KPI/graph)", () => {
    const w = engine.savingsWaterfall(d);
    const t = savingsTriple(d.levers);
    expect(w.target).toBe(t.reforecast);
    expect(w.realized).toBe(t.realized);
  });
  it("aggregates leaves up to the chosen level", () => {
    const rows = engine.financeByHierarchyLevel(d, company, 0, nodes, {
      today: new Date("2026-06-01"),
    });
    const bu = rows.find((r) => r.nodeId === "bu1")!;
    expect(bu.planned).toBe(14); // 10 + 4 annulé
    expect(bu.cancelled).toBe(4);
    expect(bu.reforecast).toBe(8);
    expect(rows.find((r) => r.nodeId === "__unattributed__")?.planned).toBe(3);
    const cc = engine.financeByHierarchyLevel(d, company, 1, nodes);
    expect(cc.map((r) => r.nodeId).sort()).toEqual(["__unattributed__", "cc1", "cc2"]);
  });
  it("Finance totals = dashboard figures (computed from unrounded rows, same lever scope)", () => {
    // 3 lignes à 0,14 (+ un abandonné 0,14 en cc1) : les lignes arrondies (0,1 / 0,3) sommées
    // donnaient 0,3 / 0,5 alors que le dashboard affiche 0,4 / 0,6 (QA : 39,3 vs 39,4).
    const small = [
      lever({ id: "X", hierarchyLeafId: "cc1", netSavings: 0.14 }),
      lever({ id: "Y", hierarchyLeafId: "cc2", netSavings: 0.14 }),
      lever({ id: "Z", netSavings: 0.14 }),
      lever({ id: "K", hierarchyLeafId: "cc1", netSavings: 0.14, status: "cancelled" }),
    ];
    const ds = data(small);
    const w = engine.savingsWaterfall(ds);
    const rounded = engine.financeByHierarchyLevel(ds, company, 1, nodes);
    expect(financeTotals(rounded).reforecast).toBe(0.3); // l'ancien calcul, faux
    const rows = engine.financeByHierarchyLevel(ds, company, 1, nodes, { unrounded: true });
    const totals = financeTotals(rows);
    expect(totals.reforecast).toBe(w.target);
    expect(totals.reforecast).toBe(0.4);
    expect(totals.planned).toBe(w.initial);
    expect(totals.planned).toBe(0.6);
    expect(totals.cancelled).toBe(w.cancelled);
    expect(totals.realized).toBe(w.realized);
    expect(totals.planned).toBe(savingsTriple(small).planned);
    expect(totals.reforecast).toBe(savingsTriple(small).reforecast);
  });
});

describe("realized with lever-level impacts", () => {
  it("counts only impacts whose status is realized (done/ongoing), not action progress", () => {
    // Impact récurrent, date passée, pas de statut explicite -> dérivé "ongoing" (réalisé) : compte
    // en entier, quel que soit l'avancement du plan d'action (round 7 : ce n'est plus une fraction
    // d'avancement des actions qui scale le net réactualisé, mais une somme impact par impact).
    const l = lever({
      netSavings: 10,
      impacts: [imp("g", { amount: 10, gainDate: "2020-01-01" })],
      actions: [act("a", { declaredProgressPct: 50, status: "in_progress" })],
    });
    expect(engine.realizedSavings(l)).toBe(10);
    // Un impact pas encore dû (date future) n'est jamais compté, même sur un levier "delivered" —
    // un plan d'action à 100 % ne suffit plus à afficher un réalisé égal au réactualisé.
    const notYetDue = lever({
      netSavings: 10,
      status: "delivered",
      impacts: [imp("g", { amount: 10, gainDate: "2099-01-01" })],
    });
    expect(engine.realizedSavings(notYetDue)).toBe(0);
    expect(engine.realizedSavings({ ...l, status: "cancelled" })).toBe(0);
  });
  it("one-off gains never enter realized / net", () => {
    const l = lever({
      status: "delivered",
      impacts: [imp("g", { amount: 5, gainRecurrence: "oneoff" })],
    });
    expect(engine.leverImpactTotals(l).netAnnual).toBe(0);
    expect(engine.leverImpactTotals(l).oneOffGains).toBe(5);
  });
});

describe("excel impacts", () => {
  it("exports lever impacts rows and one-off gains column", () => {
    const l = lever({
      impacts: [imp("g", { amount: 2, gainRecurrence: "oneoff", technology: "SAP" })],
    });
    const rows = leverImpactsToExcelRows(l);
    expect(rows[0].Mode).toBe("Gain one-off");
    expect(rows[0].Technologie).toBe("SAP");
    const row = leverToExcelRow(l, data([l]), []);
    expect(row["Gains one-off (€M)"]).toBe(2);
  });
});

describe("réactualisé = impacts (audit C3)", () => {
  it("un levier réactualisé avec impacts affiche le net de ses impacts, pas le snapshot enregistré", () => {
    const l = lever({
      status: "in_progress",
      netSavings: 3.3,
      lockedPlan: { grossSavings: 3, netSavings: 2.87, opexOneOff: 0, opexRec: 0, capex: 0 },
      // Valeur écrite directement en base par un ancien script, sans toucher aux impacts.
      reforecast: { grossSavings: 1.5, netSavings: 1.45, opexOneOff: 0, opexRec: 0, capex: 0 },
      impacts: [
        imp("g1", { amount: 2.23 }),
        imp("g2", { amount: 1.19 }),
        imp("or", { type: "cost", nature: "opex_rec", amount: 0.12 }),
      ],
    });
    expect(engine.reforecastSnapshotOf(l)?.netSavings).toBeCloseTo(3.3);
    expect(engine.displayedReforecastNet(l)).toEqual({
      value: engine.leverImpactTotals(l).netAnnual,
      isReforecast: true,
    });
  });

  it("sans impacts : snapshot enregistré ; pas encore réactualisé : undefined (repli plan figé)", () => {
    const refo = { grossSavings: 2, netSavings: 1.8, opexOneOff: 0, opexRec: 0, capex: 0 };
    expect(engine.reforecastSnapshotOf(lever({ reforecast: refo, impacts: [] }))?.netSavings).toBe(
      1.8
    );
    expect(engine.reforecastSnapshotOf(lever({ impacts: [imp("g", { amount: 1 })] }))).toBe(
      undefined
    );
  });
});
