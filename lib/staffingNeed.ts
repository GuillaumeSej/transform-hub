import type { ChantierStaffing } from "@/types";

export type NeedGranularity = "monthly" | "quarterly" | "semiannual" | "annual";

export type PeriodBounds = { label: string; start: string; end: string };

export type NeedPeriodMetrics = PeriodBounds & {
  /** ETP moyens déclarés sur la période (lignes recoupant la période, pondérées par le nombre de
   *  jours de recoupement / durée de la période — jamais une somme brute). */
  needed: number;
  /** ETP moyens disponibles (base entreprise, instantané constant → sa moyenne est lui-même). */
  available: number;
  /** ETP moyens MOBILISÉS TOTAL : staffing réellement affecté aux chantiers (lignes ChantierStaffing
   *  déjà démarrées, startDate <= today), pondéré par la durée de recouvrement de la période. */
  mobilised: number;
  /** mobilisé / besoin, en % arrondi ; null si besoin nul. */
  staffingPct: number | null;
};

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const lastDay = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const dayNum = (s: string) =>
  Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS;

export function todayIso(d: Date): string {
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Bornes de la période contenant `isoDate`. */
export function periodBoundsForDate(isoDate: string, g: NeedGranularity): PeriodBounds {
  const y = +isoDate.slice(0, 4);
  const m0 = +isoDate.slice(5, 7) - 1;
  if (g === "annual") return { label: String(y), start: iso(y, 0, 1), end: iso(y, 11, 31) };
  if (g === "monthly") {
    return { label: `${y}-${pad(m0 + 1)}`, start: iso(y, m0, 1), end: iso(y, m0, lastDay(y, m0)) };
  }
  if (g === "semiannual") {
    const s = m0 <= 5 ? 1 : 2;
    const sm = s === 1 ? 0 : 6;
    const em = sm + 5;
    return { label: `${y}-S${s}`, start: iso(y, sm, 1), end: iso(y, em, lastDay(y, em)) };
  }
  const q = Math.floor(m0 / 3) + 1;
  const sm = (q - 1) * 3;
  const em = sm + 2;
  return { label: `${y}-Q${q}`, start: iso(y, sm, 1), end: iso(y, em, lastDay(y, em)) };
}

export function nextPeriodStart(end: string): string {
  return new Date((dayNum(end) + 1) * DAY_MS).toISOString().slice(0, 10);
}

/** Jours (inclusifs) de recoupement entre [aStart,aEnd] et [bStart,bEnd]. */
function overlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const s = Math.max(dayNum(aStart), dayNum(bStart));
  const e = Math.min(dayNum(aEnd), dayNum(bEnd));
  return Math.max(0, e - s + 1);
}

/** ETP moyens d'un lot de lignes sur une période (recouvrement / durée de la période, jamais une
 *  somme brute). Lignes sans startDate ignorées ; sans endDate = toujours en cours. */
export function averageFte(
  entries: ChantierStaffing[],
  period: { start: string; end: string }
): number {
  const periodDays = dayNum(period.end) - dayNum(period.start) + 1;
  const end = period.end;
  if (periodDays <= 0) return 0;
  let sum = 0;
  for (const e of entries) {
    if (!e.startDate) continue;
    const days = overlapDays(e.startDate, e.endDate ?? "9999-12-31", period.start, end);
    sum += (e.fte || 0) * (days / periodDays);
  }
  return sum;
}

export function needMetrics(
  entries: ChantierStaffing[],
  available: number,
  period: PeriodBounds,
  today: string
): NeedPeriodMetrics {
  const needed = averageFte(entries, period);
  const mobilised = averageFte(
    entries.filter((e) => e.startDate && e.startDate <= today),
    period
  );
  return {
    ...period,
    needed,
    available,
    mobilised,
    staffingPct: needed > 0 ? Math.round((mobilised / needed) * 100) : null,
  };
}

/** Série chronologique continue (une entrée par période, de la première `startDate` à la dernière
 *  date connue, période courante incluse) — plafonnée à `maxPeriods`. */
export function needSeries(
  entries: ChantierStaffing[],
  totalAvailable: number,
  g: NeedGranularity,
  today: string,
  maxPeriods = 40
): NeedPeriodMetrics[] {
  const dated = entries.filter((e) => e.startDate);
  if (dated.length === 0) return [];
  let min = dated[0].startDate as string;
  let max = today;
  for (const e of dated) {
    if ((e.startDate as string) < min) min = e.startDate as string;
    const last = e.endDate ?? e.startDate;
    if (last && last > max) max = last;
  }
  const out: NeedPeriodMetrics[] = [];
  let cursor = periodBoundsForDate(min, g);
  while (cursor.start <= max && out.length < maxPeriods) {
    out.push(needMetrics(dated, totalAvailable, cursor, today));
    cursor = periodBoundsForDate(nextPeriodStart(cursor.end), g);
  }
  return out;
}
