import { describe, it, expect, vi } from "vitest";
import { canFillIndicator } from "@/lib/axisLogic";
import { canFillIndicatorValue } from "@/lib/kpiHistory";
import {
  applyApprovedPayload,
  buildApproval,
  canAdjustKpiValue,
  canCreateAxis,
  canDecide,
  canEditAxis,
  canEditIndicatorTarget,
  canEditStaffing,
  canRequestMilestone,
  decideApproval,
  describeApproval,
  fieldCategory,
  levelRole,
  resolveApprovalRoute,
  type StrategicApproval,
  type StrategicApprovalData,
  type StrategicApprovalKind,
  type StrategicApprovalPayload,
  type StrategicApprovalTarget,
} from "@/lib/strategicApprovals";
import {
  ApprovalForbiddenError,
  ApprovalGateUnavailableError,
  ApprovalRetryError,
  createAxisFlow,
  createProjetFlow,
  deleteFlow,
  directGate,
  milestoneFlow,
  staffingFlow,
  updateAxisFlow,
  updateChantierFlow,
  updateIndicatorTargetFlow,
  type ApprovalGate,
} from "@/lib/strategicApprovalFlows";
import {
  FIELD_FALLBACK,
  KIND_FALLBACK,
  kindLabelKey,
  LEVEL_FALLBACK,
  levelLabelKey,
  patchDiffRows,
} from "@/lib/strategicApprovalView";
import { fallbackApprovalChain } from "@/lib/strategicHierarchy";
import type {
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierStaffing,
  Indicator,
  StrategicAxis,
} from "@/types";

