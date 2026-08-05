import { describe, it, expect } from "vitest";
import {
  countHealthStatuses,
  groupLeversByDimension,
  indexAlertsByLever,
  leverHealth,
} from "@/lib/leverHealth";
import type { Alert, Lever, Workstream } from "@/types";

function makeLever(overrides: Partial<Lever>): Lever {
  return {
    id: "L001",
    code: "L001",
    type: "Sourcing",
    name: "Test Lever",
    ws: "WS-01",
    owner: "Alice",
    ownerInit: "A",
    sponsor: "Bob",
    sponsorInit: "B",
    geography: "France",
    country: "France",
    entity: "E1",
    function: "IT",
    costCenter: "CC1",
    pnlMap: "P1",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "in_progress",
    progress: 40,
    risk: "low",
    grossSavings: 1,
    netSavings: 0.8,
    opexOneOff: 0.1,
    opexRec: 0,
    capex: 0.2,
    fteImpact: 0,
    popImpacted: 0,
    dependencies: [],
    description: "",
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
    ...overrides,
  };
}

function makeAlert(overrides: Partial<Alert>): Alert {
  return {
    id: "A1",
    type: "amber",
    ts: "2026-06-01",
    scope: "L001",
    title: "Alert",
    desc: "Test alert",
    actorRole: "cto",
    resolved: false,
    ...overrides,
  };
}

describe("leverHealth", () => {
  it("returns 'cancelled' when the lever status is cancelled (takes precedence over everything)", () => {
    const lever = makeLever({ status: "cancelled", risk: "critical" });
    const alerts = [makeAlert({ type: "red" })];
    expect(leverHealth(lever, alerts)).toBe("cancelled");
  });

  it("returns 'onTrack' when risk is low and there are no alerts", () => {
    expect(leverHealth(makeLever({ risk: "low" }), [])).toBe("onTrack");
  });

  it("returns 'watch' when there is an active amber alert", () => {
    expect(leverHealth(makeLever({ risk: "low" }), [makeAlert({ type: "amber" })])).toBe("watch");
  });

  it("returns 'watch' when risk is medium (no alerts required)", () => {
    expect(leverHealth(makeLever({ risk: "medium" }), [])).toBe("watch");
  });

  it("returns 'critical' when there is an active red alert", () => {
    expect(leverHealth(makeLever({ risk: "low" }), [makeAlert({ type: "red" })])).toBe("critical");
  });

  it("returns 'critical' when risk is high", () => {
    expect(leverHealth(makeLever({ risk: "high" }), [])).toBe("critical");
  });

  it("returns 'critical' when risk is critical", () => {
    expect(leverHealth(makeLever({ risk: "critical" }), [])).toBe("critical");
  });

  it("ignores resolved alerts", () => {
    const lever = makeLever({ risk: "low" });
    const alerts = [makeAlert({ type: "red", resolved: true })];
    expect(leverHealth(lever, alerts)).toBe("onTrack");
  });

  it("red alert prime over amber alert (critical wins)", () => {
    const lever = makeLever({ risk: "low" });
    const alerts = [makeAlert({ id: "A1", type: "amber" }), makeAlert({ id: "A2", type: "red" })];
    expect(leverHealth(lever, alerts)).toBe("critical");
  });

  it("green/blue alerts do not degrade onTrack status", () => {
    const lever = makeLever({ risk: "low" });
    const alerts = [makeAlert({ id: "A1", type: "green" }), makeAlert({ id: "A2", type: "blue" })];
    expect(leverHealth(lever, alerts)).toBe("onTrack");
  });
});

describe("indexAlertsByLever", () => {
  it("groups alerts by scope", () => {
    const alerts = [
      makeAlert({ id: "A1", scope: "L001" }),
      makeAlert({ id: "A2", scope: "L001" }),
      makeAlert({ id: "A3", scope: "L002" }),
    ];
    const index = indexAlertsByLever(alerts);
    expect(index.get("L001")).toHaveLength(2);
    expect(index.get("L002")).toHaveLength(1);
    expect(index.get("L999")).toBeUndefined();
  });
});

