import { describe, expect, it } from "vitest";
import {
  buildMyWorkspace,
  missingMeasurementPeriod,
  type MyWorkspaceStrategicInput,
} from "@/lib/myWorkspace";
import { EMPTY_WORKSPACE } from "@/lib/myWorkspaceTypes";
import type { StrategicApproval } from "@/lib/strategicApprovals";
import type {
  Alert,
  AuthUser,
  BeTrackData,
  Chantier,
  ChantierAction,
  Lever,
  Program,
  WorkforceMovement,
} from "@/types";

const TODAY = "2026-09-25";
const t = (_key: string, fallback?: string) => fallback ?? _key;

function makeUser(username: string, profiles: AuthUser["profiles"], extra: Partial<AuthUser> = {}) {
  return {
    username,
    password: "test",
    profiles,
    firstName: username,
    lastName: "Test",
    name: `${username} Test`,
    companyId: "c1",
    ...extra,
  } satisfies AuthUser;
}

function makeLever(overrides: Partial<Lever> = {}): Lever {
  return {
    id: "L1",
    code: "L1",
    programId: "p1",
    type: "Sourcing",
    name: "Levier 1",
    ws: "WS1",
    owner: "",
    ownerInit: "",
    sponsor: "",
    sponsorInit: "",
    geography: "",
    country: "",
    entity: "",
    function: "",
    costCenter: "",
    pnlMap: "",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "qualified",
    progress: 40,
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
    lastUpdate: "2026-06-01",
    companyId: "c1",
    actions: [],
    ...overrides,
  };
}

/** Levier en exécution avec une action en retard → alerte auto AUTO-DELAY rouge. */
function lateLever(overrides: Partial<Lever> = {}): Lever {
  return makeLever({
    status: "in_progress",
    actions: [{ id: "a1", name: "Action", start: "2020-01-01", end: "2020-01-15", status: "todo" }],
    ...overrides,
  });
}

function makeData(overrides: Partial<BeTrackData> = {}): BeTrackData {
  return {
    program: {
      id: "P",
      name: "P",
      sponsor: "",
      target: 0,
      currency: "€M",
      fyStart: "2026-01-01",
      fyEnd: "2026-12-31",
      baselineEBIT: 0,
      revenue: 0,
    },
    workstreams: [
      { id: "WS1", name: "WS 1", sponsor: "Sam", sponsorUsername: "sam", color: "", target: 0 },
    ],
    leverStatuses: [],
    riskLevels: [],
    leverTypes: [],
    geographies: [],
    functions: [],
    pnlAccounts: [],
    levers: [],
    workforce: {
      totalFTE: 0,
      massSalary: 0,
      budgetSalary: 0,
      departments: [],
      employees: [],
      movements: [],
    },
    operations: {
      lines: [],
      kpisTarget: { oee: 0, scrap: 0, energy: 0, throughput: 0 },
      kpisActual: { oee: 0, scrap: 0, energy: 0, throughput: 0 },
    } as unknown as BeTrackData["operations"],
    alerts: [],
    audit: [],
    comments: {},
    ...overrides,
  };
}

function makeChantier(overrides: Partial<Chantier> = {}): Chantier {
  return {
    id: "CH1",
    companyId: "c1",
    programId: "p2",
    axisIds: ["AX1"],
    name: "Chantier 1",
    stage: "s1",
    dependencies: [],
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
    ...overrides,
  };
}

function makeAction(
  id: string,
  end: string,
  overrides: Partial<ChantierAction> = {}
): ChantierAction {
  return {
    id,
    companyId: "c1",
    chantierId: "CH1",
    name: `Projet ${id}`,
    owner: "alice",
    start: "2026-01-01",
    end,
    status: "s1",
    ...overrides,
  };
}

function makeStrategic(
  overrides: Partial<MyWorkspaceStrategicInput> = {}
): MyWorkspaceStrategicInput {
  return {
    programId: "p2",
    axes: [],
    chantiers: [makeChantier()],
    chantierActions: [],
    indicators: [],
    measurements: [],
    approvals: [],
    ...overrides,
  };
}

function makeMovement(id: string, overrides: Partial<WorkforceMovement>): WorkforceMovement {
  return {
    id,
    empId: null,
    label: `Mouvement ${id}`,
    leverId: "",
    type: "Recrutement",
    fte: 1,
    department: "IT",
    country: "FR",
    hrOwner: "",
    plannedDate: "2026-12-01",
    actualDate: null,
    status: "Planifié",
    hrValidated: false,
    salaryImpact: 0,
    savings: 0,
    cost: 0,
    ...overrides,
  };
}

