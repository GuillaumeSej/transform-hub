import { describe, expect, it } from "vitest";
import {
  buildApproval,
  canDecide,
  decideApproval,
  pendingApproversOf,
  resolveApprovalRoute,
  STRATEGIC_APPROVAL_KINDS,
  type StrategicApproval,
  type StrategicApprovalData,
  type StrategicApprovalKind,
  type StrategicApprovalPayload,
  type StrategicApprovalTarget,
} from "@/lib/strategicApprovals";
import { clearedApproval } from "@/lib/strategicApprovalClearance";
import { routeKpiCorrection } from "@/lib/kpiCorrectionRouting";
import type { AuthUser, Chantier, ChantierAction, Indicator, StrategicAxis } from "@/types";

/**
 * Lot 6 — validation stratégique :
 *  - point 2 : une demande en attente a TOUJOURS au moins un décideur possible (invariant exploré
 *    sur toutes les combinaisons type × cible × demandeur × ordre de décision, entreprise à un seul
 *    admin et à plusieurs admins, demandes routées avant/après le lot 5) ;
 *  - point 3 : un valideur nommé sans compte actif est traité comme un niveau vide.
 */

const CONF = "confidentiel";
const base = {
  companyId: "co1",
  programId: "P1",
  createdAt: "2026-01-01",
  lastUpdate: "2026-01-01",
};

function user(username: string, extra: Partial<AuthUser> = {}): AuthUser {
  return {
    username,
    name: `${username} Test`,
    companyId: "co1",
    profiles: [],
    confidentialityClearance: "interne",
    ...extra,
  } as unknown as AuthUser;
}
const role = (r: string) => ({ profiles: [{ role: r, programId: "P1" }] }) as Partial<AuthUser>;

// Hiérarchie : pilote lea (NON habilité) ; A1 sponsor « alice » SANS compte (point 3) ; A2 axe
// confidentiel (sponsor bob, habilité) ; A3 sponsorisé par l'admin lui-même ; C4 piloté par un
// « ghost » sans compte.
const axes = [
  { ...base, id: "A1", name: "Axe 1", stage: "s", owner: "alice" },
  { ...base, id: "A2", name: "Axe secret", stage: "s", owner: "bob", confidentialityLevel: CONF },
  { ...base, id: "A3", name: "Axe 3", stage: "s", owner: "adm" },
] as StrategicAxis[];
const chantier = (id: string, axisId: string, pilote: string | undefined, conf?: boolean) =>
  ({
    ...base,
    id,
    axisIds: [axisId],
    name: `Chantier ${id}`,
    stage: "s",
    pilote,
    dependencies: [],
    ...(conf ? { confidentialityLevel: CONF } : {}),
  }) as Chantier;
const chantiers = [
  chantier("C1", "A1", "paul"),
  chantier("C2", "A1", "carl", true),
  chantier("C3", "A2", "dan"),
  chantier("C4", "A3", "ghost"),
];
const projet = (id: string, chantierId: string, owner: string, contributors: string[]) =>
  ({
    id,
    companyId: "co1",
    chantierId,
    name: `Projet ${id}`,
    start: "2026-01-01",
    end: "2026-12-31",
    status: "s",
    owner,
    contributors,
    budget: 10,
    milestones: { currentMilestone: "E0", passedMilestones: [], checklists: {} },
  }) as unknown as ChantierAction;
const actions = [
  projet("P1", "C1", "olga", ["zoe"]),
  projet("P2", "C2", "nina", ["nico", "zoe"]),
  projet("P3", "C3", "dan", ["zoe"]),
  projet("P4", "C4", "olga", ["nico"]),
];
const indicator = (id: string, axisId: string, chantierId?: string) =>
  ({
    ...base,
    id,
    axisId,
    ...(chantierId ? { chantierId } : {}),
    name: `KPI ${id}`,
    kind: "quantitative",
    frequency: "monthly",
    objective: "10",
    objectiveValue: 10,
    direction: "up",
    responsibleRoles: [],
    status: "on_track",
  }) as unknown as Indicator;
const indicators = [
  indicator("I1", "A1", "C1"),
  indicator("I2", "A1", "C2"),
  indicator("I3", "A2"),
  indicator("I4", "A3", "C4"),
];

const nonAdmins = [
  user("lea", role("strategic_lead")),
  user("bob", { ...role("axis_sponsor"), confidentialityClearance: CONF }),
  user("paul", role("chantier_owner")),
  user("carl", { ...role("chantier_owner"), confidentialityClearance: CONF }),
  user("dan", { ...role("chantier_owner"), confidentialityClearance: CONF }),
  user("olga", role("chantier_contributor")),
  user("nina", { ...role("chantier_contributor"), confidentialityClearance: CONF }),
  user("zoe", { ...role("projet_contributor"), confidentialityClearance: CONF }),
  user("nico", role("projet_contributor")),
];
const adm = user("adm", { isCompanyAdmin: true });
const adm2 = user("adm2", { isCompanyAdmin: true });

