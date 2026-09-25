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
      status: "in_progress",
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

describe("réalisé : règle unique (audit C4)", () => {
  const opexRec = (o: Partial<LeverImpact> = {}): LeverImpact => ({
    id: "o",
    label: "o",
    type: "cost",
    nature: "opex_rec",
    amount: 1,
    capexStartDate: "2026-01-01",
    ...o,
  });

  it("levier pas encore lancé : une date passée ne suffit pas, seul un impact coché compte", () => {
    expect(isImpactRealized(opexRec(), "idea", today)).toBe(false);
    expect(isImpactRealized(opexRec(), "validated", today)).toBe(false);
    expect(isImpactRealized(opexRec({ status: "ongoing" }), "idea", today)).toBe(true);
    expect(isImpactRealized(opexRec(), "in_progress", today)).toBe(true);
  });

  it("coché mais en attente ou rejeté par la finance : pas réalisé ; validé : réalisé", () => {
    const g = gain({ gainDate: "2026-01-01", status: "ongoing" });
    expect(
      isImpactRealized({ ...g, realizedApproval: { status: "pending" } }, "in_progress", today)
    ).toBe(false);
    expect(
      isImpactRealized({ ...g, realizedApproval: { status: "rejected" } }, "in_progress", today)
    ).toBe(false);
    expect(
      isImpactRealized({ ...g, realizedApproval: { status: "approved" } }, "in_progress", today)
    ).toBe(true);
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

  it("levier Identifié avec des coûts datés : réalisé 0, plus de réalisé négatif", () => {
    expect(
      engine.realizedSavings(lever("idea", [gain({ gainDate: "2026-09-01" }), opexRec()]))
    ).toBe(0);
  });

  it("un impact ne peut pas être à la fois réalisé et en retard", () => {
    const today2 = new Date("2026-06-01");
    // Fin de levier passée : la trajectoire attend ses gains dès mars.
    const ended = (l: Lever): Lever => ({ ...l, end: "2026-03-31" });
    const passedNoStatus = ended(lever("in_progress", [gain({ gainDate: "2026-02-01" })]));
    const passedPlanned = ended(
      lever("in_progress", [gain({ gainDate: "2026-02-01", status: "planned" })])
    );
    const data = (l: Lever) => ({ program: { fyStart: "2026-01-01" }, levers: [l] }) as never;
    // Date passée, sans statut, levier lancé : réalisé → pas de gain en retard.
    expect(engine.realizedSavings(passedNoStatus)).toBe(10);
    expect(engine.savingsSeries(data(passedNoStatus), "month", today2)[4].gap.late).toBeCloseTo(
      0,
      5
    );
    // Coché explicitement « non réalisé » : pas dans le réalisé, compté en retard.
    expect(engine.realizedSavings(passedPlanned)).toBe(0);
    expect(engine.savingsSeries(data(passedPlanned), "month", today2)[4].gap.late).toBeLessThan(0);
  });

  it("le réalisé du widget P&L égale le réalisé du levier (même règle, jamais dans le futur)", () => {
    const l = {
      ...lever("in_progress", [
        gain({ id: "a", gainDate: "2026-02-01" }),
        gain({ id: "b", gainDate: "2027-02-01", amount: 5 }),
        opexRec({ id: "c" }),
        capex({ id: "d", status: "done" }),
      ]),
      pnlMap: "P1",
    } as Lever;
    const pnl = engine.pnlImpactDetailed(
      { levers: [l], pnlAccounts: [{ id: "P1", name: "P1", baseline: 0, sign: 1 }] } as never,
      undefined,
      undefined,
      undefined,
      today
    );
    const realized = pnl.reduce((s, p) => s + p.realized, 0);
    expect(realized).toBeCloseTo(engine.realizedSavings(l), 5);
  });
});

describe("file « Réalisés à valider » (audit C4)", () => {
  it("liste les impacts en attente pour un profil finance uniquement", async () => {
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
    const q = resolveRealizedApprovalQueue(data, finance);
    expect(q.map((e) => `${e.lever.id}:${e.impact.id}`)).toEqual(["L1:p"]);
    expect(resolveRealizedApprovalQueue(data, cto)).toEqual([]);
  });
});
