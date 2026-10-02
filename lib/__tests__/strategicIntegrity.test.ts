import { describe, expect, it } from "vitest";
import {
  AxisNotEmptyError,
  TARGET_DELETED_REASON,
  UNASSIGNED_AXIS_ID,
  axisDeletionBlockers,
  cascadeWriteCount,
  chantiersWithoutAxis,
  dropOrphanIndicators,
  dropOrphanStaffing,
  isUnassignedAxis,
  mergeCascadePlans,
  planDeletionCascade,
  withUnassignedAxisGroup,
  type CascadeSnapshot,
} from "@/lib/strategicIntegrity";
import { staffingRatePoint } from "@/lib/staffingRate";
import { programRoadmap } from "@/lib/axisLogic";
import {
  applyApprovedPayload,
  buildApprovalAlerts,
  bucketApprovals,
  type StrategicApproval,
  type StrategicApprovalData,
} from "@/lib/strategicApprovals";
import type {
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierStaffing,
  Indicator,
  IndicatorMeasurement,
  StrategicAxis,
} from "@/types";

/**
 * Lot 3 — intégrité référentielle du Plan Stratégique : cascade de suppression, filtre défensif
 * des orphelins, axe supprimé (« Sans axe »), demandes annulées.
 */

const axis = (id: string, name = id): StrategicAxis => ({
  id,
  companyId: "c",
  programId: "P",
  name,
  stage: "s",
  createdAt: "",
  lastUpdate: "",
});
const chantier = (id: string, extra: Partial<Chantier> = {}): Chantier => ({
  id,
  companyId: "c",
  programId: "P",
  axisIds: ["AX1"],
  name: id,
  stage: "s",
  dependencies: [],
  createdAt: "",
  lastUpdate: "",
  ...extra,
});
const projet = (id: string, chantierId: string, extra: Partial<ChantierAction> = {}) =>
  ({
    id,
    companyId: "c",
    chantierId,
    name: id,
    start: "2026-01-01",
    end: "2026-12-31",
    status: "s",
    ...extra,
  }) as ChantierAction;
const line = (
  id: string,
  chantierId: string,
  fte: number,
  actionId?: string
): ChantierStaffing => ({
  id,
  companyId: "c",
  programId: "P",
  chantierId,
  function: "IT",
  fte,
  startDate: "2026-01-01",
  createdAt: "",
  ...(actionId ? { actionId } : {}),
});
const indicator = (id: string, extra: Partial<Indicator> = {}) =>
  ({
    id,
    companyId: "c",
    programId: "P",
    axisId: "AX1",
    name: id,
    kind: "quantitative",
    frequency: "monthly",
    objective: "",
    responsibleRoles: [],
    status: "on_track",
    createdAt: "",
    lastUpdate: "",
    ...extra,
  }) as Indicator;
const measure = (id: string, indicatorId: string): IndicatorMeasurement => ({
  id,
  companyId: "c",
  indicatorId,
  period: "2026-09",
  value: 1,
  reportedBy: "u",
  reportedAt: "",
});
const pending = (id: string, extra: Partial<StrategicApproval>): StrategicApproval => ({
  id,
  companyId: "c",
  programId: "P",
  kind: "projet_update",
  targetType: "projet",
  targetId: "X",
  payload: {},
  requestedBy: "alice",
  requestedAt: "2026-09-30T09:00:00Z",
  approverRole: "chantier_owner",
  approverUsernames: ["paul"],
  status: "pending",
  ...extra,
});

const actor = { username: "lea", name: "Léa" };
const NOW = "2026-10-02T10:00:00.000Z";

