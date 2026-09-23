import type { AuthUser, ChantierStaffing, Role } from "@/types";
import { hasAnyRole, isAnyAdmin } from "@/lib/roleProfiles";
import {
  averageFte,
  nextPeriodStart,
  periodBoundsForDate,
  type NeedGranularity,
  type PeriodBounds,
} from "@/lib/staffingNeed";

/**
 * Taux de staffing = MOBILISÉ / DISPONIBLE (page « Budget & effectifs mobilisés »).
 *
 * Remplace l'ancien « taux de couverture » (mobilisé / besoin déclaré) : la notion de besoin
 * déclaré a été retirée de la page (demande PO). Toutes les lignes `ChantierStaffing` datées sont
 * désormais comptées comme mobilisation (planifiée ou en cours) — c'est ce qui permet de lire, pour
 * un mois FUTUR, qu'une équipe est déjà pleine (« en mars l'IT est sur-staffée, je ne peux pas lui
 * mettre de projet »).
 *
 *  - mobilisé    = ETP MOYENS des lignes recoupant la période (pondérés par le nombre de jours de
 *                  recoupement / durée de la période, `averageFte`), restreints le cas échéant aux
 *                  chantiers des axes sélectionnés ;
 *  - disponible  = ETP de l'équipe dans la base ETP entreprise (`Employee.fte` sommé par
 *                  département) — instantané, jamais filtré par axe ;
 *  - taux        = mobilisé / disponible, en % arrondi ; null si disponible nul.
 *
 * Seuils (paramètre d'affichage PAR ENTREPRISE, `StaffingThresholds`, défaut 85 / 100) :
 * > sur-staffé = sur-staffé ; tendu–sur-staffé = tendu ; < tendu = OK.
 */

export type StaffingRateLevel = "over" | "tense" | "ok" | "none";

/** Seuils d'alerte en % : OK < `tense` ≤ tendu ≤ `over` < sur-staffé. Paramètre d'affichage de
 *  l'entreprise (`leverMeta/{companyId}__displaySettings`, voir
 *  lib/firestore/companyDisplaySettings.ts), défaut `DEFAULT_STAFFING_THRESHOLDS`. */
export type StaffingThresholds = { tense: number; over: number };

export const STAFFING_TENSE_THRESHOLD = 85;
export const STAFFING_OVER_THRESHOLD = 100;
/** Borne haute acceptée pour le seuil « sur-staffé ». */
export const STAFFING_THRESHOLD_MAX = 300;

export const DEFAULT_STAFFING_THRESHOLDS: StaffingThresholds = Object.freeze({
  tense: STAFFING_TENSE_THRESHOLD,
  over: STAFFING_OVER_THRESHOLD,
});

export type StaffingThresholdsError = "invalid" | "tenseRange" | "order" | "overMax";

/** Validation : 0 < tendu < sur-staffé ≤ 300 (nombres finis). null = valide. */
export function validateStaffingThresholds(t: {
  tense: number;
  over: number;
}): StaffingThresholdsError | null {
  if (!Number.isFinite(t.tense) || !Number.isFinite(t.over)) return "invalid";
  if (t.tense <= 0) return "tenseRange";
  if (t.tense >= t.over) return "order";
  if (t.over > STAFFING_THRESHOLD_MAX) return "overMax";
  return null;
}

/** Profils habilités à MODIFIER les seuils de l'entreprise (« paramètre défini par la
 *  direction ») : CTO, pilote stratégique, owner/sponsor de programme — plus les admins (global ou
 *  d'entreprise). Les autres utilisateurs les voient en lecture seule. */
export const STAFFING_THRESHOLDS_EDITOR_ROLES: readonly Role[] = [
  "cto",
  "strategic_lead",
  "program_owner",
  "program_sponsor",
];

export function canEditStaffingThresholds(
  user: Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin"> | null | undefined
): boolean {
  return isAnyAdmin(user) || hasAnyRole(user, STAFFING_THRESHOLDS_EDITOR_ROLES);
}

/** Normalise une valeur lue (Firestore / localStorage, donc non fiable) : seuils valides ou défaut. */
export function normalizeStaffingThresholds(raw: unknown): StaffingThresholds {
  if (raw && typeof raw === "object") {
    const { tense, over } = raw as { tense?: unknown; over?: unknown };
    if (typeof tense === "number" && typeof over === "number") {
      const t = { tense, over };
      if (validateStaffingThresholds(t) === null) return t;
    }
  }
  return { ...DEFAULT_STAFFING_THRESHOLDS };
}

