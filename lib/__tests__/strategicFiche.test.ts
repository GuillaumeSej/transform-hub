import { describe, expect, it } from "vitest";
import { MILESTONE_CHECKLISTS } from "@/lib/milestoneChecklist";
import type { StrategicApproval } from "@/lib/strategicApprovals";
import {
  canDesignateAxisSponsor,
  chainLabel,
  changedFields,
  chantierRights,
  conflictingFields,
  directMilestoneAdvance,
  displayName,
  fillTemplate,
  flowOutcomeMessage,
  formatPendingValue,
  gatedCategoriesOf,
  pendingBadgeLabel,
  pendingFieldInfo,
  pendingRequestsOn,
  projetRights,
} from "@/lib/strategicFiche";
import type { HierarchyContext } from "@/lib/strategicHierarchy";
import type { Chantier, ChantierAction } from "@/types";

const users = [
  { username: "sa", name: "Sophie Axe" },
  { username: "sc", name: "Simon Chantier" },
  { username: "pilot", name: "Paula Pilote" },
];

const ctx: HierarchyContext = {
  axis: { owner: "sa" },
  chantier: { pilote: "sc" },
  projet: { owner: "rp", contributors: ["c1"] },
  pilots: ["pilot"],
};

const rights = (
  username: string | null,
  extra: { isAdmin?: boolean; readOnly?: boolean } = {}
) => ({ username, isAdmin: !!extra.isAdmin, readOnly: !!extra.readOnly, ctx });

function approval(o: Partial<StrategicApproval> = {}): StrategicApproval {
  return {
    id: "SA-1",
    companyId: "C1",
    programId: "P1",
    kind: "projet_update",
    targetType: "projet",
    targetId: "A1",
    payload: { patch: { owner: "c1" }, before: { owner: "rp" }, category: "designation" },
    requestedBy: "rp",
    requestedAt: "2026-09-01T10:00:00.000Z",
    approverRole: "chantier_owner",
    approverUsernames: ["sc"],
    status: "pending",
    chain: [
      { level: "chantierSponsor", usernames: ["sc"] },
      { level: "axisSponsor", usernames: ["sa"] },
    ],
    stepIndex: 0,
    ...o,
  } as StrategicApproval;
}

const action = (o: Partial<ChantierAction> = {}): ChantierAction => ({
  id: "A1",
  companyId: "C1",
  chantierId: "CH1",
  name: "Projet",
  start: "2026-01-01",
  end: "2026-12-31",
  status: "todo",
  owner: "rp",
  ...o,
});

describe("strategicFiche — labels", () => {
  it("resolves display names with a username fallback", () => {
    expect(displayName("sa", users)).toBe("Sophie Axe");
    expect(displayName("ghost", users)).toBe("ghost");
  });

  it("fills templates and leaves unknown placeholders untouched", () => {
    expect(fillTemplate("Étape {current}/{total} {x}", { current: 1, total: 2 })).toBe(
      "Étape 1/2 {x}"
    );
  });

  it("formats a chain as « X puis Y », same-step people joined by /", () => {
    expect(chainLabel([{ usernames: ["sc"] }, { usernames: ["sa", "pilot"] }], users, "puis")).toBe(
      "Simon Chantier puis Sophie Axe / Paula Pilote"
    );
    expect(chainLabel([], users, "puis")).toBe("");
  });

  it("builds the pending badge label with or without steps", () => {
    const tpl = { withStep: "En attente (étape {current}/{total})", plain: "En attente" };
    expect(pendingBadgeLabel({ current: 1, total: 2 }, tpl)).toBe("En attente (étape 1/2)");
    expect(pendingBadgeLabel({ current: 1, total: 1 }, tpl)).toBe("En attente");
    expect(pendingBadgeLabel({}, tpl)).toBe("En attente");
  });

  it("formats proposed values (usernames → names)", () => {
    expect(formatPendingValue("sa", users)).toBe("Sophie Axe");
    expect(formatPendingValue(["sa", "sc"], users)).toBe("Sophie Axe, Simon Chantier");
    expect(formatPendingValue(12, users)).toBe("12");
    expect(formatPendingValue(undefined, users)).toBe("—");
  });
});

