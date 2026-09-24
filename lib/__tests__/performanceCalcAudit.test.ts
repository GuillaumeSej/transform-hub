import { describe, it, expect } from "vitest";
import * as engine from "@/lib/engine";
import {
  requestLeverApproval,
  updateLever,
  writeActions,
  filterProgramScopedLevers,
} from "@/lib/leversLogic";
import {
  attachChildren,
  financeTotals,
  roundFinanceTree,
  roundLargestRemainder,
} from "@/lib/dashboardSavings";
import { costsByHierarchyNode } from "@/lib/financeCosts";
import { isImpactLate, isImpactRealized, parseLocalDate } from "@/lib/impactStatus";
import { gatedStatusesFor } from "@/lib/status-config";
import type {
  BeTrackData,
  HierarchyLevelDef,
  HierarchyNode,
  Lever,
  LeverAction,
  LeverImpact,
  LifecycleStage,
} from "@/types";

/**
 * Audit calculs Plan Performance (B1, M3, M4, M5, M7, M9 + mineurs). M6 (run-rate Invest vs
 * Savings) : voir financeCosts.test.ts / investVsSavingsCalc.test.ts.
 */

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
  pnlMap: "",
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
const data = (levers: Lever[], fyStart = "2026-01-01"): BeTrackData =>
  ({
    program: { fyStart, fyEnd: "" },
    workstreams: [],
    levers,
    pnlAccounts: [],
    workforce: { movements: [], employees: [] },
  }) as unknown as BeTrackData;

const allDone = [act("A1", { status: "done" }), act("A2", { status: "done" })];

// ─── B1 : passage automatique à « Réalisé » ─────────────────────────────────────────────────────

describe("B1 — auto-delivery only from « Exécuté », plan lock on every status change", () => {
  it.each(["idea", "qualified", "validated"] as const)(
    "a lever at %s whose actions reach 100%% keeps its status (no gate bypass)",
    (status) => {
      const l = lever({ status, actions: [act("A1"), act("A2")] });
      const { changedLever } = writeActions([l], { leverId: l.id }, allDone);
      expect(changedLever?.progress).toBe(100);
      expect(changedLever?.status).toBe(status);
      expect(changedLever?.deliveredDate).toBeUndefined();
    }
  );

  it("an « Exécuté » lever reaching 100% becomes « Réalisé », dated, with a frozen plan", () => {
    const l = lever({
      status: "in_progress",
      actions: [act("A1"), act("A2")],
      impacts: [imp("g", { amount: 4 })],
    });
    const { changedLever } = writeActions([l], { leverId: l.id }, allDone);
    expect(changedLever?.status).toBe("delivered");
    expect(changedLever?.deliveredDate).toBeTruthy();
    expect(changedLever?.lockedPlan?.netSavings).toBe(4);
    expect(changedLever?.reforecast).toBeTruthy();
  });

  it("updateLever with the action plan also only auto-delivers from « Exécuté »", () => {
    const l = lever({ status: "validated", actions: [act("A1")] });
    const r = updateLever([l], l.id, { actions: [act("A1", { status: "done" })] }, "u");
    expect(r.lever.status).toBe("validated");
  });
});

// ─── updateLever : transitions directes ─────────────────────────────────────────────────────────

describe("updateLever — direct status transitions", () => {
  it("blocks cancelled → delivered", () => {
    const l = lever({ status: "cancelled" });
    expect(updateLever([l], l.id, { status: "delivered" }, "u").lever.status).toBe("cancelled");
  });

  it("sets deliveredDate when « Réalisé » is set directly", () => {
    const l = lever({ status: "in_progress", actions: [] });
    const r = updateLever([l], l.id, { status: "delivered" }, "u");
    expect(r.lever.status).toBe("delivered");
    expect(r.lever.deliveredDate).toBeTruthy();
  });

  it("cannot jump over a gate (validated → delivered skips the « Exécuté » gate)", () => {
    const l = lever({ status: "validated", actions: [] });
    expect(updateLever([l], l.id, { status: "delivered" }, "u").lever.status).toBe("validated");
  });
});

