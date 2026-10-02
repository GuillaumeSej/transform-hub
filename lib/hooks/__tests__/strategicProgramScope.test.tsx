import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierStaffing,
  Company,
  Indicator,
  IndicatorMeasurement,
  Program,
  StrategicAxis,
} from "@/types";
import type { StrategicApproval } from "@/lib/strategicApprovals";

/**
 * Lot 3 — « calculer sur le programme complet, afficher le périmètre du lecteur ».
 *
 * Le hook RÉEL `useStrategicData` (+ `useStrategicApprovals`) est monté pour plusieurs profils sur
 * le MÊME jeu de données (Firestore simulé) : un admin, une RH NON habilitée au niveau
 * « confidentiel » (destinataire des alertes de sur-staffing), le sponsor de l'axe A2 (sans
 * habilitation), le pilote du plan sans habilitation, le sponsor du chantier C1. Chaque test
 * vérifie (a) que le chiffre calculé sur `program` est IDENTIQUE pour tous les profils, (b) que
 * l'ancien calcul sur les données filtrées DIVERGEAIT (le bug), (c) qu'aucun libellé
 * confidentiel n'apparaît dans ce qui est affiché à un profil non habilité.
 */

// ── Jeu de données (hoisté : lu par les mocks Firestore) ──────────────────────────────────────
const fx = vi.hoisted(() => {
  const CONF = "confidentiel";
  const base = {
    companyId: "co1",
    programId: "P1",
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
  };
  const axes = [
    { ...base, id: "A1", name: "Axe Clients", stage: "s1", owner: "alice" },
    { ...base, id: "A2", name: "Axe Opérations", stage: "s1", owner: "sponsorA2" },
    // Axe confidentiel : tout ce qu'il porte est masqué aux non habilités (héritage).
    {
      ...base,
      id: "A3",
      name: "Axe Fusion Gamma",
      stage: "s1",
      owner: "bob",
      confidentialityLevel: CONF,
    },
  ];
  const chantiers = [
    // C1 dépend (FS) de C3 — chantier CONFIDENTIEL qui finit trop tard → C1 « critique ».
    {
      ...base,
      id: "C1",
      axisIds: ["A1"],
      name: "Refonte CRM",
      stage: "s1",
      pilote: "paul",
      dependencies: [{ targetId: "C3", type: "FS" }],
    },
    { ...base, id: "C2", axisIds: ["A2"], name: "Logistique", stage: "s1", dependencies: [] },
    {
      ...base,
      id: "C3",
      axisIds: ["A2"],
      name: "Projet Secret Alpha",
      stage: "s1",
      pilote: "carl",
      confidentialityLevel: CONF,
      dependencies: [],
    },
    {
      ...base,
      id: "C4",
      axisIds: ["A3"],
      name: "Due diligence Beta",
      stage: "s1",
      dependencies: [],
    },
  ];
  const ms = (passed: string[], current: string) => ({
    currentMilestone: current,
    passedMilestones: passed,
    checklists: {},
  });
  const actions = [
    {
      id: "P11",
      companyId: "co1",
      chantierId: "C1",
      name: "Lot CRM 1",
      owner: "paul",
      start: "2026-01-01",
      end: "2026-12-31",
      status: "s1",
      budget: 100000,
      milestones: ms(["E0"], "E1"),
      prerequisites: [{ id: "pr1", kind: "action", targetActionId: "P31" }],
    },
    {
      id: "P21",
      companyId: "co1",
      chantierId: "C2",
      name: "Entrepôt Nord",
      owner: "sponsorA2",
      start: "2026-01-01",
      end: "2026-12-31",
      status: "s1",
      budget: 200000,
      milestones: ms(["E0", "E1", "E2"], "E3"),
    },
    {
      id: "P31",
      companyId: "co1",
      chantierId: "C3",
      name: "Projet Secret Alpha",
      owner: "carl",
      start: "2026-03-01",
      end: "2027-06-30",
      status: "s1",
      budget: 300000,
      milestones: ms([], "E0"),
    },
    {
      id: "P41",
      companyId: "co1",
      chantierId: "C4",
      name: "Audit cible Beta",
      owner: "bob",
      start: "2026-01-01",
      end: "2026-12-31",
      status: "s1",
      budget: 500000,
      milestones: ms(["E0", "E1", "E2", "E3", "E4"], "E4"),
    },
  ];
  const ind = (id: string, axisId: string, extra: object) => ({
    ...base,
    id,
    axisId,
    name: `Indicateur ${id}`,
    kind: "quantitative",
    frequency: "monthly",
    objective: "≥ 100",
    objectiveValue: 100,
    direction: "up",
    responsibleRoles: [],
    status: "on_track",
    ...extra,
  });
  const indicators = [
    ind("I1", "A1", { name: "NPS clients" }),
    ind("I2", "A3", { name: "Synergies Gamma" }),
    ind("I3", "A2", { name: "Coût secret Alpha", chantierId: "C3" }),
    ind("I4", "A2", { name: "Taux de service" }),
  ];
  const m = (id: string, indicatorId: string, value: number) => ({
    id,
    companyId: "co1",
    indicatorId,
    period: "2026-09",
    value,
    reportedBy: "admin",
    reportedAt: "2026-09-30T10:00:00Z",
  });
  const measurements = [m("M1", "I1", 120), m("M2", "I2", 10), m("M3", "I3", 20)];
  const line = (id: string, chantierId: string, fte: number, extra: object = {}) => ({
    id,
    companyId: "co1",
    programId: "P1",
    chantierId,
    function: "IT",
    fte,
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    createdAt: "2026-01-01",
    ...extra,
  });
  const staffing = [
    line("S1", "C1", 1, { note: "Jean Dupont" }),
    line("S2", "C2", 1),
    line("S3", "C3", 2, { note: "Agent secret Martin", actionId: "P31" }),
    line("S4", "C4", 1, { note: "Avocat Durand" }),
  ];
  const company = {
    id: "co1",
    name: "Acme",
    confidentialityLevels: ["interne", CONF],
    roleClearance: {},
  };
  const u = (username: string, extra: object) => ({
    username,
    password: "x",
    name: `${username} Test`,
    firstName: username,
    lastName: "Test",
    companyId: "co1",
    profiles: [],
    ...extra,
  });
  const users = {
    admin: u("admin", { isCompanyAdmin: true }),
    rh: u("rh", {
      profiles: [{ role: "hr", programId: "P1" }],
      confidentialityClearance: "interne",
    }),
    sponsorA2: u("sponsorA2", {
      profiles: [{ role: "axis_sponsor", programId: "P1" }],
      confidentialityClearance: "interne",
    }),
    lea: u("lea", {
      profiles: [{ role: "strategic_lead", programId: "P1" }],
      confidentialityClearance: "interne",
    }),
    carl: u("carl", {
      profiles: [{ role: "chantier_owner", programId: "P1" }],
      confidentialityClearance: CONF,
    }),
    paul: u("paul", {
      profiles: [{ role: "chantier_owner", programId: "P1" }],
      confidentialityClearance: "interne",
    }),
    zoe: u("zoe", {
      profiles: [{ role: "projet_contributor", programId: "P1" }],
      confidentialityClearance: CONF,
    }),
  };
  const approvalBase = {
    companyId: "co1",
    programId: "P1",
    kind: "projet_update",
    targetType: "projet",
    targetId: "P31",
    targetName: "Projet Secret Alpha",
    requestedAt: "2026-09-20T10:00:00Z",
    status: "pending",
  };
  const approvals = [
    // LEGACY (sans chaîne) : l'approbateur se RÉSOUT sur les données — sur données filtrées, le
    // projet est inconnu et la demande retombait sur le pilote du plan.
    {
      ...approvalBase,
      id: "AP1",
      requestedBy: "zoe",
      approverRole: "chantier_owner",
      approverUsernames: [],
      payload: { patch: { description: "maj" }, before: {}, category: "pilotage" },
    },
    // À CHAÎNE : palier unique = pilote du plan (lea), qui ne voit pas C3.
    {
      ...approvalBase,
      id: "AP2",
      requestedBy: "carl",
      approverRole: "strategic_lead",
      approverUsername: "lea",
      approverUsernames: ["lea"],
      chain: [{ level: "pilot", usernames: ["lea"] }],
      stepIndex: 0,
      payload: {
        patch: { name: "Projet Secret Alpha v2" },
        before: { name: "Projet Secret Alpha" },
        category: "pilotage",
      },
    },
  ];
  return {
    axes,
    chantiers,
    actions,
    indicators,
    measurements,
    staffing,
    company,
    users,
    approvals,
    saveChantierAction: { calls: [] as unknown[] },
  };
});

