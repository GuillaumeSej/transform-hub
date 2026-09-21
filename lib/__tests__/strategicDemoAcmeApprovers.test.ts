import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import {
  canDecide,
  needsApproval,
  resolveApprover,
  type StrategicApproval,
} from "@/lib/strategicApprovals";
import { resolveStrategicOwnershipScope } from "@/lib/axisLogic";
import { resolveUserNav } from "@/lib/nav-config";
import type { AuthUser, Chantier, ChantierAction, StrategicAxis } from "@/types";

/**
 * Non-régression : jeu de données inspiré d'Acme (programme p-strat-demo-2026) tel que posé par
 * scripts/set-strategic-owners.js — sponsors d'axe (axis_sponsor), responsables de chantier
 * (chantier_owner), test.cto (strategic_lead). Chaque type de demande doit résoudre un
 * approbateur différent du demandeur typique, et chaque compte doit voir l'onglet Validation.
 */
const P = "p-strat-demo-2026";
const u = (username: string, ...roles: string[]) =>
  ({
    username,
    name: username,
    companyId: "c1",
    profiles: roles.map((role) => ({
      role,
      ...(role === "lever" || role === "cto" ? {} : { programId: P }),
    })),
  }) as unknown as AuthUser;

const users = [
  u("alex.roussel", "lever", "axis_sponsor"),
  u("marc.dubois", "lever", "axis_sponsor"),
  u("jean.dupont", "lever", "chantier_owner"),
  u("lucas.fournier", "lever", "chantier_owner"),
  u("ryan.cole", "lever", "chantier_owner"),
  u("test.cto", "cto", "strategic_lead"),
];
const by = (n: string) => users.find((x) => x.username === n)!;

// Rôle unique depuis la suppression de `StrategicAxis.sponsorName` (décision explicite : plus de
// duplication sponsor COMEX / responsable au niveau axe) — `owner` EST le sponsor de l'axe, donc
// le compte `axis_sponsor` (alex.roussel / marc.dubois) directement.
const axes = [
  {
    id: "AX-digital",
    companyId: "c1",
    programId: P,
    name: "Digitalisation & Data",
    owner: "alex.roussel",
  },
  {
    id: "AX-excop",
    companyId: "c1",
    programId: P,
    name: "Excellence Opérationnelle",
    owner: "marc.dubois",
  },
] as unknown as StrategicAxis[];
const chantiers = [
  {
    id: "CH-cyber",
    companyId: "c1",
    programId: P,
    axisIds: ["AX-digital"],
    name: "Cyber",
    pilote: "jean.dupont",
    sponsorName: "alex.roussel",
  },
  {
    id: "CH-data",
    companyId: "c1",
    programId: P,
    axisIds: ["AX-digital"],
    name: "Data",
    pilote: "lucas.fournier",
    sponsorName: "alex.roussel",
  },
  {
    id: "CH-lean",
    companyId: "c1",
    programId: P,
    axisIds: ["AX-excop"],
    name: "Lean",
    pilote: "ryan.cole",
    sponsorName: "marc.dubois",
  },
] as unknown as Chantier[];
const actions = [
  { id: "CA-1", companyId: "c1", chantierId: "CH-cyber", name: "SOC", owner: "contrib.acme" },
] as unknown as ChantierAction[];
const data = { programId: P, axes, chantiers, chantierActions: actions, indicators: [], users };

const approval = (
  kind: StrategicApproval["kind"],
  targetType: StrategicApproval["targetType"],
  targetId: string,
  requestedBy: string
) =>
  ({
    id: "A",
    companyId: "c1",
    programId: P,
    kind,
    targetType,
    targetId,
    targetName: targetId,
    payload: {},
    requestedBy,
    requestedAt: "2026-01-01",
    approverRole: "x",
    approverUsernames: [],
    status: "pending",
  }) as unknown as StrategicApproval;