describe("admin lifecycle « validation requise » toggle is honored", () => {
  const onlyQualified: LifecycleStage[] = [
    { key: "idea", label: "Identifié", validationRequired: false },
    { key: "qualified", label: "Validé", validationRequired: true },
    { key: "validated", label: "Planifié", validationRequired: false },
    { key: "in_progress", label: "Exécuté", validationRequired: false },
    { key: "delivered", label: "Réalisé", validationRequired: false },
  ];

  it("gatedStatusesFor: configured stages only; legacy (no config) = 3 gates", () => {
    expect(gatedStatusesFor(onlyQualified)).toEqual(["qualified"]);
    expect(gatedStatusesFor()).toEqual(["qualified", "validated", "in_progress"]);
  });

  it("a non-gated stage is freely reachable, a gated one still is not", () => {
    const opts = { lifecycleStages: onlyQualified };
    const q = lever({ status: "qualified" });
    expect(updateLever([q], q.id, { status: "validated" }, "u", opts).lever.status).toBe(
      "validated"
    );
    const i = lever({ status: "idea" });
    // idea → validated would cross the « qualified » gate.
    expect(updateLever([i], i.id, { status: "validated" }, "u", opts).lever.status).toBe("idea");
    // Without config, legacy behaviour: validated stays gated.
    expect(updateLever([q], q.id, { status: "validated" }, "u").lever.status).toBe("qualified");
  });

  it("requestLeverApproval targets only a configured gate", () => {
    const admin = { name: "A", username: "a", isGlobalAdmin: true, isCompanyAdmin: false };
    const q = lever({ status: "qualified" });
    expect(() =>
      requestLeverApproval([q], q.id, admin, { lifecycleStages: onlyQualified })
    ).toThrow();
    const i = lever({ status: "idea" });
    expect(
      requestLeverApproval([i], i.id, admin, { lifecycleStages: onlyQualified }).lever.approval
        ?.targetStatus
    ).toBe("qualified");
  });
});

// ─── M3 / M4 : tableau Finance par niveau ───────────────────────────────────────────────────────

const levels: HierarchyLevelDef[] = [{ key: "cc", label: "Centre de coût", order: 0 }];
const node = (id: string, levelKey = "cc", parentId: string | null = null): HierarchyNode => ({
  id,
  companyId: "C",
  levelKey,
  code: id,
  label: id,
  parentId,
  domain: "financial",
});

describe("M3 — finance table allocates SIGNED net amounts per impact (CAPEX / one-off excluded)", () => {
  const l = lever({
    lockedPlan: { grossSavings: 10, netSavings: 6, opexOneOff: 0, opexRec: 2, capex: 5 },
    impacts: [
      imp("g", { amount: 10, hierarchyLeafId: "A", gainDate: "2026-02-01" }),
      imp("o", { type: "cost", nature: "opex_rec", amount: 2, hierarchyLeafId: "B" }),
      imp("c", { type: "cost", nature: "capex", amount: 5, hierarchyLeafId: "C" }),
      imp("x", { type: "cost", nature: "oneoff", amount: 3, hierarchyLeafId: "C" }),
    ],
  });
  const rows = engine.financeByHierarchyLevel(
    data([l]),
    { hierarchyLevels: levels },
    0,
    [node("A"), node("B"), node("C")],
    { unrounded: true, today: new Date("2026-01-15") }
  );
  const row = (id: string) => rows.find((r) => r.nodeId === id);

  it("réactualisé = signed net of each line (gain +, OPEX récurrent −)", () => {
    expect(row("A")?.reforecast).toBeCloseTo(10, 9);
    expect(row("B")?.reforecast).toBeCloseTo(-2, 9);
  });
  it("a CAPEX / one-off only node gets nothing", () => {
    expect(row("C")).toBeUndefined();
  });
  it("totals equal the lever totals (planifié initial = plan figé, réactualisé = impacts)", () => {
    const t = financeTotals(rows);
    expect(t.planned).toBe(6);
    expect(t.reforecast).toBe(engine.displayedReforecastNet(l).value);
    expect(t.reforecast).toBe(8);
  });
});