const programs: Program[] = [
  {
    id: "p1",
    companyId: "c1",
    name: "Plan Perf",
    currency: "EUR",
    fyStart: "2026-01-01",
    fyEnd: "2026-12-31",
    baselineEBIT: 0,
    revenue: 0,
    createdAt: "2026-01-01",
    type: "performance",
  },
  {
    id: "p2",
    companyId: "c1",
    name: "Plan Strat",
    currency: "EUR",
    fyStart: "2026-01-01",
    fyEnd: "2026-12-31",
    baselineEBIT: 0,
    revenue: 0,
    createdAt: "2026-01-01",
    type: "strategic",
  },
];

describe("buildMyWorkspace", () => {
  it("renvoie un portail vide sans utilisateur", () => {
    expect(buildMyWorkspace({ user: null, today: TODAY }, t)).toEqual(EMPTY_WORKSPACE);
  });

  it("renvoie des listes vides pour un utilisateur sans données", () => {
    const ws = buildMyWorkspace(
      { user: makeUser("zoe", [{ role: "chantier_contributor" }]), today: TODAY },
      t
    );
    expect(ws).toEqual(EMPTY_WORKSPACE);
  });

  it("contributeur : ses projets en retard / à échéance / à venir, triés", () => {
    const done = makeAction("A7", "2026-09-01", {
      milestones: {
        currentMilestone: "E4",
        passedMilestones: ["E0", "E1", "E2", "E3", "E4"],
        checklists: {},
      },
    });
    const strategic = makeStrategic({
      chantierActions: [
        makeAction("A2", "2026-09-20"), // 5 j de retard
        makeAction("A4", "2026-10-15"), // dans 20 j → à venir
        makeAction("A1", "2026-09-10"), // 15 j de retard
        makeAction("A3", "2026-09-28"), // dans 3 j → à faire (échéance proche)
        makeAction("A5", "2026-12-01"), // hors fenêtre
        makeAction("A6", "2026-09-01", { owner: "bob" }), // pas à elle
        done, // terminé : jamais en retard
      ],
    });
    const ws = buildMyWorkspace(
      { user: makeUser("alice", [{ role: "chantier_contributor" }]), strategic, today: TODAY },
      t
    );
    expect(ws.pilotView).toBe(false);
    expect(ws.todo.map((i) => i.id)).toEqual([
      "chantierAction:A1",
      "chantierAction:A2",
      "chantierAction:A3",
    ]);
    expect(ws.todo[0]).toMatchObject({ severity: "critical", daysLate: 15, plan: "strategic" });
    expect(ws.todo[0].href).toBe("/levers?chantier=CH1&action=A1");
    expect(ws.todo[2]).toMatchObject({ severity: "warning", dueDate: "2026-09-28" });
    expect(ws.upcoming.map((i) => i.id)).toEqual(["chantierAction:A4"]);
    expect(ws.blocked).toEqual([]);
    // Périmètre : ses projets (owner), en retard = rouge.
    const a1 = ws.perimeter.find((p) => p.id === "action:A1");
    expect(a1).toMatchObject({ kind: "action", health: "red" });
    expect(ws.perimeter.some((p) => p.id === "action:A6")).toBe(false);
  });

  it("profil RH : mouvements en alerte dans « À faire », planifiés dans « À venir »", () => {
    const data = makeData({
      workforce: {
        ...makeData().workforce,
        movements: [
          makeMovement("M1", { plannedDate: "2026-09-01" }), // en retard
          makeMovement("M2", {
            status: "Réalisé",
            actualDate: "2026-09-10",
            plannedDate: "2026-09-10",
          }), // à valider
          makeMovement("M3", { plannedDate: "2026-10-10" }), // à venir
          makeMovement("M4", { plannedDate: "2026-09-01", status: "Abandonné" }),
        ],
      },
    });
    const hr = makeUser("helene", [{ role: "hr" }]);
    const ws = buildMyWorkspace({ user: hr, performance: data, today: TODAY }, t);
    expect(ws.todo.map((i) => i.id)).toEqual(["hrMovement:M1", "hrMovement:M2"]);
    expect(ws.todo[0]).toMatchObject({ severity: "critical", daysLate: 24, source: "hrMovement" });
    expect(ws.todo[0].href).toContain("/hr/etp?");
    expect(ws.todo[0].href).toContain("movementIds=M1");
    expect(ws.todo[1].severity).toBe("warning");
    expect(ws.upcoming.map((i) => i.id)).toEqual(["hrMovement:M3"]);

    // Un non-RH ne voit pas ces mouvements.
    const other = buildMyWorkspace(
      { user: makeUser("leo", [{ role: "lever" }]), performance: data, today: TODAY },
      t
    );
    expect(other.todo.filter((i) => i.source === "hrMovement")).toEqual([]);
  });

  it("CTO : vue pilotage, validations bloquées > 7 j, périmètre par programme", () => {
    const cto = makeUser("carl", [
      { role: "cto", programId: "p1" },
      { role: "axis_sponsor", programId: "p2" },
    ]);
    const data = makeData({
      levers: [
        lateLever({
          id: "L1",
          code: "L1",
          approval: {
            targetStatus: "validated",
            requestedBy: "olivia",
            requestedAt: "2026-09-01T10:00:00Z",
          },
          impacts: [
            {
              id: "i1",
              label: "Gain achats",
              type: "saving",
              nature: "opex_rec",
              amount: 1,
              status: "done",
              realizedApproval: { status: "pending", requestedAt: "2026-09-10T08:00:00Z" },
            },
          ],
        }),
        lateLever({ id: "L2", code: "L2", name: "Levier 2" }),
      ],
    });
    const approval = (id: string, requestedAt: string): StrategicApproval => ({
      id,
      companyId: "c1",
      programId: "p2",
      kind: "projet_delete",
      targetType: "projet",
      targetId: `X-${id}`,
      targetName: `Projet ${id}`,
      payload: {},
      requestedBy: "alice",
      requestedAt,
      approverRole: "chantier_owner",
      approverUsername: "pat",
      approverUsernames: ["pat"],
      status: "pending",
    });
    const strategic = makeStrategic({
      approvals: [approval("S1", "2026-09-05T09:00:00Z"), approval("S2", "2026-09-22T09:00:00Z")],
    });
    const ws = buildMyWorkspace(
      {
        user: cto,
        performance: data,
        strategic,
        programs,
        users: [cto],
        today: TODAY,
        options: { pilotTopAlerts: 1 },
      },
      t
    );
    expect(ws.pilotView).toBe(true);

    // Porte de levier : le CTO est approbateur nominal → « À faire », critique (24 j d'attente).
    const gate = ws.todo.find((i) => i.source === "leverApproval");
    expect(gate).toMatchObject({ severity: "critical", waitingDays: 24, href: "/validation" });

    // Alertes : plafonnées à `pilotTopAlerts`.
    expect(ws.todo.filter((i) => i.source === "leverAlert")).toHaveLength(1);

    // Bloqué chez d'autres : réalisé chez la finance (15 j) + demande stratégique chez pat (20 j) ;
    // la demande de 3 j n'est pas encore bloquée.
    expect(ws.blocked.map((i) => i.id)).toEqual([
      "blockedValidation:strategic:S1",
      "blockedValidation:realized:L1:i1",
    ]);
    expect(ws.blocked[0]).toMatchObject({ waitingOn: "pat", waitingDays: 20, plan: "strategic" });
    expect(ws.blocked[1]).toMatchObject({ waitingOn: "Finance", waitingDays: 15 });

    // Périmètre : une ligne par programme.
    expect(ws.perimeter.map((p) => [p.id, p.kind, p.health])).toEqual([
      ["program:p1", "program", "red"],
      ["program:p2", "program", "green"], // chantier chargé, sans signal
    ]);
    expect(ws.perimeter[0].href).toBe("/dashboard?program=p1");
  });

  it("dédoublonne un même objet remonté plusieurs fois (garde le plus grave)", () => {
    const owner = makeUser("olivia", [{ role: "lever" }]);
    const manual: Alert = {
      id: "MAN-1",
      type: "amber",
      ts: "2026-09-01",
      scope: "L1",
      title: "Point d'attention",
      desc: "",
      actorRole: "lever",
      companyId: "c1",
      source: "manual",
    };
    const data = makeData({
      levers: [lateLever({ ownerUsername: "olivia", owner: "olivia Test" })],
      alerts: [manual],
    });
    const ws = buildMyWorkspace(
      { user: owner, performance: data, users: [owner], today: TODAY },
      t
    );
    const alerts = ws.todo.filter((i) => i.source === "leverAlert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ severity: "critical", href: "/levers/detail?id=L1" });
    // Périmètre : son levier, rouge.
    expect(ws.perimeter).toEqual([
      expect.objectContaining({ id: "lever:L1", kind: "lever", health: "red" }),
    ]);
  });

  it("jalon demandé via le flux historique ET via une demande stratégique : une seule ligne", () => {
    const pilote = makeUser("paul", [{ role: "chantier_owner" }]);
    const action = makeAction("A1", "2027-01-01", {
      owner: "alice",
      milestoneApproval: {
        targetMilestone: "E1",
        requestedBy: "alice",
        requestedAt: "2026-09-20T10:00:00Z",
      },
    });
    const strategic = makeStrategic({
      chantiers: [makeChantier({ pilote: "paul" })],
      chantierActions: [action],
      approvals: [
        {
          id: "S1",
          companyId: "c1",
          programId: "p2",
          kind: "milestone",
          targetType: "projet",
          targetId: "A1",
          targetName: "Projet A1",
          payload: { targetMilestone: "E1" },
          requestedBy: "alice",
          requestedAt: "2026-09-20T10:00:00Z",
          approverRole: "chantier_owner",
          approverUsername: "paul",
          approverUsernames: ["paul"],
          status: "pending",
        },
      ],
    });
    const ws = buildMyWorkspace({ user: pilote, strategic, today: TODAY }, t);
    expect(ws.todo).toHaveLength(1);
    expect(ws.todo[0]).toMatchObject({
      source: "strategicApproval",
      title: "Valider le passage au jalon J1",
      severity: "warning",
      waitingDays: 5,
    });
  });

  it("demande à paliers : seul l'approbateur de l'étape COURANTE l'a « À faire » ; « bloqué chez » = cette étape", () => {
    const approval: StrategicApproval = {
      id: "S9",
      companyId: "c1",
      programId: "p2",
      kind: "projet_delete",
      targetType: "projet",
      targetId: "X-9",
      targetName: "Projet 9",
      payload: {},
      requestedBy: "alice",
      requestedAt: "2026-09-05T09:00:00Z",
      approverRole: "axis_sponsor",
      approverUsername: "sofia",
      approverUsernames: ["sofia"],
      status: "pending",
      chain: [
        { level: "chantierSponsor", usernames: ["paul"], decidedBy: "paul", decision: "approved" },
        { level: "axisSponsor", usernames: ["sofia"] },
      ],
      stepIndex: 1,
    };
    const strategic = makeStrategic({ approvals: [approval] });
    // Étape 1 déjà validée par paul : plus rien pour lui.
    const paul = makeUser("paul", [{ role: "chantier_owner", programId: "p2" }]);
    const wsPaul = buildMyWorkspace({ user: paul, strategic, today: TODAY }, t);
    expect(wsPaul.todo.filter((i) => i.source === "strategicApproval")).toEqual([]);
    // Étape 2 : sofia.
    const sofia = makeUser("sofia", [{ role: "axis_sponsor", programId: "p2" }]);
    const wsSofia = buildMyWorkspace({ user: sofia, strategic, today: TODAY }, t);
    expect(wsSofia.todo).toEqual([
      expect.objectContaining({
        id: "strategicApproval:S9",
        title: "Valider la suppression d'un projet · Étape 2/2",
      }),
    ]);
    // Vue pilotage (cto) : bloqué chez sofia (étape en cours), pas chez paul.
    const cto = makeUser("carl", [
      { role: "cto", programId: "p1" },
      { role: "axis_sponsor", programId: "p2" },
    ]);
    const wsCto = buildMyWorkspace(
      { user: cto, strategic, programs, users: [cto], today: TODAY },
      t
    );
    expect(wsCto.blocked).toEqual([
      expect.objectContaining({ id: "blockedValidation:strategic:S9", waitingOn: "sofia" }),
    ]);
  });
});

describe("missingMeasurementPeriod", () => {
  const indicator = { id: "I1", frequency: "monthly" as const, createdAt: "2026-01-01" };

  it("réclame la dernière période échue sans mesure", () => {
    expect(missingMeasurementPeriod(indicator, [], TODAY)).toBe("2026-08");
    expect(
      missingMeasurementPeriod(indicator, [{ indicatorId: "I1", period: "2026-07" }], TODAY)
    ).toBe("2026-08");
  });

  it("ne réclame rien si la période (ou une plus récente) est mesurée, ou si créé après", () => {
    expect(
      missingMeasurementPeriod(indicator, [{ indicatorId: "I1", period: "2026-08" }], TODAY)
    ).toBeUndefined();
    expect(
      missingMeasurementPeriod(indicator, [{ indicatorId: "I1", period: "2026-09" }], TODAY)
    ).toBeUndefined();
    expect(
      missingMeasurementPeriod({ ...indicator, createdAt: "2026-09-02" }, [], TODAY)
    ).toBeUndefined();
    expect(missingMeasurementPeriod({ ...indicator, frequency: "quarterly" }, [], TODAY)).toBe(
      "2026-Q2"
    );
  });
});
