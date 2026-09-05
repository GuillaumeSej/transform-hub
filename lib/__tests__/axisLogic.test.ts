import { describe, it, expect } from "vitest";
import {
  canFillIndicator,
  canManageChantier,
  canPassMilestone,
  canStartAction,
  chantierAtRiskIndicators,
  chantierBounds,
  chantierDependencyAlerts,
  computeIndicatorDelta,
  computeIndicatorStatus,
  countOnTrackAtRisk,
  latestMeasurement,
  milestoneProgressPct,
  resolveIndicatorStatus,
  resolveMilestoneAutoFlags,
  resolveProgramType,
  sumLatestQuantitativeValues,
} from "@/lib/axisLogic";
import type {
  AuthUser,
  Chantier,
  ChantierAction,
  Indicator,
  IndicatorMeasurement,
  MaturityStageConfig,
  MilestoneChecklistItem,
} from "@/types";

const baseIndicator: Indicator = {
  id: "IND001",
  companyId: "c1",
  programId: "p1",
  axisId: "AX001",
  name: "Taux de satisfaction client",
  kind: "quantitative",
  frequency: "quarterly",
  objective: "Atteindre 80%",
  objectiveValue: 80,
  direction: "up",
  unit: "%",
  responsibleRoles: ["cto"],
  status: "on_track",
  createdAt: "2026-01-01",
  lastUpdate: "2026-01-01",
};

function makeIndicator(overrides?: Partial<Indicator>): Indicator {
  return { ...baseIndicator, ...overrides };
}

function makeMeasurement(
  indicatorId: string,
  period: string,
  value?: number
): IndicatorMeasurement {
  return {
    id: `M-${indicatorId}-${period}`,
    companyId: "c1",
    indicatorId,
    period,
    value,
    reportedBy: "jean.dupont",
    reportedAt: `${period}-15`,
  };
}

const baseUser: AuthUser = {
  username: "jean.dupont",
  password: "test",
  role: "cto",
  firstName: "Jean",
  lastName: "Dupont",
  name: "Jean Dupont",
  companyId: "c1",
};

describe("resolveProgramType", () => {
  it("treats a program without an explicit type as a performance plan", () => {
    expect(resolveProgramType({ type: undefined })).toBe("performance");
    expect(resolveProgramType(null)).toBe("performance");
  });

  it("returns the explicit type when set", () => {
    expect(resolveProgramType({ type: "strategic" })).toBe("strategic");
  });
});

describe("latestMeasurement", () => {
  it("returns the most recent period for the requested indicator only", () => {
    const measurements = [
      makeMeasurement("IND001", "2026-01", 10),
      makeMeasurement("IND001", "2026-03", 30),
      makeMeasurement("IND001", "2026-02", 20),
      makeMeasurement("IND002", "2026-12", 999),
    ];
    expect(latestMeasurement("IND001", measurements)?.value).toBe(30);
  });

  it("returns undefined when the indicator has never been measured", () => {
    expect(latestMeasurement("IND001", [])).toBeUndefined();
  });
});

