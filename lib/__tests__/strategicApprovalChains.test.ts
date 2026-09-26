import { describe, it, expect, vi } from "vitest";
import {
  applyApprovedPayload,
  applyRejectedPayload,
  approvalStepInfo,
  bucketApprovals,
  buildApproval,
  buildApprovalAlerts,
  buildApprovalAuditEntry,
  canDecide,
  canDecideStep,
  computeApprovalChain,
  decideApproval,
  describeApproval,
  fieldCategory,
  isPendingOn,
  legacyMilestoneMarkers,
  needsApproval,
  pendingApproversOf,
  pendingOn,
  previewApprovalChain,
  requiredValidations,
  requiredValidationsForField,
  splitPatchByCategory,
  stepLabel,
  type StrategicApproval,
  type StrategicApprovalData,
  type StrategicApprovalKind,
  type StrategicApprovalPayload,
  type StrategicApprovalTarget,
} from "@/lib/strategicApprovals";
import {
  ApprovalGateUnavailableError,
  createChantierFlow,
  updateChantierFlow,
  updateProjetFlow,
  type ApprovalGate,
} from "@/lib/strategicApprovalFlows";
import { resolveMilestoneApprovalQueue } from "@/lib/hooks/useApprovalQueue";
import type { AuthUser, Chantier, ChantierAction, Indicator, StrategicAxis } from "@/types";

/**
 * Modèle à PALIERS (règles PO « données de pilotage ») — voir l'en-tête de lib/strategicApprovals.ts.
 * Hiérarchie du jeu : pilote du plan `lea` > sponsor d'axe `alice` > sponsor de chantier `bob`
 *   > responsable projet `carl` > contributeur `cora`.
 */
function user(username: string, role?: string, extra: Partial<AuthUser> = {}) {
  return {
    username,
    name: username.toUpperCase(),
    profiles: role ? [{ role, track: "strategic", programId: "P1" }] : [],
    ...extra,
  } as unknown as AuthUser;
}
const lea = user("lea", "strategic_lead");
const alice = user("alice", "axis_sponsor");
const bob = user("bob", "chantier_owner");
const carl = user("carl", "chantier_contributor");
const cora = user("cora", "chantier_contributor");
const admin = user("root", undefined, { isCompanyAdmin: true });
const users = [lea, alice, bob, carl, cora];

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
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
    ...o,
  }) as Chantier;
const projet = (o: Partial<ChantierAction> = {}) =>
  ({
    id: "CA1",
    companyId: "c",
    chantierId: "CH1",
    name: "Projet",
    start: "2026-01-01",
    end: "2026-06-01",
    status: "s",
    owner: "carl",
    contributors: ["cora"],
    budget: 100,
    ...o,
  }) as ChantierAction;
const kpi = (o: Partial<Indicator> = {}) =>
  ({
    id: "IND1",
    companyId: "c",
    programId: "P1",
    axisId: "AX1",
    chantierId: "CH1",
    name: "KPI",
    kind: "quantitative",
    frequency: "monthly",
    objective: "10",
    objectiveValue: 10,
    direction: "up",
    responsibleRoles: [],
    status: "on_track",
    createdAt: "",
    lastUpdate: "",
    ...o,
  }) as Indicator;

function data(o: Partial<StrategicApprovalData> = {}): StrategicApprovalData {
  return {
    programId: "P1",
    axes: [axis()],
    chantiers: [chantier()],
    chantierActions: [projet()],
    indicators: [kpi()],
    measurements: [],
    users,
    ...o,
  };
}

const T = {
  projet: { type: "projet", id: "CA1", name: "Projet" } as StrategicApprovalTarget,
  chantier: { type: "chantier", id: "CH1", name: "Chantier" } as StrategicApprovalTarget,
  axe: { type: "axe", id: "AX1", name: "Axe" } as StrategicApprovalTarget,
  kpi: { type: "indicateur", id: "IND1", name: "KPI" } as StrategicApprovalTarget,
};

const chainOf = (
  kind: StrategicApprovalKind,
  actor: AuthUser,
  target: StrategicApprovalTarget,
  payload?: StrategicApprovalPayload,
  d = data()
) => computeApprovalChain(kind, actor, target, d, payload).map((s) => s.usernames.join("|"));

