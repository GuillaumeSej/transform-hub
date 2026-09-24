import type { IndicatorFrequency } from "@/types";

/**
 * Périodes de reporting des indicateurs (`IndicatorMeasurement.period`,
 * `Indicator.targetSchedule[].period`) — normalisation, validation par fréquence et COMPARAISON
 * chronologique robuste aux formats mélangés.
 *
 * Formats canoniques (un par fréquence) :
 *   - mensuel     `YYYY-MM`   (ex. "2026-03")
 *   - trimestriel `YYYY-Qn`   (ex. "2026-Q1")
 *   - semestriel  `YYYY-Sn`   (ex. "2026-S2")
 *   - annuel      `YYYY`      (ex. "2026")
 *
 * Pourquoi pas un simple `localeCompare` : les formats ne sont PAS mutuellement ordonnés au sens
 * lexicographique ("2026-Q1" > "2026-05" car "Q" > "0"), alors qu'un KPI mensuel peut porter une
 * trajectoire trimestrielle. On compare donc des INTERVALLES de mois (`indicatorPeriodRange`) : un palier
 * s'applique à partir du premier mois de sa période, et « après le dernier palier » signifie
 * « après le dernier mois de ce palier ».
 */

/** Intervalle [start, end] en mois absolus (année × 12 + mois 0-11) couvert par une période. */
export type PeriodRange = { start: number; end: number };

const FREQUENCY_FORMAT: Record<IndicatorFrequency, string> = {
  monthly: "YYYY-MM",
  quarterly: "YYYY-Qn",
  semiannual: "YYYY-Sn",
  annual: "YYYY",
};

/** Format attendu (libellé d'aide) pour une fréquence. */
export function periodFormatHint(frequency: IndicatorFrequency): string {
  return FREQUENCY_FORMAT[frequency];
}

/** Intervalle de mois couvert par une période canonique OU tolérée (voir `normalizePeriod`) ;
 *  `undefined` si la chaîne n'est pas une période reconnue. */
export function indicatorPeriodRange(period: string): PeriodRange | undefined {
  const canonical = normalizePeriod(period);
  if (!canonical) return undefined;
  const year = Number(canonical.slice(0, 4));
  const base = year * 12;
  if (canonical.length === 4) return { start: base, end: base + 11 };
  const rest = canonical.slice(5);
  if (rest.startsWith("Q")) {
    const q = Number(rest.slice(1));
    return { start: base + (q - 1) * 3, end: base + q * 3 - 1 };
  }
  if (rest.startsWith("S")) {
    const s = Number(rest.slice(1));
    return { start: base + (s - 1) * 6, end: base + s * 6 - 1 };
  }
  const month = Number(rest) - 1;
  return { start: base + month, end: base + month };
}

/**
 * Normalise une saisie de période vers son format canonique, sans présumer de la fréquence.
 * Tolère : espaces, casse, séparateurs `-`/`/`/`.`/espace, mois sur 1 chiffre ("2026-3"), ordre
 * inversé ("03/2026", "Q1 2026"), "T" (trimestre FR) pour "Q", "H" pour "S". `undefined` si non
 * reconnue (mois hors 1-12, trimestre hors 1-4, semestre hors 1-2, année hors 4 chiffres).
 */
export function normalizePeriod(raw: string): string | undefined {
  const s = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (s === "") return undefined;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})$/.exec(s))) return m[1];
  // Année puis sous-période : "2026-03", "2026/3", "2026-Q1", "2026 T1", "2026Q1", "2026-S2".
  if ((m = /^(\d{4})[-/. ]?([QTSH]?)(\d{1,2})$/.exec(s))) {
    return canonical(m[1], m[2], m[3]);
  }
  // Sous-période puis année : "03/2026", "3-2026", "Q1 2026", "T1-2026", "S2/2026".
  if ((m = /^([QTSH]?)(\d{1,2})[-/. ]?(\d{4})$/.exec(s))) {
    return canonical(m[3], m[1], m[2]);
  }
  return undefined;
}

