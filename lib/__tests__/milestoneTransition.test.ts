import { describe, expect, it } from "vitest";
import { milestoneTransitionState } from "@/lib/axisLogic";
import {
  clearLegacyMilestoneMarker,
  isLegacyMilestoneMarker,
  legacyMilestoneMarkers,
} from "@/lib/strategicApprovals";
import { MILESTONE_CHECKLISTS } from "@/lib/milestoneChecklist";
import type { Chantier, ChantierAction, MilestoneId } from "@/types";

function fullChecklist(milestoneId: MilestoneId, pct = 100) {
  return MILESTONE_CHECKLISTS[milestoneId]
    .filter((d) => !d.auto)
    .map((d) => ({ itemId: d.itemId, progressPct: pct }));
}

function autoFlagsAt100(milestoneId: MilestoneId): Record<string, number> {
  return Object.fromEntries(
    MILESTONE_CHECKLISTS[milestoneId].filter((d) => d.auto).map((d) => [d.itemId, 100])
  );
}

function makeAction(overrides: Partial<ChantierAction> = {}): ChantierAction {
  return {
    id: "A1",
    companyId: "C1",
    chantierId: "CH1",
    name: "Mise en production plateforme data",
    owner: "owner1",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "todo",
    ...overrides,
  };
}

const chantier = {
  id: "CH1",
  companyId: "C1",
  programId: "P1",
  pilote: "pilote1",
} as unknown as Chantier;

describe("milestoneTransitionState", () => {
  it("in_progress when the current checklist is incomplete", () => {
    const action = makeAction({
      milestones: {
        currentMilestone: "E1",
        passedMilestones: ["E0"],
        checklists: { E1: fullChecklist("E1", 50) },
      },
    });
    expect(milestoneTransitionState(action, autoFlagsAt100("E1"))).toEqual({
      status: "in_progress",
      from: "E1",
      to: "E2",
    });
  });

  it("ready (J1 → J2) when every item of the current milestone is at 100", () => {
    const action = makeAction({
      milestones: {
        currentMilestone: "E1",
        passedMilestones: ["E0"],
        checklists: { E1: fullChecklist("E1") },
      },
    });
    expect(milestoneTransitionState(action, autoFlagsAt100("E1"))).toEqual({
      status: "ready",
      from: "E1",
      to: "E2",
    });
  });

  it("never reports a false ready when auto flags are unknown (degraded mode)", () => {
    const action = makeAction({
      milestones: {
        currentMilestone: "E1",
        passedMilestones: ["E0"],
        checklists: { E1: fullChecklist("E1") },
      },
    });
    // E1 has an auto item (effortComplete) : without its live value it blocks.
    expect(milestoneTransitionState(action).status).toBe("in_progress");
  });

  it("a custom action still at 0 blocks the ready state", () => {
    const action = makeAction({
      milestones: {
        currentMilestone: "E2",
        passedMilestones: ["E0", "E1"],
        checklists: { E2: [...fullChecklist("E2"), { itemId: "CUSTOM-1", progressPct: 0 }] },
      },
      customMilestoneActions: { E2: [{ id: "CUSTOM-1", label: "Recette" }] },
    });
    expect(milestoneTransitionState(action).status).toBe("in_progress");
  });

  it("pending takes priority and exposes who/when", () => {
    const action = makeAction({
      milestones: {
        currentMilestone: "E1",
        passedMilestones: ["E0"],
        checklists: { E1: fullChecklist("E1") },
      },
      milestoneApproval: {
        targetMilestone: "E2",
        requestedBy: "owner1",
        requestedAt: "2026-09-20T10:00:00.000Z",
      },
    });
    expect(milestoneTransitionState(action)).toEqual({
      status: "pending",
      from: "E1",
      to: "E2",
      requestedBy: "owner1",
      requestedAt: "2026-09-20T10:00:00.000Z",
    });
  });

  it("final when the last milestone (J4) is complete", () => {
    const action = makeAction({
      milestones: {
        currentMilestone: "E4",
        passedMilestones: ["E0", "E1", "E2", "E3"],
        checklists: { E4: fullChecklist("E4") },
      },
    });
    expect(milestoneTransitionState(action, autoFlagsAt100("E4"))).toEqual({
      status: "final",
      from: "E4",
    });
  });

  it("defaults to E0 for a projet without milestones", () => {
    expect(milestoneTransitionState(makeAction()).from).toBe("E0");
  });
});

describe("legacy milestone markers (old single-approver path removed)", () => {
  const pending = makeAction({
    milestones: {
      currentMilestone: "E1",
      passedMilestones: ["E0"],
      checklists: { E1: fullChecklist("E1") },
    },
    milestoneApproval: {
      targetMilestone: "E2",
      requestedBy: "owner1",
      requestedAt: "2026-09-20T10:00:00.000Z",
    },
  });
  const chainRequest = { kind: "milestone" as const, status: "pending" as const, targetId: "A1" };

  it("a marker without a pending chained request is a legacy (read-only) marker", () => {
    expect(isLegacyMilestoneMarker(pending, [])).toBe(true);
    expect(legacyMilestoneMarkers([pending, makeAction({ id: "A2" })], [])).toEqual([pending]);
  });

  it("a marker mirrored by a pending chained request is NOT legacy", () => {
    expect(isLegacyMilestoneMarker(pending, [chainRequest])).toBe(false);
    expect(
      isLegacyMilestoneMarker(pending, [{ ...chainRequest, status: "approved" as const }])
    ).toBe(true);
  });

  it("only an admin can clear a legacy marker — never the chantier pilote nor the owner", () => {
    expect(() => clearLegacyMilestoneMarker(pending, { isCompanyAdmin: false }, [])).toThrow();
    const cleared = clearLegacyMilestoneMarker(pending, { isCompanyAdmin: true }, []);
    expect(cleared.milestoneApproval).toBeUndefined();
    expect(cleared.milestones?.currentMilestone).toBe("E1");
    expect(chantier.pilote).toBe("pilote1");
  });

  it("refuses to clear a marker carried by a pending chained request", () => {
    expect(() =>
      clearLegacyMilestoneMarker(pending, { isGlobalAdmin: true }, [chainRequest])
    ).toThrow();
  });
});
