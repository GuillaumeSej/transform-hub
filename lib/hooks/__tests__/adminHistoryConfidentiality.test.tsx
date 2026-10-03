import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AuditEntry, AuthUser } from "@/types";
import type { StrategicApproval } from "@/lib/strategicApprovals";

/**
 * Lot 6 — point 1 : le JOURNAL (/admin/history) ne révèle jamais le contenu d'un élément
 * confidentiel à un lecteur non habilité (pilote du plan, RH, sponsors…), ni pour les entrées
 * d'avant ce lot (résolution sur les données actuelles, cible disparue → masquée), ni pour les
 * nouvelles (niveaux ENREGISTRÉS à l'écriture). Les habilités et les admins voient tout.
 */

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
  ];
  const chantiers = [
    {
      ...base,
      id: "C1",
      axisIds: ["A1"],
      name: "Refonte CRM",
      stage: "s1",
      pilote: "paul",
      dependencies: [],
    },
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
  ];
  const actions = [
    {
      id: "P31",
      companyId: "co1",
      chantierId: "C3",
      name: "Lot Secret Alpha",
      owner: "carl",
      contributors: ["zoe"],
      start: "2026-01-01",
      end: "2026-12-31",
      status: "s1",
      budget: 300000,
      milestones: { currentMilestone: "E0", passedMilestones: [], checklists: {} },
    },
  ];
  const indicators = [
    {
      ...base,
      id: "I3",
      axisId: "A2",
      chantierId: "C3",
      name: "Coût secret Alpha",
      kind: "quantitative",
      frequency: "monthly",
      objective: "≥ 1",
      objectiveValue: 1,
      direction: "up",
      responsibleRoles: [],
      status: "on_track",
    },
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
    lea: u("lea", {
      profiles: [{ role: "strategic_lead", programId: "P1" }],
      confidentialityClearance: "interne",
    }),
    rh: u("rh", {
      profiles: [{ role: "hr", programId: "P1" }],
      confidentialityClearance: "interne",
    }),
    sponsorA2: u("sponsorA2", {
      profiles: [{ role: "axis_sponsor", programId: "P1" }],
      confidentialityClearance: "interne",
    }),
    paul: u("paul", {
      profiles: [{ role: "chantier_owner", programId: "P1" }],
      confidentialityClearance: "interne",
    }),
    carl: u("carl", {
      profiles: [{ role: "chantier_owner", programId: "P1" }],
      confidentialityClearance: CONF,
    }),
    zoe: u("zoe", {
      profiles: [{ role: "projet_contributor", programId: "P1" }],
      confidentialityClearance: CONF,
    }),
  };
  // Demande de création d'un chantier CONFIDENTIEL rattaché à l'axe NON confidentiel A2 (refusée :
  // le chantier n'existe pas) — l'entrée du journal cible l'axe, le nom est dans son texte.
  const approvals = [
    {
      id: "AP-CC",
      companyId: "co1",
      programId: "P1",
      kind: "chantier_create",
      targetType: "axe",
      targetId: "A2",
      targetName: "Chantier Zeta secret",
      requestedBy: "carl",
      requestedAt: "2026-09-01T10:00:00Z",
      approverRole: "strategic_lead",
      approverUsernames: ["admin"],
      status: "rejected",
      decidedBy: "admin",
      decidedAt: "2026-09-02T10:00:00Z",
      payload: {
        chantier: {
          ...base,
          id: "CH-zeta",
          axisIds: ["A2"],
          name: "Chantier Zeta secret",
          stage: "s1",
          dependencies: [],
          confidentialityLevel: CONF,
        },
      },
    },
  ];
  return {
    CONF,
    axes,
    chantiers,
    actions,
    indicators,
    company,
    users,
    approvals,
    audit: [] as unknown[],
    written: [] as unknown[],
    reader: null as unknown,
  };
});

const { sub, noop } = vi.hoisted(() => ({
  sub:
    (get: () => unknown[]) =>
    (_companyId: string, cb: (v: unknown[]) => void): (() => void) => {
      cb(get());
      return () => {};
    },
  noop: () => Promise.resolve(),
}));

vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/lib/firestore/strategicAxes", () => ({
  subscribeStrategicAxes: sub(() => fx.axes),
  saveStrategicAxis: noop,
}));
vi.mock("@/lib/firestore/chantiers", () => ({
  subscribeChantiers: sub(() => fx.chantiers),
  saveChantier: noop,
}));
vi.mock("@/lib/firestore/chantierActions", () => ({
  subscribeChantierActions: sub(() => fx.actions),
  saveChantierAction: noop,
}));
vi.mock("@/lib/firestore/indicators", () => ({
  subscribeIndicators: sub(() => fx.indicators),
  saveIndicator: noop,
}));
vi.mock("@/lib/firestore/indicatorMeasurements", () => ({
  subscribeIndicatorMeasurements: sub(() => []),
  saveIndicatorMeasurement: noop,
  deleteIndicatorMeasurement: noop,
}));
vi.mock("@/lib/firestore/chantierStaffing", () => ({
  subscribeChantierStaffing: sub(() => []),
  saveChantierStaffing: noop,
  deleteChantierStaffing: noop,
}));
vi.mock("@/lib/firestore/strategicCascade", () => ({
  deleteWithCascade: noop,
  commitApprovalEffects: noop,
}));
vi.mock("@/lib/firestore/strategicApprovals", () => ({
  subscribeStrategicApprovals: sub(() => fx.approvals),
  saveStrategicApproval: noop,
  decideStrategicApproval: noop,
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
  subscribeAccountAudit: (cb: (v: unknown[]) => void) => {
    cb([]);
    return () => {};
  },
}));
vi.mock("@/lib/firestore/levers", () => ({
  appendAuditEntries: (_companyId: string, entries: unknown[]) => {
    fx.written.push(...entries);
    return Promise.resolve();
  },
  subscribeAuditLog: (cb: (v: unknown[]) => void) => {
    cb(fx.audit);
    return () => {};
  },
  subscribeLevers: (cb: (v: unknown[]) => void) => {
    cb([]);
    return () => {};
  },
  filterAuditByCompany: (audit: unknown[]) => audit,
}));
vi.mock("@/lib/hooks/useRole", () => ({ useRole: () => ({ user: fx.reader }) }));

import AdminHistoryPage from "@/app/(app)/admin/history/page";
import { I18nProvider } from "@/lib/i18n/useTranslation";
import { useStrategicData, type StrategicData } from "@/lib/hooks/useStrategicData";
import { useStrategicApprovals } from "@/lib/hooks/useStrategicApprovals";
import { buildApprovalAuditEntry } from "@/lib/strategicApprovals";
import {
  makeCreatedAuditEntry,
  makeDeletedAuditEntry,
  buildUpdateAuditEntries,
  withTargetConfidentiality,
} from "@/lib/strategicAuditLogic";
import {
  canReadAuditEntry,
  maskAuditForReader,
  OUT_OF_SCOPE_AUDIT_LABEL,
  type AuditClearanceData,
} from "@/lib/strategicAuditClearance";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Profile = keyof typeof fx.users;

// ── Journal (entrées produites par les VRAIS constructeurs) ──────────────────────────────────
const kpiApproval = {
  id: "AP3",
  companyId: "co1",
  programId: "P1",
  kind: "kpi_value",
  targetType: "indicateur",
  targetId: "I3",
  targetName: "Coût secret Alpha",
  requestedBy: "zoe",
  requestedByName: "zoe Test",
  requestedAt: "2026-09-20T10:00:00Z",
  approverRole: "chantier_owner",
  approverUsernames: ["carl"],
  status: "approved",
  decidedBy: "carl",
  decidedByName: "carl Test",
  decidedAt: "2026-09-21T10:00:00Z",
  decisionComment: "Recalage validé",
  reason: "Recalage confidentiel",
  payload: { period: "2026-09", value: 98765, measurementId: "M3", previousValue: 20 },
} as unknown as StrategicApproval;

