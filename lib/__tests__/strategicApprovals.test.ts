import { describe, it, expect } from "vitest";
import {
  applyApprovedPayload,
  applyRejectedPayload,
  applyRequestSideEffects,
  bucketApprovals,
  buildApproval,
  buildApprovalAlerts,
  buildApprovalAuditEntry,
  canDecide,
  describeApproval,
  needsApproval,
  nextProjetCreateApproval,
  resolveApprover,
  stripUndefined,
  type StrategicApproval,
  type StrategicApprovalData,
} from "@/lib/strategicApprovals";
import type { AuthUser, Chantier, ChantierAction, Indicator, StrategicAxis } from "@/types";

function user(username: string, role?: string, programId?: string, extra: Partial<AuthUser> = {}) {
  return {
    username,
    name: username.toUpperCase(),
    profiles: role ? [{ role, track: "strategic", programId }] : [],
    ...extra,
  } as unknown as AuthUser;
}

const axis = (o: Partial<StrategicAxis> = {}) =>
  ({
    id: "AX1",
    companyId: "c",
    programId: "P1",
    name: "Axe",
    stage: "s",
    owner: "alice",
    ...o,
  }) as StrategicAxis;
const chantier = (o: Partial<Chantier> = {}) =>
  ({
    id: "CH1",
    companyId: "c",
    programId: "P1",
    axisIds: ["AX1"],
    name: "Chantier",
    stage: "s",
    dependencies: [],
    pilote: "bob",
    ...o,
  }) as Chantier;
const action = (o: Partial<ChantierAction> = {}) =>
  ({
    id: "CA1",
    companyId: "c",
    chantierId: "CH1",
    name: "Projet",
    start: "2026-01-01",
    end: "2026-06-01",
    status: "s",
    owner: "carl",
    ...o,
  }) as ChantierAction;
const indicator = (o: Partial<Indicator> = {}) =>
  ({
    id: "IND1",
    companyId: "c",
    programId: "P1",
    axisId: "AX1",
    name: "KPI",
    kind: "quantitative",
    frequency: "monthly",
    objective: "10",
    objectiveValue: 10,
    direction: "up",
    unit: "%",
    responsibleRoles: [],
    status: "on_track",
    createdAt: "",
    lastUpdate: "",
    ...o,
  }) as Indicator;

const lead = user("lea", "strategic_lead");
const users = [
  lead,
  user("alice", "axis_sponsor"),
  user("bob", "chantier_owner"),
  user("carl", "chantier_contributor"),
];

function data(o: Partial<StrategicApprovalData> = {}): StrategicApprovalData {
  return {
    programId: "P1",
    axes: [axis()],
    chantiers: [chantier()],
    chantierActions: [action()],
    indicators: [indicator()],
    measurements: [],
    users,
    ...o,
  };
}

function approval(o: Partial<StrategicApproval> = {}): StrategicApproval {
  return {
    id: "SA1",
    companyId: "c",
    programId: "P1",
    kind: "milestone",
    targetType: "projet",
    targetId: "CA1",
    targetName: "Projet",
    payload: { targetMilestone: "E1", fromMilestone: "E0" },
    requestedBy: "carl",
    requestedAt: "2026-03-01T10:00:00.000Z",
    approverRole: "chantier_owner",
    approverUsername: "bob",
    approverUsernames: ["bob"],
    status: "pending",
    ...o,
  };
}

