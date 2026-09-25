import { describe, it, expect, vi } from "vitest";
import {
  kpiCorrectionApprover,
  kpiCorrectionDecisionInformees,
  kpiResponsibles,
  routeKpiCorrection,
} from "@/lib/kpiCorrectionRouting";
import {
  bucketApprovals,
  buildApproval,
  buildApprovalAlerts,
  buildDirectKpiCorrectionRecord,
  canDecide,
  kpiCorrectionNoticeText,
  resolveApprover,
  type StrategicApproval,
  type StrategicApprovalData,
} from "@/lib/strategicApprovals";
import {
  deleteKpiValueFlow,
  editKpiValueFlow,
  type ApprovalGate,
} from "@/lib/strategicApprovalFlows";
import type { Alert, AuthUser, Chantier, ChantierAction, Indicator, StrategicAxis } from "@/types";
import { alertDesc } from "@/lib/alertText";
import { translate } from "@/lib/i18n/useTranslation";

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
    name: "Axe 1",
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
    name: "Chantier 1",
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
    chantierId: "CH1",
    name: "KPI",
    kind: "quantitative",
    frequency: "monthly",
    objective: "10",
    objectiveValue: 10,
    direction: "up",
    unit: "%",
    responsibleRoles: ["cto"],
    status: "on_track",
    createdAt: "",
    lastUpdate: "",
    ...o,
  }) as Indicator;

const lea = user("lea", "strategic_lead");
const alice = user("alice", "axis_sponsor");
const bob = user("bob", "chantier_owner");
const carl = user("carl", "chantier_contributor");
const cto = user("cyd", "cto");
const nobody = user("zed", "chantier_contributor");
const admin = user("root", undefined, undefined, { isCompanyAdmin: true });
const users = [lea, alice, bob, carl, cto, nobody];

function data(o: Partial<StrategicApprovalData> = {}): StrategicApprovalData {
  return {
    programId: "P1",
    axes: [axis()],
    chantiers: [chantier()],
    chantierActions: [action()],
    indicators: [indicator()],
    measurements: [
      {
        id: "IM1",
        companyId: "c",
        indicatorId: "IND1",
        period: "2026-03",
        value: 5,
        reportedBy: "carl",
        reportedAt: "2026-03-05T10:00:00.000Z",
      },
    ],
    users,
    ...o,
  };
}

describe("kpiResponsibles", () => {
  it("chantier = indicator.chantierId + chantiers des projets liés (indicatorId), dédoublonnés", () => {
    const d = data({
      axes: [axis(), axis({ id: "AX2", owner: "dora", name: "Axe 2" })],
      chantiers: [chantier(), chantier({ id: "CH2", axisIds: ["AX2"], pilote: "eve" })],
      chantierActions: [
        action(),
        action({ id: "CA2", chantierId: "CH2", owner: "finn", indicatorId: "IND1" }),
      ],
    });
    const r = kpiResponsibles(indicator(), d);
    expect(r.chantiers.map((c) => c.id)).toEqual(["CH1", "CH2"]);
    expect(r.chantierPilotes).toEqual(["bob", "eve"]);
    expect(r.axisOwners).toEqual(["alice", "dora"]);
    expect(r.planLeads).toEqual(["lea"]);
    expect(r.projetOwners).toEqual(["carl", "finn"]);
  });
  it("responsables manquants ignorés (pas de pilote, pas d'owner d'axe, chantier inconnu)", () => {
    const d = data({
      axes: [axis({ owner: undefined })],
      chantiers: [chantier({ pilote: undefined })],
    });
    const r = kpiResponsibles(indicator({ chantierId: "GONE" }), d);
    expect(r.chantiers).toEqual([]);
    expect(r.chantierPilotes).toEqual([]);
    expect(r.axisOwners).toEqual([]);
  });
});