function dataFor(users: AuthUser[]): StrategicApprovalData {
  return {
    programId: "P1",
    axes,
    chantiers,
    chantierActions: actions,
    indicators,
    measurements: [],
    staffing: [],
    users,
    confidentiality: { levels: ["interne", CONF], roleClearance: {} },
  };
}

type Case = { kind: StrategicApprovalKind; target: StrategicApprovalTarget; payload: unknown };

/** Toutes les demandes possibles : chaque kind sur chaque cible pertinente (variantes de payload). */
function allCases(): Case[] {
  const out: Case[] = [];
  const t = (type: StrategicApprovalTarget["type"], id: string) => ({ type, id, name: id });
  for (const a of actions) {
    const target = t("projet", a.id);
    out.push({
      kind: "milestone",
      target,
      payload: { targetMilestone: "E1", fromMilestone: "E0" },
    });
    for (const category of ["pilotage", "planning", "designation"]) {
      out.push({
        kind: "projet_update",
        target,
        payload: { patch: { budget: 1 }, before: { budget: 10 }, category },
      });
    }
    out.push({ kind: "projet_delete", target, payload: { name: a.name } });
    out.push({
      kind: "staffing_update",
      target,
      payload: {
        op: "create",
        line: {
          ...base,
          id: `S-${a.id}`,
          chantierId: a.chantierId,
          actionId: a.id,
          function: "IT",
          fte: 1,
        },
      },
    });
  }
  for (const c of chantiers) {
    const target = t("chantier", c.id);
    out.push({
      kind: "projet_create",
      target,
      payload: { action: projet(`N-${c.id}`, c.id, "olga", []) },
    });
    for (const category of ["pilotage", "planning"]) {
      out.push({
        kind: "chantier_update",
        target,
        payload: { patch: { budget: 1 }, before: { budget: 0 }, category },
      });
    }
    out.push({ kind: "chantier_delete", target, payload: { name: c.name } });
    out.push({
      kind: "staffing_update",
      target,
      payload: {
        op: "create",
        line: { ...base, id: `S-${c.id}`, chantierId: c.id, function: "IT", fte: 1 },
      },
    });
  }
  for (const ax of axes) {
    const target = t("axe", ax.id);
    for (const conf of [false, true]) {
      out.push({
        kind: "chantier_create",
        target,
        payload: { chantier: chantier(`CN-${ax.id}`, ax.id, undefined, conf) },
      });
    }
    out.push({ kind: "axe_create", target, payload: { axis: { ...ax, id: `AN-${ax.id}` } } });
    out.push({
      kind: "axe_update",
      target,
      payload: { patch: { name: "x" }, before: { name: ax.name }, category: "planning" },
    });
  }
  for (const i of indicators) {
    const target = t("indicateur", i.id);
    out.push({ kind: "kpi_value", target, payload: { period: "2026-09", value: 3 } });
    out.push({
      kind: "kpi_value",
      target,
      payload: { period: "2026-09", value: 3, measurementId: `M-${i.id}`, previousValue: 1 },
    });
    out.push({
      kind: "indicator_update",
      target,
      payload: { patch: { objectiveValue: 5 }, before: { objectiveValue: 10 } },
    });
  }
  // Toutes les kinds sont couvertes.
  expect(new Set(out.map((c) => c.kind))).toEqual(new Set(STRATEGIC_APPROVAL_KINDS));
  return out;
}

/** Retire les drapeaux admin : simule une décision persistée AVANT le lot 6 (pas de clôture
 *  automatique des paliers « admin » restants). */
const preLot6 = (u: AuthUser) => ({ username: u.username, name: u.name });

type Stats = { explored: number; closed: number; pendingStates: number };

/**
 * Explore TOUS les ordres de décision depuis `approval` (relue comme le fait le hook :
 * `clearedApproval`), en vérifiant à chaque état en attente qu'au moins un utilisateur peut
 * décider, et à chaque clôture qu'aucun admin n'a validé deux paliers nommés.
 */