const { sub, noop } = vi.hoisted(() => ({
  sub:
    (list: unknown[]) =>
    (_companyId: string, cb: (v: unknown[]) => void): (() => void) => {
      cb(list);
      return () => {};
    },
  noop: () => Promise.resolve(),
}));

vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/lib/firestore/strategicAxes", () => ({
  subscribeStrategicAxes: sub(fx.axes),
  saveStrategicAxis: noop,
  deleteStrategicAxis: noop,
}));
vi.mock("@/lib/firestore/chantiers", () => ({
  subscribeChantiers: sub(fx.chantiers),
  saveChantier: noop,
  deleteChantier: noop,
}));
vi.mock("@/lib/firestore/chantierActions", () => ({
  subscribeChantierActions: sub(fx.actions),
  saveChantierAction: (a: unknown) => {
    fx.saveChantierAction.calls.push(a);
    return Promise.resolve();
  },
  deleteChantierAction: noop,
}));
vi.mock("@/lib/firestore/indicators", () => ({
  subscribeIndicators: sub(fx.indicators),
  saveIndicator: noop,
  deleteIndicator: noop,
}));
vi.mock("@/lib/firestore/indicatorMeasurements", () => ({
  subscribeIndicatorMeasurements: sub(fx.measurements),
  saveIndicatorMeasurement: noop,
  deleteIndicatorMeasurement: noop,
}));
vi.mock("@/lib/firestore/chantierStaffing", () => ({
  subscribeChantierStaffing: sub(fx.staffing),
  saveChantierStaffing: noop,
  deleteChantierStaffing: noop,
}));
vi.mock("@/lib/firestore/admin", () => ({
  subscribeUsers: (cb: (v: unknown[]) => void) => {
    cb(Object.values(fx.users));
    return () => {};
  },
  subscribeCompanies: (cb: (v: unknown[]) => void) => {
    cb([fx.company]);
    return () => {};
  },
}));
vi.mock("@/lib/firestore/levers", () => ({ appendAuditEntries: noop }));
vi.mock("@/lib/firestore/strategicApprovals", () => ({
  subscribeStrategicApprovals: sub(fx.approvals),
  saveStrategicApproval: noop,
  decideStrategicApproval: (id: string, patch: object) =>
    Promise.resolve({ ...fx.approvals.find((a) => a.id === id), ...patch }),
}));