const newChantier = chantier({ id: "CH-new", name: "Nouveau", pilote: undefined });
const pilotagePatch = {
  patch: { budget: 200 },
  before: { budget: 100 },
  category: "pilotage",
} as StrategicApprovalPayload;
const planningPatch = {
  patch: { end: "2026-09-01" },
  before: { end: "2026-06-01" },
  category: "planning",
} as StrategicApprovalPayload;
const designationPatch = {
  patch: { contributors: ["cora", "dan"] },
  before: { contributors: ["cora"] },
  category: "designation",
} as StrategicApprovalPayload;

function request(
  kind: StrategicApprovalKind,
  actor: AuthUser,
  target: StrategicApprovalTarget,
  payload: StrategicApprovalPayload,
  d = data()
): StrategicApproval {
  return buildApproval({
    kind,
    target,
    payload,
    companyId: "c",
    programId: "P1",
    requester: actor,
    data: d,
    id: "R1",
    now: "2026-03-01T10:00:00.000Z",
  });
}

describe("chaînes par kind et niveau d'auteur", () => {
  it("jalon : contributeur → responsable puis sponsor de chantier ; responsable → chantier puis axe ; sponsor de chantier → axe puis pilote ; pilote → direct", () => {
    expect(chainOf("milestone", cora, T.projet)).toEqual(["carl", "bob"]);
    expect(chainOf("milestone", carl, T.projet)).toEqual(["bob", "alice"]);
    expect(chainOf("milestone", bob, T.projet)).toEqual(["alice", "lea"]);
    expect(chainOf("milestone", alice, T.projet)).toEqual(["lea"]);
    expect(chainOf("milestone", lea, T.projet)).toEqual([]);
  });
  it("KPI : chaîne depuis le niveau RÉEL de l'auteur (PO : le sponsor de chantier valide les KPI de ses projets)", () => {
    // Projet LIÉ au KPI : responsable ET contributeur → sponsor de chantier puis sponsor d'axe.
    const linked = data({ chantierActions: [projet({ indicatorId: "IND1" })] });
    expect(chainOf("kpi_value", carl, T.kpi, undefined, linked)).toEqual(["bob", "alice"]);
    expect(chainOf("kpi_value", cora, T.kpi, undefined, linked)).toEqual(["bob", "alice"]);
    // Sponsor de chantier → sponsor d'axe puis pilote ; sponsor d'axe → pilote ; pilote → direct.
    expect(chainOf("kpi_value", bob, T.kpi)).toEqual(["alice", "lea"]);
    expect(chainOf("kpi_value", alice, T.kpi)).toEqual(["lea"]);
    expect(chainOf("kpi_value", lea, T.kpi)).toEqual([]);
    // Hors hiérarchie, KPI de CHANTIER : niveau responsable projet → chantier puis axe.
    expect(chainOf("kpi_value", user("kpiResp"), T.kpi)).toEqual(["bob", "alice"]);
    expect(chainOf("kpi_value", carl, T.kpi)).toEqual(["bob", "alice"]);
    // Hors hiérarchie, KPI d'AXE : niveau sponsor de chantier → axe puis pilote.
    const macro = kpi({ chantierId: undefined });
    expect(
      chainOf("kpi_value", user("x"), T.kpi, undefined, data({ indicators: [macro] }))
    ).toEqual(["alice", "lea"]);
    // KPI d'axe mais saisi par le membre d'un projet lié : chantier du projet puis axe.
    expect(
      chainOf(
        "kpi_value",
        cora,
        T.kpi,
        undefined,
        data({ indicators: [macro], chantierActions: [projet({ indicatorId: "IND1" })] })
      )
    ).toEqual(["bob", "alice"]);
  });
  it("création / suppression de projet : plancher responsable projet → chantier puis axe", () => {
    const create = { action: projet({ id: "NEW", owner: "cora" }) } as StrategicApprovalPayload;
    expect(chainOf("projet_create", cora, T.chantier, create)).toEqual(["bob", "alice"]);
    expect(chainOf("projet_create", bob, T.chantier, create)).toEqual(["alice", "lea"]);
    expect(chainOf("projet_delete", cora, T.projet)).toEqual(["bob", "alice"]);
    expect(chainOf("projet_delete", carl, T.projet)).toEqual(["bob", "alice"]);
    expect(chainOf("projet_delete", bob, T.projet)).toEqual(["alice", "lea"]);
  });
  it("création / suppression de chantier : plancher sponsor de chantier → axe puis pilote", () => {
    const payload = { chantier: newChantier } as StrategicApprovalPayload;
    expect(chainOf("chantier_create", carl, T.axe, payload)).toEqual(["alice", "lea"]);
    expect(chainOf("chantier_create", alice, T.axe, payload)).toEqual(["lea"]);
    expect(chainOf("chantier_delete", bob, T.chantier)).toEqual(["alice", "lea"]);
    expect(chainOf("chantier_delete", carl, T.chantier)).toEqual(["alice", "lea"]);
  });
  it("modification de projet : pilotage = 2, planning/désignation = 1 (N+1), libre = aucune", () => {
    expect(chainOf("projet_update", cora, T.projet, pilotagePatch)).toEqual(["carl", "bob"]);
    expect(chainOf("projet_update", carl, T.projet, pilotagePatch)).toEqual(["bob", "alice"]);
    expect(chainOf("projet_update", cora, T.projet, planningPatch)).toEqual(["carl"]);
    expect(chainOf("projet_update", carl, T.projet, planningPatch)).toEqual(["bob"]);
    expect(chainOf("projet_update", carl, T.projet, designationPatch)).toEqual(["bob"]);
    const free = { patch: { name: "x" }, before: {}, category: "free" } as never;
    expect(chainOf("projet_update", carl, T.projet, free)).toEqual([]);
  });
  it("le sponsor de chantier ne fait jamais bouger son chantier seul (pilotage chantier → axe puis pilote)", () => {
    const p = {
      patch: { consumedFte: 3 },
      before: {},
      category: "pilotage",
    } as StrategicApprovalPayload;
    expect(chainOf("chantier_update", bob, T.chantier, p)).toEqual(["alice", "lea"]);
    // … ni via le poids d'un de ses projets dans l'avancement du chantier.
    const w = {
      patch: { chantierWeightPct: 80 },
      before: {},
      category: "pilotage",
    } as StrategicApprovalPayload;
    expect(chainOf("projet_update", bob, T.projet, w)).toEqual(["alice", "lea"]);
  });
  it("niveaux vides sautés, admin → direct, chantier multi-axe → sponsors des deux axes au palier axe", () => {
    const noSponsor = data({ chantiers: [chantier({ pilote: undefined })] });
    expect(chainOf("milestone", carl, T.projet, undefined, noSponsor)).toEqual(["alice", "lea"]);
    expect(chainOf("milestone", admin, T.projet)).toEqual([]);
    const multi = data({
      axes: [axis(), axis({ id: "AX2", owner: "dora" })],
      chantiers: [chantier({ axisIds: ["AX1", "AX2"] })],
    });
    expect(chainOf("milestone", carl, T.projet, undefined, multi)).toEqual(["bob", "alice|dora"]);
  });
  it("needsApproval / previewApprovalChain", () => {
    expect(needsApproval("milestone", bob, T.projet, data())).toBe(true);
    expect(needsApproval("milestone", lea, T.projet, data())).toBe(false);
    expect(needsApproval("milestone", admin, T.projet, data())).toBe(false);
    const free = { patch: { description: "x" }, before: {}, category: "free" } as never;
    expect(needsApproval("projet_update", carl, T.projet, data(), undefined, free)).toBe(false);
    expect(previewApprovalChain("milestone", carl, T.projet, undefined, data())).toEqual([
      { level: "chantierSponsor", usernames: ["bob"] },
      { level: "axisSponsor", usernames: ["alice"] },
    ]);
    expect(previewApprovalChain("milestone", null, T.projet, undefined, data())).toEqual([]);
  });
});

