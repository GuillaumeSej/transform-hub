import { describe, expect, it } from "vitest";
import { draftRowToStaffing } from "@/components/strategic/ChantierDetailPanel";
import type { StaffingDraftRow } from "@/components/strategic/StaffingDraftTable";

const ids = {
  companyId: "c1",
  programId: "p1",
  chantierId: "ch1",
  actionId: "ca1",
};

const projectDates = { start: "2026-01-01", end: "2026-06-30" };

const row = (overrides: Partial<StaffingDraftRow> = {}): StaffingDraftRow => ({
  id: "SD-x",
  function: "R&D / Innovation",
  fte: 1,
  ...overrides,
});

describe("draftRowToStaffing", () => {
  it(
    "defaults startDate/endDate to the project's own dates when the draft row left them empty — " +
      'sans quoi la ligne est "non datée" et disparaît silencieusement de toutes les vues par ' +
      "période de /effectifs (lib/staffingNeed.ts, staffingPeriodBuckets) alors qu'elle reste visible " +
      "sur les cartes chantier/projet",
    () => {
      const staffing = draftRowToStaffing(row(), ids, projectDates);
      expect(staffing.startDate).toBe(projectDates.start);
      expect(staffing.endDate).toBe(projectDates.end);
    }
  );

  it("keeps an explicit startDate/endDate from the draft row over the project's dates", () => {
    const staffing = draftRowToStaffing(
      row({ startDate: "2026-02-01", endDate: "2026-03-01" }),
      ids,
      projectDates
    );
    expect(staffing.startDate).toBe("2026-02-01");
    expect(staffing.endDate).toBe("2026-03-01");
  });

  it("falls back to the project's start only when just the draft row's startDate is missing", () => {
    const staffing = draftRowToStaffing(row({ endDate: "2026-03-01" }), ids, projectDates);
    expect(staffing.startDate).toBe(projectDates.start);
    expect(staffing.endDate).toBe("2026-03-01");
  });

  it("carries the ids, function, fte and optional note through untouched", () => {
    const staffing = draftRowToStaffing(row({ note: "Alex D." }), ids, projectDates);
    expect(staffing).toMatchObject({
      companyId: ids.companyId,
      programId: ids.programId,
      chantierId: ids.chantierId,
      actionId: ids.actionId,
      function: "R&D / Innovation",
      fte: 1,
      note: "Alex D.",
    });
  });

  it("omits `note` entirely (never `undefined`) when the draft row has none", () => {
    const staffing = draftRowToStaffing(row(), ids, projectDates);
    expect("note" in staffing).toBe(false);
  });
});
