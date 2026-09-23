import { describe, it, expect } from "vitest";
import {
  axesSponsoredBy,
  axisDecisionMakers,
  axisSponsorLabel,
  resolveUserFullName,
  approveMilestoneGate,
  axisProgressPct,
  projetMilestoneCounts,
  canFillIndicator,
  canManageChantier,
  canPassMilestone,
  canStartAction,
  chantierAtRiskIndicators,
  chantierBounds,
  chantierDeclaredProgress,
  chantierDependencyAlerts,
  chantierHealthState,
  chantierMilestoneProgressPct,
  colorForChantier,
  computeIndicatorDelta,
  computeIndicatorStatus,
  countOnTrackAtRisk,
  isChantierLate,
  isProjetLate,
  isStrategicLeadOf,
  latestMeasurement,
  mergeMilestoneChecklistItems,
  milestoneProgressPct,
  numberIndicators,
  programBlockedActions,
  programBudgetOverrun,
  programRoadmap,
  programRoadmapBounds,
  progressBucket,
  rejectMilestoneApproval,
  requestMilestoneApproval,
  resolveChantierOwner,
  resolveIndicatorOwner,
  resolveIndicatorStatus,
  resolveIndicatorTargetForPeriod,
  resolveMilestoneAutoFlags,
  resolveProgramType,
  resolveStrategicOwnershipScope,
  resolveStrategicRoleForProgram,
  staffingPeriodBuckets,
  sumLatestQuantitativeValues,
  sumConsumedBudget,
  sumProgramProjetBudgets,
  sumProjetBudgets,
} from "@/lib/axisLogic";
import type {
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierStaffing,
  Deliverable,
  Indicator,
  IndicatorMeasurement,
  MaturityStageConfig,
  MilestoneChecklistItem,
  StrategicAxis,
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
  profiles: [{ role: "cto" }],
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
    expect(canFillIndicator(indicator, { ...baseUser, profiles: [{ role: "hr" }] })).toBe(true);
  });

  it("allows a user listed individually even when their role is not authorized", () => {
    const indicator = makeIndicator({
      responsibleRoles: ["cto"],
      additionalAuthorizedUserIds: ["marie.martin"],
    });
    expect(
      canFillIndicator(indicator, {
        ...baseUser,
        profiles: [{ role: "ops" }],
        username: "marie.martin",
      })
    ).toBe(true);
  });

  it("blocks a user who is neither in an authorized role nor individually listed", () => {
    const indicator = makeIndicator({
      responsibleRoles: ["cto"],
      additionalAuthorizedUserIds: ["marie.martin"],
    });
    expect(
      canFillIndicator(indicator, {
        ...baseUser,
        profiles: [{ role: "ops" }],
        username: "paul.durand",
      })
    ).toBe(false);
  });

  it("always allows admin and admin_entreprise", () => {
    const indicator = makeIndicator({ responsibleRoles: ["cto"], additionalAuthorizedUserIds: [] });
    expect(
      canFillIndicator(indicator, {
        ...baseUser,
        profiles: [],
        isGlobalAdmin: true,
        username: "root",
      })
    ).toBe(true);
    expect(
      canFillIndicator(indicator, {
        ...baseUser,
        profiles: [],
        isCompanyAdmin: true,
        username: "root",
      })
    ).toBe(true);
  });

  it("blocks an anonymous user", () => {
    expect(canFillIndicator(makeIndicator(), null)).toBe(false);
  });

  it("allows a program-agnostic strategic_lead to fill an indicator in any program", () => {
    const indicator = makeIndicator({ responsibleRoles: ["cto"], programId: "p1" });
    expect(
      canFillIndicator(indicator, {
        ...baseUser,
        profiles: [{ role: "strategic_lead" }],
        username: "someone.else",
      })
    ).toBe(true);
    const otherProgramIndicator = makeIndicator({ responsibleRoles: ["cto"], programId: "p2" });
    expect(
      canFillIndicator(otherProgramIndicator, {
        ...baseUser,
        profiles: [{ role: "strategic_lead" }],
        username: "someone.else",
      })
    ).toBe(true);
  });

  it("scopes a strategic_lead with a programId to that program only", () => {
    const sameProgramIndicator = makeIndicator({ responsibleRoles: ["cto"], programId: "p1" });
    expect(
      canFillIndicator(sameProgramIndicator, {
        ...baseUser,
        profiles: [{ role: "strategic_lead", programId: "p1" }],
        username: "someone.else",
      })
    ).toBe(true);

    const otherProgramIndicator = makeIndicator({ responsibleRoles: ["cto"], programId: "p2" });
    expect(
      canFillIndicator(otherProgramIndicator, {
        ...baseUser,
        profiles: [{ role: "strategic_lead", programId: "p1" }],
        username: "someone.else",
      })
    ).toBe(false);
  });

  it("does not grant blanket access to a non-strategic_lead strategic role", () => {
    const indicator = makeIndicator({ responsibleRoles: ["cto"], programId: "p1" });
    expect(
      canFillIndicator(indicator, {
        ...baseUser,
        profiles: [{ role: "axis_sponsor" }],
        username: "someone.else",
      })
    ).toBe(false);
  });
});

// ─── Cascade de retard inter-chantiers ─────────────────────────────────────────────────────────

function makeChantier(id: string, overrides?: Partial<Chantier>): Chantier {
  return {
    id,
    companyId: "c1",
    programId: "p1",
    axisIds: ["AX001"],
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
      makeChantier("CH1", { axisIds: ["AX001"] }),
      makeChantier("CH2", {
        axisIds: ["AX002"],
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
    expect(
      canManageChantier(chantier, { ...baseUser, profiles: [{ role: "chantier_owner" }] })
    ).toBe(true);
    expect(canManageChantier(chantier, { ...baseUser, profiles: [{ role: "axis_sponsor" }] })).toBe(
      true
    );
  });

  it("blocks a user whose role is not listed", () => {
    const chantier = makeChantier("CH1", { responsibleRoles: ["chantier_owner"] });
    expect(
      canManageChantier(chantier, { ...baseUser, profiles: [{ role: "chantier_contributor" }] })
    ).toBe(false);
    expect(canManageChantier(chantier, { ...baseUser, profiles: [{ role: "ops" }] })).toBe(false);
  });

  it("does not restrict anyone while no responsible role has been configured", () => {
    // Défaut PERMISSIF assumé (à l'inverse de canFillIndicator) : champ absent ou liste vide =
    // aucune restriction, pour ne pas bloquer les chantiers créés avant ce champ.
    expect(
      canManageChantier(makeChantier("CH1"), { ...baseUser, profiles: [{ role: "ops" }] })
    ).toBe(true);
    expect(
      canManageChantier(makeChantier("CH1", { responsibleRoles: [] }), {
        ...baseUser,
        profiles: [{ role: "ops" }],
      })
    ).toBe(true);
  });

  it("always allows admin and admin_entreprise, even outside responsibleRoles", () => {
    const chantier = makeChantier("CH1", { responsibleRoles: ["chantier_owner"] });
    expect(canManageChantier(chantier, { ...baseUser, profiles: [], isGlobalAdmin: true })).toBe(
      true
    );
    expect(canManageChantier(chantier, { ...baseUser, profiles: [], isCompanyAdmin: true })).toBe(
      true
    );
  });

  it("blocks an anonymous user, even on an unrestricted chantier", () => {
    expect(canManageChantier(makeChantier("CH1"), null)).toBe(false);
    expect(canManageChantier(makeChantier("CH1"), undefined)).toBe(false);
  });
});

// ─── Périmètre de visibilité par propriétaire nommé (round 25) ────────────────────────────────

describe("resolveStrategicRoleForProgram", () => {
  it("returns undefined for a user with no strategic profile at all", () => {
    expect(resolveStrategicRoleForProgram({ profiles: [{ role: "lever" }] }, "p1")).toBeUndefined();
    expect(resolveStrategicRoleForProgram(null, "p1")).toBeUndefined();
    expect(resolveStrategicRoleForProgram(undefined, "p1")).toBeUndefined();
  });

  it("prefers the strategic profile scoped to the active program over one scoped to another program", () => {
    const user = {
      profiles: [
        { role: "axis_sponsor" as const, programId: "p2" },
        { role: "chantier_owner" as const, programId: "p1" },
      ],
    };
    expect(resolveStrategicRoleForProgram(user, "p1")).toBe("chantier_owner");
    expect(resolveStrategicRoleForProgram(user, "p2")).toBe("axis_sponsor");
  });

  it("falls back to a global (programId-less) strategic profile when none matches the active program", () => {
    const user = { profiles: [{ role: "internal_comm" as const }] };
    expect(resolveStrategicRoleForProgram(user, "p1")).toBe("internal_comm");
    expect(resolveStrategicRoleForProgram(user, "any-other-program")).toBe("internal_comm");
  });
});

