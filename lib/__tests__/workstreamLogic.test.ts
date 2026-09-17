import { describe, it, expect } from "vitest";
import { leverDeclaredProgress, workstreamDeclaredProgress } from "@/lib/workstreamLogic";
import type { Lever, LeverAction } from "@/types";

function makeAction(overrides?: Partial<LeverAction>): LeverAction {
  return {
    id: "A1",
    name: "Action",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "todo",
    ...overrides,
  };
}

const baseLever: Lever = {
  id: "L001",
  code: "L001",
  programId: "p1",
  type: "Sourcing",
  name: "Test Lever",
  ws: "WS-01",
  owner: "Owner",
  ownerInit: "O",
  sponsor: "Sponsor",
  sponsorInit: "S",
  geography: "Europe",
  country: "France",
  entity: "Entity A",
  function: "Supply Chain",
  costCenter: "CC01",
  pnlMap: "PNL01",
  start: "2026-01-01",
  end: "2026-12-31",
  status: "idea",
  progress: 0,
  risk: "low",
  grossSavings: 10,
  netSavings: 8,
  opexOneOff: 1,
  opexRec: 0.5,
  capex: 2,
  fteImpact: -5,
  popImpacted: "",
  dependencies: [],
  description: "Test lever",
  createdAt: "2026-01-01",
  lastUpdate: "2026-06-01",
  actions: [],
};

function makeLever(overrides?: Partial<Lever>): Lever {
  return { ...baseLever, ...overrides };
}

describe("leverDeclaredProgress", () => {
  it("returns null when there are no actions", () => {
    expect(leverDeclaredProgress(undefined)).toBeNull();
    expect(leverDeclaredProgress([])).toBeNull();
  });

  it("returns null when no action has a declared progress", () => {
    const actions = [makeAction(), makeAction({ id: "A2" })];
    expect(leverDeclaredProgress(actions)).toBeNull();
  });

  it("ignores undeclared actions rather than counting them as 0%", () => {
    const actions = [
      makeAction({ declaredProgressPct: 80 }),
      makeAction({ id: "A2" }), // pas déclarée — doit être ignorée, pas comptée comme 0
    ];
    expect(leverDeclaredProgress(actions)).toBe(80);
  });

  it("averages all declared actions", () => {
    const actions = [
      makeAction({ declaredProgressPct: 40 }),
      makeAction({ id: "A2", declaredProgressPct: 60 }),
    ];
    expect(leverDeclaredProgress(actions)).toBe(50);
  });

  it("ignores a NaN declaredProgressPct", () => {
    const actions = [makeAction({ declaredProgressPct: NaN })];
    expect(leverDeclaredProgress(actions)).toBeNull();
  });
});

describe("workstreamDeclaredProgress", () => {
  it("returns null when the workstream has no levers", () => {
    expect(workstreamDeclaredProgress([], "WS-01")).toBeNull();
  });

  it("returns null when no lever of the workstream has any declared action", () => {
    const levers = [makeLever({ actions: [makeAction()] })];
    expect(workstreamDeclaredProgress(levers, "WS-01")).toBeNull();
  });

  it("excludes cancelled levers from the calculation", () => {
    const levers = [
      makeLever({
        id: "L001",
        status: "cancelled",
        actions: [makeAction({ declaredProgressPct: 100 })],
      }),
      makeLever({
        id: "L002",
        actions: [makeAction({ declaredProgressPct: 20 })],
      }),
    ];
    expect(workstreamDeclaredProgress(levers, "WS-01")).toBe(20);
  });

  it("ignores levers outside of the requested workstream", () => {
    const levers = [
      makeLever({ id: "L001", ws: "WS-02", actions: [makeAction({ declaredProgressPct: 90 })] }),
      makeLever({ id: "L002", ws: "WS-01", actions: [makeAction({ declaredProgressPct: 10 })] }),
    ];
    expect(workstreamDeclaredProgress(levers, "WS-01")).toBe(10);
  });

  it("weights levers by workstreamWeightPct when declared", () => {
    const levers = [
      makeLever({
        id: "L001",
        workstreamWeightPct: 80,
        actions: [makeAction({ declaredProgressPct: 100 })],
      }),
      makeLever({
        id: "L002",
        workstreamWeightPct: 20,
        actions: [makeAction({ declaredProgressPct: 0 })],
      }),
    ];
    // 80% * 100 + 20% * 0, poids total 100 => 80.
    expect(workstreamDeclaredProgress(levers, "WS-01")).toBe(80);
  });

  it("splits the remaining weight equally among levers without a declared weight", () => {
    const levers = [
      makeLever({
        id: "L001",
        workstreamWeightPct: 60,
        actions: [makeAction({ declaredProgressPct: 100 })],
      }),
      // Poids implicite : (100 - 60) / 2 = 20 chacun.
      makeLever({ id: "L002", actions: [makeAction({ declaredProgressPct: 0 })] }),
      makeLever({ id: "L003", actions: [makeAction({ declaredProgressPct: 0 })] }),
    ];
    // (60*100 + 20*0 + 20*0) / (60+20+20) = 60.
    expect(workstreamDeclaredProgress(levers, "WS-01")).toBe(60);
  });

  it("falls back to a simple average when every declared weight is 0", () => {
    const levers = [
      makeLever({
        id: "L001",
        workstreamWeightPct: 0,
        actions: [makeAction({ declaredProgressPct: 40 })],
      }),
      makeLever({
        id: "L002",
        workstreamWeightPct: 0,
        actions: [makeAction({ declaredProgressPct: 60 })],
      }),
    ];
    expect(workstreamDeclaredProgress(levers, "WS-01")).toBe(50);
  });

  it("excludes levers with no declared action from both weight and average", () => {
    const levers = [
      makeLever({
        id: "L001",
        workstreamWeightPct: 50,
        actions: [makeAction({ declaredProgressPct: 100 })],
      }),
      // Aucune action déclarée : exclu entièrement, pas 0%.
      makeLever({ id: "L002", workstreamWeightPct: 50, actions: [makeAction()] }),
    ];
    expect(workstreamDeclaredProgress(levers, "WS-01")).toBe(100);
  });
});
