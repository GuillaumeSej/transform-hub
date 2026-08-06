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

/** Détermine si un `Program.fyStart` correspond à une année civile (1er janvier). */
function isCalendarFy(fyStart: string): boolean {
  const m = Number(fyStart.slice(5, 7));
  const d = Number(fyStart.slice(8, 10));
  return m === 1 && d === 1;
}

/** Génère les FY successifs qui couvrent au moins la plage `[from, to]`. */
export function generateFiscalYears(
  program: Pick<Program, "fyStart" | "fyEnd"> | null | undefined,
  fromISO: string,
  toISO: string
): FiscalYearPeriod[] {
  if (!program?.fyStart || !program?.fyEnd) return [];
  const startMonthDay = program.fyStart.slice(5); // "MM-DD"
  const calendarFy = isCalendarFy(program.fyStart);

  const fromYear = Number(fromISO.slice(0, 4));
  const toYear = Number(toISO.slice(0, 4));
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) return [];

  const result: FiscalYearPeriod[] = [];
  // Étend légèrement pour couvrir les cas où la plage démarre avant le début de FY.
  for (let y = fromYear - 1; y <= toYear + 1; y++) {
    const fyStartISO = `${y}-${startMonthDay}`;
    // Fin du FY = veille du prochain démarrage — calcul UTC-safe pour ne pas dépendre du
    // fuseau horaire local qui pourrait reculer d'un jour.
    const nextStart = new Date(`${y + 1}-${startMonthDay}T00:00:00Z`);
    nextStart.setUTCDate(nextStart.getUTCDate() - 1);
    const fyEndISO = nextStart.toISOString().slice(0, 10);
    // Skippe les FY entièrement hors plage.
    if (fyEndISO < fromISO || fyStartISO > toISO) continue;
    const label = calendarFy ? `FY${y}` : `FY${String(y).slice(-2)}/${String(y + 1).slice(-2)}`;
    result.push({ label, startISO: fyStartISO, endISO: fyEndISO });
  }
  return result;
}
