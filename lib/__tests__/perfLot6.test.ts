import { afterAll, describe, expect, it, vi } from "vitest";
import * as engine from "@/lib/engine";
import {
  bucketCostsByPeriod,
  bucketInvestVsSavingsByPeriod,
  costRowsForPeriod,
  engagedVsUpcomingRows,
  isInvestNature,
  leversWithUndetailedCosts,
  undetailedInvestCostRows,
} from "@/lib/financeCosts";
import { buildInvestVsSavingsCalc } from "@/lib/investVsSavingsCalc";
import { generateAlerts } from "@/lib/alertEngine";
import { leverToExcelRow } from "@/lib/leverExcel";
import { validateLeverImportRows } from "@/lib/leverExcelImport";
import { leverFteCoverage } from "@/lib/fteCoverage";
import { leverCoverageRows } from "@/lib/hrKpiDetail";
import type {
  BeTrackData,
  FinancialSnapshot,
  Lever,
  LeverAction,
  LeverImpact,
  LeverStatus,
  WorkforceMovement,
} from "@/types";

/**
 * Lot 6 — corrections du module PLAN DE PERFORMANCE (contrôle du 03/10, points 1 à 8). Chaque test
 * documente la valeur AVANT correction (commentaire « avant : … ») et la valeur attendue après.
 * Date du jour FIGÉE au 03/10/2026 ; exercice du programme avril → mars (FY26/27 = avril 2026 –
 * mars 2027), sauf mention contraire.
 */

const TODAY = new Date(2026, 9, 3);
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(TODAY);
afterAll(() => {
  vi.useRealTimers();
});

const FY_APRIL = 3; // mois (0-11) de début d'exercice

