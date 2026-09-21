import { describe, it, expect, vi } from "vitest";
import {
  applyApprovedPayload,
  applyRejectedPayload,
  applyRequestSideEffects,
  buildApproval,
  needsApproval,
  type ApprovalEffects,
  type StrategicApproval,
  type StrategicApprovalData,
} from "@/lib/strategicApprovals";
import {
  createProjetFlow,
  deleteFlow,
  milestoneFlow,
  pendingApprovals,
  submitKpiValueFlow,
  type ApprovalGate,
} from "@/lib/strategicApprovalFlows";
import type { AuthUser, Chantier, ChantierAction, Indicator, StrategicAxis } from "@/types";

const user = (username: string, role?: string, extra: Partial<AuthUser> = {}) =>
  ({
    username,
    name: username.toUpperCase(),
    profiles: role ? [{ role, track: "strategic", programId: "P1" }] : [],
    ...extra,
  }) as unknown as AuthUser;
const axis = {
  id: "AX1",
  companyId: "c",
  programId: "P1",
  name: "Axe",
  stage: "s",
  owner: "alice",
} as StrategicAxis;
const chantier = {
  id: "CH1",
  companyId: "c",
  programId: "P1",
  axisIds: ["AX1"],
  name: "Chantier",
  stage: "s",
  dependencies: [],
  pilote: "bob",
} as unknown as Chantier;
const projet = {
  id: "CA1",
  companyId: "c",
  chantierId: "CH1",
  name: "Projet",
  start: "2026-01-01",
  end: "2026-06-01",
  status: "s",
  owner: "carl",
} as ChantierAction;
const kpi = {
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
  responsibleRoles: [],
  status: "on_track",
  createdAt: "",
  lastUpdate: "",
} as Indicator;
const users = [
  user("lea", "strategic_lead"),
  user("alice", "axis_sponsor"),
  user("bob", "chantier_owner"),
  user("carl", "chantier_contributor"),
];
const data: StrategicApprovalData = {
  programId: "P1",
  axes: [axis],
  chantiers: [chantier],
  chantierActions: [projet],
  indicators: [kpi],
  measurements: [],
  users,
};

function gateFor(actor: AuthUser) {
  const store: StrategicApproval[] = [];
  const effects: ApprovalEffects[] = [];
  const gate: ApprovalGate = {
    needsApproval: (kind, target) => needsApproval(kind, actor, target, data),
    request: async (kind, target, payload, reason) => {
      const a = buildApproval({
        kind,
        target,
        payload,
        reason,
        companyId: "c",
        programId: "P1",
        requester: actor,
        data,
      });
      store.push(a);
      effects.push(applyRequestSideEffects(a, data));
      return a;
    },
  };
  return { gate, store, effects };
}

describe("KPI value flow", () => {
  const input = {
    indicatorId: "IND1",
    period: "2026-03",
    reportedBy: "carl",
    value: 7,
    note: " ok ",
  };
  it("non-approbateur : demande kpi_value, aucune mesure publiée", async () => {
    const { gate, store } = gateFor(user("carl", "chantier_contributor"));
    const add = vi.fn();
    expect(await submitKpiValueFlow(gate, kpi, input, add)).toBe("pending");
    expect(add).not.toHaveBeenCalled();
    expect(store[0]).toMatchObject({
      kind: "kpi_value",
      targetId: "IND1",
      payload: { period: "2026-03", value: 7, note: "ok" },
    });
    expect(pendingApprovals(store, "kpi_value", "IND1")).toHaveLength(1);
  });
  it("approbateur (strategic_lead) : publication directe", async () => {
    const { gate, store } = gateFor(user("lea", "strategic_lead"));
    const add = vi.fn(async () => undefined);
    expect(await submitKpiValueFlow(gate, kpi, input, add)).toBe("applied");
    expect(add).toHaveBeenCalledOnce();
    expect(store).toHaveLength(0);
  });
  it("approbation publie la mesure, refus sans effet", async () => {
    const { gate, store } = gateFor(user("carl"));
    await submitKpiValueFlow(gate, kpi, input, vi.fn());
    const decided = { ...store[0], status: "approved" as const, decidedAt: "2026-03-02T00:00:00Z" };
    expect(applyApprovedPayload(decided, data).saveMeasurements).toHaveLength(1);
    const rej = applyRejectedPayload({ ...decided, status: "rejected" }, data);
    expect(rej.saveMeasurements).toHaveLength(0);
    expect(rej.saveActions).toHaveLength(0);
  });
  it("sans porte (hors contexte stratégique) : écriture directe", async () => {
    const add = vi.fn(async () => undefined);
    expect(await submitKpiValueFlow(null, kpi, input, add)).toBe("applied");
    expect(add).toHaveBeenCalledOnce();
  });
});