describe("routeKpiCorrection — règle PO : 2 validations (sponsor d'axe puis pilote)", () => {
  const chainOf = (r: ReturnType<typeof routeKpiCorrection>) =>
    r.mode === "request" ? r.chain.map((st) => [st.level, st.usernames]) : [];
  it("responsable de projet : DEMANDE, sponsor d'axe puis pilote (plancher sponsor de chantier)", () => {
    const r = routeKpiCorrection(carl, indicator(), data());
    expect(r).toMatchObject({
      mode: "request",
      level: "projet",
      approver: { level: "axis", usernames: ["alice"], entityNames: ["Axe 1"] },
      informOnApproval: [],
      informLevels: [],
    });
    expect(chainOf(r)).toEqual([
      ["axisSponsor", ["alice"]],
      ["pilot", ["lea"]],
    ]);
  });
  it("sponsor de chantier : ne corrige plus seul — même chaîne", () => {
    const r = routeKpiCorrection(bob, indicator(), data());
    expect(r.mode).toBe("request");
    expect(chainOf(r)).toEqual([
      ["axisSponsor", ["alice"]],
      ["pilot", ["lea"]],
    ]);
  });
  it("sponsor d'axe : validé par le pilote seul (KPI de chantier ET KPI macro de l'axe)", () => {
    const r = routeKpiCorrection(alice, indicator(), data());
    expect(r).toMatchObject({
      mode: "request",
      level: "axis",
      approver: { level: "plan", usernames: ["lea"], entityNames: [] },
    });
    const macro = indicator({ chantierId: undefined });
    expect(chainOf(routeKpiCorrection(alice, macro, data({ indicators: [macro] })))).toEqual([
      ["pilot", ["lea"]],
    ]);
  });
  it("pilote du plan / admin : DIRECTE, personne d'informé", () => {
    expect(routeKpiCorrection(lea, indicator(), data())).toEqual({
      mode: "direct",
      level: "plan",
      inform: [],
      informLevels: [],
    });
    expect(routeKpiCorrection(admin, indicator(), data())).toMatchObject({
      mode: "direct",
      inform: [],
    });
  });
  it("strategic_lead d'un AUTRE programme : pas responsable du plan de ce KPI", () => {
    const other = user("olga", "strategic_lead", "P2");
    expect(routeKpiCorrection(other, indicator(), data()).mode).toBe("forbidden");
  });
  it("saisisseur autorisé sans responsabilité (rôle de l'indicateur) : même chaîne", () => {
    const r = routeKpiCorrection(cto, indicator(), data());
    expect(r).toMatchObject({ mode: "request", level: "none", approver: { usernames: ["alice"] } });
  });
  it("aucun droit : interdit ; pas d'utilisateur : interdit", () => {
    expect(routeKpiCorrection(nobody, indicator(), data()).mode).toBe("forbidden");
    expect(routeKpiCorrection(null, indicator(), data()).mode).toBe("forbidden");
  });
  it("cumul : pilote de chantier ET sponsor d'axe → niveau le plus haut (axe) → pilote seul", () => {
    const d = data({ chantiers: [chantier({ pilote: "alice" })] });
    const r = routeKpiCorrection(alice, indicator(), d);
    expect(r.level).toBe("axis");
    expect(chainOf(r)).toEqual([["pilot", ["lea"]]]);
  });
  it("une même personne ne valide jamais deux paliers (lead = sponsor d'axe) : un seul palier", () => {
    const d = data({ axes: [axis({ owner: "lea" })] });
    expect(chainOf(routeKpiCorrection(bob, indicator(), d))).toEqual([["axisSponsor", ["lea"]]]);
  });
  it("KPI lié à un 2e axe via le chantier du demandeur : les deux sponsors peuvent valider le palier axe", () => {
    const d = data({
      axes: [axis(), axis({ id: "AX2", owner: "dora", name: "Axe 2" })],
      chantiers: [
        chantier(),
        chantier({ id: "CH2", axisIds: ["AX2"], pilote: "eve", name: "Chantier 2" }),
      ],
      chantierActions: [
        action(),
        action({ id: "CA2", chantierId: "CH2", owner: "finn", indicatorId: "IND1" }),
      ],
    });
    const finn = user("finn", "chantier_contributor");
    expect(routeKpiCorrection(finn, indicator(), d)).toMatchObject({
      mode: "request",
      approver: { level: "axis", usernames: ["alice", "dora"], entityNames: ["Axe 1", "Axe 2"] },
    });
  });
  it("niveaux vides sautés : sans sponsor d'axe → pilote seul", () => {
    const d = data({ axes: [axis({ owner: undefined })] });
    expect(chainOf(routeKpiCorrection(carl, indicator(), d))).toEqual([["pilot", ["lea"]]]);
    // Legacy (demandes sans chaîne) : repli historique inchangé.
    const d2 = data({
      chantiers: [chantier({ pilote: undefined })],
      axes: [axis({ owner: undefined })],
    });
    expect(kpiCorrectionApprover(indicator(), d2, "carl")).toEqual({
      level: "plan",
      usernames: ["lea"],
      entityNames: [],
    });
  });
});

describe("kpiCorrectionDecisionInformees", () => {
  it("acceptation par le pilote : axe + plan, jamais décideur ni demandeur", () => {
    expect(kpiCorrectionDecisionInformees(bob, "carl", indicator(), data())).toEqual([
      "alice",
      "lea",
    ]);
    expect(kpiCorrectionDecisionInformees(alice, "carl", indicator(), data())).toEqual(["lea"]);
    expect(kpiCorrectionDecisionInformees(lea, "carl", indicator(), data())).toEqual(["alice"]);
  });
});