describe("resolveApprover", () => {
  it("milestone / projet_delete -> pilote du chantier", () => {
    expect(resolveApprover("milestone", { type: "projet", id: "CA1" }, data())).toMatchObject({
      role: "chantier_owner",
      usernames: ["bob"],
    });
    expect(resolveApprover("projet_delete", { type: "projet", id: "CA1" }, data()).username).toBe(
      "bob"
    );
  });
  it("projet_create / chantier_delete -> owner de l'axe (tous les axes du chantier)", () => {
    const d = data({
      axes: [axis(), axis({ id: "AX2", owner: "dora" })],
      chantiers: [chantier({ axisIds: ["AX1", "AX2"] })],
    });
    expect(resolveApprover("projet_create", { type: "chantier", id: "CH1" }, d)).toMatchObject({
      role: "axis_sponsor",
      usernames: ["alice", "dora"],
    });
    expect(resolveApprover("chantier_delete", { type: "chantier", id: "CH1" }, data()).role).toBe(
      "axis_sponsor"
    );
  });
  it("le sponsor de l'axe (owner, rôle unique) décide (projet_create)", () => {
    const d = data({ axes: [axis({ owner: "alice" })] });
    const r = resolveApprover("projet_create", { type: "chantier", id: "CH1" }, d);
    expect(r.usernames).toEqual(["alice"]);
    const ap = approval({ kind: "projet_create", targetType: "chantier", targetId: "CH1" });
    expect(canDecide(user("alice"), ap, d)).toBe(true);
    expect(canDecide(user("zed"), ap, d)).toBe(false);
  });
  it("kpi_value -> strategic_lead du programme", () => {
    expect(resolveApprover("kpi_value", { type: "indicateur", id: "IND1" }, data())).toMatchObject({
      role: "strategic_lead",
      usernames: ["lea"],
    });
  });
  it("repli : sans pilote -> owner d'axe ; sans owner -> strategic_lead", () => {
    expect(
      resolveApprover(
        "milestone",
        { type: "projet", id: "CA1" },
        data({ chantiers: [chantier({ pilote: undefined })] })
      ).role
    ).toBe("axis_sponsor");
    const d = data({
      chantiers: [chantier({ pilote: undefined })],
      axes: [axis({ owner: undefined })],
    });
    expect(resolveApprover("milestone", { type: "projet", id: "CA1" }, d).role).toBe(
      "strategic_lead"
    );
  });
  it("strategic_lead scopé à un autre programme n'est pas résolu", () => {
    const d = data({ users: [user("zoe", "strategic_lead", "P2")] });
    expect(resolveApprover("kpi_value", { type: "indicateur", id: "IND1" }, d).usernames).toEqual(
      []
    );
  });
  it('projet_create avec `stage` : "chantier" -> pilote (repli axe), "axis"/absent -> axe (inchangé)', () => {
    const t = { type: "chantier" as const, id: "CH1" };
    expect(resolveApprover("projet_create", t, data(), "chantier")).toMatchObject({
      role: "chantier_owner",
      usernames: ["bob"],
    });
    // Sans pilote, le palier "chantier" cascade vers l'axe (même résolution que le palier "axis").
    const noPilote = data({ chantiers: [chantier({ pilote: undefined })] });
    expect(resolveApprover("projet_create", t, noPilote, "chantier")).toMatchObject({
      role: "axis_sponsor",
      usernames: ["alice"],
    });
    expect(resolveApprover("projet_create", t, data(), "axis")).toMatchObject({
      role: "axis_sponsor",
      usernames: ["alice"],
    });
    // Sans `stage` (relecture d'une demande d'avant la double validation) : identique à "axis".
    expect(resolveApprover("projet_create", t, data())).toEqual(
      resolveApprover("projet_create", t, data(), "axis")
    );
  });
});

