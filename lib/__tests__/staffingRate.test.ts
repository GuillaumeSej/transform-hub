import { describe, expect, it } from "vitest";
import { periodBoundsForDate } from "@/lib/staffingNeed";
import {
  availableForTeam,
  DEFAULT_STAFFING_THRESHOLDS,
  filterStaffingByAxes,
  filterStaffingByTeam,
  monthsOfYear,
  normalizeStaffingThresholds,
  periodRange,
  periodStaffingDetail,
  staffingRateLevel,
  staffingRatePoint,
  staffingRateSeries,
  staffingTeams,
  teamStaffingMatrix,
  totalStaffingRow,
  validateStaffingThresholds,
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

  it("niveaux : seuils personnalisés (tendu 70, sur-staffé 120)", () => {
    const th = { tense: 70, over: 120 };
    expect(DEFAULT_STAFFING_THRESHOLDS).toEqual({ tense: 85, over: 100 });
    expect(staffingRateLevel(121, 0, th)).toBe("over");
    expect(staffingRateLevel(120, 0, th)).toBe("tense");
    expect(staffingRateLevel(101, 0, th)).toBe("tense");
    expect(staffingRateLevel(70, 0, th)).toBe("tense");
    expect(staffingRateLevel(69, 0, th)).toBe("ok");
    expect(staffingRateLevel(null, 2, th)).toBe("over");
    expect(staffingRateLevel(null, 0, th)).toBe("none");
  });

  it("seuils propagés aux séries, heatmap, ligne total et détail", () => {
    const march = periodBoundsForDate("2026-03-01", "monthly");
    const entries = [line("IT", 9, "2026-03-01", "2026-03-31")];
    const fte = { IT: 10 };
    const strict = { tense: 50, over: 80 };
    expect(staffingRatePoint(entries, 10, march).level).toBe("tense");
    expect(staffingRatePoint(entries, 10, march, strict).level).toBe("over");
    expect(staffingRateSeries(entries, 10, "monthly", "2026-03-15", 36, strict)[0].level).toBe(
      "over"
    );
    const matrix = teamStaffingMatrix(entries, fte, [march], strict);
    expect(matrix[0].cells[0].level).toBe("over");
    expect(matrix[0].overCount).toBe(1);
    expect(teamStaffingMatrix(entries, fte, [march])[0].overCount).toBe(0);
    expect(totalStaffingRow(entries, fte, [march], strict).cells[0].level).toBe("over");
    const detail = periodStaffingDetail(entries, fte, march, null, strict);
    expect(detail.level).toBe("over");
    expect(detail.teams[0].level).toBe("over");
  });

  it("validation / normalisation des seuils", () => {
    expect(validateStaffingThresholds({ tense: 85, over: 100 })).toBeNull();
    expect(validateStaffingThresholds({ tense: 1, over: 300 })).toBeNull();
    expect(validateStaffingThresholds({ tense: 0, over: 100 })).toBe("tenseRange");
    expect(validateStaffingThresholds({ tense: 100, over: 100 })).toBe("order");
    expect(validateStaffingThresholds({ tense: 90, over: 80 })).toBe("order");
    expect(validateStaffingThresholds({ tense: 90, over: 301 })).toBe("overMax");
    expect(validateStaffingThresholds({ tense: NaN, over: 100 })).toBe("invalid");
    expect(normalizeStaffingThresholds({ tense: 70, over: 120 })).toEqual({ tense: 70, over: 120 });
    expect(normalizeStaffingThresholds({ tense: 120, over: 70 })).toEqual({ tense: 85, over: 100 });
    expect(normalizeStaffingThresholds(undefined)).toEqual({ tense: 85, over: 100 });
    expect(normalizeStaffingThresholds({ tense: "70", over: 120 })).toEqual({
      tense: 85,
      over: 100,
    });
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

  it("filtre équipe, disponible par équipe et liste des équipes", () => {
    const rows = [line("IT", 1, "2026-01-01"), line("RH", 1, "2026-01-01"), line("Achats", 1)];
    expect(filterStaffingByTeam(rows, null)).toHaveLength(3);
    expect(filterStaffingByTeam(rows, "RH").map((r) => r.function)).toEqual(["RH"]);
    expect(availableForTeam({ IT: 4, RH: 2 }, null)).toBe(6);
    expect(availableForTeam({ IT: 4, RH: 2 }, "IT")).toBe(4);
    expect(availableForTeam({ IT: 4, RH: 2 }, "Achats")).toBe(0);
    expect(staffingTeams(rows, { Finance: 3, IT: 4 })).toEqual(["Achats", "Finance", "IT", "RH"]);
  });

  it("ligne TOTAL toutes équipes = mobilisé total / disponible total", () => {
    const months = monthsOfYear(2026).slice(0, 3);
    const total = totalStaffingRow(
      [
        line("IT", 3, "2026-03-01", "2026-03-31", "ch1", "p1"),
        line("RH", 1, "2026-01-01", "2026-03-31", "ch1", "p1"),
        line("Achats", 1, "2026-01-01", "2026-01-31", "ch2"),
        line("IT", 5),
      ],
      { IT: 4, RH: 2 },
      months
    );
    expect(total.available).toBe(6);
    expect(total.cells.map((c) => c.mobilised)).toEqual([2, 1, 4]);
    expect(total.cells.map((c) => c.ratePct)).toEqual([33, 17, 67]);
    expect(total.cells[2].contributions).toEqual([{ actionId: "p1", chantierId: "ch1", fte: 4 }]);
    expect(total.overCount).toBe(0);
  });

  it("détail d'une période : équipes > projets > lignes, ETP moyens, filtre équipe", () => {
    const march = periodBoundsForDate("2026-03-01", "monthly");
    const a = { ...line("IT", 2, "2026-03-17", "2026-06-30", "ch1", "p1"), note: "Alice" };
    const b = { ...line("IT", 3, "2026-01-01", undefined, "ch1", "p1"), note: "Bob" };
    const c = line("IT", 1, "2026-03-01", "2026-03-31", "ch2");
    const d = line("RH", 1, "2026-03-01", "2026-03-31", "ch1");
    const outside = line("RH", 4, "2026-04-01", "2026-04-30", "ch1");
    const undated = line("RH", 4);
    const entries = [a, b, c, d, outside, undated];
    const fte = { IT: 4, RH: 4, Finance: 2 };

    const all = periodStaffingDetail(entries, fte, march);
    expect(all.label).toBe("2026-03");
    expect(all.available).toBe(10);
    expect(all.mobilised).toBeCloseTo(3 + 2 * (15 / 31) + 1 + 1, 5);
    expect(all.teams.map((t) => t.team)).toEqual(["IT", "RH"]);
    const it = all.teams[0];
    expect(it.available).toBe(4);
    expect(it.level).toBe("over");
    expect(it.groups.map((g) => g.key)).toEqual(["a:p1", "c:ch2"]);
    expect(it.groups[0].lines.map((l) => l.entry.note)).toEqual(["Bob", "Alice"]);
    expect(it.groups[0].lines[1].fte).toBeCloseTo(2 * (15 / 31), 5);
    expect(it.groups[1].actionId).toBeUndefined();
    expect(all.teams[1].ratePct).toBe(25);

    const rh = periodStaffingDetail(entries, fte, march, "RH");
    expect(rh.available).toBe(4);
    expect(rh.mobilised).toBe(1);
    expect(rh.ratePct).toBe(25);
    expect(rh.teams.map((t) => t.team)).toEqual(["RH"]);

    const finance = periodStaffingDetail(entries, fte, march, "Finance");
    expect(finance.teams).toEqual([]);
    expect(finance.ratePct).toBe(0);
    expect(finance.level).toBe("ok");
  });
});