const correctionPayload = {
  period: "2026-03",
  value: 7,
  measurementId: "IM1",
  previousPeriod: "2026-03",
  previousValue: 5,
};

describe("demande de correction (strategicApprovals)", () => {
  const req = () =>
    buildApproval({
      kind: "kpi_value",
      target: { type: "indicateur", id: "IND1", name: "KPI" },
      payload: correctionPayload,
      companyId: "c",
      programId: "P1",
      requester: carl,
      data: data(),
      id: "SA1",
      now: "2026-03-10T10:00:00.000Z",
    });
  it("chaîne snapshotée : sponsor d'axe puis pilote (resolveApprover legacy inchangé)", () => {
    expect(req()).toMatchObject({
      approverRole: "axis_sponsor",
      approverUsernames: ["alice"],
      stepIndex: 0,
    });
    expect(req().chain?.map((st) => st.usernames)).toEqual([["alice"], ["lea"]]);
    expect(resolveApprover("kpi_value", { type: "indicateur", id: "IND1" }, data()).role).toBe(
      "strategic_lead"
    );
  });
  it("étape 1 : le sponsor d'axe seul (ni pilote de chantier, ni pilote du plan, ni demandeur)", () => {
    const a = req();
    expect(canDecide(alice, a, data())).toBe(true);
    expect(canDecide(bob, a, data())).toBe(false);
    expect(canDecide(lea, a, data())).toBe(false);
    expect(canDecide(carl, a, data())).toBe(false);
    const alerts = buildApprovalAlerts([a], alice, data(), new Date("2026-03-11"));
    expect(alerts.map((x) => x.id)).toEqual(["strategic-approval-SA1-todo"]);
  });
  it("acceptée : informés alertés (texte ancienne → nouvelle), pas le décideur ni le demandeur", () => {
    const decided: StrategicApproval = {
      ...req(),
      status: "approved",
      decidedBy: "bob",
      decidedByName: "BOB",
      decidedAt: "2026-03-11T10:00:00.000Z",
      informUsernames: ["alice", "lea"],
    };
    const now = new Date("2026-03-12");
    const aliceAlerts = buildApprovalAlerts([decided], alice, data(), now);
    expect(aliceAlerts).toHaveLength(1);
    expect(aliceAlerts[0]).toMatchObject({ id: "strategic-approval-SA1-info", type: "blue" });
    expect(aliceAlerts[0].desc).toBe(
      "Valeur KPI corrigée : KPI 2026-03 5 % → 7 % par BOB (demandé par CARL)."
    );
    expect(buildApprovalAlerts([decided], bob, data(), now).map((x) => x.id)).toEqual([
      "strategic-approval-SA1-decided",
    ]);
    expect(buildApprovalAlerts([decided], carl, data(), now).map((x) => x.id)).toEqual([
      "strategic-approval-SA1-decision",
    ]);
    expect(bucketApprovals([decided], alice, data()).history).toHaveLength(1);
  });
});

describe("enregistrement d'information (correction directe)", () => {
  const rec = () =>
    buildDirectKpiCorrectionRecord({
      target: { type: "indicateur", id: "IND1", name: "KPI" },
      payload: correctionPayload,
      informUsernames: ["alice", "lea", "bob"],
      companyId: "c",
      programId: "P1",
      actor: bob,
      data: data(),
      id: "SA9",
      now: "2026-03-11T10:00:00.000Z",
    });
  it("déjà approuvé, direct, sans l'acteur parmi les informés", () => {
    expect(rec()).toMatchObject({
      status: "approved",
      direct: true,
      decidedBy: "bob",
      requestedBy: "bob",
      informUsernames: ["alice", "lea"],
    });
  });
  it("alerte d'information uniquement pour les informés ; rien pour l'acteur ; hors « Mes demandes »", () => {
    const now = new Date("2026-03-12");
    expect(buildApprovalAlerts([rec()], lea, data(), now)[0].desc).toBe(
      "Valeur KPI corrigée : KPI 2026-03 5 % → 7 % par BOB."
    );
    expect(buildApprovalAlerts([rec()], bob, data(), now)).toEqual([]);
    expect(buildApprovalAlerts([rec()], carl, data(), now)).toEqual([]);
    expect(bucketApprovals([rec()], bob, data()).mine).toEqual([]);
  });
  it("texte de suppression", () => {
    const a = {
      ...rec(),
      payload: {
        period: "2026-03",
        measurementId: "IM1",
        remove: true,
        value: 5,
        previousPeriod: "2026-03",
        previousValue: 5,
      },
    };
    const notice = kpiCorrectionNoticeText(a, data());
    expect(notice).toMatchObject({
      title: "Mesure KPI supprimée · KPI",
      desc: "Mesure KPI supprimée : KPI 2026-03 5 % par BOB.",
    });
    // Réaffiché dans la langue active via les clés i18n (lib/alertText.ts).
    const alert = { ...notice, i18n: notice.i18n } as unknown as Alert;
    const tEn = (key: string, fallback?: string) => translate("en", key, fallback);
    expect(alertDesc(tEn, alert)).toBe("KPI measurement deleted: KPI 2026-03 5 % by BOB.");
    const tFr = (key: string, fallback?: string) => translate("fr", key, fallback);
    expect(alertDesc(tFr, alert)).toBe(notice.desc);
  });
});

