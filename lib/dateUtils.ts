/** Petits utilitaires de date (chaînes ISO "YYYY-MM-DD") pour le rollup de progression et le Gantt. */

export function parseISO(date: string): number {
  return new Date(`${date}T00:00:00`).getTime();
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b) - parseISO(a)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  return new Date(parseISO(date) + days * 86_400_000).toISOString().slice(0, 10);
}

export function clampPct(v: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, v));
}
