import { describe, expect, it } from "vitest";
import { decisionNoticesFor, pendingSubmissionMessage } from "@/lib/approvalNotices";
import type { StrategicApproval } from "@/lib/strategicApprovals";

const req = (over: Partial<StrategicApproval>): StrategicApproval =>
  ({
    id: "A1",
    kind: "kpi_value",
    targetType: "indicateur",
    targetId: "I1",
    targetName: "NPS",
    requestedBy: "carl",
    requestedAt: "2026-09-20T10:00:00Z",
    status: "approved",
    decidedBy: "sa",
    decidedByName: "Sophie A.",
    decidedAt: "2026-09-27T10:00:00Z",
    ...over,
  }) as StrategicApproval;

describe("decisionNoticesFor", () => {
  it("notifies the requester of recent decisions by someone else", () => {
    const res = decisionNoticesFor("carl", [req({})], "2026-09-29");
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      status: "approved",
      decidedByName: "Sophie A.",
      targetName: "NPS",
    });
  });

  it("keeps the rejection comment", () => {
    const res = decisionNoticesFor(
      "carl",
      [req({ status: "rejected", decisionComment: "Valeur à revoir" })],
      "2026-09-29"
    );
    expect(res[0].comment).toBe("Valeur à revoir");
  });

  it("ignores pending, old, self-decided and other people's requests", () => {
    expect(decisionNoticesFor("carl", [req({ status: "pending" })], "2026-09-29")).toEqual([]);
    expect(
      decisionNoticesFor("carl", [req({ decidedAt: "2026-09-01T00:00:00Z" })], "2026-09-29")
    ).toEqual([]);
    expect(decisionNoticesFor("carl", [req({ decidedBy: "carl" })], "2026-09-29")).toEqual([]);
    expect(decisionNoticesFor("dan", [req({})], "2026-09-29")).toEqual([]);
  });
});

describe("pendingSubmissionMessage", () => {
  const templates = {
    withChain: "Demande envoyée — en attente de validation par {chain}",
    noChain: "Demande envoyée — en attente de validation",
    joiner: "puis",
  };
  it("lists the chain step by step", () => {
    expect(pendingSubmissionMessage([["Marie"], ["Paul", "Léa"]], templates)).toBe(
      "Demande envoyée — en attente de validation par Marie puis Paul / Léa"
    );
  });
  it("falls back without names", () => {
    expect(pendingSubmissionMessage([], templates)).toBe(templates.noChain);
  });
});
