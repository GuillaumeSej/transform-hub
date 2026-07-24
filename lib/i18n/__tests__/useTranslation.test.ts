import { describe, it, expect } from "vitest";
import { translate, DICTIONARIES } from "@/lib/i18n/useTranslation";

describe("translate", () => {
  it("returns the correct string per locale for a key present everywhere", () => {
    expect(translate("fr", "common.save")).toBe("Enregistrer");
    expect(translate("en", "common.save")).toBe("Save");
    expect(translate("de", "common.save")).toBe("Speichern");
    expect(translate("es", "common.save")).toBe("Guardar");
  });

  it("resolves the Initiative terminology mapping in English", () => {
    expect(translate("en", "nav.leverLibrary")).toBe("Initiative Library");
    expect(translate("en", "roles.lever.label")).toBe("Initiative Leader");
    expect(translate("en", "roles.sponsor.label")).toBe("Workstream Leader");
    // French must NOT be affected by the English terminology swap.
    expect(translate("fr", "nav.leverLibrary")).toBe("Bibliothèque des leviers");
    expect(translate("fr", "roles.lever.label")).toBe("Responsable de levier");
  });

  it("falls back to French when a key is missing in the target locale", () => {
    const key = "__only_in_fr_for_test__";
    DICTIONARIES.fr[key] = "Valeur française";
    try {
      expect(translate("en", key)).toBe("Valeur française");
      expect(translate("de", key)).toBe("Valeur française");
      expect(translate("es", key)).toBe("Valeur française");
    } finally {
      delete DICTIONARIES.fr[key];
    }
  });

  it("falls back to the provided fallback when the key is missing everywhere", () => {
    expect(translate("en", "__totally_missing_key__", "Default text")).toBe("Default text");
  });

  it("falls back to the key itself when missing everywhere and no fallback is given", () => {
    expect(translate("en", "__totally_missing_key__")).toBe("__totally_missing_key__");
  });
});
