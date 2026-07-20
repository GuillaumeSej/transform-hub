import { describe, it, expect } from "vitest";
import {
  applyPlanLock,
  createLever,
  updateLever,
  deleteSubLever,
} from "@/lib/leversLogic";
import type { Lever, LeverStatus, SubLever } from "@/types";

const baseLever: Lever = {
  id: "L001",
  code: "L001",
  type: "Sourcing",
  name: "Test Lever",
  ws: "WS-01",
  owner: "Test Lever Owner",
  ownerInit: "TL",
  sponsor: "Test Sponsor",
  sponsorInit: "TS",
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
  priority: "medium",
  risk: "low",
  grossSavings: 10,
  netSavings: 8,
  opexOneOff: 1,
  opexRec: 0.5,
  capex: 2,
  fteImpact: -5,
  popImpacted: 100,
  dependencies: [],
  description: "Test lever",
  createdAt: "2026-01-01",
  lastUpdate: "2026-06-01",
  actions: [],
};

function makeLever(status: LeverStatus, overrides?: Partial<Lever>): Lever {
  return {
    ...baseLever,
    ...overrides,
    status,
  };
}

describe("leversLogic — applyPlanLock", () => {
  it("does nothing for status before L3 (validated)", () => {
    const lever = makeLever("idea");
    const result = applyPlanLock(lever);
    expect(result.lockedPlan).toBeUndefined();
    expect(result.reforecast).toBeUndefined();
  });

  it("locks plan at L3 (validated)", () => {
    const lever = makeLever("validated", {
      grossSavings: 10,
      netSavings: 8,
      opexOneOff: 1,
      opexRec: 0.5,
      capex: 2,
    });
    const result = applyPlanLock(lever);
    expect(result.lockedPlan).toBeDefined();
    expect(result.lockedPlan?.grossSavings).toBe(10);
    expect(result.lockedPlan?.netSavings).toBe(8);
    expect(result.lockedPlan?.opexOneOff).toBe(1);
    expect(result.lockedPlan?.opexRec).toBe(0.5);
    expect(result.lockedPlan?.capex).toBe(2);
    expect(result.reforecast).toBeUndefined();
  });

  it("initializes reforecast at L4 (in_progress) from lockedPlan", () => {
    const lever = makeLever("in_progress", {
      grossSavings: 15,
      netSavings: 12,
      opexOneOff: 2,
      opexRec: 1,
      capex: 3,
    });
    const result = applyPlanLock(lever);
    expect(result.lockedPlan).toBeDefined();
    expect(result.lockedPlan?.grossSavings).toBe(15);
    expect(result.reforecast).toBeDefined();
    expect(result.reforecast?.grossSavings).toBe(15);
  });

  it("initializes reforecast from snapshot when no lockedPlan at L4+", () => {
    const lever = makeLever("in_progress");
    const result = applyPlanLock(lever);
    expect(result.reforecast).toBeDefined();
    expect(result.reforecast?.grossSavings).toBe(lever.grossSavings);
  });

  it("does not overwrite existing lockedPlan", () => {
    const lever = makeLever("validated", {
      lockedPlan: {
        grossSavings: 5,
        netSavings: 4,
        opexOneOff: 0,
        opexRec: 0,
        capex: 0,
      },
    });
    const result = applyPlanLock(lever);
    expect(result.lockedPlan?.grossSavings).toBe(5);
  });

  it("does not overwrite existing reforecast", () => {
    const lever = makeLever("in_progress", {
      lockedPlan: { grossSavings: 10, netSavings: 8, opexOneOff: 1, opexRec: 0.5, capex: 2 },
      reforecast: { grossSavings: 12, netSavings: 10, opexOneOff: 1, opexRec: 0.5, capex: 2 },
    });
    const result = applyPlanLock(lever);
    expect(result.reforecast?.grossSavings).toBe(12);
  });

  it("does nothing for cancelled status", () => {
    const lever = makeLever("cancelled");
    const result = applyPlanLock(lever);
    expect(result.lockedPlan).toBeUndefined();
    expect(result.reforecast).toBeUndefined();
  });
});

type LeverInput = Omit<Lever, "id" | "createdAt" | "lastUpdate">;

function omitBaseLever(): LeverInput {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, createdAt, lastUpdate, ...rest } = baseLever;
  return rest;
}

describe("leversLogic — createLever", () => {
  it("creates a lever with auto-generated id", () => {
    const result = createLever([], omitBaseLever(), "testuser");
    expect(result.lever.id).toBe("L001");
    expect(result.lever.createdAt).toBeDefined();
    expect(result.lever.lastUpdate).toBeDefined();
    expect(result.levers).toHaveLength(1);
  });

  it("generates sequential ids", () => {
    const existing = [{ ...baseLever, id: "L001" }, { ...baseLever, id: "L003" }];
    const result = createLever(existing as Lever[], omitBaseLever(), "user");
    expect(result.lever.id).toBe("L004");
  });

  it("creates audit entry", () => {
    const result = createLever([], omitBaseLever(), "alice");
    expect(result.auditEntries).toHaveLength(1);
    expect(result.auditEntries[0].action).toBe("created");
    expect(result.auditEntries[0].user).toBe("alice");
  });
});