/** Niveau d'alerte d'un taux. `mobilised > 0` avec disponible nul (taux null) = sur-staffé : une
 *  équipe absente de la base ETP ne peut rien absorber. */
export function staffingRateLevel(
  ratePct: number | null,
  mobilised = 0,
  thresholds: StaffingThresholds = DEFAULT_STAFFING_THRESHOLDS
): StaffingRateLevel {
  if (ratePct === null) return mobilised > 0 ? "over" : "none";
  if (ratePct > thresholds.over) return "over";
  if (ratePct >= thresholds.tense) return "tense";
  return "ok";
}

export function staffingRatePct(mobilised: number, available: number): number | null {
  return available > 0 ? Math.round((mobilised / available) * 100) : null;
}

/** Filtre les lignes sur les chantiers rattachés à au moins un des axes sélectionnés. Sélection
 *  vide = tous les axes (aucun filtre, lignes de chantiers sans axe comprises). */
export function filterStaffingByAxes(
  entries: ChantierStaffing[],
  axisIdsByChantier: Record<string, string[] | undefined>,
  selectedAxisIds: readonly string[]
): ChantierStaffing[] {
  if (selectedAxisIds.length === 0) return entries;
  const selected = new Set(selectedAxisIds);
  return entries.filter((e) =>
    (axisIdsByChantier[e.chantierId] ?? []).some((axisId) => selected.has(axisId))
  );
}

/** Périodes consécutives de `from` à `to` inclus (bornes ISO), plafonnées à `maxPeriods`. */
export function periodRange(
  from: string,
  to: string,
  g: NeedGranularity,
  maxPeriods = 120
): PeriodBounds[] {
  const out: PeriodBounds[] = [];
  let cursor = periodBoundsForDate(from, g);
  while (cursor.start <= to && out.length < maxPeriods) {
    out.push(cursor);
    cursor = periodBoundsForDate(nextPeriodStart(cursor.end), g);
  }
  return out;
}

/** Les 12 mois de l'année `year`. */
export function monthsOfYear(year: number): PeriodBounds[] {
  return periodRange(`${year}-01-01`, `${year}-12-31`, "monthly");
}

export type StaffingRatePoint = PeriodBounds & {
  available: number;
  mobilised: number;
  ratePct: number | null;
  level: StaffingRateLevel;
};

export function staffingRatePoint(
  entries: ChantierStaffing[],
  available: number,
  period: PeriodBounds,
  thresholds: StaffingThresholds = DEFAULT_STAFFING_THRESHOLDS
): StaffingRatePoint {
  const mobilised = averageFte(entries, period);
  const ratePct = staffingRatePct(mobilised, available);
  return {
    ...period,
    available,
    mobilised,
    ratePct,
    level: staffingRateLevel(ratePct, mobilised, thresholds),
  };
}

/** Série continue (programme entier) de la première `startDate` à la dernière date connue (période
 *  courante incluse). Plafonnée aux `maxPeriods` DERNIÈRES périodes, pour que la vue mensuelle
 *  d'un long programme garde la période courante visible. */
export function staffingRateSeries(
  entries: ChantierStaffing[],
  totalAvailable: number,
  g: NeedGranularity,
  today: string,
  maxPeriods = 36,
  thresholds: StaffingThresholds = DEFAULT_STAFFING_THRESHOLDS
): StaffingRatePoint[] {
  const dated = entries.filter((e) => e.startDate);
  if (dated.length === 0) return [];
  let min = dated[0].startDate as string;
  let max = today;
  for (const e of dated) {
    if ((e.startDate as string) < min) min = e.startDate as string;
    const last = e.endDate ?? e.startDate;
    if (last && last > max) max = last;
  }
  const periods = periodRange(min, max, g, 1000);
  return periods
    .slice(-maxPeriods)
    .map((p) => staffingRatePoint(dated, totalAvailable, p, thresholds));
}

export type StaffingContribution = {
  /** `ChantierAction.id` (projet) ; absent = staffing transverse au chantier. */
  actionId?: string;
  chantierId: string;
  /** ETP moyens apportés sur la période. */
  fte: number;
};

export type TeamPeriodCell = StaffingRatePoint & {
  /** Contributions triées par ETP décroissants (projet, ou chantier si non rattaché à un projet). */
  contributions: StaffingContribution[];
};

/** Ligne de heatmap sans notion d'équipe (utilisée telle quelle pour la ligne TOTAL « Toutes
 *  équipes »). */
export type StaffingRow = {
  available: number;
  cells: TeamPeriodCell[];
  /** Nombre de périodes sur-staffées de la ligne. */
  overCount: number;
};

