import type {
  Department,
  Employee,
  Lever,
  MovementType,
  Workforce,
  WorkforceDimensionBaseline,
  WorkforceMovement,
} from "@/types";
import { daysBetween } from "@/lib/dateUtils";
import { STATUS_ORDER } from "@/lib/status-config";
import { isActiveMovement } from "@/lib/workforceLogic";
import { loadedAnnualSalary } from "@/lib/hrFinancials";
import { planMovementFte, targetMovementFteImpact } from "@/lib/hrProgramSummary";

/**
 * Moteur de calcul pur du module RH — agrégations de la base ETP et des mouvements pour le
 * Dashboard RH (waterfall, breakdowns, PSE, pont ETP, rythme mensuel) et les alertes de
 * réconciliation RH ↔ leviers. Séparé de lib/engine.ts (leviers) pour limiter les conflits
 * de merge : mêmes conventions, fonctions pures qui prennent les données en paramètre.
 *
 * Aligné sur la typologie 5-types de "OD Monitoring" (Gooduelle) — voir
 * `types/index.ts::MovementType`.
 */

/**
 * Date de référence ("aujourd'hui") de TOUS les calculs RH — retards, échéances, "réalisé à date",
 * bascule réalisé/prévision des séries temporelles. Source UNIQUE : date LOCALE réelle du poste
 * (et non `toISOString()`, qui bascule au jour suivant/précédent autour de minuit selon le fuseau).
 *
 * `override` (optionnel) fige la date pour les tests ou une démo : une chaîne ISO `YYYY-MM-DD…`
 * (seuls les 10 premiers caractères sont gardés) ou un `Date`. Une valeur invalide est ignorée.
 * Remplace l'ancienne constante figée `HR_TODAY = "2026-06-22"`.
 */
