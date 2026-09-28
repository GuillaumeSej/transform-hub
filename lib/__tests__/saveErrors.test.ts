import { describe, expect, it } from "vitest";
import {
  firebaseErrorCode,
  isSaveErrorReported,
  isTechnicalSaveError,
  markSaveErrorReported,
  saveErrorKind,
  saveErrorToast,
} from "@/lib/saveErrors";

function fbError(code: string, message = "boom") {
  return Object.assign(new Error(message), { name: "FirebaseError", code });
}

describe("firebaseErrorCode", () => {
  it("normalise les codes préfixés", () => {
    expect(firebaseErrorCode(fbError("permission-denied"))).toBe("permission-denied");
    expect(firebaseErrorCode(fbError("firestore/unavailable"))).toBe("unavailable");
    expect(firebaseErrorCode(fbError("auth/network-request-failed"))).toBe(
      "network-request-failed"
    );
  });
  it("renvoie null sans code", () => {
    expect(firebaseErrorCode(new Error("x"))).toBeNull();
    expect(firebaseErrorCode(null)).toBeNull();
    expect(firebaseErrorCode("permission-denied")).toBeNull();
  });
});

describe("saveErrorKind", () => {
  it("classe les refus de droits", () => {
    expect(saveErrorKind(fbError("permission-denied"), true)).toBe("permission");
    expect(saveErrorKind(fbError("unauthenticated"), true)).toBe("permission");
    expect(saveErrorKind(new Error("Missing or insufficient permissions."), true)).toBe(
      "permission"
    );
  });
  it("classe les erreurs réseau", () => {
    expect(saveErrorKind(fbError("unavailable"), true)).toBe("network");
    expect(saveErrorKind(fbError("deadline-exceeded"), true)).toBe("network");
    expect(saveErrorKind(new TypeError("Failed to fetch"), true)).toBe("network");
    expect(
      saveErrorKind(new Error("Failed to get document because the client is offline."), true)
    ).toBe("network");
  });
  it("classe réseau toute erreur survenue hors ligne", () => {
    expect(saveErrorKind(fbError("internal"), false)).toBe("network");
    expect(saveErrorKind(fbError("internal"), true)).toBe("other");
  });
  it("classe le reste en générique", () => {
    expect(saveErrorKind(new Error("Unsupported field value: undefined"), true)).toBe("other");
    expect(saveErrorKind(undefined, true)).toBe("other");
  });
});

describe("saveErrorToast", () => {
  it("renvoie les messages français par défaut", () => {
    expect(saveErrorToast(fbError("permission-denied"), undefined, true)).toEqual({
      title: "Échec de l'enregistrement",
      message: "Vous n'avez pas le droit d'effectuer cette modification",
      kind: "permission",
    });
    expect(saveErrorToast(fbError("unavailable"), undefined, true).message).toBe(
      "Connexion perdue, modification non enregistrée"
    );
    expect(saveErrorToast(new Error("x"), undefined, true).message).toBe(
      "La modification n'a pas pu être enregistrée. Réessayez."
    );
  });
  it("passe par la fonction de traduction fournie", () => {
    const t = (key: string) => `[${key}]`;
    expect(saveErrorToast(fbError("permission-denied"), t, true)).toEqual({
      title: "[saveError.title]",
      message: "[saveError.permission]",
      kind: "permission",
    });
  });
});

describe("isTechnicalSaveError", () => {
  it("distingue erreurs techniques et erreurs métier", () => {
    expect(isTechnicalSaveError(fbError("failed-precondition"), true)).toBe(true);
    expect(isTechnicalSaveError(new TypeError("Failed to fetch"), true)).toBe(true);
    expect(isTechnicalSaveError(new Error("Seul le porteur peut valider"), true)).toBe(false);
  });
});

describe("markSaveErrorReported / isSaveErrorReported", () => {
  it("mémorise les erreurs déjà signalées", () => {
    const err = new Error("x");
    expect(isSaveErrorReported(err)).toBe(false);
    markSaveErrorReported(err);
    expect(isSaveErrorReported(err)).toBe(true);
    expect(isSaveErrorReported(new Error("x"))).toBe(false);
    markSaveErrorReported("chaîne");
    expect(isSaveErrorReported("chaîne")).toBe(false);
  });
});
