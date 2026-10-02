import { afterAll, describe, expect, it, vi } from "vitest";
import * as engine from "@/lib/engine";
import { financeTotals } from "@/lib/dashboardSavings";
import { fteDirectionOf, impactDatesOf } from "@/lib/impactKinds";
import { impactStatusOf, isImpactRealized } from "@/lib/impactStatus";
import type { BeTrackData, HierarchyLevelDef, HierarchyNode, Lever, LeverImpact } from "@/types";

/**
 * Lot 1 — corrections de calcul (réalisé sur périodes futures, dates du plan de la courbe en S,
 * point trimestriel en cours, impact ETP sans sens, levier macro). Date du jour FIGÉE au
 * 02/10/2026 (fonctions qui lisent `new Date()` par défaut, ex. `realizedSavings`).
 */

const TODAY = new Date(2026, 9, 2);
// Figée dès le chargement : certaines séries sont calculées à la collecte des `describe`.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(TODAY);
afterAll(() => {
  vi.useRealTimers();
});

const lever = (over: Partial<Lever> = {}): Lever =>
  ({
    id: "L1",
    code: "L1",
    name: "Levier",
    ws: "WS",
    pnlMap: "P1",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "in_progress",
    grossSavings: 0,
    netSavings: 0,
    opexOneOff: 0,
    opexRec: 0,
    capex: 0,
    fteImpact: 0,
    actions: [],
    ...over,
  }) as unknown as Lever;
const imp = (id: string, over: Partial<LeverImpact>): LeverImpact => ({
  id,
  label: id,
  type: "saving",
  nature: "opex_rec",
  amount: 1,
  ...over,
});
const data = (levers: Lever[]): BeTrackData =>
  ({
    program: { fyStart: "2026-01-01", fyEnd: "2026-12-31" },
    workstreams: [],
    levers,
    pnlAccounts: [],
    workforce: { movements: [], employees: [] },
  }) as unknown as BeTrackData;
const levels: HierarchyLevelDef[] = [{ key: "pl", label: "P&L", order: 0 }];
const node = (id: string): HierarchyNode => ({
  id,
  companyId: "C",
  code: id,
  label: id,
  levelKey: "pl",
  parentId: null,
  domain: "financial",
});

const pnl = (d: BeTrackData, f?: engine.PnlPeriodFilter) => {
  const pts = engine.pnlImpactDetailed(d, f, undefined, undefined, TODAY);
  const sum = (k: "plan" | "reforecast" | "realized") => pts.reduce((s, p) => s + p[k], 0);
  return { plan: sum("plan"), reforecast: sum("reforecast"), realized: sum("realized") };
};
const table = (d: BeTrackData, opts: { years?: number[]; period?: engine.PnlPeriodFilter }) =>
  financeTotals(
    engine.financeByHierarchyLevel(d, { hierarchyLevels: levels }, 0, [node("A")], {
      years: opts.years ? new Set(opts.years) : undefined,
      period: opts.period,
      unrounded: true,
      today: TODAY,
    })
  );

// ─── 1. Réalisé borné au mois courant (P&L, tableau Finance) ────────────────────────────────────