import { useStrategicData, type StrategicData } from "@/lib/hooks/useStrategicData";
import { useStrategicApprovals } from "@/lib/hooks/useStrategicApprovals";
import {
  axisProgressPct,
  canStartAction,
  chantierDependencyAlerts,
  chantierHealthState,
  countOnTrackAtRisk,
  indicatorStatusShares,
  programBlockedActions,
  programProgressPct,
} from "@/lib/axisLogic";
import {
  applyApprovedPayload,
  canDecide,
  type StrategicApprovalData,
} from "@/lib/strategicApprovals";
import { staffingOverruns } from "@/lib/staffingAlerts";
import {
  DEFAULT_STAFFING_THRESHOLDS,
  monthsOfYear,
  periodStaffingDetail,
  teamStaffingMatrix,
} from "@/lib/staffingRate";
import {
  OUT_OF_SCOPE_CHANTIER_ID,
  maskDependencyAlerts,
  maskDependencyOverviewRows,
  maskStaffingForDisplay,
} from "@/lib/strategicProgramScope";
import { chantierDependencyOverview } from "@/lib/chantierDependencyOverview";
import { budgetAxisShares, budgetChantierShares, rollupBudgets } from "@/lib/budgetRollup";
import { buildMyWorkspace } from "@/lib/myWorkspace";
import fr from "@/lib/i18n/dictionaries/fr";
import en from "@/lib/i18n/dictionaries/en";
import de from "@/lib/i18n/dictionaries/de";
import es from "@/lib/i18n/dictionaries/es";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Profile = keyof typeof fx.users;
type Snapshot = {
  data: StrategicData;
  sa: ReturnType<typeof useStrategicApprovals>;
};

