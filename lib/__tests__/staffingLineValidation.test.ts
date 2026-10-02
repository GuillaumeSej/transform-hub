import { describe, expect, it } from "vitest";
import {
  STAFFING_LINE_MESSAGES,
  checkStaffingLine,
  isIsoDate,
  isStaffingLineMissingDates,
  parseFte,
  staffingLineMessage,
  validateStaffingLine,
} from "@/lib/staffingLineValidation";
import fr from "@/lib/i18n/dictionaries/fr";
import en from "@/lib/i18n/dictionaries/en";
import de from "@/lib/i18n/dictionaries/de";
import es from "@/lib/i18n/dictionaries/es";

const valid = { team: "Data", fte: "0,5", startDate: "2026-03-01", endDate: "2026-06-30" };

describe("parseFte", () => {
  it("accepts French decimal comma and dot", () => {
    expect(parseFte("0,5")).toBe(0.5);
    expect(parseFte(" 1.25 ")).toBe(1.25);
    expect(parseFte("2")).toBe(2);
  });
  it("rejects empty, zero, negative and garbage", () => {
    expect(parseFte("")).toBeNull();
    expect(parseFte("   ")).toBeNull();
    expect(parseFte("0")).toBeNull();
    expect(parseFte("-1")).toBeNull();
    expect(parseFte("abc")).toBeNull();
    expect(parseFte("1,2,3")).toBeNull();
  });
});

