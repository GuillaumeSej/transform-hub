import { describe, expect, it } from "vitest";
import * as engine from "@/lib/engine";
import { allowedImpactStatuses, impactStatusOf } from "@/lib/impactStatus";
import type { Lever, LeverImpact } from "@/types";

const today = new Date("2026-05-10");
const gain = (o: Partial<LeverImpact> = {}): LeverImpact => ({
  id: "g",
  label: "g",
  type: "saving",
  nature: "opex_rec",
  amount: 10,
  gainRecurrence: "annual",
  ...o,
});
const capex = (o: Partial<LeverImpact> = {}): LeverImpact => ({
  id: "c",
  label: "c",
  type: "cost",
  nature: "capex",
  amount: 4,
  ...o,
});

describe("impactStatusOf", () => {
  it("dérive de la date : futur → planned, passé → done/ongoing", () => {
    expect(impactStatusOf(gain({ gainDate: "2026-09-01" }), today)).toBe("planned");
    expect(impactStatusOf(gain({ gainDate: "2026-01-01" }), today)).toBe("ongoing");
    expect(impactStatusOf(capex({ capexDeploymentDate: "2026-01-01" }), today)).toBe("done");
    expect(impactStatusOf(gain({}), today)).toBe("planned");
  });
  it("le statut explicite prime et est normalisé selon la récurrence", () => {
    expect(impactStatusOf(gain({ gainDate: "2026-01-01", status: "planned" }), today)).toBe(
      "planned"
    );
    expect(impactStatusOf(gain({ status: "done" }), today)).toBe("ongoing");
    expect(impactStatusOf(capex({ status: "ongoing" }), today)).toBe("done");
  });
  it("options filtrées", () => {
    expect(allowedImpactStatuses(gain())).toEqual(["planned", "ongoing"]);
    expect(allowedImpactStatuses(capex())).toEqual(["planned", "done"]);
  });
});

describe("impactTrajectory & statut", () => {
  const lever = (impacts: LeverImpact[]) =>
    ({
      id: "L",
      status: "on_track",
      start: "2026-01-01",
      end: "2026-12-31",
      impacts,
    }) as unknown as Lever;
  it("isole la part planifiée sans changer les totaux", () => {
    const l = lever([
      gain({ gainDate: "2026-03-01" }),
      gain({ id: "g2", gainDate: "2026-03-01", status: "planned", amount: 5 }),
    ]);
    const p = engine.impactTrajectory(l, { granularity: "month", today }).points;
    const mar = p.find((x) => x.periodStart === "2026-03-01")!;
    expect(mar.gains).toBe(15);
    expect(mar.planned.gains).toBe(5);
    expect(p[p.length - 1].cumulativeNetActual).toBeLessThan(p[p.length - 1].cumulativeNet);
  });
});
