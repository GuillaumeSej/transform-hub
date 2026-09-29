import type { AuthUser, ChantierStaffing } from "@/types";
import { isAnyAdmin } from "@/lib/roleProfiles";
import { formatFte, intlTag } from "@/lib/format";
import { periodRange, teamStaffingMatrix, type StaffingThresholds } from "@/lib/staffingRate";

/**
 * Alertes de SUR-STAFFING (page « Budget & effectifs mobilisés ») : en plus du rouge du graphique,
 * une équipe dont le taux mobilisé / disponible dépasse le seuil « sur-staffé » de l'entreprise sur
 * un mois EN COURS ou À VENIR lève une alerte (cloche, Mon espace, bandeau de la page). Mêmes
 * calculs que la heatmap (`teamStaffingMatrix`) — aucune formule dupliquée. « Tendu » reste un
 * signal visuel, jamais une alerte. Les mois passés sont ignorés (plus rien à arbitrer).
 */

export type StaffingOverrun = {
  team: string;
  /** Début ISO des mois sur-staffés (ordre chronologique). */
  months: string[];
  /** Bornes de la plage concernée (du 1er mois sur-staffé à la fin du dernier). */
  from: string;
  to: string;
  /** Pic du taux (%) ; null = équipe absente de la base ETP (disponible nul) mais mobilisée. */
  peakRatePct: number | null;
  peakMobilised: number;
  peakAvailable: number;
};

/** Mois à surveiller : le mois courant et les `horizonMonths - 1` suivants. */
function upcomingMonths(today: string, horizonMonths: number) {
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  const end = new Date(Date.UTC(y, m + horizonMonths, 0)).toISOString().slice(0, 10);
  return periodRange(`${today.slice(0, 7)}-01`, end, "monthly", horizonMonths);
}

export function staffingOverruns(
  entries: ChantierStaffing[],
  fteByTeam: Record<string, number>,
  today: string,
  thresholds: StaffingThresholds,
  horizonMonths = 12
): StaffingOverrun[] {
  const months = upcomingMonths(today, horizonMonths);
  if (months.length === 0) return [];
  const out: StaffingOverrun[] = [];
  for (const row of teamStaffingMatrix(entries, fteByTeam, months, thresholds)) {
    const over = row.cells.filter((c) => c.level === "over");
    if (over.length === 0) continue;
    const peak = over.reduce((best, c) =>
      (c.ratePct ?? Infinity) > (best.ratePct ?? Infinity) ? c : best
    );
    out.push({
      team: row.team,
      months: over.map((c) => c.start),
      from: over[0].start,
      to: over[over.length - 1].end,
      peakRatePct: peak.ratePct,
      peakMobilised: peak.mobilised,
      peakAvailable: peak.available,
    });
  }
  return out;
}

type Translate = (key: string, fallback?: string) => string;

/** « oct. 2026 » ou « oct. 2026 → déc. 2026 », dans la langue de l'application. */
function monthRangeLabel(from: string, to: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso.slice(0, 7)}-15T00:00:00`).toLocaleDateString(intlTag(), {
      month: "short",
      year: "numeric",
    });
  const a = fmt(from);
  const b = fmt(to);
  return a === b ? a : `${a} → ${b}`;
}

/** Titre et texte d'une alerte de sur-staffing (cloche, Mon espace, bandeau Effectifs). */
export function staffingOverrunText(
  o: StaffingOverrun,
  t: Translate
): { title: string; desc: string } {
  const etp = t("staffingAlert.etp", "ETP");
  const period = monthRangeLabel(o.from, o.to);
  const title = t("staffingAlert.title", "Sur-staffing — {team}").replace("{team}", o.team);
  const desc =
    o.peakRatePct === null
      ? t(
          "staffingAlert.descNoBase",
          "{mobilised} mobilisés alors que l'équipe n'a aucun disponible dans la base ETP, sur {period}"
        )
          .replace("{mobilised}", formatFte(o.peakMobilised, { unit: etp }))
          .replace("{period}", period)
      : t(
          "staffingAlert.desc",
          "{peak} % de la capacité ({mobilised} mobilisés / {available} disponibles) sur {period}"
        )
          .replace("{peak}", String(o.peakRatePct))
          .replace("{mobilised}", formatFte(o.peakMobilised, { unit: etp }))
          .replace("{available}", formatFte(o.peakAvailable, { unit: etp }))
          .replace("{period}", period);
  return { title, desc };
}

/** Lien vers la page Budget & effectifs, équipe présélectionnée. */
export function staffingOverrunHref(o: Pick<StaffingOverrun, "team">): string {
  return `/effectifs?team=${encodeURIComponent(o.team)}`;
}

/** Destinataires : pilote du plan et Directeur RH du programme, et les admins. */
export function receivesStaffingAlerts(
  user: Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin"> | null | undefined,
  programId: string | null | undefined
): boolean {
  if (!user) return false;
  if (isAnyAdmin(user)) return true;
  return (user.profiles ?? []).some(
    (p) =>
      (p.role === "strategic_lead" || p.role === "hr") &&
      (!p.programId || !programId || p.programId === programId)
  );
}