/** Programme de l'audit : chantier CH-DEL supprimé (avec projet P-DEL), CH-OK conservé. */
function snapshot(): CascadeSnapshot {
  return {
    axes: [axis("AX1", "Axe 1")],
    chantiers: [
      chantier("CH-DEL"),
      chantier("CH-OK", { dependencies: [{ targetId: "CH-DEL", type: "FS" }] }),
    ],
    chantierActions: [
      projet("P-DEL", "CH-DEL"),
      projet("P-OK", "CH-OK", {
        prerequisites: [
          { id: "pr1", kind: "action", targetActionId: "P-DEL" },
          { id: "pr2", kind: "external", label: "Recrutement" },
        ],
      }),
    ],
    staffing: [
      line("ST-CH", "CH-DEL", 2), // niveau chantier — oublié avant correctif
      line("ST-P", "CH-DEL", 1.5, "P-DEL"), // niveau projet — oublié via validation
      line("ST-OK", "CH-OK", 9),
    ],
    indicators: [
      indicator("I-DEL", { chantierId: "CH-DEL" }),
      indicator("I-OK", { chantierId: "CH-OK" }),
    ],
    measurements: [measure("M1", "I-DEL"), measure("M2", "I-DEL"), measure("M3", "I-OK")],
    approvals: [
      pending("A-PROJ", { targetType: "projet", targetId: "P-DEL" }),
      pending("A-CH", { kind: "chantier_update", targetType: "chantier", targetId: "CH-DEL" }),
      pending("A-KPI", { kind: "kpi_value", targetType: "indicateur", targetId: "I-DEL" }),
      pending("A-ST", {
        kind: "staffing_update",
        targetType: "projet",
        targetId: "P-OTHER",
        payload: { op: "create", line: line("NEW", "CH-DEL", 1) },
      }),
      pending("A-OK", { targetType: "projet", targetId: "P-OK" }),
      pending("A-SELF", { kind: "chantier_delete", targetType: "chantier", targetId: "CH-DEL" }),
      { ...pending("A-DONE", { targetType: "projet", targetId: "P-DEL" }), status: "approved" },
    ],
  };
}

describe("planDeletionCascade — chantier", () => {
  const plan = planDeletionCascade({ chantierIds: ["CH-DEL"] }, snapshot(), {
    actor,
    now: NOW,
    excludeApprovalIds: ["A-SELF"],
  });

  it("supprime projets, lignes ETP chantier ET projet, indicateurs et leurs mesures", () => {
    // Avant correctif : seul le chantier partait (removeChantier) — ST-CH, ST-P, I-DEL, M1, M2
    // restaient en base et comptés.
    expect(plan.deleteChantierIds).toEqual(["CH-DEL"]);
    expect(plan.deleteActionIds).toEqual(["P-DEL"]);
    expect(plan.deleteStaffingIds.sort()).toEqual(["ST-CH", "ST-P"]);
    expect(plan.deleteIndicatorIds).toEqual(["I-DEL"]);
    expect(plan.deleteMeasurementIds.sort()).toEqual(["M1", "M2"]);
  });

  it("retire les dépendances et prérequis qui citent les éléments supprimés", () => {
    expect(plan.chantierDependencyUpdates).toEqual([{ id: "CH-OK", dependencies: [] }]);
    expect(plan.actionPrerequisiteUpdates).toEqual([
      { id: "P-OK", prerequisites: [{ id: "pr2", kind: "external", label: "Recrutement" }] },
    ]);
  });

  it("annule les demandes EN ATTENTE qui visent un élément supprimé (motif « Cible supprimée »)", () => {
    expect(plan.cancelledApprovals.map((c) => c.id).sort()).toEqual([
      "A-CH",
      "A-KPI",
      "A-PROJ",
      "A-ST",
    ]);
    expect(plan.cancelledApprovals[0].patch).toEqual({
      status: "cancelled",
      decidedBy: "lea",
      decidedByName: "Léa",
      decidedAt: NOW,
      decisionComment: TARGET_DELETED_REASON,
    });
    // Jamais : la demande en cours d'application, une demande close, une cible survivante.
    const ids = plan.cancelledApprovals.map((c) => c.id);
    expect(ids).not.toContain("A-SELF");
    expect(ids).not.toContain("A-DONE");
    expect(ids).not.toContain("A-OK");
  });

  it("tient dans un seul writeBatch (compte d'écritures)", () => {
    expect(cascadeWriteCount(plan)).toBe(1 + 1 + 2 + 1 + 2 + 1 + 1 + 4);
  });
});

describe("planDeletionCascade — projet et indicateur", () => {
  it("projet : ses lignes ETP, les prérequis qui le citent, ses demandes en attente", () => {
    const plan = planDeletionCascade({ actionIds: ["P-DEL"] }, snapshot(), { actor, now: NOW });
    expect(plan.deleteActionIds).toEqual(["P-DEL"]);
    expect(plan.deleteStaffingIds).toEqual(["ST-P"]); // pas la ligne de niveau chantier
    expect(plan.deleteIndicatorIds).toEqual([]);
    expect(plan.actionPrerequisiteUpdates.map((u) => u.id)).toEqual(["P-OK"]);
    expect(plan.chantierDependencyUpdates).toEqual([]);
    expect(plan.cancelledApprovals.map((c) => c.id)).toEqual(["A-PROJ"]);
  });
  it("indicateur : ses mesures (avant correctif : orphelines)", () => {
    const plan = planDeletionCascade({ indicatorIds: ["I-DEL"] }, snapshot(), { actor, now: NOW });
    expect(plan.deleteIndicatorIds).toEqual(["I-DEL"]);
    expect(plan.deleteMeasurementIds.sort()).toEqual(["M1", "M2"]);
    expect(plan.cancelledApprovals.map((c) => c.id)).toEqual(["A-KPI"]);
  });
});

