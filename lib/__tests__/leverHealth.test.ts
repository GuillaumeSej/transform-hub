import { describe, expect, it } from "vitest";
import {
  computeLeverHealth,
  leverHealthCounts,
  groupLeversByHealthDimension,
} from "@/lib/leverHealth";
import type { Alert, Lever, Workstream } from "@/types";

function lever(overrides: Partial<Lever> = {}): Lever {
  return {
    id: "L1",
    programId: "p1",
    code: "L1",
    type: "Digital",
    name: "Initiative",
    ws: "WS1",
    owner: "Owner",
    ownerInit: "OW",
    sponsor: "Sponsor",
    sponsorInit: "SP",
    geography: "Europe",
    country: "France",
    entity: "Entity",
    function: "Finance",
    costCenter: "CC1",
    pnlMap: "GA",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "in_progress",
    progress: 50,
    risk: "low",
    grossSavings: 1,
    netSavings: 0.8,
    opexOneOff: 0,
    opexRec: 0,
    capex: 0,
    fteImpact: 0,
    popImpacted: "",
    dependencies: [],
    description: "",
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
    ...overrides,
  };
}

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "A1",
    type: "amber",
    // Fraîche par défaut (pas de date fixe passée) pour ne pas déclencher, par accident, le
    // critère de délai des seuils de risque par défaut (voir DEFAULT_RISK_THRESHOLDS,
    // lib/engine.ts) dans les tests qui ne testent QUE le critère de montant.
    ts: new Date().toISOString().slice(0, 10),
    scope: "L1",
    title: "Alert",
    desc: "Description",
    actorRole: "cto",
    impactEur: -60_000,
    resolved: false,
    ...overrides,
  };
}

describe("leverHealth", () => {
  it("prioritizes cancelled over alerts", () => {
    expect(
      computeLeverHealth(lever({ status: "cancelled" }), [alert({ type: "red" })]).health
    ).toBe("cancelled");
  });

  it("derives health from the risk badge level, not the colour of a single alert (audit C6)", () => {
    const thresholds = [
      { level: "critical" as const, minAmount: 100_000 },
      { level: "medium" as const, minAmount: 10_000 },
      { level: "low" as const, minAmount: 0 },
    ];
    expect(
      computeLeverHealth(lever(), [alert({ type: "amber", impactEur: -200_000 })], thresholds)
        .health
    ).toBe("critical");
    expect(
      computeLeverHealth(lever(), [alert({ type: "red", impactEur: -20_000 })], thresholds).health
    ).toBe("watch");
    // Petite alerte rouge sous le seuil : badge « Faible » → « Dans les temps ».
    expect(
      computeLeverHealth(lever(), [alert({ type: "red", impactEur: -5_000 })], thresholds).health
    ).toBe("onTrack");
  });

  it("uses computeLeverRisk with company thresholds", () => {
    const thresholds = [
      { level: "critical" as const, minAmount: 100_000 },
      { level: "medium" as const, minAmount: 10_000 },
      { level: "low" as const, minAmount: 0 },
    ];
    expect(
      computeLeverHealth(lever(), [alert({ type: "amber", impactEur: -20_000 })], thresholds)
    ).toMatchObject({
      health: "watch",
      computedRisk: "medium",
    });
  });

  it("ignores resolved alerts", () => {
    expect(computeLeverHealth(lever(), [alert({ type: "red", resolved: true })]).health).toBe(
      "onTrack"
    );
  });

  it("does not turn positive or informational alerts into risk", () => {
    expect(
      computeLeverHealth(lever(), [alert({ type: "green", impactEur: 2_000_000 })]).health
    ).toBe("onTrack");
    expect(
      computeLeverHealth(lever(), [alert({ type: "blue", impactEur: -2_000_000 })]).health
    ).toBe("onTrack");
  });

  it("counts non-cancelled levers by health (dashboard KPI « Leviers à risque », audit C6)", () => {
    const levers = [
      lever({ id: "L1" }),
      lever({ id: "L2" }),
      lever({ id: "L3" }),
      lever({ id: "L4", status: "cancelled" }),
    ];
    const thresholds = [
      { level: "critical" as const, minAmount: 100_000 },
      { level: "medium" as const, minAmount: 10_000 },
      { level: "low" as const, minAmount: 0 },
    ];
    const alerts = [
      alert({ scope: "L1", type: "red", impactEur: -200_000 }),
      alert({ id: "a2", scope: "L2", type: "amber", impactEur: -20_000 }),
      alert({ id: "a3", scope: "L3", type: "red", impactEur: -200_000, resolved: true }),
      alert({ id: "a4", scope: "L4", type: "red", impactEur: -200_000 }),
    ];
    expect(leverHealthCounts(levers, alerts, thresholds)).toEqual({
      onTrack: 1,
      watch: 1,
      critical: 1,
    });
  });

  it("groups by workstream, actual country and function", () => {
    const levers = [
      lever({ id: "L1", ws: "WS1", country: "France", geography: "Europe", function: "Finance" }),
      lever({ id: "L2", ws: "WS2", country: "Japan", geography: "APAC", function: "IT" }),
    ];
    const workstreams: Workstream[] = [
      { id: "WS1", name: "Efficiency", sponsor: "A", color: "#000", target: 1 },
      { id: "WS2", name: "Digital", sponsor: "B", color: "#000", target: 1 },
    ];

    expect(
      groupLeversByHealthDimension(levers, "workstream", [], workstreams).map((g) => g.label)
    ).toEqual(["Digital", "Efficiency"]);
    expect(
      groupLeversByHealthDimension(levers, "country", [], workstreams).map((g) => g.label)
    ).toEqual(["France", "Japan"]);
    expect(
      groupLeversByHealthDimension(levers, "function", [], workstreams).map((g) => g.label)
    ).toEqual(["Finance", "IT"]);
  });
});

describe("computeLeverRisk — alertes de risque uniquement (audit C6)", () => {
  it("une alerte verte ou bleue ne fait pas monter le badge Risque", async () => {
    const { computeLeverRisk } = await import("@/lib/engine");
    expect(computeLeverRisk("L1", [alert({ type: "green", impactEur: 2_000_000 })]).level).toBe(
      "low"
    );
    expect(computeLeverRisk("L1", [alert({ type: "red", impactEur: -2_000_000 })]).level).not.toBe(
      "low"
    );
  });
});
