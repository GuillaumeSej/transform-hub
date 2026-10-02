import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { isFuturePeriod as appIsFuturePeriod } from "@/lib/kpiHistory";
import type { IndicatorFrequency } from "@/types";

/**
 * Planificateur PUR du script scripts/clean-strategic-orphans.js (lot 3 intégrité) — vérifie qu'il
 * retire exactement les orphelins (mêmes règles que la cascade de suppression), qu'il ne touche
 * jamais aux données saines, qu'il SIGNALE sans écrire les cas à décision métier, et qu'il est
 * idempotent.
 */
const require = createRequire(import.meta.url);
const {
  planStrategicOrphanCleanup,
  isFuturePeriod,
  TARGET_DELETED_REASON,
} = require("../../scripts/lib/strategicOrphanCleanupPlan.js");

type Write = { op: "delete" | "update"; path: string; data?: Record<string, unknown> };
type Snapshot = Record<string, Record<string, unknown>[]>;

const NOW = "2026-10-02T10:00:00.000Z";

function snapshot(): Snapshot {
  return {
    axes: [{ id: "AX1", name: "Axe 1" }],
    chantiers: [
      {
        id: "CH-OK",
        name: "OK",
        axisIds: ["AX1"],
        dependencies: [{ targetId: "CH-DEL", type: "FS" }],
      },
      { id: "CH-MULTI", name: "Multi", axisIds: ["AX1", "AX-DEL"], dependencies: [] },
      { id: "CH-NOAXIS", name: "Sans axe", axisIds: ["AX-DEL"], dependencies: [] },
    ],
    chantierActions: [
      {
        id: "P-OK",
        chantierId: "CH-OK",
        name: "P OK",
        prerequisites: [{ id: "x", kind: "action", targetActionId: "P-ORPH" }],
      },
      { id: "P-ORPH", chantierId: "CH-DEL", name: "P orphelin" },
    ],
    staffing: [
      { id: "ST-OK", chantierId: "CH-OK", function: "IT", fte: 9 },
      { id: "ST-CH", chantierId: "CH-DEL", function: "IT", fte: 2 },
      { id: "ST-P", chantierId: "CH-OK", actionId: "P-GONE", function: "IT", fte: 1.5 },
    ],
    indicators: [
      { id: "I-OK", name: "OK", axisId: "AX1", chantierId: "CH-OK", frequency: "monthly" },
      { id: "I-ORPH", name: "Orphelin", axisId: "AX1", chantierId: "CH-DEL", frequency: "monthly" },
      { id: "I-MACRO", name: "Macro", axisId: "AX-DEL", frequency: "monthly" },
    ],
    measurements: [
      { id: "M-OK", indicatorId: "I-OK", period: "2026-09" },
      { id: "M-FUT", indicatorId: "I-OK", period: "2027-03" },
      { id: "M-ORPH", indicatorId: "I-ORPH", period: "2026-09" },
      { id: "M-GONE", indicatorId: "I-GONE", period: "2026-09" },
    ],
    approvals: [
      {
        id: "A-DEAD",
        status: "pending",
        kind: "projet_update",
        targetType: "projet",
        targetId: "P-ORPH",
      },
      {
        id: "A-OK",
        status: "pending",
        kind: "projet_update",
        targetType: "projet",
        targetId: "P-OK",
      },
      {
        id: "A-NEW-AXIS",
        status: "pending",
        kind: "axe_create",
        targetType: "axe",
        targetId: "AX-NEW",
      },
      {
        id: "A-CLOSED",
        status: "approved",
        kind: "projet_update",
        targetType: "projet",
        targetId: "P-GONE",
      },
    ],
  };
}

