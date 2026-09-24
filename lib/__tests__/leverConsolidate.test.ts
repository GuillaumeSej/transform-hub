import { describe, it, expect } from "vitest";
import { consolidateLeverFromActions, leverJCurve } from "@/lib/leverConsolidate";
import type { ActionImpact, Lever, LeverAction } from "@/types";

const baseLever: Lever = {
  id: "L001",
  code: "L001",
  programId: "p1",
  type: "Sourcing",
  name: "Test Lever",
  ws: "WS-01",
  owner: "Test Lever Owner",
  ownerInit: "TL",
  sponsor: "Test Sponsor",
  sponsorInit: "TS",
  geography: "Europe",
  country: "France",
  entity: "Entity A",
  function: "Supply Chain",
  costCenter: "CC01",
  pnlMap: "PNL01",
  start: "2026-01-01",
  end: "2026-12-31",
  status: "in_progress",
  progress: 50,
  risk: "low",
  grossSavings: 0,
  netSavings: 0,
  opexOneOff: 0,
  opexRec: 0,
  capex: 0,
  fteImpact: 0,
  popImpacted: "",
  dependencies: [],
  description: "Test lever",
  createdAt: "2026-01-01",
  lastUpdate: "2026-06-01",
  actions: [],
};

function action(overrides: Partial<LeverAction>): LeverAction {
  return {
    id: "A1",
    name: "Action test",
    start: "2026-01-01",
    end: "2026-06-01",
    status: "in_progress",
    impacts: [],
    ...overrides,
  };
}

function impact(overrides: Partial<ActionImpact>): ActionImpact {
  return {
    id: "IMP1",
    label: "Impact test",
    type: "cost",
    nature: "oneoff",
    amount: 1,
    ...overrides,
  };
}

describe("leverConsolidate — consolidateLeverFromActions (netSavings = savings − recurring OPEX)", () => {
  it("returns undefined when no action has impacts (manual entry lever)", () => {
    expect(consolidateLeverFromActions({ ...baseLever, actions: [] })).toBeUndefined();
  });

  it("netSavings ignores CAPEX entirely (net = savings − recurring OPEX), no temporal weighting", () => {
    const lever: Lever = {
      ...baseLever,
      actions: [
        action({
          impacts: [
            impact({ id: "s1", type: "saving", amount: 10 }),
            impact({
              id: "c1",
              type: "cost",
              nature: "capex",
              amount: 2,
              capexDeploymentDate: "2026-01-01",
            }),
          ],
        }),
      ],
    };
    const result = consolidateLeverFromActions(lever);
    expect(result?.netSavings).toBe(10); // CAPEX (2) hors net
    expect(result?.capex).toBe(2);
  });

  it("one-off OPEX never affects netSavings; recurring OPEX is deducted", () => {
    const lever: Lever = {
      ...baseLever,
      actions: [
        action({
          end: "2026-01-01",
          impacts: [
            impact({ id: "s1", type: "saving", amount: 10 }),
            impact({ id: "c1", type: "cost", nature: "oneoff", amount: 2 }),
            impact({ id: "c2", type: "cost", nature: "opex_rec", amount: 1 }),
          ],
        }),
      ],
    };
    const result = consolidateLeverFromActions(lever);
    expect(result?.netSavings).toBe(9); // 10 − 1 (OPEX rec) ; one-off exclu
    expect(result?.opexOneOff).toBe(2);
    expect(result?.opexRec).toBe(1);
  });

  it("sums capex across multiple actions face-value without touching netSavings", () => {
    const lever: Lever = {
      ...baseLever,
      actions: [
        action({
          id: "A1",
          end: "2026-01-01",
          impacts: [
            impact({
              id: "c1",
              type: "cost",
              nature: "capex",
              amount: 1,
              capexDeploymentDate: "2026-01-01",
            }),
          ],
        }),
        action({
          id: "A2",
          end: "2027-01-01",
          impacts: [
            impact({
              id: "c2",
              type: "cost",
              nature: "capex",
              amount: 3,
              capexDeploymentDate: "2027-01-01",
            }),
          ],
        }),
      ],
    };
    const result = consolidateLeverFromActions(lever);
    // CAPEX (1 + 3) hors net annualisé
    expect(result?.netSavings).toBe(0);
    expect(result?.capex).toBe(4);
  });
});

// ─── leverJCurve — "Réalisé à date" (audit issue #4) ───────────────────────