describe("computeIndicatorStatus", () => {
  it("flags an 'up' indicator below its objective as at risk", () => {
    const indicator = makeIndicator({ direction: "up", objectiveValue: 80 });
    const status = computeIndicatorStatus(indicator, [makeMeasurement("IND001", "2026-03", 72)]);
    expect(status).toBe("at_risk");
  });

  it("keeps an 'up' indicator at or above its objective on track", () => {
    const indicator = makeIndicator({ direction: "up", objectiveValue: 80 });
    expect(computeIndicatorStatus(indicator, [makeMeasurement("IND001", "2026-03", 80)])).toBe(
      "on_track"
    );
    expect(computeIndicatorStatus(indicator, [makeMeasurement("IND001", "2026-03", 95)])).toBe(
      "on_track"
    );
  });

  it("inverts the comparison for a 'down' indicator (lower is better)", () => {
    const indicator = makeIndicator({ direction: "down", objectiveValue: 5 });
    expect(computeIndicatorStatus(indicator, [makeMeasurement("IND001", "2026-03", 3)])).toBe(
      "on_track"
    );
    expect(computeIndicatorStatus(indicator, [makeMeasurement("IND001", "2026-03", 8)])).toBe(
      "at_risk"
    );
  });

  it("only considers the LATEST measurement, not the earlier ones", () => {
    const indicator = makeIndicator({ direction: "up", objectiveValue: 80 });
    const measurements = [
      makeMeasurement("IND001", "2026-01", 95),
      makeMeasurement("IND001", "2026-06", 40),
    ];
    expect(computeIndicatorStatus(indicator, measurements)).toBe("at_risk");
  });

  it("returns on_track for a qualitative indicator, whatever the measured value", () => {
    const indicator = makeIndicator({ kind: "qualitative", objectiveValue: 80 });
    expect(computeIndicatorStatus(indicator, [makeMeasurement("IND001", "2026-03", 1)])).toBe(
      "on_track"
    );
  });

  it("returns on_track when there is no measurement at all", () => {
    expect(computeIndicatorStatus(makeIndicator(), [])).toBe("on_track");
  });

  it("returns on_track when the latest measurement carries no numeric value", () => {
    const measurements = [makeMeasurement("IND001", "2026-03", undefined)];
    expect(computeIndicatorStatus(makeIndicator(), measurements)).toBe("on_track");
  });

  it("returns on_track when the indicator has no objectiveValue to compare against", () => {
    const indicator = makeIndicator({ objectiveValue: undefined });
    expect(computeIndicatorStatus(indicator, [makeMeasurement("IND001", "2026-03", 0)])).toBe(
      "on_track"
    );
  });
});

describe("resolveIndicatorStatus", () => {
  it("returns the computed status when no manual override is set", () => {
    expect(resolveIndicatorStatus(makeIndicator({ status: "at_risk" }))).toBe("at_risk");
  });

  it("lets the manual override win over the computed status, in both directions", () => {
    expect(
      resolveIndicatorStatus(makeIndicator({ status: "on_track", statusOverride: "at_risk" }))
    ).toBe("at_risk");
    expect(
      resolveIndicatorStatus(makeIndicator({ status: "at_risk", statusOverride: "on_track" }))
    ).toBe("on_track");
  });
});

describe("sumLatestQuantitativeValues", () => {
  it("sums the latest value of quantitative indicators, ignoring qualitative and unmeasured ones", () => {
    const indicators = [
      makeIndicator({ id: "IND001" }),
      makeIndicator({ id: "IND002" }),
      makeIndicator({ id: "IND003", kind: "qualitative" }),
      makeIndicator({ id: "IND004" }),
    ];
    const measurements = [
      makeMeasurement("IND001", "2026-01", 10),
      makeMeasurement("IND001", "2026-02", 12),
      makeMeasurement("IND002", "2026-02", 30),
      makeMeasurement("IND003", "2026-02", 999),
      // IND004 : jamais mesuré, ne doit pas compter pour 0 ni faire échouer la somme.
    ];
    expect(sumLatestQuantitativeValues(indicators, measurements)).toBe(42);
  });

  it("returns 0 on an empty list", () => {
    expect(sumLatestQuantitativeValues([], [])).toBe(0);
  });
});

describe("countOnTrackAtRisk", () => {
  it("counts on the EFFECTIVE status (manual override included)", () => {
    const indicators = [
      makeIndicator({ id: "IND001", status: "on_track" }),
      makeIndicator({ id: "IND002", status: "at_risk" }),
      makeIndicator({ id: "IND003", status: "at_risk", statusOverride: "on_track" }),
    ];
    expect(countOnTrackAtRisk(indicators)).toEqual({ total: 3, onTrack: 2, atRisk: 1 });
  });
});