describe("M4 — « Années » filter: recurring impacts run every year from start (until end)", () => {
  const l = lever({
    impacts: [
      imp("g", { amount: 12, gainDate: "2026-03-01", hierarchyLeafId: "A" }),
      imp("o", {
        type: "cost",
        nature: "opex_rec",
        amount: 2,
        capexDeploymentDate: "2027-01-01",
        endDate: "2027-12-31",
        hierarchyLeafId: "A",
      }),
      imp("c", { type: "cost", nature: "capex", amount: 50, capexDeploymentDate: "2028-06-01" }),
    ],
  });
  const d = data([l]);
  const total = (years: number[]) =>
    financeTotals(
      engine.financeByHierarchyLevel(d, { hierarchyLevels: levels }, 0, [node("A")], {
        years: new Set(years),
        unrounded: true,
        today: new Date("2026-01-15"),
      })
    ).reforecast;

  it("a recurring gain without end date still counts years after its start year", () => {
    expect(total([2028])).toBe(12); // gain only (OPEX ended in 2027; CAPEX never weighs)
    expect(total([2027])).toBe(10); // gain − OPEX
    expect(total([2026])).toBe(12);
  });
  it("years before any impact exclude the lever", () => {
    expect(total([2025])).toBe(0);
  });
  it("year options extend open-ended recurring impacts", () => {
    expect(engine.financeYearOptions([l], new Date("2026-01-15"))).toEqual([2026, 2027, 2028]);
  });
});

// ─── M5 : P&L aligné sur les totaux leviers ─────────────────────────────────────────────────────

describe("M5 — P&L plan / réactualisé / réalisé match the lever totals", () => {
  const today = new Date("2026-06-15");
  const l = lever({
    status: "in_progress",
    pnlMap: "P1",
    lockedPlan: { grossSavings: 9, netSavings: 6, opexOneOff: 0, opexRec: 3, capex: 0 },
    reforecast: { grossSavings: 9, netSavings: 6, opexOneOff: 0, opexRec: 3, capex: 0 },
    impacts: [
      imp("g", { amount: 10, gainDate: "2026-02-01", status: "ongoing" }),
      imp("o", {
        type: "cost",
        nature: "opex_rec",
        amount: 2,
        pnlMap: "P2",
        capexDeploymentDate: "2026-09-01",
        status: "planned",
      }),
      imp("c", { type: "cost", nature: "capex", amount: 5, capexDeploymentDate: "2026-01-10" }),
    ],
  });
  const cancelled = lever({
    id: "L002",
    status: "cancelled",
    pnlMap: "P1",
    lockedPlan: { grossSavings: 4, netSavings: 4, opexOneOff: 0, opexRec: 0, capex: 0 },
    netSavings: 4,
  });
  const pts = engine.pnlImpactDetailed(
    data([l, cancelled]),
    undefined,
    undefined,
    undefined,
    today
  );
  const sum = (k: "plan" | "reforecast" | "realized") => pts.reduce((s, p) => s + p[k], 0);

  it("plan = planifié initial (plan figé, abandonnés compris)", () => {
    expect(sum("plan")).toBeCloseTo(engine.plannedInitialNet([l, cancelled]), 9);
  });
  it("réactualisé = displayedReforecastNet (CAPEX never deducted)", () => {
    expect(sum("reforecast")).toBeCloseTo(8, 9);
    expect(sum("reforecast")).toBeCloseTo(engine.displayedReforecastNet(l).value, 9);
  });
  it("réalisé = realized impacts (not plan × action progress)", () => {
    expect(sum("realized")).toBeCloseTo(engine.realizedSavings(l), 9);
    expect(sum("realized")).toBe(10);
  });
});

