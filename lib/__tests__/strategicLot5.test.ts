import { describe, expect, it } from "vitest";
import {
  chantierDeclaredProgress,
  isMeasurementPeriodFuture,
  latestMeasurement,
  latestNumericMeasurement,
  programProgressPct,
  resolveIndicatorStatus,
} from "@/lib/axisLogic";
import { approvalChain, fallbackApprovalChain } from "@/lib/strategicHierarchy";
import { bellAlertCount, receivesBudgetOverrunAlert } from "@/lib/strategicBell";
import {
  buildApprovalAlerts,
  decisionAlertApprovalId,
  type StrategicApproval,
} from "@/lib/strategicApprovals";
import type { AuthUser, ChantierAction, Indicator, IndicatorMeasurement } from "@/types";

/**
 * Lot 5 (Plan Stratégique) — règles pures hors confidentialité des demandes (celle-ci est testée
 * sur le hook réel dans lib/hooks/__tests__/strategicProgramScope.test.tsx, section 6).
 */

describe("chaîne de validation sous confidentialité (lib/strategicHierarchy.ts)", () => {
  const ctx = {
    axis: { owner: "sponsor" },
    chantier: { pilote: "chef" },
    projet: { owner: "resp", contributors: ["contrib"] },
    pilots: ["pilote"],
  };

  it("sans restriction : inchangée (N+1 puis N+2)", () => {
    expect(approvalChain("contrib", ctx, 2)).toEqual([
      { level: "projectOwner", usernames: ["resp"] },
      { level: "chantierSponsor", usernames: ["chef"] },
    ]);
  });

  it("palier non habilité sauté vers le niveau habilité suivant", () => {
    const isCleared = (u: string) => u !== "chef";
    expect(approvalChain("contrib", ctx, 2, undefined, { isCleared, admins: ["adm"] })).toEqual([
      { level: "projectOwner", usernames: ["resp"] },
      { level: "axisSponsor", usernames: ["sponsor"] },
    ]);
  });

  it("aucun habilité au-dessus : un admin reprend le palier sauté", () => {
    const isCleared = (u: string) => u === "resp";
    expect(approvalChain("contrib", ctx, 2, undefined, { isCleared, admins: ["adm"] })).toEqual([
      { level: "projectOwner", usernames: ["resp"] },
      { level: "admin", usernames: ["adm"] },
    ]);
    // Personne d'habilité du tout → palier admin seul.
    expect(
      approvalChain("contrib", ctx, 2, undefined, { isCleared: () => false, admins: ["adm"] })
    ).toEqual([{ level: "admin", usernames: ["adm"] }]);
  });

  it("niveau simplement VIDE (personne désigné) : pas de palier admin ajouté", () => {
    const sparse = { pilots: ["pilote"], projet: { owner: "resp" } };
    expect(
      approvalChain("contrib", sparse, 2, undefined, { isCleared: () => true, admins: ["adm"] })
    ).toEqual([
      { level: "projectOwner", usernames: ["resp"] },
      { level: "pilot", usernames: ["pilote"] },
    ]);
  });

  it("repli pilote : seuls les pilotes habilités, sinon admin", () => {
    expect(fallbackApprovalChain([], "a", ["p1", "p2"], ["adm"], (u) => u === "p2")).toEqual([
      { level: "pilot", usernames: ["p2"] },
    ]);
    expect(fallbackApprovalChain([], "a", ["p1"], ["adm"], () => false)).toEqual([
      { level: "admin", usernames: ["adm"] },
    ]);
  });
});

describe("point 6 — une mesure future n'est jamais la dernière valeur", () => {
  const now = new Date(2026, 9, 3); // 3 octobre 2026 (heure locale)
  const m = (id: string, period: string, value?: number): IndicatorMeasurement => ({
    id,
    companyId: "co1",
    indicatorId: "I1",
    period,
    value,
    reportedBy: "u",
    reportedAt: `2026-10-01T0${id.length}:00:00Z`,
  });
  const measurements = [m("a", "2026-09", 50), m("b", "2026-12", 9690)];

  it("période pas encore commencée = future (mois courant et passés : non)", () => {
    expect(isMeasurementPeriodFuture("2026-12", now)).toBe(true);
    expect(isMeasurementPeriodFuture("2026-10", now)).toBe(false);
    expect(isMeasurementPeriodFuture("2026-Q4", now)).toBe(false);
    expect(isMeasurementPeriodFuture("2027", now)).toBe(true);
    expect(isMeasurementPeriodFuture("texte libre", now)).toBe(false);
  });

  it("dernière valeur (numérique ou non) : la mesure future est ignorée", () => {
    expect(latestNumericMeasurement("I1", measurements, now)?.value).toBe(50);
    expect(latestMeasurement("I1", measurements, now)?.value).toBe(50);
  });

  it("statut : calculé sur la dernière mesure NON future", () => {
    const indicator = {
      id: "I1",
      kind: "quantitative",
      objectiveValue: 100,
      direction: "up",
    } as Indicator;
    // 9 690 (2099-01, future) ferait « sur la trajectoire » ; seule compte 50 → à risque.
    const ms = [m("a", "2026-09", 50), m("b", "2099-01", 9690)];
    expect(resolveIndicatorStatus(indicator, ms)).toBe("at_risk");
  });
});

