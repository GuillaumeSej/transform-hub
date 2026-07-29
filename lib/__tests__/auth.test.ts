import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/auth.ts n'importe jamais le SDK Firebase statiquement : chaque fonction qui en a besoin
// fait un `await import(...)` de "firebase/auth" / "firebase/firestore" / "@/lib/firebase" au
// moment de l'appel. Ces mocks interceptent ces imports (dynamiques comme statiques) — les tests
// ci-dessous vérifient donc la logique de pont (mapping Firestore -> AuthUser, distinction des
// erreurs Firebase par code, usage d'une instance Auth secondaire pour le seed) sans jamais
// toucher un vrai projet Firebase.
const signInWithEmailAndPassword = vi.fn();
const createUserWithEmailAndPassword = vi.fn();
vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: (...args: unknown[]) => signInWithEmailAndPassword(...args),
  createUserWithEmailAndPassword: (...args: unknown[]) => createUserWithEmailAndPassword(...args),
}));

const getDocs = vi.fn();
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => "adminUsers-collection"),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((...args: unknown[]) => args),
  getDocs: (...args: unknown[]) => getDocs(...args),
}));

const PRIMARY_AUTH = { __brand: "primary" };
const SECONDARY_AUTH = { __brand: "secondary" };
vi.mock("@/lib/firebase", () => ({
  auth: PRIMARY_AUTH,
  db: {},
  withSecondaryAuth: vi.fn(async (fn: (secondaryAuth: unknown) => Promise<unknown>) =>
    fn(SECONDARY_AUTH)
  ),
}));

describe("auth — TEST_USERS", () => {
  it("has 8 test users (admin + admin_entreprise + 6 roles)", async () => {
    const { TEST_USERS } = await import("@/lib/auth");
    expect(TEST_USERS).toHaveLength(8);
  });

  it("has one global admin user", async () => {
    const { TEST_USERS } = await import("@/lib/auth");
    const admin = TEST_USERS.find((u) => u.role === "admin");
    expect(admin).toBeDefined();
    expect(admin?.username).toBe("admin");
  });

  it("has one admin_entreprise user", async () => {
    const { TEST_USERS } = await import("@/lib/auth");
    const adminEnt = TEST_USERS.find((u) => u.role === "admin_entreprise");
    expect(adminEnt).toBeDefined();
    expect(adminEnt?.companyId).toBe("c1");
  });

  it("all users have password 'test123'", async () => {
    const { TEST_USERS } = await import("@/lib/auth");
    TEST_USERS.forEach((u) => {
      expect(u.password).toBe("test123");
    });
  });

  it("non-admin users have companyId", async () => {
    const { TEST_USERS } = await import("@/lib/auth");
    TEST_USERS.filter((u) => u.role !== "admin").forEach((u) => {
      expect(u.companyId).toBeDefined();
      expect(u.companyId).not.toBe("");
    });
  });

  it("admin has null companyId", async () => {
    const { TEST_USERS } = await import("@/lib/auth");
    const admin = TEST_USERS.find((u) => u.role === "admin");
    expect(admin?.companyId).toBeNull();
  });
});

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
  it("builds a synthetic @betrack.local email from the username", async () => {
    const { usernameToSyntheticEmail } = await import("@/lib/auth");
    expect(usernameToSyntheticEmail("admin")).toBe("admin@betrack.local");
  });

  it("normalizes the username first (trim + lowercase)", async () => {
    const { usernameToSyntheticEmail } = await import("@/lib/auth");
    expect(usernameToSyntheticEmail("  Test.CTO  ")).toBe("test.cto@betrack.local");
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
    getDocs.mockReset();
  });

  it("maps the matching Firestore document to an AuthUser", async () => {
    getDocs.mockResolvedValue({
      empty: false,
      docs: [
        {
          data: () => ({
            username: "test.cto",
            password: "test",
            role: "cto",
            firstName: "Jean",
            lastName: "Dupont",
            name: "Jean Dupont",
            companyId: "c1",
          }),
        },
      ],
    });
    const { resolveAuthUserProfile } = await import("@/lib/auth");
    const profile = await resolveAuthUserProfile("test.cto");
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
    getDocs.mockResolvedValue({ empty: true, docs: [] });
    const { resolveAuthUserProfile } = await import("@/lib/auth");
    await expect(resolveAuthUserProfile("ghost")).rejects.toThrow(/profil introuvable/);
  });
});

describe("auth — signInUser", () => {
  beforeEach(() => {
    signInWithEmailAndPassword.mockReset();
    getDocs.mockReset();
  });

  it("signs in against the PRIMARY auth instance using the synthetic email, then resolves the Firestore profile", async () => {
    signInWithEmailAndPassword.mockResolvedValue({ user: { uid: "abc" } });
    getDocs.mockResolvedValue({
      empty: false,
      docs: [
        {
          data: () => ({
            username: "admin",
            password: "test",
            role: "admin",
            firstName: "Admin",
            lastName: "BeTrack",
            name: "Admin BeTrack",
            companyId: null,
          }),
        },
      ],
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

  it("lets a Firebase sign-in error propagate untouched (e.g. wrong password)", async () => {
    const authError = Object.assign(new Error("wrong password"), {
      code: "auth/invalid-credential",
    });
    signInWithEmailAndPassword.mockRejectedValue(authError);
    const { signInUser } = await import("@/lib/auth");
    await expect(signInUser("admin", "wrong")).rejects.toBe(authError);
  });
});

describe("auth — ensureAuthUsersSeeded", () => {
  beforeEach(() => {
    // ensureAuthUsersSeeded() est idempotente via un flag interne au module — on repart d'un
    // module frais à chaque test pour observer son comportement dès le premier appel.
    vi.resetModules();
    createUserWithEmailAndPassword.mockReset();
  });

  it("creates a Firebase Auth account for every TEST_USERS, on the SECONDARY auth instance", async () => {
    createUserWithEmailAndPassword.mockResolvedValue({ user: { uid: "x" } });
    const authModule = await import("@/lib/auth");
    await authModule.ensureAuthUsersSeeded();
    expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(authModule.TEST_USERS.length);
    for (const call of createUserWithEmailAndPassword.mock.calls) {
      expect(call[0]).toBe(SECONDARY_AUTH);
    }
  });

  it("silently ignores auth/email-already-in-use", async () => {
    createUserWithEmailAndPassword.mockRejectedValue(
      Object.assign(new Error("in use"), { code: "auth/email-already-in-use" })
    );
    const authModule = await import("@/lib/auth");
    await expect(authModule.ensureAuthUsersSeeded()).resolves.toBeUndefined();
  });

  it("logs and rethrows any other error (e.g. auth/operation-not-allowed)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    createUserWithEmailAndPassword.mockRejectedValue(
      Object.assign(new Error("disabled"), { code: "auth/operation-not-allowed" })
    );
    const authModule = await import("@/lib/auth");
    await expect(authModule.ensureAuthUsersSeeded()).rejects.toThrow("disabled");
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
