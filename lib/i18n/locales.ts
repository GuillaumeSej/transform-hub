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
