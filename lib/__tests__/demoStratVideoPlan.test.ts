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
import {
  filterStrategicByClearance,
  isChantierVisibleForClearance,
} from "@/lib/strategicConfidentiality";
import { buildMyWorkspace } from "@/lib/myWorkspace";
import { assertValidProfiles } from "@/lib/roleProfiles";
import { resolveUserNav } from "@/lib/nav-config";
import { STRATEGIC_ROLES } from "@/types";
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
 * pur). Tournage à 3 connexions (test.cto, thomas.petit, comex.test) ; deux figurants non filmés
 * (pierre.lefevre, nadia.klein). Les documents produits sont vérifiés avec les VRAIES fonctions de
 * l'app (chaîne de validation, Mon espace, carte Dépendances, sur-staffing, confidentialité, nav).
 * Fixture calquée sur les données réelles d'Acme (c1, p-strat-demo-2026).
 */
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const plan = require("../../scripts/lib/demoStratVideoPlan.js");

const P = "p-strat-demo-2026";
const NOW = "2026-09-30T08:00:00.000Z";
const TODAY = "2026-09-30";
const CTO = "test.cto";
const SPONSOR = "thomas.petit";
const RESTRICTED = "comex.test";
const OWNER = "pierre.lefevre";
const CONTRIB = "nadia.klein";

type Profile = { role: string; programId?: string };
const user = (username: string, profiles: Profile[], extra: Partial<AuthUser> = {}) =>
  ({
    docId: `${username}.c1`,
    username,
    name: username.toUpperCase(),
    companyId: "c1",
    profiles,
    ...extra,
  }) as unknown as AuthUser & { docId: string };
