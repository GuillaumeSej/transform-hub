import { describe, expect, it } from "vitest";
import {
  financialBridge,
  impactTrajectory,
  isActionLate,
  leverRealizedByDate,
  realizedFte,
  realizedSavings,
  savingsSeries,
} from "@/lib/engine";
import type { BeTrackData, Lever, LeverAction, LeverImpact } from "@/types";

const gain = (overrides: Partial<LeverImpact> = {}): LeverImpact =>
  ({
    id: "G1",
    label: "Gain",
    amount: 1,
    type: "saving",
    nature: "opex_rec",
    gainRecurrence: "annual",
    ...overrides,
  }) as LeverImpact;

const lever = (overrides: Partial<Lever> = {}): Lever =>
  ({
    id: "L1",
    name: "Levier",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "in_progress",
    netSavings: 1,
    actions: [],
    impacts: [gain({ gainDate: "2026-03-01" })],
    ...overrides,
  }) as unknown as Lever;

const data = (levers: Lever[]): BeTrackData =>
  ({ program: { fyStart: "2026-01-01" }, levers }) as unknown as BeTrackData;

describe("savingsSeries — réalisé daté à la date propre de l'impact (audit MAJEUR)", () => {
  it("un gain réalisé au 01/03 reste en mars, quel que soit le mois courant", () => {
    const d = data([lever()]);
    for (const today of [new Date(2026, 5, 15), new Date(2026, 7, 15)]) {
      const s = savingsSeries(d, "month", today);
      expect(s.find((p) => p.month === "Mar 2026")!.actualDelta).toBe(1);
      expect(s.find((p) => p.month === "Mar 2026")!.actual).toBe(1);
      expect(s.find((p) => p.month === "Feb 2026")!.actual).toBe(0);
      // le mois courant ne récupère rien
      const cur = s[today.getMonth()];
      expect(cur.actualDelta).toBe(0);
      expect(cur.actual).toBe(realizedSavings(d.levers[0]));
    }
  });

  it("l'écart de retard suit aussi la date de l'impact (pas de glissement)", () => {
    const d = data([lever({ end: "2026-03-31" })]);
    const s = savingsSeries(d, "month", new Date(2026, 7, 15));
    // réactualisé (1) attendu fin mars, réalisé (1) constaté en mars → aucun écart de retard
    expect(s.find((p) => p.month === "Mar 2026")!.gap.delay).toBeCloseTo(0, 6);
  });

  it("impact sans date propre : repli deliveredDate, puis fin du levier, plafonné à aujourd'hui", () => {
    const undated = gain({ gainDate: undefined, status: "ongoing" });
    const delivered = lever({ impacts: [undated], deliveredDate: "2026-02-10" });
    expect(leverRealizedByDate(delivered, new Date(2026, 7, 15))[0].date.getMonth()).toBe(1);
    const ended = lever({ impacts: [undated], end: "2026-04-30" });
    expect(leverRealizedByDate(ended, new Date(2026, 7, 15))[0].date.getMonth()).toBe(3);
    const future = lever({ impacts: [undated], end: "2026-12-31" });
    expect(leverRealizedByDate(future, new Date(2026, 7, 15))[0].date.getMonth()).toBe(7);
  });

  it("le pont (financialBridge) date aussi le réalisé à la date de l'impact", () => {
    const l = lever({
      start: "2025-01-01",
      end: "2025-12-31",
      impacts: [gain({ gainDate: "2025-03-01" })],
    });
    const bridge = financialBridge(data([l]), "month");
    expect(bridge).toEqual([{ quarter: "Mar 2025", delta: 1, cumulative: 1 }]);
  });
});