describe("point 7 — cloche : une seule alerte de décision, rien du Plan Performance", () => {
  const requester = { username: "zoe", profiles: [] } as unknown as AuthUser;
  const decided = {
    id: "SA-1",
    companyId: "co1",
    programId: "P1",
    kind: "projet_delete",
    targetType: "projet",
    targetId: "X",
    targetName: "Projet X",
    payload: { name: "Projet X" },
    requestedBy: "zoe",
    requestedAt: "2026-09-30T10:00:00Z",
    approverRole: "chantier_owner",
    approverUsernames: ["chef"],
    status: "approved",
    decidedBy: "chef",
    decidedAt: "2026-10-01T10:00:00Z",
  } as unknown as StrategicApproval;

  it("le demandeur reçoit UNE alerte de décision, reliée à sa demande", () => {
    const alerts = buildApprovalAlerts(
      [decided],
      requester,
      { axes: [], chantiers: [], chantierActions: [], indicators: [], users: [] },
      new Date("2026-10-02T10:00:00Z")
    );
    expect(alerts.map((a) => a.id)).toEqual(["strategic-approval-SA-1-decision"]);
    expect(decisionAlertApprovalId(alerts[0].id)).toBe("SA-1");
    expect(decisionAlertApprovalId("strategic-approval-SA-1-todo")).toBeUndefined();
  });

  it("nombre de la cloche : files Performance exclues en mode stratégique", () => {
    expect(bellAlertCount({ isStrategic: true, alerts: 2, performanceQueues: [3, 1, 4] })).toBe(2);
    expect(bellAlertCount({ isStrategic: false, alerts: 2, performanceQueues: [3, 1, 4] })).toBe(
      10
    );
  });
});

describe("point 8 — dépassement budgétaire : pilote, admins, sponsor du programme", () => {
  const program = { id: "P1", sponsor: "spons" };
  const user = (profiles: { role: string; programId?: string }[], extra = {}) =>
    ({ username: "u", profiles, ...extra }) as unknown as AuthUser;

  it("destinataires", () => {
    expect(
      receivesBudgetOverrunAlert(user([{ role: "strategic_lead", programId: "P1" }]), program)
    ).toBe(true);
    expect(receivesBudgetOverrunAlert(user([], { isCompanyAdmin: true }), program)).toBe(true);
    expect(
      receivesBudgetOverrunAlert(
        { ...user([{ role: "program_sponsor" }]), username: "spons" },
        program
      )
    ).toBe(true);
  });

  it("jamais les autres profils stratégiques", () => {
    for (const role of [
      "axis_sponsor",
      "chantier_owner",
      "projet_contributor",
      "hr",
      "comex_member",
    ]) {
      expect(receivesBudgetOverrunAlert(user([{ role, programId: "P1" }]), program)).toBe(false);
    }
    expect(
      receivesBudgetOverrunAlert(user([{ role: "strategic_lead", programId: "P2" }]), program)
    ).toBe(false);
    expect(receivesBudgetOverrunAlert(null, program)).toBe(false);
  });
});

describe("point 9 — avancement programme : les chantiers « Sans axe » comptent", () => {
  const progress: Record<string, number> = { p1: 80, p2: 20 };
  const progressOf = (a: ChantierAction) => progress[a.id] ?? 0;
  const actions = [
    { id: "p1", chantierId: "C1" },
    { id: "p2", chantierId: "C9" },
  ] as ChantierAction[];

  it("un groupe « Sans axe » pèse comme un axe", () => {
    const chantiers = [
      { id: "C1", axisIds: ["A"] },
      { id: "C9", axisIds: ["SUPPRIME"] }, // axe supprimé → « Sans axe »
    ];
    expect(chantierDeclaredProgress("C9", actions, progressOf)).toBe(20);
    expect(programProgressPct([{ id: "A" }], chantiers, actions, progressOf)).toBe(50);
    // Avant : C9 ignoré → 80.
    expect(programProgressPct([{ id: "A" }], [chantiers[0]], actions, progressOf)).toBe(80);
  });

  it("programme dont tous les chantiers sont sans axe : avancement défini", () => {
    expect(programProgressPct([], [{ id: "C9", axisIds: [] }], actions, progressOf)).toBe(20);
  });
});