function canonical(year: string, kindRaw: string, numRaw: string): string | undefined {
  const n = Number(numRaw);
  const kind = kindRaw === "T" ? "Q" : kindRaw === "H" ? "S" : kindRaw;
  if (kind === "Q") return n >= 1 && n <= 4 ? `${year}-Q${n}` : undefined;
  if (kind === "S") return n >= 1 && n <= 2 ? `${year}-S${n}` : undefined;
  return n >= 1 && n <= 12 ? `${year}-${String(n).padStart(2, "0")}` : undefined;
}

/** Fréquence déduite du format canonique d'une période (`undefined` si non reconnue). */
export function periodFrequency(period: string): IndicatorFrequency | undefined {
  const canonicalPeriod = normalizePeriod(period);
  if (!canonicalPeriod) return undefined;
  if (canonicalPeriod.length === 4) return "annual";
  const rest = canonicalPeriod.slice(5);
  if (rest.startsWith("Q")) return "quarterly";
  if (rest.startsWith("S")) return "semiannual";
  return "monthly";
}

/**
 * Validation STRICTE d'une saisie pour une fréquence donnée : la période normalisée (canonique)
 * si elle est reconnue ET du bon grain, sinon `undefined` (l'appelant affiche alors
 * `periodFormatHint(frequency)`). Point d'entrée des formulaires de saisie de valeur / palier.
 */
export function parsePeriodForFrequency(
  raw: string,
  frequency: IndicatorFrequency
): string | undefined {
  const canonicalPeriod = normalizePeriod(raw);
  if (!canonicalPeriod) return undefined;
  return periodFrequency(canonicalPeriod) === frequency ? canonicalPeriod : undefined;
}

/**
 * Comparateur chronologique de deux périodes (négatif si `a` avant `b`), robuste aux formats
 * mélangés : compare le premier mois couvert, puis le dernier (à début égal, la période la plus
 * courte d'abord — "2026-01" avant "2026-Q1" avant "2026"). Une période non reconnue (texte
 * libre historique) retombe sur l'ordre lexicographique, et est placée APRÈS les périodes
 * reconnues quand on compare les deux genres (jamais d'exception).
 */
export function comparePeriods(a: string, b: string): number {
  const ra = indicatorPeriodRange(a);
  const rb = indicatorPeriodRange(b);
  if (ra && rb) {
    if (ra.start !== rb.start) return ra.start - rb.start;
    if (ra.end !== rb.end) return ra.end - rb.end;
    return 0;
  }
  if (ra && !rb) return -1;
  if (!ra && rb) return 1;
  return a.localeCompare(b);
}

/** Deux périodes désignent-elles la MÊME période (après normalisation) ? Texte non reconnu :
 *  égalité stricte après `trim`. */
export function samePeriod(a: string, b: string): boolean {
  const na = normalizePeriod(a);
  const nb = normalizePeriod(b);
  if (na && nb) return na === nb;
  return a.trim() === b.trim();
}

/**
 * Un palier `stepPeriod` est-il déjà en vigueur pour une mesure de période `period` ? Vrai si le
 * palier COMMENCE au plus tard au début de la période mesurée (un palier trimestriel "2026-Q2"
 * s'applique aux mois 04, 05, 06 d'un KPI mensuel). Repli lexicographique hors formats reconnus.
 */
export function periodStartsOnOrBefore(stepPeriod: string, period: string): boolean {
  const rs = indicatorPeriodRange(stepPeriod);
  const rp = indicatorPeriodRange(period);
  if (rs && rp) return rs.start <= rp.start;
  return stepPeriod <= period;
}

/** La période `period` est-elle ENTIÈREMENT postérieure à `stepPeriod` (commence après son
 *  dernier mois) ? Repli lexicographique hors formats reconnus. */
export function periodIsAfter(period: string, stepPeriod: string): boolean {
  const rs = indicatorPeriodRange(stepPeriod);
  const rp = indicatorPeriodRange(period);
  if (rs && rp) return rp.start > rs.end;
  return period > stepPeriod;
}