describe("isIsoDate", () => {
  it("validates real ISO dates only", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("01/03/2026")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
});

describe("isStaffingLineMissingDates", () => {
  it("flags legacy lines without full dates", () => {
    expect(isStaffingLineMissingDates({})).toBe(true);
    expect(isStaffingLineMissingDates({ startDate: "2026-01-01" })).toBe(true);
    expect(isStaffingLineMissingDates({ startDate: "2026-01-01", endDate: "2026-02-01" })).toBe(
      false
    );
  });
});

describe("validateStaffingLine", () => {
  it("accepts a complete line", () => {
    const r = validateStaffingLine(valid);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual({});
    expect(r.fte).toBe(0.5);
    expect(r.warnings).toEqual([]);
  });

  it("requires every field on an empty form", () => {
    const r = validateStaffingLine({ team: "", fte: "", startDate: "", endDate: "" });
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual({
      team: "teamRequired",
      fte: "fteRequired",
      startDate: "startRequired",
      endDate: "endRequired",
    });
  });

  it("rejects a non-positive ETP and an unreadable one with distinct codes", () => {
    expect(validateStaffingLine({ ...valid, fte: "0" }).errors.fte).toBe("fteNotPositive");
    expect(validateStaffingLine({ ...valid, fte: "-1" }).errors.fte).toBe("fteNotPositive");
    expect(validateStaffingLine({ ...valid, fte: "x" }).errors.fte).toBe("fteInvalid");
    expect(validateStaffingLine({ ...valid, fte: "abc" }).errors.fte).toBe("fteInvalid");
  });

  it("no fixed cap any more: 8 ETP is accepted (same rule as both imports)", () => {
    const r = validateStaffingLine({ ...valid, fte: "8" });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual({});
    expect(r.fte).toBe(8);
    expect(r.warnings).toEqual([]);
    // Équipe de 14 ETP : 8 ETP reste en deçà, aucun avertissement.
    expect(
      validateStaffingLine({ ...valid, fte: "8" }, { teamAvailableFte: { Data: 14 } }).warnings
    ).toEqual([]);
  });

  it("warns (non-blocking) when the line exceeds the team's available FTE in the FTE base", () => {
    const rules = { knownTeams: ["Data", "RH"], teamAvailableFte: { Data: 14, RH: 0 } };
    const over = validateStaffingLine({ ...valid, fte: "50" }, rules);
    expect(over.valid).toBe(true);
    expect(over.errors).toEqual({});
    expect(over.fte).toBe(50);
    expect(over.warnings).toEqual(["fteAboveTeam"]);
    expect(over.teamAvailableFte).toBe(14);
    // Pile l'effectif : pas d'avertissement ; équipe saisie avec une autre casse : même équipe.
    expect(validateStaffingLine({ ...valid, fte: "14" }, rules).warnings).toEqual([]);
    expect(validateStaffingLine({ ...valid, team: " data ", fte: "14,5" }, rules).warnings).toEqual(
      ["fteAboveTeam"]
    );
    // Disponible inconnu (0, équipe absente du référentiel chiffré, base non chargée) : silence.
    expect(validateStaffingLine({ ...valid, team: "RH", fte: "50" }, rules).warnings).toEqual([]);
    expect(
      validateStaffingLine({ ...valid, fte: "50" }, { knownTeams: ["Data"], teamAvailableFte: {} })
        .warnings
    ).toEqual([]);
    expect(
      validateStaffingLine({ ...valid, fte: "50" }, { knownTeams: ["Data"] }).warnings
    ).toEqual([]);
    // Valeur illisible, nulle ou négative : toujours BLOQUANTE, jamais un simple avertissement.
    for (const [fte, code] of [
      ["-1", "fteNotPositive"],
      ["0", "fteNotPositive"],
      ["abc", "fteInvalid"],
    ] as const) {
      const r = validateStaffingLine({ ...valid, fte }, rules);
      expect(r.valid, fte).toBe(false);
      expect(r.errors.fte, fte).toBe(code);
      expect(r.warnings, fte).toEqual([]);
    }
    // Même règle sur des valeurs déjà lues (imports Excel).
    expect(
      checkStaffingLine(
        { team: "Data", fte: 50, startDate: "2026-01-01", endDate: "2026-06-30" },
        rules
      ).warnings
    ).toEqual(["fteAboveTeam"]);
  });

  it("checks the team against the FTE base when it is provided", () => {
    const knownTeams = ["Data", "RH"];
    expect(validateStaffingLine({ ...valid, team: " data " }, { knownTeams }).team).toBe("Data");
    expect(validateStaffingLine({ ...valid, team: "Astrologie" }, { knownTeams }).errors.team).toBe(
      "teamUnknown"
    );
    // Ligne existante dont l'équipe a quitté la base : modifiable, avec avertissement.
    const legacy = validateStaffingLine(
      { ...valid, team: "Logistique" },
      { knownTeams, currentTeam: "Logistique" }
    );
    expect(legacy.valid).toBe(true);
    expect(legacy.warnings).toEqual(["teamLeftBase"]);
    // Référentiel absent (chargement) : pas de contrôle.
    expect(validateStaffingLine({ ...valid, team: "Astrologie" }).valid).toBe(true);
  });

  it("renders exact translated messages with the line, team and available FTE filled in", () => {
    const t = (_key: string, fallback?: string) => fallback ?? "";
    const over = validateStaffingLine(
      { ...valid, fte: "50" },
      { knownTeams: ["Data"], teamAvailableFte: { Data: 14 } }
    );
    expect(staffingLineMessage(t, "fteAboveTeam", over)).toBe(
      "50 ETP sur cette ligne, au-delà de l'effectif de l'équipe Data dans la base ETP (14 ETP) — vérifiez la saisie."
    );
    expect(staffingLineMessage(t, "fteInvalid")).toBe(
      "Le nombre d'ETP doit être un nombre (ex. 0,5)."
    );
    for (const [code, [key, fallback]] of Object.entries(STAFFING_LINE_MESSAGES)) {
      expect(fr[key], code).toBe(fallback);
      for (const dict of [en, de, es]) expect(dict[key], `${code} traduit`).toBeTruthy();
    }
  });

  it("rejects end before start but allows same day", () => {
    expect(
      validateStaffingLine({ ...valid, startDate: "2026-06-01", endDate: "2026-05-31" }).errors
        .endDate
    ).toBe("endBeforeStart");
    expect(
      validateStaffingLine({ ...valid, startDate: "2026-06-01", endDate: "2026-06-01" }).valid
    ).toBe(true);
  });

  it("flags malformed dates", () => {
    const r = validateStaffingLine({ ...valid, startDate: "2026-13-01", endDate: "nope" });
    expect(r.errors.startDate).toBe("startInvalid");
    expect(r.errors.endDate).toBe("endInvalid");
  });

  it("warns (non-blocking) when outside project dates", () => {
    const project = { start: "2026-04-01", end: "2026-12-31" };
    const before = validateStaffingLine(valid, project);
    expect(before.valid).toBe(true);
    expect(before.warnings).toEqual(["outsideProject"]);

    const after = validateStaffingLine(
      { ...valid, startDate: "2026-05-01", endDate: "2027-01-15" },
      project
    );
    expect(after.valid).toBe(true);
    expect(after.warnings).toEqual(["outsideProject"]);

    const inside = validateStaffingLine(
      { ...valid, startDate: "2026-04-01", endDate: "2026-12-31" },
      project
    );
    expect(inside.warnings).toEqual([]);
  });

  it("ignores missing or invalid project bounds", () => {
    expect(validateStaffingLine(valid, { start: "", end: undefined }).warnings).toEqual([]);
    expect(validateStaffingLine(valid, null).warnings).toEqual([]);
  });

  it("does not warn about the project range while dates are invalid", () => {
    const r = validateStaffingLine(
      { ...valid, startDate: "2026-06-01", endDate: "2026-01-01" },
      { start: "2026-04-01", end: "2026-04-30" }
    );
    expect(r.errors.endDate).toBe("endBeforeStart");
    expect(r.warnings).toEqual([]);
  });
});