describe("demande à paliers : snapshot, avance, refus, droits", () => {
  const req = () =>
    request("milestone", carl, T.projet, { targetMilestone: "E1", fromMilestone: "E0" });

  it("snapshot de la chaîne ; approver* = palier courant", () => {
    const a = req();
    expect(a.chain).toEqual([
      { level: "chantierSponsor", usernames: ["bob"] },
      { level: "axisSponsor", usernames: ["alice"] },
    ]);
    expect(a).toMatchObject({
      stepIndex: 0,
      approverRole: "chantier_owner",
      approverUsername: "bob",
      approverUsernames: ["bob"],
      status: "pending",
    });
    expect(pendingApproversOf(a)).toEqual(["bob"]);
    expect(approvalStepInfo(a)).toEqual({
      current: 1,
      total: 2,
      level: "chantierSponsor",
      usernames: ["bob"],
    });
    expect(stepLabel(a)).toBe("Étape 1/2");
  });

  it("la chaîne ne bouge pas si la hiérarchie change après la demande", () => {
    const a = req();
    const changed = data({ chantiers: [chantier({ pilote: "zed" })] });
    expect(canDecide(bob, a, changed)).toBe(true);
    expect(canDecide(user("zed", "chantier_owner"), a, changed)).toBe(false);
  });

  it("étape 1 validée → étape 2 (pas d'effet), puis validation finale → effet", () => {
    const a = req();
    expect(canDecide(alice, a, data())).toBe(false); // pas encore son tour
    const s1 = decideApproval(a, bob, "approved", "ok", "2026-03-02T00:00:00.000Z");
    expect(s1.final).toBe(false);
    expect(s1.approval).toMatchObject({
      status: "pending",
      stepIndex: 1,
      approverRole: "axis_sponsor",
      approverUsernames: ["alice"],
    });
    expect(s1.approval.decidedBy).toBeUndefined();
    expect(s1.approval.chain?.[0]).toMatchObject({
      decidedBy: "bob",
      decision: "approved",
      decisionComment: "ok",
    });
    expect(canDecide(bob, s1.approval, data())).toBe(false);
    expect(canDecide(alice, s1.approval, data())).toBe(true);
    expect(stepLabel(s1.approval)).toBe("Étape 2/2");
    const s2 = decideApproval(
      s1.approval,
      alice,
      "approved",
      undefined,
      "2026-03-03T00:00:00.000Z"
    );
    expect(s2.final).toBe(true);
    expect(s2.approval).toMatchObject({ status: "approved", decidedBy: "alice", stepIndex: 1 });
    expect(pendingApproversOf(s2.approval)).toEqual([]);
  });

  it("refus à l'étape 1 : clôt la demande (étape 2 jamais sollicitée), effets de refus", () => {
    const r = decideApproval(req(), bob, "rejected", "non");
    expect(r.final).toBe(true);
    expect(r.approval).toMatchObject({
      status: "rejected",
      decidedBy: "bob",
      decisionComment: "non",
    });
    expect(r.approval.chain?.[0].decision).toBe("rejected");
    expect(r.approval.chain?.[1].decidedBy).toBeUndefined();
    expect(canDecide(alice, r.approval, data())).toBe(false);
    const marked = data({
      chantierActions: [
        projet({
          milestoneApproval: { targetMilestone: "E1", requestedBy: "carl", requestedAt: "" },
        }),
      ],
    });
    expect(
      applyRejectedPayload(r.approval, marked).saveActions[0].milestoneApproval
    ).toBeUndefined();
  });

  it("refus à l'étape 2 : clôt aussi", () => {
    const s1 = decideApproval(req(), bob, "approved").approval;
    const r = decideApproval(s1, alice, "rejected", "non");
    expect(r).toMatchObject({ final: true, approval: { status: "rejected", decidedBy: "alice" } });
  });

  it("personne ne décide sa propre demande — admin compris", () => {
    // Un admin applique directement : aucune demande ne peut être construite pour lui.
    expect(() => request("milestone", admin, T.projet, { targetMilestone: "E1" }, data())).toThrow(
      /directement/
    );
    // Si une demande existe quand même avec une chaîne :
    const withChain: StrategicApproval = {
      ...req(),
      requestedBy: "root",
    };
    expect(canDecideStep(admin, withChain)).toBe(false);
    expect(canDecide(carl, req(), data())).toBe(false);
  });

  it("admin : contourne n'importe quel palier, y compris quand ses approbateurs ont disparu", () => {
    const orphan: StrategicApproval = {
      ...req(),
      chain: [
        { level: "chantierSponsor", usernames: ["gone"] },
        { level: "axisSponsor", usernames: ["gone2"] },
      ],
    };
    expect(canDecide(admin, orphan, data())).toBe(true);
    const s1 = decideApproval(orphan, admin, "approved").approval;
    expect(s1.chain?.[0].decidedBy).toBe("root");
    // Un admin décide AU PLUS UN palier d'une même demande : le suivant revient à un AUTRE admin.
    expect(canDecide(admin, s1, data())).toBe(false);
    const admin2 = user("root2", undefined, { isGlobalAdmin: true });
    expect(canDecide(admin2, s1, data())).toBe(true);
  });

  it("le pilote du plan ne décide PAS l'étape 1 (plus d'escalade strategic_lead), seulement la sienne", () => {
    const k = request("kpi_value", bob, T.kpi, { period: "2026-03", value: 5 });
    expect(k.chain?.map((s) => s.level)).toEqual(["axisSponsor", "pilot"]);
    expect(canDecide(lea, k, data())).toBe(false);
    const s1 = decideApproval(k, alice, "approved").approval;
    expect(canDecide(lea, s1, data())).toBe(true);
    const m = req();
    expect(canDecide(lea, m, data())).toBe(false);
    expect(canDecide(lea, decideApproval(m, bob, "approved").approval, data())).toBe(false);
  });

  it("celui qui a validé un palier ne valide pas le suivant (hors admin)", () => {
    const dup: StrategicApproval = {
      ...req(),
      chain: [
        { level: "chantierSponsor", usernames: ["bob"] },
        { level: "axisSponsor", usernames: ["bob", "alice"] },
      ],
    };
    const s1 = decideApproval(dup, bob, "approved").approval;
    expect(canDecide(bob, s1, data())).toBe(false);
    expect(canDecide(alice, s1, data())).toBe(true);
  });

  it("demande déjà close : plus décidable", () => {
    const closed = decideApproval(req(), bob, "rejected", "x").approval;
    expect(canDecide(admin, closed, data())).toBe(false);
  });
});

