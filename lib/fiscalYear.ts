import type { Program } from "@/types";

/**
 * Utilitaires exercice fiscal (FY) — dérivés de `Program.fyStart` / `Program.fyEnd`.
 *
 * Un exercice fiscal n'a pas de raison de commencer le 1er janvier — souvent en avril
 * (Royaume-Uni), en juillet (Japon, Australie), ou en octobre (US Fed). Ces fonctions extraient
 * le mois-jour de départ du `Program.fyStart` et génèrent les périodes correspondantes.
 */

/** Un exercice fiscal (ex. "FY26/27" du 2026-07-01 au 2027-06-30). */
export type FiscalYearPeriod = {
  /** Libellé "FY26/27" (mid-year FY) ou "FY2026" (calendar-year FY). */
  label: string;
  startISO: string;
  endISO: string;
};

/** Libellé d'un exercice fiscal à cheval sur deux années civiles, identifié par son année de
 *  début : 2026 → "FY26/27". Seule mise en forme de ce libellé (`generateFiscalYears`, graphiques
 *  Finance — lib/financeCosts.ts). */
export function fiscalYearSpanLabel(startYear: number): string {
  return `FY${String(startYear).slice(-2)}/${String(startYear + 1).slice(-2)}`;
}

/** Libellé de l'exercice qui COMMENCE en `startYear` pour un exercice débutant au mois
 *  `fyStartMonth` (0-11) — convention des filtres « Année » de la page Finance (P&L, tableau par
 *  niveau financier) : exercice civil (janvier) → l'année seule ("2026", libellés historiques
 *  inchangés) ; exercice décalé → "FY26/27", pour qu'on ne lise pas « 2026 » comme l'année civile. */
export function fiscalYearLabel(startYear: number, fyStartMonth = 0): string {
  return fyStartMonth === 0 ? String(startYear) : fiscalYearSpanLabel(startYear);
}

/** Détermine si un `Program.fyStart` correspond à une année civile (1er janvier). */
function isCalendarFy(fyStart: string): boolean {
  const m = Number(fyStart.slice(5, 7));
  const d = Number(fyStart.slice(8, 10));
  return m === 1 && d === 1;
}

/** Date de début de l'exercice qui commence en `year`, au jour `day` du mois `month` (1-12) —
 *  BORNÉE au dernier jour du mois : un exercice qui démarre le 29/02 (année bissextile) commence
 *  le 28/02 les autres années (auparavant « 2025-02-29 », date inexistante). */
export function fiscalYearStartISO(year: number, month: number, day: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const d = Math.min(day, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Génère les FY successifs qui couvrent au moins la plage `[from, to]`. */
export function generateFiscalYears(
  program: Pick<Program, "fyStart" | "fyEnd"> | null | undefined,
  fromISO: string,
  toISO: string
): FiscalYearPeriod[] {
  if (!program?.fyStart || !program?.fyEnd) return [];
  const startMonth = Number(program.fyStart.slice(5, 7));
  const startDay = Number(program.fyStart.slice(8, 10));
  if (!(startMonth >= 1 && startMonth <= 12 && startDay >= 1 && startDay <= 31)) return [];
  const calendarFy = isCalendarFy(program.fyStart);

  const fromYear = Number(fromISO.slice(0, 4));
  const toYear = Number(toISO.slice(0, 4));
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) return [];

  const result: FiscalYearPeriod[] = [];
  // Étend légèrement pour couvrir les cas où la plage démarre avant le début de FY.
  for (let y = fromYear - 1; y <= toYear + 1; y++) {
    const fyStartISO = fiscalYearStartISO(y, startMonth, startDay);
    // Fin du FY = veille du prochain démarrage — calcul UTC-safe pour ne pas dépendre du
    // fuseau horaire local qui pourrait reculer d'un jour.
    const nextStart = new Date(`${fiscalYearStartISO(y + 1, startMonth, startDay)}T00:00:00Z`);
    nextStart.setUTCDate(nextStart.getUTCDate() - 1);
    const fyEndISO = nextStart.toISOString().slice(0, 10);
    // Skippe les FY entièrement hors plage.
    if (fyEndISO < fromISO || fyStartISO > toISO) continue;
    const label = calendarFy ? `FY${y}` : fiscalYearSpanLabel(y);
    result.push({ label, startISO: fyStartISO, endISO: fyEndISO });
  }
  return result;
}
