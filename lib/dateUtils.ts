/** Petits utilitaires de date (chaînes ISO "YYYY-MM-DD") pour le rollup de progression et le Gantt.
 *
 *  Toutes les dates sont des dates CALENDAIRES LOCALES : on ne passe jamais par `toISOString()`
 *  (UTC), qui décale d'un jour dans un fuseau positif (ex. minuit à Paris = 22h/23h UTC la veille). */

export function parseISO(date: string): number {
  return new Date(`${date}T00:00:00`).getTime();
}

/** Date locale d'un `Date` au format "YYYY-MM-DD" (composants LOCAUX, jamais UTC). */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** « Aujourd'hui » unique de l'app, en date LOCALE "YYYY-MM-DD" — seul point de vérité pour les
 *  calculs de retard / d'état de livrable / les valeurs par défaut des formulaires. */
export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b) - parseISO(a)) / 86_400_000);
}

/** Ajoute `days` jours CALENDAIRES (composants locaux : robuste aux fuseaux et aux changements
 *  d'heure — l'ancien calcul en millisecondes + `toISOString()` rendait la veille en UTC+x). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function clampPct(v: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, v));
}