describe("suppression d'un axe : bloquée tant qu'il porte des données", () => {
  it("axe avec chantiers/indicateurs : AxisNotEmptyError, rien de planifié", () => {
    expect(axisDeletionBlockers("AX1", snapshot().chantiers!, snapshot().indicators!)).toEqual({
      chantierIds: ["CH-DEL", "CH-OK"],
      indicatorIds: ["I-DEL", "I-OK"],
    });
    expect(() =>
      planDeletionCascade({ axisIds: ["AX1"] }, snapshot(), { actor, now: NOW })
    ).toThrow(AxisNotEmptyError);
    expect(() =>
      planDeletionCascade({ axisIds: ["AX1"] }, snapshot(), { actor, now: NOW })
    ).toThrow(/2 chantier\(s\) et 2 indicateur\(s\)/);
  });
  it("axe vide : supprimé, demandes en attente qui le visent annulées", () => {
    const snap: CascadeSnapshot = {
      axes: [axis("AX1"), axis("AX2")],
      chantiers: [chantier("CH1")],
      indicators: [],
      approvals: [pending("A-AX", { kind: "axe_update", targetType: "axe", targetId: "AX2" })],
    };
    const plan = planDeletionCascade({ axisIds: ["AX2"] }, snap, { actor, now: NOW });
    expect(plan.deleteAxisIds).toEqual(["AX2"]);
    expect(plan.cancelledApprovals.map((c) => c.id)).toEqual(["A-AX"]);
  });
});

describe("filtre défensif des orphelins déjà en base", () => {
  const chantiers = [chantier("CH-OK")];
  const actions = [projet("P-OK", "CH-OK")];
  // Audit : IT octobre 12,5 ETP dont 3,5 orphelins (chantier supprimé 2 + projet supprimé 1,5),
  // 10 ETP disponibles.
  const staffing = [
    line("ST-OK", "CH-OK", 9),
    line("ST-ORPH-CH", "CH-DEL", 2),
    line("ST-ORPH-P", "CH-OK", 1.5, "P-DEL"),
  ];
  const october = { label: "2026-10", start: "2026-10-01", end: "2026-10-31" };

  it("taux de staffing IT : 125 % (fausse alerte) → 90 %", () => {
    expect(staffingRatePoint(staffing, 10, october).ratePct).toBeCloseTo(125);
    const kept = dropOrphanStaffing(staffing, chantiers, actions);
    expect(kept.map((s) => s.id)).toEqual(["ST-OK"]);
    expect(staffingRatePoint(kept, 10, october).ratePct).toBeCloseTo(90);
  });

  it("indicateur d'un chantier supprimé : plus compté (macro conservé)", () => {
    const indicators = [
      indicator("I1", { chantierId: "CH-OK" }),
      indicator("I-MACRO"),
      indicator("I-ORPH", { chantierId: "CH-DEL", status: "at_risk" }),
    ];
    expect(dropOrphanIndicators(indicators, chantiers).map((i) => i.id)).toEqual(["I1", "I-MACRO"]);
  });
});

