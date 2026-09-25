import { describe, expect, it } from "vitest";
import {
  PROFILE_MIN_PASSWORD_LENGTH,
  describeProfiles,
  passwordChangeErrorMessage,
  summarizeClearance,
  validatePasswordChange,
} from "@/lib/profile";

const LEVELS = ["Public", "Restreint", "Confidentiel", "Secret"];

describe("validatePasswordChange", () => {
  it("accepts a valid change", () => {
    expect(
      validatePasswordChange({ current: "oldpass", next: "newpass1", confirm: "newpass1" })
    ).toEqual({});
  });

  it("requires the current and new passwords", () => {
    expect(validatePasswordChange({ current: "", next: "", confirm: "" })).toEqual({
      current: "currentRequired",
      next: "nextRequired",
    });
  });

  it("enforces the minimum length (6 by default, aligned with Firebase)", () => {
    expect(PROFILE_MIN_PASSWORD_LENGTH).toBe(6);
    expect(validatePasswordChange({ current: "oldpass", next: "12345", confirm: "12345" })).toEqual(
      {
        next: "tooShort",
      }
    );
    expect(
      validatePasswordChange({ current: "oldpass", next: "123456", confirm: "123456" })
    ).toEqual({});
    expect(
      validatePasswordChange({ current: "oldpass", next: "1234567", confirm: "1234567" }, 8).next
    ).toBe("tooShort");
  });

  it("rejects a new password identical to the current one", () => {
    expect(
      validatePasswordChange({ current: "samepass", next: "samepass", confirm: "samepass" })
    ).toEqual({ next: "sameAsCurrent" });
  });

  it("rejects a confirmation mismatch", () => {
    expect(
      validatePasswordChange({ current: "oldpass", next: "newpass1", confirm: "newpass2" })
    ).toEqual({ confirm: "mismatch" });
  });

  it("does not trim (spaces are meaningful)", () => {
    expect(
      validatePasswordChange({ current: "oldpass", next: "newpass ", confirm: "newpass" }).confirm
    ).toBe("mismatch");
  });
});

describe("passwordChangeErrorMessage", () => {
  it.each(["auth/wrong-password", "auth/invalid-credential", "auth/invalid-login-credentials"])(
    "maps %s to the wrong current password message",
    (code) => {
      expect(passwordChangeErrorMessage({ code }).key).toBe("profile.password.errorWrongCurrent");
    }
  );

  it("maps the other known codes", () => {
    expect(passwordChangeErrorMessage({ code: "auth/weak-password" }).key).toBe(
      "profile.password.errorWeak"
    );
    expect(passwordChangeErrorMessage({ code: "auth/too-many-requests" }).key).toBe(
      "profile.password.errorTooMany"
    );
    expect(passwordChangeErrorMessage({ code: "auth/requires-recent-login" }).key).toBe(
      "profile.password.errorRecentLogin"
    );
    expect(passwordChangeErrorMessage({ code: "auth/network-request-failed" }).key).toBe(
      "profile.password.errorNetwork"
    );
  });

  it("falls back to a generic message for unknown errors", () => {
    expect(passwordChangeErrorMessage(new Error("boom")).key).toBe("profile.password.errorGeneric");
    expect(passwordChangeErrorMessage(null).key).toBe("profile.password.errorGeneric");
    expect(passwordChangeErrorMessage({ code: "auth/other" }).fallback).toMatch(/pas pu/);
  });
});

describe("describeProfiles", () => {
  const programs = [
    { id: "p1", name: "Programme Alpha" },
    { id: "p2", name: "Plan Stratégique 2030" },
  ];

  it("returns role label keys with the program name", () => {
    expect(
      describeProfiles(
        {
          profiles: [
            { role: "lever", programId: "p1" },
            { role: "strategic_lead", programId: "p2" },
            { role: "cto" },
          ],
        },
        programs
      )
    ).toEqual([
      { roleLabelKey: "roles.lever.label", programName: "Programme Alpha" },
      { roleLabelKey: "roles.strategicLead.label", programName: "Plan Stratégique 2030" },
      { roleLabelKey: "roles.cto.label", programName: null },
    ]);
  });

  it("falls back to the raw program id when the program is unknown", () => {
    expect(
      describeProfiles({ profiles: [{ role: "finance", programId: "gone" }] }, programs)
    ).toEqual([{ roleLabelKey: "roles.finance.label", programName: "gone" }]);
  });

  it("handles a user without profiles", () => {
    expect(describeProfiles({ profiles: [] }, programs)).toEqual([]);
    expect(describeProfiles(null, programs)).toEqual([]);
  });
});

describe("summarizeClearance", () => {
  const company = {
    confidentialityLevels: LEVELS,
    roleClearance: { lever: "Restreint", strategic_lead: "Confidentiel" },
  };

  it("gives admins full access", () => {
    expect(summarizeClearance({ profiles: [], isCompanyAdmin: true }, company)).toEqual({
      kind: "admin",
    });
    expect(summarizeClearance({ profiles: [], isGlobalAdmin: true }, null)).toEqual({
      kind: "admin",
    });
  });

  it("honours an individual 'all' clearance", () => {
    expect(
      summarizeClearance(
        { profiles: [{ role: "lever" }], confidentialityClearance: "all" },
        company
      )
    ).toEqual({ kind: "all", source: "individual" });
  });

  it("honours an individual level (and legacy arrays)", () => {
    expect(
      summarizeClearance(
        { profiles: [{ role: "lever" }], confidentialityClearance: "Secret" },
        company
      )
    ).toEqual({ kind: "level", level: "Secret", source: "individual" });
    expect(
      summarizeClearance(
        { profiles: [{ role: "lever" }], confidentialityClearance: ["Public", "Confidentiel"] },
        company
      )
    ).toEqual({ kind: "level", level: "Confidentiel", source: "individual" });
  });

  it("treats an empty individual clearance as no access", () => {
    expect(
      summarizeClearance({ profiles: [{ role: "lever" }], confidentialityClearance: [] }, company)
    ).toEqual({ kind: "none", source: "individual" });
  });

  it("inherits the most permissive level across both tracks", () => {
    expect(
      summarizeClearance({ profiles: [{ role: "lever" }, { role: "strategic_lead" }] }, company)
    ).toEqual({ kind: "level", level: "Confidentiel", source: "profile" });
    expect(summarizeClearance({ profiles: [{ role: "lever" }] }, company)).toEqual({
      kind: "level",
      level: "Restreint",
      source: "profile",
    });
  });

  it("reports no access when the profile has no clearance", () => {
    expect(summarizeClearance({ profiles: [{ role: "finance" }] }, company)).toEqual({
      kind: "none",
      source: "profile",
    });
    expect(summarizeClearance({ profiles: [{ role: "lever" }] }, null)).toEqual({
      kind: "none",
      source: "profile",
    });
  });
});
