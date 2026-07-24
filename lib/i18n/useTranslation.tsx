"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/lib/i18n/locales";
import fr from "@/lib/i18n/dictionaries/fr";
import en from "@/lib/i18n/dictionaries/en";
import de from "@/lib/i18n/dictionaries/de";
import es from "@/lib/i18n/dictionaries/es";

const LOCALE_KEY = "betrack_locale_v1";

export const DICTIONARIES: Record<Locale, Record<string, string>> = { fr, en, de, es };

/** Logique pure de résolution d'une clé de traduction — extraite du hook pour être testable sans
 * monter de composant React (voir `__tests__/useTranslation.test.ts`). Résout `key` dans le
 * dictionnaire de `locale` ; retombe sur le dictionnaire français si la clé y manque, puis sur
 * `fallback` (ou sur `key` lui-même) si elle manque partout. */
export function translate(locale: Locale, key: string, fallback?: string): string {
  const active = DICTIONARIES[locale];
  if (active && key in active) return active[key];
  const frDict = DICTIONARIES[DEFAULT_LOCALE];
  if (frDict && key in frDict) return frDict[key];
  return fallback ?? key;
}

const isBrowser = () => typeof window !== "undefined";

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as string[]).includes(value);
}

/** Lit la locale persistée en localStorage. Retombe sur `DEFAULT_LOCALE` si absente, invalide, ou
 * hors navigateur (SSR/tests) — suit le même pattern que `dashboardWidgets.ts` (`isBrowser()`). */
function readStoredLocale(): Locale {
  if (!isBrowser()) return DEFAULT_LOCALE;
  const raw = window.localStorage.getItem(LOCALE_KEY);
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Résout `key` dans le dictionnaire actif ; retombe sur le dictionnaire français si la clé y
   * manque, puis sur `fallback` (ou sur `key` lui-même) si elle manque partout — pour qu'une
   * couverture de traduction partielle n'affiche jamais de chaîne vide/undefined. */
  t: (key: string, fallback?: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (isBrowser()) {
      try {
        window.localStorage.setItem(LOCALE_KEY, next);
      } catch (err) {
        console.error("[betrack i18n] échec d'écriture localStorage pour la locale :", err);
      }
    }
  }, []);

  const t = useCallback(
    (key: string, fallback?: string): string => translate(locale, key, fallback),
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useTranslation doit être utilisé dans un <I18nProvider>");
  return ctx;
}
