import { afterEach, describe, expect, it } from "vitest";
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatMillions,
  formatNumber,
  intlTag,
  normalizeCurrency,
  setFormatCurrency,
  setFormatLocale,
} from "@/lib/format";
import { alertTitle } from "@/lib/alertText";
import { translate } from "@/lib/i18n/useTranslation";
import type { Alert } from "@/types";

/** Espaces insécables (U+00A0 / U+202F) normalisés pour des assertions lisibles. */
const norm = (s: string) => s.replace(/[  ]/g, " ");

afterEach(() => {
  setFormatLocale("fr");
  setFormatCurrency("EUR");
});

describe("lib/format", () => {
  it("suit la locale active", () => {
    expect(intlTag()).toBe("fr-FR");
    expect(norm(formatNumber(1234.5))).toBe("1 234,5");
    setFormatLocale("en");
    expect(intlTag()).toBe("en-US");
    expect(formatNumber(1234.5)).toBe("1,234.5");
    expect(
      formatDate("2026-03-12T12:00:00Z", { day: "numeric", month: "short", year: "numeric" })
    ).toBe("Mar 12, 2026");
  });

  it("normalise la devise libre du programme", () => {
    expect(normalizeCurrency("€M")).toBe("EUR");
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency("")).toBe("EUR");
    expect(normalizeCurrency("Points")).toBe("Points");
  });

  it("montants complets et compacts dans la devise du programme", () => {
    expect(norm(formatCurrency(7_732_500))).toBe("7 732 500 €");
    expect(norm(formatCompactCurrency(7_732_500))).toBe("7,7 M €");
    setFormatLocale("en");
    setFormatCurrency("USD");
    expect(formatCurrency(7_732_500)).toBe("$7,732,500");
    expect(formatMillions(7.7325)).toBe("$7.7M");
    expect(formatCurrency(1000, { currency: "Points" })).toBe("1,000 Points");
  });
});

describe("alertText — variables imbriquées traduites", () => {
  it("résout `nested` dans la langue active", () => {
    const alert = {
      title: "À valider · X",
      desc: "",
      i18n: {
        titleKey: "strategicApprovals.alert.todoDesc",
        descKey: "strategicApprovals.alert.todoDesc",
        vars: { requester: "Alice" },
        nested: {
          phrase: {
            key: "strategicApprovals.phrase.projetDelete",
            fallback: "la suppression du projet « {name} »",
            vars: { name: "P1" },
          },
        },
      },
    } as unknown as Alert;
    const tEn = (k: string, f?: string) => translate("en", k, f);
    expect(alertTitle(tEn, alert)).toBe("Alice requests deleting project “P1”.");
  });
});