const TODAY = "2026-10-02";
const FTE_BY_DEPT = { IT: 4 };
/** Libellés confidentiels qu'aucun affichage destiné à un non habilité ne doit contenir. */
const CONFIDENTIAL = [
  "Axe Fusion Gamma",
  "Projet Secret Alpha",
  "Due diligence Beta",
  "Audit cible Beta",
  "Agent secret Martin",
  "Avocat Durand",
  "Synergies Gamma",
  "Coût secret Alpha",
];
const expectNoConfidential = (value: unknown) => {
  const text = JSON.stringify(value);
  for (const label of CONFIDENTIAL) expect(text).not.toContain(label);
};

let roots: Root[] = [];
let containers: HTMLDivElement[] = [];

function mount(profile: Profile): Snapshot {
  const user = fx.users[profile] as unknown as AuthUser;
  const snap = {} as Snapshot;
  function Probe() {
    snap.data = useStrategicData("co1", "P1", user);
    snap.sa = useStrategicApprovals({ user, companyId: "co1", programId: "P1", data: snap.data });
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Probe />));
  roots.push(root);
  containers.push(container);
  return snap;
}

beforeEach(() => {
  fx.saveChantierAction.calls.length = 0;
});
afterEach(() => {
  act(() => roots.forEach((r) => r.unmount()));
  containers.forEach((c) => c.remove());
  roots = [];
  containers = [];
});

describe("lot 3 — périmètres de test (sanity)", () => {
  it("le hook filtre l'affichage mais expose le programme complet", () => {
    const admin = mount("admin").data;
    const rh = mount("rh").data;
    const sponsor = mount("sponsorA2").data;
    expect(admin.chantiers.map((c) => c.id)).toEqual(["C1", "C2", "C3", "C4"]);
    expect(rh.chantiers.map((c) => c.id)).toEqual(["C1", "C2"]);
    expect(sponsor.chantiers.map((c) => c.id)).toEqual(["C2"]);
    for (const d of [admin, rh, sponsor]) {
      expect(d.program.chantiers.map((c) => c.id)).toEqual(["C1", "C2", "C3", "C4"]);
      expect(d.program.staffing).toHaveLength(4);
      expect(d.program.measurements).toHaveLength(3);
    }
    expect(Array.from(rh.visibleChantierIds)).toEqual(["C1", "C2"]);
    expect(Array.from(sponsor.visibleActionIds)).toEqual(["P21"]);
  });
});

