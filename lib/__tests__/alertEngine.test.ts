import { afterEach, describe, it, expect, vi } from "vitest";
import { generateAlerts } from "@/lib/alertEngine";
import { computeLeverRisk } from "@/lib/engine";
import { leverHealthCounts } from "@/lib/leverHealth";
import type { BeTrackData, Lever, LeverAction, LeverStatus } from "@/types";

/** Action en retard : statut non-"done" avec une date de fin passée (voir engine.isActionLate) —
 *  seul mécanisme de retard action → levier depuis le passage au retard piloté par les actions.
 *  Porte un impact "saving" de 1 (€M) : l'alerte de retard est désormais basée sur le montant
 *  RÉEL des impacts "saving" des actions en retard, pas sur netSavings du levier × un ratio. */
const lateAction = (id = "a1"): LeverAction => ({
  id,
  name: `Action ${id}`,
  start: "2026-01-01",
  end: "2026-01-15", // largement passé par rapport à "aujourd'hui" en test
  status: "todo",
  impacts: [{ id: `${id}-imp`, label: "Savings", type: "saving", nature: "opex_rec", amount: 1 }],
});

const onTimeAction = (id = "a1"): LeverAction => ({
  id,
  name: `Action ${id}`,
  start: "2026-01-01",
  end: "2099-01-01", // très loin dans le futur, jamais en retard
  status: "todo",
});