describe("impactTrajectory — récurrent borné par sa date de fin (audit mineur)", () => {
  const bounded = gain({ amount: 1.2, gainDate: "2026-01-01", endDate: "2026-06-30" });

  it("vue annuelle : 1,2 M€/an du 01/01 au 30/06/2026 → 0,6 en 2026, rien ensuite", () => {
    const { points } = impactTrajectory(lever({ impacts: [bounded] }), { granularity: "year" });
    const byYear = (y: string) => points.find((p) => p.period === y)?.gains ?? 0;
    expect(byYear("2026")).toBe(0.6);
    expect(byYear("2027")).toBe(0);
    expect(byYear("2028")).toBe(0);
  });

  it("vue lissée mensuelle : 0,1/mois jusqu'en juin inclus, puis 0", () => {
    const { points } = impactTrajectory(lever({ impacts: [bounded] }), {
      granularity: "month",
      smoothRecurring: true,
    });
    expect(points.find((p) => p.periodStart === "2026-06-01")?.gains).toBe(0.1);
    expect(points.find((p) => p.periodStart === "2026-07-01")?.gains).toBe(0);
  });

  it("sans date de fin : toujours récurrent chaque année", () => {
    const open = gain({ amount: 1.2, gainDate: "2026-01-01" });
    const { points } = impactTrajectory(lever({ impacts: [open] }), { granularity: "year" });
    expect(points.find((p) => p.period === "2027")?.gains).toBe(1.2);
  });
});

describe("impactTrajectory — planifié/effectif = règle du réalisé (audit mineur)", () => {
  const today = new Date(2026, 7, 15);

  it("levier non lancé : un gain daté dans le passé reste planifié (C4)", () => {
    const l = lever({ status: "validated" });
    const { points } = impactTrajectory(l, { granularity: "month", today });
    const mar = points.find((p) => p.periodStart === "2026-03-01")!;
    expect(mar.gains).toBe(1);
    expect(mar.planned.gains).toBe(1);
    expect(realizedSavings(l)).toBe(0);
  });

  it("impact en attente de validation finance : planifié", () => {
    const l = lever({
      impacts: [
        gain({
          gainDate: "2026-03-01",
          status: "ongoing",
          realizedApproval: { status: "pending" },
        } as Partial<LeverImpact>),
      ],
    });
    const mar = impactTrajectory(l, { granularity: "month", today }).points.find(
      (p) => p.periodStart === "2026-03-01"
    )!;
    expect(mar.planned.gains).toBe(1);
    expect(realizedSavings(l)).toBe(0);
  });

  it("impact sans date propre : pas de repli sur la fin du levier (reste planifié)", () => {
    const l = lever({ end: "2026-04-30", impacts: [gain({ gainDate: undefined })] });
    const apr = impactTrajectory(l, { granularity: "month", today }).points.find(
      (p) => p.periodStart === "2026-04-01"
    )!;
    expect(apr.planned.gains).toBe(1);
    expect(realizedSavings(l)).toBe(0);
  });

  it("levier lancé, gain daté passé : effectif", () => {
    const l = lever();
    const mar = impactTrajectory(l, { granularity: "month", today }).points.find(
      (p) => p.periodStart === "2026-03-01"
    )!;
    expect(mar.planned.gains).toBe(0);
    expect(realizedSavings(l)).toBe(1);
  });
});

describe("isActionLate — échéance en date locale, retard à partir du lendemain (audit mineur)", () => {
  const action = { id: "A", name: "A", status: "todo", end: "2026-03-10" } as LeverAction;

  it("pas en retard le jour de son échéance", () => {
    expect(isActionLate(action, new Date(2026, 2, 10, 0, 0))).toBe(false);
    expect(isActionLate(action, new Date(2026, 2, 10, 12, 0))).toBe(false);
    expect(isActionLate(action, new Date(2026, 2, 10, 23, 59))).toBe(false);
  });

  it("en retard dès le lendemain", () => {
    expect(isActionLate(action, new Date(2026, 2, 11, 0, 0))).toBe(true);
  });
});

describe("realizedFte legacy — signe des départs (audit mineur)", () => {
  it("un départ ETP porté par une action faite RETIRE des ETP", () => {
    const l = lever({
      impacts: [],
      actions: [
        {
          id: "A1",
          name: "A1",
          status: "done",
          start: "2026-01-01",
          end: "2026-02-01",
          impacts: [
            {
              id: "F1",
              label: "Départs",
              type: "fte",
              fteDirection: "departure",
              fteCount: 3,
              amount: 0.3,
            },
            {
              id: "F2",
              label: "Recrutement",
              type: "fte",
              fteDirection: "hire",
              fteCount: 1,
              amount: 0.1,
            },
          ],
        } as unknown as LeverAction,
      ],
    });
    expect(realizedFte(l)).toBe(-2);
  });
});
