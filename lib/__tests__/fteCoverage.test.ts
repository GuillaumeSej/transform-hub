import { describe, expect, it } from "vitest";
import { fteCoverage, leverFteCoverage, movementsOfPerimeterLevers } from "@/lib/fteCoverage";
import { leverTargetFte } from "@/lib/engine";
import { hrProgramSummary } from "@/lib/hrProgramSummary";
import { leverCoverageRows } from "@/lib/hrKpiDetail";
import type { Lever, WorkforceMovement } from "@/types";

const lever = (id: string, status: Lever["status"], fteImpact: number) =>
  ({ id, code: id, name: id, status, fteImpact }) as Lever;

const departure = (id: string, leverId: string, fte = 1) =>
  ({
    id,
    empId: id,
    label: id,
    leverId,
    type: "Départ forcé",
    fte,
    department: "IT",
    country: "France",
    hrOwner: "HR",
    plannedDate: "2026-03-01",
    actualDate: null,
    status: "Planifié",
    hrValidated: false,
    salaryImpact: -50000,
    savings: 50000,
    cost: 0,
  }) as WorkforceMovement;

describe("leverFteCoverage — ETP couverts : même chiffre Dashboard Performance et Dashboard RH", () => {
  // Constat d'audit : levier actif −4 ETP couvert par 3 départs ; levier ABANDONNÉ porteur de
  // 2 départs ; 2 départs sans levier. Dashboard « dont 3 couverts, reste 1 » vs RH « 7 couverts,
  // couverture dépassée de 3 ».
  const levers = [lever("A", "in_progress", -4), lever("B", "cancelled", -10)];
  const movements = [
    departure("m1", "A"),
    departure("m2", "A"),
    departure("m3", "A"),
    departure("m4", "B"),
    departure("m5", "B"),
    departure("m6", ""),
    departure("m7", "GHOST"),
  ];

  it("avant : les deux écrans divergeaient (3 vs 7)", () => {
    // Ancien Dashboard : mouvements des seuls leviers actifs.
    const activeIds = new Set(levers.filter((l) => l.status !== "cancelled").map((l) => l.id));
    const oldDashboard = hrProgramSummary(movements.filter((m) => activeIds.has(m.leverId))).fte
      .target;
    // Ancienne page RH : tous les mouvements filtrés, rattachés ou non.
    const oldHr = fteCoverage(leverTargetFte(levers), hrProgramSummary(movements).fte.target);
    expect(oldDashboard).toBe(-3);
    expect(oldHr.movementFte).toBe(-7);
    expect(oldHr).toMatchObject({ status: "exceeded", exceeded: 3 });
  });

  it("après : sélecteur partagé — leviers abandonnés inclus, mouvements sans levier exclus", () => {
    expect(movementsOfPerimeterLevers(movements, levers).map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
    ]);
    // Dashboard (filteredData.levers + tous les mouvements) et RH (coverageLevers + mouvements
    // filtrés) appellent la même fonction sur le même périmètre : même résultat.
    const dashboard = leverFteCoverage(levers, movements);
    const hr = leverFteCoverage(levers, movements);
    expect(dashboard.movementFte).toBe(-5);
    expect(hr.movementFte).toBe(dashboard.movementFte);
    expect(dashboard).toMatchObject({
      leverFte: -4,
      status: "exceeded",
      exceeded: 1,
      linkedCount: 5,
    });
  });

  it("le reste global net se réconcilie avec la fiche « Couverture leviers » (par levier)", () => {
    const rows = leverCoverageRows(levers, movements);
    const total = leverFteCoverage(levers, movements);
    const sign = Math.sign(total.leverFte);
    // Σ (|ambition| − couverts dans le sens du programme) par levier : A 4 − 3 = 1, B (abandonné,
    // ambition 0) 0 − 2 = −2 → −1 = −dépassement global. Les mouvements sans levier (m6, m7)
    // n'apparaissent ni dans la fiche ni dans le total.
    const signedGap = rows.reduce((s, r) => s + Math.abs(r.leverFte) - r.movementFte * sign, 0);
    expect(rows.map((r) => r.leverId).sort()).toEqual(["A", "B"]);
    expect(Math.round(signedGap * 10) / 10).toBe(-total.exceeded);
  });

  it("aucun mouvement rattaché : linkedCount 0 (le Dashboard n'affiche rien)", () => {
    expect(leverFteCoverage(levers, [departure("x", "")]).linkedCount).toBe(0);
  });
});

describe("fteCoverage — ETP visés par les leviers vs couverts par les mouvements RH", () => {
  it("reductions partially covered: remaining = |levers| − |movements|", () => {
    const c = fteCoverage(-34, -11.3);
    expect(c.status).toBe("remaining");
    expect(c.remaining).toBe(22.7);
    expect(c.exceeded).toBe(0);
    expect(c.coveragePct).toBe(33);
  });

  it("movements beyond the lever ambition: exceeded, no remaining", () => {
    const c = fteCoverage(-10, -12.5);
    expect(c.status).toBe("exceeded");
    expect(c.exceeded).toBe(2.5);
    expect(c.remaining).toBe(0);
    expect(c.coveragePct).toBe(100);
  });

  it("exact coverage (float noise tolerated at 0.1 FTE)", () => {
    const c = fteCoverage(-0.3, -(0.1 + 0.2));
    expect(c.status).toBe("covered");
    expect(c.remaining).toBe(0);
    expect(c.exceeded).toBe(0);
  });

  it("is sign-aware: opposite-direction movements increase the remaining gap", () => {
    const c = fteCoverage(-10, 2);
    expect(c.status).toBe("remaining");
    expect(c.remaining).toBe(12);
    expect(c.coveragePct).toBe(0);
  });

  it("works for hiring levers (positive ambition)", () => {
    expect(fteCoverage(8, 5)).toMatchObject({ status: "remaining", remaining: 3 });
    expect(fteCoverage(8, 9)).toMatchObject({ status: "exceeded", exceeded: 1 });
  });

  it("no lever ambition: empty or noLeverTarget", () => {
    expect(fteCoverage(0, 0).status).toBe("empty");
    expect(fteCoverage(0, -3)).toMatchObject({ status: "noLeverTarget", remaining: 0 });
  });

  it("non-finite inputs are treated as 0", () => {
    expect(fteCoverage(NaN, Infinity).status).toBe("empty");
  });
});

describe("leverTargetFte — same computation as the dashboard KPI", () => {
  it("sums non-cancelled levers, rounded to 0.1", () => {
    expect(
      leverTargetFte([
        { status: "in_progress", fteImpact: 0.1 },
        { status: "validated", fteImpact: 0.2 },
        { status: "cancelled", fteImpact: -50 },
      ] as never)
    ).toBe(0.3);
  });
});