describe("compatibilité legacy (demandes sans chaîne)", () => {
  const legacy = (): StrategicApproval => ({
    id: "L1",
    companyId: "c",
    programId: "P1",
    kind: "milestone",
    targetType: "projet",
    targetId: "CA1",
    targetName: "Projet",
    payload: { targetMilestone: "E1" },
    requestedBy: "carl",
    requestedAt: "2026-03-01T10:00:00.000Z",
    approverRole: "chantier_owner",
    approverUsername: "bob",
    approverUsernames: ["bob"],
    status: "pending",
  });
  it("approbateur ou admin (autre que le demandeur) ; plus d'escalade strategic_lead", () => {
    expect(canDecide(bob, legacy(), data())).toBe(true);
    expect(canDecide(lea, legacy(), data())).toBe(false);
    expect(canDecide(admin, legacy(), data())).toBe(true);
    // Un admin ne décide jamais sa PROPRE demande legacy.
    expect(canDecide(admin, { ...legacy(), requestedBy: "root" }, data())).toBe(false);
    expect(canDecide(carl, legacy(), data())).toBe(false);
    expect(canDecide(alice, legacy(), data())).toBe(false);
    expect(approvalStepInfo(legacy())).toBeUndefined();
    expect(stepLabel(legacy())).toBe("");
    expect(pendingApproversOf(legacy())).toEqual(["bob"]);
  });
  it("décision unique et finale", () => {
    const r = decideApproval(legacy(), bob, "approved", " ok ");
    expect(r.final).toBe(true);
    expect(r.approval).toMatchObject({
      status: "approved",
      decidedBy: "bob",
      decisionComment: "ok",
    });
    expect(r.approval.chain).toBeUndefined();
  });
  it("buildApproval avec chain: null → legacy ; route directe (pilote) → lève, jamais de repli legacy", () => {
    const a = buildApproval({
      kind: "milestone",
      target: T.projet,
      payload: { targetMilestone: "E1" },
      companyId: "c",
      programId: "P1",
      requester: carl,
      data: data(),
      chain: null,
    });
    expect(a.chain).toBeUndefined();
    expect(a.approverUsernames).toEqual(["bob"]);
    expect(() => request("milestone", lea, T.projet, { targetMilestone: "E1" })).toThrow();
  });
});