// ─── M7 : une seule règle « réalisé » / « en retard » ───────────────────────────────────────────

describe("M7 — one realized/late rule", () => {
  const today = new Date("2026-06-15");
  const pending = imp("p", {
    amount: 5,
    gainDate: "2026-01-01",
    status: "ongoing",
    realizedApproval: { status: "pending" },
  });
  const pastNoStatus = imp("n", { amount: 3, gainDate: "2026-01-01" });
  const pastPlanned = imp("x", { amount: 2, gainDate: "2026-01-01", status: "planned" });

  it("an impact awaiting finance validation is NOT realized, and not late either", () => {
    expect(isImpactRealized(pending, today)).toBe(false);
    expect(isImpactLate(pending, today)).toBe(false);
    expect(engine.realizedSavings(lever({ impacts: [pending] }))).toBe(0);
  });
  it("a past-dated impact without status is realized and NOT late (never both)", () => {
    expect(isImpactRealized(pastNoStatus, today)).toBe(true);
    expect(isImpactLate(pastNoStatus, today)).toBe(false);
    expect(engine.isLeverLate(lever({ impacts: [pastNoStatus] }), today)).toBe(false);
  });
  it("a past-dated impact explicitly left « planned » is late and not realized", () => {
    expect(isImpactRealized(pastPlanned, today)).toBe(false);
    expect(isImpactLate(pastPlanned, today)).toBe(true);
    expect(engine.isLeverLate(lever({ impacts: [pastPlanned] }), today)).toBe(true);
  });
  it("finance approval makes it count", () => {
    const approved = { ...pending, realizedApproval: { status: "approved" as const } };
    expect(engine.realizedSavings(lever({ impacts: [approved] }))).toBe(5);
  });
});

// ─── M9 : donut coûts par centre de coût ────────────────────────────────────────────────────────

describe("M9 — cost-by-hierarchy donut reads the impact leaf and keeps direct costs on drill", () => {
  const nodes = [node("P", "l1"), node("C1", "l2", "P")];
  const l = lever({
    impacts: [
      imp("a", { type: "cost", nature: "capex", amount: 3, hierarchyLeafId: "C1" }),
      imp("b", { type: "cost", nature: "oneoff", amount: 2, hierarchyLeafId: "P" }),
    ],
  });
  const d = data([l]);

  it("root level uses each impact's own leaf (the lever has none)", () => {
    const root = costsByHierarchyNode(d, nodes, "l1", null);
    expect(root.map((s) => [s.node.id, s.amount])).toEqual([["P", 5]]);
  });
  it("drilling into P shows a « (direct) » slice so the children add up to the parent", () => {
    const drill = costsByHierarchyNode(d, nodes, "l2", "P");
    expect(drill.map((s) => [s.node.id, s.amount, !!s.isDirect])).toEqual([
      ["C1", 3, false],
      ["P", 2, true],
    ]);
    expect(drill.reduce((s, x) => s + x.amount, 0)).toBe(5);
  });
});

// ─── Mineurs ────────────────────────────────────────────────────────────────────────────────────