describe("1. taux de staffing et alertes de sur-staffing — mêmes pour tous", () => {
  const octIT = (d: StrategicData) =>
    teamStaffingMatrix(d.program.staffing, FTE_BY_DEPT, monthsOfYear(2026)).find(
      (r) => r.team === "IT"
    )!.cells[9];

  it("équipe IT octobre = 125 % pour l'admin, la RH non habilitée et le sponsor", () => {
    const rates = (["admin", "rh", "sponsorA2"] as Profile[]).map((p) => octIT(mount(p).data));
    expect(rates.map((c) => c.ratePct)).toEqual([125, 125, 125]);
    expect(rates.every((c) => c.level === "over")).toBe(true);
  });

  it("mêmes alertes (cloche, Mon espace, bandeau Effectifs) pour tous les destinataires", () => {
    const overruns = (["admin", "rh", "sponsorA2"] as Profile[]).map((p) =>
      staffingOverruns(
        mount(p).data.program.staffing,
        FTE_BY_DEPT,
        TODAY,
        DEFAULT_STAFFING_THRESHOLDS
      )
    );
    expect(overruns[0]).toEqual([
      expect.objectContaining({ team: "IT", peakRatePct: 125, peakMobilised: 5, peakAvailable: 4 }),
    ]);
    expect(overruns[1]).toEqual(overruns[0]);
    expect(overruns[2]).toEqual(overruns[0]);
  });

  it("AVANT (données filtrées) : 50 % pour la RH, 25 % pour le sponsor, aucune alerte", () => {
    const rh = mount("rh").data;
    const sponsor = mount("sponsorA2").data;
    const rate = (staffing: ChantierStaffing[]) =>
      teamStaffingMatrix(staffing, FTE_BY_DEPT, monthsOfYear(2026))[0].cells[9].ratePct;
    expect(rate(rh.staffing)).toBe(50);
    expect(rate(sponsor.staffing)).toBe(25);
    expect(staffingOverruns(rh.staffing, FTE_BY_DEPT, TODAY, DEFAULT_STAFFING_THRESHOLDS)).toEqual(
      []
    );
  });

  it("détail « qui est mobilisé où » : chantiers invisibles agrégés « autres chantiers », sans nom", () => {
    const rh = mount("rh").data;
    const display = maskStaffingForDisplay(rh.program.staffing, rh.visibleChantierIds);
    const oct = monthsOfYear(2026)[9];
    const detail = periodStaffingDetail(display, FTE_BY_DEPT, oct);
    expect(detail.ratePct).toBe(125);
    const groups = detail.teams[0].groups;
    const other = groups.find((g) => g.chantierId === OUT_OF_SCOPE_CHANTIER_ID)!;
    expect(other.fte).toBeCloseTo(3); // C3 (2) + C4 (1), une seule part
    expect(other.actionId).toBeUndefined();
    expect(groups.map((g) => g.chantierId).sort()).toEqual(["C1", "C2", OUT_OF_SCOPE_CHANTIER_ID]);
    expectNoConfidential(detail);
    expect(JSON.stringify(display)).not.toMatch(/"C3"|"C4"|"P31"/);
  });

  it("filtre d'axe : un chantier masqué d'un axe VISIBLE reste compté (suffixe d'axe, sans nom)", () => {
    const sponsor = mount("sponsorA2").data;
    const axisIdsByChantier = Object.fromEntries(
      sponsor.program.chantiers.map((c) => [c.id, c.axisIds])
    );
    const display = maskStaffingForDisplay(sponsor.program.staffing, sponsor.visibleChantierIds, {
      axisIdsByChantier,
      visibleAxisIds: new Set(sponsor.axes.map((a) => a.id)),
    });
    expect(display.map((e) => e.chantierId)).toEqual([
      OUT_OF_SCOPE_CHANTIER_ID,
      "C2",
      `${OUT_OF_SCOPE_CHANTIER_ID}:A2`,
      OUT_OF_SCOPE_CHANTIER_ID,
    ]);
    expectNoConfidential(display);
  });
});