export type TeamStaffingRow = StaffingRow & { team: string };

/** Filtre les lignes sur une équipe (`ChantierStaffing.function`). `null` = toutes les équipes. */
export function filterStaffingByTeam(
  entries: ChantierStaffing[],
  team: string | null
): ChantierStaffing[] {
  return team === null ? entries : entries.filter((e) => e.function === team);
}

/** Disponible d'une équipe (base ETP) ; `null` = somme de toutes les équipes. */
export function availableForTeam(fteByTeam: Record<string, number>, team: string | null): number {
  if (team !== null) return fteByTeam[team] ?? 0;
  return Object.values(fteByTeam).reduce((sum, v) => sum + (v || 0), 0);
}

/** Équipes connues : base ETP ∪ équipes présentes dans les lignes de staffing, triées par nom. */
export function staffingTeams(
  entries: ChantierStaffing[],
  fteByTeam: Record<string, number>
): string[] {
  const teams = new Set<string>(Object.keys(fteByTeam));
  for (const e of entries) if (e.function) teams.add(e.function);
  return Array.from(teams).sort((a, b) => a.localeCompare(b));
}

const contributionKey = (e: Pick<ChantierStaffing, "actionId" | "chantierId">) =>
  e.actionId ? `a:${e.actionId}` : `c:${e.chantierId}`;

/** Cellule mobilisé / disponible d'une période, avec contributions regroupées par projet. */
export function staffingPeriodCell(
  entries: ChantierStaffing[],
  available: number,
  period: PeriodBounds,
  thresholds: StaffingThresholds = DEFAULT_STAFFING_THRESHOLDS
): TeamPeriodCell {
  const groups = new Map<string, StaffingContribution>();
  for (const e of entries) {
    const fte = averageFte([e], period);
    if (fte <= 0) continue;
    const key = contributionKey(e);
    const current = groups.get(key);
    if (current) current.fte += fte;
    else
      groups.set(key, {
        ...(e.actionId ? { actionId: e.actionId } : {}),
        chantierId: e.chantierId,
        fte,
      });
  }
  const contributions = Array.from(groups.values()).sort((a, b) => b.fte - a.fte);
  const mobilised = contributions.reduce((sum, c) => sum + c.fte, 0);
  const ratePct = staffingRatePct(mobilised, available);
  return {
    ...period,
    available,
    mobilised,
    ratePct,
    level: staffingRateLevel(ratePct, mobilised, thresholds),
    contributions,
  };
}

function staffingRow(
  entries: ChantierStaffing[],
  available: number,
  periods: PeriodBounds[],
  thresholds: StaffingThresholds
): StaffingRow {
  const cells = periods.map((period) => staffingPeriodCell(entries, available, period, thresholds));
  return { available, cells, overCount: cells.filter((c) => c.level === "over").length };
}

/** Clé de tri « le plus tendu d'abord » : un taux null avec mobilisation (équipe absente de la base
 *  ETP) passe devant tout. */
const sortableRate = (ratePct: number | null, mobilised: number) =>
  ratePct === null ? (mobilised > 0 ? 1e9 : -1) : ratePct;

/** Matrice équipe × période : pour chaque équipe (base ETP ∪ équipes présentes dans les lignes),
 *  mobilisé/disponible sur chaque période, avec le détail des projets contributeurs. Triée par
 *  nombre de périodes sur-staffées puis par taux max décroissant, puis par nom. */
export function teamStaffingMatrix(
  entries: ChantierStaffing[],
  fteByTeam: Record<string, number>,
  periods: PeriodBounds[],
  thresholds: StaffingThresholds = DEFAULT_STAFFING_THRESHOLDS
): TeamStaffingRow[] {
  const dated = entries.filter((e) => e.startDate);
  const byTeam = new Map<string, ChantierStaffing[]>();
  for (const e of dated) {
    const list = byTeam.get(e.function) ?? [];
    list.push(e);
    byTeam.set(e.function, list);
  }
  const teams = new Set<string>([...Object.keys(fteByTeam), ...Array.from(byTeam.keys())]);
  const rows: TeamStaffingRow[] = Array.from(teams).map((team) => ({
    team,
    ...staffingRow(byTeam.get(team) ?? [], fteByTeam[team] ?? 0, periods, thresholds),
  }));
  const maxRate = (r: TeamStaffingRow) =>
    Math.max(-1, ...r.cells.map((c) => sortableRate(c.ratePct, c.mobilised)));
  return rows.sort(
    (a, b) => b.overCount - a.overCount || maxRate(b) - maxRate(a) || a.team.localeCompare(b.team)
  );
}