describe("canFillIndicator", () => {
  it("allows a user whose role is listed in responsibleRoles", () => {
    const indicator = makeIndicator({ responsibleRoles: ["cto", "hr"] });
    expect(canFillIndicator(indicator, { ...baseUser, role: "hr" })).toBe(true);
  });

  it("allows a user listed individually even when their role is not authorized", () => {
    const indicator = makeIndicator({
      responsibleRoles: ["cto"],
      additionalAuthorizedUserIds: ["marie.martin"],
    });
    expect(
      canFillIndicator(indicator, { ...baseUser, role: "ops", username: "marie.martin" })
    ).toBe(true);
  });

  it("blocks a user who is neither in an authorized role nor individually listed", () => {
    const indicator = makeIndicator({
      responsibleRoles: ["cto"],
      additionalAuthorizedUserIds: ["marie.martin"],
    });
    expect(canFillIndicator(indicator, { ...baseUser, role: "ops", username: "paul.durand" })).toBe(
      false
    );
  });

  it("always allows admin and admin_entreprise", () => {
    const indicator = makeIndicator({ responsibleRoles: ["cto"], additionalAuthorizedUserIds: [] });
    expect(canFillIndicator(indicator, { ...baseUser, role: "admin", username: "root" })).toBe(
      true
    );
    expect(
      canFillIndicator(indicator, { ...baseUser, role: "admin_entreprise", username: "root" })
    ).toBe(true);
  });

  it("blocks an anonymous user", () => {
    expect(canFillIndicator(makeIndicator(), null)).toBe(false);
  });
});

// ─── Cascade de retard inter-chantiers ─────────────────────────────────────────────────────────

function makeChantier(id: string, overrides?: Partial<Chantier>): Chantier {
  return {
    id,
    companyId: "c1",
    programId: "p1",
    axisId: "AX001",
    name: `Chantier ${id}`,
    stage: "defined",
    dependencies: [],
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
    ...overrides,
  };
}

function makeAction(
  chantierId: string,
  start: string,
  end: string,
  id = `A-${chantierId}-${start}`
): ChantierAction {
  return { id, companyId: "c1", chantierId, name: id, start, end, status: "defined" };
}

describe("chantierBounds", () => {
  it("spans from the earliest action start to the latest action end", () => {
    const actions = [
      makeAction("CH2", "2026-05-01", "2026-05-31", "other"),
      makeAction("CH1", "2026-03-01", "2026-03-31", "a1"),
      makeAction("CH1", "2026-02-01", "2026-04-30", "a2"),
    ];
    expect(chantierBounds("CH1", actions)).toEqual({ start: "2026-02-01", end: "2026-04-30" });
  });

  it("returns undefined for a chantier without any action", () => {
    expect(chantierBounds("CH1", [])).toBeUndefined();
  });
});

describe("chantierDependencyAlerts", () => {
  it("raises a simple FS cascade alert when the blocker finishes after the blocked starts", () => {
    // CH2 (bloqué) démarre le 01/03 mais CH1 (bloqueur) ne finit que le 31/03 → 30 jours de retard.
    const chantiers = [
      makeChantier("CH1", { name: "Refonte SI" }),
      makeChantier("CH2", {
        name: "Déploiement terrain",
        dependencies: [{ targetId: "CH1", type: "FS" }],
      }),
    ];
    const actions = [
      makeAction("CH1", "2026-01-01", "2026-03-31"),
      makeAction("CH2", "2026-03-01", "2026-06-30"),
    ];

    const alerts = chantierDependencyAlerts(chantiers, actions);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      sourceId: "CH2",
      sourceName: "Déploiement terrain",
      targetId: "CH1",
      targetName: "Refonte SI",
      type: "FS",
      delayDays: 30,
    });
    // Pendant strictement non financier de engine.dependencyAlerts : aucun montant.
    expect(alerts[0]).not.toHaveProperty("impactEur");
  });

  it("raises no alert when the FS constraint is satisfied", () => {
    const chantiers = [
      makeChantier("CH1"),
      makeChantier("CH2", { dependencies: [{ targetId: "CH1", type: "FS" }] }),
    ];
    const actions = [
      makeAction("CH1", "2026-01-01", "2026-02-28"),
      makeAction("CH2", "2026-03-01", "2026-06-30"),
    ];
    expect(chantierDependencyAlerts(chantiers, actions)).toEqual([]);
  });

  it("tolerates a small SS/FF gap but flags a large one", () => {
    const withinTolerance = [
      makeChantier("CH1"),
      makeChantier("CH2", { dependencies: [{ targetId: "CH1", type: "SS" }] }),
    ];
    const closeActions = [
      makeAction("CH1", "2026-01-01", "2026-06-30"),
      makeAction("CH2", "2026-01-05", "2026-06-30"),
    ];
    expect(chantierDependencyAlerts(withinTolerance, closeActions)).toEqual([]);

    const farActions = [
      makeAction("CH1", "2026-01-01", "2026-06-30"),
      makeAction("CH2", "2026-02-01", "2026-06-30"),
    ];
    const alerts = chantierDependencyAlerts(withinTolerance, farActions);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: "SS", delayDays: 31 });
  });

  it("supports inter-axis dependencies (targetId in another axis of the same program)", () => {
    const chantiers = [
      makeChantier("CH1", { axisId: "AX001" }),
      makeChantier("CH2", {
        axisId: "AX002",
        dependencies: [{ targetId: "CH1", type: "FS" }],
      }),
    ];
    const actions = [
      makeAction("CH1", "2026-01-01", "2026-03-31"),
      makeAction("CH2", "2026-03-01", "2026-06-30"),
    ];
    expect(chantierDependencyAlerts(chantiers, actions)).toHaveLength(1);
  });

  it("ignores dependencies pointing at an unknown or date-less chantier", () => {
    const chantiers = [
      makeChantier("CH1"),
      makeChantier("CH2", { dependencies: [{ targetId: "GHOST", type: "FS" }] }),
    ];
    const actions = [makeAction("CH2", "2026-03-01", "2026-06-30")];
    expect(chantierDependencyAlerts(chantiers, actions)).toEqual([]);
    // Sans aucune action, aucune borne exploitable → aucune alerte plutôt que des dates inventées.
    expect(chantierDependencyAlerts(chantiers)).toEqual([]);
  });
});