describe("2. avancement d'axe et de programme, % trajectoire — mêmes pour tous", () => {
  it("axe A2 et programme identiques pour l'admin, la RH et le sponsor (et ≠ calcul filtré)", () => {
    const snaps = (["admin", "rh", "sponsorA2"] as Profile[]).map((p) => mount(p).data);
    const axisA2 = snaps.map((d) =>
      axisProgressPct("A2", d.program.chantiers, d.program.chantierActions, d.projetProgress)
    );
    const programPct = snaps.map((d) =>
      programProgressPct(
        d.program.axes,
        d.program.chantiers,
        d.program.chantierActions,
        d.projetProgress
      )
    );
    expect(new Set(axisA2).size).toBe(1);
    expect(new Set(programPct).size).toBe(1);
    // Avant : calcul sur les chantiers VISIBLES du lecteur.
    const [admin, rh] = snaps;
    expect(axisProgressPct("A2", rh.chantiers, rh.chantierActions, rh.projetProgress)).not.toBe(
      axisA2[0]
    );
    expect(
      programProgressPct(rh.axes, rh.chantiers, rh.chantierActions, rh.projetProgress)
    ).not.toBe(programPct[0]);
    expect(
      programProgressPct(admin.axes, admin.chantiers, admin.chantierActions, admin.projetProgress)
    ).toBe(programPct[0]);
  });

  it("Mon espace : ligne programme (pilote) et ligne d'axe (sponsor) = calcul programme complet", () => {
    const lea = mount("lea").data;
    const sponsor = mount("sponsorA2").data;
    const admin = mount("admin").data;
    const programs = [
      { id: "P1", companyId: "co1", name: "Plan", type: "strategic", currency: "EUR" },
    ] as unknown as Program[];
    const input = (d: StrategicData) => ({
      programId: "P1",
      axes: d.axes,
      chantiers: d.chantiers,
      chantierActions: d.chantierActions,
      indicators: d.indicators,
      measurements: d.measurements,
      projetProgress: d.projetProgress,
      approvals: [],
      program: d.program,
    });
    const t = (_k: string, fallback?: string) => fallback ?? _k;
    const users = Object.values(fx.users) as unknown as AuthUser[];
    const programRow = buildMyWorkspace(
      {
        user: fx.users.lea as unknown as AuthUser,
        strategic: input(lea),
        programs,
        users,
        today: TODAY,
      },
      t
    ).perimeter.find((p) => p.id === "program:P1");
    expect(programRow?.progressPct).toBe(
      programProgressPct(admin.axes, admin.chantiers, admin.chantierActions, admin.projetProgress)
    );
    const axisRow = buildMyWorkspace(
      { user: fx.users.sponsorA2 as unknown as AuthUser, strategic: input(sponsor), today: TODAY },
      t
    ).perimeter.find((p) => p.id === "axis:A2");
    expect(axisRow?.progressPct).toBe(
      axisProgressPct("A2", admin.chantiers, admin.chantierActions, admin.projetProgress)
    );
  });

  it("% indicateurs sur la trajectoire : tous les indicateurs (gris compris), même chiffre", () => {
    const shares = (["admin", "rh", "sponsorA2"] as Profile[]).map((p) => {
      const d = mount(p).data;
      return indicatorStatusShares(
        countOnTrackAtRisk(d.program.indicators, d.program.measurements)
      );
    });
    expect(shares[0]).toMatchObject({ pctOnTrack: 25, pctAtRisk: 50, pctNoData: 25 });
    expect(shares[1]).toEqual(shares[0]);
    expect(shares[2]).toEqual(shares[0]);
    // Avant : 50 % sur la trajectoire pour la RH (I1 + I4 seulement).
    const rh = mount("rh").data;
    expect(
      indicatorStatusShares(countOnTrackAtRisk(rh.indicators, rh.measurements)).pctOnTrack
    ).toBe(50);
  });
});