describe("leverConsolidate — leverJCurve (Réalisé à date)", () => {
  /** Dernier point de la courbe dont `actual` n'est pas null — même logique que le repli
   *  `jCurveActualToDate` de LeverDetailClientPerformance.tsx. */
  function lastActual(points: ReturnType<typeof leverJCurve>): number | null {
    return [...points].reverse().find((p) => p.actual !== null)?.actual ?? null;
  }

  it("0% progress (no action done) — Réalisé à date is 0, not silently dropped", () => {
    const lever: Lever = {
      ...baseLever,
      start: "2026-01-01",
      end: "2026-12-31",
      actions: [
        action({
          id: "A1",
          end: "2026-03-01",
          status: "in_progress",
          impacts: [impact({ id: "s1", type: "saving", amount: 10 })],
        }),
      ],
    };
    const points = leverJCurve(lever, "2026-01-01", "2026-12-31");
    expect(lastActual(points)).toBe(0);
  });

  it("partial progress — one action done BEFORE the fiscal-year window still counts (root cause of the stuck-at-0 bug)", () => {
    // Livrée en 2025, alors que la fenêtre du programme (fyStart) démarre en 2026 : avant le
    // correctif, cette contribution n'appartenait à aucun mois itéré par leverJCurve et était
    // silencieusement perdue — `Réalisé à date` restait bloqué à 0€ même pour un levier avec des
    // actions bel et bien livrées.
    const lever: Lever = {
      ...baseLever,
      start: "2025-06-01",
      end: "2026-12-31",
      actions: [
        action({
          id: "A1",
          end: "2025-11-01",
          deliveredDate: "2025-11-15",
          status: "done",
          impacts: [impact({ id: "s1", type: "saving", amount: 10 })],
        }),
        action({
          id: "A2",
          end: "2026-06-01",
          status: "in_progress",
          impacts: [impact({ id: "s2", type: "saving", amount: 10 })],
        }),
      ],
    };
    const points = leverJCurve(lever, "2026-01-01", "2026-12-31");
    // Seule A1 (done) doit compter dans le réalisé, malgré sa livraison hors fenêtre fyStart.
    expect(lastActual(points)).toBe(10);
  });

  it("100% progress, OPEX récurrent présent mais sans CAPEX — Plan (netSavings) et Réalisé (courbe en J) coïncident désormais, les deux ignorant l'OPEX récurrent", () => {
    // "Réalisé" (courbe en J, actionNetAmount) et "Plan initial"/"Réactualisé"
    // (consolidateLeverFromActions.netSavings) partagent maintenant EXACTEMENT la même définition
    // de "net" (règle métier explicite : gains bruts − OPEX récurrent, jamais le CAPEX ni
    // l'OPEX one-off) — ils ne peuvent donc plus diverger, contrairement à avant cet alignement.
    const lever: Lever = {
      ...baseLever,
      start: "2026-01-01",
      end: "2026-03-31",
      actions: [
        action({
          id: "A1",
          end: "2026-01-15",
          deliveredDate: "2026-01-15",
          status: "done",
          impacts: [impact({ id: "s1", type: "saving", amount: 10 })],
        }),
        action({
          id: "A2",
          end: "2026-02-15",
          deliveredDate: "2026-02-15",
          status: "done",
          impacts: [
            impact({ id: "s2", type: "saving", amount: 6 }),
            impact({ id: "c2", type: "cost", nature: "opex_rec", amount: 2 }),
          ],
        }),
      ],
    };
    const points = leverJCurve(lever, "2026-01-01", "2026-12-31");
    const consolidated = consolidateLeverFromActions(lever);
    // netSavings = (10 + 6) − 2 (OPEX récurrent).
    expect(consolidated?.netSavings).toBe(14);
    expect(lastActual(points)).toBe(14);
  });

  it("realized deducts recurring OPEX from gross savings, never CAPEX nor OPEX one-off", () => {
    const lever: Lever = {
      ...baseLever,
      start: "2026-01-01",
      end: "2026-03-31",
      actions: [
        action({
          id: "A1",
          end: "2026-01-15",
          deliveredDate: "2026-01-15",
          status: "done",
          impacts: [
            impact({ id: "s1", type: "saving", amount: 10 }),
            impact({ id: "c1", type: "cost", nature: "capex", amount: 3 }),
            impact({ id: "c2", type: "cost", nature: "oneoff", amount: 50 }),
            impact({ id: "c3", type: "cost", nature: "opex_rec", amount: 2 }),
          ],
        }),
      ],
    };
    const points = leverJCurve(lever, "2026-01-01", "2026-12-31");
    // 10 (saving) − 2 (OPEX rec) = 8 — CAPEX (3) et OPEX one-off (50) ignorés.
    expect(lastActual(points)).toBe(8);
  });
});
