import { describe, it, expect } from "vitest";
import {
  consolidateLeverFromActions,
  leverJCurve,
  resolveLockedPlanNet,
} from "@/lib/leverConsolidate";
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

describe("leverConsolidate — consolidateLeverFromActions (netSavings = savings − opexRec)", () => {
  it("returns undefined when no action has impacts (manual entry lever)", () => {
    expect(consolidateLeverFromActions({ ...baseLever, actions: [] })).toBeUndefined();
  });

  it("netSavings is savings minus recurring OPEX, with no temporal weighting", () => {
    const lever: Lever = {
      ...baseLever,
      actions: [
        action({
          impacts: [
            impact({ id: "s1", type: "saving", amount: 10 }),
            impact({ id: "c1", type: "cost", nature: "opex_rec", amount: 2 }),
          ],
        }),
      ],
    };
    const result = consolidateLeverFromActions(lever);
    expect(result?.netSavings).toBe(8); // 10 - 2
    expect(result?.opexRec).toBe(2);
  });

  it("one-off and capex costs never affect netSavings, only opexRec does", () => {
    const lever: Lever = {
      ...baseLever,
      actions: [
        action({
          end: "2026-01-01",
          impacts: [
            impact({ id: "s1", type: "saving", amount: 10 }),
            impact({ id: "c1", type: "cost", nature: "oneoff", amount: 2 }),
            impact({
              id: "c2",
              type: "cost",
              nature: "capex",
              amount: 1,
              capexDeploymentDate: "2026-01-01",
            }),
          ],
        }),
      ],
    };
    const result = consolidateLeverFromActions(lever);
    expect(result?.netSavings).toBe(10); // 10 - 0 (capex/oneoff excluded)
    expect(result?.capex).toBe(1);
    expect(result?.opexOneOff).toBe(2);
  });

  it("sums opex_rec across multiple actions, face-value, no annualization", () => {
    const lever: Lever = {
      ...baseLever,
      actions: [
        action({
          id: "A1",
          end: "2026-01-01",
          impacts: [impact({ id: "c1", type: "cost", nature: "opex_rec", amount: 1 })],
        }),
        action({
          id: "A2",
          end: "2027-01-01",
          impacts: [impact({ id: "c2", type: "cost", nature: "opex_rec", amount: 3 })],
        }),
      ],
    };
    const result = consolidateLeverFromActions(lever);
    // netSavings = 0 (no savings) - (1 + 3) = -4
    expect(result?.netSavings).toBe(-4);
    expect(result?.opexRec).toBe(4);
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

  it("100% progress, no CAPEX — realized (gross savings, OPEX récurrent excluded) diverges by design from netSavings (gross savings − opexRec)", () => {
    // Deux formules "net" volontairement différentes (règle métier explicite) : le "Réalisé" de la
    // courbe en J (actionNetAmount) ne déduit QUE le CAPEX des gains bruts, jamais l'OPEX (one-off
    // ni récurrent) — alors que le "Plan initial"/"Réactualisé" de `consolidateLeverFromActions`
    // (netSavings) déduit l'OPEX récurrent, jamais le CAPEX. Elles ne sont donc plus censées
    // coïncider dès qu'un OPEX récurrent est présent, comme ici.
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
    // netSavings = (10 + 6) - 2 (opexRec) = 14.
    expect(consolidated?.netSavings).toBe(14);
    // Réalisé = 10 + 6, aucun CAPEX à déduire (l'OPEX récurrent de 2 n'entre pas dans ce calcul).
    expect(lastActual(points)).toBe(16);
  });

  it("realized deducts CAPEX from gross savings, never OPEX one-off nor OPEX récurrent", () => {
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
    // 10 (saving) - 3 (capex) = 7 — l'OPEX one-off (50) et l'OPEX récurrent (2) sont ignorés.
    expect(lastActual(points)).toBe(7);
  });
});

// ─── resolveLockedPlanNet — "Plan initial (net)" (audit issue #5) ──────────

describe("leverConsolidate — resolveLockedPlanNet", () => {
  it("falls back to lever.netSavings when there is no lockedPlan and no action impacts", () => {
    const lever: Lever = { ...baseLever, netSavings: 7, actions: [] };
    expect(resolveLockedPlanNet(lever)).toEqual({ value: 7, isLocked: false });
  });

  it("uses the frozen lockedPlan.netSavings for a manual-entry lever (no action impacts)", () => {
    const lever: Lever = {
      ...baseLever,
      netSavings: 7,
      actions: [],
      lockedPlan: { grossSavings: 9, netSavings: 5, opexOneOff: 0, opexRec: 0, capex: 0 },
    };
    expect(resolveLockedPlanNet(lever)).toEqual({ value: 5, isLocked: true });
  });

  it("prefers the consolidated action-impact total over a stale/incorrect lockedPlan snapshot", () => {
    // Reproduit le bug audit : lockedPlan.netSavings figé à une valeur fausse (ex. le CAPEX
    // capturé par erreur) alors que les lignes d'impact d'actions, elles, sont correctes.
    const lever: Lever = {
      ...baseLever,
      actions: [
        action({
          impacts: [
            impact({ id: "s1", type: "saving", amount: 20 }),
            impact({ id: "c1", type: "cost", nature: "opex_rec", amount: 5 }),
          ],
        }),
      ],
      lockedPlan: { grossSavings: 3, netSavings: 3, opexOneOff: 0, opexRec: 0, capex: 3 },
    };
    // netSavings consolidé attendu = 20 - 5 = 15, pas les 3 figés par erreur.
    expect(resolveLockedPlanNet(lever)).toEqual({ value: 15, isLocked: true });
  });
});
