import { describe, expect, it } from "vitest";
import {
  isIsoDate,
  isStaffingLineMissingDates,
  parseFte,
  validateStaffingLine,
} from "@/lib/staffingLineValidation";

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

  it("rejects a non-positive ETP", () => {
    expect(validateStaffingLine({ ...valid, fte: "0" }).errors.fte).toBe("fteInvalid");
    expect(validateStaffingLine({ ...valid, fte: "x" }).errors.fte).toBe("fteInvalid");
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