const lever = (over: Partial<Lever> = {}): Lever =>
  ({
    id: "L1",
    code: "L1",
    name: "Levier",
    ws: "WS",
    pnlMap: "P1",
    programId: "p1",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "in_progress",
    grossSavings: 0,
    netSavings: 0,
    opexOneOff: 0,
    opexRec: 0,
    capex: 0,
    fteImpact: 0,
    progress: 0,
    dependencies: [],
    actions: [],
    lastUpdate: "2026-09-01",
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
const snap = (over: Partial<FinancialSnapshot>): FinancialSnapshot => ({
  grossSavings: 0,
  netSavings: 0,
  opexOneOff: 0,
  opexRec: 0,
  capex: 0,
  ...over,
});
const data = (levers: Lever[], movements: WorkforceMovement[] = []): BeTrackData =>
  ({
    program: { fyStart: "2026-04-01", fyEnd: "2027-03-31" },
    workstreams: [],
    levers,
    pnlAccounts: [{ id: "P1", name: "P1", baseline: 0, sign: -1 }],
    workforce: { movements, employees: [] },
    alerts: [],
  }) as unknown as BeTrackData;
const lateAction = (id: string): LeverAction => ({
  id,
  name: id,
  start: "2026-01-01",
  end: "2026-09-01", // échéance passée au 03/10/2026, non terminée → en retard
  status: "in_progress",
});

// ─── 1. Invest vs Savings / engagement des coûts : coûts des leviers macro ────────────────────

describe("1 — coûts des leviers macro dans Invest vs Savings et l'engagement des coûts", () => {
  // Levier détaillé : CAPEX 2,0 + OPEX ponctuel 0,5 en lignes de coût, gain annuel 20,3.
  const detailed = lever({
    id: "D",
    code: "D",
    impacts: [
      imp("c1", { type: "cost", nature: "capex", amount: 2, capexDeploymentDate: "2026-02-01" }),
      imp("c2", { type: "cost", nature: "oneoff", amount: 0.5, capexDeploymentDate: "2026-03-01" }),
      imp("g1", { amount: 20.3, gainDate: "2026-06-01" }),
    ],
  });
  // Levier macro (sans ligne) réactualisé : CAPEX 3,0 + OPEX ponctuel 0,5 (plan figé 2,0 / 0,5).
  const macro = lever({
    id: "M",
    code: "M",
    start: "2026-07-01",
    capex: 2,
    opexOneOff: 0.5,
    opexRec: 0.4,
    grossSavings: 3.4,
    netSavings: 3,
    lockedPlan: snap({ capex: 2, opexOneOff: 0.5, opexRec: 0.4, grossSavings: 3.4, netSavings: 3 }),
    reforecast: snap({ capex: 3, opexOneOff: 0.5, opexRec: 0.5, grossSavings: 3.5, netSavings: 3 }),
  });
  const d = data([detailed, macro]);

  it("coût d'investissement Invest vs Savings = KPI = donut = 6,0 (avant : 2,5)", () => {
    const points = bucketInvestVsSavingsByPeriod(d, "quarter", FY_APRIL);
    const invest = points.reduce((s, p) => s + p.investCost, 0);
    expect(invest).toBeCloseTo(6, 6); // avant : 2,5 (lignes détaillées seules)
    expect(engine.programSummary(d).reforecastCosts).toBe(6);
    expect(engagedVsUpcomingRows(d, TODAY).total).toBe(6);
    // Le macro est daté à son DÉBUT (juillet 2026 = Q2 FY26/27).
    const q2 = points.find((p) => p.period === "Q2 FY26/27")!;
    expect(q2.investCost).toBeCloseTo(3.5, 6);
  });

  it("ROI de la vue Total ≈ 316 % (avant : ≈ 900 %, coûts du macro absents)", () => {
    const calc = buildInvestVsSavingsCalc(d, "quarter", null, undefined, FY_APRIL)!;
    expect(calc.investCost).toBe(6);
    expect(calc.capex).toBe(5);
    expect(calc.opexOneOff).toBe(1);
    // Même horizon et mêmes gains : seul le coût change. Avant = (résultat + 3,5) / 2,5.
    const before = Math.round(((calc.netResult + 3.5) / 2.5) * 1000) / 10;
    expect(before).toBeCloseTo(899, -1); // avant : ≈ 899 %
    expect(calc.roiPct!).toBeCloseTo(316, -1); // après : ≈ 316 %
    expect(calc.roiPct).toBe(Math.round((calc.netResult / 6) * 1000) / 10);
  });

  it("engagement des coûts (Invest) : cumul final 6,0 (avant : 2,5), drill-down par levier", () => {
    const points = bucketCostsByPeriod(d, "quarter", isInvestNature, FY_APRIL);
    expect(points[points.length - 1].cumulative).toBe(6); // avant : 2,5
    const q2 = points.find((p) => p.period === "Q2 FY26/27")!;
    const rows = costRowsForPeriod(d, "quarter", q2.sortKey, isInvestNature, FY_APRIL);
    expect(rows.map((r) => [r.lever.id, r.amount])).toEqual([
      ["M", 3],
      ["M", 0.5],
    ]);
  });

  it("lignes synthétiques : seulement les leviers sans ligne de coût Invest, abandonnés exclus", () => {
    const cancelled = lever({ id: "X", status: "cancelled" as LeverStatus, capex: 9 });
    const rows = undetailedInvestCostRows(data([detailed, macro, cancelled]));
    expect(rows.map((r) => [r.lever.id, r.impact.nature, r.impact.amount])).toEqual([
      ["M", "capex", 3],
      ["M", "oneoff", 0.5],
    ]);
    // Note de la répartition par centre de coût : le macro y est signalé (non ventilable).
    expect(leversWithUndetailedCosts(d).map((l) => l.id)).toEqual(["M"]);
  });
});

// ─── 2. Alertes « Savings réduits » / « Dépassement » dès la validation ──────────────────────

describe("2 — alertes financières dès la validation (plan figé suffit)", () => {
  // L5 validé : plan figé 1,0 ; impacts 0,8 (réactualisé = impacts dès la validation).
  const l5 = lever({
    id: "L5",
    code: "L5",
    name: "L5",
    status: "validated" as LeverStatus,
    lockedPlan: snap({ grossSavings: 1, netSavings: 1, capex: 0.2 }),
    impacts: [
      imp("g", { amount: 0.8, gainDate: "2027-01-01" }),
      imp("c", { type: "cost", nature: "capex", amount: 0.3, capexDeploymentDate: "2027-01-01" }),
    ],
  });

  it("« Savings réduits » 0,2 (avant : aucune alerte, `reforecast` absent)", () => {
    expect(l5.reforecast).toBeUndefined();
    const alert = generateAlerts(data([l5])).find((a) => a.id === "AUTO-SAVINGS-L5");
    expect(alert).toBeDefined(); // avant : undefined
    expect(alert!.i18n?.amounts?.delta).toBeCloseTo(0.2, 6);
    expect(alert!.impactEur).toBe(-200000);
  });

  it("« Dépassement coûts » 0,1 sur le même levier validé (avant : aucune alerte)", () => {
    const alert = generateAlerts(data([l5])).find((a) => a.id === "AUTO-COST-L5");
    expect(alert?.i18n?.amounts?.delta).toBeCloseTo(0.1, 6);
  });

  it("levier non validé (sans plan figé) : aucune alerte financière", () => {
    const idea = { ...l5, status: "idea" as LeverStatus, lockedPlan: undefined };
    const ids = generateAlerts(data([idea])).map((a) => a.id);
    expect(ids).not.toContain("AUTO-SAVINGS-L5");
    expect(ids).not.toContain("AUTO-COST-L5");
  });

  it("validé sans impact ni réactualisation : réactualisé = plan figé, pas d'écart", () => {
    const plain = lever({
      id: "P",
      status: "validated" as LeverStatus,
      netSavings: 1,
      lockedPlan: snap({ netSavings: 1 }),
    });
    expect(generateAlerts(data([plain])).filter((a) => a.id.endsWith("-P"))).toEqual([]);
  });
});

// ─── 3. Montant de l'alerte de retard : gains restant à réaliser ──────────────────────────────

describe("3 — alerte de retard : (réactualisé − réalisé) × part en retard", () => {
  // L1 : 1,3 déjà réalisé (gain daté de mai 2026) + 0,6 à venir (janvier 2027), 1 action / 1 en
  // retard (part 100 %).
  const l1 = lever({
    id: "L1",
    name: "L1",
    actions: [lateAction("a1")],
    impacts: [
      imp("g1", { amount: 1.3, gainDate: "2026-05-01" }),
      imp("g2", { amount: 0.6, gainDate: "2027-01-01" }),
    ],
  });

  it("L1 : −0,6 M€ (avant : −1,9, gains déjà réalisés compris)", () => {
    expect(engine.realizedSavings(l1)).toBe(1.3);
    const alert = generateAlerts(data([l1])).find((a) => a.id === "AUTO-DELAY-L1")!;
    expect(alert.impactEur).toBe(-600000); // avant : −1 900 000
    expect(alert.i18n?.amounts?.impact).toBeCloseTo(-0.6, 6);
    expect(alert.type).toBe("red");
  });

  it("part en retard 50 % : −0,3", () => {
    const half = { ...l1, actions: [lateAction("a1"), { ...lateAction("a2"), end: "2099-01-01" }] };
    const alert = generateAlerts(data([half])).find((a) => a.id === "AUTO-DELAY-L1")!;
    expect(alert.impactEur).toBe(-300000); // avant : −950 000
  });

  it("levier entièrement réalisé : alerte non chiffrée, en information (avant : rouge −0,8)", () => {
    const done = lever({
      id: "L2",
      name: "L2",
      actions: [lateAction("a1")],
      impacts: [imp("g", { amount: 0.8, gainDate: "2026-03-01" })],
    });
    const alert = generateAlerts(data([done])).find((a) => a.id === "AUTO-DELAY-L2")!;
    expect(alert.impactEur).toBe(0); // avant : −800 000
    expect(alert.type).toBe("blue"); // avant : "red"
    expect(engine.computeLeverRisk("L2", [alert]).level).not.toBe("critical");
  });
});

// ─── 4. Levier abandonné : fiche et carte Kanban « Abandonnés » ──────────────────────────────

describe("4 — net réactualisé affiché d'un levier abandonné = 0", () => {
  const cancelled = lever({
    id: "C",
    status: "cancelled" as LeverStatus,
    netSavings: 2.1,
    grossSavings: 2.4,
    lockedPlan: snap({ netSavings: 2.1, grossSavings: 2.4, opexRec: 0.3 }),
  });

  it("valeur lue par la fiche et le Kanban : 0 (avant : displayedReforecastNet = 2,1)", () => {
    expect(engine.displayedReforecastNet(cancelled).value).toBe(2.1); // avant (fiche, Kanban)
    expect(engine.leverReforecastNetValue(cancelled)).toBe(0); // après
    // Le plan initial garde l'abandonné.
    expect(engine.displayedLockedPlanNet(cancelled).value).toBe(2.1);
  });

  it("levier actif : valeur inchangée", () => {
    const active = { ...cancelled, status: "in_progress" as LeverStatus };
    expect(engine.leverReforecastNetValue(active)).toBe(
      engine.displayedReforecastNet(active).value
    );
  });
});

// ─── 5. Export d'un levier abandonné : la ligne boucle ────────────────────────────────────────

describe("5 — export d'un abandonné : brut, CAPEX, OPEX, ETP sur la base du net (0)", () => {
  const cancelled = lever({
    id: "c1-L001",
    code: "PROC-001",
    status: "cancelled" as LeverStatus,
    grossSavings: 2.4,
    netSavings: 2.1,
    opexRec: 0.3,
    capex: 1,
    fteImpact: -2,
    lockedPlan: snap({ grossSavings: 2.4, netSavings: 2.1, opexRec: 0.3, capex: 1 }),
  });

  it("brut 0, CAPEX 0, OPEX 0, net 0, ETP 0 (avant : 2,4 / 1 / 0,3 / 0 / −2)", () => {
    const row = leverToExcelRow(cancelled, data([cancelled]), []);
    expect(row["Impact estimé brut (€M)"]).toBe(0); // avant : 2,4
    expect(row["CAPEX (€M)"]).toBe(0); // avant : 1
    expect(row["OPEX one-off (€M)"]).toBe(0);
    expect(row["OPEX récurrent (€M/an)"]).toBe(0); // avant : 0,3
    expect(row["Impact estimé net (€M)"]).toBe(0);
    expect(row["Impact estimé (ETP)"]).toBe(0); // avant : −2
    // Brut − OPEX récurrent = net : la ligne boucle.
    expect(
      (row["Impact estimé brut (€M)"] as number) - (row["OPEX récurrent (€M/an)"] as number)
    ).toBe(row["Impact estimé net (€M)"]);
    // Le plan initial reste lisible dans sa propre colonne.
    expect(row["Planifié initial"]).toBe(2.1);
  });

  it("ré-import : montants FINANCIERS stockés conservés (garde-fou « Champs dérivés »)", () => {
    const row = leverToExcelRow(cancelled, data([cancelled]), [], undefined, undefined, [
      { id: "p1", name: "Programme 1" },
    ]);
    const preview = validateLeverImportRows(
      { leviers: [row], actions: null, impacts: null },
      {
        levers: [cancelled],
        workstreams: [],
        pnlAccounts: [{ id: "P1", name: "P1", baseline: 0, sign: -1 }],
      },
      "c1",
      [{ id: "p1", name: "Programme 1" }]
    );
    expect(preview.errors).toEqual([]);
    // Montants financiers jamais écrasés par les 0 exportés (base du « Planifié initial ») : le
    // garde-fou conserve les montants stockés de TOUT levier abandonné.
    const upsert = preview.toUpsert.find((r) => r.code === "PROC-001") ?? cancelled;
    expect(upsert.grossSavings).toBe(2.4);
    expect(upsert.netSavings).toBe(2.1);
    expect(upsert.opexRec).toBe(0.3);
    expect(upsert.capex).toBe(1);
  });

  // lib/leverExcelImport.ts (« Champs dérivés », lot 6 imports) : pour un abandonné, `fteImpact`
  // est conservé et le fichier est comparé à `leverReforecastSnapshotValue` /
  // `leverFteImpactValue` (0) — avant, le ré-import d'un export inchangé signalait brut / CAPEX /
  // OPEX « modifiés » et remplaçait l'ETP stocké (−2) par 0.
  it("ré-import d'un export inchangé d'un abandonné : aucune alerte, ETP stocké conservé", () => {
    // `risk` renseigné comme sur un vrai levier (sinon l'import pose sa valeur de repli « low »).
    const stored = { ...cancelled, risk: "low" } as Lever;
    const programs = [{ id: "p1", name: "Programme 1" }];
    const workstreams = [{ id: "WS", name: "WS", sponsor: "S", color: "#000", target: 0 }];
    const row = leverToExcelRow(stored, data([stored]), [], undefined, undefined, programs);
    const preview = validateLeverImportRows(
      { leviers: [row], actions: null, impacts: null },
      {
        levers: [stored],
        workstreams,
        pnlAccounts: [{ id: "P1", name: "P1", baseline: 0, sign: -1 }],
      },
      "c1",
      programs
    );
    expect(preview.errors).toEqual([]);
    expect(preview.warnings).toEqual([]); // avant : 3 « valeur calculée — modification ignorée »
    expect(preview.updateCount).toBe(0); // avant : 1 (fteImpact −2 → 0)
    expect(preview.unchangedCount).toBe(1);
    expect(preview.toUpsert).toEqual([]);

    // Modification réelle d'un montant / de l'ETP dans le fichier : signalée, stocké conservé.
    const edited = { ...row, "Impact estimé brut (€M)": 5, "Impact estimé (ETP)": -4 };
    const p2 = validateLeverImportRows(
      { leviers: [edited], actions: null, impacts: null },
      {
        levers: [stored],
        workstreams,
        pnlAccounts: [{ id: "P1", name: "P1", baseline: 0, sign: -1 }],
      },
      "c1",
      programs
    );
    expect(p2.warnings.map((w) => [w.code, w.vars?.field])).toEqual([
      ["computedFromPlan", "Impact estimé brut (€M)"],
      ["computedFromPlan", "Impact estimé (ETP)"],
    ]);
    expect(p2.toUpsert).toEqual([]);
    expect(p2.unchangedCount).toBe(1);
  });
});

// ─── 6. Fiche d'un levier macro réactualisé : CAPEX / OPEX du réactualisé ─────────────────────

describe("6 — coûts affichés d'un levier macro réactualisé = réactualisé", () => {
  const macro = lever({
    capex: 2,
    opexOneOff: 0.5,
    opexRec: 0.4,
    netSavings: 3,
    lockedPlan: snap({ capex: 2, opexOneOff: 0.5, opexRec: 0.4, netSavings: 3 }),
    reforecast: snap({ capex: 3, opexOneOff: 0.5, opexRec: 0.5, netSavings: 3 }),
  });

  it("3,0 / 0,5 / 0,5 (avant : champs du levier = plan figé 2,0 / 0,5 / 0,4)", () => {
    // Repli de la fiche (sans impact consolidé) : `displayedReforecastSnapshot`.
    const s = engine.displayedReforecastSnapshot(macro);
    expect([macro.capex, macro.opexOneOff, macro.opexRec]).toEqual([2, 0.5, 0.4]); // avant
    expect([s.capex, s.opexOneOff, s.opexRec]).toEqual([3, 0.5, 0.5]);
    // Mêmes montants que l'export.
    const row = leverToExcelRow(macro, data([macro]), []);
    expect([row["CAPEX (€M)"], row["OPEX one-off (€M)"], row["OPEX récurrent (€M/an)"]]).toEqual([
      3, 0.5, 0.5,
    ]);
  });
});

// ─── 7. Couverture ETP : même périmètre que la cible ─────────────────────────────────────────

describe("7 — couverture ETP : mouvements des leviers abandonnés exclus", () => {
  const departure = (id: string, leverId: string): WorkforceMovement =>
    ({
      id,
      empId: id,
      label: id,
      leverId,
      type: "Départ forcé",
      fte: 1,
      department: "IT",
      country: "France",
      hrOwner: "HR",
      plannedDate: "2026-11-01",
      actualDate: null,
      status: "Planifié",
      hrValidated: false,
      salaryImpact: -50000,
      savings: 50000,
      cost: 0,
    }) as WorkforceMovement;
  // Cible −5 (levier actif) ; abandonné −4 (hors cible) ; 2 départs sur chacun.
  const levers = [
    lever({ id: "A", fteImpact: -5 }),
    lever({ id: "B", status: "cancelled" as LeverStatus, fteImpact: -4 }),
  ];
  const movements = [
    departure("m1", "A"),
    departure("m2", "A"),
    departure("m3", "B"),
    departure("m4", "B"),
  ];

  it("reste à couvrir 3 (avant : 1, les 2 départs de l'abandonné comptés)", () => {
    const c = leverFteCoverage(levers, movements);
    expect(c.leverFte).toBe(-5);
    expect(c.movementFte).toBe(-2); // avant : −4
    expect(c).toMatchObject({ status: "remaining", remaining: 3, linkedCount: 2 }); // avant : 1
  });

  it("fiche « Couverture leviers » : l'abandonné n'y figure plus, Σ lignes = reste global", () => {
    const rows = leverCoverageRows(levers, movements);
    expect(rows.map((r) => r.leverId)).toEqual(["A"]);
    expect(rows[0].remaining).toBe(leverFteCoverage(levers, movements).remaining);
  });
});

// ─── 8. Libellés de période fiscaux ──────────────────────────────────────────────────────────

describe("8 — trajectoire de la fiche et filtres de fin : périodes fiscales, date locale", () => {
  const l = lever({
    start: "2026-04-01",
    end: "2026-10-01",
    impacts: [imp("g", { amount: 1.2, gainDate: "2026-10-01" })],
  });

  it("trajectoire trimestrielle : « Q3 FY26/27 » (avant : « Q4 2026 »)", () => {
    const { points } = engine.impactTrajectory(l, {
      granularity: "quarter",
      today: TODAY,
      fyStartMonth: FY_APRIL,
    });
    const oct = points.find((p) => p.periodStart === "2026-10-01")!;
    expect(oct.period).toBe("Q3 FY26/27"); // avant : « Q4 2026 »
    // Trimestres alignés sur l'exercice : 1er point = avril 2026 (Q1 FY26/27).
    expect(points[0]).toMatchObject({ periodStart: "2026-04-01", period: "Q1 FY26/27" });
    // Même libellé que la courbe en S.
    expect(engine.fiscalQuarterLabels(new Date(2026, 3, 1))[2]).toBe("Q3 FY26/27");
  });

  it("trajectoire annuelle : « FY26/27 » ; exercice civil inchangé (« Q4 2026 », « 2026 »)", () => {
    const year = engine.impactTrajectory(l, { granularity: "year", fyStartMonth: FY_APRIL });
    expect(year.points[0]).toMatchObject({ periodStart: "2026-04-01", period: "FY26/27" });
    const civil = engine.impactTrajectory(l, { granularity: "quarter" });
    expect(civil.points.find((p) => p.periodStart === "2026-10-01")?.period).toBe("Q4 2026");
    expect(engine.impactTrajectory(l, { granularity: "year" }).points[0].period).toBe("2026");
  });

  it("filtres « Mois / Trimestre de fin » : date locale, trimestre fiscal", () => {
    expect(engine.leverEndQuarterLabel(l, FY_APRIL)).toBe("Q3 FY26/27"); // avant : « Q4 2026 »
    expect(engine.leverEndQuarterLabel(l)).toBe("Q4 2026");
    expect(engine.leverEndMonthLabel(l)).toBe("Oct 2026");
    // Mars 2027 = dernier trimestre de FY26/27.
    expect(engine.leverEndQuarterLabel(lever({ end: "2027-03-31" }), FY_APRIL)).toBe("Q4 FY26/27");
    // 1er jour du mois : lu en LOCAL (avant, `new Date("2026-10-01")` = UTC → « Sep 2026 » / Q3
    // à l'ouest de Greenwich).
    const first = lever({ end: "2026-07-01" });
    expect(engine.leverEndMonthLabel(first)).toBe("Jul 2026");
    expect(engine.leverEndQuarterLabel(first, FY_APRIL)).toBe("Q2 FY26/27");
  });
});