describe("1 — le réalisé ne court jamais sur des périodes futures", () => {
  // 1 M€/an depuis mars 2026, réalisé (date passée, levier lancé), sans fin.
  const l = lever({
    impacts: [imp("g", { amount: 1, gainDate: "2026-03-01", hierarchyLeafId: "A" })],
  });
  const d = data([l]);

  it("exercice entièrement futur (FY2027) : réalisé 0, plan / réactualisé en année pleine", () => {
    expect(pnl(d, { year: "2027" })).toEqual({ plan: 0, reforecast: 1, realized: 0 });
    const t = table(d, { years: [2027] });
    expect(t.realized).toBe(0); // avant : 1,0
    expect(t.reforecast).toBe(1);
  });

  it("exercice en cours (FY2026) : effet année pleine, réalisé compris", () => {
    expect(pnl(d, { year: "2026" }).realized).toBe(1);
    expect(table(d, { years: [2026] }).realized).toBe(1);
  });

  it("trimestre en cours (T4 2026) : réalisé des seuls mois écoulés (octobre = 1/12)", () => {
    const q4 = pnl(d, { year: "2026", quarter: "Q4" });
    expect(q4.reforecast).toBe(0.25);
    expect(q4.realized).toBeCloseTo(1 / 12, 4); // avant : 0,25
    expect(table(d, { period: { year: "2026", quarter: "Q4" } }).realized).toBe(0.1);
    expect(pnl(d, { year: "2026", quarter: "Q4", month: "Nov" }).realized).toBe(0);
    expect(pnl(d, { year: "2026", quarter: "Q4", month: "Oct" }).realized).toBeCloseTo(1 / 12, 4);
  });

  it("sans filtre : réalisé total inchangé (= realizedSavings)", () => {
    expect(pnl(d).realized).toBe(engine.realizedSavings(l));
    expect(pnl(d).realized).toBe(1);
  });

  it("« En retard » : seulement le réactualisé échu, rien sur un exercice futur", () => {
    const late = lever({
      impacts: [
        imp("g", { amount: 1, gainDate: "2026-03-01", hierarchyLeafId: "A" }),
        // Gain daté passé, laissé « planifié » → levier en retard.
        imp("x", { amount: 0.5, gainDate: "2026-05-01", hierarchyLeafId: "A", status: "planned" }),
      ],
    });
    const dl = data([late]);
    expect(engine.isLeverLate(late, TODAY)).toBe(true);
    expect(table(dl, { years: [2026] }).late).toBe(0.5);
    const fy27 = table(dl, { years: [2027] });
    expect(fy27.realized).toBe(0);
    expect(fy27.late).toBe(0); // avant : 0,5 (et 1,0 de réalisé)
  });
});

// ─── 2. Courbe en S : plan / réactualisé datés ligne par ligne ──────────────────────────────────

describe("2 — courbe en S : plan et réactualisé datés comme le réalisé", () => {
  // Levier fini en décembre : 3 M€ réalisés depuis mars, 1 M€ prévu en novembre. Plan figé 3,6
  // (≠ impacts : l'écart est réparti au prorata des lignes, comme le P&L).
  const l = lever({
    lockedPlan: { grossSavings: 3.6, netSavings: 3.6, opexOneOff: 0, opexRec: 0, capex: 0 },
    netSavings: 4,
    impacts: [
      imp("g1", { amount: 3, gainDate: "2026-03-01" }),
      imp("g2", { amount: 1, gainDate: "2026-11-01" }),
    ],
  });
  const macro = lever({
    id: "L2",
    impacts: [],
    end: "2026-06-30",
    netSavings: 0.5,
    lockedPlan: { grossSavings: 0.5, netSavings: 0.5, opexOneOff: 0, opexRec: 0, capex: 0 },
  });
  const cancelled = lever({
    id: "L3",
    status: "cancelled",
    lockedPlan: { grossSavings: 2, netSavings: 2, opexOneOff: 0, opexRec: 0, capex: 0 },
    impacts: [imp("c", { amount: 2, gainDate: "2026-04-01" })],
  });
  const d = data([l, macro, cancelled]);
  const s = engine.savingsSeries(d, "month", TODAY);
  const oct = s[9];

  it("à date (octobre), plan / réactualisé / réalisé comparables", () => {
    expect(oct.actual).toBe(3);
    // Avant : plan 0,5 (seul le levier macro, fini en juin, était « dû ») contre 3 réalisés.
    expect(oct.reforecast).toBe(3.5); // g1 (3) + macro (0,5)
    expect(oct.planned).toBe(5.2); // 3,6 × 3/4 + macro 0,5 + abandonné 2 (daté en avril)
    expect(oct.gap.total).toBe(Math.round((oct.actual! - oct.planned) * 10) / 10);
    expect(s[10].reforecast).toBe(4.5); // g2 (novembre)
  });

  it("au dernier point, totaux = Planifié initial / Réactualisé des KPI", () => {
    const sum = engine.programSummary(d);
    expect(s[11].raw.planned).toBeCloseTo(engine.plannedInitialNet(d.levers), 9);
    expect(s[11].planned).toBe(sum.plannedInitial);
    expect(s[11].reforecast).toBe(sum.reforecastTarget);
    expect(oct.gap.cancelled).toBe(2); // plan de l'abandonné, daté à sa ligne (avril)
  });
});