export function hrToday(override?: string | Date | null): string {
  if (typeof override === "string" && /^\d{4}-\d{2}-\d{2}/.test(override)) {
    return override.slice(0, 10);
  }
  const d = override instanceof Date && !isNaN(override.getTime()) ? override : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Liste ordonnée des 5 types Gooduelle — utilisée par les widgets qui ont besoin d'itérer sur
 *  toutes les catégories dans un ordre stable (breakdown, ventilation, pont ETP). */
export const MOVEMENT_TYPES: MovementType[] = [
  "Recrutement",
  "Attrition",
  "Départ forcé",
  "Transfert entrant",
  "Transfert sortant",
];

/** Effet d'un mouvement sur l'effectif TOTAL — les transferts internes (entrants/sortants) sont
 *  neutres pour le total, seuls Recrutement (+) et Attrition/Départ forcé (−) le modifient.
 *
 *  Transferts : `fteEffect` vaut TOUJOURS 0 (mobilité interne, l'effectif global ne bouge pas).
 *  Leur effet n'existe qu'au niveau d'une dimension (département source −, cible +) — voir
 *  `transferDirectionFor` / `movementBreakdownByDimension` / `ftePositionsByDimension`. Ils ne
 *  déclenchent donc jamais l'alerte de sens contraire au levier (`movementAlerts`).
 *
 *  Filet défensif (Août 2026) : un type inconnu (donnée Firestore antérieure à la migration
 *  5-types, valeur importée depuis un Excel legacy, saisie API non validée) retombe sur 0
 *  plutôt que de propager `undefined` en NaN dans tous les KPI dépendants (currentFTE,
 *  plannedFTE, fteBridge, hrProgramSummary…). Un warning dev signale la donnée pour traçabilité. */
export function fteEffect(m: WorkforceMovement): number {
  switch (m.type) {
    case "Recrutement":
      return +m.fte;
    case "Attrition":
    case "Départ forcé":
      return -m.fte;
    case "Transfert entrant":
    case "Transfert sortant":
      return 0;
    default: {
      const rawType = (m as { type?: unknown }).type;
      if (typeof console !== "undefined" && process.env.NODE_ENV !== "production") {
        console.warn(
          `[hrEngine] fteEffect: unknown MovementType "${String(rawType)}" for movement ${m.id} — falling back to 0. Vérifier la migration 5-types Gooduelle (voir workforce SCHEMA_VERSION).`
        );
      }
      return 0;
    }
  }
}

export function currentFTE(wf: Workforce): number {
  return (
    wf.totalFTE +
    wf.movements
      .filter((m) => isActiveMovement(m) && m.status === "Réalisé")
      .reduce((s, m) => s + fteEffect(m), 0)
  );
}

/** Atterrissage : effectif si TOUS les mouvements du plan se réalisent. */
export function plannedFTE(wf: Workforce): number {
  return wf.totalFTE + wf.movements.filter(isActiveMovement).reduce((s, m) => s + fteEffect(m), 0);
}

/** "Effectif cible" — définition UNIQUE partagée par le Dashboard RH et la Base ETP (m3) :
 *  baseline + impact ETP CIBLE de tous les mouvements actifs (plan figé `lockedPlan.fte ?? fte`,
 *  transferts neutres, abandonnés exclus — même source que le KPI Impact ETP,
 *  `targetMovementFteImpact`). Remplace l'ancienne somme des `Department.fteTarget` saisis à la
 *  main, sans lien avec les mouvements. L'appelant passe une `Workforce` déjà scopée (baseline +
 *  mouvements du périmètre) pour obtenir la cible d'un périmètre. */
export function targetFTE(wf: Pick<Workforce, "totalFTE" | "movements">): number {
  const baseline = Number.isFinite(wf.totalFTE) ? wf.totalFTE : 0;
  const impact = wf.movements.reduce((s, m) => s + targetMovementFteImpact(m), 0);
  return Math.round((baseline + impact) * 10) / 10;
}

// ---------- Baseline dérivée de la base ETP (B2) ----------

/** Baseline de la base ETP (même forme que les champs "méta" de `Workforce`). */
export type WorkforceBaseline = {
  totalFTE: number;
  /** €M — somme des salaires CHARGÉS annuels (`loadedAnnualSalary`), même assiette que les
   *  `salaryImpact` des mouvements (lib/hrFinancials.ts). */
  massSalary: number;
  departments: Department[];
  countryBaselines: WorkforceDimensionBaseline[];
  workstreamBaselines: WorkforceDimensionBaseline[];
};

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

function groupFte(
  employees: Employee[],
  keyOf: (e: Employee) => string | undefined
): WorkforceDimensionBaseline[] {
  const map = new Map<string, number>();
  for (const e of employees) {
    const key = keyOf(e)?.trim();
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + (Number.isFinite(e.fte) ? e.fte : 0));
  }
  return Array.from(map.entries())
    .map(([key, fte]) => ({ key, label: key, fte: round1(fte) }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

/**
 * Dérive la baseline (ETP total, masse salariale, départements, baselines pays) de la LISTE DES
 * EMPLOYÉS — utilisée quand aucune baseline explicite n'a été enregistrée (entreprise neuve, base
 * saisie/importée sans méta : baselines à 0 et liste de départements vide dans le formulaire de
 * mouvement). Même agrégat que `workforceLogic.fteByDepartment`. `Employee` ne porte pas de
 * workstream : pas de baseline workstream dérivable (liste vide). `fteTarget` = `fte` (pas de
 * cible saisie ; la cible se lit via `targetFTE`, dérivée des mouvements).
 *
 * Exportée pour l'import Excel RH, qui peut l'utiliser pour écrire une baseline explicite.
 */
export function deriveWorkforceBaseline(employees: Employee[]): WorkforceBaseline {
  const totalFTE = round1(employees.reduce((s, e) => s + (Number.isFinite(e.fte) ? e.fte : 0), 0));
  const massSalary = round2(
    employees.reduce(
      (s, e) => s + (Number.isFinite(e.salary) ? loadedAnnualSalary(e.salary) : 0),
      0
    ) / 1_000_000
  );
  const departments: Department[] = groupFte(employees, (e) => e.department).map((d) => ({
    name: d.key,
    fte: d.fte,
    fteTarget: d.fte,
  }));
  return {
    totalFTE,
    massSalary,
    departments,
    countryBaselines: groupFte(employees, (e) => e.country),
    workstreamBaselines: [],
  };
}

/**
 * Complète une `Workforce` avec la baseline dérivée des employés POUR CHAQUE partie absente
 * (ETP total ≤ 0, masse salariale ≤ 0, départements / pays vides) — une baseline explicite
 * (enregistrée dans la méta workforce, ex. après import) reste toujours prioritaire. Idempotent,
 * sans effet si la base ETP est vide ; retourne la même instance si rien n'est à compléter.
 */
export function withDerivedWorkforceBaseline<W extends Workforce>(wf: W): W {
  if (!wf.employees || wf.employees.length === 0) return wf;
  const missingTotal = !(Number.isFinite(wf.totalFTE) && wf.totalFTE > 0);
  const missingMass = !(Number.isFinite(wf.massSalary) && wf.massSalary > 0);
  const missingDepartments = !wf.departments || wf.departments.length === 0;
  const missingCountries = !wf.countryBaselines || wf.countryBaselines.length === 0;
  if (!missingTotal && !missingMass && !missingDepartments && !missingCountries) return wf;
  const derived = deriveWorkforceBaseline(wf.employees);
  return {
    ...wf,
    totalFTE: missingTotal ? derived.totalFTE : wf.totalFTE,
    massSalary: missingMass ? derived.massSalary : wf.massSalary,
    departments: missingDepartments ? derived.departments : wf.departments,
    countryBaselines: missingCountries ? derived.countryBaselines : wf.countryBaselines,
    workstreamBaselines: wf.workstreamBaselines ?? [],
  };
}

/** Départements connus (baseline explicite + départements des employés + départements cités
 *  par les mouvements), triés — référentiel des sélecteurs de département (MovementForm). */
export function knownDepartments(
  wf: Pick<Workforce, "departments" | "employees" | "movements">
): string[] {
  const set = new Set<string>();
  for (const d of wf.departments ?? []) if (d.name) set.add(d.name);
  for (const e of wf.employees ?? []) if (e.department) set.add(e.department);
  for (const m of wf.movements ?? []) {
    if (m.department) set.add(m.department);
    if (m.toDepartment) set.add(m.toDepartment);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
}

// ---------- Baseline scopée par les filtres (M3) ----------

/** Filtres du Dashboard RH qui ont un équivalent sur la baseline (employés / baselines
 *  explicites). Tout autre filtre (type, statut, fonction, RH owner, arborescences…) ne porte
 *  que sur les mouvements : la baseline n'est alors pas scopable. */
export type BaselineScopeFilters = {
  department?: string[];
  country?: string[];
  workstream?: string[];
};

/**
 * Baseline restreinte au périmètre filtré, ou `null` si elle n'est pas calculable pour ce
 * périmètre — l'appelant masque alors les chiffres absolus (avec une note) plutôt que d'afficher
 * la baseline de TOUTE l'entreprise à côté de mouvements filtrés.
 *  - département et/ou pays : sommes des employés du périmètre ; en mono-dimension, les
 *    baselines explicites saisies (départements / pays) restent prioritaires sur les employés ;
 *  - workstream : baselines workstream explicites uniquement (pas de workstream sur Employee),
 *    et seulement s'il est le seul filtre scopable actif.
 * Les baselines par dimension retournées sont elles aussi restreintes au périmètre. La masse
 * salariale suit les employés du périmètre, ou est proratisée à l'ETP à défaut.
 */
export function scopeWorkforceBaseline(
  wf: Workforce,
  filters: BaselineScopeFilters
): WorkforceBaseline | null {
  const base = withDerivedWorkforceBaseline(wf);
  const dep = filters.department?.length ? new Set(filters.department) : null;
  const cty = filters.country?.length ? new Set(filters.country) : null;
  const ws = filters.workstream?.length ? new Set(filters.workstream) : null;
  const full: WorkforceBaseline = {
    totalFTE: Number.isFinite(base.totalFTE) ? base.totalFTE : 0,
    massSalary: Number.isFinite(base.massSalary) ? base.massSalary : 0,
    departments: base.departments ?? [],
    countryBaselines: base.countryBaselines ?? [],
    workstreamBaselines: base.workstreamBaselines ?? [],
  };
  if (!dep && !cty && !ws) return full;
  const sumFte = (rows: { fte: number }[]) => round1(rows.reduce((s, r) => s + r.fte, 0));
  const prorataMass = (fte: number) =>
    full.totalFTE > 0 ? round2((full.massSalary * fte) / full.totalFTE) : 0;

  if (ws) {
    if (dep || cty) return null;
    const rows = full.workstreamBaselines.filter((b) => ws.has(b.key));
    if (rows.length === 0) return null;
    const totalFTE = sumFte(rows);
    return {
      totalFTE,
      massSalary: prorataMass(totalFTE),
      departments: [],
      countryBaselines: [],
      workstreamBaselines: rows,
    };
  }

  const allEmployees = base.employees ?? [];
  if (allEmployees.length > 0) {
    const derived = deriveWorkforceBaseline(
      allEmployees.filter((e) => (!dep || dep.has(e.department)) && (!cty || cty.has(e.country)))
    );
    if (dep && !cty && (wf.departments ?? []).length > 0) {
      const rows = full.departments.filter((d) => dep.has(d.name));
      return { ...derived, totalFTE: sumFte(rows), departments: rows };
    }
    if (cty && !dep && (wf.countryBaselines ?? []).length > 0) {
      const rows = full.countryBaselines.filter((c) => cty.has(c.key));
      return { ...derived, totalFTE: sumFte(rows), countryBaselines: rows };
    }
    return derived;
  }
  // Pas d'employés : seules les baselines explicites mono-dimension sont utilisables.
  if (dep && !cty && full.departments.length > 0) {
    const rows = full.departments.filter((d) => dep.has(d.name));
    const totalFTE = sumFte(rows);
    return {
      totalFTE,
      massSalary: prorataMass(totalFTE),
      departments: rows,
      countryBaselines: [],
      workstreamBaselines: [],
    };
  }
  if (cty && !dep && full.countryBaselines.length > 0) {
    const rows = full.countryBaselines.filter((c) => cty.has(c.key));
    const totalFTE = sumFte(rows);
    return {
      totalFTE,
      massSalary: prorataMass(totalFTE),
      departments: [],
      countryBaselines: rows,
      workstreamBaselines: [],
    };
  }
  return null;
}

// ---------- Waterfall ETP ----------

/** Décomposition signée d'un bucket par type (positifs pour Recrutement, négatifs pour
 *  Attrition/Départ forcé, 0 pour les transferts internes). */
export type MovementTypeDelta = Record<MovementType, number>;

const EMPTY_TYPE_DELTA = (): MovementTypeDelta => ({
  Recrutement: 0,
  Attrition: 0,
  "Départ forcé": 0,
  "Transfert entrant": 0,
  "Transfert sortant": 0,
});

export type FteBridgeBucket = {
  /** Clé STABLE indépendante de la langue ("2026-02", "2026-Q1", "2026") — à utiliser pour toute
   *  recherche/sélection (drill-down), jamais `label`. */
  key: string;
  /** Libellé d'affichage localisé ("févr. 2026" / "Feb 2026", "T1 2026" / "Q1 2026", "2026"). */
  label: string;
  /** ISO début et fin de la période couverte par le bucket. */
  startISO: string;
  endISO: string;
  delta: number;
  cumulative: number; // effectif total en fin de bucket
  movements: WorkforceMovement[];
  /** Détail signé du delta par type (utilisé par le rythme et le pont ETP). */
  byType: MovementTypeDelta;
};

export type BridgeGranularity = "month" | "quarter" | "year";

/** Options d'affichage communes aux séries temporelles RH. */
export type HrSeriesOptions = {
  /** Locale BCP 47 des libellés de période (défaut "fr-FR"). N'affecte jamais les clés. */
  locale?: string;
};

/** Clé stable (indépendante de la langue) d'une période : "2026-02" (mois, index 0-11),
 *  "2026-Q1" (trimestre, index 0-3), "2026" (année). */
export function hrPeriodKey(year: number, index: number, granularity: BridgeGranularity): string {
  if (granularity === "month") return `${year}-${String(index + 1).padStart(2, "0")}`;
  if (granularity === "quarter") return `${year}-Q${index + 1}`;
  return String(year);
}

const monthFormatters = new Map<string, Intl.DateTimeFormat>();

/** Libellé d'affichage localisé d'une période — mois abrégé via `Intl` dans la locale active
 *  ("févr. 2026", "Feb 2026"…), trimestre "T1 2026" (fr/es) ou "Q1 2026" (en/de…), année
 *  "2026". Clés (`hrPeriodKey`) et libellés sont séparés : ne jamais rechercher par libellé. */
export function hrPeriodLabel(
  year: number,
  index: number,
  granularity: BridgeGranularity,
  locale: string = "fr-FR"
): string {
  if (granularity === "month") {
    let fmt = monthFormatters.get(locale);
    if (!fmt) {
      try {
        fmt = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
      } catch {
        fmt = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
      }
      monthFormatters.set(locale, fmt);
    }
    return `${fmt.format(new Date(Date.UTC(year, index, 1)))} ${year}`;
  }
  if (granularity === "quarter") {
    const prefix = /^(fr|es)/i.test(locale) ? "T" : "Q";
    return `${prefix}${index + 1} ${year}`;
  }
  return String(year);
}

/** Libellé localisé de la période d'une date ISO (mois ou trimestre) — `null` si date invalide. */
export function hrPeriodLabelForDate(
  dateISO: string | null | undefined,
  granularity: BridgeGranularity,
  locale?: string
): string | null {
  if (!dateISO) return null;
  const year = Number(dateISO.slice(0, 4));
  const month = Number(dateISO.slice(5, 7)) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) return null;
  const index =
    granularity === "month" ? month : granularity === "quarter" ? Math.floor(month / 3) : 0;
  return hrPeriodLabel(year, index, granularity, locale);
}

/** Plage de dates optionnelle (ISO). Un mouvement compte dans un bucket si sa `plannedDate` est
 *  entre `from` et `to` (inclusif). */
export type DateRange = { from?: string | null; to?: string | null };

function isInRange(dateISO: string, range?: DateRange): boolean {
  if (!range) return true;
  if (range.from && dateISO < range.from) return false;
  if (range.to && dateISO > range.to) return false;
  return true;
}

function firstDayOfMonth(year: number, monthIdx: number): string {
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}-01`;
}

function lastDayOfMonth(year: number, monthIdx: number): string {
  const d = new Date(year, monthIdx + 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Détermine les bornes ISO d'un bucket pour la granularité et l'année de référence donnés. */
function bucketBounds(
  year: number,
  index: number,
  granularity: BridgeGranularity,
  locale?: string
): { key: string; startISO: string; endISO: string; label: string } {
  const key = hrPeriodKey(year, index, granularity);
  const label = hrPeriodLabel(year, index, granularity, locale);
  if (granularity === "month") {
    return {
      key,
      startISO: firstDayOfMonth(year, index),
      endISO: lastDayOfMonth(year, index),
      label,
    };
  }
  if (granularity === "quarter") {
    const startMonth = index * 3;
    const endMonth = startMonth + 2;
    return {
      key,
      startISO: firstDayOfMonth(year, startMonth),
      endISO: lastDayOfMonth(year, endMonth),
      label,
    };
  }
  // year
  return {
    key,
    startISO: firstDayOfMonth(year, 0),
    endISO: lastDayOfMonth(year, 11),
    label,
  };
}

/** Détermine les années couvertes par le range (ou par les mouvements si absent). */
function yearsCovered(wf: Workforce, range?: DateRange): number[] {
  let minYear: number | null = null;
  let maxYear: number | null = null;
  if (range?.from) minYear = Number(range.from.slice(0, 4));
  if (range?.to) maxYear = Number(range.to.slice(0, 4));
  if (minYear === null || maxYear === null) {
    for (const m of wf.movements) {
      if (!m.plannedDate) continue;
      const y = Number(m.plannedDate.slice(0, 4));
      if (!Number.isFinite(y)) continue;
      if (minYear === null || y < minYear) minYear = y;
      if (maxYear === null || y > maxYear) maxYear = y;
    }
  }
  if (minYear === null || maxYear === null) {
    const currentYear = Number(hrToday().slice(0, 4));
    return [currentYear];
  }
  const years: number[] = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);
  return years;
}

/** Effectif d'OUVERTURE d'une plage : baseline + effet des mouvements RÉALISÉS datés avant
 *  `range.from` (même règle que `fteBridgeSummary`). Sans `from` : la baseline. `wf.movements`
 *  doit contenir les mouvements du périmètre SANS filtre de date, sinon l'historique antérieur à la
 *  plage est perdu. */
export function fteOpening(wf: Workforce, range?: DateRange): number {
  let opening = Number.isFinite(wf.totalFTE) ? wf.totalFTE : 0;
  if (range?.from) {
    for (const m of wf.movements) {
      if (!isActiveMovement(m)) continue;
      if (!m.plannedDate || m.plannedDate >= range.from) continue;
      if (m.status === "Réalisé") opening += fteEffect(m);
    }
  }
  return Math.round(opening * 10) / 10;
}

/** Masse salariale d'OUVERTURE (€M) d'une plage : baseline + `salaryImpact` des mouvements
 *  RÉALISÉS datés avant `range.from` — pendant de `fteOpening` pour la waterfall masse salariale. */
export function salaryOpening(wf: Workforce, range?: DateRange): number {
  let opening = Number.isFinite(wf.massSalary) ? wf.massSalary : 0;
  if (range?.from) {
    for (const m of wf.movements) {
      if (!isActiveMovement(m)) continue;
      if (!m.plannedDate || m.plannedDate >= range.from) continue;
      if (m.status === "Réalisé") opening += (m.salaryImpact || 0) / 1_000_000;
    }
  }
  return Math.round(opening * 100) / 100;
}

/**
 * Projection en cascade des mouvements par mois, trimestre ou année.
 *
 *  - Sans `range` : couvre toutes les années présentes dans les mouvements.
 *  - Avec `range` : les buckets couvrent la plage `from`/`to` (bornes incluses) et la cascade
 *    part de l'effectif d'OUVERTURE (`fteOpening` : baseline + réalisés avant `from`), pas de la
 *    baseline d'origine (M2). Passer les mouvements du périmètre NON filtrés par date.
 *  - Chaque bucket porte ses mouvements et un détail signé par type (`byType`) — utilisé par
 *    le rythme mensuel et le pont ETP au clic.
 */
export function fteBridge(
  wf: Workforce,
  granularity: BridgeGranularity,
  range?: DateRange,
  options: HrSeriesOptions = {}
): FteBridgeBucket[] {
  const years = yearsCovered(wf, range);
  const buckets: FteBridgeBucket[] = [];
  for (const year of years) {
    const bucketCount = granularity === "month" ? 12 : granularity === "quarter" ? 4 : 1;
    for (let i = 0; i < bucketCount; i++) {
      const { key, startISO, endISO, label } = bucketBounds(year, i, granularity, options.locale);
      // Skip buckets entièrement hors range
      if (range?.from && endISO < range.from) continue;
      if (range?.to && startISO > range.to) continue;
      buckets.push({
        key,
        label,
        startISO,
        endISO,
        delta: 0,
        cumulative: 0,
        movements: [],
        byType: EMPTY_TYPE_DELTA(),
      });
    }
  }

  for (const m of wf.movements) {
    if (!isActiveMovement(m)) continue;
    if (!m.plannedDate) continue;
    if (range && !isInRange(m.plannedDate, range)) continue;
    const bucket = buckets.find((b) => m.plannedDate >= b.startISO && m.plannedDate <= b.endISO);
    if (!bucket) continue;
    const effect = fteEffect(m);
    bucket.delta += effect;
    // Filet défensif : m.type peut ne pas être une clé connue de MovementTypeDelta (donnée
    // legacy Firestore). On garde 0 comme valeur de base pour éviter la cascade NaN.
    const currentByType = bucket.byType[m.type] ?? 0;
    bucket.byType[m.type] = currentByType + effect;
    bucket.movements.push(m);
  }

  let running = fteOpening(wf, range);
  for (const b of buckets) {
    running += b.delta;
    b.cumulative = Math.round(running * 10) / 10;
  }
  return buckets;
}

/** Décomposition d'un bucket par levier (pour le drill-down au clic sur la waterfall).
 *  `valueOf` détermine la grandeur affichée par levier — par défaut le delta ETP, mais la
 *  waterfall masse salariale (même mécanisme de drill, mêmes mouvements) passe un accesseur
 *  sommant `salaryImpact` en €M à la place. */
export function bucketByLever(
  bucket: FteBridgeBucket,
  levers: Lever[],
  valueOf: (movements: WorkforceMovement[]) => number = (movements) =>
    Math.round(movements.reduce((s, m) => s + fteEffect(m), 0) * 10) / 10
): {
  leverId: string;
  leverCode: string;
  leverName: string;
  movements: WorkforceMovement[];
  value: number;
}[] {
  const byLever = new Map<string, WorkforceMovement[]>();
  for (const m of bucket.movements) {
    byLever.set(m.leverId, [...(byLever.get(m.leverId) ?? []), m]);
  }
  return Array.from(byLever.entries()).map(([leverId, movements]) => {
    const lever = levers.find((l) => l.id === leverId);
    return {
      leverId,
      leverCode: lever?.code ?? leverId,
      leverName: lever?.name ?? leverId,
      movements,
      value: valueOf(movements),
    };
  });
}

// ---------- Pont ETP (bridge summary sur une plage) ----------

/** Décomposition ETP d'une plage : ouverture, contributions par type (signées), clôture.
 *  Utilisé par le widget "Contribution des mouvements au résultat net" (pont ETP vertical). */
export type FteBridgeSummary = {
  opening: number;
  closing: number;
  contributions: { type: MovementType; delta: number; count: number }[];
};

export function fteBridgeSummary(wf: Workforce, range?: DateRange): FteBridgeSummary {
  // Ouverture = totalFTE + effet cumulé des mouvements RÉALISÉS avant `range.from`.
  const opening = fteOpening(wf, range);

  const contribs: MovementTypeDelta = EMPTY_TYPE_DELTA();
  const counts: Record<MovementType, number> = {
    Recrutement: 0,
    Attrition: 0,
    "Départ forcé": 0,
    "Transfert entrant": 0,
    "Transfert sortant": 0,
  };
  for (const m of wf.movements) {
    if (!isActiveMovement(m)) continue;
    if (!m.plannedDate) continue;
    if (range && !isInRange(m.plannedDate, range)) continue;
    // Filet défensif type legacy → 0 (voir fteEffect / MovementTypeDelta).
    const currentContrib = contribs[m.type] ?? 0;
    contribs[m.type] = currentContrib + fteEffect(m);
    counts[m.type] = (counts[m.type] ?? 0) + 1;
  }
  const closing = opening + Object.values(contribs).reduce((s, v) => s + v, 0);

  return {
    opening: Math.round(opening * 10) / 10,
    closing: Math.round(closing * 10) / 10,
    contributions: MOVEMENT_TYPES.map((type) => ({
      type,
      delta: Math.round(contribs[type] * 10) / 10,
      count: counts[type],
    })),
  };
}

// ---------- Breakdowns ----------

/** Ventilation d'un département par type de mouvement Gooduelle. Les 5 catégories sont
 *  exposées + `exits` = attritions + départs forcés (compat legacy avec les composants).
 *  Les transferts entrants/sortants sont comptés au département SOURCE (m.department) et au
 *  département CIBLE (m.toDepartment) séparément — un transfert impacte les deux. */
export type DepartmentMovements = {
  department: string;
  recrutements: number;
  attritions: number;
  forcedDepartures: number;
  transfertEntrants: number;
  transfertSortants: number;
  /** Legacy — somme des sorties (Attrition + Départ forcé), pour compat avec les composants
   *  existants qui affichent 3 séries (créations / départs / transferts). */
  exits: number;
  /** Legacy — somme des transferts entrants + sortants. */
  transferts: number;
  /** Impact net (signé) sur le département source / cible. */
  net: number;
};

/** Sens d'un transfert relativement à un groupe (département, pays…). */
export type TransferDirection = "in" | "out";

/**
 * Jambes départementales d'un transfert (M11) — règle UNIQUE pour toutes les vues :
 *  - avec un département d'arrivée (`toDepartment`) distinct : SORTIE du département source et
 *    ENTRÉE au département cible, quel que soit le type enregistré ("entrant"/"sortant") ;
 *  - sans destination (donnée legacy — le formulaire l'exige désormais) : repli sur le TYPE
 *    enregistré, une seule jambe sur `department` ("Transfert entrant" = entrée, "Transfert
 *    sortant" = sortie). Auparavant un "Transfert entrant" sans destination était compté comme
 *    sortant dans les vues par département et entrant ailleurs.
 * Tableau vide pour un mouvement qui n'est pas un transfert.
 */
export function transferDepartmentLegs(
  m: Pick<WorkforceMovement, "type" | "department" | "toDepartment">
): { department: string; direction: TransferDirection }[] {
  if (m.type !== "Transfert entrant" && m.type !== "Transfert sortant") return [];
  if (m.toDepartment && m.toDepartment !== m.department) {
    return [
      { department: m.department, direction: "out" },
      { department: m.toDepartment, direction: "in" },
    ];
  }
  return [{ department: m.department, direction: m.type === "Transfert entrant" ? "in" : "out" }];
}

export function movementsByDepartment(wf: Workforce): DepartmentMovements[] {
  const rows = new Map<string, DepartmentMovements>();
  const row = (dept: string) => {
    if (!rows.has(dept)) {
      rows.set(dept, {
        department: dept,
        recrutements: 0,
        attritions: 0,
        forcedDepartures: 0,
        transfertEntrants: 0,
        transfertSortants: 0,
        exits: 0,
        transferts: 0,
        net: 0,
      });
    }
    return rows.get(dept)!;
  };
  for (const m of wf.movements) {
    if (!isActiveMovement(m)) continue;
    if (m.type === "Recrutement") {
      const r = row(m.department);
      r.recrutements += m.fte;
      r.net += m.fte;
    } else if (m.type === "Attrition") {
      const r = row(m.department);
      r.attritions += m.fte;
      r.exits += m.fte;
      r.net -= m.fte;
    } else if (m.type === "Départ forcé") {
      const r = row(m.department);
      r.forcedDepartures += m.fte;
      r.exits += m.fte;
      r.net -= m.fte;
    } else {
      // Transferts : jambes source/cible (ou type enregistré sans destination, M11).
      for (const leg of transferDepartmentLegs(m)) {
        const r = row(leg.department);
        if (leg.direction === "in") {
          r.transfertEntrants += m.fte;
          r.net += m.fte;
        } else {
          r.transfertSortants += m.fte;
          r.net -= m.fte;
        }
        r.transferts += m.fte;
      }
    }
  }
  return Array.from(rows.values()).sort((a, b) => b.exits - a.exits);
}

export function movementsByCountry(
  wf: Workforce
): { country: string; fte: number; count: number }[] {
  const rows = new Map<string, { country: string; fte: number; count: number }>();
  for (const m of wf.movements) {
    if (!isActiveMovement(m)) continue;
    const r = rows.get(m.country) ?? { country: m.country, fte: 0, count: 0 };
    r.fte += m.fte;
    r.count += 1;
    rows.set(m.country, r);
  }
  return Array.from(rows.values()).sort((a, b) => b.fte - a.fte);
}

export type MovementTypeSummary = { type: MovementType; count: number; fte: number };

export function movementsByType(wf: Workforce): MovementTypeSummary[] {
  return MOVEMENT_TYPES.map((type) => {
    const list = wf.movements.filter((m) => isActiveMovement(m) && m.type === type);
    return {
      type,
      count: list.length,
      fte: Math.round(list.reduce((s, m) => s + m.fte, 0) * 10) / 10,
    };
  }).filter((t) => t.count > 0);
}

// ---------- Vues dimensionnelles génériques ----------

export type WorkforceDimension = "department" | "country" | "workstream";

export type FtePositionRow = {
  key: string;
  label: string;
  baseline: number;
  current: number;
  target: number;
  gapToTarget: number;
  progressPct: number;
};

function signedFteForType(type: MovementType, fte: number): number {
  if (type === "Recrutement" || type === "Transfert entrant") return fte;
  if (type === "Attrition" || type === "Départ forcé" || type === "Transfert sortant") return -fte;
  return 0;
}

function movementFteValue(
  movement: WorkforceMovement,
  source: "actual" | "target" | "reforecast"
): number {
  if (source === "actual") return movement.fte;
  if (source === "target") return planMovementFte(movement);
  return movement.reforecast?.fte ?? movement.lockedPlan?.fte ?? movement.fte;
}

/** Contributions dimensionnelles d'un mouvement. Les transferts départementaux sortent du
 * département source et entrent dans le département cible ; pays/workstream utilisent le type
 * explicite entrant/sortant, faute de destination distincte dans le modèle. */
function dimensionalContributions(
  movement: WorkforceMovement,
  dimension: WorkforceDimension,
  source: "actual" | "target" | "reforecast"
): { key: string; delta: number }[] {
  const fte = movementFteValue(movement, source);
  if (dimension === "department") {
    if (movement.type === "Recrutement") return [{ key: movement.department, delta: fte }];
    if (movement.type === "Attrition" || movement.type === "Départ forcé") {
      return [{ key: movement.department, delta: -fte }];
    }
    return transferDepartmentLegs(movement).map((leg) => ({
      key: leg.department,
      delta: leg.direction === "in" ? fte : -fte,
    }));
  }
  const key = dimension === "country" ? movement.country : movement.workstream;
  if (!key) return [];
  return [{ key, delta: signedFteForType(movement.type, fte) }];
}

/** Positions ETP par département, pays ou workstream.
 * - Baseline = référence initiale ;
 * - Actuel = baseline + mouvements réalisés ;
 * - Cible = baseline + plan verrouillé de tous les mouvements ;
 * - Avancement = (actuel - baseline) / (cible - baseline). */
export function ftePositionsByDimension(
  wf: Workforce,
  dimension: WorkforceDimension
): FtePositionRow[] {
  const baselines =
    dimension === "department"
      ? wf.departments.map((d) => ({ key: d.name, label: d.name, fte: d.fte }))
      : dimension === "country"
        ? (wf.countryBaselines ?? [])
        : (wf.workstreamBaselines ?? []);
  const rows = new Map(
    baselines.map((baseline) => [
      baseline.key,
      {
        key: baseline.key,
        label: baseline.label,
        baseline: baseline.fte,
        realizedDelta: 0,
        targetDelta: 0,
      },
    ])
  );
  const ensure = (key: string) => {
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        label: key,
        baseline: 0,
        realizedDelta: 0,
        targetDelta: 0,
      });
    }
    return rows.get(key)!;
  };

  for (const movement of wf.movements) {
    if (!isActiveMovement(movement)) continue;
    for (const contribution of dimensionalContributions(movement, dimension, "target")) {
      ensure(contribution.key).targetDelta += contribution.delta;
    }
    if (movement.status === "Réalisé") {
      for (const contribution of dimensionalContributions(movement, dimension, "actual")) {
        ensure(contribution.key).realizedDelta += contribution.delta;
      }
    }
  }

  return Array.from(rows.values())
    .map((row) => {
      const current = row.baseline + row.realizedDelta;
      const target = row.baseline + row.targetDelta;
      const denominator = target - row.baseline;
      const progressPct = denominator === 0 ? 100 : ((current - row.baseline) / denominator) * 100;
      return {
        key: row.key,
        label: row.label,
        baseline: Math.round(row.baseline * 10) / 10,
        current: Math.round(current * 10) / 10,
        target: Math.round(target * 10) / 10,
        gapToTarget: Math.round((current - target) * 10) / 10,
        progressPct: Math.round(progressPct),
      };
    })
    .sort((a, b) => b.current - a.current);
}

export type MovementBreakdownDimension = "department" | "country" | "program";
export type MovementBreakdownRow = Omit<DepartmentMovements, "department"> & {
  key: string;
  label: string;
  /** Mouvements contribuant à cette ligne (dédupliqués) — alimente le drill-down au clic sur une
   *  barre (`DepartmentMovementsChart` + `MovementDrilldownModal`). Un transfert peut apparaître
   *  dans les deux lignes qu'il traverse (département source ET département cible), à l'image du
   *  reste de l'agrégation ci-dessous. */
  movements: WorkforceMovement[];
  /** Nombre de mouvements derrière chaque série ETP ci-dessus (même classement que les montants,
   *  y compris le double comptage source/cible des transferts en dimension département) —
   *  alimente l'infobulle "N pers. · ±X ETP" de `DepartmentMovementsChart`. */
  counts: MovementBreakdownCounts;
  /** Sens de chaque transfert (par id de mouvement) RELATIVEMENT À CETTE LIGNE — même classement
   *  que les barres "Transferts entrants/sortants" : en dimension département, un transfert est
   *  sortant pour `department` et entrant pour `toDepartment`, quel que soit son type enregistré.
   *  Alimente le « Bilan transferts » du groupe (`movementNetBalance(..., { transferDirection })`). */
  transferDirections: Record<string, TransferDirection>;
};

export type MovementBreakdownSeries =
  "recrutements" | "attritions" | "forcedDepartures" | "transfertEntrants" | "transfertSortants";
export type MovementBreakdownCounts = Record<MovementBreakdownSeries, number>;

/** Ventilation PRÉVUE des cinq types de mouvements par département, pays ou programme — vue
 *  PLAN : ETP = `lockedPlan.fte ?? fte` (règle M10, identique au bilan net des infobulles et au
 *  rythme des mouvements). Transferts en dimension département : `transferDepartmentLegs`. */
export function movementBreakdownByDimension(
  movements: WorkforceMovement[],
  dimension: MovementBreakdownDimension,
  programLabels: Record<string, string> = {}
): MovementBreakdownRow[] {
  const rows = new Map<string, MovementBreakdownRow>();
  const ensure = (key: string) => {
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        label: key,
        recrutements: 0,
        attritions: 0,
        forcedDepartures: 0,
        transfertEntrants: 0,
        transfertSortants: 0,
        exits: 0,
        transferts: 0,
        net: 0,
        movements: [],
        counts: {
          recrutements: 0,
          attritions: 0,
          forcedDepartures: 0,
          transfertEntrants: 0,
          transfertSortants: 0,
        },
        transferDirections: {},
      });
    }
    return rows.get(key)!;
  };
  const add = (
    row: MovementBreakdownRow,
    series: MovementBreakdownSeries,
    fte: number,
    movementId?: string
  ) => {
    row[series] += fte;
    row.counts[series] += 1;
    if (movementId && series === "transfertEntrants") row.transferDirections[movementId] = "in";
    if (movementId && series === "transfertSortants") row.transferDirections[movementId] = "out";
  };
  for (const movement of movements) {
    if (!isActiveMovement(movement)) continue;
    const fte = planMovementFte(movement);
    if (dimension === "country" || dimension === "program") {
      const rawKey = dimension === "country" ? movement.country : movement.programId;
      const key = rawKey
        ? dimension === "program"
          ? (programLabels[rawKey] ?? rawKey)
          : rawKey
        : "Non renseigné";
      const row = ensure(key);
      if (movement.type === "Recrutement") add(row, "recrutements", fte);
      if (movement.type === "Attrition") add(row, "attritions", fte);
      if (movement.type === "Départ forcé") add(row, "forcedDepartures", fte);
      if (movement.type === "Transfert entrant") add(row, "transfertEntrants", fte, movement.id);
      if (movement.type === "Transfert sortant") add(row, "transfertSortants", fte, movement.id);
      row.movements.push(movement);
    } else {
      const source = ensure(movement.department);
      if (movement.type === "Recrutement") add(source, "recrutements", fte);
      if (movement.type === "Attrition") add(source, "attritions", fte);
      if (movement.type === "Départ forcé") add(source, "forcedDepartures", fte);
      for (const leg of transferDepartmentLegs(movement)) {
        const row = ensure(leg.department);
        add(
          row,
          leg.direction === "in" ? "transfertEntrants" : "transfertSortants",
          fte,
          movement.id
        );
        if (row !== source) row.movements.push(movement);
      }
      source.movements.push(movement);
    }
  }
  return Array.from(rows.values()).map((row) => {
    row.exits = row.attritions + row.forcedDepartures;
    row.transferts = row.transfertEntrants + row.transfertSortants;
    row.net =
      row.recrutements +
      row.transfertEntrants -
      row.attritions -
      row.forcedDepartures -
      row.transfertSortants;
    return row;
  });
}

export type MovementRealizationDimension = "function" | "country";
export type MovementRealizationRow = {
  key: string;
  label: string;
  realized: number;
  remaining: number;
  target: number;
};

/** Réalisé vs reste à faire en ETP, groupé par fonction ou pays et filtrable par type. */
export function movementRealizationByDimension(
  movements: WorkforceMovement[],
  dimension: MovementRealizationDimension,
  movementType?: MovementType
): MovementRealizationRow[] {
  const rows = new Map<string, MovementRealizationRow>();
  for (const movement of movements) {
    if (!isActiveMovement(movement)) continue;
    if (movementType && movement.type !== movementType) continue;
    const key = dimension === "function" ? movement.function : movement.country;
    if (!key) continue;
    const row = rows.get(key) ?? { key, label: key, realized: 0, remaining: 0, target: 0 };
    row.target += planMovementFte(movement);
    if (movement.status === "Réalisé") row.realized += movement.fte;
    rows.set(key, row);
  }
  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      realized: Math.round(row.realized * 10) / 10,
      // Le widget doit recomposer exactement la cible : Réalisé + Reste à faire = Cible.
      remaining: Math.round(Math.max(0, row.target - row.realized) * 10) / 10,
      target: Math.round(row.target * 10) / 10,
    }))
    .sort((a, b) => b.target - a.target);
}

// ---------- Masse salariale ----------

export type SalaryBridgeBucket = {
  /** Clé stable de la période (voir `FteBridgeBucket.key`). */
  key: string;
  label: string;
  startISO: string;
  endISO: string;
  delta: number;
  cumulative: number;
};

/** Impact cumulé des mouvements sur la masse salariale annuelle (€M) — part de la masse
 * d'OUVERTURE de la plage (`salaryOpening` : baseline + réalisés avant `from`, M2), chaque bucket
 * ajoute les salaryImpact des mouvements planifiés dessus. */
export function salaryBridge(
  wf: Workforce,
  granularity: BridgeGranularity,
  range?: DateRange,
  options: HrSeriesOptions = {}
): SalaryBridgeBucket[] {
  const fte = fteBridge(wf, granularity, range, options);
  let running = salaryOpening(wf, range);
  return fte.map((b) => {
    const deltaM = b.movements.reduce((s, m) => s + m.salaryImpact, 0) / 1_000_000;
    running += deltaM;
    return {
      key: b.key,
      label: b.label,
      startISO: b.startISO,
      endISO: b.endISO,
      delta: Math.round(deltaM * 100) / 100,
      cumulative: Math.round(running * 100) / 100,
    };
  });
}

/** Économies salariales annualisées des seuls mouvements réalisés (€). */
export function realizedSalarySavings(wf: Workforce): number {
  return wf.movements
    .filter((m) => isActiveMovement(m) && m.status === "Réalisé")
    .reduce((s, m) => s + Math.max(0, -m.salaryImpact), 0);
}

// ---------- PSE ----------

export type PseSummary = {
  postes: number; // ETP concernés
  enCours: number;
  realises: number;
  valides: number;
  coutTotal: number; // € provision (tous les coûts one-off des mouvements PSE)
  coutEngage: number; // € coûts des mouvements réalisés
};

export function pseSummary(wf: Workforce): PseSummary {
  const pse = wf.movements.filter((m) => isActiveMovement(m) && m.inPSE);
  return {
    postes: Math.round(pse.reduce((s, m) => s + m.fte, 0) * 10) / 10,
    enCours: pse.filter((m) => m.status === "À faire" || m.status === "Planifié").length,
    realises: pse.filter((m) => m.status === "Réalisé").length,
    valides: pse.filter((m) => m.hrValidated).length,
    coutTotal: pse.reduce((s, m) => s + m.cost, 0),
    coutEngage: pse.filter((m) => m.status === "Réalisé").reduce((s, m) => s + m.cost, 0),
  };
}

// ---------- Départements : actuel / cible / atterrissage ----------

export type DepartmentDelta = {
  name: string;
  fte: number;
  fteTarget: number;
  landing: number; // atterrissage si tous les mouvements se réalisent
  gapToTarget: number; // atterrissage − cible (positif = il restera du chemin)
};

export function deltaByDepartment(wf: Workforce): DepartmentDelta[] {
  return wf.departments.map((d) => {
    const delta = wf.movements
      .filter((m) => isActiveMovement(m) && (m.department === d.name || m.toDepartment === d.name))
      .reduce((s, m) => {
        if ((m.type === "Attrition" || m.type === "Départ forcé") && m.department === d.name) {
          return s - m.fte;
        }
        if (m.type === "Recrutement" && m.department === d.name) {
          return s + m.fte;
        }
        for (const leg of transferDepartmentLegs(m)) {
          if (leg.department === d.name) s += leg.direction === "in" ? m.fte : -m.fte;
        }
        return s;
      }, 0);
    const landing = Math.round((d.fte + delta) * 10) / 10;
    return {
      name: d.name,
      fte: d.fte,
      fteTarget: d.fteTarget,
      landing,
      gapToTarget: Math.round((landing - d.fteTarget) * 10) / 10,
    };
  });
}

// ---------- Alertes de réconciliation RH ↔ leviers ----------

export type MovementAlertKind = "overdue" | "due" | "toValidate" | "leverMismatch";

/** Détail STRUCTURÉ d'une alerte (en plus du `message` FR prêt à afficher) — permet à l'UI
 *  (ex. `components/shared/MovementAlertsSummaryModal.tsx`) de présenter les valeurs comparées
 *  (jours de retard, date de fin du levier, sens ETP…) et de les traduire sans reparser le texte. */
export type MovementAlertDetail =
  | { reason: "toValidate"; actualDate: string }
  | { reason: "overdue"; daysLate: number }
  | { reason: "due"; daysLeft: number }
  | { reason: "leverCancelled"; leverCode: string; leverName: string }
  | {
      reason: "afterLeverEnd";
      leverCode: string;
      leverName: string;
      leverEnd: string;
      plannedDate: string;
    }
  | {
      reason: "signMismatch";
      leverCode: string;
      leverName: string;
      movementFte: number;
      leverFte: number;
    };

export type MovementAlert = {
  movement: WorkforceMovement;
  kind: MovementAlertKind;
  message: string;
  detail?: MovementAlertDetail;
};

const DUE_WINDOW_DAYS = 7;

/** Ids DISTINCTS des mouvements en alerte (optionnellement pour certaines catégories) — un même
 *  mouvement peut porter plusieurs alertes (ex. en retard ET désynchronisé) : les compteurs du
 *  dashboard et le lien vers la Base ETP comptent/portent des MOUVEMENTS, pas des alertes (M4). */
export function alertedMovementIds(
  alerts: MovementAlert[],
  kinds?: MovementAlertKind | MovementAlertKind[] | null
): string[] {
  const wanted = kinds == null ? null : new Set(Array.isArray(kinds) ? kinds : [kinds]);
  const ids = new Set<string>();
  for (const a of alerts) if (!wanted || wanted.has(a.kind)) ids.add(a.movement.id);
  return Array.from(ids);
}

/** Ordre de GRAVITÉ des catégories d'alerte, de la plus grave à la moins grave. Sert à ranger
 *  chaque mouvement dans UNE seule catégorie « principale » (sa plus grave), pour que la
 *  répartition du dashboard somme exactement au nombre de mouvements en alerte :
 *  désynchronisé levier (donnée incohérente avec le plan) > en retard > à valider > échéance proche. */
export const ALERT_KIND_SEVERITY: readonly MovementAlertKind[] = [
  "leverMismatch",
  "overdue",
  "toValidate",
  "due",
];

/** Catégorie principale (la plus grave, cf. `ALERT_KIND_SEVERITY`) de chaque mouvement en alerte. */
export function primaryAlertKindByMovement(
  alerts: MovementAlert[]
): Map<string, MovementAlertKind> {
  const rank = (k: MovementAlertKind) => ALERT_KIND_SEVERITY.indexOf(k);
  const map = new Map<string, MovementAlertKind>();
  for (const a of alerts) {
    const cur = map.get(a.movement.id);
    if (cur === undefined || rank(a.kind) < rank(cur)) map.set(a.movement.id, a.kind);
  }
  return map;
}

/** Répartition des mouvements en alerte par catégorie PRINCIPALE (un mouvement = une catégorie) :
 *  `total` = nombre de mouvements distincts (= `alertedMovementIds(alerts).length`) et la somme des
 *  `parts[].count` vaut exactement `total`. `parts` est trié par gravité, catégories vides exclues. */
export function alertPrimaryBreakdown(alerts: MovementAlert[]): {
  total: number;
  parts: { kind: MovementAlertKind; count: number }[];
} {
  const primary = primaryAlertKindByMovement(alerts);
  const counts = new Map<MovementAlertKind, number>();
  for (const k of Array.from(primary.values())) counts.set(k, (counts.get(k) ?? 0) + 1);
  return {
    total: primary.size,
    parts: ALERT_KIND_SEVERITY.filter((k) => counts.has(k)).map((kind) => ({
      kind,
      count: counts.get(kind) ?? 0,
    })),
  };
}

export function movementAlerts(
  wf: Workforce,
  levers: Lever[],
  today: string = hrToday()
): MovementAlert[] {
  const alerts: MovementAlert[] = [];

  for (const m of wf.movements) {
    if (!isActiveMovement(m)) continue;
    if (m.status === "Réalisé" && !m.hrValidated) {
      alerts.push({
        movement: m,
        kind: "toValidate",
        message: `${m.label} — réalisé le ${m.actualDate ?? m.plannedDate}, en attente de validation RH`,
        detail: { reason: "toValidate", actualDate: m.actualDate ?? m.plannedDate },
      });
      // Pas de `continue` (m1) : le contrôle de sens vs levier ci-dessous s'applique aussi aux
      // mouvements réalisés en attente de validation (les contrôles de date/levier annulé restent
      // réservés aux mouvements non réalisés).
    }

    if (m.status !== "Réalisé") {
      const days = daysBetween(today, m.plannedDate);
      if (days < 0) {
        alerts.push({
          movement: m,
          kind: "overdue",
          message: `${m.label} — échéance dépassée de ${-days} j (prévu le ${m.plannedDate})`,
          detail: { reason: "overdue", daysLate: -days },
        });
      } else if (days <= DUE_WINDOW_DAYS) {
        alerts.push({
          movement: m,
          kind: "due",
          message: `${m.label} — échéance dans ${days} j (${m.plannedDate})`,
          detail: { reason: "due", daysLeft: days },
        });
      }
    }

    const lever = levers.find((l) => l.id === m.leverId);
    if (lever && m.status !== "Réalisé") {
      if (lever.status === "cancelled") {
        alerts.push({
          movement: m,
          kind: "leverMismatch",
          message: `${m.label} — le levier ${lever.code} est annulé, mouvement à requalifier`,
          detail: { reason: "leverCancelled", leverCode: lever.code, leverName: lever.name },
        });
      } else if (lever.end < m.plannedDate && STATUS_ORDER[lever.status] < STATUS_ORDER.delivered) {
        alerts.push({
          movement: m,
          kind: "leverMismatch",
          message: `${m.label} — planifié le ${m.plannedDate}, après la fin du levier ${lever.code} (${lever.end})`,
          detail: {
            reason: "afterLeverEnd",
            leverCode: lever.code,
            leverName: lever.name,
            leverEnd: lever.end,
            plannedDate: m.plannedDate,
          },
        });
      }
    }

    // Garde-fou montant/signe (au-delà des dates/statuts ci-dessus) : un mouvement dont le sens
    // (fteEffect — Recrutement = positif, Attrition/Départ forcé = négatif ; les transferts sont
    // neutres, fteEffect = 0, et ne sont donc jamais signalés ici) contredit le sens global de
    // l'ETP visé par son levier — ex. un
    // recrutement rattaché à un levier de réduction d'effectif, constaté sur l'audit ACME/ICES
    // (ORG-001, AC-030). S'applique que le mouvement soit déjà réalisé ou non : un mouvement
    // réalisé au sens contraire est tout aussi suspect, sinon plus.
    if (lever && lever.fteImpact !== 0) {
      const effect = fteEffect(m);
      if (effect !== 0 && Math.sign(effect) !== Math.sign(lever.fteImpact)) {
        alerts.push({
          movement: m,
          kind: "leverMismatch",
          message: `${m.label} — sens (${effect > 0 ? "+" : ""}${effect} ETP) contraire à l'impact visé du levier ${lever.code} (${lever.fteImpact > 0 ? "+" : ""}${lever.fteImpact} ETP)`,
          detail: {
            reason: "signMismatch",
            leverCode: lever.code,
            leverName: lever.name,
            movementFte: effect,
            leverFte: lever.fteImpact,
          },
        });
      }
    }
  }

  const KIND_PRIORITY: Record<MovementAlertKind, number> = {
    overdue: 0,
    leverMismatch: 1,
    toValidate: 2,
    due: 3,
  };
  return alerts.sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
}
