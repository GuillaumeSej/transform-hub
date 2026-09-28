import { afterEach, describe, expect, it } from "vitest";
import {
  formatAmount,
  formatAmountM,
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatDateShort,
  formatDateTimeShort,
  formatDecimal,
  formatFte,
  formatPct,
  formatMillions,
  formatNumber,
  intlTag,
  normalizeCurrency,
  setFormatCurrency,
  setFormatLocale,
} from "@/lib/format";
import { alertDesc, alertTitle } from "@/lib/alertText";
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

describe("lib/format — formateurs d'affichage unifiés (langue de l'app)", () => {
  it("montants compacts fr : M €, k €, signe, jamais -0", () => {
    expect(norm(formatAmountM(1.8))).toBe("1,8 M €");
    expect(norm(formatAmount(270_000))).toBe("270 k €");
    expect(norm(formatAmount(270_000, { signed: true }))).toBe("+270 k €");
    expect(norm(formatAmountM(-1.2, { signed: true }))).toBe("-1,2 M €");
    expect(norm(formatAmount(-0))).toBe("0 €");
    expect(norm(formatAmount(-0.2))).toBe("0 €");
    expect(norm(formatAmount(0, { signed: true }))).toBe("0 €");
    expect(norm(formatAmount(-0.1, { compact: false }))).toBe("0 €");
    expect(norm(formatAmount(1_800_000, { compact: false }))).toBe("1 800 000 €");
  });

  it("montants compacts en", () => {
    setFormatLocale("en");
    expect(formatAmountM(1.8)).toBe("€1.8M");
    expect(formatAmount(270_000, { signed: true })).toBe("+€270K");
    expect(formatAmountM(-1.2)).toBe("-€1.2M");
    expect(formatAmount(-0)).toBe("€0");
  });

  it("nombres décimaux, ETP, pourcentages", () => {
    expect(formatDecimal(1.8)).toBe("1,8");
    expect(formatDecimal(-0.04)).toBe("0,0");
    expect(formatFte(0.9)).toBe("0,9");
    expect(formatFte(0.9, { unit: "ETP" })).toBe("0,9 ETP");
    expect(formatFte(-0.01)).toBe("0");
    expect(norm(formatPct(12.5, 1))).toBe("12,5 %");
    setFormatLocale("en");
    expect(formatDecimal(1.8)).toBe("1.8");
    expect(formatFte(0.9, { unit: "FTE" })).toBe("0.9 FTE");
    expect(formatPct(12.5, 1)).toBe("12.5%");
  });

  it("dates et date-heures dans la langue de l'app (pas du navigateur)", () => {
    expect(formatDateShort("2026-09-24")).toBe("24/09/2026");
    expect(formatDateTimeShort(new Date(2026, 8, 24, 9, 30, 35))).toBe("24/09/2026 09:30");
    expect(formatDateShort("")).toBe("");
    expect(formatDateShort(undefined)).toBe("");
    setFormatLocale("en");
    expect(formatDateShort("2026-09-24")).toBe("09/24/2026");
    expect(formatDateTimeShort(new Date(2026, 8, 24, 9, 30))).toBe("09/24/2026, 09:30 AM");
  });

  it("alertes auto : montants formatés à l'affichage, sans double `+`", () => {
    const alert = {
      title: "",
      desc: "",
      i18n: {
        titleKey: "alerts.auto.costOverrun.title",
        descKey: "alerts.auto.overrun.desc",
        vars: { name: "L1", reforecast: "x", plan: "y", delta: "z" },
        amounts: { reforecast: 0.48, plan: 0.21, delta: 0.27 },
      },
    } as unknown as Alert;
    const tFr = (k: string, f?: string) => translate("fr", k, f);
    expect(norm(alertDesc(tFr, alert))).toMatch(/480 k € vs plan 210 k € \(\+270 k €\)\.$/);
  });
});