describe("chaîne de validation stratégique — jeu Acme", () => {
  it("jalon : un contributeur est validé par le pilote du chantier", () => {
    const t = { type: "projet" as const, id: "CA-1", name: "SOC" };
    expect(resolveApprover("milestone", t, data).usernames).toEqual(["jean.dupont"]);
    expect(needsApproval("milestone", u("contrib.acme", "chantier_contributor"), t, data)).toBe(
      true
    );
    expect(
      canDecide(by("jean.dupont"), approval("milestone", "projet", "CA-1", "contrib.acme"), data)
    ).toBe(true);
    expect(
      canDecide(by("lucas.fournier"), approval("milestone", "projet", "CA-1", "contrib.acme"), data)
    ).toBe(false);
  });
  it("kpi_value : validé par le strategic_lead", () => {
    const r = resolveApprover("kpi_value", { type: "indicateur", id: "I", name: "I" }, data);
    expect(r.usernames).toEqual(["test.cto"]);
  });
  it("projet_create / chantier_delete : un responsable de chantier est validé par le sponsor d'axe", () => {
    for (const [kind, type, id] of [
      ["projet_create", "chantier", "CH-cyber"],
      ["chantier_delete", "chantier", "CH-cyber"],
    ] as const) {
      const r = resolveApprover(kind, { type, id, name: id }, data);
      expect(r.role).toBe("axis_sponsor");
      expect(r.usernames[0]).toBe("alex.roussel");
      expect(r.usernames).not.toContain("jean.dupont");
      expect(canDecide(by("alex.roussel"), approval(kind, type, id, "jean.dupont"), data)).toBe(
        true
      );
      expect(canDecide(by("jean.dupont"), approval(kind, type, id, "jean.dupont"), data)).toBe(
        false
      );
      // le sponsor d'un AUTRE axe ne décide pas
      expect(canDecide(by("marc.dubois"), approval(kind, type, id, "jean.dupont"), data)).toBe(
        false
      );
    }
  });
  it("projet_delete : validé par le responsable du chantier (≠ contributeur)", () => {
    const r = resolveApprover("projet_delete", { type: "projet", id: "CA-1", name: "SOC" }, data);
    expect(r).toMatchObject({ role: "chantier_owner", usernames: ["jean.dupont"] });
  });
  it("le strategic_lead peut toujours escalader", () => {
    expect(
      canDecide(by("test.cto"), approval("projet_create", "chantier", "CH-lean", "ryan.cole"), data)
    ).toBe(true);
  });

  it("tous les comptes (sponsors, responsables, lead) voient l'onglet Validation", () => {
    for (const usr of users) {
      const item = resolveUserNav(usr).find((n) => n.id === "validation");
      expect(item, usr.username).toBeDefined();
      expect(!item!.programTypes || item!.programTypes.includes("strategic"), usr.username).toBe(
        true
      );
    }
  });

  it("périmètre : sponsor voit ses chantiers, responsable uniquement les siens", () => {
    const s = resolveStrategicOwnershipScope(by("alex.roussel"), P, axes, chantiers, actions);
    expect(s.mode === "scoped" && Array.from(s.chantierIds).sort()).toEqual([
      "CH-cyber",
      "CH-data",
    ]);
    const o = resolveStrategicOwnershipScope(by("jean.dupont"), P, axes, chantiers, actions);
    expect(o.mode === "scoped" && Array.from(o.chantierIds)).toEqual(["CH-cyber"]);
  });
});

describe("script set-strategic-owners — plan", () => {
  const { plan } = createRequire(import.meta.url)("../../scripts/set-strategic-owners.js");
  const acmeUsers = [
    "alex.roussel",
    "lea.moreau",
    "marc.dubois",
    "claire.bernard",
    "elena.ruiz",
    "jean.dupont",
    "lucas.fournier",
    "nadia.klein",
    "pierre.lefevre",
    "ryan.cole",
    "sophie.martin",
    "thomas.petit",
    "test.cto",
  ].map((n) => ({
    username: n,
    docId: `${n}.c1`,
    profiles:
      n === "test.cto" ? [{ role: "cto" }, { role: "strategic_lead" }] : [{ role: "lever" }],
  }));
  // `plan()` lit `axis.owner` (sponsor de l'axe, rôle unique) — plus `axis.sponsorName`.
  const ax = ["digital", "durable", "excop", "expclient", "talents"].map((k, i) => ({
    id: `AX-${k}`,
    owner: acmeUsers[i].username,
  }));
  const ch = Array.from({ length: 13 }, (_, i) => ({
    id: `CH-${i}`,
    name: `c${i}`,
    axisId: ax[i % 5].id,
  }));
  it("13 chantiers couverts, pilote ≠ sponsor, un seul profil stratégique par compte", () => {
    const p = plan(ax, ch, acmeUsers);
    expect(p.chantiers).toHaveLength(13);
    for (const c of p.chantiers) {
      expect(c.pilote).toBeTruthy();
      expect(c.pilote).not.toBe(c.sponsorName);
    }
    expect(p.profiles.map((x: { username: string }) => x.username)).not.toContain("test.cto");
    expect(new Set(p.profiles.map((x: { username: string }) => x.username)).size).toBe(
      p.profiles.length
    );
  });
});