describe("needsApproval", () => {
  const t = { type: "projet" as const, id: "CA1" };
  it("le sponsor de chantier ne passe plus seul un jalon (2 validations au-dessus de lui)", () => {
    expect(needsApproval("milestone", users[2], t, data())).toBe(true);
  });
  it("le contributeur passe par une demande", () => {
    expect(needsApproval("milestone", users[3], t, data())).toBe(true);
  });
  it("admin et strategic_lead sont exemptés", () => {
    expect(
      needsApproval(
        "projet_delete",
        user("root", undefined, undefined, { isCompanyAdmin: true }),
        t,
        data()
      )
    ).toBe(false);
    expect(needsApproval("projet_delete", lead, t, data())).toBe(false);
  });
  it("chantier owner doit demander pour un chantier_delete (approbateur = axe)", () => {
    expect(
      needsApproval("chantier_delete", users[2], { type: "chantier", id: "CH1" }, data())
    ).toBe(true);
    // Le sponsor d'axe lui-même : validé par le pilote du plan.
    expect(
      needsApproval("chantier_delete", users[1], { type: "chantier", id: "CH1" }, data())
    ).toBe(true);
    expect(needsApproval("chantier_delete", lead, { type: "chantier", id: "CH1" }, data())).toBe(
      false
    );
  });
  it("acteur absent -> demande", () => {
    expect(needsApproval("kpi_value", null, { type: "indicateur", id: "IND1" }, data())).toBe(true);
  });
});

describe("canDecide", () => {
  it("approbateur oui, autre non, demandeur non", () => {
    expect(canDecide(users[2], approval(), data())).toBe(true);
    expect(canDecide(users[3], approval(), data())).toBe(false);
    expect(canDecide(user("bob", "chantier_owner"), approval({ requestedBy: "bob" }), data())).toBe(
      false
    );
  });
  it("legacy : plus d'escalade strategic_lead ; admin oui sauf sur SA demande ; pas si déjà décidée", () => {
    expect(canDecide(lead, approval(), data())).toBe(false);
    const root = user("r", undefined, undefined, { isGlobalAdmin: true });
    expect(canDecide(root, approval(), data())).toBe(true);
    expect(canDecide(root, approval({ requestedBy: "r" }), data())).toBe(false);
    expect(canDecide(users[2], approval({ status: "approved" }), data())).toBe(false);
  });
  it("utilise l'approbateur stocké si la donnée courante est filtrée", () => {
    expect(canDecide(users[2], approval(), data({ chantiers: [], chantierActions: [] }))).toBe(
      true
    );
  });
});

describe("buildApproval / stripUndefined", () => {
  it("résout l'approbateur, retire les undefined", () => {
    const a = buildApproval({
      kind: "milestone",
      target: { type: "projet", id: "CA1", name: "Projet" },
      payload: { targetMilestone: "E1" },
      companyId: "c",
      programId: "P1",
      requester: users[3],
      data: data(),
      id: "X",
      now: "2026-01-01T00:00:00Z",
      reason: "  ",
    });
    expect(a).toMatchObject({
      id: "X",
      status: "pending",
      approverUsername: "bob",
      requestedBy: "carl",
      companyId: "c",
    });
    expect("reason" in a).toBe(false);
    expect(stripUndefined({ a: 1, b: undefined, c: [{ d: undefined, e: 2 }] })).toEqual({
      a: 1,
      c: [{ e: 2 }],
    });
  });
});

