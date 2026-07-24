import { describe, it, expect } from "vitest";
import { planCompanyScopedReset } from "@/lib/companyResetLogic";
import type { AuditEntry, Comment, Lever, SubLever } from "@/types";

function lever(id: string, companyId?: string | null): Lever {
  return {
    id,
    code: id,
    type: "Sourcing",
    name: id,
    ws: "WS-01",
    owner: "Owner",
    ownerInit: "OW",
    sponsor: "Sponsor",
    sponsorInit: "SP",
    geography: "Europe",
    country: "France",
    entity: "Entity A",
    function: "Supply Chain",
    costCenter: "CC01",
    pnlMap: "PNL01",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "idea",
    priority: "medium",
    risk: "low",
    progress: 0,
    savingsTarget: 0,
    savingsActual: 0,
    dependencies: [],
    companyId: companyId ?? undefined,
  } as unknown as Lever;
}

function subLever(id: string, leverId: string, companyId?: string | null): SubLever {
  return {
    id,
    leverId,
    name: id,
    owner: "Owner",
    ownerInit: "OW",
    status: "idea",
    progress: 0,
    savingsTarget: 0,
    savingsActual: 0,
    dependencies: [],
    companyId: companyId ?? undefined,
  } as unknown as SubLever;
}

describe("planCompanyScopedReset", () => {
  const levers: Lever[] = [lever("L001", "c1"), lever("L002", "c2"), lever("L003", undefined)];
  const subLevers: SubLever[] = [
    subLever("SL001", "L001", "c1"),
    subLever("SL002", "L002", "c2"),
    // Pas de companyId propre, mais rattaché par leverId à un levier de c1.
    subLever("SL003", "L001", undefined),
  ];
  const comments: Record<string, Comment[]> = {
    L001: [{ user: "u", ts: "2026-01-01", text: "hello c1" }],
    L002: [{ user: "u", ts: "2026-01-01", text: "hello c2" }],
    SL003: [{ user: "u", ts: "2026-01-01", text: "sub comment" }],
    MV001: [{ user: "u", ts: "2026-01-01", text: "not a lever" }],
  };
  const audit: AuditEntry[] = [
    {
      ts: "2026-01-01",
      user: "u",
      action: "created",
      entity: "L001",
      field: "x",
      old: "",
      new: "",
    },
    {
      ts: "2026-01-01",
      user: "u",
      action: "created",
      entity: "L002",
      field: "x",
      old: "",
      new: "",
    },
    {
      ts: "2026-01-01",
      user: "u",
      action: "created",
      entity: "SL003",
      field: "x",
      old: "",
      new: "",
    },
    {
      ts: "2026-01-01",
      user: "u",
      action: "created",
      entity: "MV001",
      field: "x",
      old: "",
      new: "",
    },
  ];

  it("only scopes levers/subLevers explicitly tagged for the target company (plus subLevers linked via leverId)", () => {
    const plan = planCompanyScopedReset(levers, subLevers, comments, audit, "c1");
    expect(plan.leverIds).toEqual(["L001"]);
    expect(plan.subLeverIds.sort()).toEqual(["SL001", "SL003"]);
  });

  it("never touches another company's tagged lever/subLever", () => {
    const plan = planCompanyScopedReset(levers, subLevers, comments, audit, "c1");
    expect(plan.leverIds).not.toContain("L002");
    expect(plan.subLeverIds).not.toContain("SL002");
    expect(plan.remainingComments.L002).toEqual(comments.L002);
    expect(plan.remainingAudit.some((e) => e.entity === "L002")).toBe(true);
  });

  it("strips comments/audit entries keyed by this company's lever/subLever ids only", () => {
    const plan = planCompanyScopedReset(levers, subLevers, comments, audit, "c1");
    expect(plan.remainingComments.L001).toBeUndefined();
    expect(plan.remainingComments.SL003).toBeUndefined();
    expect(plan.removedCommentKeys.sort()).toEqual(["L001", "SL003"]);
    expect(plan.remainingAudit.map((e) => e.entity).sort()).toEqual(["L002", "MV001"]);
    expect(plan.removedAuditCount).toBe(2);
  });

  it("leaves entries not attributable to a known lever/subLever untouched (e.g. workforce movements)", () => {
    const plan = planCompanyScopedReset(levers, subLevers, comments, audit, "c1");
    expect(plan.remainingComments.MV001).toEqual(comments.MV001);
    expect(plan.remainingAudit.some((e) => e.entity === "MV001")).toBe(true);
  });

  it("excludes untagged (companyId-less) levers from the scoped plan", () => {
    const plan = planCompanyScopedReset(levers, subLevers, comments, audit, "c1");
    expect(plan.leverIds).not.toContain("L003");
  });
});