describe("leversLogic — updateLever (status change & plan lock triggering)", () => {
  it("updates status from idea to in_progress and triggers plan lock", () => {
    const levers = [makeLever("idea")];
    const result = updateLever(levers, "L001", { status: "in_progress" }, "user");
    expect(result.lever.status).toBe("in_progress");
    expect(result.lever.reforecast).toBeDefined();
  });

  it("triggers lockedPlan when status reaches validated", () => {
    const levers = [makeLever("qualified", { grossSavings: 20, netSavings: 15 })];
    const result = updateLever(levers, "L001", { status: "validated" }, "user");
    expect(result.lever.lockedPlan).toBeDefined();
    expect(result.lever.lockedPlan?.grossSavings).toBe(20);
    expect(result.lever.lockedPlan?.netSavings).toBe(15);
  });

  it("protects financial fields once lockedPlan exists", () => {
    const levers = [
      makeLever("validated", {
        lockedPlan: { grossSavings: 10, netSavings: 8, opexOneOff: 1, opexRec: 0.5, capex: 2 },
        grossSavings: 10,
        netSavings: 8,
      }),
    ];
    const result = updateLever(levers, "L001", { grossSavings: 99, netSavings: 99 }, "user");
    expect(result.lever.grossSavings).toBe(10);
    expect(result.lever.netSavings).toBe(8);
  });

  it("creates audit entries for changed fields", () => {
    const levers = [makeLever("idea")];
    const result = updateLever(levers, "L001", { status: "qualified", priority: "high" }, "user");
    expect(result.auditEntries.length).toBeGreaterThanOrEqual(1);
    expect(result.auditEntries[0].user).toBe("user");
  });

  it("throws for non-existent lever", () => {
    expect(() => updateLever([], "L999", { status: "qualified" }, "user")).toThrow(
      'Lever "L999" introuvable'
    );
  });
});

describe("leversLogic — deleteSubLever", () => {
  it("removes a sublever by id", () => {
    const subLevers: SubLever[] = [
      {
        id: "SL001",
        leverId: "L001",
        name: "Sub1",
        expensePost: "P1",
        businessUnit: "BU1",
        pnlMap: "PNL01",
        grossSavings: 5,
        netSavings: 4,
        opexOneOff: 0,
        opexRec: 0,
        capex: 0,
        fteImpact: 0,
        popImpacted: 0,
        start: "2026-01-01",
        end: "2026-12-31",
        status: "in_progress",
        dependencies: [],
        actions: [],
      },
      {
        id: "SL002",
        leverId: "L001",
        name: "Sub2",
        expensePost: "P2",
        businessUnit: "BU2",
        pnlMap: "PNL01",
        grossSavings: 3,
        netSavings: 2,
        opexOneOff: 0,
        opexRec: 0,
        capex: 0,
        fteImpact: 0,
        popImpacted: 0,
        start: "2026-01-01",
        end: "2026-12-31",
        status: "in_progress",
        dependencies: [],
        actions: [],
      },
    ];
    const levers = [makeLever("in_progress")];
    const result = deleteSubLever(levers, subLevers, "SL001", "user");
    expect(result.subLevers).toHaveLength(1);
    expect(result.subLevers[0].id).toBe("SL002");
    expect(result.deletedId).toBe("SL001");
  });

  it("creates audit entry on deletion", () => {
    const subLevers: SubLever[] = [
      {
        id: "SL001",
        leverId: "L001",
        name: "Sub1",
        expensePost: "P1",
        businessUnit: "BU1",
        pnlMap: "PNL01",
        grossSavings: 5,
        netSavings: 4,
        opexOneOff: 0,
        opexRec: 0,
        capex: 0,
        fteImpact: 0,
        popImpacted: 0,
        start: "2026-01-01",
        end: "2026-12-31",
        status: "in_progress",
        dependencies: [],
        actions: [],
      },
    ];
    const levers = [makeLever("in_progress")];
    const result = deleteSubLever(levers, subLevers, "SL001", "alice");
    expect(result.auditEntries).toHaveLength(1);
    expect(result.auditEntries[0].action).toBe("updated");
    expect(result.auditEntries[0].user).toBe("alice");
  });

  it("returns unchanged list when sublever id not found", () => {
    const subLevers: SubLever[] = [
      {
        id: "SL001",
        leverId: "L001",
        name: "Sub1",
        expensePost: "P1",
        businessUnit: "BU1",
        pnlMap: "PNL01",
        grossSavings: 5,
        netSavings: 4,
        opexOneOff: 0,
        opexRec: 0,
        capex: 0,
        fteImpact: 0,
        popImpacted: 0,
        start: "2026-01-01",
        end: "2026-12-31",
        status: "in_progress",
        dependencies: [],
        actions: [],
      },
    ];
    const levers = [makeLever("in_progress")];
    const result = deleteSubLever(levers, subLevers, "SL999", "user");
    expect(result.subLevers).toHaveLength(1);
    expect(result.deletedId).toBe("SL999");
    expect(result.auditEntries).toHaveLength(0);
  });
});
