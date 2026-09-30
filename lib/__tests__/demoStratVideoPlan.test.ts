import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import {
  approvalStepInfo,
  bucketApprovals,
  computeApprovalChain,
  currentStep,
  type StrategicApproval,
  type StrategicApprovalData,
} from "@/lib/strategicApprovals";
import { canFillIndicator } from "@/lib/axisLogic";
import { chantierDependencyOverview } from "@/lib/chantierDependencyOverview";
import { staffingOverruns } from "@/lib/staffingAlerts";
import { fteByDepartment } from "@/lib/workforceLogic";
import { resolveConfidentialityClearance } from "@/lib/leversLogic";
import { isChantierVisibleForClearance } from "@/lib/strategicConfidentiality";
import { buildMyWorkspace } from "@/lib/myWorkspace";
import type {
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierStaffing,
  Company,
  Employee,
  Indicator,
  IndicatorMeasurement,
  StrategicAxis,
} from "@/types";

/**
 * Planificateur de la vidéo de démo Plan Stratégique (scripts/lib/demoStratVideoPlan.js, CJS
 * pur). Les documents produits sont vérifiés avec les VRAIES fonctions de l'app (chaîne de
 * validation, Mon espace, carte Dépendances, alertes de sur-staffing, confidentialité).
 */
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const plan = require("../../scripts/lib/demoStratVideoPlan.js");

const P = "p-strat-demo-2026";
const NOW = "2026-09-30T08:00:00.000Z";
const TODAY = "2026-09-30";

const user = (username: string, extra: Partial<AuthUser> = {}, ...roles: string[]) =>
  ({
    docId: `${username}.c1`,
    username,
    name: username.toUpperCase(),
    companyId: "c1",
    profiles: roles.map((role) => ({ role, programId: P })),
    ...extra,
  }) as unknown as AuthUser & { docId: string };

type Snapshot = {
  program: { id: string } | null;
  company: Company | null;
  users: AuthUser[];
  axes: StrategicAxis[];
  chantiers: Chantier[];
  chantierActions: ChantierAction[];
  indicators: Indicator[];
  measurements: IndicatorMeasurement[];
  staffing: ChantierStaffing[];
  employees: Employee[];
  approvals: StrategicApproval[];
  backup: unknown;
};

