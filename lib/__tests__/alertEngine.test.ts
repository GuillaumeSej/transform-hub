import { describe, it, expect } from "vitest";
import { generateAlerts } from "@/lib/alertEngine";
import type { BeTrackData, Lever, LeverStatus } from "@/types";

const baseLever: Lever = {
  id: "L001",
  code: "L001",
  type: "Sourcing",
  name: "Test Lever",
  ws: "WS-01",
  owner: "Test Owner",
  ownerInit: "TO",
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
  status: "in_progress" as LeverStatus,
  progress: 50,
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

function makeData(overrides?: Partial<BeTrackData>): BeTrackData {
  return {
    program: {
      id: "P01",
      name: "Test",
      sponsor: "CEO",
      target: 50,
      currency: "€M",
      fyStart: "2026-01-01",
      fyEnd: "2026-12-31",
      baselineEBIT: 100,
      revenue: 500,
    },
    workstreams: [],
    leverStatuses: [],
    riskLevels: [],
    priorityLevels: [],
    leverTypes: [],
    geographies: [],
    functions: [],
    pnlAccounts: [],
    levers: [],
    subLevers: [],
    workforce: {
      totalFTE: 200,
      massSalary: 15,
      budgetSalary: 16,
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
    ...overrides,
  };
}

describe("alertEngine — generateAlerts", () => {
  it("returns empty array when no levers and no manual alerts", () => {
    expect(generateAlerts(makeData())).toHaveLength(0);
  });

  it("generates delay alert when lever has any schedule gap > 0", () => {
    // Lever started Jan 1, ends Dec 31 — mid-year expected ~50%, set progress to 20%
    const data = makeData({
      levers: [{ ...baseLever, progress: 20 }],
    });
    const alerts = generateAlerts(data);
    const delayAlerts = alerts.filter((a) => a.id.startsWith("AUTO-DELAY-"));
    expect(delayAlerts.length).toBeGreaterThanOrEqual(1);
    expect(delayAlerts[0].source).toBe("auto");
    expect(delayAlerts[0].resolved).toBe(false);
    expect(delayAlerts[0].owner).toBe("Test Owner");
    expect(delayAlerts[0].impactEur).toBeDefined();
    expect(delayAlerts[0].impactEur!).toBeLessThan(0); // negative = loss
  });

  it("generates red alert for large delay (gap > 20), amber for smaller", () => {
    // Very behind lever: progress 5% when ~50% expected → gap ~45 → red
    const data = makeData({
      levers: [{ ...baseLever, progress: 5 }],
    });
    const redAlerts = generateAlerts(data).filter(
      (a) => a.id.startsWith("AUTO-DELAY-") && a.type === "red"
    );
    expect(redAlerts.length).toBe(1);
  });

  it("generates cost overrun alert when reforecast costs exceed plan (any amount)", () => {
    const plan = { grossSavings: 10, netSavings: 8, opexOneOff: 1, opexRec: 0.5, capex: 2 };
    const data = makeData({
      levers: [
        {
          ...baseLever,
          lockedPlan: plan,
          reforecast: { ...plan, capex: 2.01 }, // +0.01M = dès le 1er €
        },
      ],
    });
    const costAlerts = generateAlerts(data).filter((a) => a.id.startsWith("AUTO-COST-"));
    expect(costAlerts).toHaveLength(1);
    expect(costAlerts[0].type).toBe("red");
    expect(costAlerts[0].impactEur!).toBeLessThan(0);
  });

  it("generates savings cut alert when reforecast savings below plan (any amount)", () => {
    const plan = { grossSavings: 10, netSavings: 8, opexOneOff: 1, opexRec: 0.5, capex: 2 };
    const data = makeData({
      levers: [
        {
          ...baseLever,
          lockedPlan: plan,
          reforecast: { ...plan, netSavings: 7.99 }, // -0.01M
        },
      ],
    });
    const savAlerts = generateAlerts(data).filter((a) => a.id.startsWith("AUTO-SAVINGS-"));
    expect(savAlerts).toHaveLength(1);
    expect(savAlerts[0].type).toBe("amber");
  });

  it("generates green alert for recently delivered lever (M5)", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 2); // 2 days ago
    const data = makeData({
      levers: [
        {
          ...baseLever,
          status: "delivered" as LeverStatus,
          progress: 100,
          lastUpdate: recent.toISOString().slice(0, 10),
        },
      ],
    });
    const greenAlerts = generateAlerts(data).filter((a) => a.id.startsWith("AUTO-M5-"));
    expect(greenAlerts).toHaveLength(1);
    expect(greenAlerts[0].type).toBe("green");
    expect(greenAlerts[0].impactEur).toBeGreaterThan(0);
  });

  it("does NOT generate green alert for lever delivered > 7 days ago", () => {
    const old = new Date();
    old.setDate(old.getDate() - 10);
    const data = makeData({
      levers: [
        {
          ...baseLever,
          status: "delivered" as LeverStatus,
          progress: 100,
          lastUpdate: old.toISOString().slice(0, 10),
        },
      ],
    });
    const greenAlerts = generateAlerts(data).filter((a) => a.id.startsWith("AUTO-M5-"));
    expect(greenAlerts).toHaveLength(0);
  });

  it("manual alerts take priority over auto for the same scope", () => {
    const data = makeData({
      levers: [{ ...baseLever, progress: 10 }], // will generate AUTO-DELAY-L001
      alerts: [
        {
          id: "MANUAL-1",
          type: "red",
          ts: "1h ago",
          scope: "L001",
          title: "Manual alert for L001",
          desc: "This is manual",
          actorRole: "lever",
        },
      ],
    });
    const alerts = generateAlerts(data);
    const l001Alerts = alerts.filter((a) => a.scope === "L001");
    // Only the manual one (auto is deduplicated)
    expect(l001Alerts).toHaveLength(1);
    expect(l001Alerts[0].id).toBe("MANUAL-1");
  });

  it("all auto alerts have source=auto and resolved=false", () => {
    const plan = { grossSavings: 10, netSavings: 8, opexOneOff: 1, opexRec: 0.5, capex: 2 };
    const data = makeData({
      levers: [
        {
          ...baseLever,
          progress: 10,
          lockedPlan: plan,
          reforecast: { ...plan, capex: 5, netSavings: 3 },
        },
      ],
    });
    const autoAlerts = generateAlerts(data).filter((a) => a.source === "auto");
    expect(autoAlerts.length).toBeGreaterThan(0);
    autoAlerts.forEach((a) => {
      expect(a.source).toBe("auto");
      expect(a.resolved).toBe(false);
    });
  });

  it("sorts by resolved last, then severity, then |impactEur| desc", () => {
    const data = makeData({
      alerts: [
        {
          id: "M1",
          type: "green",
          ts: "",
          scope: "X1",
          title: "Low",
          desc: "",
          actorRole: "",
          impactEur: 100,
          resolved: false,
        },
        {
          id: "M2",
          type: "red",
          ts: "",
          scope: "X2",
          title: "High",
          desc: "",
          actorRole: "",
          impactEur: -5000000,
          resolved: false,
        },
        {
          id: "M3",
          type: "red",
          ts: "",
          scope: "X3",
          title: "Resolved",
          desc: "",
          actorRole: "",
          impactEur: -9000000,
          resolved: true,
        },
        {
          id: "M4",
          type: "amber",
          ts: "",
          scope: "X4",
          title: "Medium",
          desc: "",
          actorRole: "",
          impactEur: -200000,
          resolved: false,
        },
      ],
    });
    const alerts = generateAlerts(data);
    // M3 (resolved) should be last
    expect(alerts[alerts.length - 1].id).toBe("M3");
    // Among non-resolved: M2 (red, big impact) first, then M4 (amber), then M1 (green)
    expect(alerts[0].id).toBe("M2");
    expect(alerts[1].id).toBe("M4");
    expect(alerts[2].id).toBe("M1");
  });

  it("cancelled levers do not generate any auto alerts", () => {
    const data = makeData({
      levers: [{ ...baseLever, status: "cancelled" as LeverStatus, progress: 0 }],
    });
    const autoAlerts = generateAlerts(data).filter((a) => a.source === "auto");
    expect(autoAlerts).toHaveLength(0);
  });
});