const OLD: AuditEntry[] = [
  // Entrées d'AVANT le lot 6 (aucun niveau enregistré) : résolues sur les données actuelles.
  {
    ...makeCreatedAuditEntry("carl Test", "C3", "chantier", "Projet Secret Alpha"),
    ts: "2026-09-01T08:00:00Z",
  },
  {
    ...buildUpdateAuditEntries(
      "carl Test",
      "C3",
      { budget: 4242000 },
      { budget: 300000 } as Record<string, unknown>,
      { budget: 4242000 } as Record<string, unknown>
    )[0],
    ts: "2026-09-02T08:00:00Z",
  },
  buildApprovalAuditEntry(kpiApproval, "requested", undefined, "2026-09-20T10:00:00Z"),
  buildApprovalAuditEntry(kpiApproval, "approved", undefined, "2026-09-21T10:00:00Z"),
  {
    ts: "2026-09-02T10:00:00Z",
    user: "admin Test",
    action: "approval_rejected",
    entity: "A2",
    field: "validation:chantier_create",
    old: "pending",
    new: "admin Test a refusé la création du chantier « Chantier Zeta secret » demandé(e) par carl Test",
  },
  // Cible SUPPRIMÉE depuis, entrée sans enregistrement : masquée par prudence (non-admin).
  {
    ...makeDeletedAuditEntry("carl Test", "CH-omega", "chantier", "Chantier fantôme Omega"),
    ts: "2026-09-03T08:00:00Z",
  },
  // Non confidentiel : visible de tous.
  {
    ...makeCreatedAuditEntry("paul Test", "C1", "chantier", "Refonte CRM"),
    ts: "2026-09-04T08:00:00Z",
  },
  {
    ts: "2026-09-05T08:00:00Z",
    user: "cto",
    action: "updated",
    entity: "L001",
    field: "name",
    old: "a",
    new: "Levier Visible",
  },
];
// Lot 6 : cible supprimée mais niveaux ENREGISTRÉS à l'écriture.
const NEW: AuditEntry[] = [
  ...withTargetConfidentiality(
    [
      {
        ...makeDeletedAuditEntry("carl Test", "CA-delta", "projet", "Projet Delta secret"),
        ts: "2026-09-06T08:00:00Z",
      },
    ],
    ["confidentiel"]
  ),
  ...withTargetConfidentiality(
    [
      {
        ...makeDeletedAuditEntry("paul Test", "CA-visible", "projet", "Projet Public Epsilon"),
        ts: "2026-09-07T08:00:00Z",
      },
    ],
    []
  ),
];

const CONFIDENTIAL = [
  "Projet Secret Alpha",
  "Coût secret Alpha",
  "98765",
  "4242000",
  "300000",
  "Recalage",
  "Chantier Zeta secret",
  "Chantier fantôme Omega",
  "Projet Delta secret",
  "C3",
  "I3",
  "CA-delta",
  "CH-omega",
];
const PUBLIC = ["Refonte CRM", "Levier Visible", "Projet Public Epsilon"];

let roots: Root[] = [];
let containers: HTMLDivElement[] = [];

function renderHistory(profile: Profile): string {
  fx.reader = fx.users[profile];
  fx.audit = [...OLD, ...NEW];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <I18nProvider>
        <AdminHistoryPage />
      </I18nProvider>
    )
  );
  roots.push(root);
  containers.push(container);
  return container.textContent ?? "";
}

function mountData(profile: Profile) {
  const user = fx.users[profile] as unknown as AuthUser;
  const snap = {} as { data: StrategicData; sa: ReturnType<typeof useStrategicApprovals> };
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
  fx.written.length = 0;
});
afterEach(() => {
  act(() => roots.forEach((r) => r.unmount()));
  containers.forEach((c) => c.remove());
  roots = [];
  containers = [];
});

describe("lot 6 — journal /admin/history sous confidentialité", () => {
  it("pilote, RH, sponsor d'axe et sponsor de chantier non habilités : aucune chaîne confidentielle", () => {
    for (const p of ["lea", "rh", "sponsorA2", "paul"] as Profile[]) {
      const text = renderHistory(p);
      for (const s of CONFIDENTIAL) expect(text, `${p} voit « ${s} »`).not.toContain(s);
      for (const s of PUBLIC) expect(text, `${p} ne voit pas « ${s} »`).toContain(s);
      // Les entrées restent listées : date, auteur, type d'action, cible « hors périmètre ».
      expect(text).toContain(OUT_OF_SCOPE_AUDIT_LABEL);
      expect(text).toContain("carl Test");
      expect(text).toContain("Validation demandée");
      expect(text).toContain(`${OLD.length + NEW.length} entrée(s)`);
    }
  });

  it("un habilité voit tout ce qui est résoluble ; l'entrée ancienne d'une cible disparue reste masquée", () => {
    const text = renderHistory("carl");
    for (const s of CONFIDENTIAL.filter(
      (x) => x !== "Chantier fantôme Omega" && x !== "CH-omega"
    )) {
      expect(text, `carl ne voit pas « ${s} »`).toContain(s);
    }
    // Prudence : cible supprimée, entrée d'avant le lot 6 (aucun niveau enregistré).
    expect(text).not.toContain("Chantier fantôme Omega");
  });

  it("l'admin voit tout, sans aucun masquage", () => {
    const text = renderHistory("admin");
    for (const s of [...CONFIDENTIAL, ...PUBLIC]) expect(text, `admin : « ${s} »`).toContain(s);
    expect(text).not.toContain(OUT_OF_SCOPE_AUDIT_LABEL);
  });

  it("masquage pur : paramètres de confidentialité pas encore chargés → entrée confidentielle masquée", () => {
    const data: AuditClearanceData = {
      axes: fx.axes as never,
      chantiers: fx.chantiers as never,
      chantierActions: fx.actions as never,
      indicators: fx.indicators as never,
      confidentiality: null,
    };
    const carl = fx.users.carl as unknown as AuthUser;
    expect(canReadAuditEntry(OLD[0], carl, data)).toBe(false);
    expect(canReadAuditEntry(OLD[0], carl, { ...data, confidentiality: {} })).toBe(true);
    const [masked] = maskAuditForReader([OLD[2]], fx.users.lea as unknown as AuthUser, data);
    expect(masked).toEqual({
      ts: OLD[2].ts,
      user: OLD[2].user,
      action: "approval_requested",
      entity: OUT_OF_SCOPE_AUDIT_LABEL,
      field: "validation:kpi_value",
      old: "",
      new: "",
      masked: true,
    });
  });
});

