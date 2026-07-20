import { describe, it, expect } from "vitest";
import { TEST_USERS, findUser } from "@/lib/auth";

describe("auth — TEST_USERS", () => {
  it("has 7 test users (6 roles + admin)", () => {
    expect(TEST_USERS).toHaveLength(7);
  });

  it("has one admin user", () => {
    const admin = TEST_USERS.find((u) => u.role === "admin");
    expect(admin).toBeDefined();
    expect(admin?.username).toBe("admin");
  });

  it("all users have password 'test'", () => {
    TEST_USERS.forEach((u) => {
      expect(u.password).toBe("test");
    });
  });

  it("non-admin users have companyId", () => {
    TEST_USERS.filter((u) => u.role !== "admin").forEach((u) => {
      expect(u.companyId).toBeDefined();
      expect(u.companyId).not.toBe("");
    });
  });

  it("admin has null companyId", () => {
    const admin = TEST_USERS.find((u) => u.role === "admin");
    expect(admin?.companyId).toBeNull();
  });
});

describe("auth — findUser", () => {
  it("finds existing user with correct credentials", () => {
    const user = findUser("test.cto", "test");
    expect(user).not.toBeNull();
    expect(user?.role).toBe("cto");
  });

  it("returns null for wrong password", () => {
    expect(findUser("test.cto", "wrong")).toBeNull();
  });

  it("returns null for unknown username", () => {
    expect(findUser("unknown", "test")).toBeNull();
  });

  it("is case-insensitive for username", () => {
    const user = findUser("TEST.CTO", "test");
    expect(user).not.toBeNull();
    expect(user?.role).toBe("cto");
  });

  it("finds admin user", () => {
    const user = findUser("admin", "test");
    expect(user).not.toBeNull();
    expect(user?.role).toBe("admin");
  });
});