describe("delete flow", () => {
  it("chantier : demande chantier_delete avec motif, pas de suppression ; approbation supprime chantier + projets", async () => {
    const { gate, store } = gateFor(user("carl"));
    const del = vi.fn();
    expect(await deleteFlow(gate, "chantier", chantier, " doublon ", del)).toBe("pending");
    expect(del).not.toHaveBeenCalled();
    expect(store[0]).toMatchObject({ kind: "chantier_delete", reason: "doublon" });
    const ok = applyApprovedPayload({ ...store[0], status: "approved" }, data);
    expect(ok.deleteChantierIds).toEqual(["CH1"]);
    expect(ok.deleteActionIds).toEqual(["CA1"]);
    const ko = applyRejectedPayload({ ...store[0], status: "rejected" }, data);
    expect(ko.deleteChantierIds).toHaveLength(0);
    expect(ko.deleteActionIds).toHaveLength(0);
  });
  it("projet : approbateur (pilote) supprime directement", async () => {
    const { gate, store } = gateFor(user("bob", "chantier_owner"));
    const del = vi.fn(async () => undefined);
    expect(await deleteFlow(gate, "projet", projet, "x", del)).toBe("applied");
    expect(del).toHaveBeenCalledOnce();
    expect(store).toHaveLength(0);
  });
  it("projet : non-approbateur -> projet_delete en attente", async () => {
    const { gate, store } = gateFor(user("carl"));
    expect(await deleteFlow(gate, "projet", projet, "x", vi.fn())).toBe("pending");
    expect(store[0].kind).toBe("projet_delete");
    expect(applyApprovedPayload({ ...store[0], status: "approved" }, data).deleteActionIds).toEqual(
      ["CA1"]
    );
  });
});

describe("projet create flow", () => {
  const created = { ...projet, id: "CA-new", name: "Nouveau" };
  it("responsable de chantier : demande projet_create, pas de création ; approbation sauvegarde l'action ; refus sans effet", async () => {
    const { gate, store } = gateFor(user("bob", "chantier_owner"));
    const create = vi.fn();
    expect(await createProjetFlow(gate, chantier, created, create)).toBe("pending");
    expect(create).not.toHaveBeenCalled();
    expect(store[0].kind).toBe("projet_create");
    expect(
      applyApprovedPayload({ ...store[0], status: "approved" }, data).saveActions[0]
    ).toMatchObject({ id: "CA-new" });
    expect(
      applyRejectedPayload({ ...store[0], status: "rejected" }, data).saveActions
    ).toHaveLength(0);
  });
  it("responsable de l'axe : création directe", async () => {
    const { gate } = gateFor(user("alice", "axis_sponsor"));
    const create = vi.fn(async () => undefined);
    expect(await createProjetFlow(gate, chantier, created, create)).toBe("applied");
    expect(create).toHaveBeenCalledOnce();
  });
});

describe("milestone flow", () => {
  const owner = user("carl", "chantier_contributor");
  const ready = {
    ...projet,
    milestones: { currentMilestone: "E0", passedMilestones: [], checklists: {} },
  } as ChantierAction;
  it("sans porte : flux historique", async () => {
    expect(await milestoneFlow(null, ready, owner, [chantier], [ready])).toBe("applied");
  });
  it("prérequis non remplis : lève (aucune demande)", async () => {
    const { gate, store } = gateFor(owner);
    await expect(milestoneFlow(gate, ready, owner, [chantier], [ready])).rejects.toThrow();
    expect(store).toHaveLength(0);
  });
  it("demande milestone : marqueur en attente posé, refus le retire", () => {
    const { gate } = gateFor(owner);
    void gate;
    const a = buildApproval({
      kind: "milestone",
      target: { type: "projet", id: "CA1", name: "Projet" },
      payload: { targetMilestone: "E1", fromMilestone: "E0" },
      companyId: "c",
      programId: "P1",
      requester: owner,
      data: { ...data, chantierActions: [ready] },
    });
    const d = { ...data, chantierActions: [ready] };
    const side = applyRequestSideEffects(a, d);
    expect(side.saveActions[0].milestoneApproval?.targetMilestone).toBe("E1");
    const pendingAction = side.saveActions[0];
    const dp = { ...data, chantierActions: [pendingAction] };
    expect(
      applyRejectedPayload({ ...a, status: "rejected" }, dp).saveActions[0].milestoneApproval
    ).toBeUndefined();
    expect(
      applyApprovedPayload({ ...a, status: "approved" }, dp).saveActions[0].milestones
        ?.currentMilestone
    ).toBe("E1");
  });
});
