import { describe, expect, it } from "vitest";
import * as engine from "@/lib/engine";
import { allowedImpactStatuses, impactStatusOf, isImpactRealized } from "@/lib/impactStatus";
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

describe("réalisé avant lancement et file finance (audit C4)", () => {
  const opexRec = (o: Partial<LeverImpact> = {}): LeverImpact => ({
    id: "o",
    label: "o",
    type: "cost",
    nature: "opex_rec",
    amount: 1,
    capexStartDate: "2026-01-01",
    ...o,
  });
  const lever = (status: Lever["status"], impacts: LeverImpact[]) =>
    ({
      id: "L",
      status,
      start: "2026-01-01",
      end: "2026-12-31",
      netSavings: 10,
      impacts,
    }) as unknown as Lever;

  it("levier pas encore lancé : une date passée ne suffit pas, seul un impact coché compte", () => {
    expect(isImpactRealized(opexRec(), today, "idea")).toBe(false);
    expect(isImpactRealized(opexRec(), today, "validated")).toBe(false);
    expect(isImpactRealized(opexRec({ status: "ongoing" }), today, "idea")).toBe(true);
    expect(isImpactRealized(opexRec(), today, "in_progress")).toBe(true);
    expect(
      engine.realizedSavings(lever("idea", [gain({ gainDate: "2026-09-01" }), opexRec()]))
    ).toBe(0);
  });

  it("gain daté passé d'un levier non lancé : non réalisé, donc gain en retard", () => {
    const l = lever("validated", [gain({ gainDate: "2026-02-01" })]);
    expect(engine.realizedSavings(l)).toBe(0);
    expect(engine.isLeverLate(l, today)).toBe(true);
    // Un coût non engagé n'est pas un « gain en retard ».
    expect(engine.isLeverLate(lever("validated", [opexRec()]), today)).toBe(false);
  });

  it("la file « Réalisés à valider » ne concerne que le profil finance", async () => {
    const { resolveRealizedApprovalQueue } = await import("@/lib/hooks/useApprovalQueue");
    const pending = gain({ id: "p", status: "ongoing", realizedApproval: { status: "pending" } });
    const approved = gain({ id: "a", status: "ongoing", realizedApproval: { status: "approved" } });
    const data = {
      levers: [
        { id: "L1", status: "idea", impacts: [pending, approved] },
        { id: "L2", status: "cancelled", impacts: [pending] },
      ] as unknown as Lever[],
    };
    const finance = { profiles: [{ role: "finance" as const }] } as never;
    const cto = { profiles: [{ role: "cto" as const }] } as never;
    expect(
      resolveRealizedApprovalQueue(data, finance).map((e) => `${e.lever.id}:${e.impact.id}`)
    ).toEqual(["L1:p"]);
    expect(resolveRealizedApprovalQueue(data, cto)).toEqual([]);
  });
});
