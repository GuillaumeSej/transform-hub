import { describe, it, expect } from "vitest";
import {
  assertMilestoneStillPassable,
  chantierDeclaredProgress,
  compareMeasurements,
  computeIndicatorDelta,
  computeIndicatorStatus,
  currentMilestoneFillPct,
  dedupeMeasurementsByPeriod,
  effectiveProjetWeights,
  isProjetLate,
  latestMeasurement,
  latestNumericMeasurement,
  milestoneProgressPct,
  milestoneTransitionState,
  programRoadmap,
  projetProgressResolver,
  resolveIndicatorTargetForPeriod,
  resolveIndicatorTargetStepForPeriod,
} from "@/lib/axisLogic";
import { addDays, daysBetween, toISODate, todayISO } from "@/lib/dateUtils";
import {
  comparePeriods,
  normalizePeriod,
  parsePeriodForFrequency,
  periodStartsOnOrBefore,
  samePeriod,
} from "@/lib/indicatorPeriod";
import {
  buildHistoryRows,
  defaultYearForMeasurements,
  findPeriodCollision,
  MeasurementPeriodCollisionError,
} from "@/lib/kpiHistory";
import { submitKpiValueFlow } from "@/lib/strategicApprovalFlows";
import { applyApprovedPayload, type StrategicApproval } from "@/lib/strategicApprovals";
import { rollupBudgets } from "@/lib/budgetRollup";
import { staffingRatePoint, staffingRateSeries } from "@/lib/staffingRate";
import type {
  Chantier,
  ChantierAction,
  ChantierMilestoneState,
  ChantierStaffing,
  Indicator,
  IndicatorMeasurement,
  StrategicAxis,
} from "@/types";

// ─── Fabriques ─────────────────────────────────────────────────────────────────────────────────

const indicator = (o: Partial<Indicator> = {}): Indicator => ({
  id: "IND1",
  companyId: "c",
  programId: "P1",
  axisId: "AX1",
  name: "KPI",
  kind: "quantitative",
  frequency: "monthly",
  objective: "80",
  objectiveValue: 80,
  direction: "up",
  responsibleRoles: [],
  status: "on_track",
  createdAt: "",
  lastUpdate: "",
  ...o,
});

const measure = (
  period: string,
  value: number | undefined,
  reportedAt: string,
  o: Partial<IndicatorMeasurement> = {}
): IndicatorMeasurement => ({
  id: `M-${period}-${reportedAt}`,
  companyId: "c",
  indicatorId: "IND1",
  period,
  ...(value !== undefined ? { value } : {}),
  reportedBy: "u",
  reportedAt,
  ...o,
});

const chantier = (o: Partial<Chantier> = {}): Chantier =>
  ({
    id: "CH1",
    companyId: "c",
    programId: "P1",
    axisIds: ["AX1"],
    name: "Chantier",
    stage: "s",
    dependencies: [],
    ...o,
  }) as Chantier;

const projet = (o: Partial<ChantierAction> = {}): ChantierAction => ({
  id: "CA1",
  companyId: "c",
  chantierId: "CH1",
  name: "Projet",
  start: "2026-01-01",
  end: "2026-06-30",
  status: "defined",
  ...o,
});

const full = (ids: string[]) => ids.map((itemId) => ({ itemId, progressPct: 100 }));

// ─── B1 : une seule valeur par période, la plus récente gagne partout ──────────────────────────