// ─── Habilitation à piloter un chantier ────────────────────────────────────────────────────────

describe("canManageChantier", () => {
  it("allows a user whose role is listed in responsibleRoles", () => {
    const chantier = makeChantier("CH1", {
      responsibleRoles: ["chantier_owner", "axis_sponsor"],
    });
    expect(canManageChantier(chantier, { ...baseUser, role: "chantier_owner" })).toBe(true);
    expect(canManageChantier(chantier, { ...baseUser, role: "axis_sponsor" })).toBe(true);
  });

  it("blocks a user whose role is not listed", () => {
    const chantier = makeChantier("CH1", { responsibleRoles: ["chantier_owner"] });
    expect(canManageChantier(chantier, { ...baseUser, role: "chantier_contributor" })).toBe(false);
    expect(canManageChantier(chantier, { ...baseUser, role: "ops" })).toBe(false);
  });

  it("does not restrict anyone while no responsible role has been configured", () => {
    // Défaut PERMISSIF assumé (à l'inverse de canFillIndicator) : champ absent ou liste vide =
    // aucune restriction, pour ne pas bloquer les chantiers créés avant ce champ.
    expect(canManageChantier(makeChantier("CH1"), { ...baseUser, role: "ops" })).toBe(true);
    expect(
      canManageChantier(makeChantier("CH1", { responsibleRoles: [] }), {
        ...baseUser,
        role: "ops",
      })
    ).toBe(true);
  });

  it("always allows admin and admin_entreprise, even outside responsibleRoles", () => {
    const chantier = makeChantier("CH1", { responsibleRoles: ["chantier_owner"] });
    expect(canManageChantier(chantier, { ...baseUser, role: "admin" })).toBe(true);
    expect(canManageChantier(chantier, { ...baseUser, role: "admin_entreprise" })).toBe(true);
  });

  it("blocks an anonymous user, even on an unrestricted chantier", () => {
    expect(canManageChantier(makeChantier("CH1"), null)).toBe(false);
    expect(canManageChantier(makeChantier("CH1"), undefined)).toBe(false);
  });
});

// ─── Écart d'un indicateur par rapport à sa cible (round 4, point 1) ───────────────────────────

