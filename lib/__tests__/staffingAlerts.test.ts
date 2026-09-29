import { describe, expect, it } from "vitest";
import { receivesStaffingAlerts, staffingOverruns } from "@/lib/staffingAlerts";
import type { AuthUser, ChantierStaffing } from "@/types";

const line = (fn: string, fte: number, startDate: string, endDate: string) =>
  ({
    id: `${fn}-${startDate}`,
    chantierId: "CH1",
    function: fn,
    fte,
    startDate,
    endDate,
  }) as ChantierStaffing;

const thresholds = { tense: 85, over: 100 };

describe("staffingOverruns", () => {
  it("flags a team above 100 % on current/future months only", () => {
    const entries = [
      line("IT", 12, "2026-10-01", "2026-12-31"), // futur : 12 / 10 = 120 %
      line("IT", 20, "2026-01-01", "2026-03-31"), // passé : ignoré
      line("RH", 4, "2026-10-01", "2026-12-31"), // 4 / 10 = 40 %
    ];
    const res = staffingOverruns(entries, { IT: 10, RH: 10 }, "2026-09-29", thresholds);
    expect(res).toHaveLength(1);
    expect(res[0].team).toBe("IT");
    expect(res[0].months).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    expect(res[0].from).toBe("2026-10-01");
    expect(res[0].to).toBe("2026-12-31");
    expect(res[0].peakRatePct).toBe(120);
  });

  it("tense is not an alert, company threshold is respected", () => {
    const entries = [line("IT", 9.5, "2026-10-01", "2026-10-31")];
    expect(staffingOverruns(entries, { IT: 10 }, "2026-09-29", thresholds)).toEqual([]);
    expect(
      staffingOverruns(entries, { IT: 10 }, "2026-09-29", { tense: 70, over: 90 })
    ).toHaveLength(1);
  });

  it("a mobilised team missing from the ETP base is over-staffed", () => {
    const entries = [line("Data", 2, "2026-10-01", "2026-10-31")];
    const res = staffingOverruns(entries, {}, "2026-09-29", thresholds);
    expect(res[0].team).toBe("Data");
    expect(res[0].peakRatePct).toBeNull();
  });
});

describe("receivesStaffingAlerts", () => {
  const u = (role: string, programId?: string) =>
    ({ profiles: [{ role, programId }] }) as unknown as AuthUser;
  it("pilot, HR of the program and admins", () => {
    expect(receivesStaffingAlerts(u("strategic_lead", "P1"), "P1")).toBe(true);
    expect(receivesStaffingAlerts(u("hr", "P1"), "P1")).toBe(true);
    expect(receivesStaffingAlerts(u("hr", "P2"), "P1")).toBe(false);
    expect(receivesStaffingAlerts(u("chantier_owner", "P1"), "P1")).toBe(false);
    expect(
      receivesStaffingAlerts({ profiles: [], isCompanyAdmin: true } as unknown as AuthUser, "P1")
    ).toBe(true);
  });
});
