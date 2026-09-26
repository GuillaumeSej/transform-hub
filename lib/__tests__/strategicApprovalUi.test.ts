import { describe, expect, it } from "vitest";
import {
  ApprovalForbiddenError,
  ApprovalGateUnavailableError,
  ApprovalRetryError,
} from "@/lib/strategicApprovalFlows";
import type { StrategicApproval } from "@/lib/strategicApprovals";
import {
  approvalErrorKind,
  approvalErrorToast,
  canCreateChantierOnAxis,
  pendingOfKind,
  pendingStaffingCreations,
  pendingStaffingForLine,
} from "@/lib/strategicApprovalUi";
import type { AuthUser, ChantierStaffing } from "@/types";

function user(username: string, role?: string, programId = "P1", extra: Partial<AuthUser> = {}) {
  return {
    username,
    name: username.toUpperCase(),
    profiles: role ? [{ role, track: "strategic", programId }] : [],
    ...extra,
  } as unknown as AuthUser;
}

const templates = {
  title: "Action impossible",
  retryTitle: "Chargement",
  retry: "Réessayez",
  fallback: "Erreur",
};

describe("approvalErrorKind / approvalErrorToast", () => {
  it("classe les erreurs de flux", () => {
    expect(approvalErrorKind(new ApprovalRetryError())).toBe("retry");
    expect(approvalErrorKind(new ApprovalGateUnavailableError())).toBe("unavailable");
    expect(approvalErrorKind(new ApprovalForbiddenError())).toBe("forbidden");
    expect(approvalErrorKind(new Error("boom"))).toBe("other");
    expect(approvalErrorKind("x")).toBe("other");
    const renamed = new Error("x");
    renamed.name = "ApprovalRetryError";
    expect(approvalErrorKind(renamed)).toBe("retry");
  });

  it("retry → libellé traduit ; autres → message de l'erreur, sinon repli", () => {
    expect(approvalErrorToast(new ApprovalRetryError("brut"), templates)).toEqual({
      title: "Chargement",
      message: "Réessayez",
      kind: "retry",
    });
    expect(approvalErrorToast(new ApprovalForbiddenError("Interdit"), templates)).toEqual({
      title: "Action impossible",
      message: "Interdit",
      kind: "forbidden",
    });
    expect(approvalErrorToast(new Error(""), templates).message).toBe("Erreur");
  });
});

describe("canCreateChantierOnAxis", () => {
  const axis = { id: "AX1", programId: "P1", owner: "sa" };
  const chantiers = [
    { pilote: "sc", axisIds: ["AX1"] },
    { pilote: "other", axisIds: ["AX2"] },
  ];

  it("pilote du programme, admin, sponsor de l'axe, sponsor d'un chantier de l'axe", () => {
    expect(canCreateChantierOnAxis(user("lead", "strategic_lead"), axis, chantiers)).toBe(true);
    expect(
      canCreateChantierOnAxis(
        user("adm", undefined, "P1", { isGlobalAdmin: true }),
        axis,
        chantiers
      )
    ).toBe(true);
    expect(canCreateChantierOnAxis(user("sa", "axis_sponsor"), axis, chantiers)).toBe(true);
    expect(canCreateChantierOnAxis(user("sc", "chantier_owner"), axis, chantiers)).toBe(true);
  });

  it("refuse contributeurs, sponsors d'autres axes, pilote d'un autre programme, comex/RH", () => {
    expect(canCreateChantierOnAxis(user("c1", "projet_contributor"), axis, chantiers)).toBe(false);
    expect(canCreateChantierOnAxis(user("other", "chantier_owner"), axis, chantiers)).toBe(false);
    expect(canCreateChantierOnAxis(user("lead2", "strategic_lead", "P2"), axis, chantiers)).toBe(
      false
    );
    expect(canCreateChantierOnAxis(user("sa", "comex_member"), axis, chantiers)).toBe(false);
    expect(canCreateChantierOnAxis(user("sc", "hr"), axis, chantiers)).toBe(false);
    expect(canCreateChantierOnAxis(null, axis, chantiers)).toBe(false);
    expect(canCreateChantierOnAxis(user("sa"), null, chantiers)).toBe(false);
  });
});

describe("demandes en attente", () => {
  const line = (id: string, actionId?: string): ChantierStaffing => ({
    id,
    companyId: "C",
    programId: "P1",
    chantierId: "CH1",
    function: "IT",
    fte: 1,
    createdAt: "2026-01-01",
    ...(actionId ? { actionId } : {}),
  });
  const approval = (
    id: string,
    kind: StrategicApproval["kind"],
    targetType: StrategicApproval["targetType"],
    targetId: string,
    payload: unknown,
    status: StrategicApproval["status"] = "pending"
  ) => ({ id, kind, targetType, targetId, payload, status }) as unknown as StrategicApproval;

  const approvals = [
    approval("a1", "staffing_update", "chantier", "CH1", { op: "create", line: line("L1") }),
    approval("a2", "staffing_update", "projet", "PR1", { op: "create", line: line("L2", "PR1") }),
    approval("a3", "staffing_update", "chantier", "CH1", { op: "update", line: line("L3") }),
    approval(
      "a4",
      "staffing_update",
      "chantier",
      "CH1",
      { op: "delete", line: line("L4") },
      "approved"
    ),
    approval("a5", "indicator_update", "indicateur", "I1", { patch: {}, before: {} }),
    approval("a6", "axe_update", "axe", "AX1", { patch: {}, before: {}, category: "pilotage" }),
  ];

  it("pendingOfKind filtre kind + cible + statut", () => {
    expect(
      pendingOfKind(approvals, "indicator_update", "indicateur", "I1").map((a) => a.id)
    ).toEqual(["a5"]);
    expect(pendingOfKind(approvals, "axe_update", "axe", "AX1").map((a) => a.id)).toEqual(["a6"]);
    expect(pendingOfKind(approvals, "axe_update", "axe", "AX2")).toEqual([]);
    expect(pendingOfKind(undefined, "axe_update", "axe", "AX1")).toEqual([]);
  });

  it("pendingStaffingForLine : ligne existante en attente (hors décidées)", () => {
    expect(pendingStaffingForLine(approvals, "L3")?.id).toBe("a3");
    expect(pendingStaffingForLine(approvals, "L4")).toBeUndefined();
    expect(pendingStaffingForLine(approvals, "nope")).toBeUndefined();
  });

  it("pendingStaffingCreations : créations d'un chantier, éventuellement par périmètre", () => {
    expect(pendingStaffingCreations(approvals, "CH1").map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(pendingStaffingCreations(approvals, "CH1", null).map((a) => a.id)).toEqual(["a1"]);
    expect(pendingStaffingCreations(approvals, "CH1", "PR1").map((a) => a.id)).toEqual(["a2"]);
    expect(pendingStaffingCreations(approvals, "CH2")).toEqual([]);
  });
});
