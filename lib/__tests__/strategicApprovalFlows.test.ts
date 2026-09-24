import { describe, it, expect, vi } from "vitest";
import {
  applyApprovedPayload,
  applyRejectedPayload,
  applyRequestSideEffects,
  buildApproval,
  needsApproval,
  nextProjetCreateApproval,
  type ApprovalEffects,
  type StrategicApproval,
  type StrategicApprovalData,
} from "@/lib/strategicApprovals";
import {
  createProjetFlow,
  deleteFlow,
  deleteKpiValueFlow,
  editKpiValueFlow,
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
    needsApproval: (kind, target, stage) => needsApproval(kind, actor, target, data, stage),
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

describe("projet create flow — double validation (chantier puis axe)", () => {
  const created = { ...projet, id: "CA-new", name: "Nouveau" };

  it("contributeur : demande palier chantier (pilote), pas de création ; refus sans effet", async () => {
    const { gate, store } = gateFor(user("carl", "chantier_contributor"));
    const create = vi.fn();
    expect(await createProjetFlow(gate, chantier, created, create)).toBe("pending");
    expect(create).not.toHaveBeenCalled();
    expect(store[0]).toMatchObject({
      kind: "projet_create",
      payload: { stage: "chantier" },
      approverUsernames: ["bob"],
    });
    expect(
      applyRejectedPayload({ ...store[0], status: "rejected" }, data).saveActions
    ).toHaveLength(0);
  });

  it("le pilote lui-même : palier chantier implicite, demande directement le palier axe", async () => {
    const { gate, store } = gateFor(user("bob", "chantier_owner"));
    const create = vi.fn();
    expect(await createProjetFlow(gate, chantier, created, create)).toBe("pending");
    expect(create).not.toHaveBeenCalled();
    expect(store[0]).toMatchObject({
      kind: "projet_create",
      payload: { stage: "axis" },
      approverUsernames: ["alice"],
    });
    // Palier terminal : l'approbation crée réellement le projet.
    expect(
      applyApprovedPayload({ ...store[0], status: "approved" }, data).saveActions[0]
    ).toMatchObject({ id: "CA-new" });
  });

  it("responsable de l'axe (≠ pilote) : doit quand même demander le palier chantier au pilote", async () => {
    const { gate, store } = gateFor(user("alice", "axis_sponsor"));
    const create = vi.fn(async () => undefined);
    expect(await createProjetFlow(gate, chantier, created, create)).toBe("pending");
    expect(create).not.toHaveBeenCalled();
    expect(store[0]).toMatchObject({ payload: { stage: "chantier" }, approverUsernames: ["bob"] });
  });

  it("admin/strategic_lead : les deux paliers sont déjà satisfaits, création immédiate", async () => {
    const { gate, store } = gateFor(user("lea", "strategic_lead"));
    const create = vi.fn(async () => undefined);
    expect(await createProjetFlow(gate, chantier, created, create)).toBe("applied");
    expect(create).toHaveBeenCalledOnce();
    expect(store).toHaveLength(0);
  });

  it("chantier sans pilote : un seul palier (axe), comme l'ancien schéma", async () => {
    const noPilote = { ...chantier, pilote: undefined } as unknown as Chantier;
    const d = { ...data, chantiers: [noPilote] };
    const gateForData = (actor: AuthUser) => {
      const store: StrategicApproval[] = [];
      const g: ApprovalGate = {
        needsApproval: (kind, target, stage) => needsApproval(kind, actor, target, d, stage),
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
      return { gate: g, store };
    };
    const { gate, store } = gateForData(user("carl", "chantier_contributor"));
    const create = vi.fn();
    expect(await createProjetFlow(gate, noPilote, created, create)).toBe("pending");
    expect(store).toHaveLength(1);
    expect(store[0].payload).toMatchObject({ stage: "axis" });
    expect(
      applyApprovedPayload({ ...store[0], status: "approved" }, d).saveActions[0]
    ).toMatchObject({ id: "CA-new" });
  });

  it("chaîne complète : le pilote valide, ça enchaîne sur l'axe, puis l'axe valide -> création", async () => {
    const { gate, store } = gateFor(user("carl", "chantier_contributor"));
    const create = vi.fn();
    expect(await createProjetFlow(gate, chantier, created, create)).toBe("pending");
    const stage1 = { ...store[0], status: "approved" as const, decidedBy: "bob" };
    // Le palier "chantier" approuvé ne crée rien...
    expect(applyApprovedPayload(stage1, data).saveActions).toHaveLength(0);
    // ...mais enchaîne sur une 2e demande, palier "axis", vers le responsable de l'axe.
    const stage2 = nextProjetCreateApproval(stage1, data);
    expect(stage2).toMatchObject({
      kind: "projet_create",
      payload: { stage: "axis" },
      approverUsernames: ["alice"],
      requestedBy: "carl",
    });
    // Ce n'est qu'à l'approbation de CE palier que le projet est réellement créé.
    expect(
      applyApprovedPayload({ ...stage2!, status: "approved", decidedBy: "alice" }, data)
        .saveActions[0]
    ).toMatchObject({ id: "CA-new" });
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
    // Check-list E0 complète : l'approbation RE-VÉRIFIE la porte (E0-A1 auto = 100, pas d'alerte).
    const ready = {
      ...projet,
      milestones: {
        currentMilestone: "E0",
        passedMilestones: [],
        checklists: {
          E0: ["E0-A2", "E0-B1", "E0-B2", "E0-C1"].map((itemId) => ({ itemId, progressPct: 100 })),
        },
      },
    } as ChantierAction;
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

describe("KPI value correction / deletion flow", () => {
  const measurement = {
    id: "IM1",
    companyId: "c",
    indicatorId: "IND1",
    period: "2026-03",
    value: 7,
    note: "orig",
    reportedBy: "carl",
    reportedAt: "2026-03-01T00:00:00Z",
  };
  const other = { ...measurement, id: "IM2", period: "2026-04", value: 12, note: undefined };
  const dataWithMeasures: StrategicApprovalData = { ...data, measurements: [measurement, other] };

  it("approbateur : correction et suppression directes", async () => {
    const { gate, store } = gateFor(user("lea", "strategic_lead"));
    const update = vi.fn(async () => undefined);
    const del = vi.fn(async () => undefined);
    expect(await editKpiValueFlow(gate, kpi, measurement, { value: 8 }, update)).toBe("applied");
    expect(update).toHaveBeenCalledWith("IM1", { value: 8 });
    expect(await deleteKpiValueFlow(gate, kpi, measurement, del)).toBe("applied");
    expect(del).toHaveBeenCalledWith("IM1");
    expect(store).toHaveLength(0);
  });

  it("non-approbateur : correction soumise (measurementId), rien d'écrit", async () => {
    const { gate, store } = gateFor(user("carl", "chantier_contributor"));
    const update = vi.fn();
    expect(await editKpiValueFlow(gate, kpi, measurement, { value: 9, note: null }, update)).toBe(
      "pending"
    );
    expect(update).not.toHaveBeenCalled();
    expect(store[0].payload).toEqual({ period: "2026-03", value: 9, measurementId: "IM1" });
  });

  it("approbation d'une correction : même doc réécrit, saisie d'origine conservée", async () => {
    const { gate, store } = gateFor(user("carl", "chantier_contributor"));
    await editKpiValueFlow(gate, kpi, measurement, { value: 11, period: "2026-02" }, vi.fn());
    const decided = { ...store[0], status: "approved" as const, decidedAt: "2026-05-01T00:00:00Z" };
    const e = applyApprovedPayload(decided, dataWithMeasures);
    expect(e.saveMeasurements).toEqual([
      {
        ...measurement,
        period: "2026-02",
        value: 11,
        updatedBy: "carl",
        updatedAt: "2026-05-01T00:00:00Z",
      },
    ]);
    expect(e.deleteMeasurementIds).toEqual([]);
  });

  it("approbation d'une correction vers une période déjà prise : demande périmée", async () => {
    const { gate, store } = gateFor(user("carl", "chantier_contributor"));
    await editKpiValueFlow(gate, kpi, measurement, { period: "2026-04" }, vi.fn());
    const decided = { ...store[0], status: "approved" as const };
    expect(() => applyApprovedPayload(decided, dataWithMeasures)).toThrow(/2026-04/);
  });

  it("approbation d'une suppression : mesure supprimée + statut recalculé", async () => {
    const { gate, store } = gateFor(user("carl", "chantier_contributor"));
    // Dernière mesure 12 >= cible 10 → on_track ; sans elle, 7 < 10 → at_risk.
    expect(await deleteKpiValueFlow(gate, kpi, other, vi.fn())).toBe("pending");
    expect(store[0].payload).toMatchObject({ measurementId: "IM2", remove: true });
    const decided = { ...store[0], status: "approved" as const, decidedAt: "2026-05-01T00:00:00Z" };
    const e = applyApprovedPayload(decided, dataWithMeasures);
    expect(e.deleteMeasurementIds).toEqual(["IM2"]);
    expect(e.saveMeasurements).toEqual([]);
    expect(e.saveIndicators[0]).toMatchObject({ id: "IND1", status: "at_risk" });
  });
});
