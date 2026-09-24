/** Langues disponibles dans l'application. Le français reste la langue de référence : les
 * dictionnaires en/de/es sont des traductions du dictionnaire fr (voir `useTranslation.tsx`, qui
 * retombe sur fr si une clé manque dans la langue active). */
export type Locale = "fr" | "en" | "de" | "es";

export const LOCALES: Locale[] = ["fr", "en", "de", "es"];

/** Nom natif de chaque langue, tel qu'affiché dans le sélecteur de langue (Topbar). */
export const LOCALE_LABELS: Record<Locale, string> = {
  fr: "Français",
  en: "English",
  de: "Deutsch",
  es: "Español",
};

export const DEFAULT_LOCALE: Locale = "fr";

/** Balise BCP 47 utilisée pour le formatage `Intl` (nombres, dates, devises) de chaque langue —
 * source unique, lue via `intlTag()` (lib/format.ts). `en-US` plutôt que `en-GB` pour les
 * montants compacts (`€7.7M` et non `€7.7m`). */
export const INTL_LOCALE_TAGS: Record<Locale, string> = {
  fr: "fr-FR",
  en: "en-US",
  de: "de-DE",
  es: "es-ES",
};