describe("files d'attente, alertes, audit", () => {
  const req = () => request("projet_delete", carl, T.projet, { name: "Projet" });
  it("bucketApprovals : chacun ne voit que SON palier ; l'historique inclut les décideurs de palier", () => {
    const a = req();
    expect(bucketApprovals([a], bob, data()).pending).toHaveLength(1);
    expect(bucketApprovals([a], alice, data()).pending).toHaveLength(0);
    expect(bucketApprovals([a], lea, data()).pending).toHaveLength(0);
    const s1 = decideApproval(a, bob, "approved").approval;
    expect(bucketApprovals([s1], bob, data()).pending).toHaveLength(0);
    expect(bucketApprovals([s1], alice, data()).pending).toHaveLength(1);
    const done = decideApproval(s1, alice, "approved").approval;
    expect(bucketApprovals([done], bob, data()).history).toHaveLength(1);
  });
  it("alertes : « à valider » au palier courant, « en attente de … (étape x/2) » au demandeur", () => {
    const now = new Date("2026-03-02T00:00:00Z");
    const s1 = decideApproval(req(), bob, "approved").approval;
    expect(buildApprovalAlerts([s1], alice, data(), now).map((x) => x.id)).toEqual([
      "strategic-approval-R1-todo",
    ]);
    expect(buildApprovalAlerts([s1], bob, data(), now)).toEqual([]);
    const wait = buildApprovalAlerts([s1], carl, data(), now)[0];
    expect(wait.i18n?.vars).toMatchObject({ approver: "ALICE (étape 2/2)" });
  });
  it("audit : demande (palier 1) et validation intermédiaire", () => {
    const a = req();
    expect(buildApprovalAuditEntry(a, "requested", users).new).toContain(
      "à valider par BOB (étape 1/2)"
    );
    const s1 = decideApproval(a, bob, "approved", "vu").approval;
    const e = buildApprovalAuditEntry(s1, "step_approved", users);
    expect(e.action).toBe("approval_approved");
    expect(e.user).toBe("BOB");
    expect(e.new).toContain("BOB a validé (étape 1/2)");
    expect(e.new).toContain("en attente de ALICE");
    expect(e.new).toContain("(vu)");
  });
  it("jalons : l'ancienne file est vide ; un marqueur sans demande à chaîne est un reliquat", () => {
    const marked = projet({
      milestoneApproval: { targetMilestone: "E1", requestedBy: "carl", requestedAt: "" },
    });
    const pending = request("milestone", carl, T.projet, { targetMilestone: "E1" });
    expect(resolveMilestoneApprovalQueue([marked], [chantier()], bob, [axis()])).toHaveLength(0);
    expect(legacyMilestoneMarkers([marked], [])).toHaveLength(1);
    expect(legacyMilestoneMarkers([marked], [pending])).toHaveLength(0);
  });
  it("pendingOn / isPendingOn par cible et par champ", () => {
    const upd = request("projet_update", carl, T.projet, planningPatch);
    const mil = { ...request("milestone", carl, T.projet, { targetMilestone: "E1" }), id: "R2" };
    const all = [upd, mil];
    expect(pendingOn(all, T.projet)).toHaveLength(2);
    expect(isPendingOn(all, T.projet, "end")).toBe(true);
    expect(isPendingOn(all, T.projet, "start")).toBe(false);
    expect(pendingOn(all, T.projet, "milestones").map((a) => a.id)).toEqual(["R2"]);
    const del = request("projet_delete", carl, T.projet, {});
    expect(isPendingOn([del], T.projet, "anything")).toBe(true);
    expect(isPendingOn([{ ...upd, status: "approved" }], T.projet, "end")).toBe(false);
  });
});