describe("groupe « Sans axe » (chantiers d'un axe supprimé)", () => {
  const axes = [axis("AX1")];
  const chantiers = [
    chantier("C1"),
    chantier("C2"),
    chantier("C3"),
    chantier("C4", { axisIds: ["AX-DEL"] }),
    chantier("C5", { axisIds: ["AX-DEL"] }),
  ];
  const actions = chantiers.map((c) => projet(`P-${c.id}`, c.id));

  it("avant : 5 chantiers à la puce, 3 sur la feuille de route ; après : les 5", () => {
    expect(
      new Set(programRoadmap(axes, chantiers, actions, () => 0).map((r) => r.chantier.id)).size
    ).toBe(3);
    const display = withUnassignedAxisGroup(axes, chantiers, ["AX1"], "Sans axe");
    expect(display.axes.map((a) => a.id)).toEqual(["AX1", UNASSIGNED_AXIS_ID]);
    expect(isUnassignedAxis(display.axes[1])).toBe(true);
    const rows = programRoadmap(display.axes, display.chantiers, actions, () => 0);
    expect(new Set(rows.map((r) => r.chantier.id)).size).toBe(5);
    expect(rows.filter((r) => r.axis.id === UNASSIGNED_AXIS_ID).map((r) => r.chantier.id)).toEqual([
      "C4",
      "C5",
    ]);
  });

  it("un axe seulement MASQUÉ au lecteur n'est jamais « Sans axe » ; rien à faire sans orphelin", () => {
    // AX2 existe dans le programme mais n'est pas visible : C6 n'est pas orphelin.
    const c6 = chantier("C6", { axisIds: ["AX2"] });
    expect(chantiersWithoutAxis([c6], ["AX1", "AX2"])).toEqual([]);
    const same = withUnassignedAxisGroup(axes, [chantier("C1")], ["AX1"], "Sans axe");
    expect(same.axes).toBe(axes);
  });
});

describe("validation d'une suppression : effets complets (lot 3)", () => {
  const data: StrategicApprovalData = {
    axes: [axis("AX1")],
    chantiers: [chantier("CH-DEL")],
    chantierActions: [projet("P-DEL", "CH-DEL")],
    indicators: [indicator("I-DEL", { chantierId: "CH-DEL" })],
    measurements: [measure("M1", "I-DEL")],
    staffing: [line("ST-CH", "CH-DEL", 2), line("ST-P", "CH-DEL", 1.5, "P-DEL")],
  };
  const approved = (
    kind: StrategicApproval["kind"],
    targetType: StrategicApproval["targetType"],
    targetId: string
  ) => ({
    ...pending("A", { kind, targetType, targetId }),
    status: "approved" as const,
  });

  it("chantier_delete : lignes ETP chantier + projet, indicateurs, mesures (avant : aucune)", () => {
    const e = applyApprovedPayload(approved("chantier_delete", "chantier", "CH-DEL"), data);
    expect(e.deleteChantierIds).toEqual(["CH-DEL"]);
    expect(e.deleteActionIds).toEqual(["P-DEL"]);
    expect(e.deleteStaffingIds.sort()).toEqual(["ST-CH", "ST-P"]);
    expect(e.deleteIndicatorIds).toEqual(["I-DEL"]);
    expect(e.deleteMeasurementIds).toEqual(["M1"]);
  });
  it("projet_delete : ses lignes ETP", () => {
    const e = applyApprovedPayload(approved("projet_delete", "projet", "P-DEL"), data);
    expect(e.deleteActionIds).toEqual(["P-DEL"]);
    expect(e.deleteStaffingIds).toEqual(["ST-P"]);
  });
  it("mergeCascadePlans : union sans doublon", () => {
    const a = planDeletionCascade({ actionIds: ["P-DEL"] }, snapshot(), { actor, now: NOW });
    const b = planDeletionCascade({ chantierIds: ["CH-DEL"] }, snapshot(), { actor, now: NOW });
    const merged = mergeCascadePlans(a, b);
    expect(merged.deleteActionIds).toEqual(["P-DEL"]);
    expect(merged.deleteStaffingIds.sort()).toEqual(["ST-CH", "ST-P"]);
  });
});

describe("demande annulée (cible supprimée)", () => {
  const cancelled: StrategicApproval = {
    ...pending("A1", { targetType: "projet", targetId: "P-DEL", targetName: "Projet X" }),
    status: "cancelled",
    decidedBy: "lea",
    decidedAt: "2026-10-02T10:00:00Z",
    decisionComment: TARGET_DELETED_REASON,
  };
  const data: StrategicApprovalData = {
    axes: [],
    chantiers: [],
    chantierActions: [],
    indicators: [],
  };
  const user = (username: string) =>
    ({ username, name: username, profiles: [] }) as unknown as AuthUser;

  it("le demandeur est informé « Demande annulée » (ni validée ni refusée) ; plus rien à décider", () => {
    const alerts = buildApprovalAlerts([cancelled], user("alice"), data, new Date("2026-10-03"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: "blue" });
    expect(alerts[0].title).toMatch(/^Demande annulée/);
    expect(alerts[0].desc).toContain(TARGET_DELETED_REASON);
    expect(buildApprovalAlerts([cancelled], user("lea"), data, new Date("2026-10-03"))).toEqual([]);
    expect(bucketApprovals([cancelled], user("paul"), data).pending).toEqual([]);
  });
});
