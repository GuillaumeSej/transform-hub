import { describe, expect, it } from "vitest";
import { reconcileLeverMovements } from "@/lib/leverMovementReconciliation";
import type { Lever, WorkforceMovement } from "@/types";

const lever = (fteImpact: number): Lever =>
  ({ id: "L1", status: "in_progress", fteImpact, impacts: [], actions: [] }) as unknown as Lever;

const move = (o: Partial<WorkforceMovement> = {}): WorkforceMovement =>
  ({
    id: "M1",
    empId: "E1",
    label: "m",
    leverId: "L1",
    type: "Départ forcé",
    fte: 1,
    department: "D",
    country: "FR",
    hrOwner: "rh",
    plannedDate: "2026-06-01",
    actualDate: null,
    status: "Planifié",
    hrValidated: false,
    ...o,
  }) as WorkforceMovement;

describe("reconcileLeverMovements — couverture de l'ETP visé (audit HR-07)", () => {
  it("signale une couverture partielle (> 1 ETP et > 20 % d'écart)", () => {
    const r = reconcileLeverMovements(lever(-12), [move()], 0);
    expect(r.coveragePct).toBe(8);
    expect(r.isCoverageGap).toBe(true);
    expect(r.hasWarning).toBe(true);
  });

  it("tolère un écart faible", () => {
    const moves = Array.from({ length: 11 }, (_, i) => move({ id: `M${i}` }));
    const r = reconcileLeverMovements(lever(-12), moves, 0);
    expect(r.isCoverageGap).toBe(false);
    expect(r.hasWarning).toBe(false);
  });

  it("levier sans ETP visé mais avec des mouvements : signalé au-delà de 1 ETP", () => {
    const moves = [move(), move({ id: "M2" })];
    const r = reconcileLeverMovements(lever(0), moves, 0);
    expect(r.coveragePct).toBeNull();
    expect(r.isCoverageGap).toBe(true);
    expect(reconcileLeverMovements(lever(0), [move()], 0).isCoverageGap).toBe(false);
  });

  it("levier sans ETP visé ni mouvement : pas d'alerte", () => {
    expect(reconcileLeverMovements(lever(0), [], 0).hasWarning).toBe(false);
    expect(reconcileLeverMovements(lever(-3), [], 0).hasWarning).toBe(true);
  });
});

describe("currentFteByDepartment — disponible = base + mouvements réalisés (audit KPI-03)", () => {
  it("applique départs, recrutements et transferts réalisés, ignore le reste", async () => {
    const { currentFteByDepartment } = await import("@/lib/hrEngine");
    const base = { RD: 10, Prod: 5 };
    const moves = [
      move({ id: "a", type: "Attrition", department: "RD", status: "Réalisé" }),
      move({ id: "b", type: "Recrutement", department: "Prod", status: "Réalisé", fte: 2 }),
      move({ id: "c", type: "Attrition", department: "RD", status: "Planifié" }),
      move({
        id: "d",
        type: "Transfert sortant",
        department: "RD",
        toDepartment: "Prod",
        status: "Réalisé",
      }),
    ];
    expect(currentFteByDepartment(base, moves)).toEqual({ RD: 8, Prod: 8 });
  });
});

describe("validateMovement — réservé aux mouvements réalisés (audit HR-14)", () => {
  it("valide un mouvement réalisé sans changer son statut, refuse les autres", async () => {
    const { validateMovement } = await import("@/lib/workforceLogic");
    const moves = [
      move({ id: "R", status: "Réalisé", actualDate: "2026-05-01" }),
      move({ id: "P", status: "Planifié" }),
      move({ id: "A", status: "Abandonné" }),
    ];
    const ok = validateMovement(moves, "R", "rh");
    expect(ok.movement.hrValidated).toBe(true);
    expect(ok.movement.status).toBe("Réalisé");
    expect(ok.movement.actualDate).toBe("2026-05-01");
    expect(() => validateMovement(moves, "P", "rh")).toThrow();
    expect(() => validateMovement(moves, "A", "rh")).toThrow();
  });
});