function explore(
  approval: StrategicApproval,
  data: StrategicApprovalData,
  label: string,
  stats: Stats,
  depth = 0
): void {
  expect(depth, label).toBeLessThan(6);
  const a = clearedApproval(approval, data);
  if (a.status !== "pending") {
    stats.closed++;
    const named = (a.chain ?? []).filter((s) => s.level !== "admin" && s.decidedBy);
    const admins = new Set(
      (data.users ?? []).filter((u) => u.isCompanyAdmin).map((u) => u.username)
    );
    const adminNamed = named.map((s) => s.decidedBy!).filter((u) => admins.has(u));
    expect(new Set(adminNamed).size, `${label} : admin sur deux paliers nommés`).toBe(
      adminNamed.length
    );
    return;
  }
  stats.pendingStates++;
  const deciders = (data.users as AuthUser[]).filter((u) => canDecide(u, a, data));
  expect(deciders.length, `${label} : aucun décideur possible`).toBeGreaterThan(0);
  // Personne ne décide sa propre demande ; un valideur affiché est bien un décideur possible.
  expect(
    deciders.map((u) => u.username),
    label
  ).not.toContain(a.requestedBy);
  for (const u of pendingApproversOf(a)) {
    const account = (data.users as AuthUser[]).find((x) => x.username === u);
    if (account) expect(canDecide(account, a, data), `${label} : ${u} affiché`).toBe(true);
  }
  for (const d of deciders) {
    stats.explored++;
    const { approval: next, final } = decideApproval(a, d, "approved");
    expect(final, label).toBe(next.status !== "pending");
    explore(next, data, `${label} > ${d.username}`, stats, depth + 1);
  }
  // Un refus clôt toujours.
  expect(decideApproval(a, deciders[0], "rejected").final, label).toBe(true);
}