const sp = (role: string): Profile => ({ role, programId: P });

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
  const axis = (id: string, name: string, owner: string) =>
    ({ id, companyId: "c1", programId: P, name, owner, stage: "s1" }) as StrategicAxis;
  const chantier = (id: string, name: string, axisId: string, pilote: string, extra = {}) =>
    ({
      id,
      companyId: "c1",
      programId: P,
      axisIds: [axisId],
      name,
      stage: "s1",
      dependencies: [],
      pilote,
      ...extra,
    }) as unknown as Chantier;
  const projet = (id: string, name: string) =>
    ({
      id,
      companyId: "c1",
      chantierId: "CH-supply",
      name,
      owner: SPONSOR,
      contributors: [],
      start: "2026-03-01",
      end: "2026-12-15",
      status: "in_progress",
      budget: 300000,
    }) as ChantierAction;
  const emp = (id: string, department: string) =>
    ({ id, name: id, department, fte: 1 }) as unknown as Employee;
  return {
    program: { id: P },
    company: {
      id: "c1",
      name: "Acme Corp",
      confidentialityLevels: ["Public", "Restreint"],
      roleClearance: { strategic_lead: "Restreint", axis_sponsor: "Restreint" },
    } as unknown as Company,
    users: [
      user(CTO, [{ role: "cto" }, sp("strategic_lead")]),
      user(SPONSOR, [sp("chantier_owner")]),
      user(RESTRICTED, [{ role: "comex_member" }]),
      user(OWNER, [sp("chantier_owner")]),
      user(CONTRIB, [{ role: "lever" }]),
      user("sofia.martin", [sp("chantier_owner")]),
      user("alex.roussel", [sp("axis_sponsor")]),
      user("lea.moreau", [sp("axis_sponsor")]),
      user("marc.dubois", [sp("axis_sponsor")]),
      user("claire.bernard", [sp("axis_sponsor")]),
      user("elena.ruiz", [sp("axis_sponsor")]),
      user("viewer", [sp("comex_member")]),
      user("acme.admin", [], { isCompanyAdmin: true }),
    ],
    axes: [
      axis("AX-digital", "Digitalisation & Data", "alex.roussel"),
      axis("AX-durable", "Développement Durable", "lea.moreau"),
      axis("AX-excop", "Excellence Opérationnelle", "marc.dubois"),
      axis("AX-expclient", "Expérience Client", "claire.bernard"),
      axis("AX-talents", "Talents & Organisation", "elena.ruiz"),
    ],
    chantiers: [
      chantier("CH-supply", "Optimisation Supply Chain", "AX-excop", SPONSOR, {
        allocatedBudget: 900000,
      }),
      chantier("CH-lean", "Lean management", "AX-excop", OWNER),
      chantier("CH-cyber", "Cybersécurité", "AX-digital", RESTRICTED),
      chantier("CH-rh", "Parcours managers", "AX-talents", "sofia.martin"),
    ],
    chantierActions: [
      projet("CA-1", "Refonte réseau logistique EU"),
      projet("CA-2", "Mise en place S&OP"),
    ],
    indicators: [
      {
        id: "ind-nps",
        companyId: "c1",
        programId: P,
        axisId: "AX-expclient",
        name: "NPS client",
        kind: "quantitative",
        frequency: "quarterly",
        objective: "50",
        responsibleRoles: ["strategic_lead"],
        additionalAuthorizedUserIds: [CTO],
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
        chantierId: "CH-supply",
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

const prepared = (snapshot = fixture(), options = {}) => {
  const result = plan.planDemoStratVideo(snapshot, { now: NOW, ...options });
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
type Write = { op: string; path: string; data?: Record<string, unknown> };

describe("planDemoStratVideo — tournage à 3 connexions", () => {
  it("distribution : 3 comptes filmés + 2 figurants, aucun projet réel modifié", () => {
    const { result, after, snapshot } = prepared();
    expect(result.report.cast).toMatchObject({
      cto: CTO,
      chantierSponsor: SPONSOR,
      restrictedUser: RESTRICTED,
      projectOwner: OWNER,
      projectContributor: CONTRIB,
      axisSponsor: "marc.dubois",
      projetId: plan.IDS.projetApprovals,
    });
    const writes: Write[] = result.writes;
    expect(writes.filter((w) => /^chantierActions\/CA-/.test(w.path))).toEqual([]);
    expect(byId(after.chantierActions, "CA-1")).toEqual(byId(snapshot.chantierActions, "CA-1"));
    expect(byId(after.chantierActions, "CA-2")).toEqual(byId(snapshot.chantierActions, "CA-2"));
    // Seuls les champs attendus des adminUsers sont touchés (jamais de création de compte).
    const userWrites = writes.filter((w) => w.path.startsWith("adminUsers/"));
    expect(userWrites.every((w) => w.op === "update")).toBe(true);
    expect(
      Object.fromEntries(userWrites.map((w) => [w.path, Object.keys(w.data!).sort()]))
    ).toEqual({
      [`adminUsers/${OWNER}.c1`]: ["profiles"],
      [`adminUsers/${CONTRIB}.c1`]: ["profiles"],
      [`adminUsers/${RESTRICTED}.c1`]: ["confidentialityClearance"],
      [`adminUsers/${CTO}.c1`]: ["confidentialityClearance"],
    });
  });

  it("figurants : profils exacts de l'app sur le programme, valides, et projet démo", () => {
    const { after } = prepared();
    expect(plan.PROJECT_OWNER_ROLE).toBe("chantier_contributor");
    expect(plan.CONTRIBUTOR_ROLE).toBe("projet_contributor");
    expect(STRATEGIC_ROLES).toContain(plan.PROJECT_OWNER_ROLE);
    expect(STRATEGIC_ROLES).toContain(plan.CONTRIBUTOR_ROLE);
    const owner = findUser(after, OWNER);
    const contrib = findUser(after, CONTRIB);
    // Un seul profil stratégique par programme : le chantier_owner de pierre est remplacé.
    expect(owner.profiles).toEqual([{ role: "chantier_contributor", programId: P }]);
    expect(contrib.profiles).toEqual([
      { role: "lever" },
      { role: "projet_contributor", programId: P },
    ]);
    expect(() => assertValidProfiles(owner.profiles)).not.toThrow();
    expect(() => assertValidProfiles(contrib.profiles)).not.toThrow();
    const projet = byId(after.chantierActions, plan.IDS.projetApprovals);
    expect(projet).toMatchObject({
      chantierId: "CH-supply",
      owner: OWNER,
      contributors: [CONTRIB],
    });
  });

  it("figurant écarté s'il est impliqué dans Talents & Organisation (ou absent) : remplacé", () => {
    const snapshot = fixture();
    snapshot.chantiers = snapshot.chantiers.map((c) =>
      c.id === "CH-rh" ? { ...c, pilote: OWNER } : c
    );
    snapshot.users = snapshot.users.filter((u) => u.username !== CONTRIB);
    const { result, after } = prepared(snapshot);
    const { projectOwner, projectContributor } = result.report.cast;
    expect([projectOwner, projectContributor]).not.toContain(OWNER);
    expect(projectOwner).toBeDefined();
    expect(projectContributor).toBeDefined();
    const forbidden = [CTO, SPONSOR, RESTRICTED, "marc.dubois", "elena.ruiz", "acme.admin"];
    expect(forbidden).not.toContain(projectOwner);
    expect(forbidden).not.toContain(projectContributor);
    expect(result.report.notes.join("\n")).toMatch(/pierre\.lefevre.*Talents/);
    expect(result.report.notes.join("\n")).toMatch(/nadia\.klein.*inexistant/);
    const accounts = result.report.accounts as { key: string; requested?: string }[];
    expect(accounts.find((a) => a.key === "projectOwner")!.requested).toBe(OWNER);
    // La chaîne reste valide avec les remplaçants.
    const main = byId(after.approvals, plan.IDS.apprContribPending);
    expect(main.requestedBy).toBe(projectContributor);
    expect(main.chain![0].decidedBy).toBe(projectOwner);
  });

  it("a) NPS : responsable de saisie = sponsor, aperçu « Sponsor d'axe puis Pilote du plan »", () => {
    const { result, after, snapshot } = prepared();
    const nps = byId(after.indicators, "ind-nps");
    expect(nps.additionalAuthorizedUserIds).toEqual([SPONSOR]);
    expect(
      result.writes.some((w: { path: string }) => w.path.startsWith("indicatorMeasurements"))
    ).toBe(false);
    expect(after.measurements).toHaveLength(2);
    const ctx = {
      axes: after.axes,
      chantiers: after.chantiers,
      chantierActions: after.chantierActions,
    };
    const thomas = findUser(after, SPONSOR);
    expect(canFillIndicator(byId(snapshot.indicators, "ind-nps"), thomas, ctx)).toBe(false);
    expect(canFillIndicator(nps, thomas, ctx)).toBe(true);
    // Même calcul que l'aperçu de IndicatorValueModal (sa.previewChain("kpi_value", …)).
    const chain = computeApprovalChain(
      "kpi_value",
      thomas,
      { type: "indicateur", id: nps.id, name: nps.name },
      approvalData(after),
      { period: "2026-Q3" }
    );
    expect(chain).toEqual([
      { level: "axisSponsor", usernames: ["claire.bernard"] },
      { level: "pilot", usernames: [CTO] },
    ]);
  });

  it("b) livrables datés + dépendance FS entre deux projets du chantier", () => {
    const { after } = prepared();
    const supplyActions = after.chantierActions.filter((a) => a.chantierId === "CH-supply");
    expect(supplyActions.some((a) => (a.deliverables ?? []).some((d) => d.dueDate))).toBe(true);
    const rows = chantierDependencyOverview(
      byId(after.chantiers, "CH-supply"),
      after.chantiers,
      after.chantierActions,
      { today: new Date(`${TODAY}T12:00:00Z`) }
    );
    const fs = rows.filter((r) => r.scope === "projet" && r.type === "FS");
    expect(fs.length).toBeGreaterThan(0);
    expect(fs.some((r) => r.status === "late")).toBe(true);
  });

  it("c) demandes : contributeur → responsable projet (validé) → sponsor (2/2), chaînes de l'app", () => {
    const { after } = prepared();
    const data = approvalData(after);
    const approvals = after.approvals;
    const main = byId(approvals, plan.IDS.apprContribPending);
    expect(main.requestedBy).toBe(CONTRIB);
    expect(approvalStepInfo(main)).toMatchObject({ current: 2, total: 2, usernames: [SPONSOR] });
    expect(main.chain![0]).toMatchObject({
      level: "projectOwner",
      decidedBy: OWNER,
      decision: "approved",
    });
    expect(currentStep(main)?.level).toBe("chantierSponsor");
    const phone = byId(approvals, plan.IDS.apprOwnerPending);
    expect(phone.requestedBy).toBe(OWNER);
    expect(approvalStepInfo(phone)).toMatchObject({ current: 1, total: 1, usernames: [SPONSOR] });

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

    const buckets = bucketApprovals(approvals, findUser(after, SPONSOR), data);
    expect(buckets.pending.map((a) => a.id).sort()).toEqual(
      [plan.IDS.apprContribPending, plan.IDS.apprOwnerPending].sort()
    );
    expect(buckets.history.map((a) => a.id).sort()).toEqual(
      [
        plan.IDS.apprApprovedPlanning,
        plan.IDS.apprRejectedBudget,
        plan.IDS.apprApprovedBudget,
        plan.IDS.apprSponsorMine,
      ].sort()
    );
    expect(buckets.history.some((a) => a.status === "rejected")).toBe(true);
    expect(buckets.mine.map((a) => a.id)).toEqual([plan.IDS.apprSponsorMine]);
    // Le pilote filmé n'a rien d'imprévu en attente.
    expect(bucketApprovals(approvals, findUser(after, CTO), data).pending).toEqual([]);
  });

  it("d) Mon espace du sponsor : en retard, à traiter, à venir", () => {
    const { after } = prepared();
    const ws = buildMyWorkspace(
      {
        user: findUser(after, SPONSOR),
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
  });

  it("e) staffing ~135 % sur une équipe, Base ETP visible du pilote", () => {
    const { after } = prepared();
    const demoLines = after.staffing.filter((s) => s.id.startsWith("demo-video-"));
    expect(demoLines.length).toBeGreaterThan(0);
    const overruns = staffingOverruns(after.staffing, fteByDepartment(after.employees), TODAY, {
      tense: 100,
      over: 120,
    });
    const logistique = overruns.find((o) => o.team === "Logistique");
    expect(logistique!.peakRatePct!).toBeGreaterThanOrEqual(130);
    expect(logistique!.peakRatePct!).toBeLessThanOrEqual(140);
    expect(overruns.filter((o) => o.team !== "Logistique")).toEqual([]);
    expect(resolveUserNav(findUser(after, CTO)).some((i) => i.id === "hr-etp")).toBe(true);
  });

  it("f) confidentialité : test.cto voit Talents, comex.test non mais voit tout le reste", () => {
    const { result, after } = prepared();
    const levels = after.company!.confidentialityLevels!;
    expect(levels).toEqual(["Public", "Restreint", "Confidentiel"]);
    expect(byId(after.axes, "AX-talents").confidentialityLevel).toBe("Confidentiel");
    const clearanceOf = (u: AuthUser) =>
      resolveConfidentialityClearance(u, after.company!.roleClearance, "strategic", levels);
    const chantierRh = byId(after.chantiers, "CH-rh");
    const input = { axes: after.axes, chantiers: after.chantiers, indicators: [], staffing: [] };

    const cto = findUser(after, CTO);
    expect(isChantierVisibleForClearance(chantierRh, after.axes, clearanceOf(cto))).toBe(true);
    const ctoView = filterStrategicByClearance(input, clearanceOf(cto));
    expect(ctoView.axes.map((a) => a.id)).toContain("AX-talents");
    expect(ctoView.chantiers).toHaveLength(after.chantiers.length);

    const restricted = findUser(after, RESTRICTED);
    expect(restricted.confidentialityClearance).toBe("Restreint");
    expect(isChantierVisibleForClearance(chantierRh, after.axes, clearanceOf(restricted))).toBe(
      false
    );
    const restrictedView = filterStrategicByClearance(input, clearanceOf(restricted));
    expect(restrictedView.axes.map((a) => a.id)).not.toContain("AX-talents");
    expect(restrictedView.axes).toHaveLength(after.axes.length - 1);
    expect(restrictedView.chantiers.map((c) => c.id).sort()).toEqual(
      after.chantiers
        .filter((c) => c.id !== "CH-rh")
        .map((c) => c.id)
        .sort()
    );
    expect(restrictedView.chantiers.map((c) => c.id)).toContain("CH-cyber");
    expect(resolveUserNav(restricted).some((i) => i.id === "levers")).toBe(true);

    const expected = after.users
      .filter(
        (u) =>
          !u.isCompanyAdmin &&
          (u.profiles ?? []).some((p) => p.programId === P || p.role === "comex_member")
      )
      .filter((u) => !isChantierVisibleForClearance(chantierRh, after.axes, clearanceOf(u)))
      .map((u) => u.username)
      .sort();
    expect(result.report.usersWithoutClearance).toEqual(expected);
    expect(expected).toContain(RESTRICTED);
    expect(expected).not.toContain(CTO);
  });

  it("f) pas de surcharge pour test.cto s'il voit déjà « Confidentiel » via son rôle", () => {
    const snapshot = fixture();
    snapshot.company = {
      ...snapshot.company!,
      confidentialityLevels: ["Public", "Restreint", "Confidentiel"],
      roleClearance: { strategic_lead: "Confidentiel" },
    } as Company;
    const { result } = prepared(snapshot);
    expect(result.writes.some((w: Write) => w.path === `adminUsers/${CTO}.c1`)).toBe(false);
  });

  it("g) comptes : seuls les 3 filmés + 2 figurants sont vérifiés, jamais créés", () => {
    const { result } = prepared();
    expect(result.report.missingAccounts).toEqual([]);
    expect(
      (result.report.accounts as { username: string; status: string; filmed: boolean }[]).map(
        (a) => [a.username, a.status, a.filmed]
      )
    ).toEqual([
      [CTO, "ok", true],
      [SPONSOR, "ok", true],
      [RESTRICTED, "ok", true],
      [OWNER, "ok", false],
      [CONTRIB, "ok", false],
    ]);
    const snapshot = fixture();
    snapshot.users = snapshot.users.filter((u) => u.username !== RESTRICTED);
    const partial = plan.planDemoStratVideo(snapshot, { now: NOW });
    expect(partial.report.missingAccounts.map((m: { key: string }) => m.key)).toEqual([
      "restrictedUser",
    ]);
    expect(
      partial.writes.some((w: Write) => w.op === "set" && w.path.startsWith("adminUsers"))
    ).toBe(false);
  });

  it("idempotent : relance sur l'état appliqué = aucune écriture", () => {
    const { result, after } = prepared();
    expect(result.writes.length).toBeGreaterThan(0);
    expect(result.writes[0].path).toBe(plan.BACKUP_PATH);
    expect(result.writes.every((w: Write) => w.op !== "delete")).toBe(true);
    const created = result.writes.filter((w: Write) => w.op === "set");
    expect(
      created.every(
        (w: Write) => w.path === plan.BACKUP_PATH || w.path.split("/")[1].startsWith("demo-video-")
      )
    ).toBe(true);
    const rerun = plan.planDemoStratVideo(after, { now: NOW });
    expect(rerun.writes).toEqual([]);
    expect(rerun.report.cast).toEqual(result.report.cast);
  });

  it("nettoyage : restaure exactement le snapshot d'origine (adminUsers compris)", () => {
    const { snapshot, after } = prepared();
    const cleanup = plan.planDemoStratVideoCleanup(after);
    const restored = plan.applyWritesToSnapshot(after, cleanup.writes);
    expect(restored).toEqual({ ...snapshot, backup: null });
    expect(findUser(restored, RESTRICTED)).not.toHaveProperty("confidentialityClearance");
    expect(findUser(restored, OWNER).profiles).toEqual([{ role: "chantier_owner", programId: P }]);
    expect(plan.planDemoStratVideoCleanup(restored).writes).toEqual([]);
  });
});
