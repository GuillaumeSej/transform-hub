import { describe, expect, it } from "vitest";
import { parseValidationTab, validationTabQuery } from "@/components/validation/validationTabs";

describe("parseValidationTab", () => {
  it("reconnaît blocked", () => {
    expect(parseValidationTab("blocked")).toBe("blocked");
  });
  it("retombe sur mine pour absent / inconnu", () => {
    expect(parseValidationTab(null)).toBe("mine");
    expect(parseValidationTab(undefined)).toBe("mine");
    expect(parseValidationTab("")).toBe("mine");
    expect(parseValidationTab("mine")).toBe("mine");
    expect(parseValidationTab("BLOCKED")).toBe("mine");
  });
});

describe("validationTabQuery", () => {
  it("pose tab=blocked en conservant les autres paramètres", () => {
    expect(validationTabQuery("program=p1", "blocked")).toBe("program=p1&tab=blocked");
    expect(validationTabQuery("", "blocked")).toBe("tab=blocked");
  });
  it("retire le paramètre pour l'onglet par défaut", () => {
    expect(validationTabQuery("tab=blocked&program=p1", "mine")).toBe("program=p1");
    expect(validationTabQuery("tab=blocked", "mine")).toBe("");
  });
});