describe("lot 6 — point 2 : une demande en attente a toujours un décideur", () => {
  const scenarios: [string, AuthUser[]][] = [
    ["un seul admin", [...nonAdmins, adm]],
    ["plusieurs admins", [...nonAdmins, adm, adm2]],
  ];

  for (const [name, users] of scenarios) {
    it(`toutes combinaisons type × cible × demandeur × ordre de décision (${name})`, () => {
      const data = dataFor(users);
      const stats: Stats = { explored: 0, closed: 0, pendingStates: 0 };
      let requests = 0;
      for (const c of allCases()) {
        for (const requester of nonAdmins) {
          const payload = c.payload as StrategicApprovalPayload;
          const route = resolveApprovalRoute(c.kind, requester, c.target, data, payload);
          if (route.mode !== "request") continue;
          requests++;
          const approval = buildApproval({
            kind: c.kind,
            target: c.target,
            payload,
            companyId: "co1",
            programId: "P1",
            requester,
            data,
            now: "2026-10-01T10:00:00Z",
          });
          explore(approval, data, `${c.kind}/${c.target.id}/${requester.username}`, stats);
        }
      }
      expect(requests).toBeGreaterThan(150);
      expect(stats.closed).toBeGreaterThan(requests);
    });

    it(`demandes routées AVANT le lot 5 et décidées avant le lot 6, relues aujourd'hui (${name})`, () => {
      const data = dataFor(users);
      // Avant le lot 5 : aucune règle d'habilitation sur les valideurs (tout le monde « habilité »).
      const legacyData = dataFor(
        users.map((u) => ({ ...u, confidentialityClearance: "all" }) as AuthUser)
      );
      const stats: Stats = { explored: 0, closed: 0, pendingStates: 0 };
      let states = 0;
      for (const c of allCases()) {
        for (const requester of nonAdmins) {
          const payload = c.payload as StrategicApprovalPayload;
          const route = resolveApprovalRoute(c.kind, requester, c.target, legacyData, payload);
          if (route.mode !== "request") continue;
          const approval = buildApproval({
            kind: c.kind,
            target: c.target,
            payload,
            companyId: "co1",
            programId: "P1",
            requester,
            data: legacyData,
            now: "2026-09-01T10:00:00Z",
          });
          // État persisté : demande neuve, ou 1er palier déjà validé (par un valideur ou un admin,
          // sans la clôture automatique du lot 6).
          const persisted = [approval];
          for (const d of users) {
            if (!canDecide(d, approval, legacyData)) continue;
            const { approval: next } = decideApproval(approval, preLot6(d), "approved");
            if (next.status === "pending") persisted.push(next);
          }
          for (const p of persisted) {
            states++;
            explore(p, data, `legacy ${c.kind}/${c.target.id}/${requester.username}`, stats);
          }
        }
      }
      expect(states).toBeGreaterThan(200);
    });
  }

  it("cas 1 : l'admin qui décide à la place du responsable clôt la demande (paliers « admin » restants)", () => {
    const data = dataFor([...nonAdmins, adm]);
    const cases: [StrategicApprovalKind, StrategicApprovalTarget, unknown, AuthUser][] = [
      [
        "projet_update",
        { type: "projet", id: "P2" },
        { patch: { budget: 1 }, before: { budget: 10 }, category: "pilotage" },
        nonAdmins.find((u) => u.username === "nina")!,
      ],
      [
        "projet_delete",
        { type: "projet", id: "P2" },
        { name: "P2" },
        nonAdmins.find((u) => u.username === "zoe")!,
      ],
      [
        "chantier_update",
        { type: "chantier", id: "C2" },
        { patch: { budget: 1 }, before: { budget: 0 }, category: "pilotage" },
        nonAdmins.find((u) => u.username === "nina")!,
      ],
      [
        "kpi_value",
        { type: "indicateur", id: "I2" },
        { period: "2026-09", value: 3, measurementId: "M-I2" },
        nonAdmins.find((u) => u.username === "zoe")!,
      ],
    ];
    for (const [kind, target, payload, requester] of cases) {
      const a = buildApproval({
        kind,
        target,
        payload: payload as StrategicApprovalPayload,
        companyId: "co1",
        programId: "P1",
        requester,
        data,
      });
      expect(a.chain?.map((s) => s.level).at(-1), kind).toBe("admin");
      expect(a.chain?.length, kind).toBe(2);
      expect(canDecide(adm, a, data), kind).toBe(true);
      const { approval, final } = decideApproval(a, adm, "approved", "ok", "2026-10-02T00:00:00Z");
      expect([kind, final, approval.status]).toEqual([kind, true, "approved"]);
      expect(approval.chain?.every((s) => s.decidedBy === "adm")).toBe(true);
      expect(approval.stepIndex).toBe(1);
      // Le responsable nommé, lui, valide son palier et laisse le palier admin à l'admin.
      const named = a.chain![0].usernames[0];
      const owner = nonAdmins.find((u) => u.username === named)!;
      const s1 = decideApproval(a, owner, "approved");
      expect(s1.final).toBe(false);
      expect(canDecide(adm, s1.approval, data)).toBe(true);
    }
  });

  it("cas 2 : palier déjà validé par l'admin puis palier non habilité remplacé → l'admin reprend", () => {
    const data = dataFor([...nonAdmins, adm]);
    // Chaîne historique (routée avant le lot 5) : palier 1 décidé par l'admin à la place du
    // valideur, palier 2 = pilote lea, NON habilitée sur C2 (remplacé par un palier « admin »).
    const pending = {
      id: "SA-X",
      companyId: "co1",
      programId: "P1",
      kind: "chantier_update",
      targetType: "chantier",
      targetId: "C2",
      payload: { patch: { budget: 1 }, before: { budget: 0 }, category: "pilotage" },
      requestedBy: "nina",
      requestedAt: "2026-09-01T00:00:00Z",
      approverRole: "strategic_lead",
      approverUsernames: ["lea"],
      status: "pending",
      chain: [
        { level: "axisSponsor", usernames: ["alice"], decidedBy: "adm", decision: "approved" },
        { level: "pilot", usernames: ["lea"] },
      ],
      stepIndex: 1,
    } as unknown as StrategicApproval;
    const cleared = clearedApproval(pending, data);
    expect(cleared.chain?.[1]).toEqual({ level: "admin", usernames: ["adm"] });
    expect(pendingApproversOf(pending, data)).toEqual(["adm"]);
    expect(canDecide(nonAdmins[0], pending, data)).toBe(false); // lea, non habilitée
    expect(canDecide(adm, pending, data)).toBe(true);
    const done = decideApproval(cleared, adm, "approved");
    expect([done.final, done.approval.status]).toEqual([true, "approved"]);
  });

  it("la règle est conservée : un admin ne valide pas deux paliers NOMMÉS", () => {
    const data = dataFor([...nonAdmins, adm]);
    const zoe = nonAdmins.find((u) => u.username === "zoe")!;
    // P1 (non confidentiel) : olga (resp. projet) puis paul (sponsor de chantier).
    const a = buildApproval({
      kind: "projet_update",
      target: { type: "projet", id: "P1" },
      payload: { patch: { budget: 1 }, before: { budget: 10 }, category: "pilotage" } as never,
      companyId: "co1",
      programId: "P1",
      requester: zoe,
      data,
    });
    expect(a.chain).toEqual([
      { level: "projectOwner", usernames: ["olga"] },
      { level: "chantierSponsor", usernames: ["paul"] },
    ]);
    const s1 = decideApproval(a, adm, "approved");
    expect(s1.final).toBe(false);
    expect(canDecide(adm, s1.approval, data)).toBe(false);
    expect(
      canDecide(
        nonAdmins.find((u) => u.username === "paul")!,
        s1.approval,
        data
      )
    ).toBe(true);
    // Admin nommé plus haut (sponsor de A3) : il ne décide pas à la place du palier inférieur,
    // il décidera le sien.
    const nico = nonAdmins.find((u) => u.username === "nico")!;
    const p4 = buildApproval({
      kind: "projet_update",
      target: { type: "projet", id: "P4" },
      payload: { patch: { budget: 1 }, before: { budget: 10 }, category: "pilotage" } as never,
      companyId: "co1",
      programId: "P1",
      requester: nico,
      data,
    });
    expect(p4.chain).toEqual([
      { level: "projectOwner", usernames: ["olga"] },
      { level: "axisSponsor", usernames: ["adm"] },
    ]);
    expect(canDecide(adm, p4, data)).toBe(false);
    const s2 = decideApproval(
      p4,
      nonAdmins.find((u) => u.username === "olga")!,
      "approved"
    );
    expect(canDecide(adm, s2.approval, data)).toBe(true);
  });
});

