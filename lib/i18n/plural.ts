import { INTL_LOCALE_TAGS, type Locale } from "@/lib/i18n/locales";
import { getFormatLocale } from "@/lib/format";

/** Accord singulier/pluriel d'un compteur, selon les règles CLDR de la langue (`Intl.PluralRules`) :
 *  en français 0 et 1 sont au singulier (« 0 projet », « 1 projet »), en anglais/allemand/espagnol
 *  seul 1 l'est (« 0 projects »). Locale par défaut = celle de l'interface (posée par
 *  `I18nProvider` via `setFormatLocale`). */
export function isSingular(n: number, locale: Locale = getFormatLocale()): boolean {
  return new Intl.PluralRules(INTL_LOCALE_TAGS[locale]).select(Math.abs(n)) === "one";
}

/** Choisit la forme singulière (`one`) ou plurielle (`other`) selon `n` puis remplace `{n}`. */
export function plural(n: number, one: string, other: string, locale?: Locale): string {
  return (isSingular(n, locale) ? one : other).replace(/\{n\}/g, String(n));
}

/** Traduction d'un libellé de compteur : convention de clés `key` = forme plurielle,
 *  `${key}One` = forme singulière (même convention que `me.summary.todoOne`…). Remplace `{n}`
 *  (les autres variables restent à la charge de l'appelant). */
export function tPlural(
  t: (key: string, fallback?: string) => string,
  key: string,
  n: number,
  fallbackOther?: string,
  fallbackOne?: string,
  locale?: Locale
): string {
  return plural(n, t(`${key}One`, fallbackOne ?? fallbackOther), t(key, fallbackOther), locale);
}