describe("flux edit/delete avec routage", () => {
  const m = { id: "IM1", period: "2026-03", value: 5 };
  const gate = () => {
    const g = {
      needsApproval: vi.fn(() => true),
      request: vi.fn(async () => ({}) as StrategicApproval),
      notifyKpiCorrection: vi.fn(async () => undefined),
    };
    return g as typeof g & ApprovalGate;
  };
  it("route directe avec informés : applique puis informe (ancienne valeur dans le payload)", async () => {
    const g = gate();
    const update = vi.fn(async () => undefined);
    // Route directe « avec information » construite à la main (plus produite par la règle en
    // vigueur, mais le flux sait toujours la traiter).
    const route = {
      mode: "direct" as const,
      level: "chantier" as const,
      inform: ["alice", "lea"],
      informLevels: ["axis" as const, "plan" as const],
    };
    const out = await editKpiValueFlow(
      g,
      { id: "IND1", name: "KPI" },
      m,
      { value: 7 },
      update,
      route
    );
    expect(out).toBe("applied");
    expect(update).toHaveBeenCalledWith("IM1", { value: 7 });
    expect(g.request).not.toHaveBeenCalled();
    expect(g.notifyKpiCorrection).toHaveBeenCalledWith(
      { type: "indicateur", id: "IND1", name: "KPI" },
      {
        period: "2026-03",
        value: 7,
        measurementId: "IM1",
        previousPeriod: "2026-03",
        previousValue: 5,
      },
      ["alice", "lea"]
    );
  });
  it("directe par le plan : aucune notification", async () => {
    const g = gate();
    const route = routeKpiCorrection(lea, indicator(), data());
    await deleteKpiValueFlow(
      g,
      { id: "IND1", name: "KPI" },
      m,
      vi.fn(async () => undefined),
      route
    );
    expect(g.notifyKpiCorrection).not.toHaveBeenCalled();
  });
  it("demande : rien d'écrit, demande kpi_value avec measurementId + valeurs précédentes", async () => {
    const g = gate();
    const update = vi.fn(async () => undefined);
    const route = routeKpiCorrection(carl, indicator(), data());
    const out = await editKpiValueFlow(
      g,
      { id: "IND1", name: "KPI" },
      m,
      { value: 7 },
      update,
      route
    );
    expect(out).toBe("pending");
    expect(update).not.toHaveBeenCalled();
    expect(g.request).toHaveBeenCalledWith(
      "kpi_value",
      { type: "indicateur", id: "IND1", name: "KPI" },
      {
        period: "2026-03",
        value: 7,
        measurementId: "IM1",
        previousPeriod: "2026-03",
        previousValue: 5,
      }
    );
  });
  it("interdit : lève, rien d'écrit", async () => {
    const g = gate();
    const del = vi.fn(async () => undefined);
    const route = routeKpiCorrection(nobody, indicator(), data());
    await expect(
      deleteKpiValueFlow(g, { id: "IND1", name: "KPI" }, m, del, route)
    ).rejects.toThrow();
    expect(del).not.toHaveBeenCalled();
  });
  it("échec de notification : la correction reste appliquée", async () => {
    const g = gate();
    g.notifyKpiCorrection.mockRejectedValueOnce(new Error("offline"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const route = {
      mode: "direct" as const,
      level: "chantier" as const,
      inform: ["alice"],
      informLevels: ["axis" as const],
    };
    await expect(
      editKpiValueFlow(
        g,
        { id: "IND1", name: "KPI" },
        m,
        { value: 7 },
        vi.fn(async () => undefined),
        route
      )
    ).resolves.toBe("applied");
    spy.mockRestore();
  });
});