describe("resolveStrategicOwnershipScope", () => {
  it("returns unrestricted for a global or company admin, regardless of role", () => {
    expect(
      resolveStrategicOwnershipScope(
        { username: "admin1", profiles: [{ role: "axis_sponsor" }], isGlobalAdmin: true },
        "p1",
        [],
        [],
        []
      )
    ).toEqual({ mode: "unrestricted" });
    expect(
      resolveStrategicOwnershipScope(
        { username: "admin2", profiles: [{ role: "chantier_contributor" }], isCompanyAdmin: true },
        "p1",
        [],
        [],
        []
      )
    ).toEqual({ mode: "unrestricted" });
  });

  it("returns unrestricted for the strategic roles without named ownership", () => {
    for (const role of [
      "strategic_lead",
      "internal_comm",
      "budget_control",
      "comex_member",
    ] as const) {
      expect(
        resolveStrategicOwnershipScope({ username: "u1", profiles: [{ role }] }, "p1", [], [], [])
      ).toEqual({ mode: "unrestricted" });
    }
  });

  it("returns unrestricted for a user without any strategic profile (defensive default)", () => {
    expect(
      resolveStrategicOwnershipScope({ username: "u1", profiles: [] }, "p1", [], [], [])
    ).toEqual({ mode: "unrestricted" });
  });

  it("returns an empty scoped scope (nothing visible) for a null/undefined user", () => {
    const empty = {
      mode: "scoped",
      axisIds: new Set(),
      chantierIds: new Set(),
      clickableActionIds: new Set(),
    };
    expect(resolveStrategicOwnershipScope(null, "p1", [], [], [])).toEqual(empty);
    expect(resolveStrategicOwnershipScope(undefined, "p1", [], [], [])).toEqual(empty);
  });

  describe("axis_sponsor", () => {
    it("scopes to a single owned axis, plus its chantiers — a non-owned axis's chantier is excluded", () => {
      const axes = [
        makeAxis("AX1", { owner: "sponsor1" }),
        makeAxis("AX2", { owner: "someone.else" }),
      ];
      const chantiers = [
        makeChantier("CH1", { axisIds: ["AX1"] }),
        makeChantier("CH2", { axisIds: ["AX2"] }),
      ];

      const scope = resolveStrategicOwnershipScope(
        { username: "sponsor1", profiles: [{ role: "axis_sponsor" }] },
        "p1",
        axes,
        chantiers,
        []
      );

      expect(scope.mode).toBe("scoped");
      if (scope.mode !== "scoped") throw new Error("unreachable");
      expect(scope.axisIds).toEqual(new Set(["AX1"]));
      expect(scope.chantierIds).toEqual(new Set(["CH1"]));
      // Aucune restriction supplémentaire au niveau projet pour ce rôle.
      expect(scope.clickableActionIds).toBeUndefined();
    });

    it("scopes to SEVERAL owned axes at once, and their respective chantiers", () => {
      const axes = [
        makeAxis("AX1", { owner: "sponsor1" }),
        makeAxis("AX2", { owner: "someone.else" }),
        makeAxis("AX3", { owner: "sponsor1" }),
      ];
      const chantiers = [
        makeChantier("CH1", { axisIds: ["AX1"] }),
        makeChantier("CH2", { axisIds: ["AX2"] }),
        makeChantier("CH3", { axisIds: ["AX3"] }),
      ];

      const scope = resolveStrategicOwnershipScope(
        { username: "sponsor1", profiles: [{ role: "axis_sponsor" }] },
        "p1",
        axes,
        chantiers,
        []
      );

      if (scope.mode !== "scoped") throw new Error("unreachable");
      expect(scope.axisIds).toEqual(new Set(["AX1", "AX3"]));
      expect(scope.chantierIds).toEqual(new Set(["CH1", "CH3"]));
    });

    it("includes a multi-axis chantier as soon as ONE of its axes is owned", () => {
      const axes = [
        makeAxis("AX1", { owner: "sponsor1" }),
        makeAxis("AX2", { owner: "someone.else" }),
      ];
      const chantiers = [makeChantier("CH1", { axisIds: ["AX2", "AX1"] })];

      const scope = resolveStrategicOwnershipScope(
        { username: "sponsor1", profiles: [{ role: "axis_sponsor" }] },
        "p1",
        axes,
        chantiers,
        []
      );

      if (scope.mode !== "scoped") throw new Error("unreachable");
      expect(scope.chantierIds).toEqual(new Set(["CH1"]));
    });
  });

  describe("chantier_owner", () => {
    it("scopes to the chantier(s) piloted by the user, excluding OTHER chantiers of the same axis", () => {
      const axes = [makeAxis("AX1")];
      const chantiers = [
        makeChantier("CH1", { axisIds: ["AX1"], pilote: "owner1" }),
        makeChantier("CH2", { axisIds: ["AX1"], pilote: "someone.else" }),
      ];

      const scope = resolveStrategicOwnershipScope(
        { username: "owner1", profiles: [{ role: "chantier_owner" }] },
        "p1",
        axes,
        chantiers,
        []
      );

      if (scope.mode !== "scoped") throw new Error("unreachable");
      // CH2 (même axe, autre pilote) n'apparaît JAMAIS dans chantierIds.
      expect(scope.chantierIds).toEqual(new Set(["CH1"]));
      // L'axe parent reste dans axisIds — contexte d'orientation seulement, ne donne accès à
      // AUCUN autre chantier de cet axe (voir juste au-dessus).
      expect(scope.axisIds).toEqual(new Set(["AX1"]));
      expect(scope.clickableActionIds).toBeUndefined();
    });

    it("sees no chantier at all when piloting none", () => {
      const axes = [makeAxis("AX1")];
      const chantiers = [makeChantier("CH1", { axisIds: ["AX1"], pilote: "someone.else" })];

      const scope = resolveStrategicOwnershipScope(
        { username: "owner1", profiles: [{ role: "chantier_owner" }] },
        "p1",
        axes,
        chantiers,
        []
      );

      if (scope.mode !== "scoped") throw new Error("unreachable");
      expect(scope.chantierIds.size).toBe(0);
      expect(scope.axisIds.size).toBe(0);
    });
  });

  describe("chantier_contributor", () => {
    it("makes a chantier visible as soon as the contributor owns at least one of its projets — its OTHER projets stay visible but not clickable", () => {
      const axes = [makeAxis("AX1")];
      const chantiers = [makeChantier("CH1", { axisIds: ["AX1"] })];
      const actions: ChantierAction[] = [
        { ...makeAction("CH1", "2027-01-01", "2027-02-01", "A-MINE"), owner: "contrib1" },
        { ...makeAction("CH1", "2027-01-01", "2027-02-01", "A-OTHER"), owner: "someone.else" },
      ];

      const scope = resolveStrategicOwnershipScope(
        { username: "contrib1", profiles: [{ role: "chantier_contributor" }] },
        "p1",
        axes,
        chantiers,
        actions
      );

      if (scope.mode !== "scoped") throw new Error("unreachable");
      // Le chantier est VISIBLE (un seul projet possédé suffit)...
      expect(scope.chantierIds).toEqual(new Set(["CH1"]));
      expect(scope.axisIds).toEqual(new Set(["AX1"]));
      // ...mais SEUL le projet possédé est cliquable — "A-OTHER" reste dans le chantier visible
      // (voir `chantierIds` ci-dessus, l'appelant UI continue de le RENDRE) sans figurer ici : à
      // l'appelant de le rendre inerte au clic plutôt que de l'omettre (voir
      // `ProgramRoadmap.tsx`/`AxisChantierProjetAccordion.tsx`/`ProjetMilestoneBoard.tsx`).
      expect(scope.clickableActionIds).toEqual(new Set(["A-MINE"]));
    });

    it("does not make a chantier visible at all when the contributor owns none of its projets", () => {
      const axes = [makeAxis("AX1")];
      const chantiers = [makeChantier("CH1", { axisIds: ["AX1"] })];
      const actions: ChantierAction[] = [
        { ...makeAction("CH1", "2027-01-01", "2027-02-01", "A1"), owner: "someone.else" },
      ];

      const scope = resolveStrategicOwnershipScope(
        { username: "contrib1", profiles: [{ role: "chantier_contributor" }] },
        "p1",
        axes,
        chantiers,
        actions
      );

      if (scope.mode !== "scoped") throw new Error("unreachable");
      expect(scope.chantierIds.size).toBe(0);
      expect(scope.clickableActionIds?.size).toBe(0);
    });

    it("scopes chantiers by OWNED PROJETS, not by Chantier.pilote (a contributor is not necessarily the pilote)", () => {
      const axes = [makeAxis("AX1")];
      // CH1 : contrib1 n'en est PAS le pilote, mais possède un de ses projets → visible quand même.
      const chantiers = [makeChantier("CH1", { axisIds: ["AX1"], pilote: "someone.else" })];
      const actions: ChantierAction[] = [
        { ...makeAction("CH1", "2027-01-01", "2027-02-01", "A-MINE"), owner: "contrib1" },
      ];

      const scope = resolveStrategicOwnershipScope(
        { username: "contrib1", profiles: [{ role: "chantier_contributor" }] },
        "p1",
        axes,
        chantiers,
        actions
      );

      if (scope.mode !== "scoped") throw new Error("unreachable");
      expect(scope.chantierIds).toEqual(new Set(["CH1"]));
      expect(scope.clickableActionIds).toEqual(new Set(["A-MINE"]));
    });
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

  it("compares against the schedule step applicable to the measurement's period, not the final target", () => {
    const indicator = makeIndicator({
      direction: "up",
      objectiveValue: 75, // cible finale
      targetSchedule: [
        { period: "2026-Q1", value: 60 },
        { period: "2026-Q2", value: 70 },
      ],
    });
    // Mesure Q2 à 72 : au-dessus du palier Q2 (70), pas de la cible finale (75) → favorable.
    const q2 = computeIndicatorDelta(indicator, makeMeasurement("IND001", "2026-Q2", 72));
    expect(q2?.favorable).toBe(true);
    expect(q2?.delta).toBe(2); // 72 - 70, pas 72 - 75

    // Mesure Q3 (au-delà du dernier palier déclaré) : replie sur la cible finale (75).
    const q3 = computeIndicatorDelta(indicator, makeMeasurement("IND001", "2026-Q3", 72));
    expect(q3?.delta).toBe(-3); // 72 - 75
  });
});

describe("resolveIndicatorTargetForPeriod", () => {
  it("always returns objectiveValue for a fixed-target indicator (no schedule)", () => {
    const indicator = { objectiveValue: 80, targetSchedule: undefined };
    expect(resolveIndicatorTargetForPeriod(indicator, "2026-Q1")).toBe(80);
    expect(resolveIndicatorTargetForPeriod(indicator, "2030-Q4")).toBe(80);
  });

  it("returns the applicable schedule step for a progressive target, falling back to the final target beyond the last step", () => {
    const indicator = {
      objectiveValue: 75,
      targetSchedule: [
        { period: "2026-Q2", value: 70 },
        { period: "2026-Q1", value: 60 }, // volontairement désordonné : la fonction trie elle-même
      ],
    };
    expect(resolveIndicatorTargetForPeriod(indicator, "2026-Q1")).toBe(60);
    expect(resolveIndicatorTargetForPeriod(indicator, "2026-Q2")).toBe(70);
    expect(resolveIndicatorTargetForPeriod(indicator, "2026-Q3")).toBe(75); // au-delà → cible finale
  });

  it("falls back to the final target when the requested period precedes every declared step", () => {
    const indicator = {
      objectiveValue: 75,
      targetSchedule: [{ period: "2026-Q2", value: 70 }],
    };
    expect(resolveIndicatorTargetForPeriod(indicator, "2026-Q1")).toBe(75);
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

// ─── Santé globale d'un chantier (round 6, point 5) ────────────────────────────────────────────

describe("chantierHealthState", () => {
  it("is onTrack when there is no at-risk indicator and no dependency alert", () => {
    const chantier = makeChantier("CH1");
    expect(chantierHealthState(chantier, [], [], [chantier], [])).toBe("onTrack");
  });

  it("is watch when the chantier has an at-risk indicator, even without any dependency alert", () => {
    const chantier = makeChantier("CH1");
    const indicators = [makeIndicator({ id: "IND001", chantierId: "CH1", status: "at_risk" })];
    expect(chantierHealthState(chantier, indicators, [], [chantier], [])).toBe("watch");
  });

  it("is critical when the chantier is the blocked side (sourceId) of a violated alert", () => {
    // Même montage que le cas FS de `chantierDependencyAlerts` : CH2 (source) est bloqué par CH1
    // (target), qui finit en retard.
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
    expect(chantierHealthState(chantiers[1], [], [], chantiers, actions)).toBe("critical");
  });

  it("is watch (not critical) when the chantier only delays another one downstream (targetId)", () => {
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
    // CH1 est `targetId` de l'alerte (il retarde CH2 en aval) mais n'est lui-même bloqué par rien.
    expect(chantierHealthState(chantiers[0], [], [], chantiers, actions)).toBe("watch");
  });

  it("prioritizes critical over watch when both signals apply to the blocked chantier", () => {
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
    const indicators = [makeIndicator({ id: "IND001", chantierId: "CH2", status: "at_risk" })];
    expect(chantierHealthState(chantiers[1], indicators, [], chantiers, actions)).toBe("critical");
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

// Round 7 : `resolveMilestoneAutoFlags` est retargetée sur un LEVIER (`ChantierAction`) plutôt que
// sur le chantier lui-même — `dependencyAlert`/`effortComplete` restent des signaux CHANTIER
// résolus via le chantier parent (`action.chantierId`). D'où le montage systématique chantier
// parent + levier ci-dessous.
//
// Round 26 : `auto: "previousOranges"` (et ses tests dédiés) a été RETIRÉ avec le report d'orange
// d'un jalon à l'autre — `canPassMilestone` exige désormais que tous les items du jalon courant
// soient à 100, ce qui rend ce mécanisme logiquement vide (voir son commentaire de tête,
// lib/axisLogic.ts). Seuls `dependencyAlert` et `effortComplete` restent testés ici.
describe("resolveMilestoneAutoFlags", () => {
  it("resolves 'dependencyAlert' to 100 when the parent chantier is not the blocked side of any alert", () => {
    const chantier = makeChantier("CH1");
    const action = makeAction("CH1", "2026-01-01", "2026-01-31", "A1");
    expect(resolveMilestoneAutoFlags("E0", action, [chantier], [action])["E0-A1"]).toBe(100);
  });

  it("resolves 'dependencyAlert' to 0 when the parent chantier is the blocked side of a violated dependency — same value for every levier of that chantier", () => {
    const chantiers = [
      makeChantier("CH1", { name: "Refonte SI" }),
      makeChantier("CH2", {
        name: "Déploiement terrain",
        dependencies: [{ targetId: "CH1", type: "FS" }],
      }),
    ];
    const ch1Action = makeAction("CH1", "2026-01-01", "2026-03-31", "A-CH1");
    // Deux leviers sur CH2 (le chantier bloqué) : les deux doivent afficher la MÊME valeur, c'est
    // voulu (dépendances = donnée de chantier, pas de levier).
    const ch2Action1 = makeAction("CH2", "2026-03-01", "2026-06-30", "A-CH2-1");
    const ch2Action2 = makeAction("CH2", "2026-03-01", "2026-06-30", "A-CH2-2");
    const actions = [ch1Action, ch2Action1, ch2Action2];

    expect(resolveMilestoneAutoFlags("E0", ch2Action1, chantiers, actions)["E0-A1"]).toBe(0);
    expect(resolveMilestoneAutoFlags("E0", ch2Action2, chantiers, actions)["E0-A1"]).toBe(0);
    // Le levier du chantier bloqueur (pas bloqué lui-même) reste à 100.
    expect(resolveMilestoneAutoFlags("E0", ch1Action, chantiers, actions)["E0-A1"]).toBe(100);
  });

  it("resolves 'dependencyAlert' to 100 (not 0) and never throws when the parent chantier cannot be found", () => {
    const orphanAction = makeAction("GHOST-CHANTIER", "2026-01-01", "2026-01-31", "A1");
    expect(() => resolveMilestoneAutoFlags("E0", orphanAction, [], [orphanAction])).not.toThrow();
    expect(resolveMilestoneAutoFlags("E0", orphanAction, [], [orphanAction])["E0-A1"]).toBe(100);
  });

  it("resolves 'effortComplete' from the PARENT CHANTIER's own effort grid, 100 only when all 4 dimensions are set", () => {
    const completeChantier = makeChantier("CH1", {
      effort: { financialImpact: 1, humanImpact: 2, duration: 3, changeManagement: 4 },
    });
    const action1 = makeAction("CH1", "2026-01-01", "2026-01-31", "A1");
    expect(
      resolveMilestoneAutoFlags("E1", action1, [completeChantier], [action1])["E1-C-effort"]
    ).toBe(100);

    const partialChantier = makeChantier("CH1", { effort: { financialImpact: 1, humanImpact: 2 } });
    const action2 = makeAction("CH1", "2026-01-01", "2026-01-31", "A2");
    expect(
      resolveMilestoneAutoFlags("E1", action2, [partialChantier], [action2])["E1-C-effort"]
    ).toBe(0);

    const noneChantier = makeChantier("CH1");
    const action3 = makeAction("CH1", "2026-01-01", "2026-01-31", "A3");
    expect(resolveMilestoneAutoFlags("E1", action3, [noneChantier], [action3])["E1-C-effort"]).toBe(
      0
    );
  });
});

describe("progressBucket", () => {
  it("returns 'empty' when not yet declared", () => {
    expect(progressBucket(undefined)).toBe("empty");
  });

  it("returns 'red' at 0", () => {
    expect(progressBucket(0)).toBe("red");
  });

  it("returns 'green' at 100", () => {
    expect(progressBucket(100)).toBe("green");
  });

  it("returns 'amber' for any value strictly between 0 and 100", () => {
    expect(progressBucket(1)).toBe("amber");
    expect(progressBucket(50)).toBe("amber");
    expect(progressBucket(99)).toBe("amber");
  });
});

// Round 26 : règle DURCIE — `canPass` exige maintenant que CHAQUE item soit exactement à 100 (plus
// de tolérance pour une valeur partielle "orange", qui passait avant ce round). Voir le commentaire
// de tête de `canPassMilestone` (lib/axisLogic.ts).
describe("canPassMilestone", () => {
  it("allows passing when every item is at 100", () => {
    const items: MilestoneChecklistItem[] = [
      { itemId: "E0-A1", progressPct: 100 },
      { itemId: "E0-A2", progressPct: 100 },
    ];
    expect(canPassMilestone("E0", items)).toEqual({ canPass: true, reasons: [] });
  });

  it("blocks when any item has a partial value (former non-blocking 'orange'), even a very high one", () => {
    const items: MilestoneChecklistItem[] = [
      { itemId: "E0-A1", progressPct: 100 },
      { itemId: "E0-A2", progressPct: 99, actionPlan: { description: "Plan" } },
    ];
    const result = canPassMilestone("E0", items);
    expect(result.canPass).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("E0-A2");

    // Même une valeur partielle infime bloque désormais, plus de seuil "assez positif pour passer".
    const barelyStarted: MilestoneChecklistItem[] = [{ itemId: "E0-A1", progressPct: 1 }];
    expect(canPassMilestone("E0", barelyStarted).canPass).toBe(false);
  });

  it("blocks when any item is at 0 (former red), with a reason", () => {
    const items: MilestoneChecklistItem[] = [
      { itemId: "E0-A1", progressPct: 100 },
      { itemId: "E0-A2", progressPct: 0 },
    ];
    const result = canPassMilestone("E0", items);
    expect(result.canPass).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("E0-A2");
  });

  it("blocks when a manual item has not been answered at all (progressPct undefined)", () => {
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

  // Round 19 : poids VARIABLE par jalon (MILESTONE_WEIGHT_DELTA : E0=10, E1=10, E2=15, E3=50,
  // E4=15), remplaçant l'ancien poids uniforme de 20/jalon — voir les commentaires de
  // `milestoneProgressPct` (lib/axisLogic.ts).
  it("credits each passed milestone with its OWN weight (not a flat 20)", () => {
    expect(
      milestoneProgressPct({
        milestones: { currentMilestone: "E1", passedMilestones: ["E0"], checklists: {} },
      })
    ).toBe(10);
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

  // Nouveau test round 19 : vérifie explicitement les nouveaux poids sur un mélange de jalons
  // franchis (E0/E1/E2) et du jalon courant (E3, aucun item répondu).
  it("sums the variable weights of passed milestones plus zero partial credit for an unanswered current milestone", () => {
    const entity = {
      milestones: {
        currentMilestone: "E3" as const,
        passedMilestones: ["E0" as const, "E1" as const, "E2" as const],
        checklists: {},
      },
    };
    // 10 (E0) + 10 (E1) + 15 (E2) + 0 (E3, rien de répondu) = 35.
    expect(milestoneProgressPct(entity)).toBe(35);
  });

  // Round 12 : remplissage fin à l'intérieur du jalon courant, au lieu du calcul par paliers de 20 ;
  // round 19 : ce crédit partiel est désormais mis à l'échelle du poids VARIABLE du jalon courant.
  it("blends full credit for passed milestones with partial credit from the current milestone's declared items", () => {
    // E1 a 5 items depuis round 26 (MILESTONE_CHECKLISTS.E1, l'ancien item auto "previousOranges"
    // E1-A1 a été retiré) : E1-B1/B2/B3 (manuels), E1-C-effort (auto), E1-C2 (manuel). Ici seuls
    // B1/B2/B3 sont déclarés (100/50/0), C-effort et C2 restent non répondus → comptent pour 0 (pas
    // d'`autoValues` fourni, mode dégradé documenté).
    const entity = {
      milestones: {
        currentMilestone: "E1" as const,
        passedMilestones: ["E0" as const],
        checklists: {
          E1: [
            { itemId: "E1-B1", progressPct: 100 },
            { itemId: "E1-B2", progressPct: 50 },
            { itemId: "E1-B3", progressPct: 0 },
          ],
        },
      },
    };
    // 10 (E0 passé) + 10 (poids E1) * ((100+50+0+0+0)/5) / 100 = 10 + 3 = 13.
    expect(milestoneProgressPct(entity)).toBe(13);
  });

  it("uses the injected autoValues (resolveMilestoneAutoFlags-shaped) for the current milestone's auto items when provided", () => {
    const entity = {
      milestones: {
        currentMilestone: "E1" as const,
        passedMilestones: ["E0" as const],
        checklists: {
          E1: [
            { itemId: "E1-B1", progressPct: 100 },
            { itemId: "E1-B2", progressPct: 50 },
            { itemId: "E1-B3", progressPct: 0 },
          ],
        },
      },
    };
    // Mêmes items manuels que le test précédent, mais le seul item auto restant de E1
    // (E1-C-effort) est maintenant fourni à 100 : (100+50+0+100+0)/5 = 50 → 10 + 10*50/100 = 15.
    expect(milestoneProgressPct(entity, { "E1-C-effort": 100 })).toBe(15);
  });

  it("lets a manually-declared progressPct on an auto item win over autoValues (residual/legacy case)", () => {
    const entity = {
      milestones: {
        currentMilestone: "E1" as const,
        passedMilestones: ["E0" as const],
        checklists: {
          E1: [{ itemId: "E1-C-effort", progressPct: 0 }],
        },
      },
    };
    // E1-C-effort est marqué `auto` mais porte déjà une valeur manuelle (0) : elle prime sur
    // autoValues["E1-C-effort"] = 100. Les 4 autres items de E1 restent à 0 (non répondus) →
    // moyenne 0.
    expect(milestoneProgressPct(entity, { "E1-C-effort": 100 })).toBe(10);
  });
});

// ─── Jalon — porte de validation (round "jalon validation gate") ──────────────────────────────

describe("mergeMilestoneChecklistItems", () => {
  it("uses the auto flag's live value for an auto item, ignoring any stale stored value", () => {
    const merged = mergeMilestoneChecklistItems("E0", [{ itemId: "E0-A1", progressPct: 50 }], {
      "E0-A1": 100,
    });
    expect(merged.find((i) => i.itemId === "E0-A1")).toEqual({ itemId: "E0-A1", progressPct: 100 });
  });

  it("falls back to an unanswered item when an auto flag has no value", () => {
    const merged = mergeMilestoneChecklistItems("E0", [], {});
    expect(merged.find((i) => i.itemId === "E0-A1")).toEqual({ itemId: "E0-A1" });
  });

  it("reads a manual item straight from the stored answers", () => {
    const merged = mergeMilestoneChecklistItems("E2", [{ itemId: "E2-B1", progressPct: 100 }], {});
    expect(merged.find((i) => i.itemId === "E2-B1")).toEqual({ itemId: "E2-B1", progressPct: 100 });
  });

  it("appends custom actions after the fixed items, reading their stored answer like a manual item", () => {
    const merged = mergeMilestoneChecklistItems(
      "E2",
      [{ itemId: "CUSTOM-1", progressPct: 40 }],
      {},
      [{ id: "CUSTOM-1", label: "Migrer la base clients" }]
    );
    // Toujours après les items fixes du jalon (E2-B1/B2/B3).
    expect(merged.map((i) => i.itemId)).toEqual(["E2-B1", "E2-B2", "E2-B3", "CUSTOM-1"]);
    expect(merged.find((i) => i.itemId === "CUSTOM-1")).toEqual({
      itemId: "CUSTOM-1",
      progressPct: 40,
    });
  });

  it("treats an unanswered custom action like an unanswered manual item (no progressPct)", () => {
    const merged = mergeMilestoneChecklistItems("E2", [], {}, [
      { id: "CUSTOM-1", label: "Migrer la base clients" },
    ]);
    expect(merged.find((i) => i.itemId === "CUSTOM-1")).toEqual({ itemId: "CUSTOM-1" });
  });

  it("defaults to no custom actions when the 4th argument is omitted (backward compatible)", () => {
    const merged = mergeMilestoneChecklistItems("E2", [], {});
    expect(merged.map((i) => i.itemId)).toEqual(["E2-B1", "E2-B2", "E2-B3"]);
  });

  // ─── Exclusion d'items fixes par projet (round "exclusion jalons création") ────────────────────

  it("drops an excluded fixed item from the merged list entirely", () => {
    const merged = mergeMilestoneChecklistItems("E2", [], {}, [], ["E2-B2"]);
    expect(merged.map((i) => i.itemId)).toEqual(["E2-B1", "E2-B3"]);
  });

  it("is a no-op when the excluded itemId does not exist on this milestone", () => {
    const merged = mergeMilestoneChecklistItems("E2", [], {}, [], ["NOT-A-REAL-ITEM"]);
    expect(merged.map((i) => i.itemId)).toEqual(["E2-B1", "E2-B2", "E2-B3"]);
  });

  it("defaults to no exclusion when the 5th argument is omitted (backward compatible)", () => {
    const merged = mergeMilestoneChecklistItems("E2", [], {}, []);
    expect(merged.map((i) => i.itemId)).toEqual(["E2-B1", "E2-B2", "E2-B3"]);
  });

  it("combines exclusion of a fixed item with custom actions appended normally", () => {
    const merged = mergeMilestoneChecklistItems(
      "E2",
      [{ itemId: "CUSTOM-1", progressPct: 40 }],
      {},
      [{ id: "CUSTOM-1", label: "Migrer la base clients" }],
      ["E2-B2"]
    );
    expect(merged.map((i) => i.itemId)).toEqual(["E2-B1", "E2-B3", "CUSTOM-1"]);
  });

  it("never lets an excluded item block canPassMilestone, since it is simply absent from the merged list", () => {
    // E2-B1/B3 répondus à 100, E2-B2 exclu (jamais répondu) — sans l'exclusion ça bloquerait
    // (`canPassMilestone` exige 100 sur CHAQUE item, voir son propre describe ci-dessus).
    const merged = mergeMilestoneChecklistItems(
      "E2",
      [
        { itemId: "E2-B1", progressPct: 100 },
        { itemId: "E2-B3", progressPct: 100 },
      ],
      {},
      [],
      ["E2-B2"]
    );
    expect(canPassMilestone("E2", merged)).toEqual({ canPass: true, reasons: [] });
  });
});

describe("isStrategicLeadOf", () => {
  it("allows a strategic_lead profile without a programId on any chantier", () => {
    const user = { profiles: [{ role: "strategic_lead" as const }] };
    expect(isStrategicLeadOf(makeChantier("CH1", { programId: "p1" }), user)).toBe(true);
    expect(isStrategicLeadOf(makeChantier("CH1", { programId: "p2" }), user)).toBe(true);
  });

  it("scopes a strategic_lead profile with a programId to that program only", () => {
    const user = { profiles: [{ role: "strategic_lead" as const, programId: "p1" }] };
    expect(isStrategicLeadOf(makeChantier("CH1", { programId: "p1" }), user)).toBe(true);
    expect(isStrategicLeadOf(makeChantier("CH1", { programId: "p2" }), user)).toBe(false);
  });

  it("returns false for a user without a strategic_lead profile", () => {
    const user = { profiles: [{ role: "chantier_owner" as const }] };
    expect(isStrategicLeadOf(makeChantier("CH1", { programId: "p1" }), user)).toBe(false);
    expect(isStrategicLeadOf(makeChantier("CH1", { programId: "p1" }), null)).toBe(false);
  });
});

describe("requestMilestoneApproval", () => {
  // E2 n'a que des items manuels (pas d'item `auto`) — évite d'avoir à poser des chantiers/actions
  // pour satisfaire `resolveMilestoneAutoFlags` dans ces tests, non pertinent ici.
  function actionReadyForE2(overrides?: Partial<ChantierAction>): ChantierAction {
    return {
      ...makeAction("CH1", "2026-01-01", "2026-06-30", "A1"),
      owner: "owner1",
      milestones: {
        currentMilestone: "E2",
        passedMilestones: ["E0", "E1"],
        checklists: {
          E2: [
            { itemId: "E2-B1", progressPct: 100 },
            { itemId: "E2-B2", progressPct: 100 },
            { itemId: "E2-B3", progressPct: 100 },
          ],
        },
      },
      ...overrides,
    };
  }

  it("returns the next milestone in order, requested by the acting user", () => {
    const action = actionReadyForE2();
    const approval = requestMilestoneApproval(
      action,
      { username: "owner1", isGlobalAdmin: false, isCompanyAdmin: false },
      [],
      [action]
    );
    expect(approval.targetMilestone).toBe("E3");
    expect(approval.requestedBy).toBe("owner1");
    expect(typeof approval.requestedAt).toBe("string");
  });

  it("allows an admin to request on behalf of a project they don't own", () => {
    const action = actionReadyForE2({ owner: "someone-else" });
    expect(() =>
      requestMilestoneApproval(
        action,
        { username: "admin1", isGlobalAdmin: true, isCompanyAdmin: false },
        [],
        [action]
      )
    ).not.toThrow();
  });

  it("throws for a user who is neither the project owner nor an admin", () => {
    const action = actionReadyForE2({ owner: "owner1" });
    expect(() =>
      requestMilestoneApproval(
        action,
        { username: "someone-else", isGlobalAdmin: false, isCompanyAdmin: false },
        [],
        [action]
      )
    ).toThrow();
  });

  it("blocks the request when a custom action of the current milestone is incomplete", () => {
    const action = actionReadyForE2({
      customMilestoneActions: { E2: [{ id: "CUSTOM-1", label: "Migrer la base clients" }] },
      // Tous les items FIXES du jalon sont à 100 (voir actionReadyForE2), mais l'action
      // personnalisée n'a encore aucune réponse dans checklists.E2 — doit bloquer comme n'importe
      // quel item fixe manuel non répondu.
    });
    expect(() =>
      requestMilestoneApproval(
        action,
        { username: "owner1", isGlobalAdmin: false, isCompanyAdmin: false },
        [],
        [action]
      )
    ).toThrow();
  });

  it("allows the request once the custom action is also at 100%", () => {
    const action = actionReadyForE2({
      customMilestoneActions: { E2: [{ id: "CUSTOM-1", label: "Migrer la base clients" }] },
      milestones: {
        currentMilestone: "E2",
        passedMilestones: ["E0", "E1"],
        checklists: {
          E2: [
            { itemId: "E2-B1", progressPct: 100 },
            { itemId: "E2-B2", progressPct: 100 },
            { itemId: "E2-B3", progressPct: 100 },
            { itemId: "CUSTOM-1", progressPct: 100 },
          ],
        },
      },
    });
    expect(() =>
      requestMilestoneApproval(
        action,
        { username: "owner1", isGlobalAdmin: false, isCompanyAdmin: false },
        [],
        [action]
      )
    ).not.toThrow();
  });

  it("never blocks on an excluded fixed item, even though it was never answered", () => {
    const action = actionReadyForE2({
      excludedMilestoneItems: { E2: ["E2-B2"] },
      milestones: {
        currentMilestone: "E2",
        passedMilestones: ["E0", "E1"],
        checklists: {
          // E2-B2 (exclu pour ce projet) n'a jamais été répondu — sans l'exclusion ça bloquerait.
          E2: [
            { itemId: "E2-B1", progressPct: 100 },
            { itemId: "E2-B3", progressPct: 100 },
          ],
        },
      },
    });
    expect(() =>
      requestMilestoneApproval(
        action,
        { username: "owner1", isGlobalAdmin: false, isCompanyAdmin: false },
        [],
        [action]
      )
    ).not.toThrow();
  });

  it("throws when canPassMilestone is not satisfied for the current milestone (prerequisite gate)", () => {
    const action = actionReadyForE2({
      milestones: {
        currentMilestone: "E2",
        passedMilestones: ["E0", "E1"],
        checklists: {
          E2: [
            { itemId: "E2-B1", progressPct: 100 },
            { itemId: "E2-B2", progressPct: 50 },
          ],
        },
      },
    });
    expect(() =>
      requestMilestoneApproval(
        action,
        { username: "owner1", isGlobalAdmin: false, isCompanyAdmin: false },
        [],
        [action]
      )
    ).toThrow();
  });

  it("throws when the project has already reached the last milestone (E4, nothing further to request)", () => {
    const action = actionReadyForE2({
      milestones: {
        currentMilestone: "E4",
        passedMilestones: ["E0", "E1", "E2", "E3"],
        checklists: {},
      },
    });
    expect(() =>
      requestMilestoneApproval(
        action,
        { username: "owner1", isGlobalAdmin: false, isCompanyAdmin: false },
        [],
        [action]
      )
    ).toThrow();
  });

  it("defaults an action without any `milestones` to E0 as the current milestone", () => {
    const action: ChantierAction = {
      ...makeAction("CH1", "2026-01-01", "2026-06-30", "A1"),
      owner: "owner1",
    };
    // E0 a un item auto ("dependencyAlert") — sans chantier/dépendance, il vaut 100 (vert) ; les
    // 4 items manuels restants ne sont pas répondus → canPassMilestone bloque, comme attendu.
    expect(() =>
      requestMilestoneApproval(
        action,
        { username: "owner1", isGlobalAdmin: false, isCompanyAdmin: false },
        [],
        [action]
      )
    ).toThrow();
  });
});

describe("approveMilestoneGate", () => {
  function actionWithApproval(overrides?: Partial<ChantierAction>): ChantierAction {
    return {
      ...makeAction("CH1", "2026-01-01", "2026-06-30", "A1"),
      owner: "owner1",
      milestones: { currentMilestone: "E2", passedMilestones: ["E0", "E1"], checklists: {} },
      milestoneApproval: {
        targetMilestone: "E3",
        requestedBy: "owner1",
        requestedAt: "2026-01-01",
      },
      ...overrides,
    };
  }

  it("throws when the project has no approval request in progress", () => {
    const action = { ...actionWithApproval(), milestoneApproval: undefined };
    const chantiers = [makeChantier("CH1", { programId: "p1" })];
    expect(() =>
      approveMilestoneGate(
        action,
        {
          username: "lead1",
          profiles: [{ role: "strategic_lead" }],
          isGlobalAdmin: false,
          isCompanyAdmin: false,
        },
        chantiers
      )
    ).toThrow();
  });

  it("advances currentMilestone to the target and pushes the old one onto passedMilestones", () => {
    const action = actionWithApproval();
    const chantiers = [makeChantier("CH1", { programId: "p1" })];
    const patch = approveMilestoneGate(
      action,
      {
        username: "lead1",
        profiles: [{ role: "strategic_lead" }],
        isGlobalAdmin: false,
        isCompanyAdmin: false,
      },
      chantiers
    );
    expect(patch.milestones).toEqual({
      currentMilestone: "E3",
      passedMilestones: ["E0", "E1", "E2"],
      checklists: {},
    });
    expect(patch.milestoneApproval).toBeUndefined();
  });

  it("does not duplicate the current milestone in passedMilestones if already present", () => {
    const action = actionWithApproval({
      milestones: { currentMilestone: "E2", passedMilestones: ["E0", "E1", "E2"], checklists: {} },
    });
    const chantiers = [makeChantier("CH1", { programId: "p1" })];
    const patch = approveMilestoneGate(
      action,
      {
        username: "lead1",
        profiles: [{ role: "strategic_lead" }],
        isGlobalAdmin: false,
        isCompanyAdmin: false,
      },
      chantiers
    );
    expect(patch.milestones?.passedMilestones).toEqual(["E0", "E1", "E2"]);
  });

  it("allows a program-scoped strategic_lead on the matching program", () => {
    const action = actionWithApproval();
    const chantiers = [makeChantier("CH1", { programId: "p1" })];
    expect(() =>
      approveMilestoneGate(
        action,
        {
          username: "lead1",
          profiles: [{ role: "strategic_lead", programId: "p1" }],
          isGlobalAdmin: false,
          isCompanyAdmin: false,
        },
        chantiers
      )
    ).not.toThrow();
  });

  it("blocks a program-scoped strategic_lead on a DIFFERENT program", () => {
    const action = actionWithApproval();
    const chantiers = [makeChantier("CH1", { programId: "p1" })];
    expect(() =>
      approveMilestoneGate(
        action,
        {
          username: "lead1",
          profiles: [{ role: "strategic_lead", programId: "p2" }],
          isGlobalAdmin: false,
          isCompanyAdmin: false,
        },
        chantiers
      )
    ).toThrow();
  });

  it("allows an admin even without a strategic_lead profile", () => {
    const action = actionWithApproval();
    const chantiers = [makeChantier("CH1", { programId: "p1" })];
    expect(() =>
      approveMilestoneGate(
        action,
        { username: "admin1", profiles: [], isGlobalAdmin: true, isCompanyAdmin: false },
        chantiers
      )
    ).not.toThrow();
  });

  it("blocks the project owner (not strategic_lead, not admin) from approving their own request", () => {
    const action = actionWithApproval({ owner: "owner1" });
    const chantiers = [makeChantier("CH1", { programId: "p1" })];
    expect(() =>
      approveMilestoneGate(
        action,
        { username: "owner1", profiles: [], isGlobalAdmin: false, isCompanyAdmin: false },
        chantiers
      )
    ).toThrow();
  });

  it("blocks approval when the parent chantier cannot be resolved (orphan reference), unless admin", () => {
    const action = actionWithApproval();
    expect(() =>
      approveMilestoneGate(
        action,
        {
          username: "lead1",
          profiles: [{ role: "strategic_lead" }],
          isGlobalAdmin: false,
          isCompanyAdmin: false,
        },
        []
      )
    ).toThrow();
  });
});

describe("rejectMilestoneApproval", () => {
  function actionWithApproval(overrides?: Partial<ChantierAction>): ChantierAction {
    return {
      ...makeAction("CH1", "2026-01-01", "2026-06-30", "A1"),
      owner: "owner1",
      milestones: { currentMilestone: "E2", passedMilestones: ["E0", "E1"], checklists: {} },
      milestoneApproval: {
        targetMilestone: "E3",
        requestedBy: "owner1",
        requestedAt: "2026-01-01",
      },
      ...overrides,
    };
  }

  it("throws when the project has no approval request in progress", () => {
    const action = { ...actionWithApproval(), milestoneApproval: undefined };
    expect(() =>
      rejectMilestoneApproval(
        action,
        { username: "owner1", profiles: [], isGlobalAdmin: false, isCompanyAdmin: false },
        [makeChantier("CH1", { programId: "p1" })]
      )
    ).toThrow();
  });

  it("clears milestoneApproval when the project's own owner rejects it (no penalty)", () => {
    const action = actionWithApproval({ owner: "owner1" });
    const patch = rejectMilestoneApproval(
      action,
      { username: "owner1", profiles: [], isGlobalAdmin: false, isCompanyAdmin: false },
      [makeChantier("CH1", { programId: "p1" })]
    );
    expect(patch).toEqual({ milestoneApproval: undefined });
  });

  it("allows the strategic_lead scoped to the program", () => {
    const action = actionWithApproval();
    expect(() =>
      rejectMilestoneApproval(
        action,
        {
          username: "lead1",
          profiles: [{ role: "strategic_lead", programId: "p1" }],
          isGlobalAdmin: false,
          isCompanyAdmin: false,
        },
        [makeChantier("CH1", { programId: "p1" })]
      )
    ).not.toThrow();
  });

  it("allows an admin", () => {
    const action = actionWithApproval();
    expect(() =>
      rejectMilestoneApproval(
        action,
        { username: "admin1", profiles: [], isGlobalAdmin: true, isCompanyAdmin: false },
        [makeChantier("CH1", { programId: "p1" })]
      )
    ).not.toThrow();
  });

  it("blocks a user who is neither the owner, strategic_lead of this program, nor admin", () => {
    const action = actionWithApproval({ owner: "owner1" });
    expect(() =>
      rejectMilestoneApproval(
        action,
        {
          username: "random-user",
          profiles: [{ role: "chantier_contributor" }],
          isGlobalAdmin: false,
          isCompanyAdmin: false,
        },
        [makeChantier("CH1", { programId: "p1" })]
      )
    ).toThrow();
  });
});

// ─── Avancement AGRÉGÉ d'un chantier — moyenne des leviers (round 7) ───────────────────────────

describe("chantierMilestoneProgressPct", () => {
  it("returns 0 when the chantier has no levier", () => {
    expect(chantierMilestoneProgressPct(makeChantier("CH1"), [])).toBe(0);
  });

  // Round 19 : poids variable par jalon (E0=10, E1=10, E2=15, E3=50, E4=15) — les commentaires
  // "// N%" ci-dessous ont été recalculés en conséquence (E2 avec E0+E1 passés = 10+10 = 20%, E1
  // avec E0 passé = 10%).
  it("averages the progress of the chantier's own KPI-linked leviers, rounding sensibly", () => {
    const actions: ChantierAction[] = [
      {
        ...makeAction("CH1", "2026-01-01", "2026-01-31", "A1"),
        indicatorId: "IND-A1",
        milestones: { currentMilestone: "E2", passedMilestones: ["E0", "E1"], checklists: {} }, // 20%
      },
      {
        ...makeAction("CH1", "2026-01-01", "2026-01-31", "A2"),
        indicatorId: "IND-A2",
        milestones: { currentMilestone: "E1", passedMilestones: ["E0"], checklists: {} }, // 10%
      },
      {
        ...makeAction("CH1", "2026-01-01", "2026-01-31", "A3"),
        indicatorId: "IND-A3",
        milestones: { currentMilestone: "E1", passedMilestones: ["E0"], checklists: {} }, // 10%
      },
    ];
    // (20 + 10 + 10) / 3 = 13.33 → arrondi à 13.
    expect(chantierMilestoneProgressPct(makeChantier("CH1"), actions)).toBe(13);
  });

  it("ignores leviers belonging to another chantier", () => {
    const actions: ChantierAction[] = [
      {
        ...makeAction("CH1", "2026-01-01", "2026-01-31", "A1"),
        indicatorId: "IND-A1",
        milestones: {
          currentMilestone: "E4",
          passedMilestones: ["E0", "E1", "E2", "E3", "E4"],
          checklists: {},
        }, // 100%
      },
      { ...makeAction("CH2", "2026-01-01", "2026-01-31", "A2"), indicatorId: "IND-A2" }, // sans jalons, autre chantier
    ];
    expect(chantierMilestoneProgressPct(makeChantier("CH1"), actions)).toBe(100);
  });

  // Round 18 : le suivi E0→E4 s'applique désormais UNIVERSELLEMENT, avec ou sans KPI rattaché —
  // l'ancienne exclusion des leviers sans `indicatorId` du dénominateur a été supprimée.
  it("includes leviers without a KPI link in the average, using their own milestone progress", () => {
    const actions: ChantierAction[] = [
      {
        ...makeAction("CH1", "2026-01-01", "2026-01-31", "A1"),
        indicatorId: "IND-A1",
        milestones: { currentMilestone: "E2", passedMilestones: ["E0", "E1"], checklists: {} }, // 20%
      },
      {
        // Sans KPI, mais avec ses propres jalons — compte désormais comme n'importe quel autre
        // levier, `indicatorId` n'étant plus qu'un lien informatif.
        ...makeAction("CH1", "2026-01-01", "2026-01-31", "A2"),
        milestones: { currentMilestone: "E1", passedMilestones: ["E0"], checklists: {} }, // 10%
      },
    ];
    // (20 + 10) / 2 = 15.
    expect(chantierMilestoneProgressPct(makeChantier("CH1"), actions)).toBe(15);
  });

  it("counts a levier without any milestones data yet as 0% rather than excluding it", () => {
    const actions: ChantierAction[] = [
      {
        ...makeAction("CH1", "2026-01-01", "2026-01-31", "A1"),
        indicatorId: "IND-A1",
        milestones: { currentMilestone: "E2", passedMilestones: ["E0", "E1"], checklists: {} }, // 20%
      },
      // Sans KPI ni `.milestones` renseigné : encore à E0/0% via le repli de `milestoneProgressPct`,
      // mais bien compté dans la moyenne (dénominateur = 2, pas 1).
      makeAction("CH1", "2026-01-01", "2026-01-31", "A2"),
    ];
    // (20 + 0) / 2 = 10.
    expect(chantierMilestoneProgressPct(makeChantier("CH1"), actions)).toBe(10);
  });
});

// ─── Avancement PONDÉRÉ d'un chantier — round "projet weighting" ──────────────────────────────
// Même algorithme que `lib/workstreamLogic.ts::workstreamDeclaredProgress` (voir
// lib/__tests__/workstreamLogic.test.ts pour le pendant Performance) : poids déclarés
// (`chantierWeightPct`) sommés, le reste jusqu'à 100 réparti également entre les projets non
// pondérés, moyenne pondérée du `milestoneProgressPct` (mode dégradé) de chaque projet, repli en
// moyenne simple si le poids total effectif vaut 0.

function actionAtMilestone(
  chantierId: string,
  id: string,
  passedMilestones: ("E0" | "E1" | "E2" | "E3" | "E4")[],
  currentMilestone: "E0" | "E1" | "E2" | "E3" | "E4",
  overrides?: Partial<ChantierAction>
): ChantierAction {
  return {
    ...makeAction(chantierId, "2026-01-01", "2026-01-31", id),
    milestones: { currentMilestone, passedMilestones, checklists: {} },
    ...overrides,
  };
}

describe("chantierDeclaredProgress", () => {
  it("returns 0 when the chantier has no projet at all", () => {
    expect(chantierDeclaredProgress("CH1", [])).toBe(0);
  });

  it("ignores projects belonging to another chantier", () => {
    const actions = [
      actionAtMilestone("CH1", "A1", ["E0", "E1", "E2", "E3", "E4"], "E4"), // 100%
      actionAtMilestone("CH2", "A2", [], "E0"), // 0%, mais un AUTRE chantier
    ];
    expect(chantierDeclaredProgress("CH1", actions)).toBe(100);
  });

  it("averages with an equal implicit weight when no project declares a weight", () => {
    const actions = [
      actionAtMilestone("CH1", "A1", ["E0", "E1", "E2", "E3", "E4"], "E4"), // 100%
      actionAtMilestone("CH1", "A2", [], "E0"), // 0%
    ];
    expect(chantierDeclaredProgress("CH1", actions)).toBe(50);
  });

  it("weights projects by chantierWeightPct when declared", () => {
    const actions = [
      actionAtMilestone("CH1", "A1", ["E0", "E1", "E2", "E3", "E4"], "E4", {
        chantierWeightPct: 80,
      }), // 100%
      actionAtMilestone("CH1", "A2", [], "E0", { chantierWeightPct: 20 }), // 0%
    ];
    // 80% * 100 + 20% * 0, poids total 100 => 80.
    expect(chantierDeclaredProgress("CH1", actions)).toBe(80);
  });

  it("splits the remaining weight equally among projects without a declared weight", () => {
    const actions = [
      actionAtMilestone("CH1", "A1", ["E0", "E1", "E2", "E3", "E4"], "E4", {
        chantierWeightPct: 60,
      }), // 100%
      // Poids implicite : (100 - 60) / 2 = 20 chacun.
      actionAtMilestone("CH1", "A2", [], "E0"), // 0%
      actionAtMilestone("CH1", "A3", [], "E0"), // 0%
    ];
    // (60*100 + 20*0 + 20*0) / (60+20+20) = 60.
    expect(chantierDeclaredProgress("CH1", actions)).toBe(60);
  });

  it("falls back to a simple average when every declared weight is 0", () => {
    const actions = [
      actionAtMilestone("CH1", "A1", ["E3"], "E4", { chantierWeightPct: 0 }), // 50%
      actionAtMilestone("CH1", "A2", ["E0"], "E1", { chantierWeightPct: 0 }), // 10%
    ];
    expect(chantierDeclaredProgress("CH1", actions)).toBe(30);
  });

  // Contrairement à `workstreamDeclaredProgress` : `milestoneProgressPct` ne connaît pas de notion
  // de "projet non déclaré" à exclure (un projet sans `.milestones` vaut simplement 0), donc AUCUN
  // projet n'est jamais exclu du calcul, seul son poids peut être implicite.
  it("counts a project without any milestones data yet as 0%, never excluded", () => {
    const actions = [
      actionAtMilestone("CH1", "A1", ["E0", "E1", "E2", "E3", "E4"], "E4", {
        chantierWeightPct: 50,
      }), // 100%
      { ...makeAction("CH1", "2026-01-01", "2026-01-31", "A2"), chantierWeightPct: 50 }, // pas de .milestones → 0%
    ];
    // (50*100 + 50*0) / 100 = 50 — comparer à workstreamDeclaredProgress, qui exclurait A2 et
    // retournerait 100 (voir "excludes levers with no declared action from both weight and average").
    expect(chantierDeclaredProgress("CH1", actions)).toBe(50);
  });
});

// ─── Retard d'un projet/chantier (round 20) ────────────────────────────────────────────────────

describe("isProjetLate", () => {
  const today = new Date("2026-06-15T00:00:00");

  it("is late when the end date has passed and progress is below 100%", () => {
    const action = makeAction("CH1", "2026-01-01", "2026-06-01"); // fin passée, pas de milestones (0%)
    expect(isProjetLate(action, 0, today)).toBe(true);
  });

  it("is NOT late when it was completed, even after its deadline", () => {
    const action: ChantierAction = {
      ...makeAction("CH1", "2026-01-01", "2026-06-01"),
      milestones: {
        currentMilestone: "E4",
        passedMilestones: ["E0", "E1", "E2", "E3", "E4"],
        checklists: {},
      },
    };
    expect(isProjetLate(action, 100, today)).toBe(false);
  });

  it("is NOT late when it is not due yet", () => {
    const action = makeAction("CH1", "2026-06-01", "2026-12-31"); // fin dans le futur
    expect(isProjetLate(action, 0, today)).toBe(false);
  });
});

describe("isChantierLate", () => {
  const today = new Date("2026-06-15T00:00:00");

  it("is late when at least one of its levers is late", () => {
    const chantier = makeChantier("CH1");
    const actionsWithProgress = [
      { action: makeAction("CH1", "2026-06-01", "2026-12-31", "on-time"), progressPct: 0 }, // pas encore échu
      { action: makeAction("CH1", "2026-01-01", "2026-06-01", "late"), progressPct: 0 }, // échu, 0%
    ];
    expect(isChantierLate(chantier, actionsWithProgress, today)).toBe(true);
  });

  it("is NOT late when none of its levers is late", () => {
    const chantier = makeChantier("CH1");
    const actionsWithProgress = [
      { action: makeAction("CH1", "2026-06-01", "2026-12-31", "on-time"), progressPct: 0 },
    ];
    expect(isChantierLate(chantier, actionsWithProgress, today)).toBe(false);
  });
});

// ─── Prérequis bloquants du programme (round 9) ────────────────────────────────────────────────

describe("programBlockedActions", () => {
  it("returns an empty result for an empty actions array", () => {
    expect(programBlockedActions([], makeStages())).toEqual([]);
  });

  it("keeps only the blocked actions, each with its own reasons", () => {
    const stages = makeStages();
    const target = {
      ...makeAction("CH1", "2026-01-01", "2026-01-31", "target-action"),
      status: "in_progress",
    };
    const blockedAction = {
      ...makeAction("CH1", "2026-02-01", "2026-02-28", "A1"),
      prerequisites: [{ id: "pr1", kind: "action" as const, targetActionId: "target-action" }],
    };
    const freeAction = makeAction("CH1", "2026-01-01", "2026-01-15", "A2");

    const result = programBlockedActions([target, blockedAction, freeAction], stages);

    expect(result).toHaveLength(1);
    expect(result[0].action.id).toBe("A1");
    expect(result[0].reasons).toEqual([expect.stringContaining("target-action")]);
  });
});

// ─── Couleur déterministe par chantier (round 8) ───────────────────────────────────────────────

describe("colorForChantier", () => {
  it("returns the same color for the same chantier id across calls", () => {
    const first = colorForChantier("CH-cyber");
    const second = colorForChantier("CH-cyber");
    expect(second).toBe(first);
  });

  it("returns a non-empty Tailwind background class for any id", () => {
    expect(colorForChantier("CH1")).toMatch(/^bg-\w+-500$/);
    expect(colorForChantier("")).toMatch(/^bg-\w+-500$/);
  });
});

// ─── Staffing par période (round 7) ────────────────────────────────────────────────────────────

function makeStaffing(overrides?: Partial<ChantierStaffing>): ChantierStaffing {
  return {
    id: "ST1",
    companyId: "c1",
    programId: "p1",
    chantierId: "CH1",
    function: "it",
    fte: 1,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

describe("staffingPeriodBuckets", () => {
  it("ignores entries without a startDate", () => {
    const entries = [
      makeStaffing({ id: "S1" }), // pas de startDate → ignoré, "non daté"
      makeStaffing({ id: "S2", startDate: "2026-02-15" }),
    ];
    const buckets = staffingPeriodBuckets(entries, "quarterly");
    expect(buckets).toHaveLength(1);
    expect(buckets[0].period).toBe("2026-Q1");
    expect(buckets[0].totalFte).toBe(1);
  });

  it("labels periods correctly per granularity (YYYY-Q#, YYYY-S#, YYYY)", () => {
    const entry = makeStaffing({ id: "S1", startDate: "2026-08-10" });
    expect(staffingPeriodBuckets([entry], "quarterly")[0].period).toBe("2026-Q3");
    expect(staffingPeriodBuckets([entry], "semiannual")[0].period).toBe("2026-S2");
    expect(staffingPeriodBuckets([entry], "annual")[0].period).toBe("2026");
  });

  it("sums fte per period and per period+function", () => {
    const entries = [
      makeStaffing({ id: "S1", function: "it", fte: 2, startDate: "2026-01-10" }),
      makeStaffing({ id: "S2", function: "it", fte: 1, startDate: "2026-02-20" }),
      makeStaffing({ id: "S3", function: "finance", fte: 0.5, startDate: "2026-03-01" }),
    ];
    const buckets = staffingPeriodBuckets(entries, "quarterly");
    expect(buckets).toHaveLength(1);
    expect(buckets[0].period).toBe("2026-Q1");
    expect(buckets[0].totalFte).toBeCloseTo(3.5);
    expect(buckets[0].byFunction.it).toBeCloseTo(3);
    expect(buckets[0].byFunction.finance).toBeCloseTo(0.5);
  });

  it("sorts buckets chronologically ascending", () => {
    const entries = [
      makeStaffing({ id: "S1", startDate: "2027-01-05" }),
      makeStaffing({ id: "S2", startDate: "2026-01-05" }),
      makeStaffing({ id: "S3", startDate: "2026-07-05" }),
    ];
    const periods = staffingPeriodBuckets(entries, "semiannual").map((b) => b.period);
    expect(periods).toEqual(["2026-S1", "2026-S2", "2027-S1"]);
  });
});

// ─── Numérotation globale des KPI (round 10, fondation) ────────────────────────────────────────

function makeAxis(id: string, overrides?: Partial<StrategicAxis>): StrategicAxis {
  return {
    id,
    companyId: "c1",
    programId: "p1",
    name: `Axe ${id}`,
    stage: "defined",
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
    ...overrides,
  };
}

describe("numberIndicators", () => {
  it("numbers macro-then-chantier within each axis, continuing the running counter across axes (no reset)", () => {
    const axes = [makeAxis("AX1"), makeAxis("AX2")];
    const chantiers = [
      makeChantier("CH1", { axisIds: ["AX1"] }),
      makeChantier("CH2", { axisIds: ["AX2"] }),
      makeChantier("CH3", { axisIds: ["AX2"] }),
    ];
    const indicators = [
      // Axe 1 : 2 indicateurs macro + 1 chantier (1 indicateur) = 3 au total.
      makeIndicator({ id: "AX1-MACRO-1", axisId: "AX1" }),
      makeIndicator({ id: "AX1-MACRO-2", axisId: "AX1" }),
      makeIndicator({ id: "AX1-CH1-1", axisId: "AX1", chantierId: "CH1" }),
      // Axe 2 : 1 indicateur macro + 2 chantiers (1 indicateur chacun) = 3 au total.
      makeIndicator({ id: "AX2-MACRO-1", axisId: "AX2" }),
      makeIndicator({ id: "AX2-CH2-1", axisId: "AX2", chantierId: "CH2" }),
      makeIndicator({ id: "AX2-CH3-1", axisId: "AX2", chantierId: "CH3" }),
    ];

    const numbers = numberIndicators(axes, chantiers, indicators);

    expect(numbers.get("AX1-MACRO-1")).toBe(1);
    expect(numbers.get("AX1-MACRO-2")).toBe(2);
    expect(numbers.get("AX1-CH1-1")).toBe(3);
    // Axe 2 continue à 4, ne repart pas à 1.
    expect(numbers.get("AX2-MACRO-1")).toBe(4);
    expect(numbers.get("AX2-CH2-1")).toBe(5);
    expect(numbers.get("AX2-CH3-1")).toBe(6);
  });

  it("treats an indicator whose chantierId references a chantier that no longer exists as macro (same as KpiPageClient's grouped useMemo)", () => {
    const axes = [makeAxis("AX1")];
    // Le chantier référencé n'existe pas dans le tableau `chantiers` passé à la fonction.
    const chantiers: Chantier[] = [];
    const indicators = [
      makeIndicator({ id: "ORPHAN-REF", axisId: "AX1", chantierId: "GHOST-CHANTIER" }),
      makeIndicator({ id: "TRUE-MACRO", axisId: "AX1" }),
    ];

    const numbers = numberIndicators(axes, chantiers, indicators);

    // Les deux comptent comme macro, dans l'ordre du tableau `indicators` : ORPHAN-REF avant
    // TRUE-MACRO, comme le filtre `!i.chantierId || !knownChantierIds.has(i.chantierId)` de
    // `KpiPageClient.tsx` le prévoit.
    expect(numbers.get("ORPHAN-REF")).toBe(1);
    expect(numbers.get("TRUE-MACRO")).toBe(2);
    expect(numbers.size).toBe(2);
  });

  it("returns an empty map for an empty indicators array", () => {
    const axes = [makeAxis("AX1")];
    const chantiers = [makeChantier("CH1", { axisIds: ["AX1"] })];
    expect(numberIndicators(axes, chantiers, [])).toEqual(new Map());
  });

  it("assigns a continuous 1..N sequence with no gaps and no duplicates for a larger mixed fixture", () => {
    const axes = [makeAxis("AX1"), makeAxis("AX2"), makeAxis("AX3")];
    const chantiers = [
      makeChantier("CH1", { axisIds: ["AX1"] }),
      makeChantier("CH2", { axisIds: ["AX1"] }),
      makeChantier("CH3", { axisIds: ["AX3"] }),
    ];
    const indicators = [
      makeIndicator({ id: "I1", axisId: "AX1" }),
      makeIndicator({ id: "I2", axisId: "AX1", chantierId: "CH1" }),
      makeIndicator({ id: "I3", axisId: "AX1", chantierId: "CH2" }),
      makeIndicator({ id: "I4", axisId: "AX1", chantierId: "CH1" }),
      // AX2 : aucun indicateur, aucun chantier — ne doit rien casser.
      makeIndicator({ id: "I5", axisId: "AX3" }),
      makeIndicator({ id: "I6", axisId: "AX3", chantierId: "CH3" }),
      makeIndicator({ id: "I7", axisId: "AX3", chantierId: "GHOST" }), // rabattu sur macro d'AX3
    ];

    const numbers = numberIndicators(axes, chantiers, indicators);

    expect(numbers.size).toBe(indicators.length);
    const assigned = Array.from(numbers.values()).sort((a, b) => a - b);
    expect(assigned).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

// ─── Budget par projet (round 12) ──────────────────────────────────────────────────────────────

describe("sumProjetBudgets", () => {
  it("returns 0 for a chantier with no projet at all", () => {
    expect(sumProjetBudgets("CH1", [])).toBe(0);
  });

  it("sums only the projets of the requested chantier, treating a missing budget as 0", () => {
    const actions: ChantierAction[] = [
      { ...makeAction("CH1", "2026-01-01", "2026-01-31", "A1"), budget: 1000 },
      { ...makeAction("CH1", "2026-01-01", "2026-01-31", "A2"), budget: 500 },
      makeAction("CH1", "2026-01-01", "2026-01-31", "A3"), // pas de budget renseigné → compte 0
      { ...makeAction("CH2", "2026-01-01", "2026-01-31", "A4"), budget: 999999 }, // autre chantier
    ];
    expect(sumProjetBudgets("CH1", actions)).toBe(1500);
  });

  it("returns 0 when the chantier has projets but none of them has a budget declared", () => {
    const actions: ChantierAction[] = [
      makeAction("CH1", "2026-01-01", "2026-01-31", "A1"),
      makeAction("CH1", "2026-01-01", "2026-01-31", "A2"),
    ];
    expect(sumProjetBudgets("CH1", actions)).toBe(0);
  });
});

describe("sumConsumedBudget", () => {
  it("returns 0 for a chantier with no levier at all", () => {
    expect(sumConsumedBudget("CH1", [])).toBe(0);
  });

  it("sums only the leviers of the requested chantier, treating a missing consumedBudget as 0", () => {
    const actions: ChantierAction[] = [
      { ...makeAction("CH1", "2026-01-01", "2026-01-31", "A1"), consumedBudget: 800 },
      { ...makeAction("CH1", "2026-01-01", "2026-01-31", "A2"), consumedBudget: 300 },
      makeAction("CH1", "2026-01-01", "2026-01-31", "A3"), // pas de consommé renseigné → compte 0
      { ...makeAction("CH2", "2026-01-01", "2026-01-31", "A4"), consumedBudget: 999999 }, // autre chantier
    ];
    expect(sumConsumedBudget("CH1", actions)).toBe(1100);
  });

  it("returns 0 when the chantier has leviers but none of them has a consumedBudget declared", () => {
    const actions: ChantierAction[] = [
      makeAction("CH1", "2026-01-01", "2026-01-31", "A1"),
      makeAction("CH1", "2026-01-01", "2026-01-31", "A2"),
    ];
    expect(sumConsumedBudget("CH1", actions)).toBe(0);
  });
});

describe("sumProgramProjetBudgets", () => {
  it("sums projet budgets across all chantiers of the program, regardless of axis", () => {
    const chantiers: Chantier[] = [
      makeChantier("CH1", { programId: "p1", axisIds: ["AX001"] }),
      makeChantier("CH2", { programId: "p1", axisIds: ["AX002", "AX003"] }), // multi-axe
      makeChantier("CH3", { programId: "p2" }), // autre programme
    ];
    const actions: ChantierAction[] = [
      { ...makeAction("CH1", "2026-01-01", "2026-01-31", "A1"), budget: 1000 },
      { ...makeAction("CH2", "2026-01-01", "2026-01-31", "A2"), budget: 2000 },
      { ...makeAction("CH3", "2026-01-01", "2026-01-31", "A3"), budget: 999999 },
    ];
    // Un chantier multi-axe (CH2) ne doit compter QU'UNE fois, pas une fois par axe.
    expect(sumProgramProjetBudgets("p1", chantiers, actions)).toBe(3000);
  });

  it("returns 0 for a program with no chantier or no projet budget declared", () => {
    expect(sumProgramProjetBudgets("p1", [], [])).toBe(0);
  });
});

describe("programBudgetOverrun", () => {
  const chantiers: Chantier[] = [makeChantier("CH1", { programId: "p1" })];
  const actions: ChantierAction[] = [
    { ...makeAction("CH1", "2026-01-01", "2026-01-31", "A1"), budget: 1500 },
  ];

  it("returns undefined when the program has no declared total budget", () => {
    expect(
      programBudgetOverrun({ id: "p1", budget: undefined }, chantiers, actions)
    ).toBeUndefined();
  });

  it("returns undefined when the projet sum does not exceed the declared budget", () => {
    expect(programBudgetOverrun({ id: "p1", budget: 2000 }, chantiers, actions)).toBeUndefined();
  });

  it("returns the overrun amount when the projet sum exceeds the declared budget", () => {
    expect(programBudgetOverrun({ id: "p1", budget: 1000 }, chantiers, actions)).toBe(500);
  });
});

// ─── Responsable affiché d'un chantier (round 16) ──────────────────────────────────────────────

describe("resolveChantierOwner", () => {
  const FALLBACK = "Non assigné";

  it("prefers the chantier's pilote over its sponsor", () => {
    const chantier = makeChantier("CH1", { pilote: "jean.dupont", sponsorName: "marie.martin" });
    expect(resolveChantierOwner(chantier, [], FALLBACK)).toBe("jean.dupont");
  });

  it("falls back to the chantier's sponsorName when pilote is unset", () => {
    const chantier = makeChantier("CH1", { sponsorName: "marie.martin" });
    expect(resolveChantierOwner(chantier, [], FALLBACK)).toBe("marie.martin");
  });

  it("falls back to the parent axis owner when both pilote and sponsorName are unset", () => {
    const chantier = makeChantier("CH1", { axisIds: ["AX1"] });
    const axes = [makeAxis("AX1", { owner: "paul.durand" })];
    expect(resolveChantierOwner(chantier, axes, FALLBACK)).toBe("paul.durand");
  });

  it("returns the caller-supplied fallback when nothing is assigned, or the axis is not found", () => {
    // Ni pilote, ni sponsor, ni axe fourni.
    const chantier = makeChantier("CH1");
    expect(resolveChantierOwner(chantier, [], FALLBACK)).toBe(FALLBACK);

    // Axe référencé introuvable.
    const orphanChantier = makeChantier("CH2", { axisIds: ["GHOST"] });
    expect(resolveChantierOwner(orphanChantier, [], FALLBACK)).toBe(FALLBACK);

    // Axe existant mais sans owner.
    const chantierWithBareAxis = makeChantier("CH3", { axisIds: ["AX1"] });
    const axes = [makeAxis("AX1")];
    expect(resolveChantierOwner(chantierWithBareAxis, axes, FALLBACK)).toBe(FALLBACK);
  });
});

// ─── Responsable affiché d'un indicateur (round 12) ────────────────────────────────────────────

describe("resolveIndicatorOwner", () => {
  const FALLBACK = "Non assigné";

  it("prefers the chantier's pilote when the indicator is chantier-level and pilote is set", () => {
    const chantiers = [makeChantier("CH1", { pilote: "jean.dupont", sponsorName: "marie.martin" })];
    const indicator = makeIndicator({ chantierId: "CH1" });
    expect(resolveIndicatorOwner(indicator, [], chantiers, FALLBACK)).toBe("jean.dupont");
  });

  it("falls back to the chantier's sponsorName when pilote is unset", () => {
    const chantiers = [makeChantier("CH1", { sponsorName: "marie.martin" })];
    const indicator = makeIndicator({ chantierId: "CH1" });
    expect(resolveIndicatorOwner(indicator, [], chantiers, FALLBACK)).toBe("marie.martin");
  });

  it("resolves the axis owner for a macro indicator (no chantierId)", () => {
    const axes = [makeAxis("AX1", { owner: "paul.durand" })];
    const indicator = makeIndicator({ axisId: "AX1", chantierId: undefined });
    expect(resolveIndicatorOwner(indicator, axes, [], FALLBACK)).toBe("paul.durand");
  });

  it("returns the caller-supplied fallback when nothing is assigned, or the reference is orphaned", () => {
    // Chantier existant mais sans pilote ni sponsor.
    const chantiers = [makeChantier("CH1")];
    expect(
      resolveIndicatorOwner(makeIndicator({ chantierId: "CH1" }), [], chantiers, FALLBACK)
    ).toBe(FALLBACK);

    // Axe existant mais sans owner.
    const axes = [makeAxis("AX1")];
    expect(
      resolveIndicatorOwner(
        makeIndicator({ axisId: "AX1", chantierId: undefined }),
        axes,
        [],
        FALLBACK
      )
    ).toBe(FALLBACK);

    // Chantier référencé introuvable.
    expect(resolveIndicatorOwner(makeIndicator({ chantierId: "GHOST" }), [], [], FALLBACK)).toBe(
      FALLBACK
    );

    // Axe référencé introuvable.
    expect(
      resolveIndicatorOwner(
        makeIndicator({ axisId: "GHOST", chantierId: undefined }),
        [],
        [],
        FALLBACK
      )
    ).toBe(FALLBACK);
  });
});

// ─── Feuille de route programme (round 15) ─────────────────────────────────────────────────────

describe("programRoadmap", () => {
  it("returns an empty array for an empty program", () => {
    expect(programRoadmap([], [], [])).toEqual([]);
  });

  it("builds one row per levier for a single axis / single chantier, sorted by start date", () => {
    const axes = [makeAxis("AX1")];
    const chantiers = [makeChantier("CH1", { axisIds: ["AX1"], name: "Refonte SI" })];
    const actions: ChantierAction[] = [
      // Volontairement hors ordre dans le tableau d'entrée : la sortie doit être triée par début.
      // Round 18 : plus de `kanbanStatus`, jalons E0→E4 pour tout levier — A2 n'a pas encore de
      // `.milestones` déclaré (repli 0%), A1 est entièrement passé (100%).
      makeAction("CH1", "2027-06-01", "2027-08-31", "A2"),
      {
        ...makeAction("CH1", "2027-01-01", "2027-03-31", "A1"),
        milestones: {
          currentMilestone: "E4",
          passedMilestones: ["E0", "E1", "E2", "E3", "E4"],
          checklists: {},
        },
      },
    ];

    const rows = programRoadmap(axes, chantiers, actions);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.action.id)).toEqual(["A1", "A2"]);
    expect(rows[0].axis.id).toBe("AX1");
    expect(rows[0].chantier.id).toBe("CH1");
    expect(rows[0].chantier.name).toBe("Refonte SI");
    expect(rows[0].start).toBe("2027-01-01");
    expect(rows[0].end).toBe("2027-03-31");
    expect(rows[0].progressPct).toBe(100);
    expect(rows[1].progressPct).toBe(0);
  });

  it("associates each row with its OWN axis/chantier across a multi-axis, multi-chantier program", () => {
    const axes = [makeAxis("AX1"), makeAxis("AX2")];
    const chantiers = [
      makeChantier("CH1", { axisIds: ["AX1"] }),
      makeChantier("CH2", { axisIds: ["AX2"] }),
      makeChantier("CH3", { axisIds: ["AX2"] }),
    ];
    const actions = [
      makeAction("CH2", "2027-02-01", "2027-04-30", "A-CH2"),
      makeAction("CH1", "2026-01-01", "2026-06-30", "A-CH1"),
      makeAction("CH3", "2028-01-01", "2028-02-28", "A-CH3"),
    ];

    const rows = programRoadmap(axes, chantiers, actions);

    expect(rows).toHaveLength(3);
    const byActionId = new Map(rows.map((r) => [r.action.id, r]));
    expect(byActionId.get("A-CH1")?.axis.id).toBe("AX1");
    expect(byActionId.get("A-CH1")?.chantier.id).toBe("CH1");
    expect(byActionId.get("A-CH2")?.axis.id).toBe("AX2");
    expect(byActionId.get("A-CH2")?.chantier.id).toBe("CH2");
    expect(byActionId.get("A-CH3")?.axis.id).toBe("AX2");
    expect(byActionId.get("A-CH3")?.chantier.id).toBe("CH3");

    // Ordre : axe AX1 (son unique chantier/levier) avant axe AX2 (ses deux chantiers), jamais retrié.
    expect(rows.map((r) => r.action.id)).toEqual(["A-CH1", "A-CH2", "A-CH3"]);

    // Bornes globales calculées sur l'ensemble des lignes de TOUS les axes/chantiers.
    expect(programRoadmapBounds(rows)).toEqual({ start: "2026-01-01", end: "2028-02-28" });
  });

  it("excludes a chantier whose axisIds references no known axis, and a levier whose chantierId references no known chantier", () => {
    const axes = [makeAxis("AX1")];
    const chantiers = [
      makeChantier("CH1", { axisIds: ["AX1"] }),
      makeChantier("CH-ORPHAN", { axisIds: ["GHOST-AXIS"] }),
    ];
    const actions = [
      makeAction("CH1", "2027-01-01", "2027-02-28", "A1"),
      makeAction("CH-ORPHAN", "2027-01-01", "2027-02-28", "A-ORPHAN-CHANTIER"),
      makeAction("GHOST-CHANTIER", "2027-01-01", "2027-02-28", "A-ORPHAN-ACTION"),
    ];

    const rows = programRoadmap(axes, chantiers, actions);

    expect(rows.map((r) => r.action.id)).toEqual(["A1"]);
  });

  it("computes progressPct via the milestone/E0-E4 path identically whether or not a KPI is linked", () => {
    const axes = [makeAxis("AX1")];
    const chantiers = [makeChantier("CH1", { axisIds: ["AX1"] })];
    const actionWithKpi: ChantierAction = {
      ...makeAction("CH1", "2027-01-01", "2027-02-28", "A1"),
      indicatorId: "IND001",
      milestones: {
        currentMilestone: "E2",
        passedMilestones: ["E0", "E1"],
        checklists: {},
      },
    };
    // Round 18 : même levier, mêmes jalons, mais SANS `indicatorId` — doit produire exactement le
    // même `progressPct` (l'ancien aiguillage vers un mappage kanban a été supprimé).
    const actionWithoutKpi: ChantierAction = {
      ...makeAction("CH1", "2027-01-01", "2027-02-28", "A2"),
      milestones: {
        currentMilestone: "E2",
        passedMilestones: ["E0", "E1"],
        checklists: {},
      },
    };

    const rows = programRoadmap(axes, chantiers, [actionWithKpi, actionWithoutKpi]);

    // Même calcul que `milestoneProgressPct` (+ `resolveMilestoneAutoFlags` pour les items auto du
    // jalon courant E2) : 2 jalons validés (E0=10, E1=10, round 19 poids variable) = 20, plus le
    // crédit partiel du jalon courant (E2, poids 15). Round 26 : E2 n'a plus d'item automatique du
    // tout (son unique item auto "previousOranges" a été retiré) — ses 3 items sont tous manuels et
    // aucun n'est répondu ici, moyenne 0 → 15*0/100 = 0. Valeur de référence tirée du calcul réel
    // plutôt que reconstituée à la main (la check-list E2 exacte est définie dans
    // `lib/milestoneChecklist.ts`).
    expect(rows[0].progressPct).toBe(20);
    expect(rows[1].progressPct).toBe(20);
  });

  it("keeps only deliverables with a declared dueDate, and normalizes legacy string deliverables defensively", () => {
    const axes = [makeAxis("AX1")];
    const chantiers = [makeChantier("CH1", { axisIds: ["AX1"] })];
    const action: ChantierAction = {
      ...makeAction("CH1", "2027-01-01", "2027-02-28", "A1"),
      deliverables: [
        {
          id: "D1",
          label: "Livrable daté",
          phases: [],
          dueDate: "2027-02-15",
          status: "in_progress",
        },
        { id: "D2", label: "Livrable sans échéance", phases: [] },
        // Format legacy (avant le modèle riche) : une simple chaîne.
        "Livrable legacy" as unknown as Deliverable,
      ],
    };

    const rows = programRoadmap(axes, chantiers, [action]);

    expect(rows[0].deliverables).toEqual([
      { id: "D1", label: "Livrable daté", dueDate: "2027-02-15", status: "in_progress" },
    ]);
  });
});

describe("programRoadmapBounds", () => {
  it("returns undefined for an empty list of rows", () => {
    expect(programRoadmapBounds([])).toBeUndefined();
  });

  it("spans from the earliest start to the latest end across all rows", () => {
    const rows = [
      { start: "2027-03-01", end: "2027-05-31" },
      { start: "2026-11-01", end: "2027-01-31" },
      { start: "2027-01-01", end: "2028-06-30" },
    ];
    expect(programRoadmapBounds(rows)).toEqual({ start: "2026-11-01", end: "2028-06-30" });
  });
});

describe("axisProgressPct / projetMilestoneCounts", () => {
  const mk = (id: string, chantierId: string, passed: ("E0" | "E1")[]) =>
    ({
      id,
      chantierId,
      milestones: { currentMilestone: "E1", passedMilestones: passed, checklists: {} },
    }) as never;
  it("0 sans chantier", () => {
    expect(axisProgressPct("A", [], [])).toBe(0);
  });
  it("moyenne des chantiers de l'axe (multi-axe inclus)", () => {
    const chantiers = [
      { id: "C1", axisIds: ["A"] },
      { id: "C2", axisIds: ["A", "B"] },
      { id: "C3", axisIds: ["B"] },
    ];
    const actions = [mk("p1", "C1", ["E0"]), mk("p2", "C2", [])];
    const c1 = chantierDeclaredProgress("C1", actions);
    const c2 = chantierDeclaredProgress("C2", actions);
    expect(axisProgressPct("A", chantiers, actions)).toBe(Math.round((c1 + c2) / 2));
  });
  it("compte les jalons franchis", () => {
    expect(projetMilestoneCounts(mk("p", "C", ["E0"])).passed).toBe(1);
    expect(projetMilestoneCounts({}).passed).toBe(0);
    expect(projetMilestoneCounts({}).total).toBeGreaterThan(0);
  });
});

describe("sponsor d'axe", () => {
  // Rôle unique depuis la suppression de `StrategicAxis.sponsorName` (décision explicite : plus de
  // duplication sponsor COMEX / responsable au niveau axe) — `owner` EST le sponsor de l'axe.
  const users = [{ username: "u1", name: "Ursule Un" }];
  it("resolveUserFullName / axisSponsorLabel : nom complet, repli brut, undefined", () => {
    expect(resolveUserFullName("u1", users)).toBe("Ursule Un");
    expect(resolveUserFullName("inconnu", users)).toBe("inconnu");
    expect(resolveUserFullName(undefined, users)).toBeUndefined();
    expect(axisSponsorLabel({ owner: "u1" }, users)).toBe("Ursule Un");
    expect(axisSponsorLabel({}, users)).toBeUndefined();
  });
  it("axisDecisionMakers : le sponsor de l'axe (owner), seul rôle de décision", () => {
    expect(axisDecisionMakers({ owner: "o" })).toEqual(["o"]);
    expect(axisDecisionMakers({})).toEqual([]);
  });
  it("axesSponsoredBy + scope axis_sponsor via owner", () => {
    const axes = [
      { id: "A1", owner: "u1" },
      { id: "A2", owner: "u1" },
      { id: "A3", owner: "z" },
    ] as StrategicAxis[];
    expect(axesSponsoredBy(axes, "u1").map((a) => a.id)).toEqual(["A1", "A2"]);
    const scope = resolveStrategicOwnershipScope(
      { username: "u1", profiles: [{ role: "axis_sponsor" }] },
      "p1",
      axes,
      [],
      []
    );
    expect(scope.mode).toBe("scoped");
    if (scope.mode === "scoped") expect(Array.from(scope.axisIds).sort()).toEqual(["A1", "A2"]);
  });
});
