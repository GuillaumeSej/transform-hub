import { describe, it, expect } from "vitest";
import { isSingular, plural, tPlural } from "@/lib/i18n/plural";
import { translate } from "@/lib/i18n/useTranslation";
import type { Locale } from "@/lib/i18n/locales";

describe("isSingular — règles CLDR par langue", () => {
  it("français : 0 et 1 au singulier, 2 au pluriel", () => {
    expect(isSingular(0, "fr")).toBe(true);
    expect(isSingular(1, "fr")).toBe(true);
    expect(isSingular(2, "fr")).toBe(false);
  });

  it("anglais/allemand/espagnol : seul 1 est au singulier", () => {
    for (const locale of ["en", "de", "es"] as const) {
      expect(isSingular(1, locale)).toBe(true);
      expect(isSingular(0, locale)).toBe(false);
      expect(isSingular(3, locale)).toBe(false);
    }
  });
});

describe("plural / tPlural", () => {
  it("choisit la forme et remplace {n}", () => {
    expect(plural(1, "{n} projet", "{n} projets", "fr")).toBe("1 projet");
    expect(plural(4, "{n} projet", "{n} projets", "fr")).toBe("4 projets");
  });

  it("lit `key` (pluriel) et `keyOne` (singulier) dans les dictionnaires, dans chaque langue", () => {
    const tFor = (locale: Locale) => (key: string, fallback?: string) =>
      translate(locale, key, fallback);
    expect(tPlural(tFor("fr"), "strategicAxes.tree.projetsN", 1, undefined, undefined, "fr")).toBe(
      "1 projet"
    );
    expect(tPlural(tFor("fr"), "strategicAxes.tree.projetsN", 2, undefined, undefined, "fr")).toBe(
      "2 projets"
    );
    expect(tPlural(tFor("en"), "adminUsers.userCount", 1, undefined, undefined, "en")).toBe(
      "1 user"
    );
    expect(tPlural(tFor("en"), "adminUsers.userCount", 0, undefined, undefined, "en")).toBe(
      "0 users"
    );
  });

  it("aucune forme « (s) » ne subsiste dans les compteurs pluralisés", () => {
    for (const locale of ["fr", "en", "de", "es"] as const) {
      for (const key of [
        "alerts.count",
        "leverDetail.actionsCount",
        "strategicAxes.tree.chantiersN",
        "strategicAxes.tree.projetsN",
        "adminUsers.userCount",
        "adminProgramsPanel.count",
        "adminIndicators.count",
      ]) {
        expect(translate(locale, key)).not.toMatch(/\((s|es|en|e|n)\)/);
        expect(translate(locale, `${key}One`)).not.toBe(`${key}One`);
      }
    }
  });
});