describe("computeIndicatorDelta", () => {
  it("computes a favorable signed delta for an 'up' indicator above its objective", () => {
    const indicator = makeIndicator({ direction: "up", objectiveValue: 80 });
    const delta = computeIndicatorDelta(indicator, makeMeasurement("IND001", "2026-03", 82));
    expect(delta).toBeDefined();
    expect(delta?.delta).toBe(2);
    expect(delta?.deltaPct).toBeCloseTo(2.5);
    expect(delta?.favorable).toBe(true);
    expect(delta?.progressPct).toBeCloseTo(100); // 82/80 clampé à 100
  });

  it("computes an unfavorable delta for an 'up' indicator below its objective, progress under 100", () => {
    const indicator = makeIndicator({ direction: "up", objectiveValue: 80 });
    const delta = computeIndicatorDelta(indicator, makeMeasurement("IND001", "2026-03", 40));
    expect(delta?.delta).toBe(-40);
    expect(delta?.favorable).toBe(false);
    expect(delta?.progressPct).toBeCloseTo(50); // 40/80
  });

  it("inverts the progress framing for a 'down' indicator (lower is better)", () => {
    // Objectif 5, valeur 10 : deux fois pire que la cible → progrès = 5/10 = 50%, non favorable.
    const indicator = makeIndicator({ direction: "down", objectiveValue: 5 });
    const delta = computeIndicatorDelta(indicator, makeMeasurement("IND001", "2026-03", 10));
    expect(delta?.delta).toBe(5);
    expect(delta?.favorable).toBe(false);
    expect(delta?.progressPct).toBeCloseTo(50);

    // Valeur déjà sous la cible : favorable, progrès clampé à 100 (pas 200%).
    const better = computeIndicatorDelta(indicator, makeMeasurement("IND001", "2026-03", 2));
    expect(better?.favorable).toBe(true);
    expect(better?.progressPct).toBe(100);
  });

  it("returns undefined when there is no measurement (same guard as computeIndicatorStatus)", () => {
    const indicator = makeIndicator({ objectiveValue: 80 });
    expect(computeIndicatorDelta(indicator, undefined)).toBeUndefined();
    expect(computeIndicatorDelta(indicator, makeMeasurement("IND001", "2026-03", undefined))).toBe(
      undefined
    );
  });

  it("returns undefined when the indicator has no objectiveValue", () => {
    const indicator = makeIndicator({ objectiveValue: undefined });
    expect(
      computeIndicatorDelta(indicator, makeMeasurement("IND001", "2026-03", 50))
    ).toBeUndefined();
  });

  it("avoids a division by zero when the objective is 0 (up direction)", () => {
    const indicator = makeIndicator({ direction: "up", objectiveValue: 0 });
    const delta = computeIndicatorDelta(indicator, makeMeasurement("IND001", "2026-03", 5));
    expect(delta?.deltaPct).toBe(0);
    expect(delta?.progressPct).toBe(100);
  });
});

// ─── Indicateurs à risque d'un chantier, avec leur écart (round 4, point 2) ────────────────────

describe("chantierAtRiskIndicators", () => {
  it("returns only the at-risk indicators of the given chantier, each with its delta", () => {
    const indicators = [
      makeIndicator({ id: "IND001", chantierId: "CH1", status: "at_risk", objectiveValue: 80 }),
      makeIndicator({ id: "IND002", chantierId: "CH1", status: "on_track", objectiveValue: 80 }),
      // Autre chantier : ne doit pas apparaître même s'il est à risque.
      makeIndicator({ id: "IND003", chantierId: "CH2", status: "at_risk", objectiveValue: 80 }),
    ];
    const measurements = [makeMeasurement("IND001", "2026-03", 40)];

    const result = chantierAtRiskIndicators("CH1", indicators, measurements);

    expect(result).toHaveLength(1);
    expect(result[0].indicator.id).toBe("IND001");
    expect(result[0].delta?.delta).toBe(-40);
  });

  it("returns an empty list when the chantier has no at-risk indicator", () => {
    const indicators = [
      makeIndicator({ id: "IND001", chantierId: "CH1", status: "on_track" }),
      makeIndicator({
        id: "IND002",
        chantierId: "CH1",
        status: "at_risk",
        statusOverride: "on_track",
      }),
    ];
    expect(chantierAtRiskIndicators("CH1", indicators, [])).toEqual([]);
  });

  it("honors the manual status override, like resolveIndicatorStatus", () => {
    const indicators = [
      makeIndicator({
        id: "IND001",
        chantierId: "CH1",
        status: "on_track",
        statusOverride: "at_risk",
      }),
    ];
    const result = chantierAtRiskIndicators("CH1", indicators, []);
    expect(result).toHaveLength(1);
    // Pas de mesure : le delta reste undefined, mais l'indicateur est bien remonté.
    expect(result[0].delta).toBeUndefined();
  });
});

// ─── Prérequis d'action, go/no-go (round 4, point 5) ───────────────────────────────────────────