/**
 * Correctifs d'audit du circuit de validation du Plan Stratégique (voir l'en-tête de
 * lib/strategicApprovals.ts) + nouveaux kinds axes / objectif KPI / staffing.
 * Hiérarchie du jeu : pilote `lea` > sponsor d'axe `alice` > sponsor de chantier `bob`
 *   > responsable projet `carl` > contributeur `cora` ; admins `root`, `root2` ; comex `cx`.
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
const cora = user("cora", "projet_contributor");
const zed = user("zed", "chantier_contributor");
const cx = user("cx", "comex_member");
const root = user("root", undefined, { isCompanyAdmin: true });
const root2 = user("root2", undefined, { isGlobalAdmin: true });
const users = [lea, alice, bob, carl, cora, zed, cx, root, root2];

const axis = (o: Partial<StrategicAxis> = {}) =>
  ({
    id: "AX1",
    companyId: "c",
    programId: "P1",
    name: "Axe",
    stage: "s",
    owner: "alice",
    createdAt: "",
    lastUpdate: "",
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
    createdAt: "",
    lastUpdate: "",
    ...o,
  }) as Chantier;
const e0Checklist = ["E0-A2", "E0-B1", "E0-B2", "E0-C1"].map((itemId) => ({
  itemId,
  progressPct: 100,
}));
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
    milestones: { currentMilestone: "E0", passedMilestones: [], checklists: { E0: e0Checklist } },
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
const line = (o: Partial<ChantierStaffing> = {}) =>
  ({
    id: "CS1",
    companyId: "c",
    programId: "P1",
    chantierId: "CH1",
    function: "IT",
    fte: 2,
    createdAt: "",
    ...o,
  }) as ChantierStaffing;

function data(o: Partial<StrategicApprovalData> = {}): StrategicApprovalData {
  return {
    programId: "P1",
    axes: [axis()],
    chantiers: [chantier()],
    chantierActions: [projet()],
    indicators: [kpi()],
    measurements: [],
    staffing: [line(), line({ id: "CS2", actionId: "CA1", fte: 1 })],
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

const pilotage = {
  patch: { budget: 200 },
  before: { budget: 100 },
  category: "pilotage",
} as StrategicApprovalPayload;

/** Porte de test branchée sur la VRAIE route (comme le hook). */
function gateFor(actor: AuthUser, d = data()) {
  const store: StrategicApproval[] = [];
  const gate: ApprovalGate = {
    route: (kind, target, payload) => resolveApprovalRoute(kind, actor, target, d, payload),
    needsApproval: () => {
      throw new Error("route() doit être utilisée");
    },
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

const route = (
  kind: StrategicApprovalKind,
  actor: AuthUser | null,
  target: StrategicApprovalTarget,
  payload?: StrategicApprovalPayload,
  d = data()
) => resolveApprovalRoute(kind, actor, target, d, payload);

// ─── 1. Chaîne vide : jamais d'application directe pour un non-pilote ────────────────────────

describe("1. chaîne vide → pilote(s), sinon admins ; utilisateurs non chargés → retry", () => {
  const orphanData = (o: Partial<StrategicApprovalData> = {}) =>
    data({
      axes: [axis({ owner: undefined })],
      chantiers: [chantier({ pilote: undefined })],
      ...o,
    });

  it("fallbackApprovalChain : hiérarchie > pilotes (hors auteur) > admins", () => {
    const h = [{ level: "chantierSponsor" as const, usernames: ["bob"] }];
    expect(fallbackApprovalChain(h, "carl", ["lea"], ["root"])).toBe(h);
    expect(fallbackApprovalChain([], "carl", ["lea", "carl"], ["root"])).toEqual([
      { level: "pilot", usernames: ["lea"] },
    ]);
    expect(fallbackApprovalChain([], "carl", [], ["root", "carl"])).toEqual([
      { level: "admin", usernames: ["root"] },
    ]);
    expect(fallbackApprovalChain([], "carl", [], [])).toEqual([{ level: "admin", usernames: [] }]);
  });

  it("sponsor d'axe sans pilote au-dessus : demande au palier admin (plus d'application directe)", () => {
    const noPilot = data({ users: users.filter((u) => u.username !== "lea") });
    expect(route("chantier_delete", alice, T.chantier, { name: "x" }, noPilot)).toEqual({
      mode: "request",
      chain: [{ level: "admin", usernames: ["root", "root2"] }],
    });
  });

  it("responsable projet sans aucun niveau désigné au-dessus : palier pilote", () => {
    expect(route("projet_update", carl, T.projet, pilotage, orphanData())).toEqual({
      mode: "request",
      chain: [{ level: "pilot", usernames: ["lea"] }],
    });
  });

  it("pilote du programme / admin : direct (même sans utilisateurs chargés)", () => {
    expect(route("projet_update", lea, T.projet, pilotage, data({ users: [] })).mode).toBe(
      "direct"
    );
    expect(route("projet_update", root, T.projet, pilotage, data({ users: [] })).mode).toBe(
      "direct"
    );
    // Pilote d'un AUTRE programme : pas direct.
    const other = { ...lea, profiles: [{ role: "strategic_lead", programId: "P2" }] } as AuthUser;
    expect(route("projet_update", other, T.projet, pilotage).mode).toBe("request");
  });

  it("utilisateurs non chargés : retry, buildApproval lève, les flux lèvent sans rien écrire", async () => {
    const loading = data({ users: [] });
    expect(route("projet_update", carl, T.projet, pilotage, loading).mode).toBe("retry");
    expect(
      route("projet_update", carl, T.projet, pilotage, { ...loading, users: undefined }).mode
    ).toBe("retry");
    expect(() =>
      buildApproval({
        kind: "projet_delete",
        target: T.projet,
        payload: { name: "x" },
        companyId: "c",
        programId: "P1",
        requester: carl,
        data: loading,
      })
    ).toThrow(/chargement/);
    const { gate, store } = gateFor(carl, loading);
    const del = vi.fn(async () => undefined);
    await expect(
      deleteFlow(gate, "projet", { id: "CA1", name: "Projet" }, "", del)
    ).rejects.toThrow(ApprovalRetryError);
    expect(del).not.toHaveBeenCalled();
    expect(store).toHaveLength(0);
    // Même un libellé libre n'est pas appliqué quand une autre partie du patch doit être validée.
    const apply = vi.fn(async () => undefined);
    await expect(
      updateChantierFlow(gate, chantier(), { name: "Nouveau", allocatedBudget: 5 }, apply)
    ).rejects.toThrow(ApprovalRetryError);
    expect(apply).not.toHaveBeenCalled();
  });
});

// ─── 2. Porte absente ──────────────────────────────────────────────────────────────────────

describe("2. porte absente : refus, sauf pilote/admin via directGate", () => {
  it("flux sans porte : ApprovalGateUnavailableError, rien d'écrit", async () => {
    const create = vi.fn(async () => undefined);
    await expect(createProjetFlow(null, chantier(), projet({ id: "N" }), create)).rejects.toThrow(
      ApprovalGateUnavailableError
    );
    await expect(createAxisFlow(undefined, axis({ id: "AX9" }), create)).rejects.toThrow(
      ApprovalGateUnavailableError
    );
    expect(create).not.toHaveBeenCalled();
  });
  it("directGate : pilote/admin appliquent ; les autres sont refusés", async () => {
    const del = vi.fn(async () => undefined);
    const t = { id: "CA1", name: "Projet" };
    expect(await deleteFlow(directGate(lea, "P1"), "projet", t, "", del)).toBe("applied");
    expect(await deleteFlow(directGate(root, "P1"), "projet", t, "", del)).toBe("applied");
    await expect(deleteFlow(directGate(bob, "P1"), "projet", t, "", del)).rejects.toThrow(
      ApprovalForbiddenError
    );
    expect(del).toHaveBeenCalledTimes(2);
  });
});

// ─── 3. Admin : un seul palier, jamais sa demande ─────────────────────────────────────────

describe("3. admin : au plus UN palier d'une demande, jamais sa propre demande", () => {
  it("demande à chaîne", () => {
    const a = buildApproval({
      kind: "projet_update",
      target: T.projet,
      payload: pilotage,
      companyId: "c",
      programId: "P1",
      requester: carl,
      data: data(),
    });
    expect(canDecide(root, a, data())).toBe(true);
    const s1 = decideApproval(a, root, "approved").approval;
    expect(canDecide(root, s1, data())).toBe(false);
    expect(canDecide(root2, s1, data())).toBe(true);
    expect(canDecide(alice, s1, data())).toBe(true);
    expect(canDecide(root, { ...a, requestedBy: "root" }, data())).toBe(false);
  });
  it("demande legacy (sans chaîne) : approbateur ou admin autre que le demandeur, pas le pilote", () => {
    const legacy: StrategicApproval = {
      id: "L",
      companyId: "c",
      programId: "P1",
      kind: "projet_delete",
      targetType: "projet",
      targetId: "CA1",
      payload: { name: "x" },
      requestedBy: "root",
      requestedAt: "2026-01-01T00:00:00.000Z",
      approverRole: "chantier_owner",
      approverUsername: "bob",
      approverUsernames: ["bob"],
      status: "pending",
    };
    expect(canDecide(root, legacy, data())).toBe(false);
    expect(canDecide(root2, legacy, data())).toBe(true);
    expect(canDecide(bob, legacy, data())).toBe(true);
    expect(canDecide(lea, legacy, data())).toBe(false);
  });
});

// ─── 4 & 7. Jalons ─────────────────────────────────────────────────────────────────────────

describe("4/7. jalons : uniquement par demandes à chaîne ; contributeurs compris", () => {
  it("canRequestMilestone : membres du projet et niveaux au-dessus, admin ; pas un tiers", () => {
    const d = data();
    for (const u of [cora, carl, bob, alice, lea, root]) {
      expect(canRequestMilestone(u, projet(), d), u.username).toBe(true);
    }
    expect(canRequestMilestone(zed, projet(), d)).toBe(false);
  });
  it("contributeur : demande responsable projet puis sponsor de chantier ; tiers : refus", async () => {
    const { gate, store } = gateFor(cora);
    const direct = vi.fn(async () => undefined);
    expect(await milestoneFlow(gate, projet(), cora, [chantier()], [projet()], direct)).toBe(
      "pending"
    );
    expect(direct).not.toHaveBeenCalled();
    expect(store[0].chain?.map((s) => s.usernames)).toEqual([["carl"], ["bob"]]);
    expect(store[0].payload).toEqual({ targetMilestone: "E1", fromMilestone: "E0" });
    const outsider = gateFor(zed);
    await expect(
      milestoneFlow(outsider.gate, projet(), zed, [chantier()], [projet()])
    ).rejects.toThrow(ApprovalForbiddenError);
  });
  it("pilote : passage appliqué directement via applyDirect (patch d'avancée)", async () => {
    const { gate, store } = gateFor(lea);
    const direct = vi.fn(async () => undefined);
    expect(await milestoneFlow(gate, projet(), lea, [chantier()], [projet()], direct)).toBe(
      "applied"
    );
    expect(store).toHaveLength(0);
    expect(direct).toHaveBeenCalledWith({
      milestones: {
        currentMilestone: "E1",
        passedMilestones: ["E0"],
        checklists: { E0: e0Checklist },
      },
      milestoneApproval: undefined,
    });
  });
  it("approbation finale : jalon avancé et marqueur d'affichage retiré", () => {
    const marked = projet({
      milestoneApproval: { targetMilestone: "E1", requestedBy: "cora", requestedAt: "" },
    });
    const a: StrategicApproval = {
      ...buildApproval({
        kind: "milestone",
        target: T.projet,
        payload: { targetMilestone: "E1", fromMilestone: "E0" },
        companyId: "c",
        programId: "P1",
        requester: cora,
        data: data(),
      }),
      status: "approved",
    };
    const saved = applyApprovedPayload(a, data({ chantierActions: [marked] })).saveActions[0];
    expect(saved.milestones?.currentMilestone).toBe("E1");
    expect(saved.milestoneApproval).toBeUndefined();
  });
});

// ─── 5. KPI : pas d'ajustement avant le dernier palier ────────────────────────────────────

describe("5. correction KPI : seul le DERNIER palier peut ajuster la valeur", () => {
  it("canAdjustKpiValue", () => {
    const a = buildApproval({
      kind: "kpi_value",
      target: T.kpi,
      payload: { period: "2026-03", value: 7, measurementId: "IM1" },
      companyId: "c",
      programId: "P1",
      requester: carl,
      data: data(),
    });
    expect(a.chain?.map((s) => s.usernames)).toEqual([["bob"], ["alice"]]);
    expect(canAdjustKpiValue(a)).toBe(false);
    const s1 = decideApproval(a, bob, "approved").approval;
    expect(canAdjustKpiValue(s1)).toBe(true);
    // Nouvelle valeur (pas une correction) ou suppression : jamais ajustable.
    const fresh = { ...s1, payload: { period: "2026-03", value: 7 } };
    expect(canAdjustKpiValue(fresh)).toBe(false);
    const removal = { ...s1, payload: { period: "2026-03", measurementId: "IM1", remove: true } };
    expect(canAdjustKpiValue(removal)).toBe(false);
  });
});

// ─── 6. Saisie KPI par les membres d'un projet lié ─────────────────────────────────────────

describe("6. canFillIndicator : responsable et contributeurs d'un projet lié au KPI", () => {
  const linked = [projet({ indicatorId: "IND1" })];
  it("reconnus avec ctx.chantierActions, pas sans ; projet non lié : non", () => {
    const ind = kpi({ additionalAuthorizedUserIds: ["someone"] });
    expect(canFillIndicator(ind, carl, { chantierActions: linked })).toBe(true);
    expect(canFillIndicator(ind, cora, { chantierActions: linked })).toBe(true);
    expect(canFillIndicator(ind, carl)).toBe(false);
    expect(canFillIndicator(ind, carl, { chantierActions: [projet()] })).toBe(false);
    expect(canFillIndicatorValue(ind, cora, { chantierActions: linked })).toBe(true);
    // comex : jamais, même membre d'un projet lié.
    const cxMember = [projet({ indicatorId: "IND1", contributors: ["cx"] })];
    expect(canFillIndicator(ind, cx, { chantierActions: cxMember })).toBe(false);
  });
});

// ─── 7/8. Libellés sponsor retirés, rôle contributeur ─────────────────────────────────────

describe("7/8. champs sponsor retirés ; rôle du palier contributeur", () => {
  it("sponsor / sponsorName ne sont plus des champs catégorisés ni libellés", () => {
    expect(FIELD_FALLBACK).not.toHaveProperty("sponsor");
    expect(FIELD_FALLBACK).not.toHaveProperty("sponsorName");
    // Champ inconnu → défaut "planning" (1 validation), plus de catégorie "designation" dédiée.
    expect(fieldCategory("projet", "sponsor")).toBe("planning");
    expect(fieldCategory("chantier", "sponsorName")).toBe("planning");
  });
  it("levelRole", () => {
    expect(levelRole("contributor")).toBe("projet_contributor");
    expect(levelRole("projectOwner")).toBe("chantier_contributor");
    expect(levelRole("admin")).toBe("strategic_lead");
  });
});

// ─── 9. Nouveaux kinds ────────────────────────────────────────────────────────────────────

describe("9a. axes : création pilote/admin seulement ; édition pilote, ou sponsor de l'axe → pilote", () => {
  it("droits", () => {
    expect(canCreateAxis(lea, "P1")).toBe(true);
    expect(canCreateAxis(root, "P1")).toBe(true);
    expect(canCreateAxis(alice, "P1")).toBe(false);
    expect(canEditAxis(lea, axis())).toBe(true);
    expect(canEditAxis(alice, axis())).toBe(true);
    expect(canEditAxis(alice, axis({ owner: "dora" }))).toBe(false);
    expect(canEditAxis(bob, axis())).toBe(false);
    expect(canEditAxis(user("alice", "comex_member"), axis())).toBe(false);
  });
  it("createAxisFlow : pilote direct ; sponsor d'axe refusé", async () => {
    const created = axis({ id: "AX9", name: "Nouvel axe", owner: undefined });
    const create = vi.fn(async () => undefined);
    expect(await createAxisFlow(gateFor(lea).gate, created, create)).toBe("applied");
    await expect(createAxisFlow(gateFor(alice).gate, created, create)).rejects.toThrow(
      ApprovalForbiddenError
    );
    expect(create).toHaveBeenCalledOnce();
    expect(route("axe_create", alice, { type: "axe", id: "AX9" }, { axis: created }).mode).toBe(
      "forbidden"
    );
  });
  it("updateAxisFlow : sponsor → libellés directs, reste 1 validation (pilote), owner interdit", async () => {
    const { gate, store } = gateFor(alice);
    const apply = vi.fn(async () => undefined);
    const r = await updateAxisFlow(gate, axis(), { name: "Axe 2", stage: "t" }, apply);
    expect(r.outcome).toBe("partial");
    expect(apply).toHaveBeenCalledWith({ name: "Axe 2" });
    expect(store[0]).toMatchObject({ kind: "axe_update", targetId: "AX1" });
    expect(store[0].chain).toEqual([{ level: "pilot", usernames: ["lea"] }]);
    await expect(updateAxisFlow(gate, axis(), { owner: "zed" }, apply)).rejects.toThrow(
      ApprovalForbiddenError
    );
    // Un autre rôle : refusé, même pour un libellé.
    const other = vi.fn(async () => undefined);
    await expect(updateAxisFlow(gateFor(bob).gate, axis(), { name: "x" }, other)).rejects.toThrow(
      ApprovalForbiddenError
    );
    expect(other).not.toHaveBeenCalled();
    // Pilote : tout direct, désignation comprise.
    const pilotApply = vi.fn(async () => undefined);
    const p = await updateAxisFlow(
      gateFor(lea).gate,
      axis(),
      { owner: "zed", stage: "t" },
      pilotApply
    );
    expect(p.outcome).toBe("applied");
    expect(pilotApply).toHaveBeenCalledWith({ owner: "zed", stage: "t" });
  });
  it("effets : axe_update appliqué (périmé si modifié entre-temps), axe_create enregistré", () => {
    const { gate, store } = gateFor(alice);
    return updateAxisFlow(gate, axis(), { stage: "t" }, vi.fn()).then(() => {
      const approved = { ...store[0], status: "approved" as const };
      const e = applyApprovedPayload(approved, data());
      expect(e.saveAxes[0]).toMatchObject({ id: "AX1", stage: "t" });
      expect(() => applyApprovedPayload(approved, data({ axes: [axis({ stage: "z" })] }))).toThrow(
        /périmée/
      );
      const created: StrategicApproval = {
        ...approved,
        kind: "axe_create",
        payload: { axis: axis({ id: "AX9", programId: "" }) },
      };
      expect(applyApprovedPayload(created, data()).saveAxes[0]).toMatchObject({
        id: "AX9",
        programId: "P1",
        companyId: "c",
      });
      expect(describeApproval(approved, data()).after).toBe("stage : t");
    });
  });
});

describe("9b. objectif KPI (indicator_update)", () => {
  it("droits : pilote/admin, sponsor du chantier du KPI, sponsor d'axe ; pas le responsable projet ni comex", () => {
    const d = data();
    expect(canEditIndicatorTarget(lea, kpi(), d)).toBe(true);
    expect(canEditIndicatorTarget(root, kpi(), d)).toBe(true);
    expect(canEditIndicatorTarget(bob, kpi(), d)).toBe(true);
    expect(canEditIndicatorTarget(alice, kpi(), d)).toBe(true);
    expect(canEditIndicatorTarget(carl, kpi(), d)).toBe(false);
    expect(canEditIndicatorTarget(user("bob", "comex_member"), kpi(), d)).toBe(false);
    // KPI d'axe : le sponsor de chantier n'est pas habilité.
    expect(canEditIndicatorTarget(bob, kpi({ chantierId: undefined }), d)).toBe(false);
  });
  it("chaînes : KPI de chantier par le sponsor de chantier → axe puis pilote ; KPI d'axe par le sponsor d'axe → pilote", () => {
    const payload = { patch: { objectiveValue: 12 }, before: { objectiveValue: 10 } };
    const r = route("indicator_update", bob, T.kpi, payload);
    expect(r.mode === "request" && r.chain.map((s) => s.usernames)).toEqual([["alice"], ["lea"]]);
    const macro = kpi({ chantierId: undefined });
    const r2 = route("indicator_update", alice, T.kpi, payload, data({ indicators: [macro] }));
    expect(r2.mode === "request" && r2.chain).toEqual([{ level: "pilot", usernames: ["lea"] }]);
    expect(route("indicator_update", carl, T.kpi, payload).mode).toBe("forbidden");
    expect(route("indicator_update", lea, T.kpi, payload).mode).toBe("direct");
  });
  it("flux : ne garde que les champs d'objectif modifiés ; demande puis application (statut recalculé)", async () => {
    const { gate, store } = gateFor(bob);
    const apply = vi.fn(async () => undefined);
    const noop = await updateIndicatorTargetFlow(gate, kpi(), { objectiveValue: 10 }, apply);
    expect(noop.outcome).toBe("noop");
    const r = await updateIndicatorTargetFlow(
      gate,
      kpi(),
      { objectiveValue: 12, targetSchedule: [{ period: "2026-06", value: 11 }] },
      apply
    );
    expect(r.outcome).toBe("pending");
    expect(apply).not.toHaveBeenCalled();
    expect(store[0].payload).toEqual({
      patch: { objectiveValue: 12, targetSchedule: [{ period: "2026-06", value: 11 }] },
      before: { objectiveValue: 10, targetSchedule: undefined },
    });
    const e = applyApprovedPayload({ ...store[0], status: "approved" }, data());
    expect(e.saveIndicators[0]).toMatchObject({ id: "IND1", objectiveValue: 12 });
    expect(patchDiffRows(store[0]).map((row) => [row.field, row.before, row.after])).toEqual([
      ["objectiveValue", "10", "12"],
      ["targetSchedule", "—", "1 élément(s)"],
    ]);
    // Pilote : direct.
    const pilotApply = vi.fn(async () => undefined);
    const p = await updateIndicatorTargetFlow(
      gateFor(lea).gate,
      kpi(),
      { direction: "down" },
      pilotApply
    );
    expect(p.outcome).toBe("applied");
    expect(pilotApply).toHaveBeenCalledWith({ direction: "down" });
  });
});

describe("9c. staffing (staffing_update)", () => {
  it("droits : ligne chantier → sponsor de chantier et au-dessus ; ligne projet → responsable projet et au-dessus ; comex jamais", () => {
    const axes = [axis()];
    expect(canEditStaffing(bob, chantier(), null, axes)).toBe(true);
    expect(canEditStaffing(alice, chantier(), null, axes)).toBe(true);
    expect(canEditStaffing(lea, chantier(), null, axes)).toBe(true);
    expect(canEditStaffing(carl, chantier(), null, axes)).toBe(false);
    expect(canEditStaffing(carl, chantier(), projet(), axes)).toBe(true);
    expect(canEditStaffing(cora, chantier(), projet(), axes)).toBe(false);
    expect(canEditStaffing(user("bob", "comex_member"), chantier(), null, axes)).toBe(false);
    expect(canEditStaffing(user("x", "hr"), chantier(), projet(), axes)).toBe(false);
  });
  it("chaînes (pilotage, 2 validations depuis l'auteur) et refus", async () => {
    const { gate, store } = gateFor(carl);
    const apply = vi.fn(async () => undefined);
    const created = line({ id: "CS9", actionId: "CA1" });
    expect(await staffingFlow(gate, { op: "create", line: created }, apply)).toBe("pending");
    expect(store[0]).toMatchObject({
      kind: "staffing_update",
      targetType: "projet",
      targetId: "CA1",
    });
    expect(store[0].chain?.map((s) => s.usernames)).toEqual([["bob"], ["alice"]]);
    const chantierLine = gateFor(bob);
    await staffingFlow(
      chantierLine.gate,
      { op: "update", line: line({ fte: 3 }), before: line() },
      apply
    );
    expect(chantierLine.store[0].chain?.map((s) => s.usernames)).toEqual([["alice"], ["lea"]]);
    await expect(staffingFlow(gate, { op: "delete", line: line() }, apply)).rejects.toThrow(
      ApprovalForbiddenError
    );
    expect(apply).not.toHaveBeenCalled();
    expect(await staffingFlow(gateFor(lea).gate, { op: "delete", line: line() }, apply)).toBe(
      "applied"
    );
    expect(apply).toHaveBeenCalledOnce();
  });
  it("effets : création / modification (périmée si changée) / suppression ; libellés", async () => {
    const { gate, store } = gateFor(bob);
    await staffingFlow(gate, { op: "update", line: line({ fte: 3 }), before: line() }, vi.fn());
    await staffingFlow(gate, { op: "delete", line: line(), before: line() }, vi.fn());
    const upd = { ...store[0], status: "approved" as const };
    expect(applyApprovedPayload(upd, data()).saveStaffing[0]).toMatchObject({ id: "CS1", fte: 3 });
    expect(() => applyApprovedPayload(upd, data({ staffing: [line({ fte: 5 })] }))).toThrow(
      /périmée/
    );
    const del = { ...store[1], status: "approved" as const };
    expect(applyApprovedPayload(del, data()).deleteStaffingIds).toEqual(["CS1"]);
    expect(describeApproval(upd, data())).toMatchObject({
      before: "IT · 2 ETP",
      after: "IT · 3 ETP",
    });
    expect(patchDiffRows(upd).map((r) => [r.field, r.before, r.after])).toEqual([
      ["fte", "2", "3"],
    ]);
    expect(patchDiffRows(del).map((r) => [r.field, r.after])).toEqual([
      ["function", "—"],
      ["fte", "—"],
    ]);
  });
});

describe("9d. libellés des nouveaux kinds / du palier admin", () => {
  it("clés et replis", () => {
    expect(kindLabelKey("staffing_update")).toBe("strategicApprovals.kind.staffing_update");
    expect(kindLabelKey("milestone")).toBe("validation.sa.kind.milestone");
    expect(KIND_FALLBACK.axe_create).toBe("Création d'axe");
    expect(levelLabelKey("admin")).toBe("strategicApprovals.level.admin");
    expect(LEVEL_FALLBACK.admin).toBe("Administrateur");
  });
});