describe("strategicFiche — rights", () => {
  it("contributors, owner and above can edit a projet; others and read-only users cannot", () => {
    expect(projetRights(rights("c1")).canEdit).toBe(true);
    expect(projetRights(rights("rp")).canEdit).toBe(true);
    expect(projetRights(rights("sc")).canEdit).toBe(true);
    expect(projetRights(rights("pilot")).canEdit).toBe(true);
    expect(projetRights(rights("stranger")).canEdit).toBe(false);
    expect(projetRights(rights("stranger", { isAdmin: true })).canEdit).toBe(true);
    expect(projetRights(rights("rp", { readOnly: true })).canEdit).toBe(false);
    expect(projetRights(rights(null)).canEdit).toBe(false);
  });

  it("owner designation needs chantier sponsor+, contributors designation needs project owner+", () => {
    expect(projetRights(rights("c1")).canDesignateContributors).toBe(false);
    expect(projetRights(rights("rp")).canDesignateContributors).toBe(true);
    expect(projetRights(rights("rp")).canDesignateOwner).toBe(false);
    expect(projetRights(rights("sc")).canDesignateOwner).toBe(true);
  });

  it("only the project owner and above may delete a projet", () => {
    expect(projetRights(rights("c1")).canDelete).toBe(false);
    expect(projetRights(rights("rp")).canDelete).toBe(true);
  });

  it("chantier edit = chantier sponsor and above; sponsors designated by the pilot/admin only", () => {
    expect(chantierRights(rights("rp")).canEdit).toBe(false);
    expect(chantierRights(rights("sc")).canEdit).toBe(true);
    expect(chantierRights(rights("sc")).canDesignateSponsor).toBe(false);
    expect(chantierRights(rights("sa")).canDesignateSponsor).toBe(false);
    expect(chantierRights(rights("pilot")).canDesignateSponsor).toBe(true);
    expect(chantierRights(rights("sc")).canDesignateProjectOwner).toBe(true);
    expect(chantierRights(rights("x", { isAdmin: true })).canDesignateSponsor).toBe(true);
  });

  it("axis sponsor designation is reserved to the pilot/admin", () => {
    expect(canDesignateAxisSponsor(rights("sa"))).toBe(false);
    expect(canDesignateAxisSponsor(rights("pilot"))).toBe(true);
    expect(canDesignateAxisSponsor(rights("pilot", { readOnly: true }))).toBe(false);
  });
});

describe("strategicFiche — changed / pending fields", () => {
  const current = action({ owner: "rp", budget: 10, description: "a" });

  it("lists really changed fields and the gated categories they touch", () => {
    const patch = { owner: "c1", budget: 10, description: "b" };
    expect(changedFields("projet", current, patch).sort()).toEqual(["description", "owner"]);
    expect(gatedCategoriesOf("projet", current, patch)).toEqual(["designation"]);
    expect(gatedCategoriesOf("projet", current, { budget: 20, end: "2027-01-01" })).toEqual([
      "pilotage",
      "planning",
    ]);
    expect(gatedCategoriesOf("projet", current, { description: "z" })).toEqual([]);
  });

  it("flags a second request on a field that already has one pending", () => {
    const approvals = [approval()];
    const target = { type: "projet" as const, id: "A1" };
    expect(conflictingFields(approvals, target, "projet", current, { owner: "sa" })).toEqual([
      "owner",
    ]);
    expect(conflictingFields(approvals, target, "projet", current, { budget: 99 })).toEqual([]);
    // Valeur inchangée : pas de conflit.
    expect(conflictingFields(approvals, target, "projet", current, { owner: "rp" })).toEqual([]);
  });

  it("describes the pending request of a field (step, current approvers, proposed value)", () => {
    const info = pendingFieldInfo([approval()], { type: "projet", id: "A1" }, "owner");
    expect(info?.current).toBe(1);
    expect(info?.total).toBe(2);
    expect(info?.approvers).toEqual(["sc"]);
    expect(info?.value).toBe("c1");
    expect(pendingFieldInfo([approval()], { type: "projet", id: "A1" }, "budget")).toBeUndefined();
    const step2 = pendingFieldInfo(
      [approval({ stepIndex: 1 })],
      { type: "projet", id: "A1" },
      "owner"
    );
    expect(step2?.current).toBe(2);
    expect(step2?.approvers).toEqual(["sa"]);
  });

  it("exposes the target milestone for a pending milestone request", () => {
    const m = approval({ kind: "milestone", payload: { targetMilestone: "E2" } });
    expect(pendingFieldInfo([m], { type: "projet", id: "A1" }, "milestones")?.value).toBe("E2");
  });

  it("lists pending requests of a target, oldest first, ignoring decided ones", () => {
    const list = pendingRequestsOn(
      [
        approval({ id: "b", requestedAt: "2026-09-02" }),
        approval({ id: "a", requestedAt: "2026-09-01" }),
        approval({ id: "c", status: "approved" }),
      ],
      { type: "projet", id: "A1" }
    );
    expect(list.map((a) => a.id)).toEqual(["a", "b"]);
  });
});