function makeStages(): MaturityStageConfig[] {
  return [
    { id: "planned", programId: "p1", companyId: "c1", order: 1, label: "Planifié" },
    { id: "in_progress", programId: "p1", companyId: "c1", order: 2, label: "En cours" },
    { id: "done", programId: "p1", companyId: "c1", order: 3, label: "Réalisé", isTerminal: true },
  ];
}

describe("canStartAction", () => {
  it("is not blocked when there are no prerequisites", () => {
    expect(canStartAction({ prerequisites: [] }, [], makeStages())).toEqual({
      blocked: false,
      reasons: [],
    });
    expect(canStartAction({}, [], makeStages())).toEqual({ blocked: false, reasons: [] });
  });

  it("is satisfied by an action-kind prerequisite once the target action reaches a terminal stage", () => {
    const target = makeAction("CH1", "2026-01-01", "2026-01-31", "target-action");
    const stages = makeStages();

    const blocked = canStartAction(
      { prerequisites: [{ id: "pr1", kind: "action", targetActionId: "target-action" }] },
      [{ ...target, status: "in_progress" }],
      stages
    );
    expect(blocked).toEqual({ blocked: true, reasons: [expect.stringContaining("target-action")] });

    const unblocked = canStartAction(
      { prerequisites: [{ id: "pr1", kind: "action", targetActionId: "target-action" }] },
      [{ ...target, status: "done" }],
      stages
    );
    expect(unblocked).toEqual({ blocked: false, reasons: [] });
  });

  it("never throws and reports an explicit reason when the target action was deleted", () => {
    const result = canStartAction(
      { prerequisites: [{ id: "pr1", kind: "action", targetActionId: "GHOST-DELETED" }] },
      [], // le référentiel d'actions ne contient plus la cible
      makeStages()
    );
    expect(result.blocked).toBe(true);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).not.toBe("");
  });

  it("treats an external prerequisite as unsatisfied when done is false, satisfied when true", () => {
    const stages = makeStages();
    const notDone = canStartAction(
      {
        prerequisites: [
          { id: "pr1", kind: "external", label: "Recrutement du chef de projet", done: false },
        ],
      },
      [],
      stages
    );
    expect(notDone).toEqual({ blocked: true, reasons: ["Recrutement du chef de projet"] });

    const done = canStartAction(
      {
        prerequisites: [
          { id: "pr1", kind: "external", label: "Recrutement du chef de projet", done: true },
        ],
      },
      [],
      stages
    );
    expect(done).toEqual({ blocked: false, reasons: [] });
  });
});

// ─── Jalons E0→E4 (round 5) ─────────────────────────────────────────────────────────────────────