describe("classification des champs", () => {
  it("catégories et nombre de validations", () => {
    expect(requiredValidations("pilotage")).toBe(2);
    expect(requiredValidations("planning")).toBe(1);
    expect(requiredValidations("designation")).toBe(1);
    expect(requiredValidations("free")).toBe(0);
    expect(fieldCategory("projet", "consumedBudget")).toBe("pilotage");
    expect(fieldCategory("projet", "milestones")).toBe("pilotage");
    expect(fieldCategory("projet", "end")).toBe("planning");
    expect(fieldCategory("projet", "owner")).toBe("designation");
    expect(fieldCategory("projet", "description")).toBe("free");
    expect(fieldCategory("projet", "somethingNew")).toBe("planning");
    expect(fieldCategory("chantier", "effort")).toBe("pilotage");
    expect(fieldCategory("chantier", "pilote")).toBe("designation");
    expect(requiredValidationsForField("projet", "name")).toBe(0);
  });
  it("livrables : commentaires/libellés libres ; échéance/statut/ajout → planning", () => {
    const d = [{ id: "d1", label: "L", phases: [], dueDate: "2026-05-01", status: "todo" }];
    const withComment = [{ ...d[0], comments: [{ id: "c", text: "x", createdAt: "" }] }];
    expect(fieldCategory("projet", "deliverables", d, withComment)).toBe("free");
    expect(fieldCategory("projet", "deliverables", d, [{ ...d[0], label: "L2" }])).toBe("free");
    expect(fieldCategory("projet", "deliverables", d, [{ ...d[0], status: "done" }])).toBe(
      "planning"
    );
    expect(fieldCategory("projet", "deliverables", d, [...d, { ...d[0], id: "d2" }])).toBe(
      "planning"
    );
  });
  it("splitPatchByCategory : ne garde que les champs modifiés, jamais les champs techniques", () => {
    const split = splitPatchByCategory("projet", projet(), {
      name: "Nouveau nom",
      end: "2026-12-01",
      start: "2026-01-01", // inchangé
      budget: 300,
      owner: "cora",
      milestoneApproval: { targetMilestone: "E1", requestedBy: "x", requestedAt: "" },
    });
    expect(split).toEqual({
      free: { name: "Nouveau nom" },
      planning: { end: "2026-12-01" },
      pilotage: { budget: 300 },
      designation: { owner: "cora" },
    });
  });
});

