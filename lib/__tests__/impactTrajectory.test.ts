import { describe, expect, it } from "vitest";
import { impactTrajectory } from "@/lib/engine";
import { impactDatesOf, impactDatesPatch, impactTypeOf, impactTypePatch } from "@/lib/impactKinds";
import type { Lever, LeverImpact } from "@/types";

const lever = (impacts: LeverImpact[]) =>
  ({
    id: "L1",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "on_track",
    impacts,
  }) as unknown as Lever;

describe("impactTrajectory — lissage des gains annualisés", () => {
  const gain = {
    id: "G",
    label: "Gain A",
    amount: 1.2,
    nature: "opex_rec",
    type: "saving",
    gainRecurrence: "annual",
    gainDate: "2026-03-01",
  } as LeverImpact;

  it("sans lissage : montant complet à la date de début", () => {
    const { points } = impactTrajectory(lever([gain]), { granularity: "month" });
    expect(points.find((p) => p.periodStart === "2026-03-01")?.gains).toBe(1.2);
    expect(points.find((p) => p.periodStart === "2026-04-01")?.gains).toBe(0);
  });

  it("lissé par mois : annuel / 12 dès le mois de début", () => {
    const { points } = impactTrajectory(lever([gain]), {
      granularity: "month",
      smoothRecurring: true,
    });
    expect(points.find((p) => p.periodStart === "2026-02-01")?.gains).toBe(0);
    expect(points.find((p) => p.periodStart === "2026-03-01")?.gains).toBe(0.1);
    expect(points.find((p) => p.periodStart === "2026-08-01")?.gains).toBe(0.1);
  });

  it("lissé par trimestre : partiel puis plein, avec détail source", () => {
    const { points } = impactTrajectory(lever([gain]), {
      granularity: "quarter",
      smoothRecurring: true,
    });
    const q1 = points.find((p) => p.periodStart === "2026-01-01");
    const q2 = points.find((p) => p.periodStart === "2026-04-01");
    expect(q1?.gains).toBe(0.1);
    expect(q2?.gains).toBe(0.3);
    expect(q2?.items[0]).toMatchObject({
      label: "Gain A",
      category: "gain",
      recurrence: "recurring",
    });
  });

  it("CAPEX exposé dans items", () => {
    const capex = {
      id: "C",
      label: "Licence",
      amount: 1.2,
      type: "cost",
      nature: "capex",
      capexAllocationMode: "one_shot",
      capexDeploymentDate: "2026-02-01",
    } as LeverImpact;
    const { points } = impactTrajectory(lever([capex]), { granularity: "month" });
    expect(points.find((p) => p.periodStart === "2026-02-01")?.items[0]).toMatchObject({
      impactId: "C",
      label: "Licence",
      category: "capex",
      recurrence: "oneoff",
      amount: 1.2,
    });
  });
});

describe("impactKinds — type fusionné et dates", () => {
  const imp = { id: "X", label: "", amount: 1, type: "cost", nature: "opex_rec" } as LeverImpact;

  it("mappe type + mode", () => {
    expect(impactTypeOf({ ...imp, nature: "oneoff" })).toBe("opex_oneoff");
    expect(impactTypeOf({ ...imp, type: "saving", gainRecurrence: "oneoff" })).toBe("gain_oneoff");
  });

  it("changer de type conserve la date de début", () => {
    const withDate = { ...imp, capexDeploymentDate: "2026-05-01" } as LeverImpact;
    expect(impactTypePatch(withDate, "gain_rec")).toMatchObject({
      type: "saving",
      gainDate: "2026-05-01",
    });
  });

  it("CAPEX lissé : début = capexStartDate, fin = capexDeploymentDate", () => {
    const c = { ...imp, nature: "capex", capexAllocationMode: "smoothed" } as LeverImpact;
    const patch = impactDatesPatch(c, { start: "2026-01-01", end: "2026-06-01" });
    expect(impactDatesOf({ ...c, ...patch })).toEqual({ start: "2026-01-01", end: "2026-06-01" });
  });
});
