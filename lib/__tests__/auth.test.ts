import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/auth.ts n'importe jamais le SDK Firebase statiquement : chaque fonction qui en a besoin
// fait un `await import(...)` de "firebase/auth" / "firebase/firestore" / "@/lib/firebase" au
// moment de l'appel. Ces mocks interceptent ces imports (dynamiques comme statiques) — les tests
// ci-dessous vérifient donc la logique de pont (mapping Firestore -> AuthUser, distinction des
// erreurs Firebase par code) sans jamais toucher un vrai projet Firebase.
const signInWithEmailAndPassword = vi.fn();
vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: (...args: unknown[]) => signInWithEmailAndPassword(...args),
}));

const getDoc = vi.fn();
vi.mock("firebase/firestore", () => ({
  doc: (...args: unknown[]) => args,
  getDoc: (...args: unknown[]) => getDoc(...args),
}));

const PRIMARY_AUTH = { __brand: "primary" };
vi.mock("@/lib/firebase", () => ({
  getAuthInstance: () => PRIMARY_AUTH,
  db: {},
}));

describe("auth — normalizeUsername", () => {
  it("lowercases and trims username", async () => {
    const { normalizeUsername } = await import("@/lib/auth");
    expect(normalizeUsername("  MonUser  ")).toBe("monuser");
  });

  it("leaves already-lowercase unchanged", async () => {
    const { normalizeUsername } = await import("@/lib/auth");
    expect(normalizeUsername("test.cto")).toBe("test.cto");
  });

  it("handles empty string", async () => {
    const { normalizeUsername } = await import("@/lib/auth");
    expect(normalizeUsername("")).toBe("");
  });
});

describe("auth — usernameToSyntheticEmail", () => {
  it("builds a synthetic @betrack.local email for a global admin (no companyId)", async () => {
    const { usernameToSyntheticEmail } = await import("@/lib/auth");
    expect(usernameToSyntheticEmail("admin")).toBe("admin@betrack.local");
  });

  it("normalizes the username first (trim + lowercase)", async () => {
    const { usernameToSyntheticEmail } = await import("@/lib/auth");
    expect(usernameToSyntheticEmail("  Test.CTO  ")).toBe("test.cto@betrack.local");
  });

  it("appends the companyId for a company account, so the same username can have a distinct account per company", async () => {
    const { usernameToSyntheticEmail } = await import("@/lib/auth");
    expect(usernameToSyntheticEmail("alice", "c1")).toBe("alice.c1@betrack.local");
  });

  it("falls back to the global-admin form when companyId is null/undefined", async () => {
    const { usernameToSyntheticEmail } = await import("@/lib/auth");
    expect(usernameToSyntheticEmail("alice", null)).toBe("alice@betrack.local");
    expect(usernameToSyntheticEmail("alice", undefined)).toBe("alice@betrack.local");
  });
});

describe("auth — accountSlug", () => {
  it("is the username alone for a global admin", async () => {
    const { accountSlug } = await import("@/lib/auth");
    expect(accountSlug("admin")).toBe("admin");
  });

  it("is username.companyId for a company account", async () => {
    const { accountSlug } = await import("@/lib/auth");
    expect(accountSlug("Alice", "c1")).toBe("alice.c1");
  });
});

describe("auth — accountSlugFromEmail", () => {
  it("extracts the local part of the synthetic email", async () => {
    const { accountSlugFromEmail } = await import("@/lib/auth");
    expect(accountSlugFromEmail("alice.c1@betrack.local")).toBe("alice.c1");
    expect(accountSlugFromEmail("admin@betrack.local")).toBe("admin");
  });
});

describe("auth — isFirebaseErrorCode", () => {
  it("matches an error object exposing the given code", async () => {
    const { isFirebaseErrorCode } = await import("@/lib/auth");
    expect(
      isFirebaseErrorCode({ code: "auth/email-already-in-use" }, "auth/email-already-in-use")
    ).toBe(true);
  });

  it("returns false for a different code", async () => {
    const { isFirebaseErrorCode } = await import("@/lib/auth");
    expect(isFirebaseErrorCode({ code: "auth/wrong-password" }, "auth/email-already-in-use")).toBe(
      false
    );
  });

  it("returns false for non-object / codeless values", async () => {
    const { isFirebaseErrorCode } = await import("@/lib/auth");
    expect(isFirebaseErrorCode(null, "auth/email-already-in-use")).toBe(false);
    expect(isFirebaseErrorCode("boom", "auth/email-already-in-use")).toBe(false);
    expect(isFirebaseErrorCode({}, "auth/email-already-in-use")).toBe(false);
  });
});

describe("auth — resolveAuthUserProfile", () => {
  beforeEach(() => {
    getDoc.mockReset();
  });

  it("maps the Firestore document at adminUsers/{slug} to an AuthUser", async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        username: "test.cto",
        password: "test",
        role: "cto",
        firstName: "Jean",
        lastName: "Dupont",
        name: "Jean Dupont",
        companyId: "c1",
      }),
    });
    const { resolveAuthUserProfile } = await import("@/lib/auth");
    const profile = await resolveAuthUserProfile("test.cto.c1");
    expect(profile).toEqual({
      username: "test.cto",
      password: "test",
      role: "cto",
      firstName: "Jean",
      lastName: "Dupont",
      name: "Jean Dupont",
      companyId: "c1",
      confidentialityClearance: undefined,
    });
  });

  it("throws an explicit error when no Firestore profile matches", async () => {
    getDoc.mockResolvedValue({ exists: () => false });
    const { resolveAuthUserProfile } = await import("@/lib/auth");
    await expect(resolveAuthUserProfile("ghost")).rejects.toThrow(/profil introuvable/);
  });
});

describe("auth — signInUser", () => {
  beforeEach(() => {
    signInWithEmailAndPassword.mockReset();
    getDoc.mockReset();
  });

  it("signs in against the PRIMARY auth instance using the global-admin synthetic email when no companyId is given", async () => {
    signInWithEmailAndPassword.mockResolvedValue({ user: { uid: "abc" } });
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        username: "admin",
        password: "test",
        role: "admin",
        firstName: "Admin",
        lastName: "BeTrack",
        name: "Admin BeTrack",
        companyId: null,
      }),
    });
    const { signInUser } = await import("@/lib/auth");
    const user = await signInUser("admin", "test");
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
      PRIMARY_AUTH,
      "admin@betrack.local",
      "test"
    );
    expect(user.role).toBe("admin");
  });

  it("signs in using the tenant-scoped synthetic email when a companyId is given", async () => {
    signInWithEmailAndPassword.mockResolvedValue({ user: { uid: "xyz" } });
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        username: "alice",
        password: "test",
        role: "cto",
        firstName: "Alice",
        lastName: "Martin",
        name: "Alice Martin",
        companyId: "c1",
      }),
    });
    const { signInUser } = await import("@/lib/auth");
    const user = await signInUser("alice", "test", "c1");
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
      PRIMARY_AUTH,
      "alice.c1@betrack.local",
      "test"
    );
    expect(user.companyId).toBe("c1");
  });

  it("lets a Firebase sign-in error propagate untouched (e.g. wrong password)", async () => {
    const authError = Object.assign(new Error("wrong password"), {
      code: "auth/invalid-credential",
    });
    signInWithEmailAndPassword.mockRejectedValue(authError);
    const { signInUser } = await import("@/lib/auth");
    await expect(signInUser("admin", "wrong")).rejects.toBe(authError);
  });
});