describe("planStrategicOrphanCleanup", () => {
  const { writes, report } = planStrategicOrphanCleanup(snapshot(), { now: NOW, actor: "ops" });
  const paths = (op: string) =>
    (writes as Write[])
      .filter((w) => w.op === op)
      .map((w) => w.path)
      .sort();

  it("supprime projets, lignes ETP, indicateurs et mesures orphelins — rien de sain", () => {
    expect(paths("delete")).toEqual([
      "chantierActions/P-ORPH",
      "chantierStaffing/ST-CH",
      "chantierStaffing/ST-P",
      "indicatorMeasurements/M-GONE",
      "indicatorMeasurements/M-ORPH",
      "indicators/I-ORPH",
    ]);
    expect(report.orphanStaffing.map((s: { fte: number }) => s.fte)).toEqual([2, 1.5]); // 3,5 ETP
  });

  it("nettoie dépendances, prérequis et axes inexistants d'un chantier multi-axe", () => {
    const updates = (writes as Write[]).filter((w) => w.op === "update");
    expect(updates.find((w) => w.path === "chantiers/CH-OK")?.data).toEqual({ dependencies: [] });
    expect(updates.find((w) => w.path === "chantiers/CH-MULTI")?.data).toEqual({
      axisIds: ["AX1"],
    });
    expect(updates.find((w) => w.path === "chantierActions/P-OK")?.data).toEqual({
      prerequisites: [],
    });
    // Chantier sans AUCUN axe existant : jamais réécrit automatiquement.
    expect(updates.some((w) => w.path === "chantiers/CH-NOAXIS")).toBe(false);
  });

  it("annule (sans supprimer) les demandes en attente dont la cible n'existe plus", () => {
    const cancel = (writes as Write[]).filter((w) => w.path.startsWith("strategicApprovals/"));
    expect(cancel).toEqual([
      {
        op: "update",
        path: "strategicApprovals/A-DEAD",
        data: {
          status: "cancelled",
          decidedBy: "ops",
          decidedAt: NOW,
          decisionComment: TARGET_DELETED_REASON,
        },
      },
    ]);
  });

  it("signale sans écrire : chantier sans axe, indicateur macro d'un axe supprimé, mesure future", () => {
    expect(report.manual.map((m: { path: string }) => m.path).sort()).toEqual([
      "chantiers/CH-NOAXIS",
      "indicatorMeasurements/M-FUT",
      "indicators/I-MACRO",
    ]);
    expect(writes.some((w: Write) => w.path === "indicatorMeasurements/M-FUT")).toBe(false);
  });

  it("idempotent : relancé sur l'état nettoyé, aucune écriture", () => {
    const after = snapshot();
    const deleted = new Set(paths("delete"));
    const keyOf: Record<string, string> = {
      chantierActions: "chantierActions",
      chantierStaffing: "staffing",
      indicators: "indicators",
      indicatorMeasurements: "measurements",
    };
    for (const p of Array.from(deleted)) {
      const [col, id] = p.split("/");
      after[keyOf[col]] = after[keyOf[col]].filter((d) => d.id !== id);
    }
    for (const w of writes as Write[]) {
      if (w.op !== "update") continue;
      const [col, id] = w.path.split("/");
      const key = col === "strategicApprovals" ? "approvals" : col;
      const docs = after[key];
      const idx = docs.findIndex((d) => d.id === id);
      docs[idx] = { ...docs[idx], ...w.data };
    }
    expect(planStrategicOrphanCleanup(after, { now: NOW }).writes).toEqual([]);
  });
});

describe("période future : même verdict que l'application", () => {
  it("isFuturePeriod (script) = isFuturePeriod (lib/kpiHistory)", () => {
    const now = new Date(2026, 9, 2, 12);
    const cases: [string, IndicatorFrequency][] = [
      ["2026-10", "monthly"],
      ["2026-11", "monthly"],
      ["2027-03", "monthly"],
      ["2026-Q4", "quarterly"],
      ["2027-Q1", "quarterly"],
      ["2026-S2", "semiannual"],
      ["2027", "annual"],
      ["2026", "annual"],
    ];
    for (const [period, frequency] of cases) {
      expect(isFuturePeriod(period, frequency, now.toISOString())).toBe(
        appIsFuturePeriod(period, frequency, now)
      );
    }
  });
});
