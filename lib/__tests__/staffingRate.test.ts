import { describe, expect, it } from "vitest";
import { periodBoundsForDate } from "@/lib/staffingNeed";
import {
  filterStaffingByAxes,
  monthsOfYear,
  periodRange,
  staffingRateLevel,
  staffingRatePoint,
  staffingRateSeries,
  teamStaffingMatrix,
} from "@/lib/staffingRate";
import type { ChantierStaffing } from "@/types";

let seq = 0;
const line = (
  fn: string,
  fte: number,
  startDate?: string,
  endDate?: string,
  chantierId = "ch1",
  actionId?: string
): ChantierStaffing =>
  ({
    id: `l${seq++}`,
    companyId: "c",
    programId: "p",
    chantierId,
    function: fn,
    fte,
    startDate,
    endDate,
    actionId,
    createdAt: "",
  }) as ChantierStaffing;

describe("staffingRate", () => {
  it("bornes mensuelles", () => {
    expect(periodBoundsForDate("2026-02-10", "monthly")).toEqual({
      label: "2026-02",
      start: "2026-02-01",
      end: "2026-02-28",
    });
    expect(monthsOfYear(2028)).toHaveLength(12);
    expect(monthsOfYear(2028)[1].end).toBe("2028-02-29");
    expect(periodRange("2026-11-15", "2027-02-01", "monthly").map((p) => p.label)).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("niveaux : >100 sur-staffé, 85-100 tendu, sinon OK", () => {
    expect(staffingRateLevel(101)).toBe("over");
    expect(staffingRateLevel(100)).toBe("tense");
    expect(staffingRateLevel(85)).toBe("tense");
    expect(staffingRateLevel(84)).toBe("ok");
    expect(staffingRateLevel(null)).toBe("none");
    expect(staffingRateLevel(null, 1)).toBe("over");
  });

  it("taux = mobilisé / disponible (ETP moyens, lignes planifiées comprises)", () => {
    const march = periodBoundsForDate("2026-03-01", "monthly");
    const p = staffingRatePoint(
      [line("IT", 4, "2026-03-01", "2026-03-31"), line("IT", 2, "2026-03-17", "2026-03-31")],
      4,
      march
    );
    expect(p.mobilised).toBeCloseTo(4 + 2 * (15 / 31), 5);
    expect(p.ratePct).toBe(Math.round(((4 + 2 * (15 / 31)) / 4) * 100));
    expect(p.level).toBe("over");
    expect(staffingRatePoint([], 0, march).ratePct).toBeNull();
  });

  it("filtre par axes : vide = tout, sinon chantiers d'au moins un axe sélectionné", () => {
    const rows = [
      line("IT", 1, "2026-01-01", undefined, "a"),
      line("IT", 1, "2026-01-01", undefined, "b"),
    ];
    const map = { a: ["x"], b: ["y", "z"] };
    expect(filterStaffingByAxes(rows, map, [])).toHaveLength(2);
    expect(filterStaffingByAxes(rows, map, ["z"]).map((r) => r.chantierId)).toEqual(["b"]);
    expect(filterStaffingByAxes(rows, map, ["x", "y"])).toHaveLength(2);
    expect(filterStaffingByAxes(rows, map, ["nope"])).toHaveLength(0);
  });

  it("série mensuelle continue, plafonnée aux dernières périodes", () => {
    const s = staffingRateSeries(
      [line("IT", 2, "2026-01-01", "2026-06-30")],
      4,
      "monthly",
      "2026-02-01"
    );
    expect(s).toHaveLength(6);
    expect(s[0].ratePct).toBe(50);
    expect(s[0].level).toBe("ok");
    const capped = staffingRateSeries(
      [line("IT", 1, "2020-01-01", "2026-12-31")],
      4,
      "monthly",
      "2026-02-01",
      12
    );
    expect(capped).toHaveLength(12);
    expect(capped[capped.length - 1].label).toBe("2026-12");
    expect(staffingRateSeries([line("IT", 1)], 4, "monthly", "2026-02-01")).toEqual([]);
  });

  it("matrice équipe × mois avec contributions par projet", () => {
    const months = monthsOfYear(2026).slice(0, 3);
    const m = teamStaffingMatrix(
      [
        line("IT", 3, "2026-03-01", "2026-03-31", "ch1", "p1"),
        line("IT", 1, "2026-03-01", "2026-03-31", "ch1", "p1"),
        line("IT", 1, "2026-03-01", "2026-03-31", "ch2"),
        line("RH", 1, "2026-01-01", "2026-03-31", "ch1", "p2"),
        line("Achats", 1, "2026-01-01", "2026-01-31", "ch1"),
      ],
      { IT: 4, RH: 2, Finance: 3 },
      months
    );
    expect(m.map((r) => r.team)).toEqual(["Achats", "IT", "RH", "Finance"]);
    const it = m.find((r) => r.team === "IT")!;
    expect(it.cells[0].mobilised).toBe(0);
    expect(it.cells[0].level).toBe("ok");
    expect(it.cells[2].ratePct).toBe(125);
    expect(it.cells[2].level).toBe("over");
    expect(it.cells[2].contributions).toEqual([
      { actionId: "p1", chantierId: "ch1", fte: 4 },
      { chantierId: "ch2", fte: 1 },
    ]);
    const achats = m.find((r) => r.team === "Achats")!;
    expect(achats.available).toBe(0);
    expect(achats.cells[0].ratePct).toBeNull();
    expect(achats.cells[0].level).toBe("over");
    expect(achats.cells[1].level).toBe("none");
    expect(m.find((r) => r.team === "RH")!.cells[1].ratePct).toBe(50);
  });
});