describe("strategicFiche — flow outcome message", () => {
  const tpl = {
    applied: "Appliqué",
    pending: "Envoyé en validation : {chain}",
    partial: "Partiel : {chain}",
    joiner: "puis",
  };

  it("applied / noop", () => {
    expect(flowOutcomeMessage({ outcome: "applied" }, users, tpl)).toBe("Appliqué");
    expect(flowOutcomeMessage({ outcome: "noop" }, users, tpl)).toBeNull();
  });

  it("pending uses the snapshotted chains of the created requests (deduplicated)", () => {
    const r = approval();
    expect(flowOutcomeMessage({ outcome: "pending", requests: [r, r] }, users, tpl)).toBe(
      "Envoyé en validation : Simon Chantier puis Sophie Axe"
    );
    expect(
      flowOutcomeMessage(
        {
          outcome: "partial",
          requests: [r, approval({ chain: [{ level: "pilot", usernames: ["pilot"] }] })],
        },
        users,
        tpl
      )
    ).toBe("Partiel : Simon Chantier puis Sophie Axe ; Paula Pilote");
  });

  it("falls back to the previewed chain when the flow returns no request", () => {
    expect(
      flowOutcomeMessage({ outcome: "pending" }, users, tpl, [
        { usernames: ["sa"] },
        { usernames: ["pilot"] },
      ])
    ).toBe("Envoyé en validation : Sophie Axe puis Paula Pilote");
  });
});

describe("strategicFiche — directMilestoneAdvance", () => {
  const chantier = {
    id: "CH1",
    companyId: "C1",
    programId: "P1",
    pilote: "pilote1",
    axisIds: [],
  } as unknown as Chantier;
  const complete = (owner: string) =>
    action({
      owner,
      milestones: {
        currentMilestone: "E2",
        passedMilestones: ["E0", "E1"],
        checklists: {
          E2: MILESTONE_CHECKLISTS.E2.map((d) => ({ itemId: d.itemId, progressPct: 100 })),
        },
      },
    });

  it("advances directly (no pending marker) for an admin", () => {
    const a = complete("someone");
    const patch = directMilestoneAdvance(
      a,
      { username: "admin", profiles: [], isGlobalAdmin: true },
      [chantier],
      [a],
      []
    );
    expect(patch.milestones?.currentMilestone).toBe("E3");
    expect(patch.milestones?.passedMilestones).toEqual(["E0", "E1", "E2"]);
    expect(patch.milestoneApproval).toBeUndefined();
  });

  it("advances directly for the program pilot (strategic_lead of P1) only — not the chantier sponsor", () => {
    const a = complete("pilote1");
    const patch = directMilestoneAdvance(
      a,
      { username: "lead", profiles: [{ role: "strategic_lead", programId: "P1" }] },
      [chantier],
      [a],
      []
    );
    expect(patch.milestones?.currentMilestone).toBe("E3");
    // Le sponsor de chantier (même propriétaire du projet) passe par une demande à chaîne.
    expect(() =>
      directMilestoneAdvance(a, { username: "pilote1", profiles: [] }, [chantier], [a], [])
    ).toThrow();
    // Pilote d'un AUTRE programme : non.
    expect(() =>
      directMilestoneAdvance(
        a,
        { username: "lead2", profiles: [{ role: "strategic_lead", programId: "P2" }] },
        [chantier],
        [a],
        []
      )
    ).toThrow();
  });

  it("refuses an incomplete checklist or a non-decider", () => {
    const incomplete = action({
      owner: "pilote1",
      milestones: { currentMilestone: "E2", passedMilestones: ["E0", "E1"], checklists: {} },
    });
    expect(() =>
      directMilestoneAdvance(
        incomplete,
        { username: "pilote1", profiles: [] },
        [chantier],
        [incomplete],
        []
      )
    ).toThrow();
    const ownedByOther = complete("owner1");
    expect(() =>
      directMilestoneAdvance(
        ownedByOther,
        { username: "owner1", profiles: [] },
        [chantier],
        [ownedByOther],
        []
      )
    ).toThrow();
  });
});