describe("resolveMilestoneAutoFlags", () => {
  it("flags 'previousOranges' green when the previous milestone has no unresolved orange", () => {
    // Aucun item orange du tout sur E0 → vacuously vert pour l'item auto de E1.
    const chantier = makeChantier("CH1", {
      milestones: {
        currentMilestone: "E1",
        passedMilestones: ["E0"],
        checklists: { E0: [{ itemId: "E0-B1", flag: "green" }] },
      },
    });
    const flags = resolveMilestoneAutoFlags("E1", chantier, [chantier], []);
    expect(flags["E1-A1"]).toBe("green");
  });

  it("flags 'previousOranges' red when the previous milestone has an unresolved orange", () => {
    const chantier = makeChantier("CH1", {
      milestones: {
        currentMilestone: "E1",
        passedMilestones: ["E0"],
        checklists: {
          E0: [{ itemId: "E0-B1", flag: "orange", resolved: false }],
        },
      },
    });
    expect(resolveMilestoneAutoFlags("E1", chantier, [chantier], [])["E1-A1"]).toBe("red");
  });

  it("flags 'previousOranges' green once the orange item is marked resolved", () => {
    const chantier = makeChantier("CH1", {
      milestones: {
        currentMilestone: "E1",
        passedMilestones: ["E0"],
        checklists: {
          E0: [{ itemId: "E0-B1", flag: "orange", resolved: true }],
        },
      },
    });
    expect(resolveMilestoneAutoFlags("E1", chantier, [chantier], [])["E1-A1"]).toBe("green");
  });

  it("flags 'dependencyAlert' green when this chantier is not the blocked side of any alert", () => {
    const chantier = makeChantier("CH1");
    expect(resolveMilestoneAutoFlags("E0", chantier, [chantier], [])["E0-A1"]).toBe("green");
  });

  it("flags 'dependencyAlert' red when this chantier is the blocked side of a violated dependency", () => {
    const chantiers = [
      makeChantier("CH1", { name: "Refonte SI" }),
      makeChantier("CH2", {
        name: "Déploiement terrain",
        dependencies: [{ targetId: "CH1", type: "FS" }],
      }),
    ];
    const actions = [
      makeAction("CH1", "2026-01-01", "2026-03-31"),
      makeAction("CH2", "2026-03-01", "2026-06-30"),
    ];
    // CH2 est le côté bloqué (sourceId) : son item auto E0-A1 doit être rouge.
    const ch2 = chantiers[1];
    expect(resolveMilestoneAutoFlags("E0", ch2, chantiers, actions)["E0-A1"]).toBe("red");
    // CH1 n'est pas bloqué (c'est lui le bloqueur) : son propre item auto reste vert.
    const ch1 = chantiers[0];
    expect(resolveMilestoneAutoFlags("E0", ch1, chantiers, actions)["E0-A1"]).toBe("green");
  });

  it("flags 'effortComplete' green only when all 4 effort dimensions are set", () => {
    const complete = makeChantier("CH1", {
      effort: { financialImpact: 1, humanImpact: 2, duration: 3, changeManagement: 4 },
    });
    expect(resolveMilestoneAutoFlags("E1", complete, [complete], [])["E1-C-effort"]).toBe("green");

    const partial = makeChantier("CH1", {
      effort: { financialImpact: 1, humanImpact: 2 },
    });
    expect(resolveMilestoneAutoFlags("E1", partial, [partial], [])["E1-C-effort"]).toBe("red");

    const none = makeChantier("CH1");
    expect(resolveMilestoneAutoFlags("E1", none, [none], [])["E1-C-effort"]).toBe("red");
  });
});

describe("canPassMilestone", () => {
  it("allows passing when every item is green", () => {
    const items: MilestoneChecklistItem[] = [
      { itemId: "E0-A1", flag: "green" },
      { itemId: "E0-A2", flag: "green" },
    ];
    expect(canPassMilestone("E0", items)).toEqual({ canPass: true, reasons: [] });
  });

  it("allows passing with a non-blocking orange item", () => {
    const items: MilestoneChecklistItem[] = [
      { itemId: "E0-A1", flag: "green" },
      { itemId: "E0-A2", flag: "orange", actionPlan: { description: "Plan" } },
    ];
    expect(canPassMilestone("E0", items).canPass).toBe(true);
  });

  it("blocks when any item is red, with a reason", () => {
    const items: MilestoneChecklistItem[] = [
      { itemId: "E0-A1", flag: "green" },
      { itemId: "E0-A2", flag: "red" },
    ];
    const result = canPassMilestone("E0", items);
    expect(result.canPass).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("E0-A2");
  });

  it("blocks when a manual item has not been answered at all", () => {
    const items: MilestoneChecklistItem[] = [{ itemId: "E0-A1" }];
    const result = canPassMilestone("E0", items);
    expect(result.canPass).toBe(false);
    expect(result.reasons).toHaveLength(1);
  });
});

describe("milestoneProgressPct", () => {
  it("returns 0 when no milestone has been passed (or milestones is absent)", () => {
    expect(milestoneProgressPct({ milestones: undefined })).toBe(0);
    expect(
      milestoneProgressPct({
        milestones: { currentMilestone: "E0", passedMilestones: [], checklists: {} },
      })
    ).toBe(0);
  });

  it("returns 20 per passed milestone", () => {
    expect(
      milestoneProgressPct({
        milestones: { currentMilestone: "E1", passedMilestones: ["E0"], checklists: {} },
      })
    ).toBe(20);
  });

  it("returns 100 once all 5 milestones are passed", () => {
    expect(
      milestoneProgressPct({
        milestones: {
          currentMilestone: "E4",
          passedMilestones: ["E0", "E1", "E2", "E3", "E4"],
          checklists: {},
        },
      })
    ).toBe(100);
  });
});