describe("lot 6 — point 3 : valideur nommé sans compte actif = niveau vide", () => {
  const data = dataFor([...nonAdmins, adm]);
  const olga = nonAdmins.find((u) => u.username === "olga")!;
  const pilotage = { patch: { budget: 1 }, before: { budget: 10 }, category: "pilotage" } as never;

  it("sponsor d'axe « alice » sans compte : sauté vers le pilote (cible non confidentielle)", () => {
    const route = resolveApprovalRoute(
      "chantier_update",
      nonAdmins[2],
      { type: "chantier", id: "C1" },
      data,
      {
        patch: { budget: 1 },
        before: { budget: 0 },
        category: "pilotage",
      } as never
    );
    expect(route).toEqual({ mode: "request", chain: [{ level: "pilot", usernames: ["lea"] }] });
    // Avec un compte, alice est bien retenue (comportement inchangé).
    const withAlice = dataFor([...nonAdmins, adm, user("alice", role("axis_sponsor"))]);
    expect(
      resolveApprovalRoute(
        "chantier_update",
        nonAdmins[2],
        { type: "chantier", id: "C1" },
        withAlice,
        {
          patch: { budget: 1 },
          before: { budget: 0 },
          category: "pilotage",
        } as never
      )
    ).toEqual({
      mode: "request",
      chain: [
        { level: "axisSponsor", usernames: ["alice"] },
        { level: "pilot", usernames: ["lea"] },
      ],
    });
    // Compte désactivé : comme absent.
    const disabled = dataFor([
      ...nonAdmins,
      adm,
      user("alice", { ...role("axis_sponsor"), disabled: true }),
    ]);
    expect(
      resolveApprovalRoute("projet_update", olga, { type: "projet", id: "P1" }, disabled, pilotage)
    ).toEqual({
      mode: "request",
      chain: [
        { level: "chantierSponsor", usernames: ["paul"] },
        { level: "pilot", usernames: ["lea"] },
      ],
    });
  });

  it("sponsor de chantier « ghost » sans compte : sauté, sans palier admin ajouté", () => {
    expect(
      resolveApprovalRoute("projet_update", olga, { type: "projet", id: "P4" }, data, pilotage)
    ).toEqual({
      mode: "request",
      chain: [
        { level: "axisSponsor", usernames: ["adm"] },
        { level: "pilot", usernames: ["lea"] },
      ],
    });
  });

  it("correction KPI : même règle (aperçu = demande)", () => {
    const r = routeKpiCorrection(nonAdmins[2], indicators[0], data);
    expect(r.mode === "request" && r.chain).toEqual([{ level: "pilot", usernames: ["lea"] }]);
  });

  it("demande déjà en attente chez un valideur sans compte : palier repris par un admin", () => {
    const pending = {
      id: "SA-G",
      companyId: "co1",
      programId: "P1",
      kind: "projet_update",
      targetType: "projet",
      targetId: "P1",
      payload: pilotage,
      requestedBy: "zoe",
      requestedAt: "2026-09-01T00:00:00Z",
      approverRole: "axis_sponsor",
      approverUsernames: ["alice"],
      status: "pending",
      chain: [
        { level: "chantierSponsor", usernames: ["paul"], decidedBy: "adm", decision: "approved" },
        { level: "axisSponsor", usernames: ["alice"] },
      ],
      stepIndex: 1,
    } as unknown as StrategicApproval;
    expect(clearedApproval(pending, data).chain?.[1]).toEqual({
      level: "admin",
      usernames: ["adm"],
    });
    expect(canDecide(adm, pending, data)).toBe(true);
  });
});
