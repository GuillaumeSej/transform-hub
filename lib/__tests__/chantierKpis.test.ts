import { describe, expect, it } from "vitest";
import { aggregateLinkedKpis, readKpi, resolveDeleteApproval } from "@/lib/chantierKpis";
import type { Indicator, IndicatorMeasurement } from "@/types";

const ind = (id: string, extra: Partial<Indicator> = {}) =>
  ({ id, name: id, kind: "quantitative", objectiveValue: 100, ...extra }) as Indicator;

describe("chantierKpis", () => {
  it("déduplique et exclut", () => {
    const r = aggregateLinkedKpis(
      [
        { name: "P1", indicatorId: "a" },
        { name: "P2", indicatorId: "a" },
        { name: "P3", indicatorId: "b" },
        { name: "P4" },
      ],
      [ind("a"), ind("b")],
      new Set(["b"])
    );
    expect(r).toHaveLength(1);
    expect(r[0].projetNames).toEqual(["P1", "P2"]);
  });
  it("lit valeur/cible/%", () => {
    // Avancement depuis la valeur initiale (1re mesure = baseline 20) : (50-20)/(100-20).
    const m = [
      { indicatorId: "a", period: "2025-12", value: 20 },
      { indicatorId: "a", period: "2026-01", value: 50 },
    ] as IndicatorMeasurement[];
    expect(readKpi(ind("a"), m)).toEqual({
      current: 50,
      target: 100,
      progressPct: 38,
      approximate: false,
      status: "at_risk",
    });
    // M9 : le statut suit la cible LUE (surcharge du critère), pas le statut propre du KPI.
    expect(readKpi(ind("a"), m, 40).status).toBe("on_track");
    expect(readKpi(ind("a"), [], 40).status).toBe("no_data");
    expect(readKpi(ind("a"), m, 200).progressPct).toBe(17); // (50-20)/(200-20)
    // Une seule mesure = la baseline elle-même : rien n'a bougé → 0.
    expect(readKpi(ind("a"), [m[1]]).progressPct).toBe(0);
    expect(readKpi(ind("a"), []).progressPct).toBeUndefined();
  });
  it("approbation", () => {
    expect(resolveDeleteApproval(["x"], "y", false).canApproveSelf).toBe(false);
    expect(resolveDeleteApproval(["x"], "x", false).canApproveSelf).toBe(true);
    expect(resolveDeleteApproval([undefined], "y", false).canApproveSelf).toBe(true);
    expect(resolveDeleteApproval(["x"], "y", true).canApproveSelf).toBe(true);
  });
});