describe("effets des nouveaux kinds", () => {
  it("projet_update : applique le patch ; champ modifié depuis la demande → périmée", () => {
    const a = {
      ...request("projet_update", carl, T.projet, pilotagePatch),
      status: "approved" as const,
    };
    expect(applyApprovedPayload(a, data()).saveActions[0]).toMatchObject({
      id: "CA1",
      budget: 200,
    });
    expect(() =>
      applyApprovedPayload(a, data({ chantierActions: [projet({ budget: 150 })] }))
    ).toThrow(/périmée/);
    expect(() => applyApprovedPayload(a, data({ chantierActions: [] }))).toThrow(/introuvable/);
  });
  it("chantier_update / chantier_create", () => {
    const upd = {
      ...request("chantier_update", bob, T.chantier, {
        patch: { consumedFte: 4 },
        before: {},
        category: "pilotage",
      } as StrategicApprovalPayload),
      status: "approved" as const,
      decidedAt: "2026-04-01T00:00:00.000Z",
    };
    expect(applyApprovedPayload(upd, data()).saveChantiers[0]).toMatchObject({
      id: "CH1",
      consumedFte: 4,
      lastUpdate: "2026-04-01",
    });
    const cr = {
      ...request("chantier_create", carl, T.axe, {
        chantier: newChantier,
      } as StrategicApprovalPayload),
      status: "approved" as const,
    };
    expect(cr.chain?.map((s) => s.level)).toEqual(["axisSponsor", "pilot"]);
    expect(applyApprovedPayload(cr, data()).saveChantiers[0]).toMatchObject({
      id: "CH-new",
      companyId: "c",
    });
    expect(() => applyApprovedPayload(cr, data({ axes: [] }))).toThrow(/Axe introuvable/);
    expect(describeApproval(cr, data())).toMatchObject({ subject: "Nouveau", after: "Nouveau" });
  });
  it("describeApproval projet_update : avant/après par champ", () => {
    const a = request("projet_update", carl, T.projet, planningPatch);
    expect(describeApproval(a, data())).toMatchObject({
      before: "end : 2026-06-01",
      after: "end : 2026-09-01",
    });
  });
});

