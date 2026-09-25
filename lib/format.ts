import { DEFAULT_LOCALE, INTL_LOCALE_TAGS, type Locale } from "@/lib/i18n/locales";
import { formatCompactCurrency as compactCurrency } from "@/lib/formatCompactAmount";

/**
 * Formatage partagé (nombres, dates, devises) dans la langue ACTIVE — remplace les
 * `toLocaleString("fr-FR")` codés en dur. Règle unique pour les montants :
 *  - montant compact (tuiles, axes, tooltips) : `formatCompactCurrency` (fr `7,7 M €`, en `€7.7M`) ;
 *  - montant complet (tableaux, détail) : `formatCurrency` (fr `7 732 500 €`, en `€7,732,500`).
 *
 * La locale et la devise par défaut sont des variables de module, mises à jour par
 * `I18nProvider` (lib/i18n/useTranslation.tsx) et `ActiveProgramProvider`
 * (lib/hooks/useActiveProgram.tsx) — ce qui permet aux helpers purs historiques
 * (`engine.fmtCurr`, `engine.fmtInt`) de suivre la langue sans changer leur signature. Chaque
 * helper accepte aussi `locale`/`currency` explicites, à privilégier quand ils sont disponibles.
 */

let currentLocale: Locale = DEFAULT_LOCALE;
let currentCurrency = "EUR";

export function setFormatLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getFormatLocale(): Locale {
  return currentLocale;
}

/** Devise par défaut (celle du programme actif, `Program.currency`) ; vide/absente ⇒ EUR. */
export function setFormatCurrency(currency: string | undefined | null): void {
  currentCurrency = normalizeCurrency(currency);
}

/** `Program.currency` est un texte libre (historiquement `"€M"`, `"EUR"`, `"k€"`…) : ramène les
 *  symboles usuels à leur code ISO 4217 pour `Intl` ; un code à 3 lettres est gardé tel quel, tout
 *  autre texte est conservé (les helpers le suffixent alors au nombre). Vide ⇒ EUR. */
export function normalizeCurrency(currency: string | undefined | null): string {
  const raw = currency?.trim() ?? "";
  if (!raw) return "EUR";
  if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();
  if (raw.includes("€")) return "EUR";
  if (raw.includes("£")) return "GBP";
  if (raw.includes("$")) return "USD";
  if (raw.includes("CHF")) return "CHF";
  return raw;
}

export function getFormatCurrency(): string {
  return currentCurrency;
}

/** Balise BCP 47 `Intl` d'une locale d'app (défaut : locale active). */
export function intlTag(locale: Locale = currentLocale): string {
  return INTL_LOCALE_TAGS[locale] ?? INTL_LOCALE_TAGS[DEFAULT_LOCALE];
}

/** Nombre localisé (`1 234,5` en fr, `1,234.5` en en). */
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  locale: Locale = currentLocale
): string {
  return new Intl.NumberFormat(intlTag(locale), options).format(value);
}

function toDate(value: string | number | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date localisée (par défaut `12 mars 2026` / `Mar 12, 2026`). Date invalide ⇒ entrée brute. */
export function formatDate(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" },
  locale: Locale = currentLocale
): string {
  const d = toDate(value);
  if (!d) return String(value);
  return new Intl.DateTimeFormat(intlTag(locale), options).format(d);
}

/** Date ISO `YYYY-MM-DD` (ou horodatage ISO) → `JJ/MM/AAAA`, format français imposé partout sur
 *  les dates de leviers/actions quelle que soit la langue (demande métier). Vide/invalide ⇒ "". */
export function formatDateFr(iso: string | undefined | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** `JJ/MM/AAAA` → ISO `YYYY-MM-DD`, ou `null` si la saisie est incomplète ou n'est pas une date
 *  réelle (31/02, mois 13…). */
export function parseDateFr(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (
    d.getUTCFullYear() !== Number(yyyy) ||
    d.getUTCMonth() !== Number(mm) - 1 ||
    d.getUTCDate() !== Number(dd)
  )
    return null;
  return `${yyyy}-${mm}-${dd}`;
}

/** Date + heure localisées (par défaut `12 mars 2026, 14:05`). */
export function formatDateTime(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
  locale: Locale = currentLocale
): string {
  return formatDate(value, options, locale);
}

/** Montant COMPLET dans la devise du programme (`7 732 500 €`, `€7,732,500`). Devise non ISO ⇒
 *  nombre localisé suffixé de la devise telle quelle. */
export function formatCurrency(
  value: number,
  opts: { currency?: string; locale?: Locale; maximumFractionDigits?: number } = {}
): string {
  const currency = opts.currency ? normalizeCurrency(opts.currency) : currentCurrency;
  const tag = intlTag(opts.locale ?? currentLocale);
  const maximumFractionDigits = opts.maximumFractionDigits ?? 0;
  try {
    return new Intl.NumberFormat(tag, {
      style: "currency",
      currency,
      maximumFractionDigits,
      minimumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat(tag, { maximumFractionDigits }).format(value)} ${currency}`;
  }
}

/** Montant COMPACT dans la devise du programme (`7,7 M €`, `€7.7M`) — voir lib/formatCompactAmount.ts. */
export function formatCompactCurrency(
  value: number,
  opts: { currency?: string; locale?: Locale; maximumFractionDigits?: number } = {}
): string {
  return compactCurrency(
    value,
    opts.currency ? normalizeCurrency(opts.currency) : currentCurrency,
    opts.locale ?? currentLocale,
    opts.maximumFractionDigits ?? 1
  );
}

/** Montant exprimé en MILLIONS (unité des données Plan Performance et masse salariale RH) → montant
 *  compact localisé (`7,7 M €` / `€7.7M`). */
export function formatMillions(
  valueInMillions: number,
  maximumFractionDigits = 1,
  opts: { currency?: string; locale?: Locale } = {}
): string {
  return formatCompactCurrency(valueInMillions * 1_000_000, { ...opts, maximumFractionDigits });
}