// ─── 3. Courbe en S trimestrielle : trimestre en cours ──────────────────────────────────────────

describe("3 — point du trimestre en cours : fin de trimestre pour plan / réactualisé", () => {
  const l = lever({
    netSavings: 4,
    impacts: [
      imp("g1", { amount: 3, gainDate: "2026-03-01" }),
      imp("g2", { amount: 1, gainDate: "2026-11-01" }),
    ],
  });
  const d = data([l]);
  const monthly = engine.savingsSeries(d, "month", TODAY);
  const q = engine.savingsSeries(d, "quarter", TODAY);

  it("plan / réactualisé = fin du trimestre (décembre), réalisé = cumul au mois courant", () => {
    expect(q[3].reforecast).toBe(monthly[11].reforecast); // 4 (avant : 3, valeur d'octobre)
    expect(q[3].planned).toBe(monthly[11].planned);
    expect(q[3].actual).toBe(monthly[9].actual); // 3
    expect(q[2].actual).toBe(3);
  });

  it("écarts cohérents avec les valeurs affichées (total = ajustement + retard)", () => {
    const g = q[3].gap;
    expect(g.total).toBe(Math.round((q[3].actual! - q[3].planned) * 10) / 10);
    expect(g.delay).toBe(Math.round((q[3].actual! - q[3].reforecast) * 10) / 10);
    expect(g.totalRaw).toBeCloseTo(g.adjustmentRaw + g.delayRaw, 9);
  });

  it("sCurve3 accepte une date du jour (tests indépendants de la date réelle)", () => {
    expect(engine.sCurve3(d, "quarter", undefined, TODAY)[3].planned).toBe(q[3].planned);
  });
});

// ─── 4. Impact ETP sans sens = départ, partout ──────────────────────────────────────────────────

describe("4 — impact ETP sans fteDirection : départ partout (totaux, statut, dates, plages)", () => {
  const fte = imp("f", { type: "fte", amount: 0.2, fteCount: 2, gainDate: "2026-03-01" });
  const l = lever({ impacts: [fte] });

  it("helper unique : absent = départ", () => {
    expect(fteDirectionOf(fte)).toBe("departure");
    expect(fteDirectionOf({ fteDirection: "hire" })).toBe("hire");
  });

  it("daté par gainDate et réalisé une fois la date passée (avant : jamais)", () => {
    expect(impactDatesOf(fte).start).toBe("2026-03-01");
    expect(impactStatusOf(fte, TODAY)).toBe("ongoing");
    expect(isImpactRealized(fte, TODAY, "in_progress")).toBe(true);
    expect(engine.realizedSavings(l)).toBe(0.2);
    expect(engine.realizedFte(l)).toBe(-2);
  });

  it("même plage que le départ explicite (P&L / Finance)", () => {
    const explicit = { ...fte, fteDirection: "departure" as const };
    expect(engine.impactMonthRange(fte, l)).toEqual(engine.impactMonthRange(explicit, l));
    expect(engine.impactMonthRange(fte, l)?.[0]).toBe(2026 * 12 + 2); // mars 2026
  });
});

// ─── 5. Levier macro : récurrent sans fin depuis son début ──────────────────────────────────────

describe("5 — levier macro (sans ligne d'impact) : récurrent sans fin depuis son début", () => {
  const l = lever({
    hierarchyLeafId: "A",
    start: "2026-01-01",
    end: "2026-06-30",
    netSavings: 1,
    lockedPlan: { grossSavings: 1, netSavings: 1, opexOneOff: 0, opexRec: 0, capex: 0 },
  });
  const d = data([l]);

  it("FY2027 (après sa fin) : 1 M€ en année pleine (avant : 0)", () => {
    expect(pnl(d, { year: "2027" })).toMatchObject({ plan: 1, reforecast: 1 });
    expect(table(d, { years: [2027] }).reforecast).toBe(1);
    expect(table(d, { period: { year: "2027" } }).planned).toBe(1);
  });

  it("trimestre après sa fin : effet sur la période ; avant son début : rien", () => {
    expect(pnl(d, { year: "2026", quarter: "Q4" }).reforecast).toBe(0.25);
    expect(pnl(d, { year: "2025" }).reforecast).toBe(0);
  });
});