describe("applyApprovedPayload", () => {
  // Check-list E0 complète (E0-A1 est automatique : aucune alerte de dépendance → 100).
  const E0_COMPLETE = {
    E0: ["E0-A2", "E0-B1", "E0-B2", "E0-C1"].map((itemId) => ({ itemId, progressPct: 100 })),
  };
  it("milestone : avance le jalon et retire le marqueur", () => {
    const a = action({
      milestones: { currentMilestone: "E0", passedMilestones: [], checklists: E0_COMPLETE },
      milestoneApproval: { targetMilestone: "E1", requestedBy: "carl", requestedAt: "" },
    });
    const e = applyApprovedPayload(approval(), data({ chantierActions: [a] }));
    expect(e.saveActions[0].milestones?.currentMilestone).toBe("E1");
    expect(e.saveActions[0].milestones?.passedMilestones).toEqual(["E0"]);
    expect(e.saveActions[0].milestoneApproval).toBeUndefined();
  });
  it("milestone : check-list redevenue incomplète depuis la demande -> refus à l'approbation", () => {
    const a = action({
      milestones: {
        currentMilestone: "E0",
        passedMilestones: [],
        checklists: { E0: [...E0_COMPLETE.E0.slice(1), { itemId: "E0-A2", progressPct: 50 }] },
      },
      milestoneApproval: { targetMilestone: "E1", requestedBy: "carl", requestedAt: "" },
    });
    expect(() => applyApprovedPayload(approval(), data({ chantierActions: [a] }))).toThrow(
      /plus complet/
    );
  });
  it("milestone périmé ou cible absente -> erreur", () => {
    const a = action({
      milestones: { currentMilestone: "E2", passedMilestones: [], checklists: {} },
    });
    expect(() => applyApprovedPayload(approval(), data({ chantierActions: [a] }))).toThrow(
      /périmée/
    );
    expect(() => applyApprovedPayload(approval(), data({ chantierActions: [] }))).toThrow(
      /introuvable/
    );
  });
  it("kpi_value : mesure idempotente + statut recalculé", () => {
    const a = approval({
      kind: "kpi_value",
      targetType: "indicateur",
      targetId: "IND1",
      payload: { period: "2026-03", value: 5 },
      decidedAt: "2026-03-05T00:00:00Z",
    });
    const e = applyApprovedPayload(a, data());
    expect(e.saveMeasurements[0]).toMatchObject({
      id: "IM-SA1",
      indicatorId: "IND1",
      value: 5,
      reportedBy: "carl",
      companyId: "c",
    });
    expect(e.saveIndicators[0].status).toBe("at_risk");
    expect(
      applyApprovedPayload({ ...a, payload: { period: "2026-03", value: 12 } }, data())
        .saveIndicators
    ).toEqual([]);
    expect(() => applyApprovedPayload(a, data({ indicators: [] }))).toThrow();
  });
  it("projet_create : sauve l'action ; chantier absent -> erreur", () => {
    const a = approval({
      kind: "projet_create",
      targetType: "chantier",
      targetId: "CH1",
      payload: { action: action({ id: "NEW", companyId: "" }) },
    });
    expect(applyApprovedPayload(a, data()).saveActions[0]).toMatchObject({
      id: "NEW",
      companyId: "c",
    });
    expect(() => applyApprovedPayload(a, data({ chantiers: [] }))).toThrow();
  });
  it("projet_delete / chantier_delete (cascade projets)", () => {
    expect(
      applyApprovedPayload(approval({ kind: "projet_delete", payload: {} }), data()).deleteActionIds
    ).toEqual(["CA1"]);
    const e = applyApprovedPayload(
      approval({ kind: "chantier_delete", targetType: "chantier", targetId: "CH1", payload: {} }),
      data({
        chantierActions: [
          action(),
          action({ id: "CA2" }),
          action({ id: "CA3", chantierId: "OTHER" }),
        ],
      })
    );
    expect(e.deleteChantierIds).toEqual(["CH1"]);
    expect(e.deleteActionIds).toEqual(["CA1", "CA2"]);
  });
});

describe("effets de demande / refus", () => {
  it("milestone : marqueur posé puis retiré au refus", () => {
    const req = applyRequestSideEffects(approval(), data());
    expect(req.saveActions[0].milestoneApproval?.targetMilestone).toBe("E1");
    expect(
      applyRequestSideEffects(approval({ kind: "projet_delete", payload: {} }), data()).saveActions
    ).toEqual([]);
    const withMarker = data({ chantierActions: [req.saveActions[0]] });
    expect(
      applyRejectedPayload(approval(), withMarker).saveActions[0].milestoneApproval
    ).toBeUndefined();
    expect(applyRejectedPayload(approval(), data()).saveActions).toEqual([]);
  });
});