describe("flux de modification / création de chantier", () => {
  function gateFor(actor: AuthUser, d = data()) {
    const store: StrategicApproval[] = [];
    const gate: ApprovalGate = {
      needsApproval: (kind, target, stage, payload) =>
        needsApproval(kind, actor, target, d, stage, payload),
      request: async (kind, target, payload, reason) => {
        const a = buildApproval({
          kind,
          target,
          payload,
          reason,
          companyId: "c",
          programId: "P1",
          requester: actor,
          data: d,
        });
        store.push(a);
        return a;
      },
    };
    return { gate, store };
  }

  it("updateProjetFlow : libre appliqué, planning (1) et pilotage (2) soumis séparément", async () => {
    const { gate, store } = gateFor(carl);
    const apply = vi.fn(async () => undefined);
    const r = await updateProjetFlow(
      gate,
      projet(),
      { description: "desc", end: "2026-10-01", consumedBudget: 50 },
      apply
    );
    expect(r.outcome).toBe("partial");
    expect(apply).toHaveBeenCalledWith({ description: "desc" });
    expect(
      store.map((a) => [a.payload && (a.payload as { category: string }).category, a.chain?.length])
    ).toEqual([
      ["pilotage", 2],
      ["planning", 1],
    ]);
    expect((store[1].payload as { before: object }).before).toEqual({ end: "2026-06-01" });
  });
  it("updateProjetFlow : pilote/admin → tout appliqué ; rien de modifié → noop ; sans porte → refus", async () => {
    const { gate, store } = gateFor(lea);
    const apply = vi.fn(async () => undefined);
    const r = await updateProjetFlow(gate, projet(), { budget: 1, end: "2027-01-01" }, apply);
    expect(r.outcome).toBe("applied");
    expect(store).toHaveLength(0);
    expect(apply).toHaveBeenCalledWith({ budget: 1, end: "2027-01-01" });
    expect((await updateProjetFlow(gate, projet(), { budget: 100 }, apply)).outcome).toBe("noop");
    const direct = vi.fn(async () => undefined);
    await expect(updateProjetFlow(null, projet(), { budget: 5 }, direct)).rejects.toThrow(
      ApprovalGateUnavailableError
    );
    expect(direct).not.toHaveBeenCalled();
  });
  it("champ vidé via une demande : encodé null, puis effacé à l'approbation", async () => {
    const { gate, store } = gateFor(carl);
    await updateProjetFlow(gate, projet({ budget: 200 }), { budget: undefined }, vi.fn());
    expect((store[0].payload as { patch: object }).patch).toEqual({ budget: null });
    const approved = { ...store[0], status: "approved" as const };
    const saved = applyApprovedPayload(
      approved,
      data({ chantierActions: [projet({ budget: 200 })] })
    ).saveActions[0];
    expect(saved).not.toHaveProperty("budget");
  });
  it("désignation des contributeurs par le responsable projet : 1 validation (sponsor de chantier)", async () => {
    const { gate, store } = gateFor(carl);
    const r = await updateProjetFlow(gate, projet(), { contributors: ["cora", "dan"] }, vi.fn());
    expect(r.outcome).toBe("pending");
    expect(store[0].chain).toEqual([{ level: "chantierSponsor", usernames: ["bob"] }]);
  });
  it("updateChantierFlow : le sponsor de chantier soumet enveloppe/effort à l'axe puis au pilote", async () => {
    const { gate, store } = gateFor(bob);
    const apply = vi.fn(async () => undefined);
    const r = await updateChantierFlow(
      gate,
      chantier(),
      { allocatedBudget: 10, description: "d" },
      apply
    );
    expect(r.outcome).toBe("partial");
    expect(apply).toHaveBeenCalledWith({ description: "d" });
    expect(store[0].chain?.map((s) => s.usernames)).toEqual([["alice"], ["lea"]]);
  });
  it("createChantierFlow : demande (axe puis pilote) ou création directe par le pilote", async () => {
    const { gate, store } = gateFor(bob);
    const create = vi.fn(async () => undefined);
    expect(await createChantierFlow(gate, newChantier, create, " besoin ")).toBe("pending");
    expect(create).not.toHaveBeenCalled();
    expect(store[0]).toMatchObject({
      kind: "chantier_create",
      targetType: "axe",
      targetId: "AX1",
      reason: "besoin",
    });
    const pilot = gateFor(lea);
    expect(await createChantierFlow(pilot.gate, newChantier, create)).toBe("applied");
    expect(create).toHaveBeenCalledOnce();
  });
});