describe("B1 — period collisions & tie-breaking", () => {
  const first = measure("2026-03", 10, "2026-03-05T10:00:00Z", { id: "old" });
  const second = measure("2026-03", 20, "2026-03-20T10:00:00Z", { id: "new" });

  it("latestMeasurement breaks ties by reportedAt (latest wins), whatever the input order", () => {
    expect(latestMeasurement("IND1", [first, second])?.id).toBe("new");
    expect(latestMeasurement("IND1", [second, first])?.id).toBe("new");
    expect(compareMeasurements(first, second)).toBeLessThan(0);
  });

  it("the chart dedupe keeps the SAME measurement as latestMeasurement", () => {
    const deduped = dedupeMeasurementsByPeriod([second, first]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe("new");
    // Status follows the same measurement.
    expect(computeIndicatorStatus(indicator({ objectiveValue: 15 }), [second, first])).toBe(
      "on_track"
    );
  });

  it("a note-only entry does not hide the last numeric value (status / progress)", () => {
    const numeric = measure("2026-03", 90, "2026-03-05T00:00:00Z");
    const note = measure("2026-04", undefined, "2026-04-05T00:00:00Z", { note: "RAS" });
    expect(latestMeasurement("IND1", [numeric, note])?.period).toBe("2026-04");
    expect(latestNumericMeasurement("IND1", [numeric, note])?.value).toBe(90);
    expect(computeIndicatorStatus(indicator(), [numeric, note])).toBe("on_track");
  });

  it("findPeriodCollision matches equivalent spellings of the same period", () => {
    const m = [measure("2026-03", 1, "x")];
    expect(findPeriodCollision(m, "IND1", "2026-3")?.id).toBe(m[0].id);
    expect(findPeriodCollision(m, "IND1", "03/2026")?.id).toBe(m[0].id);
    expect(findPeriodCollision(m, "IND1", "2026-04")).toBeUndefined();
    expect(findPeriodCollision(m, "IND1", "2026-03", m[0].id)).toBeUndefined();
  });

  it("submitKpiValueFlow rejects a new value on a taken period BEFORE any write/request", async () => {
    let writes = 0;
    const add = async () => {
      writes += 1;
      return null;
    };
    await expect(
      submitKpiValueFlow(
        null,
        { id: "IND1", name: "KPI" },
        { indicatorId: "IND1", period: "2026-03", reportedBy: "u", value: 3 },
        add,
        [first]
      )
    ).rejects.toBeInstanceOf(MeasurementPeriodCollisionError);
    expect(writes).toBe(0);
  });

  it("approving a NEW value on a period taken in the meantime replaces the existing document", () => {
    const approval = {
      id: "SA1",
      companyId: "c",
      programId: "P1",
      kind: "kpi_value",
      targetType: "indicateur",
      targetId: "IND1",
      targetName: "KPI",
      payload: { period: "2026-3", value: 42 },
      status: "approved",
      requestedBy: "bob",
      requestedAt: "2026-03-10T00:00:00Z",
      decidedAt: "2026-03-25T00:00:00Z",
      approverRole: "strategic_lead",
      approverUsernames: [],
    } as unknown as StrategicApproval;
    const effects = applyApprovedPayload(approval, {
      axes: [],
      chantiers: [],
      chantierActions: [],
      indicators: [indicator()],
      measurements: [first],
    });
    expect(effects.saveMeasurements).toHaveLength(1);
    expect(effects.saveMeasurements[0]).toMatchObject({
      id: "old",
      period: "2026-03",
      value: 42,
      reportedBy: "u",
      updatedBy: "bob",
    });
  });

  it("history rows are sorted with the same tie-break (latest entry first)", () => {
    const rows = buildHistoryRows([first, second], 15, "up");
    expect(rows.map((r) => r.measurement.id)).toEqual(["new", "old"]);
  });
});

// ─── M8 : périodes normalisées, comparaisons robustes aux formats mélangés ─────────────────────

describe("M8 — period helpers", () => {
  it("normalizes tolerated spellings to the canonical format", () => {
    expect(normalizePeriod("2026-3")).toBe("2026-03");
    expect(normalizePeriod(" 03/2026 ")).toBe("2026-03");
    expect(normalizePeriod("T1 2026")).toBe("2026-Q1");
    expect(normalizePeriod("2026q2")).toBe("2026-Q2");
    expect(normalizePeriod("H2-2026")).toBe("2026-S2");
    expect(normalizePeriod("2026")).toBe("2026");
    expect(normalizePeriod("2026-13")).toBeUndefined();
    expect(normalizePeriod("2026-Q5")).toBeUndefined();
    expect(normalizePeriod("mars")).toBeUndefined();
  });

  it("validates strictly per frequency", () => {
    expect(parsePeriodForFrequency("2026-3", "monthly")).toBe("2026-03");
    expect(parsePeriodForFrequency("2026-Q1", "monthly")).toBeUndefined();
    expect(parsePeriodForFrequency("2026-Q1", "quarterly")).toBe("2026-Q1");
    expect(parsePeriodForFrequency("2026", "annual")).toBe("2026");
    expect(parsePeriodForFrequency("2026-S1", "semiannual")).toBe("2026-S1");
  });

  it("orders mixed formats chronologically (not lexicographically)", () => {
    // Lexicographically "2026-Q1" > "2026-05" — chronologically Q1 starts in January.
    expect(comparePeriods("2026-Q1", "2026-05")).toBeLessThan(0);
    expect(comparePeriods("2026-Q2", "2026-03")).toBeGreaterThan(0);
    expect(comparePeriods("2025", "2026-01")).toBeLessThan(0);
    expect(comparePeriods("2026-01", "2026-Q1")).toBeLessThan(0);
    expect(samePeriod("2026-3", "2026-03")).toBe(true);
    expect(periodStartsOnOrBefore("2026-Q2", "2026-05")).toBe(true);
    expect(periodStartsOnOrBefore("2026-Q2", "2026-03")).toBe(false);
  });

  it("resolves quarterly paliers on a MONTHLY KPI", () => {
    const kpi = indicator({
      objectiveValue: 90,
      targetSchedule: [
        { period: "2026-Q2", value: 60 },
        { period: "2026-Q1", value: 50 },
      ],
    });
    expect(resolveIndicatorTargetForPeriod(kpi, "2026-02")).toBe(50);
    expect(resolveIndicatorTargetForPeriod(kpi, "2026-05")).toBe(60);
    expect(resolveIndicatorTargetForPeriod(kpi, "2026-06")).toBe(60);
    // After the last palier: the final target takes over.
    expect(resolveIndicatorTargetForPeriod(kpi, "2026-07")).toBe(90);
    // Before the first palier: final target.
    expect(resolveIndicatorTargetForPeriod(kpi, "2025-12")).toBe(90);
  });

  it("keeps the last palier after the trajectory when there is NO final target", () => {
    const kpi = indicator({
      objectiveValue: undefined,
      targetSchedule: [{ period: "2026-Q1", value: 50 }],
    });
    expect(resolveIndicatorTargetForPeriod(kpi, "2026-09")).toBe(50);
    expect(resolveIndicatorTargetStepForPeriod(kpi, "2026-09")).toEqual({
      value: 50,
      period: "2026-Q1",
    });
    expect(computeIndicatorStatus(kpi, [measure("2026-09", 40, "x")])).toBe("at_risk");
  });

  it("M7 — history rows compare each row to ITS palier target", () => {
    const kpi = indicator({
      objectiveValue: 90,
      targetSchedule: [
        { period: "2026-01", value: 50 },
        { period: "2026-02", value: 70 },
      ],
    });
    const rows = buildHistoryRows(
      [measure("2026-01", 55, "a"), measure("2026-02", 65, "b")],
      kpi,
      "up"
    );
    const byPeriod = new Map(rows.map((r) => [r.measurement.period, r]));
    expect(byPeriod.get("2026-01")).toMatchObject({ target: 50, gap: 5, favorable: true });
    expect(byPeriod.get("2026-02")).toMatchObject({ target: 70, gap: -5, favorable: false });
  });

  it("default year = latest year with data", () => {
    expect(
      defaultYearForMeasurements(
        [{ period: "2024-05" }, { period: "2025-Q1" }],
        new Date(2027, 0, 1)
      )
    ).toBe(2025);
    expect(defaultYearForMeasurements([], new Date(2027, 0, 1))).toBe(2027);
  });
});

// ─── Avancement : ratio de repli et cible négative ─────────────────────────────────────────────

describe("computeIndicatorDelta — sign-aware ratio fallback", () => {
  it("negative target with direction up is not reported as exceeded", () => {
    const kpi = indicator({ objectiveValue: -5, direction: "up" });
    const d = computeIndicatorDelta(kpi, measure("2026-01", -10, "x"));
    expect(d?.favorable).toBe(false);
    expect(d?.progressToFinalPct).toBeLessThan(100);
    const reached = computeIndicatorDelta(kpi, measure("2026-01", -4, "x"));
    expect(reached?.progressToFinalPct).toBeGreaterThanOrEqual(100);
  });
});

// ─── M2 / M3 / M4 / M5 : jalons et avancement ─────────────────────────────────────────────────

describe("M5 — milestoneProgressPct uses the same item list as the gate", () => {
  const e4: ChantierMilestoneState = {
    currentMilestone: "E4",
    passedMilestones: ["E0", "E1", "E2", "E3"],
    checklists: { E4: full(["E4-B1"]) },
  };

  it("an excluded item no longer caps a completed final milestone below 100", () => {
    const withoutExclusion = projet({ milestones: e4 });
    expect(milestoneProgressPct(withoutExclusion)).toBeLessThan(100);
    const excluded = projet({ milestones: e4, excludedMilestoneItems: { E4: ["E4-B2"] } });
    expect(milestoneProgressPct(excluded)).toBe(100);
    expect(milestoneTransitionState(excluded).status).toBe("final");
    // … hence no longer "late forever".
    expect(isProjetLate({ ...excluded, end: "2026-01-01" }, milestoneProgressPct(excluded))).toBe(
      false
    );
  });

  it("custom actions count in the partial credit", () => {
    const withCustom = projet({
      milestones: {
        currentMilestone: "E4",
        passedMilestones: ["E0", "E1", "E2", "E3"],
        checklists: { E4: full(["E4-B1", "E4-B2"]) },
      },
      customMilestoneActions: { E4: [{ id: "cust-1", label: "Bilan" }] },
    });
    // 2 items sur 3 à 100 → 85 + 15 × 2/3 = 95.
    expect(milestoneProgressPct(withCustom)).toBe(95);
    expect(Math.round(currentMilestoneFillPct(withCustom))).toBe(67);
  });
});

describe("M2 — prerequisites are based on milestones", () => {
  it("roadmap / resolver treats a completed final milestone as done", () => {
    const target = projet({
      id: "T",
      milestones: {
        currentMilestone: "E4",
        passedMilestones: ["E0", "E1", "E2", "E3"],
        checklists: { E4: full(["E4-B1", "E4-B2"]) },
      },
    });
    const resolver = projetProgressResolver([chantier()], [target]);
    expect(resolver(target)).toBe(100);
  });
});

describe("M3 / M4 — one progress figure everywhere", () => {
  // E1 : l'item auto "effortComplete" vaut 100 quand la grille d'effort est complète.
  const effortChantier = chantier({
    effort: { financialImpact: 1, humanImpact: 1, duration: 1, changeManagement: 1 },
  } as Partial<Chantier>);
  const e1 = (id: string, weight?: number): ChantierAction =>
    projet({
      id,
      ...(weight !== undefined ? { chantierWeightPct: weight } : {}),
      milestones: {
        currentMilestone: "E1",
        passedMilestones: ["E0"],
        checklists: { E1: full(["E1-B1", "E1-B2", "E1-B3", "E1-C2"]) },
      },
    });

  it("the resolver includes auto items; the degraded mode does not", () => {
    const a = e1("A");
    const resolver = projetProgressResolver([effortChantier], [a]);
    expect(resolver(a)).toBe(20); // E0 (10) + E1 complete (10)
    expect(milestoneProgressPct(a)).toBe(18); // auto item counted as 0
  });

  it("chantier progress = weighted helper over ALL projets, identical on the roadmap", () => {
    const a = e1("A", 75);
    const b = projet({ id: "B", chantierWeightPct: 25 });
    const actions = [a, b];
    const resolver = projetProgressResolver([effortChantier], actions);
    const weighted = chantierDeclaredProgress("CH1", actions, resolver);
    expect(weighted).toBe(Math.round((75 * 20 + 25 * 0) / 100));
    // The roadmap rows carry the same per-projet figure (auto items included).
    const axis = { id: "AX1", name: "Axe", programId: "P1", companyId: "c" } as StrategicAxis;
    const rows = programRoadmap([axis], [effortChantier], actions, resolver);
    expect(rows.find((r) => r.action.id === "A")?.progressPct).toBe(20);
  });

  it("declared weights above 100 no longer zero the unweighted projets", () => {
    const weights = effectiveProjetWeights([
      { id: "A", chantierWeightPct: 80 },
      { id: "B", chantierWeightPct: 40 },
      { id: "C" },
    ]);
    expect(weights.get("C")).toBe(60); // average of declared weights
    const actions = [
      projet({ id: "A", chantierWeightPct: 80 }),
      projet({ id: "B", chantierWeightPct: 40 }),
      projet({ id: "C" }),
    ];
    const progress = (x: ChantierAction) => (x.id === "C" ? 100 : 0);
    expect(chantierDeclaredProgress("CH1", actions, progress)).toBe(Math.round(6000 / 180));
  });
});

describe("milestone approval edge cases", () => {
  const e0Complete = projet({
    owner: "carl",
    milestones: {
      currentMilestone: "E0",
      passedMilestones: [],
      checklists: { E0: full(["E0-A2", "E0-B1", "E0-B2", "E0-C1"]) },
    },
    milestoneApproval: { targetMilestone: "E1", requestedBy: "carl", requestedAt: "" },
  });

  it("re-checks the gate at approval time", () => {
    expect(() =>
      assertMilestoneStillPassable(e0Complete, [chantier({ pilote: "bob" })], [e0Complete])
    ).not.toThrow();
    const regressed = {
      ...e0Complete,
      milestones: { ...e0Complete.milestones!, checklists: { E0: full(["E0-A2"]) } },
    };
    expect(() =>
      assertMilestoneStillPassable(regressed, [chantier({ pilote: "bob" })], [regressed])
    ).toThrow(/plus complet/);
  });
});

// ─── Dates locales ─────────────────────────────────────────────────────────────────────────────

describe("date helpers (local calendar dates)", () => {
  it("addDays walks calendar days, across month/year and DST boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30"); // EU DST switch
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-01-01", 30)).toBe("2026-01-31");
    expect(daysBetween("2026-01-01", addDays("2026-01-01", 45))).toBe(45);
  });

  it("todayISO / toISODate use LOCAL components (never UTC)", () => {
    const lateEvening = new Date(2026, 5, 30, 23, 30);
    expect(toISODate(lateEvening)).toBe("2026-06-30");
    expect(todayISO(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });

  it("isProjetLate uses the local day", () => {
    const p = projet({ end: "2026-06-30" });
    expect(isProjetLate(p, 50, new Date(2026, 5, 30, 23, 59))).toBe(false);
    expect(isProjetLate(p, 50, new Date(2026, 6, 1, 0, 1))).toBe(true);
  });
});

// ─── Budget & staffing ────────────────────────────────────────────────────────────────────────

describe("budget attribution independent of the viewer's visible axes", () => {
  it("attributes a multi-axis chantier to its primary axis even when that axis is hidden", () => {
    const ch = chantier({ axisIds: ["AX1", "AX2"] });
    const actions = [projet({ budget: 100 })];
    // Viewer sees only AX2.
    const naive = rollupBudgets([{ id: "AX2" }], [ch], actions);
    expect(naive.axes.get("AX2")?.allocated).toBe(100); // old behaviour: re-attributed
    const fixed = rollupBudgets([{ id: "AX2" }], [ch], actions, [{ id: "AX1" }, { id: "AX2" }]);
    expect(fixed.axes.get("AX2")?.allocated).toBe(0);
    expect(fixed.chantierAxisId.get("CH1")).toBe("AX1");
    expect(fixed.programme.allocated).toBe(100);
  });
});

describe("staffing rate", () => {
  const line = (o: Partial<ChantierStaffing>): ChantierStaffing =>
    ({
      id: "S1",
      companyId: "c",
      programId: "P1",
      chantierId: "CH1",
      function: "IT",
      fte: 1,
      createdAt: "",
      ...o,
    }) as ChantierStaffing;

  it("the alert level is decided on the UNROUNDED rate", () => {
    const point = staffingRatePoint(
      [line({ fte: 10.04, startDate: "2026-01-01", endDate: "2026-12-31" })],
      10,
      { start: "2026-03-01", end: "2026-03-31", label: "03" } as never,
      { tense: 80, over: 100 }
    );
    expect(point.ratePct).toBe(100);
    expect(point.level).toBe("over");
  });

  it("the series window always includes the current period", () => {
    const series = staffingRateSeries(
      [line({ startDate: "2030-01-01", endDate: "2035-12-31" })],
      10,
      "monthly",
      "2026-09-24",
      12
    );
    expect(series.some((p) => p.start <= "2026-09-24" && "2026-09-24" <= p.end)).toBe(true);
  });
});