function fixture(): Snapshot {
  const axis = (id: string, name: string) =>
    ({ id, companyId: "c1", programId: P, name, owner: "a.sponsor", stage: "s1" }) as StrategicAxis;
  const chantier = (id: string, name: string, axisId: string) =>
    ({
      id,
      companyId: "c1",
      programId: P,
      axisIds: [axisId],
      name,
      stage: "s1",
      dependencies: [],
      pilote: "c.sponsor",
    }) as unknown as Chantier;
  const projet = (id: string, name: string) =>
    ({
      id,
      companyId: "c1",
      chantierId: "ch-supply",
      name,
      owner: "p.owner",
      contributors: [],
      start: "2026-06-01",
      end: "2026-12-15",
      status: "in_progress",
      budget: 200000,
    }) as ChantierAction;
  const emp = (id: string, department: string) =>
    ({ id, name: id, department, fte: 1 }) as unknown as Employee;
  return {
    program: { id: P },
    company: {
      id: "c1",
      name: "Acme Corp",
      confidentialityLevels: ["Public", "Restreint"],
      roleClearance: { axis_sponsor: "Restreint" },
    } as unknown as Company,
    users: [
      user("test.cto", { confidentialityClearance: "all" }, "strategic_lead"),
      user("a.sponsor", {}, "axis_sponsor"),
      user("c.sponsor", { confidentialityClearance: "Confidentiel" }, "chantier_owner"),
      user("p.owner", { confidentialityClearance: "all" }, "chantier_contributor"),
      user("p.contrib", { confidentialityClearance: "all" }, "projet_contributor"),
      user("viewer", {}, "comex_member"),
      user("acme.admin", { isCompanyAdmin: true }),
    ],
    axes: [
      axis("ax-ops", "Excellence opérationnelle"),
      axis("ax-talents", "Talents & Organisation"),
    ],
    chantiers: [
      chantier("ch-supply", "Optimisation Supply Chain", "ax-ops"),
      chantier("ch-rh", "Parcours managers", "ax-talents"),
    ],
    chantierActions: [projet("CA-1", "Nouveau WMS"), projet("CA-2", "Achats groupés")],
    indicators: [
      {
        id: "ind-nps",
        companyId: "c1",
        programId: P,
        axisId: "ax-ops",
        chantierId: "ch-supply",
        name: "NPS client",
        kind: "quantitative",
        frequency: "quarterly",
        objective: "50",
        responsibleRoles: ["strategic_lead"],
        additionalAuthorizedUserIds: ["test.cto"],
        status: "on_track",
      } as unknown as Indicator,
    ],
    measurements: [
      { id: "m1", indicatorId: "ind-nps", period: "2026-Q1", value: 30 },
      { id: "m2", indicatorId: "ind-nps", period: "2026-Q2", value: 34 },
    ] as unknown as IndicatorMeasurement[],
    staffing: [
      {
        id: "CS-1",
        companyId: "c1",
        programId: P,
        chantierId: "ch-supply",
        function: "Logistique",
        fte: 1,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    employees: [
      emp("E1", "Logistique"),
      emp("E2", "Logistique"),
      emp("E3", "Logistique"),
      emp("E4", "Logistique"),
      ...Array.from({ length: 10 }, (_, i) => emp(`IT${i}`, "IT")),
    ],
    approvals: [],
    backup: null,
  };
}

const prepared = () => {
  const snapshot = fixture();
  const result = plan.planDemoStratVideo(snapshot, { now: NOW });
  const after: Snapshot = plan.applyWritesToSnapshot(snapshot, result.writes);
  return { snapshot, result, after };
};

const approvalData = (s: Snapshot): StrategicApprovalData => ({
  programId: P,
  axes: s.axes,
  chantiers: s.chantiers,
  chantierActions: s.chantierActions,
  indicators: s.indicators,
  users: s.users,
});
const byId = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id)!;
const findUser = (s: Snapshot, username: string) => s.users.find((u) => u.username === username)!;

describe("planDemoStratVideo", () => {
  it("a) NPS : responsable de saisie = responsable projet, historique intact", () => {
    const { result, after } = prepared();
    const nps = byId(after.indicators, "ind-nps");
    expect(nps.additionalAuthorizedUserIds).toEqual(["p.owner"]);
    expect(
      result.writes.some((w: { path: string }) => w.path.startsWith("indicatorMeasurements"))
    ).toBe(false);
    expect(after.measurements).toHaveLength(2);
    const ctx = {
      axes: after.axes,
      chantiers: after.chantiers,
      chantierActions: after.chantierActions,
    };
    expect(canFillIndicator(nps, findUser(after, "p.owner"), ctx)).toBe(true);
  });

  it("b) livrables datés + dépendance FS entre deux projets du chantier", () => {
    const { after } = prepared();
    const supplyActions = after.chantierActions.filter((a) => a.chantierId === "ch-supply");
    const withDeliverables = supplyActions.filter((a) =>
      (a.deliverables ?? []).some((d) => d.dueDate)
    );
    expect(withDeliverables.length).toBeGreaterThan(0);
    const rows = chantierDependencyOverview(
      byId(after.chantiers, "ch-supply"),
      after.chantiers,
      after.chantierActions,
      { today: new Date(`${TODAY}T12:00:00Z`) }
    );
    const fs = rows.filter((r) => r.scope === "projet" && r.type === "FS");
    expect(fs.length).toBeGreaterThan(0);
    expect(fs.some((r) => r.status === "late")).toBe(true);
  });

  it("c) demandes : chaînes identiques à celles de l'app, étape 2/2 chez le sponsor", () => {
    const { after } = prepared();
    const data = approvalData(after);
    const approvals = after.approvals;
    const main = byId(approvals, plan.IDS.apprContribPending);
    expect(main.requestedBy).toBe("p.contrib");
    expect(approvalStepInfo(main)).toMatchObject({
      current: 2,
      total: 2,
      usernames: ["c.sponsor"],
    });
    expect(main.chain![0]).toMatchObject({
      level: "projectOwner",
      decidedBy: "p.owner",
      decision: "approved",
    });
    expect(currentStep(main)?.level).toBe("chantierSponsor");

    for (const a of approvals) {
      const chain = computeApprovalChain(
        a.kind,
        findUser(after, a.requestedBy),
        { type: a.targetType, id: a.targetId, name: a.targetName },
        data,
        a.payload
      );
      expect(a.chain!.map((s) => ({ level: s.level, usernames: s.usernames }))).toEqual(chain);
    }

    const sponsor = findUser(after, "c.sponsor");
    const buckets = bucketApprovals(approvals, sponsor, data);
    expect(buckets.pending.map((a) => a.id).sort()).toEqual(
      [plan.IDS.apprContribPending, plan.IDS.apprOwnerPending].sort()
    );
    const decided = approvals.filter((a) => a.status !== "pending");
    expect(decided.length).toBeGreaterThanOrEqual(2);
    expect(decided.some((a) => a.status === "rejected")).toBe(true);
    expect(decided.some((a) => a.status === "approved")).toBe(true);
    expect(byId(after.chantierActions, "CA-1").contributors).toContain("p.contrib");
  });

  it("d) Mon espace du sponsor : en retard, à traiter, à venir", () => {
    const { after } = prepared();
    const sponsor = findUser(after, "c.sponsor");
    const ws = buildMyWorkspace(
      {
        user: sponsor,
        today: TODAY,
        users: after.users,
        strategic: {
          programId: P,
          axes: after.axes,
          chantiers: after.chantiers,
          chantierActions: after.chantierActions,
          indicators: after.indicators,
          measurements: after.measurements,
          approvals: after.approvals,
        },
      },
      (_k, fallback) => fallback ?? _k
    );
    expect(ws.todo.some((i) => (i.daysLate ?? 0) > 0)).toBe(true);
    expect(ws.todo.some((i) => i.source === "strategicApproval")).toBe(true);
    expect(ws.upcoming.length).toBeGreaterThan(0);
    expect(ws.upcoming.every((i) => !i.dueDate || i.dueDate <= "2026-10-28")).toBe(true);
  });

  it("e) une équipe dépasse 120 % de son disponible dans les 3 prochains mois", () => {
    const { after } = prepared();
    const demoLines = after.staffing.filter((s) => s.id.startsWith("demo-video-"));
    expect(demoLines.length).toBeGreaterThan(0);
    expect(demoLines.every((s) => s.startDate && s.endDate && s.programId === P)).toBe(true);
    const overruns = staffingOverruns(after.staffing, fteByDepartment(after.employees), TODAY, {
      tense: 100,
      over: 120,
    });
    const logistique = overruns.find((o) => o.team === "Logistique");
    expect(logistique).toBeDefined();
    expect(logistique!.peakRatePct!).toBeGreaterThan(120);
    expect(logistique!.months[0] <= "2026-12-31").toBe(true);
    expect(overruns.filter((o) => o.team !== "Logistique")).toEqual([]);
  });

  it("f) niveau Confidentiel ajouté, axe Talents confidentiel, habilitations rapportées", () => {
    const { result, after } = prepared();
    const levels = after.company!.confidentialityLevels!;
    expect(levels).toEqual(["Public", "Restreint", "Confidentiel"]);
    expect(byId(after.axes, "ax-talents").confidentialityLevel).toBe("Confidentiel");
    const clearanceOf = (u: AuthUser) =>
      resolveConfidentialityClearance(u, after.company!.roleClearance, "strategic", levels);
    const chantierRh = byId(after.chantiers, "ch-rh");
    const expected = after.users
      .filter((u) => !u.isCompanyAdmin && (u.profiles ?? []).length > 0)
      .filter((u) => !isChantierVisibleForClearance(chantierRh, after.axes, clearanceOf(u)))
      .map((u) => u.username)
      .sort();
    expect(result.report.usersWithoutClearance).toEqual(expected);
    expect(expected).toEqual(["a.sponsor", "viewer"]);
  });

  it("g) comptes manquants rapportés, jamais créés", () => {
    const { result } = prepared();
    expect(result.report.missingAccounts).toEqual([]);
    const snapshot = fixture();
    snapshot.users = snapshot.users.filter((u) => u.username !== "p.contrib" && !u.isCompanyAdmin);
    const partial = plan.planDemoStratVideo(snapshot, { now: NOW });
    expect(partial.report.missingAccounts.map((m: { role: string }) => m.role).sort()).toEqual([
      "company_admin",
      "projet_contributor",
    ]);
    expect(partial.writes.some((w: { path: string }) => w.path.startsWith("adminUsers"))).toBe(
      false
    );
  });

  it("idempotent : relance sur l'état appliqué = aucune écriture", () => {
    const { result, after } = prepared();
    expect(result.writes.length).toBeGreaterThan(0);
    expect(result.writes[0].path).toBe(plan.BACKUP_PATH);
    expect(result.writes.every((w: { path: string; op: string }) => w.op !== "delete")).toBe(true);
    const created = result.writes.filter((w: { op: string }) => w.op === "set");
    expect(
      created.every(
        (w: { path: string }) =>
          w.path === plan.BACKUP_PATH || w.path.split("/")[1].startsWith("demo-video-")
      )
    ).toBe(true);
    expect(plan.planDemoStratVideo(after, { now: NOW }).writes).toEqual([]);
  });

  it("nettoyage : supprime les documents démo et restaure les valeurs d'origine", () => {
    const { snapshot, after } = prepared();
    const cleanup = plan.planDemoStratVideoCleanup(after);
    const restored = plan.applyWritesToSnapshot(after, cleanup.writes);
    expect(restored).toEqual({ ...snapshot, backup: null });
    // Nettoyage d'un état déjà propre : rien à faire.
    expect(plan.planDemoStratVideoCleanup(restored).writes).toEqual([]);
  });
});
