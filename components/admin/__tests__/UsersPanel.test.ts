import { describe, expect, it } from "vitest";
import {
  buildClearancePatch,
  missingRequiredFields,
  type UserFormInput,
} from "@/components/admin/UsersPanel";

describe("UsersPanel — buildClearancePatch", () => {
  it('omits the key entirely (never sets it to `undefined`) for mode "inherit"', () => {
    const patch = buildClearancePatch(false, "inherit", []);
    expect(patch).toEqual({});
    expect("confidentialityClearance" in patch).toBe(false);
  });

  it('returns "all" for mode "all", even including levels the role would not normally see', () => {
    expect(buildClearancePatch(false, "all", [])).toEqual({
      confidentialityClearance: "all",
    });
  });

  it('returns an empty array for mode "none"', () => {
    expect(buildClearancePatch(false, "none", ["public", "secret"])).toEqual({
      confidentialityClearance: [],
    });
  });

  it(
    'returns the selected levels verbatim for mode "custom" — this is what lets an admin grant a ' +
      "profile MORE access than its role default (additive override, not clamped to the role's levels)",
    () => {
      expect(buildClearancePatch(false, "custom", ["public", "secret", "top-secret"])).toEqual({
        confidentialityClearance: ["public", "secret", "top-secret"],
      });
    }
  );

  it("has no effect for an admin (global or company), total access regardless of mode", () => {
    expect(buildClearancePatch(true, "custom", ["secret"])).toEqual({});
    expect(buildClearancePatch(true, "all", [])).toEqual({});
    expect(buildClearancePatch(true, "none", [])).toEqual({});
  });
});

describe("UsersPanel — missingRequiredFields", () => {
  const validForm: UserFormInput = {
    username: "jean.dupont",
    firstName: "Jean",
    lastName: "Dupont",
    name: "",
    password: "test",
    isGlobalAdmin: false,
    companyId: "company-1",
  };

  it("returns no missing field for a fully valid form", () => {
    expect(missingRequiredFields(validForm, undefined)).toEqual([]);
  });

  it("flags Identifiant when username is empty or blank", () => {
    expect(missingRequiredFields({ ...validForm, username: "" }, undefined)).toContain(
      "Identifiant"
    );
    expect(missingRequiredFields({ ...validForm, username: "   " }, undefined)).toContain(
      "Identifiant"
    );
  });

  it("flags the display-name group only when BOTH Nom affiché AND Prénom+Nom are empty", () => {
    // Nom affiché seul suffit
    expect(
      missingRequiredFields(
        { ...validForm, firstName: "", lastName: "", name: "Jean Dupont" },
        undefined
      )
    ).toEqual([]);
    // Prénom + Nom seuls suffisent
    expect(missingRequiredFields({ ...validForm, name: "" }, undefined)).toEqual([]);
    // Ni l'un ni l'autre : signalé
    expect(
      missingRequiredFields({ ...validForm, firstName: "", lastName: "", name: "" }, undefined)
    ).toContain("Nom affiché (ou Prénom + Nom)");
  });

  it('flags Mot de passe when emptied (e.g. le champ pré-rempli à "test" a été vidé)', () => {
    expect(missingRequiredFields({ ...validForm, password: "" }, undefined)).toContain(
      "Mot de passe"
    );
    expect(missingRequiredFields({ ...validForm, password: "   " }, undefined)).toContain(
      "Mot de passe"
    );
  });

  it("flags Entreprise for a non-global-admin account when the field is shown (no fixedCompanyId) and empty", () => {
    expect(missingRequiredFields({ ...validForm, companyId: "" }, undefined)).toContain(
      "Entreprise"
    );
  });

  it("does not flag Entreprise when a fixedCompanyId is imposed by context (hub scope / company admin)", () => {
    expect(missingRequiredFields({ ...validForm, companyId: "" }, "company-1")).toEqual([]);
  });

  it("does not flag Entreprise for a global admin account, which is always global (companyId forced to null)", () => {
    expect(
      missingRequiredFields({ ...validForm, isGlobalAdmin: true, companyId: "" }, undefined)
    ).toEqual([]);
  });

  it("accumulates every missing field at once, in a stable order", () => {
    expect(
      missingRequiredFields(
        {
          username: "",
          firstName: "",
          lastName: "",
          name: "",
          password: "",
          isGlobalAdmin: false,
          companyId: "",
        },
        undefined
      )
    ).toEqual(["Identifiant", "Nom affiché (ou Prénom + Nom)", "Mot de passe", "Entreprise"]);
  });
});