describe("projet_create — double validation (nextProjetCreateApproval)", () => {
  const stage1 = (o: Partial<StrategicApproval> = {}) =>
    approval({
      kind: "projet_create",
      targetType: "chantier",
      targetId: "CH1",
      targetName: "Chantier",
      payload: { action: action({ id: "NEW" }), stage: "chantier" },
      requestedBy: "carl",
      requestedByName: "CARL",
      approverRole: "chantier_owner",
      approverUsername: "bob",
      approverUsernames: ["bob"],
      status: "approved",
      decidedBy: "bob",
      ...o,
    });

  it("palier chantier approuvé -> enchaîne une 2e demande, palier axe, même payload/cible", () => {
    const next = nextProjetCreateApproval(stage1(), data());
    expect(next).toMatchObject({
      kind: "projet_create",
      targetType: "chantier",
      targetId: "CH1",
      requestedBy: "carl",
      approverRole: "axis_sponsor",
      approverUsernames: ["alice"],
      status: "pending",
      payload: { stage: "axis" },
    });
    expect((next!.payload as { action: { id: string } }).action.id).toBe("NEW");
  });
  it("n'agit que sur un palier chantier approuvé (pas sur les autres kinds/statuts/paliers)", () => {
    expect(nextProjetCreateApproval(approval(), data())).toBeUndefined(); // kind "milestone"
    expect(nextProjetCreateApproval(stage1({ status: "pending" }), data())).toBeUndefined();
    expect(
      nextProjetCreateApproval(
        stage1({ payload: { action: action({ id: "NEW" }), stage: "axis" } }),
        data()
      )
    ).toBeUndefined(); // déjà au palier terminal
  });
  it("repli : aucun responsable d'axe ni strategic_lead -> pas de 2e demande (création directe)", () => {
    const d = data({ axes: [axis({ owner: undefined })], users: [] });
    expect(nextProjetCreateApproval(stage1(), d)).toBeUndefined();
  });
  it("le demandeur d'origine est déjà le responsable d'axe -> pas de 2e demande (il ne pourrait pas se décider lui-même)", () => {
    const d = data({ axes: [axis({ owner: "carl" })] });
    expect(nextProjetCreateApproval(stage1({ requestedBy: "carl" }), d)).toBeUndefined();
  });
  it("le demandeur d'origine est le strategic_lead du programme -> pas de 2e demande", () => {
    expect(nextProjetCreateApproval(stage1({ requestedBy: "lea" }), data())).toBeUndefined();
  });
});

describe("describeApproval", () => {
  it("avant/après par kind", () => {
    expect(describeApproval(approval(), data())).toMatchObject({
      subject: "Projet",
      before: "J0",
      after: "J1",
    });
    const k = describeApproval(
      approval({
        kind: "kpi_value",
        targetType: "indicateur",
        targetId: "IND1",
        payload: { period: "2026-03", value: 7 },
      }),
      data({
        measurements: [
          {
            id: "m",
            companyId: "c",
            indicatorId: "IND1",
            period: "2026-02",
            value: 4,
            reportedBy: "x",
            reportedAt: "",
          },
        ],
      })
    );
    expect(k.before).toBe("4 %");
    expect(k.after).toBe("7 % (2026-03)");
    const del = describeApproval(
      approval({ kind: "chantier_delete", payload: { name: "Chantier" } }),
      data()
    );
    expect(del.after).toBeUndefined();
    expect(del.before).toBe("Chantier");
  });
  it("projet_create : le palier apparaît en `before` (distingue les 2 demandes dans l'UI)", () => {
    const proj = action({ id: "NEW", name: "Nouveau", start: "2026-02-01", end: "2026-03-01" });
    const chantierStage = describeApproval(
      approval({
        kind: "projet_create",
        targetType: "chantier",
        targetId: "CH1",
        payload: { action: proj, stage: "chantier" },
      }),
      data()
    );
    expect(chantierStage).toMatchObject({
      subject: "Nouveau",
      before: "Validation du pilote de chantier",
      after: "2026-02-01 → 2026-03-01",
    });
    const axisStage = describeApproval(
      approval({
        kind: "projet_create",
        targetType: "chantier",
        targetId: "CH1",
        payload: { action: proj, stage: "axis" },
      }),
      data()
    );
    expect(axisStage.before).toBe("Validation du responsable d'axe");
    expect(chantierStage.before).not.toBe(axisStage.before);
    // Sans `stage` (relecture d'avant la double validation) : pas de palier à afficher.
    const legacy = describeApproval(
      approval({
        kind: "projet_create",
        targetType: "chantier",
        targetId: "CH1",
        payload: { action: proj },
      }),
      data()
    );
    expect(legacy.before).toBeUndefined();
  });
});