describe("3. santé chantier, dépendances, prérequis — résolus sur le programme complet", () => {
  const LABEL = "Chantier hors de votre périmètre";
  const PREREQ = "Prérequis hors de votre périmètre";

  it("C1 « critique » pour tous (dépendance vers le chantier confidentiel C3)", () => {
    const states = (["admin", "rh", "paul"] as Profile[]).map((p) => {
      const d = mount(p).data;
      const c1 = d.program.chantiers.find((c) => c.id === "C1")!;
      return chantierHealthState(
        c1,
        d.program.indicators,
        d.program.measurements,
        d.program.chantiers,
        d.program.chantierActions
      );
    });
    expect(states).toEqual(["critical", "critical", "critical"]);
    // Avant : sur données filtrées, la dépendance vers C3 disparaissait.
    const rh = mount("rh").data;
    const c1 = rh.chantiers.find((c) => c.id === "C1")!;
    expect(
      chantierHealthState(c1, rh.indicators, rh.measurements, rh.chantiers, rh.chantierActions)
    ).not.toBe("critical");
  });

  it("Mon espace : le sponsor de C1 (non habilité) voit C1 en rouge", () => {
    const paul = mount("paul").data;
    const t = (_k: string, fallback?: string) => fallback ?? _k;
    const row = buildMyWorkspace(
      {
        user: fx.users.paul as unknown as AuthUser,
        strategic: {
          programId: "P1",
          axes: paul.axes,
          chantiers: paul.chantiers,
          chantierActions: paul.chantierActions,
          indicators: paul.indicators,
          measurements: paul.measurements,
          projetProgress: paul.projetProgress,
          program: paul.program,
        },
        today: TODAY,
      },
      t
    ).perimeter.find((p) => p.id === "chantier:C1");
    expect(row?.health).toBe("red");
    expectNoConfidential(row);
  });

  it("alerte de dépendance : conservée, l'extrémité masquée renommée, aucun nom confidentiel", () => {
    const rh = mount("rh").data;
    const alerts = maskDependencyAlerts(
      chantierDependencyAlerts(rh.program.chantiers, rh.program.chantierActions),
      rh.visibleChantierIds,
      LABEL,
      "source"
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      sourceId: "C1",
      sourceName: "Refonte CRM",
      targetName: LABEL,
    });
    expect(alerts[0].message).toContain(LABEL);
    expectNoConfidential(alerts);
    // Sponsor A2 : ni C1 ni C3 visibles → aucune alerte affichée.
    const sponsor = mount("sponsorA2").data;
    expect(
      maskDependencyAlerts(
        chantierDependencyAlerts(sponsor.program.chantiers, sponsor.program.chantierActions),
        sponsor.visibleChantierIds,
        LABEL,
        "either"
      )
    ).toEqual([]);
  });

  it("carte « Dépendances » de C1 : prédécesseurs masqués, statut conservé, non cliquables", () => {
    const rh = mount("rh").data;
    const admin = mount("admin").data;
    const c1 = rh.chantiers.find((c) => c.id === "C1")!;
    const rows = maskDependencyOverviewRows(
      chantierDependencyOverview(c1, rh.program.chantiers, rh.program.chantierActions, {
        progressOf: rh.projetProgress,
      }),
      rh.visibleChantierIds,
      LABEL
    );
    const adminRows = chantierDependencyOverview(c1, admin.chantiers, admin.chantierActions, {
      progressOf: admin.projetProgress,
    });
    expect(rows.map((r) => [r.key, r.status])).toEqual(adminRows.map((r) => [r.key, r.status]));
    expect(rows.every((r) => r.otherName === LABEL && r.otherId === undefined)).toBe(true);
    expectNoConfidential(rows);
  });

  it("prérequis de P11 : bloqué pour tous, « hors de votre périmètre » au lieu de « introuvable »", () => {
    const rh = mount("rh").data;
    const admin = mount("admin").data;
    const p11 = rh.chantierActions.find((a) => a.id === "P11")!;
    const scoped = canStartAction(p11, rh.program.chantierActions, rh.projetProgress, {
      visibleActionIds: rh.visibleActionIds,
      outOfScopeLabel: PREREQ,
    });
    expect(scoped).toEqual({ blocked: true, reasons: [PREREQ] });
    expect(canStartAction(p11, admin.program.chantierActions, admin.projetProgress)).toEqual({
      blocked: true,
      reasons: ['En attente de "Projet Secret Alpha"'],
    });
    // Avant : cible cherchée dans les seuls projets visibles → « introuvable ».
    expect(canStartAction(p11, rh.chantierActions, rh.projetProgress).reasons[0]).toMatch(
      /introuvable/
    );
    const blocked = programBlockedActions(rh.chantierActions, rh.projetProgress, {
      allActions: rh.program.chantierActions,
      visibleActionIds: rh.visibleActionIds,
      outOfScopeLabel: PREREQ,
    });
    expect(blocked.map((b) => [b.action.id, b.reasons])).toEqual([["P11", [PREREQ]]]);
    expectNoConfidential(blocked);
  });

  it("libellés traduits dans les quatre dictionnaires", () => {
    for (const dict of [fr, en, de, es] as Record<string, string>[]) {
      expect(dict["strategicPrerequisite.outOfScope"]).toBeTruthy();
      expect(dict["strategicScope.outOfScopeChantier"]).toBeTruthy();
      expect(dict["effectifs.staffingRate.otherChantiers"]).toBeTruthy();
      expect(dict["effectifs.moneyBudget.otherChantiers"]).toBeTruthy();
    }
    expect((fr as Record<string, string>)["strategicPrerequisite.outOfScope"]).toBe(PREREQ);
  });
});