/** Ligne TOTAL « Toutes équipes » de la heatmap (remplace l'ancien tableau par période sous le
 *  graphique) : mobilisé de toutes les lignes / disponible total de la base ETP, par période —
 *  même définition que le graphique sans filtre d'équipe. */
export function totalStaffingRow(
  entries: ChantierStaffing[],
  fteByTeam: Record<string, number>,
  periods: PeriodBounds[],
  thresholds: StaffingThresholds = DEFAULT_STAFFING_THRESHOLDS
): StaffingRow {
  return staffingRow(
    entries.filter((e) => e.startDate),
    availableForTeam(fteByTeam, null),
    periods,
    thresholds
  );
}

// ── Détail « Qui est mobilisé où » d'une période (popup au clic sur une colonne du graphique ou
//    sur une cellule de la heatmap). ─────────────────────────────────────────────────────────

export type PeriodDetailLine = {
  entry: ChantierStaffing;
  /** ETP MOYENS de la ligne sur la période (≤ `entry.fte` si la ligne n'en couvre qu'une partie). */
  fte: number;
};

export type PeriodDetailGroup = {
  key: string;
  /** `ChantierAction.id` (projet) ; absent = staffing transverse au chantier. */
  actionId?: string;
  chantierId: string;
  fte: number;
  lines: PeriodDetailLine[];
};

export type PeriodDetailTeam = StaffingRatePoint & {
  team: string;
  groups: PeriodDetailGroup[];
};

export type PeriodStaffingDetail = StaffingRatePoint & {
  /** Équipes ayant au moins une mobilisation sur la période — les plus tendues d'abord. */
  teams: PeriodDetailTeam[];
};

/** Lignes actives sur `period`, regroupées par ÉQUIPE puis par projet/chantier, avec leurs ETP
 *  moyens. `team` restreint à une équipe (totaux compris) ; `null` = toutes. Les totaux d'en-tête
 *  (mobilisé / disponible / taux) sont ceux du graphique pour le même filtre. */
export function periodStaffingDetail(
  entries: ChantierStaffing[],
  fteByTeam: Record<string, number>,
  period: PeriodBounds,
  team: string | null = null,
  thresholds: StaffingThresholds = DEFAULT_STAFFING_THRESHOLDS
): PeriodStaffingDetail {
  const byTeam = new Map<string, Map<string, PeriodDetailGroup>>();
  for (const entry of filterStaffingByTeam(entries, team)) {
    if (!entry.startDate) continue;
    const fte = averageFte([entry], period);
    if (fte <= 0) continue;
    const groups = byTeam.get(entry.function) ?? new Map<string, PeriodDetailGroup>();
    byTeam.set(entry.function, groups);
    const key = contributionKey(entry);
    const group = groups.get(key) ?? {
      key,
      ...(entry.actionId ? { actionId: entry.actionId } : {}),
      chantierId: entry.chantierId,
      fte: 0,
      lines: [],
    };
    groups.set(key, group);
    group.fte += fte;
    group.lines.push({ entry, fte });
  }

  const teams: PeriodDetailTeam[] = Array.from(byTeam.entries()).map(([name, groupMap]) => {
    const groups = Array.from(groupMap.values()).sort((a, b) => b.fte - a.fte);
    for (const g of groups) {
      g.lines.sort(
        (a, b) => b.fte - a.fte || (a.entry.note ?? "").localeCompare(b.entry.note ?? "")
      );
    }
    const mobilised = groups.reduce((sum, g) => sum + g.fte, 0);
    const available = fteByTeam[name] ?? 0;
    const ratePct = staffingRatePct(mobilised, available);
    return {
      ...period,
      team: name,
      available,
      mobilised,
      ratePct,
      level: staffingRateLevel(ratePct, mobilised, thresholds),
      groups,
    };
  });
  teams.sort(
    (a, b) =>
      sortableRate(b.ratePct, b.mobilised) - sortableRate(a.ratePct, a.mobilised) ||
      b.mobilised - a.mobilised ||
      a.team.localeCompare(b.team)
  );

  const available = availableForTeam(fteByTeam, team);
  const mobilised = teams.reduce((sum, row) => sum + row.mobilised, 0);
  const ratePct = staffingRatePct(mobilised, available);
  return {
    ...period,
    available,
    mobilised,
    ratePct,
    level: staffingRateLevel(ratePct, mobilised, thresholds),
    teams,
  };
}
