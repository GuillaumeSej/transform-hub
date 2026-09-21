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
    const m = [{ indicatorId: "a", period: "2026-01", value: 50 }] as IndicatorMeasurement[];
    expect(readKpi(ind("a"), m)).toEqual({ current: 50, target: 100, progressPct: 50 });
    expect(readKpi(ind("a"), m, 200).progressPct).toBe(25);
    expect(readKpi(ind("a"), []).progressPct).toBeUndefined();
  });
  it("approbation", () => {
    expect(resolveDeleteApproval(["x"], "y", false).canApproveSelf).toBe(false);
    expect(resolveDeleteApproval(["x"], "x", false).canApproveSelf).toBe(true);
    expect(resolveDeleteApproval([undefined], "y", false).canApproveSelf).toBe(true);
    expect(resolveDeleteApproval(["x"], "y", true).canApproveSelf).toBe(true);
  });
});
