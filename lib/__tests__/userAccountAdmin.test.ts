import { describe, expect, it } from "vitest";
import {
  buildPasswordResetMailto,
  disableBlockReason,
  filterUsersByStatus,
  generateRandomPassword,
  isActiveCompanyAdmin,
  isValidContactEmail,
} from "@/lib/userAccountAdmin";

describe("userAccountAdmin — isValidContactEmail", () => {
  it("accepts an empty value (the field is optional)", () => {
    expect(isValidContactEmail("")).toBe(true);
    expect(isValidContactEmail("   ")).toBe(true);
  });

  it("accepts a well-formed address, trimming surrounding spaces", () => {
    expect(isValidContactEmail("jean.dupont@acme.com")).toBe(true);
    expect(isValidContactEmail("  jean@acme.fr ")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidContactEmail("jean")).toBe(false);
    expect(isValidContactEmail("jean@acme")).toBe(false);
    expect(isValidContactEmail("jean dupont@acme.com")).toBe(false);
    expect(isValidContactEmail("@acme.com")).toBe(false);
  });
});

describe("userAccountAdmin — isActiveCompanyAdmin", () => {
  it("recognizes both the new flag and the legacy role, unless disabled", () => {
    expect(isActiveCompanyAdmin({ username: "a", isCompanyAdmin: true })).toBe(true);
    expect(isActiveCompanyAdmin({ username: "a", role: "admin_entreprise" })).toBe(true);
    expect(isActiveCompanyAdmin({ username: "a", isCompanyAdmin: true, disabled: true })).toBe(
      false
    );
    expect(isActiveCompanyAdmin({ username: "a" })).toBe(false);
  });
});

describe("userAccountAdmin — disableBlockReason", () => {
  const admin1 = { username: "admin1", companyId: "c1", isCompanyAdmin: true };
  const admin2 = { username: "admin2", companyId: "c1", isCompanyAdmin: true };
  const member = { username: "bob", companyId: "c1" };

  it("blocks disabling one's own account", () => {
    expect(disableBlockReason(member, [member], { username: "bob", companyId: "c1" })).toBe("self");
  });

  it("does not confuse the same username in another company with oneself", () => {
    expect(disableBlockReason(member, [member], { username: "bob", companyId: "c2" })).toBeNull();
  });

  it("blocks disabling the last active company admin", () => {
    expect(disableBlockReason(admin1, [admin1, member], null)).toBe("lastCompanyAdmin");
  });

  it("ignores disabled admins and admins of other companies when counting", () => {
    const disabledAdmin = { ...admin2, disabled: true };
    const otherCompanyAdmin = { ...admin2, companyId: "c2" };
    expect(disableBlockReason(admin1, [admin1, disabledAdmin, otherCompanyAdmin], null)).toBe(
      "lastCompanyAdmin"
    );
  });

  it("allows disabling an admin when another active admin remains, or a regular member", () => {
    expect(disableBlockReason(admin1, [admin1, admin2], null)).toBeNull();
    expect(
      disableBlockReason(member, [admin1, member], { username: "admin1", companyId: "c1" })
    ).toBeNull();
  });

  it("never applies the last-admin rule to a global account (no company)", () => {
    expect(disableBlockReason({ username: "root", companyId: null }, [], null)).toBeNull();
  });
});

describe("userAccountAdmin — filterUsersByStatus", () => {
  const users = [{ disabled: true }, { disabled: false }, {}];
  it("filters active / disabled / all", () => {
    expect(filterUsersByStatus(users, "all")).toHaveLength(3);
    expect(filterUsersByStatus(users, "active")).toHaveLength(2);
    expect(filterUsersByStatus(users, "disabled")).toEqual([{ disabled: true }]);
  });
});

describe("userAccountAdmin — buildPasswordResetMailto", () => {
  it("builds an encoded French mailto with the link and username in the body", () => {
    const link = "https://example.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=a b";
    const href = buildPasswordResetMailto({
      email: " jean@acme.com ",
      displayName: "Jean Dupont",
      username: "jean.dupont",
      link,
    });
    expect(href.startsWith("mailto:jean%40acme.com?subject=")).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(params.get("subject")).toContain("mot de passe");
    const body = params.get("body") ?? "";
    expect(body).toContain("Bonjour Jean Dupont,");
    expect(body).toContain("jean.dupont");
    expect(body).toContain(link);
  });
});

describe("userAccountAdmin — generateRandomPassword", () => {
  it("returns a long random password, different each time", () => {
    const a = generateRandomPassword();
    const b = generateRandomPassword();
    expect(a).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(generateRandomPassword(12)).toHaveLength(12);
  });
});