const baseLever: Lever = {
  id: "L001",
  code: "L001",
  programId: "p1",
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
  risk: "low",
  grossSavings: 10,
  netSavings: 8,
  opexOneOff: 1,
  opexRec: 0.5,
  capex: 2,
  fteImpact: -5,
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
    leverTypes: [],
    geographies: [],
    functions: [],
    pnlAccounts: [],
    levers: [],
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

  it("generates delay alert when a lever has at least one late action", () => {
    // Le retard du levier est désormais UNIQUEMENT dérivé du retard de ses actions
    // (voir engine.underperformers / engine.isActionLate) — plus aucun lien avec `progress`.
    const data = makeData({
      levers: [{ ...baseLever, actions: [lateAction(), onTimeAction("a2")] }],
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

  it("does NOT generate a delay alert when a lever has zero late actions", () => {
    const data = makeData({
      levers: [{ ...baseLever, actions: [onTimeAction("a1"), onTimeAction("a2")] }],
    });
    const delayAlerts = generateAlerts(data).filter((a) => a.id.startsWith("AUTO-DELAY-"));
    expect(delayAlerts).toHaveLength(0);
  });

  it("does NOT generate a delay alert when a lever has zero actions declared", () => {
    const data = makeData({
      levers: [{ ...baseLever, actions: [] }],
    });
    const delayAlerts = generateAlerts(data).filter((a) => a.id.startsWith("AUTO-DELAY-"));
    expect(delayAlerts).toHaveLength(0);
  });

  it("generates red alert when more than half of actions are late, amber otherwise", () => {
    // 2 actions sur 2 en retard → ratio 1 → red
    const dataAllLate = makeData({
      levers: [{ ...baseLever, actions: [lateAction("a1"), lateAction("a2")] }],
    });
    const redAlerts = generateAlerts(dataAllLate).filter(
      (a) => a.id.startsWith("AUTO-DELAY-") && a.type === "red"
    );
    expect(redAlerts.length).toBe(1);

    // 1 action sur 4 en retard → ratio 0.25 → amber
    const dataMostlyOnTime = makeData({
      levers: [
        {
          ...baseLever,
          actions: [lateAction("a1"), onTimeAction("a2"), onTimeAction("a3"), onTimeAction("a4")],
        },
      ],
    });
    const amberAlerts = generateAlerts(dataMostlyOnTime).filter(
      (a) => a.id.startsWith("AUTO-DELAY-") && a.type === "amber"
    );
    expect(amberAlerts.length).toBe(1);
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

  it("generates recurring OPEX overrun alert when reforecast opexRec exceeds plan (any amount)", () => {
    const plan = { grossSavings: 10, netSavings: 8, opexOneOff: 1, opexRec: 0.5, capex: 2 };
    const data = makeData({
      levers: [
        {
          ...baseLever,
          lockedPlan: plan,
          reforecast: { ...plan, opexRec: 0.51 }, // +0.01M = dès le 1er €
        },
      ],
    });
    const opexAlerts = generateAlerts(data).filter((a) => a.id.startsWith("AUTO-OPEXREC-"));
    expect(opexAlerts).toHaveLength(1);
    expect(opexAlerts[0].type).toBe("red");
    expect(opexAlerts[0].impactEur!).toBeLessThan(0);
  });

  it("does NOT generate a recurring OPEX overrun alert for a strategic program", () => {
    const plan = { grossSavings: 10, netSavings: 8, opexOneOff: 1, opexRec: 0.5, capex: 2 };
    const data = makeData({
      levers: [
        {
          ...baseLever,
          lockedPlan: plan,
          reforecast: { ...plan, opexRec: 0.51 },
        },
      ],
    });
    const opexAlerts = generateAlerts(data, "strategic").filter((a) =>
      a.id.startsWith("AUTO-OPEXREC-")
    );
    expect(opexAlerts).toHaveLength(0);
  });

  it("keeps auto alerts by default when a manual alert uses the same scope", () => {
    const data = makeData({
      levers: [{ ...baseLever, actions: [lateAction()] }], // will generate AUTO-DELAY-L001
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
    expect(l001Alerts.some((alert) => alert.id === "MANUAL-1")).toBe(true);
    expect(l001Alerts.some((alert) => alert.id.startsWith("AUTO-DELAY-"))).toBe(true);
  });

  it("suppresses auto alerts only when the manual alert explicitly requests it", () => {
    const data = makeData({
      levers: [{ ...baseLever, actions: [lateAction()] }],
      alerts: [
        {
          id: "MANUAL-1",
          type: "red",
          ts: "1h ago",
          scope: "L001",
          title: "Manual alert for L001",
          desc: "This is manual",
          actorRole: "lever",
          suppressAutomaticAlerts: true,
        },
      ],
    });
    const alerts = generateAlerts(data).filter((alert) => alert.scope === "L001");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe("MANUAL-1");
  });

  it("does not suppress an automatic alert belonging to another company", () => {
    const data = makeData({
      levers: [{ ...baseLever, actions: [lateAction()], companyId: "c2" }],
      alerts: [
        {
          id: "MANUAL-1",
          type: "red",
          ts: "1h ago",
          scope: "L001",
          title: "Tenant c1 alert",
          desc: "This is manual",
          actorRole: "lever",
          companyId: "c1",
          suppressAutomaticAlerts: true,
        },
      ],
    });
    expect(generateAlerts(data).some((alert) => alert.id === "AUTO-DELAY-L001")).toBe(true);
  });

  it("applies persisted resolved state to automatic alerts", () => {
    const data = makeData({
      levers: [{ ...baseLever, actions: [lateAction()] }],
      alertStates: {
        "global__AUTO-DELAY-L001": {
          alertId: "AUTO-DELAY-L001",
          companyId: "c1",
          resolved: true,
          resolvedByUsername: "test.cto",
        },
      },
    });
    const alert = generateAlerts(data).find((item) => item.id === "AUTO-DELAY-L001");
    expect(alert?.resolved).toBe(true);
    expect(alert?.resolvedByUsername).toBe("test.cto");
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

  // ── Réactualisé recalculé depuis les impacts (règle C3) ──────────────────────
  // applyPlanLock initialise `reforecast = lockedPlan` au passage à « Exécuté » sans recalculer
  // depuis les impacts : le snapshot stocké peut donc être périmé. Les alertes de dépassement
  // doivent lire la même source que le KPI coûts (displayedReforecastSnapshot).
  describe("cost/OPEX overrun alerts read the reforecast recomputed from impacts", () => {
    const plan = { grossSavings: 10, netSavings: 9.5, opexOneOff: 0, opexRec: 0.5, capex: 1 };
    const impacts = (capex: number, opexRec: number) => [
      { id: "i1", label: "Gain", type: "saving" as const, nature: "opex_rec" as const, amount: 10 },
      { id: "i2", label: "CAPEX", type: "cost" as const, nature: "capex" as const, amount: capex },
      {
        id: "i3",
        label: "OPEX rec",
        type: "cost" as const,
        nature: "opex_rec" as const,
        amount: opexRec,
      },
    ];

    it("raises a cost overrun when impacts CAPEX exceeds plan even if stored reforecast = plan", () => {
      const data = makeData({
        levers: [
          { ...baseLever, lockedPlan: plan, reforecast: { ...plan }, impacts: impacts(2, 0.5) },
        ],
      });
      const cost = generateAlerts(data).filter((a) => a.id === "AUTO-COST-L001");
      expect(cost).toHaveLength(1);
      expect(cost[0].i18n?.amounts).toEqual({ reforecast: 2, plan: 1, delta: 1 });
      expect(cost[0].impactEur).toBe(-1000000);
    });

    it("raises a recurring OPEX overrun when impacts opexRec exceeds plan even if stored reforecast = plan", () => {
      const data = makeData({
        levers: [
          { ...baseLever, lockedPlan: plan, reforecast: { ...plan }, impacts: impacts(1, 0.8) },
        ],
      });
      const opex = generateAlerts(data).filter((a) => a.id === "AUTO-OPEXREC-L001");
      expect(opex).toHaveLength(1);
      expect(opex[0].i18n?.amounts?.reforecast).toBeCloseTo(0.8);
    });

    it("does NOT raise a cost overrun from a stale stored reforecast when impacts match plan", () => {
      const data = makeData({
        levers: [
          {
            ...baseLever,
            lockedPlan: plan,
            reforecast: { ...plan, capex: 5, opexRec: 3 },
            impacts: impacts(1, 0.5),
          },
        ],
      });
      const ids = generateAlerts(data).map((a) => a.id);
      expect(ids).not.toContain("AUTO-COST-L001");
      expect(ids).not.toContain("AUTO-OPEXREC-L001");
    });
  });

  // ── Levier en retard : ratio pondéré par weightPct (si somme = 100) ──────────
  describe("delay alert ratio uses action weights when they sum to 100", () => {
    it("is red when a single late action weighs > 50% (1 action out of 4)", () => {
      const data = makeData({
        levers: [
          {
            ...baseLever,
            actions: [
              { ...lateAction("a1"), weightPct: 70 },
              { ...onTimeAction("a2"), weightPct: 10 },
              { ...onTimeAction("a3"), weightPct: 10 },
              { ...onTimeAction("a4"), weightPct: 10 },
            ],
          },
        ],
      });
      const delay = generateAlerts(data).find((a) => a.id === "AUTO-DELAY-L001");
      expect(delay?.type).toBe("red");
      // Lot 6 : impact = (réactualisé net − réalisé net) × part en retard = (8 − 0) × 0,7 = −5,6
      // (avant : gains récurrents bruts des impacts × part en retard = 1 × 0,7, réalisé compris).
      expect(delay?.impactEur).toBe(-5600000);
    });

    it("is amber when late actions are the majority by count but light by weight", () => {
      const data = makeData({
        levers: [
          {
            ...baseLever,
            actions: [
              { ...lateAction("a1"), weightPct: 10 },
              { ...lateAction("a2"), weightPct: 10 },
              { ...lateAction("a3"), weightPct: 10 },
              { ...onTimeAction("a4"), weightPct: 70 },
            ],
          },
        ],
      });
      const delay = generateAlerts(data).find((a) => a.id === "AUTO-DELAY-L001");
      expect(delay?.type).toBe("amber");
    });

    it("falls back to a simple count when weights do not sum to 100", () => {
      const data = makeData({
        levers: [
          {
            ...baseLever,
            actions: [
              { ...lateAction("a1"), weightPct: 70 },
              { ...onTimeAction("a2"), weightPct: 10 },
              { ...onTimeAction("a3"), weightPct: 10 },
              { ...onTimeAction("a4") },
            ],
          },
        ],
      });
      const delay = generateAlerts(data).find((a) => a.id === "AUTO-DELAY-L001");
      expect(delay?.type).toBe("amber"); // 1/4
    });
  });

  it("cancelled levers do not generate any auto alerts", () => {
    const data = makeData({
      levers: [{ ...baseLever, status: "cancelled" as LeverStatus, progress: 0 }],
    });
    const autoAlerts = generateAlerts(data).filter((a) => a.source === "auto");
    expect(autoAlerts).toHaveLength(0);
  });
});

describe("alertEngine — montant et date des alertes auto (audit lot 2, point 4)", () => {
  // « Aujourd'hui » = 2026-10-02 ; 2026-01-01 = 274 jours plus tôt.
  afterEach(() => vi.useRealTimers());
  const OLD = "2026-01-01";
  // R : réalisé à 100 % (2,2 M€ réalisés sur 2,2), dépendance FS en conflit avec T.
  const R: Lever = {
    ...baseLever,
    id: "R",
    name: "Réalisé",
    status: "delivered",
    netSavings: 2.2,
    start: "2026-03-01",
    end: "2026-09-30",
    lastUpdate: OLD,
    dependencies: [{ targetId: "T", type: "FS" }],
    impacts: [
      { id: "r1", label: "g", type: "saving", nature: "opex_rec", amount: 2.2, status: "done" },
    ],
  };
  // S : 30 k€ non réalisés ; conflit FS créé il y a 3 jours par le décalage de T (S inchangé depuis
  // 274 jours).
  const S: Lever = {
    ...baseLever,
    id: "S",
    name: "Petit",
    netSavings: 0.03,
    start: "2026-03-01",
    lastUpdate: OLD,
    dependencies: [{ targetId: "T", type: "FS" }],
    impacts: [],
  };
  const T: Lever = {
    ...baseLever,
    id: "T",
    name: "Bloqueur",
    start: "2026-01-01",
    end: "2026-12-31",
    lastUpdate: "2026-09-29",
    impacts: [],
  };
  // U : vraiment à risque — action échue le 2026-09-10, 2 M€ de gains.
  const U: Lever = {
    ...baseLever,
    id: "U",
    name: "En retard",
    lastUpdate: OLD,
    actions: [{ ...lateAction("u1"), end: "2026-09-10", impacts: [] }],
    impacts: [
      {
        id: "u2",
        label: "g",
        type: "saving",
        nature: "opex_rec",
        amount: 2,
        gainDate: "2027-01-01",
      },
    ],
  };
  // V : vraiment à risque — dépassement CAPEX de 0,6 M€.
  const plan = { grossSavings: 0, netSavings: 0, opexOneOff: 0, opexRec: 0, capex: 1 };
  const V: Lever = {
    ...baseLever,
    id: "V",
    name: "Dépassement",
    lastUpdate: "2026-09-20",
    lockedPlan: plan,
    reforecast: plan,
    impacts: [{ id: "v1", label: "c", type: "cost", nature: "capex", amount: 1.6 }],
  };
  const levers = [R, S, T, U, V];

  it("montant à risque = non réalisé, date = événement déclencheur, ids stables", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    const alerts = generateAlerts(makeData({ levers }));
    const byId = (id: string) => alerts.find((a) => a.id === id);
    // Avant : −2,2 M€ (net stocké entier, levier pourtant réalisé à 100 %), alerte orange.
    expect(byId("AUTO-DEP-R-T")?.impactEur).toBe(0);
    expect(byId("AUTO-DEP-R-T")?.type).toBe("blue");
    expect(byId("AUTO-DEP-S-T")?.impactEur).toBe(-30_000);
    expect(byId("AUTO-DEP-S-T")?.type).toBe("amber");
    // Avant : lastUpdate de S (2026-01-01, 274 j). Après : dernière modification des deux leviers.
    expect(byId("AUTO-DEP-S-T")?.ts).toBe("2026-09-29");
    // Retard : lendemain de l'échéance de l'action (avant : lastUpdate du levier, 2026-01-01).
    expect(byId("AUTO-DELAY-U")?.ts).toBe("2026-09-11");
    expect(byId("AUTO-COST-V")?.ts).toBe("2026-09-20");
  });

  it("« Leviers à risque » : 2 (U, V) et non 4 — R et S ne sont plus Critique", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    const alerts = generateAlerts(makeData({ levers }));
    expect(computeLeverRisk("R", alerts).level).toBe("low");
    expect(computeLeverRisk("S", alerts).level).toBe("low");
    expect(computeLeverRisk("U", alerts).level).toBe("critical");
    expect(computeLeverRisk("V", alerts).level).toBe("critical");
    expect(leverHealthCounts(levers, alerts).atRisk).toBe(2);
  });
});