describe("audit", () => {
  it("texte explicite demande / validation / refus", () => {
    const del = approval({
      kind: "chantier_delete",
      targetType: "chantier",
      targetId: "CH1",
      targetName: "Y",
      payload: { name: "Y" },
      approverRole: "axis_sponsor",
      approverUsername: "alice",
      reason: "obsolète",
    });
    const req = buildApprovalAuditEntry(del, "requested", users);
    expect(req.action).toBe("approval_requested");
    expect(req.new).toContain(
      "CARL a demandé la suppression du chantier « Y » — à valider par ALICE"
    );
    expect(req.new).toContain("obsolète");
    const ok = buildApprovalAuditEntry(
      { ...del, status: "approved", decidedBy: "alice" },
      "approved",
      users
    );
    expect(ok.new).toBe("CARL a supprimé le chantier « Y » — validé par ALICE");
    expect(ok.user).toBe("ALICE");
    const ko = buildApprovalAuditEntry(
      { ...del, status: "rejected", decidedBy: "alice", decisionComment: "non" },
      "rejected",
      users
    );
    expect(ko.action).toBe("approval_rejected");
    expect(ko.new).toContain("ALICE a refusé la suppression du chantier « Y »");
    expect(ko.new).toContain("(non)");
  });
});

describe("alertes & buckets", () => {
  const now = new Date("2026-03-02T00:00:00Z");
  it("approbateur : à valider ; demandeur : en attente", () => {
    expect(buildApprovalAlerts([approval()], users[2], data(), now).map((a) => a.id)).toEqual([
      "strategic-approval-SA1-todo",
    ]);
    const mine = buildApprovalAlerts([approval()], users[3], data(), now);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: "strategic-approval-SA1-wait", type: "blue" });
  });
  it("décision : demandeur et approbateur alertés, fenêtre respectée", () => {
    const done = approval({
      status: "rejected",
      decidedBy: "bob",
      decidedAt: "2026-03-01T12:00:00Z",
      decisionComment: "non",
    });
    const req = buildApprovalAlerts([done], users[3], data(), now);
    expect(req[0]).toMatchObject({ type: "red", id: "strategic-approval-SA1-decision" });
    expect(buildApprovalAlerts([done], users[2], data(), now)[0].id).toBe(
      "strategic-approval-SA1-decided"
    );
    expect(buildApprovalAlerts([done], users[3], data(), new Date("2026-06-01T00:00:00Z"))).toEqual(
      []
    );
    expect(buildApprovalAlerts([done], users[1], data(), now)).toEqual([]);
    expect(buildApprovalAlerts([approval()], null, data(), now)).toEqual([]);
  });
  it("bucketApprovals", () => {
    const decided = approval({
      id: "SA2",
      status: "approved",
      decidedBy: "bob",
      decidedAt: "2026-03-02T00:00:00Z",
    });
    const all = [approval(), decided];
    const b = bucketApprovals(all, users[2], data());
    expect(b.pending.map((a) => a.id)).toEqual(["SA1"]);
    expect(b.history.map((a) => a.id)).toEqual(["SA2"]);
    expect(b.mine).toEqual([]);
    const c = bucketApprovals(all, users[3], data());
    expect(c.mine.map((a) => a.id)).toEqual(["SA2", "SA1"]);
    expect(c.pending).toEqual([]);
    expect(bucketApprovals(all, null, data())).toEqual({ pending: [], mine: [], history: [] });
    expect(bucketApprovals(all, lead, data()).history).toHaveLength(1);
  });
});