describe("lot 6 — niveaux de confidentialité ENREGISTRÉS dans chaque nouvelle entrée", () => {
  it("création, modification, suppression (chantier, projet, indicateur, axe)", async () => {
    const s = mountData("admin");
    await act(async () => {
      await s.data.updateChantier("C3", { description: "maj" });
      await s.data.updateChantier("C1", { description: "maj" });
      await s.data.updateChantierAction("P31", { description: "maj" });
      await s.data.updateIndicator("I3", { objective: "≥ 2" });
      await s.data.updateAxis("A1", { description: "maj" });
      await s.data.removeChantier("C3");
    });
    const written = fx.written as AuditEntry[];
    const byEntity = (id: string) => written.filter((e) => e.entity === id);
    expect(byEntity("C3").map((e) => [e.action, e.targetConfidentiality])).toEqual([
      ["updated", ["confidentiel"]],
      ["deleted", ["confidentiel"]],
    ]);
    expect(byEntity("P31")[0].targetConfidentiality).toEqual(["confidentiel"]);
    expect(byEntity("I3")[0].targetConfidentiality).toEqual(["confidentiel"]);
    expect(byEntity("C1")[0].targetConfidentiality).toEqual([]);
    expect(byEntity("A1")[0].targetConfidentiality).toEqual([]);
    // Rendre un chantier confidentiel : l'entrée porte le niveau (état APRÈS).
    fx.written.length = 0;
    await act(async () => {
      await s.data.updateChantier("C1", { confidentialityLevel: "confidentiel" });
    });
    expect((fx.written as AuditEntry[])[0].targetConfidentiality).toEqual(["confidentiel"]);
    // Création : niveaux de l'élément créé.
    fx.written.length = 0;
    await act(async () => {
      await s.data.createChantier({
        axisIds: ["A2"],
        name: "Nouveau secret",
        stage: "s1",
        confidentialityLevel: "confidentiel",
      });
      await s.data.createChantierAction({
        chantierId: "C3",
        name: "Nouveau lot",
        start: "2026-01-01",
        end: "2026-02-01",
        status: "s1",
      });
    });
    expect((fx.written as AuditEntry[]).map((e) => e.targetConfidentiality)).toEqual([
      ["confidentiel"],
      ["confidentiel"],
    ]);
  });

  it("entrées des demandes de validation (demande puis décision)", async () => {
    const s = mountData("zoe");
    await act(async () => {
      await s.sa.request("projet_update", { type: "projet", id: "P31", name: "Lot Secret Alpha" }, {
        patch: { budget: 1 },
        before: { budget: 300000 },
        category: "pilotage",
      } as never);
    });
    const [entry] = fx.written as AuditEntry[];
    expect(entry).toMatchObject({
      action: "approval_requested",
      entity: "P31",
      targetConfidentiality: ["confidentiel"],
    });
    // Une telle entrée, même après suppression de P31, reste masquée aux non-habilités.
    const gone: AuditClearanceData = {
      axes: [],
      chantiers: [],
      chantierActions: [],
      indicators: [],
      confidentiality: { levels: ["interne", "confidentiel"] },
    };
    expect(canReadAuditEntry(entry, fx.users.lea as unknown as AuthUser, gone)).toBe(false);
    expect(canReadAuditEntry(entry, fx.users.carl as unknown as AuthUser, gone)).toBe(true);
    // Le constructeur pur recopie le snapshot de la demande.
    expect(
      buildApprovalAuditEntry(
        { ...kpiApproval, targetConfidentiality: ["confidentiel"] },
        "approved"
      ).targetConfidentiality
    ).toEqual(["confidentiel"]);
  });
});
