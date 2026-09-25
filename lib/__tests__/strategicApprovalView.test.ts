import { describe, expect, it } from "vitest";
import {
  chainPreviewText,
  chainStepsView,
  formatDiffValue,
  LEVEL_FALLBACK,
  patchDiffRows,
} from "@/lib/strategicApprovalView";
import type { StrategicApproval } from "@/lib/strategicApprovals";

const users = [
  { username: "marie", name: "Marie Curie" },
  { username: "paul", name: "Paul Valéry" },
  { username: "jean", name: "Jean Moulin" },
];

function approval(over: Partial<StrategicApproval> = {}): StrategicApproval {
  return {
    id: "SA-1",
    companyId: "c",
    programId: "p",
    kind: "kpi_value",
    targetType: "indicateur",
    targetId: "i1",
    payload: { period: "2026-09", value: 12 },
    requestedBy: "jean",
    requestedAt: "2026-09-01T10:00:00.000Z",
    approverRole: "axis_sponsor",
    approverUsernames: ["marie"],
    status: "pending",
    chain: [
      { level: "axisSponsor", usernames: ["marie"] },
      { level: "pilot", usernames: ["paul"] },
    ],
    stepIndex: 0,
    ...over,
  };
}

describe("chainStepsView", () => {
  it("renvoie [] pour une demande legacy (sans chaîne)", () => {
    expect(chainStepsView(approval({ chain: undefined }), users)).toEqual([]);
  });

  it("étape 1 en attente, étape 2 à venir, noms résolus", () => {
    const steps = chainStepsView(approval(), users);
    expect(steps.map((s) => s.state)).toEqual(["current", "upcoming"]);
    expect(steps[0].approverNames).toEqual(["Marie Curie"]);
    expect(steps[1]).toMatchObject({ index: 2, level: "pilot", approverNames: ["Paul Valéry"] });
  });

  it("étape 1 validée (qui/quand/commentaire), étape 2 courante", () => {
    const steps = chainStepsView(
      approval({
        stepIndex: 1,
        chain: [
          {
            level: "axisSponsor",
            usernames: ["marie"],
            decidedBy: "marie",
            decidedAt: "2026-09-02T08:00:00.000Z",
            decision: "approved",
            decisionComment: "OK",
          },
          { level: "pilot", usernames: ["paul"] },
        ],
      }),
      users
    );
    expect(steps[0]).toMatchObject({
      state: "approved",
      decidedByName: "Marie Curie",
      decidedAt: "2026-09-02T08:00:00.000Z",
      comment: "OK",
    });
    expect(steps[1].state).toBe("current");
  });

  it("refus à l'étape 1 : étape 2 jamais atteinte", () => {
    const steps = chainStepsView(
      approval({
        status: "rejected",
        chain: [
          { level: "axisSponsor", usernames: ["marie"], decidedBy: "marie", decision: "rejected" },
          { level: "pilot", usernames: ["paul"] },
        ],
      }),
      users
    );
    expect(steps.map((s) => s.state)).toEqual(["rejected", "skipped"]);
  });
});

describe("chainPreviewText", () => {
  const label = (l: keyof typeof LEVEL_FALLBACK) => LEVEL_FALLBACK[l];
  it("« Sponsor d'axe (Marie) puis Pilote (Paul) »", () => {
    expect(
      chainPreviewText(
        [
          { level: "axisSponsor", usernames: ["marie"] },
          { level: "pilot", usernames: ["paul"] },
        ],
        users,
        label,
        "puis"
      )
    ).toBe("Sponsor d'axe (Marie Curie) puis Pilote (Paul Valéry)");
  });
  it("chaîne vide → chaîne vide (publication directe)", () => {
    expect(chainPreviewText([], users, label, "puis")).toBe("");
  });
});

describe("patchDiffRows / formatDiffValue", () => {
  it("vide hors *_update", () => {
    expect(patchDiffRows(approval(), users)).toEqual([]);
  });

  it("diff lisible avant → après avec libellés et noms", () => {
    const rows = patchDiffRows(
      approval({
        kind: "projet_update",
        targetType: "projet",
        payload: {
          category: "designation",
          before: { owner: "jean", end: "2026-12-31", chantierId: "ch1" },
          patch: { owner: "marie", end: "2027-03-31", chantierId: "ch2" },
        },
      }),
      users,
      { ch1: "Chantier A", ch2: "Chantier B" }
    );
    expect(rows).toEqual([
      {
        field: "owner",
        labelKey: "validation.sa.field.owner",
        labelFallback: "Responsable projet",
        before: "Jean Moulin",
        after: "Marie Curie",
      },
      {
        field: "end",
        labelKey: "validation.sa.field.end",
        labelFallback: "Date de fin",
        before: "2026-12-31",
        after: "2027-03-31",
      },
      {
        field: "chantierId",
        labelKey: "validation.sa.field.chantierId",
        labelFallback: "Chantier de rattachement",
        before: "Chantier A",
        after: "Chantier B",
      },
    ]);
  });

  it("formate listes, objets et valeurs vides", () => {
    expect(formatDiffValue("contributors", ["marie", "paul"], users)).toBe(
      "Marie Curie, Paul Valéry"
    );
    expect(formatDiffValue("deliverables", [{ label: "L1" }, { label: "L2" }])).toBe("L1, L2");
    expect(formatDiffValue("deliverables", [{ id: "x" }])).toBe("1 élément(s)");
    expect(formatDiffValue("milestones", { currentMilestone: "E1" })).toBe("(modifié)");
    expect(formatDiffValue("budget", undefined)).toBe("—");
    expect(formatDiffValue("budget", 1200)).toBe("1200");
  });
});