describe("minor calculation fixes", () => {
  it("realizationPct: 0 when the target is ≤ 0 or the realized is negative", () => {
    expect(engine.realizationPct(-1, -2)).toBe(0);
    expect(engine.realizationPct(-1, 10)).toBe(0);
    expect(engine.realizationPct(5, 10)).toBe(50);
    expect(engine.realizationPct(12, 10)).toBe(120);
  });

  it("programSummary.fteImpact is rounded (no 0.30000000000000004)", () => {
    const s = engine.programSummary(
      data([lever({ id: "a", fteImpact: 0.1 }), lever({ id: "b", fteImpact: 0.2 })])
    );
    expect(s.fteImpact).toBe(0.3);
  });

  it("parseLocalDate reads a date-only string as a LOCAL calendar date", () => {
    const d = parseLocalDate("2026-03-01");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 2, 1, 0]);
  });

  it("réactualisé does not jump when a lever reaches « Exécuté »", () => {
    const impacts = [imp("g", { amount: 8 })];
    const locked = { grossSavings: 5, netSavings: 5, opexOneOff: 0, opexRec: 0, capex: 0 };
    const before = lever({ status: "validated", lockedPlan: locked, impacts });
    const after = lever({ status: "in_progress", lockedPlan: locked, reforecast: locked, impacts });
    expect(engine.displayedReforecastNet(before).value).toBe(8);
    expect(engine.displayedReforecastNet(after).value).toBe(8);
  });

  it("roundLargestRemainder keeps the rounded sum", () => {
    const r = roundLargestRemainder([0.33, 0.33, 0.34], 1);
    expect(r.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    const n = roundLargestRemainder([-0.25, -0.25], -0.5);
    expect(n.reduce((s, v) => s + v, 0)).toBeCloseTo(-0.5, 9);
  });

  it("finance tree: children (incl. « direct ») sum to their displayed parent", () => {
    const row = (nodeId: string, v: number) => ({
      nodeId,
      code: nodeId,
      label: nodeId,
      planned: v,
      reforecast: v,
      cancelled: 0,
      late: 0,
      realized: 0,
    });
    const nodes = [node("P", "l1"), node("C1", "l2", "P"), node("C2", "l2", "P")];
    const parents = [row("P", 1.0)];
    const children = [row("C1", 0.33), row("C2", 0.33)];
    const tree = roundFinanceTree(attachChildren(parents, children, nodes), financeTotals(parents));
    const kids = tree[0].children;
    expect(kids.some((c) => c.isDirect)).toBe(true);
    expect(kids.reduce((s, c) => s + c.planned, 0)).toBeCloseTo(tree[0].planned, 9);
  });

  it("filterProgramScopedLevers: strict programme scope, consolidated view", () => {
    const ls = [lever({ id: "a", programId: "p1" }), lever({ id: "b", programId: undefined })];
    expect(filterProgramScopedLevers(ls, { programId: "p1" }).map((l) => l.id)).toEqual(["a"]);
    expect(
      filterProgramScopedLevers(ls, {
        programId: null,
        isConsolidatedView: true,
        consolidatedProgramIds: ["p1"],
      }).map((l) => l.id)
    ).toEqual(["a"]);
  });
});

// ─── M1 : exercice du programme + libellés réels ────────────────────────────────────────────────

describe("M1 — savingsSeries uses the programme fiscal year and real month labels", () => {
  const today = new Date("2026-08-15");
  const l = lever({
    status: "delivered",
    end: "2026-05-15",
    deliveredDate: "2026-07-10",
    netSavings: 4,
    impacts: [imp("g", { amount: 4, gainDate: "2026-05-01" })],
  });

  it("an empty legacy fyStart falls back to the current calendar year (no all-zero series)", () => {
    const s = engine.savingsSeries(data([l], ""), "month", today);
    expect(s[0].month).toBe("Jan 2026");
    expect(s[11].planned).toBe(4);
  });

  it("labels follow the programme's fiscal year (April start)", () => {
    const s = engine.savingsSeries(data([l], ""), "month", today, "2026-04-01");
    expect(s[0].month).toBe("Apr 2026");
    expect(s[11].month).toBe("Mar 2027");
    // Fin du levier en mai → 2e mois de l'exercice.
    expect(s[0].planned).toBe(0);
    expect(s[1].planned).toBe(4);
  });

  it("the current quarter shows its realized to date (not hidden until quarter end)", () => {
    const q = engine.savingsSeries(data([l]), "quarter", today);
    expect(q.map((p) => p.month)).toEqual(["Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"]);
    expect(q[2].actual).toBe(4);
    expect(q[3].actual).toBeNull();
  });
});
