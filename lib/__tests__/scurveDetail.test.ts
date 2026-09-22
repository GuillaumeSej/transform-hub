import { describe, it, expect } from "vitest";
import { gapEntriesAt, savingsSeriesByWorkstream } from "@/lib/scurveDetail";
import * as engine from "@/lib/engine";
import type { BeTrackData, Lever, LeverImpact } from "@/types";

describe("savingsSeriesByWorkstream", () => {
  it("retourne une liste vide sans levier", () => {
    const data = { program: { fyStart: "2026-01-01" }, levers: [] } as unknown as BeTrackData;
    expect(savingsSeriesByWorkstream(data, [{ id: "A", name: "A" }], "month")).toEqual([]);
  });
});

describe("gapEntriesAt — pas de dérive d'arrondi vs la courbe globale (bug live ACME)", () => {
  // Reproduit le bug live (9.4M sur le graphe vs 9.1M dans la popup) à petite échelle : chaque
  // levier pris isolément a un écart de retard qui arrondit (à 0,1 près) à 0, mais la somme des
  // écarts BRUTS (0.03 + 0.03 + 0.04 = 0.10) arrondit à 0.1 — un total "somme des arrondis" (bug)
  // diverge donc de l'écart calculé une fois sur l'ensemble des leviers (référence, sur le graphe).
  const makeLateLever = (id: string, netSavings: number, realized: number): Lever =>
    ({
      id,
      ws: "W1",
      status: "on_track",
      start: "2026-01-01",
      end: "2026-03-01",
      netSavings,
      impacts: [
        {
          id: `${id}-gain`,
          label: "Gain",
          amount: realized,
          type: "saving",
          nature: "opex_rec",
          gainRecurrence: "annual",
          gainDate: "2020-01-01", // largement passé : compté réalisé ET en retard (voir plus haut)
        } as LeverImpact,
      ],
    }) as unknown as Lever;

  it("sum(gapEntriesAt(...).realized) == gap.delay calculé globalement (pas de dérive)", () => {
    const levers = [
      makeLateLever("A", 0.33, 0.3), // écart 0.03
      makeLateLever("B", 0.33, 0.3), // écart 0.03
      makeLateLever("C", 0.34, 0.3), // écart 0.04
    ];
    const data = { program: { fyStart: "2026-01-01" }, levers } as unknown as BeTrackData;
    const today = new Date("2026-06-01");

    const global = engine.savingsSeries(data, "month", today).find((p) => p.month === "Mar");
    const entries = gapEntriesAt(data, "month", "Mar", today);
    const summedRealized = Math.round(entries.reduce((s, e) => s + e.realized, 0) * 10) / 10;

    expect(global?.gap.delay).toBeCloseTo(-0.1, 5);
    expect(summedRealized).toBeCloseTo(-0.1, 5);
    expect(summedRealized).toBe(global?.gap.delay);
  });
});
