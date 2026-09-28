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
  // Date seule ISO (`2026-09-24`) : lue en heure LOCALE (et non UTC) pour ne pas afficher la
  // veille dans un fuseau négatif.
  const dateOnly = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : value instanceof Date
      ? value
      : new Date(value);
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
  // Pas de "-0 €" : un montant qui s'arrondit à zéro à la précision affichée vaut 0.
  if (Math.abs(value) < 0.5 * 10 ** -maximumFractionDigits) value = 0;
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

// ---------- Formateurs d'affichage unifiés (audit formats) ----------
// Règle PO : format de la langue de l'APPLICATION partout à l'écran (jamais celle du navigateur) —
// `1,8 M €`, `270 k €`, `0,9 ETP`, `24/09/2026`, `24/09/2026 09:30` en fr. Les exports Excel
// gardent, eux, des nombres bruts (calculables) et n'utilisent pas ces helpers.

type AmountOpts = {
  /** `true` ⇒ `+` devant un montant strictement positif (`+270 k €`) ; 0 reste `0 €`. */
  signed?: boolean;
  /** `false` ⇒ montant complet (`1 800 000 €`) au lieu du compact (`1,8 M €`). */
  compact?: boolean;
  currency?: string;
  locale?: Locale;
  maximumFractionDigits?: number;
};

/** Montant en UNITÉS monétaires → `1,8 M €` / `270 k €` (compact par défaut), sans `-0`, signe
 *  `+` optionnel. */
export function formatAmount(value: number, opts: AmountOpts = {}): string {
  const { signed, compact = true, ...rest } = opts;
  const base = compact ? formatCompactCurrency(value, rest) : formatCurrency(value, rest);
  // Signe `+` seulement si le montant AFFICHÉ n'est pas nul (pas de `+0 €`).
  const shownZero = !/[1-9]/.test(base);
  return signed && value > 0 && !shownZero ? `+${base}` : base;
}

/** Montant exprimé en MILLIONS (unité des données Plan Performance) → voir `formatAmount`. */
export function formatAmountM(valueInMillions: number, opts: AmountOpts = {}): string {
  return formatAmount(valueInMillions * 1_000_000, opts);
}

/** Nombre décimal à précision FIXE bornée (`1,8` en fr, `1.8` en en) — pour les colonnes de
 *  tableaux exprimées dans une unité donnée par l'en-tête (ex. `(M €)`). Jamais `-0`. */
export function formatDecimal(
  value: number,
  fractionDigits = 1,
  locale: Locale = currentLocale
): string {
  const v = Math.abs(value) < 0.5 * 10 ** -fractionDigits ? 0 : value;
  return formatNumber(
    v,
    { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits },
    locale
  );
}

/** ETP/FTE : `0,9` (fr) / `0.9` (en), 1 décimale max par défaut ; `unit` (libellé traduit, ex.
 *  `t("etp.column.fte")`) suffixé s'il est fourni ⇒ `0,9 ETP`. Jamais `-0`. */
export function formatFte(
  value: number,
  opts: { unit?: string; maximumFractionDigits?: number; locale?: Locale } = {}
): string {
  const digits = opts.maximumFractionDigits ?? 1;
  const v = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  const n = formatNumber(v, { maximumFractionDigits: digits }, opts.locale ?? currentLocale);
  return opts.unit ? `${n} ${opts.unit}` : n;
}

/** Valeur d'indicateur/KPI (unité libre) : `1 234,5` (fr), 2 décimales max, `unit` suffixé avec
 *  une espace s'il est fourni (`12,5 %`, `3 jours`). Jamais `-0`. */
export function formatMeasure(
  value: number,
  unit?: string,
  locale: Locale = currentLocale
): string {
  const v = Math.abs(value) < 0.005 ? 0 : value;
  const n = formatNumber(v, { maximumFractionDigits: 2 }, locale);
  return unit ? `${n} ${unit}` : n;
}

/** Pourcentage exprimé en POINTS (`12.5` ⇒ `12,5 %` fr / `12.5%` en). */
export function formatPct(
  valuePct: number,
  maximumFractionDigits = 0,
  locale: Locale = currentLocale
): string {
  const digits = maximumFractionDigits;
  const v = Math.abs(valuePct) < 0.5 * 10 ** -digits ? 0 : valuePct;
  return formatNumber(v / 100, { style: "percent", maximumFractionDigits: digits }, locale);
}

/** Date courte numérique dans la langue de l'app : `24/09/2026` (fr) / `09/24/2026` (en).
 *  Vide ⇒ "" ; invalide ⇒ entrée brute. */
export function formatDateShort(
  value: string | number | Date | null | undefined,
  locale: Locale = currentLocale
): string {
  if (value === null || value === undefined || value === "") return "";
  return formatDate(value, { day: "2-digit", month: "2-digit", year: "numeric" }, locale);
}

/** Date + heure courtes dans la langue de l'app : `24/09/2026 09:30` (fr). Vide ⇒ "". */
export function formatDateTimeShort(
  value: string | number | Date | null | undefined,
  locale: Locale = currentLocale
): string {
  if (value === null || value === undefined || value === "") return "";
  return formatDate(
    value,
    { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" },
    locale
  );
}