describe("4. validation : routage, décision et effets sur le programme complet", () => {
  it("demande legacy sur un projet confidentiel : le pilote non habilité ne peut plus décider", () => {
    const lea = mount("lea");
    expect(lea.sa.pending.map((a) => a.id)).toEqual(["AP2"]); // AP1 n'est pas pour lui
    const carl = mount("carl");
    expect(carl.sa.pending.map((a) => a.id)).toContain("AP1"); // vrai approbateur : pilote de C3
    // Avant : décision calculée sur les données filtrées du pilote → il pouvait décider à tort.
    const filtered = { ...lea.data, programId: "P1" } as unknown as StrategicApprovalData;
    const ap1 = fx.approvals[0] as unknown as StrategicApproval;
    expect(canDecide(fx.users.lea as unknown as AuthUser, ap1, filtered)).toBe(true);
  });

  it("approbation par un décideur qui ne voit pas le projet : effet appliqué, plus « Projet introuvable »", async () => {
    const lea = mount("lea");
    const ap2 = fx.approvals[1] as unknown as StrategicApproval;
    const filtered = { ...lea.data, programId: "P1" } as unknown as StrategicApprovalData;
    expect(() => applyApprovedPayload(ap2, filtered)).toThrow(/Projet introuvable/);
    await act(async () => {
      await lea.sa.approve("AP2");
    });
    expect(fx.saveChantierAction.calls).toEqual([
      expect.objectContaining({ id: "P31", name: "Projet Secret Alpha v2" }),
    ]);
  });
});

describe("5. budget : puce = somme du détail, mêmes montants pour tous", () => {
  it("total programme et montant de l'axe A2 identiques pour l'admin, la RH et le sponsor", () => {
    const totals = (["admin", "rh", "sponsorA2"] as Profile[]).map((p) => {
      const d = mount(p).data;
      const rollup = rollupBudgets(d.program.axes, d.program.chantiers, d.program.chantierActions);
      const shares = budgetAxisShares(rollup, d.axes);
      const sum = shares.reduce((s, x) => s + x.figures.allocated, 0);
      // Puce du dashboard (= centre du donut Effectifs) = somme de son détail.
      expect(sum).toBe(rollup.programme.allocated);
      expectNoConfidential(shares);
      return { total: rollup.programme.allocated, a2: rollup.axes.get("A2")!.allocated, shares };
    });
    expect(totals.map((x) => x.total)).toEqual([1100000, 1100000, 1100000]);
    expect(totals.map((x) => x.a2)).toEqual([500000, 500000, 500000]);
    // Admin : trois axes, pas de part agrégée. RH : A3 masqué → « Autres axes » 500 000.
    expect(totals[0].shares.map((s) => s.kind)).toEqual(["axis", "axis", "axis"]);
    expect(totals[1].shares.at(-1)).toEqual({
      kind: "otherAxes",
      figures: { allocated: 500000, consumed: 0 },
    });
  });

  it("drill-down A2 du sponsor : C2 + « Autres chantiers » = 500 000 (avant : 200 000)", () => {
    const sponsor = mount("sponsorA2").data;
    const rollup = rollupBudgets(
      sponsor.program.axes,
      sponsor.program.chantiers,
      sponsor.program.chantierActions
    );
    const shares = budgetChantierShares(rollup, "A2", sponsor.chantiers);
    expect(shares).toEqual([
      { kind: "chantier", id: "C2", figures: { allocated: 200000, consumed: 0 } },
      { kind: "otherChantiers", figures: { allocated: 300000, consumed: 0 } },
    ]);
    // Avant : rollup sur les chantiers visibles du sponsor.
    const before = rollupBudgets(sponsor.axes, sponsor.chantiers, sponsor.chantierActions);
    expect(before.axes.get("A2")!.allocated).toBe(200000);
  });
});

// Garde de typage : le jeu de données respecte les types du domaine.
void (fx.axes as unknown as StrategicAxis[]);
void (fx.chantiers as unknown as Chantier[]);
void (fx.actions as unknown as ChantierAction[]);
void (fx.indicators as unknown as Indicator[]);
void (fx.measurements as unknown as IndicatorMeasurement[]);
void (fx.company as unknown as Company);
