import { INTL_LOCALE_TAGS as INTL_LOCALE, type Locale } from "@/lib/i18n/locales";

/**
 * Montant COMPACT dans la devise du programme (ex. `7,7 M €` en fr, `€7.7M` en en) — pour les
 * espaces réduits (centre d'un donut, infobulle) où `23 550 000 EUR` ne tient pas. `currency` est
 * la devise libre du programme (`Program.currency`) : si ce n'est pas un code ISO 4217 accepté par
 * `Intl`, repli sur le nombre compact suffixé de la devise telle quelle (`7,7 M XYZ`).
 */
export function formatCompactCurrency(
  value: number,
  currency: string,
  locale: Locale,
  maximumFractionDigits = 1
): string {
  const tag = INTL_LOCALE[locale] ?? INTL_LOCALE.fr;
  const options: Intl.NumberFormatOptions = {
    notation: "compact",
    // `minimumFractionDigits: 0` explicite : sans lui, l'ICU de Node 20 (CI GitHub) applique le
    // minimum de la devise (2, borné au max) et affiche "€500.0K" au lieu de "€500K".
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(value) >= 1000 ? maximumFractionDigits : 0,
  };
  try {
    return new Intl.NumberFormat(tag, { ...options, style: "currency", currency }).format(value);
  } catch {
    return `${new Intl.NumberFormat(tag, options).format(value)} ${currency}`.trim();
  }
}

/** Pourcentage localisé (`33 %` en fr/de/es, `33%` en en) à partir d'un ratio (0.33 ⇒ 33 %). */
export function formatPercent(ratio: number, locale: Locale, maximumFractionDigits = 0): string {
  const tag = INTL_LOCALE[locale] ?? INTL_LOCALE.fr;
  return new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits }).format(ratio);
}