describe("groupLeversByDimension", () => {
  const workstreams: Workstream[] = [
    { id: "WS-01", name: "Supply Chain", sponsor: "Alice", color: "#000", target: 10 },
    { id: "WS-02", name: "Digital", sponsor: "Bob", color: "#000", target: 5 },
  ];

  it("groups by workstream and resolves workstream label from the referential", () => {
    const levers = [
      makeLever({ id: "L001", ws: "WS-01" }),
      makeLever({ id: "L002", ws: "WS-01" }),
      makeLever({ id: "L003", ws: "WS-02" }),
    ];
    const groups = groupLeversByDimension(levers, "workstream", new Map(), workstreams);
    expect(groups).toHaveLength(2);
    // Ordre : nombre décroissant → WS-01 (2 levers) avant WS-02 (1 lever)
    expect(groups[0].group).toBe("Supply Chain");
    expect(groups[0].levers).toHaveLength(2);
    expect(groups[1].group).toBe("Digital");
  });

  it("groups by country and by function", () => {
    const levers = [
      makeLever({ id: "L001", country: "France", geography: "France", function: "IT" }),
      makeLever({ id: "L002", country: "Germany", geography: "Germany", function: "IT" }),
      makeLever({ id: "L003", country: "France", geography: "France", function: "HR" }),
    ];
    const byCountry = groupLeversByDimension(levers, "country", new Map(), workstreams);
    expect(byCountry.map((g) => g.group).sort()).toEqual(["France", "Germany"]);
    expect(byCountry.find((g) => g.group === "France")?.levers).toHaveLength(2);

    const byFunc = groupLeversByDimension(levers, "function", new Map(), workstreams);
    expect(byFunc.map((g) => g.group).sort()).toEqual(["HR", "IT"]);
    expect(byFunc.find((g) => g.group === "IT")?.levers).toHaveLength(2);
  });

  it("resolves health from indexed alerts per lever", () => {
    const levers = [makeLever({ id: "L001", risk: "low" }), makeLever({ id: "L002", risk: "low" })];
    const alertsByLever = new Map<string, Alert[]>([
      ["L001", [makeAlert({ id: "A1", type: "red", scope: "L001" })]],
    ]);
    const groups = groupLeversByDimension(levers, "workstream", alertsByLever, workstreams);
    const l1 = groups[0].levers.find((c) => c.lever.id === "L001");
    const l2 = groups[0].levers.find((c) => c.lever.id === "L002");
    expect(l1?.health).toBe("critical");
    expect(l2?.health).toBe("onTrack");
  });

  it("sorts groups by lever count descending, then alphabetically for equal counts", () => {
    const levers = [
      makeLever({ id: "L001", function: "Zeta" }),
      makeLever({ id: "L002", function: "Alpha" }),
      makeLever({ id: "L003", function: "Beta" }),
    ];
    const groups = groupLeversByDimension(levers, "function", new Map(), workstreams);
    // 3 groupes équivalents (1 lever chacun) → tri alphabétique
    expect(groups.map((g) => g.group)).toEqual(["Alpha", "Beta", "Zeta"]);
  });

  it("excludes empty groups from the output", () => {
    const groups = groupLeversByDimension([], "workstream", new Map(), workstreams);
    expect(groups).toHaveLength(0);
  });

  it("falls back to '—' when the dimension value is missing (country/function empty)", () => {
    const levers = [makeLever({ country: "", geography: "", function: "" })];
    const byCountry = groupLeversByDimension(levers, "country", new Map(), workstreams);
    const byFunc = groupLeversByDimension(levers, "function", new Map(), workstreams);
    expect(byCountry[0].group).toBe("—");
    expect(byFunc[0].group).toBe("—");
  });

  it("falls back to the workstream id when the workstream is not in the referential", () => {
    const levers = [makeLever({ ws: "WS-UNKNOWN" })];
    const groups = groupLeversByDimension(levers, "workstream", new Map(), workstreams);
    expect(groups[0].group).toBe("WS-UNKNOWN");
  });
});

describe("countHealthStatuses", () => {
  it("counts leaves by status across all groups", () => {
    const groups = [
      {
        group: "G1",
        levers: [
          { lever: makeLever({ id: "L1" }), health: "onTrack" as const },
          { lever: makeLever({ id: "L2" }), health: "watch" as const },
        ],
      },
      {
        group: "G2",
        levers: [
          { lever: makeLever({ id: "L3" }), health: "critical" as const },
          { lever: makeLever({ id: "L4" }), health: "cancelled" as const },
          { lever: makeLever({ id: "L5" }), health: "onTrack" as const },
        ],
      },
    ];
    const counts = countHealthStatuses(groups);
    expect(counts).toEqual({ onTrack: 2, watch: 1, critical: 1, cancelled: 1 });
  });

  it("returns zeros for empty input", () => {
    expect(countHealthStatuses([])).toEqual({ onTrack: 0, watch: 0, critical: 0, cancelled: 0 });
  });
});
