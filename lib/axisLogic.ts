import { rollupBudgets } from "@/lib/budgetRollup";
import { daysBetween, todayISO } from "@/lib/dateUtils";
import { effectiveDueDate } from "@/lib/deliverableState";
import { comparePeriods, periodIsAfter, periodStartsOnOrBefore } from "@/lib/indicatorPeriod";
import { MILESTONE_CHECKLISTS, MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import {
  getStrategicProfiles,
  hasAnyRole,
  hasRole,
  isAnyAdmin,
  isStrategicRole,
} from "@/lib/roleProfiles";
import type {
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierDependencyType,
  ChantierMilestoneState,
  ChantierStaffing,
  Deliverable,
  Indicator,
  IndicatorMeasurement,
  IndicatorRiskStatus,
  MaturityStageConfig,
  MilestoneChecklistItem,
  MilestoneCustomAction,
  MilestoneId,
  ProfileAssignment,
  Program,
  ProgramType,
  Role,
  StrategicAxis,
} from "@/types";

/**
 * Logique métier PURE du périmètre "Plan Stratégique" (axes / chantiers / indicateurs) — aucun
 * I/O, aucun accès Firestore, aucun état React. Pendant stratégique de `lib/leversLogic.ts` +
 * `lib/engine.ts` côté Plan Performance, volontairement dupliqué plutôt que généricisé : les deux
 * domaines n'ont ni les mêmes entités ni la même sémantique (pas de notion financière ici).
 */

/** Type effectif d'un programme — un programme créé avant l'introduction du Plan Stratégique n'a
 *  pas de `type` et doit être traité comme un Plan Performance. Seul point de vérité pour cette
 *  résolution : ne jamais tester `program.type === "performance"` directement. */
export function resolveProgramType(program: Pick<Program, "type"> | null | undefined): ProgramType {
  return program?.type ?? "performance";
}

// ─── Mesures d'indicateurs ─────────────────────────────────────────────────────────────────────

/**
 * Ordre chronologique TOTAL de deux mesures (négatif si `a` avant `b`) — seul point de vérité pour
 * départager les mesures, partagé par `latestMeasurement`, `sortMeasurementsByPeriod`, le graphique
 * et l'historique : période d'abord (`comparePeriods`, robuste aux formats mélangés), puis, à
 * période ÉGALE, horodatage de saisie `reportedAt` (la plus récemment saisie est la plus "tardive"
 * — elle gagne partout, jamais la première rencontrée dans l'ordre arbitraire de Firestore).
 */
export function compareMeasurements(
  a: { period: string; reportedAt?: string },
  b: { period: string; reportedAt?: string }
): number {
  const byPeriod = comparePeriods(a.period, b.period);
  if (byPeriod !== 0) return byPeriod;
  return (a.reportedAt ?? "").localeCompare(b.reportedAt ?? "");
}

/** Dernière mesure connue d'un indicateur (période la plus récente, voir `compareMeasurements` ;
 *  à période égale, la plus récemment saisie), ou `undefined` si jamais mesuré. Peut être une
 *  mesure SANS valeur (commentaire seul) — pour un statut/avancement, voir
 *  `latestNumericMeasurement`. */
export function latestMeasurement(
  indicatorId: string,
  measurements: IndicatorMeasurement[]
): IndicatorMeasurement | undefined {
  let latest: IndicatorMeasurement | undefined;
  for (const m of measurements) {
    if (m.indicatorId !== indicatorId) continue;
    if (!latest || compareMeasurements(m, latest) > 0) latest = m;
  }
  return latest;
}

/** Dernière mesure NUMÉRIQUE d'un indicateur (même ordre que `latestMeasurement`) — un
 *  commentaire seul saisi après une valeur ne doit pas masquer cette valeur pour le statut,
 *  l'avancement ou la « dernière valeur » chiffrée. */
export function latestNumericMeasurement(
  indicatorId: string,
  measurements: IndicatorMeasurement[]
): IndicatorMeasurement | undefined {
  let latest: IndicatorMeasurement | undefined;
  for (const m of measurements) {
    if (m.indicatorId !== indicatorId || m.value === undefined) continue;
    if (!latest || compareMeasurements(m, latest) > 0) latest = m;
  }
  return latest;
}

/** Copie triée chronologiquement des mesures (`compareMeasurements` : période, puis `reportedAt`).
 *  Ne mute jamais l'entrée : les mesures arrivent dans l'ordre arbitraire de Firestore et sont
 *  partagées entre plusieurs composants. */
export function sortMeasurementsByPeriod<T extends { period: string; reportedAt?: string }>(
  measurements: T[]
): T[] {
  return [...measurements].sort(compareMeasurements);
}

/** Une mesure par période : à période égale, seule la plus récemment saisie est conservée (même
 *  règle que `latestMeasurement`). Sortie triée chronologiquement. Sert aux vues qui tracent UN
 *  point par période (graphique). */
export function dedupeMeasurementsByPeriod<T extends { period: string; reportedAt?: string }>(
  measurements: T[]
): T[] {
  const sorted = sortMeasurementsByPeriod(measurements);
  const out: T[] = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && comparePeriods(last.period, m.period) === 0) out[out.length - 1] = m;
    else out.push(m);
  }
  return out;
}

/**
 * Nombre de points affichés dans la vue « récente » d'un graphique d'indicateur, par fréquence de
 * reporting.
 *
 * Le PO veut un aperçu par défaut sur « la dernière année / le dernier semestre », et l'historique
 * complet seulement à la demande. On raisonne en NOMBRE DE POINTS et non en date glissante
 * calculée depuis `new Date()` : les périodes sont des chaînes de formats hétérogènes
 * (`"2026-03"`, `"2026-Q1"`, `"2026-S1"`, `"2026"`) qu'il faudrait parser différemment selon la
 * fréquence, et un plan saisi en retard (ou une démo datée) afficherait alors un graphique vide
 * alors qu'il a de l'historique. Le nombre de points est calibré pour couvrir ~12 mois là où c'est
 * possible, et à défaut les 3 dernières périodes (annuel / semestriel, où 12 mois ne feraient
 * qu'un ou deux points — trop peu pour lire une tendance).
 */
export const RECENT_MEASUREMENT_POINTS: Record<Indicator["frequency"], number> = {
  monthly: 12,
  quarterly: 4,
  semiannual: 3,
  annual: 3,
};

/** Taille de fenêtre appliquée quand la fréquence de l'indicateur n'est pas connue de l'appelant
 *  (12 points = l'hypothèse la plus fréquente, un indicateur mensuel sur un an). */
export const DEFAULT_RECENT_MEASUREMENT_POINTS = 12;

/**
 * Découpe l'historique d'un indicateur en une fenêtre d'affichage « récente » + le reste.
 *
 * Retourne `all` (tout l'historique trié, pour la vue « historique complet »), `visible` (la
 * fenêtre récente) et `hidden` (le nombre de mesures antérieures masquées — un appelant s'en sert
 * pour n'afficher le bouton d'agrandissement QUE s'il y a effectivement quelque chose de plus à
 * voir).
 */
export function recentMeasurementWindow<T extends { period: string; reportedAt?: string }>(
  measurements: T[],
  frequency?: Indicator["frequency"]
): { all: T[]; visible: T[]; hidden: number } {
  const all = sortMeasurementsByPeriod(measurements);
  const size = frequency ? RECENT_MEASUREMENT_POINTS[frequency] : DEFAULT_RECENT_MEASUREMENT_POINTS;
  const visible = all.length > size ? all.slice(all.length - size) : all;
  return { all, visible, hidden: all.length - visible.length };
}

/** Le résultat est-il FAVORABLE vis-à-vis de la cible, selon le sens attendu ? */
function meetsTarget(value: number, target: number, direction: Indicator["direction"]): boolean {
  return direction === "down" ? value <= target : value >= target;
}

/**
 * Statut de risque CALCULÉ d'un indicateur, à partir de sa dernière mesure NUMÉRIQUE
 * (`latestNumericMeasurement` — un commentaire seul saisi ensuite ne masque pas la valeur)
 * comparée à la cible applicable à sa période. Volontairement binaire et sans bande de tolérance.
 *
 * Retourne "on_track" — jamais "at_risk" — dès qu'il n'y a rien à comparer :
 *   - aucune mesure numérique enregistrée ;
 *   - indicateur qualitatif (pas de valeur à comparer) ;
 *   - pas de cible applicable.
 * Un indicateur non renseigné n'est PAS un indicateur en retard. Pour DISTINGUER « rien à
 * comparer » de « dans les clous » (compteurs de tête de page), voir `indicatorReadingState`.
 */
export function computeIndicatorStatus(
  indicator: Pick<Indicator, "id" | "kind" | "objectiveValue" | "direction" | "targetSchedule">,
  measurements: IndicatorMeasurement[]
): IndicatorRiskStatus {
  return indicatorReadingState(indicator, measurements) === "at_risk" ? "at_risk" : "on_track";
}

/** État de lecture à trois valeurs d'un indicateur : `"no_data"` quand rien n'est comparable
 *  (qualitatif, jamais mesuré numériquement, ou sans cible applicable) — à compter À PART
 *  (« Sans donnée ») plutôt que comme « sur la trajectoire ». */
export type IndicatorReadingState = IndicatorRiskStatus | "no_data";

export function indicatorReadingState(
  indicator: Pick<Indicator, "id" | "kind" | "objectiveValue" | "direction" | "targetSchedule">,
  measurements: IndicatorMeasurement[]
): IndicatorReadingState {
  if (indicator.kind === "qualitative") return "no_data";
  const latest = latestNumericMeasurement(indicator.id, measurements);
  if (!latest || latest.value === undefined) return "no_data";
  // Round "cible évolutive" : compare à la cible APPLICABLE à la période de cette mesure.
  const target = resolveIndicatorTargetForPeriod(indicator, latest.period);
  if (target === undefined) return "no_data";
  return meetsTarget(latest.value, target, indicator.direction) ? "on_track" : "at_risk";
}

/**
 * Cible APPLICABLE d'un indicateur pour une PÉRIODE donnée (round "cible évolutive") — pour un
 * indicateur à cible FIXE (`targetSchedule` absent/vide), toujours `objectiveValue`. Pour un
 * indicateur à cible ÉVOLUTIVE, le dernier palier DÉJÀ EN VIGUEUR à cette période (palier qui
 * commence au plus tard au début de la période, voir `periodStartsOnOrBefore` — robuste aux
 * formats mélangés, ex. paliers trimestriels sur un KPI mensuel) ; au-delà du dernier palier, la
 * cible finale `objectiveValue` — ou, à défaut de cible finale, le DERNIER palier (jamais
 * `undefined` pour un KPI qui a une trajectoire) ; avant le premier palier, `objectiveValue`.
 */
export function resolveIndicatorTargetForPeriod(
  indicator: Pick<Indicator, "objectiveValue" | "targetSchedule">,
  period: string
): number | undefined {
  return resolveIndicatorTargetStepForPeriod(indicator, period)?.value;
}

/** Même résolution que `resolveIndicatorTargetForPeriod`, mais renvoie aussi la PÉRIODE du palier
 *  retenu (`period` absent = cible finale `objectiveValue`, cible fixe ou repli hors trajectoire) —
 *  pour l'affichage "Palier 2026-Q2 : 80% (cible 70)". */
export function resolveIndicatorTargetStepForPeriod(
  indicator: Pick<Indicator, "objectiveValue" | "targetSchedule">,
  period: string
): { value: number; period?: string } | undefined {
  const schedule = indicator.targetSchedule;
  const final =
    indicator.objectiveValue !== undefined ? { value: indicator.objectiveValue } : undefined;
  if (!schedule || schedule.length === 0) return final;
  const sorted = [...schedule].sort((a, b) => comparePeriods(a.period, b.period));
  const last = sorted[sorted.length - 1];
  if (periodIsAfter(period, last.period)) {
    return final ?? { value: last.value, period: last.period };
  }
  let applicable: { value: number; period: string } | undefined;
  for (const step of sorted) {
    if (periodStartsOnOrBefore(step.period, period)) {
      applicable = { value: step.value, period: step.period };
    } else break;
  }
  return applicable ?? final;
}

/** Mesure de BASELINE ("Valeur initiale") d'un indicateur : sa mesure NUMÉRIQUE de la période la
 *  plus ancienne (`comparePeriods`) ; à période égale, la plus RÉCEMMENT saisie (même règle que
 *  `latestMeasurement` : une nouvelle saisie sur une période remplace l'ancienne partout). Aucun
 *  drapeau dédié n'existe sur `IndicatorMeasurement` : l'import Excel crée simplement une
 *  première mesure, c'est la convention "première mesure = situation initiale" qui fait foi. */
export function baselineMeasurement(
  indicatorId: string,
  measurements: IndicatorMeasurement[]
): IndicatorMeasurement | undefined {
  let first: IndicatorMeasurement | undefined;
  for (const m of measurements) {
    if (m.indicatorId !== indicatorId || m.value === undefined) continue;
    if (!first) {
      first = m;
      continue;
    }
    const byPeriod = comparePeriods(m.period, first.period);
    if (byPeriod < 0 || (byPeriod === 0 && m.reportedAt > first.reportedAt)) first = m;
  }
  return first;
}

/** Statut EFFECTIF d'un indicateur = son statut calculé (`Indicator.status`, maintenu par
 *  `computeIndicatorStatus` à chaque saisie). `Indicator.statusOverride` n'est plus lu : aucun
 *  écran ne permet de le poser (champ mort, conservé dans le type pour compat des documents
 *  existants) — le lire aurait figé silencieusement un statut qu'aucun utilisateur ne peut voir ni
 *  corriger. Seul point de vérité pour l'affichage — ne jamais lire `indicator.status` nu. */
export function resolveIndicatorStatus(indicator: Pick<Indicator, "status">): IndicatorRiskStatus {
  return indicator.status;
}

/** Écart signé d'un indicateur par rapport à sa cible, dérivé de sa dernière mesure — pendant
 *  du binaire `computeIndicatorStatus` mais avec une AMPLITUDE plutôt qu'un simple booléen, pour
 *  l'affichage "82% vs cible 80%" (round 4, point 1 : rendre l'écart visuellement lisible).
 *
 *  AVANCEMENT (règle validée PO) — mesuré depuis la situation INITIALE (baseline, voir
 *  `baselineMeasurement`) et non plus depuis zéro :
 *
 *      avancement = (valeur actuelle − valeur initiale) / (cible − valeur initiale) × 100
 *
 *  La formule couvre naturellement les deux sens : pour "down", cible < initiale, numérateur et
 *  dénominateur sont tous deux négatifs quand l'indicateur s'améliore. Calculée DEUX fois : vers la
 *  cible du PALIER courant (`progressToStepPct`, contexte du statut) et vers la cible FINALE
 *  (`progressToFinalPct`, chiffre principal affiché comme "avancement").
 *
 *  Repli APPROXIMATIF (`approximate`/`stepApproximate` = true) quand la formule n'est pas
 *  applicable — pas de baseline connue, ou baseline qui atteint DÉJÀ la cible (égale, ou au-delà
 *  dans le sens d'amélioration) : on revient à l'ancien ratio (`valeur / cible` pour "up",
 *  `cible / valeur` pour "down"). Une cible atteinte donne donc toujours ≥ 100%.
 *  Une seule mesure qui EST la baseline (sous la cible) donne un avancement exact de 0.
 *
 *  Bornes : les champs `progress*Pct` sont PLANCHÉS à 0 (un recul sous la situation initiale
 *  s'affiche 0%) mais JAMAIS plafonnés à 100 (un dépassement s'affiche p. ex. 112%) ; les valeurs
 *  brutes, non bornées (négatives comprises), restent disponibles dans `rawProgress*Pct`. Les
 *  anneaux/barres visuels plafonnent eux-mêmes leur remplissage à 100%. */
export type IndicatorDelta = {
  /** `latest.value - cible du palier courant`, signé (positif = au-dessus de la cible). */
  delta: number;
  /** `delta / cible du palier * 100`, signé ; 0 si cette cible vaut 0 (évite une division par
   *  zéro plutôt que de produire `Infinity`/`NaN`). */
  deltaPct: number;
  /** Rétrocompatibilité : alias de `progressToFinalPct` (avancement vers la cible FINALE). */
  progressPct: number;
  /** Avancement vers la cible finale (`objectiveValue`), plancher 0, sans plafond. */
  progressToFinalPct: number;
  /** Idem, brut (non borné, peut être négatif). */
  rawProgressToFinalPct: number;
  /** Avancement vers la cible du palier courant, plancher 0, sans plafond. */
  progressToStepPct: number;
  /** Idem, brut (non borné, peut être négatif). */
  rawProgressToStepPct: number;
  /** Cible du palier applicable à la période de la dernière mesure (= `finalTarget` pour une cible
   *  fixe, ou hors trajectoire). */
  stepTarget: number;
  /** Période du palier retenu ; `undefined` quand `stepTarget` est la cible finale. */
  stepPeriod?: string;
  /** Cible finale (`objectiveValue`, repli sur `stepTarget` si absente). */
  finalTarget: number;
  /** Valeur initiale (baseline) utilisée, `undefined` si inconnue. */
  baseline?: number;
  /** `true` si `progressToFinalPct` provient du repli ratio (pas de baseline exploitable). */
  approximate: boolean;
  /** Idem pour `progressToStepPct`. */
  stepApproximate: boolean;
  /** `true` si l'écart va dans le bon sens vs le PALIER — même convention de signe que
   *  `computeIndicatorStatus` ("down" : `delta <= 0` est favorable ; sinon `delta >= 0`). */
  favorable: boolean;
};

/** Ancien ratio d'avancement (repli sans baseline) : `valeur / cible` ("up") ou `cible / valeur`
 *  ("down", cadrage inversé), gardé non borné — cohérent avec le SIGNE de la cible (voir corps) et
 *  toujours ≥ 100 dès que la cible est atteinte. */
function ratioProgress(value: number, target: number, isDown: boolean): number {
  const meets = meetsTarget(value, target, isDown ? "down" : "up");
  if (target === 0) return meets ? 100 : 0;
  // Le ratio se calcule sur les MAGNITUDES : pour une cible négative, "up" (ex. résultat de -10
  // vers -5) revient à RÉDUIRE la magnitude, donc au cadrage inversé `cible / valeur` — l'ancien
  // `valeur / cible` donnait 200% pour -10 vs -5, alors que la cible n'est pas atteinte.
  const magnitudeUp = target > 0 !== isDown;
  const v = Math.abs(value);
  const t = Math.abs(target);
  let raw = magnitudeUp ? (v / t) * 100 : v !== 0 ? (t / v) * 100 : 100;
  if (value !== 0 && Math.sign(value) !== Math.sign(target)) {
    // Valeur du signe opposé à la cible : soit largement au-delà (cible atteinte), soit à
    // l'opposé (aucun avancement) — jamais un ratio de magnitudes trompeur.
    raw = meets ? Math.max(raw, 100) : 0;
  } else if (meets) {
    raw = Math.max(raw, 100);
  }
  return raw;
}

/** Avancement depuis la baseline vers `target` — voir le doc-comment de `IndicatorDelta`. */
function progressFromBaseline(
  value: number,
  target: number,
  baseline: number | undefined,
  isDown: boolean
): { raw: number; approximate: boolean } {
  // Baseline exploitable UNIQUEMENT si elle est du "mauvais" côté de la cible (en dessous pour
  // "up", au-dessus pour "down") : une baseline égale à la cible, ou qui l'atteignait déjà (ex.
  // 82% initial pour une cible de 80%, ou mesure unique qui EST la baseline), rendrait la formule
  // absurde (0% ou négatif alors que la cible est dépassée) → repli ratio, qui donne bien ≥ 100%
  // dès que la cible est atteinte.
  const baselineUsable = baseline !== undefined && (isDown ? baseline > target : baseline < target);
  if (!baselineUsable) {
    return { raw: ratioProgress(value, target, isDown), approximate: true };
  }
  return { raw: ((value - baseline) / (target - baseline)) * 100, approximate: false };
}

/** `undefined` avec les MÊMES garde-fous que `computeIndicatorStatus` : pas d'objectif chiffré, ou
 *  pas de mesure exploitable (absente ou sans valeur numérique) — rien à afficher plutôt qu'un
 *  écart inventé.
 *
 *  `history` : mesures de l'indicateur (tout l'historique, filtré sur `latest.indicatorId`) d'où
 *  est extraite la baseline (`baselineMeasurement`). Absent = pas de baseline → avancement
 *  approximatif (repli ratio). */
export function computeIndicatorDelta(
  indicator: Pick<Indicator, "objectiveValue" | "direction" | "targetSchedule">,
  latest: IndicatorMeasurement | undefined,
  history?: IndicatorMeasurement[]
): IndicatorDelta | undefined {
  if (!latest || latest.value === undefined) return undefined;
  // Round "cible évolutive" : écart à la cible du PALIER courant (période de la mesure), pas
  // toujours la cible finale — voir `resolveIndicatorTargetForPeriod`.
  const step = resolveIndicatorTargetStepForPeriod(indicator, latest.period);
  if (step === undefined) return undefined;
  const objective = step.value;
  const finalTarget = indicator.objectiveValue ?? objective;

  const value = latest.value;
  const isDown = indicator.direction === "down";

  const delta = value - objective;
  const deltaPct = objective !== 0 ? (delta / objective) * 100 : 0;
  const favorable = isDown ? delta <= 0 : delta >= 0;

  const baseline = history
    ? baselineMeasurement(latest.indicatorId, [...history, latest])?.value
    : undefined;

  const toStep = progressFromBaseline(value, objective, baseline, isDown);
  const toFinal = progressFromBaseline(value, finalTarget, baseline, isDown);
  const progressToFinalPct = Math.max(0, toFinal.raw);

  return {
    delta,
    deltaPct,
    progressPct: progressToFinalPct,
    progressToFinalPct,
    rawProgressToFinalPct: toFinal.raw,
    progressToStepPct: Math.max(0, toStep.raw),
    rawProgressToStepPct: toStep.raw,
    stepTarget: objective,
    stepPeriod: step.period,
    finalTarget,
    baseline,
    approximate: toFinal.approximate,
    stepApproximate: toStep.approximate,
    favorable,
  };
}

/** Libellé d'un avancement d'indicateur : arrondi, suffixe "%", préfixe "≈" si approximatif (repli
 *  sans baseline, voir `IndicatorDelta.approximate`). */
export function formatIndicatorProgress(pct: number, approximate = false): string {
  return `${approximate ? "≈" : ""}${Math.round(pct)}%`;
}

/** Cumul des dernières valeurs mesurées des indicateurs QUANTITATIFS de la liste — l'agrégat
 *  affiché en tête de page KPI / fiche d'axe. Les indicateurs qualitatifs et ceux jamais mesurés
 *  sont ignorés (pas comptés comme 0). */
export function sumLatestQuantitativeValues(
  indicators: Indicator[],
  measurements: IndicatorMeasurement[]
): number {
  let sum = 0;
  for (const indicator of indicators) {
    if (indicator.kind !== "quantitative") continue;
    const latest = latestNumericMeasurement(indicator.id, measurements);
    if (latest?.value !== undefined) sum += latest.value;
  }
  return sum;
}

/** Compteur global "X sur la trajectoire · Y à risque · Z sans donnée". Avec `measurements`, un
 *  indicateur qualitatif, jamais mesuré numériquement ou sans cible est compté dans `noData`
 *  (« Sans donnée ») et NON comme « sur la trajectoire » (`indicatorReadingState`) ; sans
 *  `measurements` (compat), `noData` vaut 0 et seul le statut stocké compte. */
export function countOnTrackAtRisk(
  indicators: Indicator[],
  measurements?: IndicatorMeasurement[]
): {
  total: number;
  onTrack: number;
  atRisk: number;
  noData: number;
} {
  let onTrack = 0;
  let atRisk = 0;
  let noData = 0;
  for (const indicator of indicators) {
    if (measurements) {
      const state = indicatorReadingState(indicator, measurements);
      if (state === "at_risk") atRisk += 1;
      else if (state === "no_data") noData += 1;
      else onTrack += 1;
    } else if (resolveIndicatorStatus(indicator) === "at_risk") atRisk += 1;
    else onTrack += 1;
  }
  return { total: indicators.length, onTrack, atRisk, noData };
}

/** Rôles qui ne saisissent JAMAIS de valeur de KPI (décision PO) : lecture seule sur le Plan
 *  Stratégique, même désignés nommément ou listés dans un `responsibleRoles` historique. */
export const KPI_NEVER_FILL_ROLES: readonly Role[] = ["comex_member", "hr"];

/** Contexte hiérarchique facultatif de `canFillIndicator` : axes/chantiers du programme (au moins
 *  ceux de l'indicateur) pour reconnaître le sponsor d'axe (`StrategicAxis.owner`) et le sponsor de
 *  chantier (`Chantier.pilote`). Sans lui, ces deux sponsors ne sont PAS reconnus (seuls admin,
 *  pilote, responsables nommés et repli `responsibleRoles` s'appliquent). */
export type IndicatorFillContext = {
  axes?: Pick<StrategicAxis, "id" | "owner">[];
  chantiers?: Pick<Chantier, "id" | "pilote">[];
  /** Projets du programme : le responsable et les contributeurs d'un projet LIÉ au KPI
   *  (`ChantierAction.indicatorId === indicator.id`) peuvent le renseigner. Absent = non reconnus. */
  chantierActions?: Pick<ChantierAction, "indicatorId" | "owner" | "contributors">[];
};

/** Responsables NOMMÉS de la saisie d'un KPI (`Indicator.additionalAuthorizedUserIds`, usernames),
 *  dédoublonnés et sans valeur vide. */
export function indicatorResponsibleUsernames(
  indicator: Pick<Indicator, "additionalAuthorizedUserIds">
): string[] {
  return Array.from(
    new Set((indicator.additionalAuthorizedUserIds ?? []).map((u) => u.trim()).filter(Boolean))
  );
}

/**
 * Un utilisateur peut-il renseigner une mesure (et ajuster l'objectif/le seuil) de cet
 * indicateur ? Seul point de vérité pour ce contrôle — utilisé aussi bien pour griser le
 * formulaire de saisie que pour l'édition inline de l'objectif sur la page KPI. Ne décide QUE
 * « qui peut saisir » : le circuit de validation de la valeur saisie (sponsor d'axe puis pilote,
 * `lib/strategicHierarchy.ts`) est géré ailleurs.
 *
 * Règle (décision PO — chaque KPI a un ou des responsables de saisie NOMMÉS) :
 *  - admin / admin_entreprise : toujours ;
 *  - `comex_member` et `hr` (rôle stratégique effectif sur le programme de l'indicateur) : jamais ;
 *  - pilote (`strategic_lead`) du programme de l'indicateur (profil rattaché à CE programme, ou
 *    profil « tous programmes ») ;
 *  - les responsables nommés : `additionalAuthorizedUserIds` (champ réutilisé tel quel, libellé
 *    « Responsable(s) de saisie » dans l'UI — pas de nouveau champ : il porte déjà exactement
 *    « usernames autorisés à saisir », aucune migration de données) ;
 *  - KPI de CHANTIER (`chantierId`) : le sponsor de ce chantier (`Chantier.pilote`) ;
 *    KPI d'AXE (sans `chantierId`) : le sponsor de cet axe (`StrategicAxis.owner`) — nécessite
 *    `ctx` (voir `IndicatorFillContext`) ;
 *  - le responsable et les contributeurs d'un PROJET lié au KPI (`ChantierAction.indicatorId`) —
 *    nécessite `ctx.chantierActions` ; leur saisie est validée par le sponsor de chantier puis le
 *    sponsor d'axe (lib/kpiCorrectionRouting.ts).
 *  - REPLI HISTORIQUE `responsibleRoles` : lu UNIQUEMENT quand l'indicateur n'a AUCUN responsable
 *    nommé (indicateurs antérieurs à cette règle) — un rôle ne donne plus jamais le droit de saisie
 *    à tous ses détenteurs dès qu'un responsable est désigné. Un rôle stratégique n'est compté que
 *    sur un profil rattaché au programme de l'indicateur (ou « tous programmes »). À retirer une
 *    fois tous les KPI dotés d'un responsable nommé.
 */
export function canFillIndicator(
  indicator: Pick<
    Indicator,
    "responsibleRoles" | "additionalAuthorizedUserIds" | "programId" | "axisId" | "chantierId"
  > &
    Partial<Pick<Indicator, "id">>,
  user:
    Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin" | "username"> | null | undefined,
  ctx?: IndicatorFillContext
): boolean {
  if (!user) return false;
  if (isAnyAdmin(user)) return true;
  const role = resolveStrategicRoleForProgram(user, indicator.programId);
  if (role && KPI_NEVER_FILL_ROLES.includes(role)) return false;
  if (role === "strategic_lead") return true;

  const named = indicatorResponsibleUsernames(indicator);
  if (named.includes(user.username)) return true;

  if (indicator.chantierId) {
    const chantier = ctx?.chantiers?.find((c) => c.id === indicator.chantierId);
    if (chantier?.pilote && chantier.pilote === user.username) return true;
  } else {
    const axis = ctx?.axes?.find((a) => a.id === indicator.axisId);
    if (axis?.owner && axis.owner === user.username) return true;
  }

  const indicatorId = indicator.id;
  if (
    indicatorId &&
    (ctx?.chantierActions ?? []).some(
      (a) => a.indicatorId === indicatorId && isProjetMember(a, user.username)
    )
  ) {
    return true;
  }

  if (named.length > 0) return false;
  const legacyRoles = (indicator.responsibleRoles ?? []).filter(
    (r) => !KPI_NEVER_FILL_ROLES.includes(r)
  );
  return (user.profiles ?? []).some(
    (p) =>
      legacyRoles.includes(p.role) &&
      (!isStrategicRole(p.role) || !p.programId || p.programId === indicator.programId)
  );
}

/** Un compte peut-il être désigné responsable de saisie d'un KPI de ce programme ? Tous, sauf ceux
 *  dont le rôle stratégique effectif sur le programme est `comex_member`/`hr` (ils ne saisissent
 *  jamais — voir `canFillIndicator`). Sert à filtrer le sélecteur de l'éditeur d'indicateurs. */
export function canBeKpiResponsible(
  user: Pick<AuthUser, "profiles"> | null | undefined,
  programId: string | null | undefined
): boolean {
  if (!user) return false;
  const role = resolveStrategicRoleForProgram(user, programId);
  return !(role && KPI_NEVER_FILL_ROLES.includes(role));
}

/**
 * Un utilisateur peut-il PILOTER ce chantier (mettre à jour son avancement, ses actions, ses
 * livrables) ? Pendant de `canFillIndicator` pour l'entité `Chantier`, basé sur
 * `Chantier.responsibleRoles` (voir `types/index.ts`).
 *
 * Deux différences assumées avec `canFillIndicator` :
 *  - pas de liste d'utilisateurs nommés (`additionalAuthorizedUserIds`) : le champ n'existe pas
 *    sur `Chantier`, l'habilitation est purement par rôle pour l'instant ;
 *  - `responsibleRoles` est OPTIONNEL et le défaut est PERMISSIF : absent ou vide = `true` (tant
 *    qu'aucun responsable n'a été configuré, on ne bloque personne). `canFillIndicator` est au
 *    contraire restrictif par défaut, car `Indicator.responsibleRoles` est obligatoire à la
 *    saisie.
 *
 * NON CÂBLÉE dans l'UI à ce stade — introduite pour le lot « responsabilités du Plan Stratégique »
 * (organigramme 3-5-15 : sponsor d'axe, responsable de chantier, etc.).
 *
 * **Ne pas confondre avec `resolveStrategicOwnershipScope` (round 25, juste plus bas)** : deux
 * questions différentes, volontairement NON unifiées. Celle-ci répond à "cet utilisateur a-t-il le
 * DROIT D'ÉDITER ce chantier ?", par RÔLE, via une liste ouverte (`responsibleRoles`, permissif par
 * défaut) — non câblée dans l'UI. `resolveStrategicOwnershipScope` répond à "quels axes/chantiers/
 * projets cet utilisateur VOIT-IL ?", par PROPRIÉTAIRE NOMMÉ (`owner`/`pilote`, un `username`
 * précis) — câblée dans `useStrategicData.ts`, restrictive par défaut pour les 3 rôles concernés.
 * Un chantier peut donc être visible (scope) sans être éditable (manage), ou l'inverse.
 */
export function canManageChantier(
  chantier: Pick<Chantier, "responsibleRoles">,
  user: Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin"> | null | undefined
): boolean {
  if (!user) return false;
  if (isAnyAdmin(user)) return true;
  const roles = chantier.responsibleRoles ?? [];
  if (roles.length === 0) return true;
  return hasAnyRole(user, roles);
}

// ─── Périmètre de visibilité par propriétaire nommé (round 25) ─────────────────────────────────

/**
 * Profil Plan Stratégique APPLICABLE à UN programme précis : celui dont `programId` correspond
 * EXACTEMENT au programme ; à défaut, un profil « tous programmes » (`programId` absent). JAMAIS
 * le profil d'un AUTRE programme — distinct de `getStrategicProfile` (lib/roleProfiles.ts), qui
 * renvoie le premier profil trouvé sans tenir compte du programme affiché.
 */
export function strategicProfileForProgram(
  user: Pick<AuthUser, "profiles"> | null | undefined,
  programId: string | null | undefined
): ProfileAssignment | undefined {
  const profiles = getStrategicProfiles(user);
  return (
    profiles.find((p) => p.programId && p.programId === programId) ??
    profiles.find((p) => !p.programId)
  );
}

/**
 * Rôle Plan Stratégique EFFECTIF de l'utilisateur pour UN programme précis (voir
 * `strategicProfileForProgram`). Un utilisateur cumulant deux profils stratégiques sur deux
 * programmes distincts (autorisé par `assertValidProfiles`) se voit toujours appliquer le rôle du
 * programme ACTIF. `undefined` si aucun profil ne s'applique à ce programme — plus de repli sur
 * « le premier profil disponible », qui pouvait appliquer le rôle d'un AUTRE programme (ex. pilote
 * du programme B traité comme pilote du programme A).
 */
export function resolveStrategicRoleForProgram(
  user: Pick<AuthUser, "profiles"> | null | undefined,
  programId: string | null | undefined
): Role | undefined {
  return strategicProfileForProgram(user, programId)?.role;
}

/** Rôles stratégiques dont la visibilité est bornée par la hiérarchie NOMMÉE (voir
 *  `resolveStrategicOwnershipScope`). */
export const OWNERSHIP_SCOPED_ROLES: readonly Role[] = [
  "axis_sponsor",
  "chantier_owner",
  "chantier_contributor",
  "projet_contributor",
];

/** Rôles « projet » : la liste des projets ouvrables est TOUJOURS explicite pour eux. */
const PROJECT_LEVEL_ROLES: readonly Role[] = ["chantier_contributor", "projet_contributor"];

/** L'utilisateur est-il responsable (`owner`) ou contributeur (`contributors`) de ce projet ?
 *  Les deux sont traités À L'IDENTIQUE pour la visibilité/l'ouverture du projet. */
export function isProjetMember(
  action: Pick<ChantierAction, "owner" | "contributors">,
  username: string
): boolean {
  return action.owner === username || (action.contributors ?? []).includes(username);
}

/**
 * Périmètre de visibilité "propriétaire nommé" — QUI voit QUOI dans le Plan Stratégique, d'après
 * la hiérarchie NOMMÉE (`lib/strategicHierarchy.ts`) : pilote > sponsor d'axe
 * (`StrategicAxis.owner`) > sponsor de chantier (`Chantier.pilote`) > responsable projet
 * (`ChantierAction.owner`) > contributeurs projet (`ChantierAction.contributors`).
 *
 * Pour les rôles de `OWNERSHIP_SCOPED_ROLES` (`axis_sponsor`, `chantier_owner`,
 * `chantier_contributor`, `projet_contributor`), le périmètre est l'UNION de ce que l'utilisateur
 * détient nommément sur le programme — le rôle ne sert qu'à décider « restreint ou non » :
 *  - axe dont il est sponsor : l'axe + TOUS ses chantiers (et tous leurs projets, ouvrables) ;
 *  - chantier dont il est sponsor : le chantier (tous ses projets, ouvrables) + ses axes PARENTS
 *    (contexte d'orientation seulement : `chantierIds`, jamais `axisIds`, borne les chantiers) ;
 *  - projet dont il est responsable OU contributeur : le chantier parent devient visible (et ses
 *    axes parents, pour contexte), ses AUTRES projets restent visibles mais NON ouvrables —
 *    `clickableActionIds` liste alors exactement les projets ouvrables ; l'UI rend les autres
 *    INERTES au clic plutôt que de les omettre (voir `ProgramRoadmap.tsx`/
 *    `AxisChantierProjetAccordion.tsx`/`ProjetMilestoneBoard.tsx`).
 * `clickableActionIds` est TOUJOURS fourni pour `chantier_contributor`/`projet_contributor`, et
 * pour les autres rôles scopés uniquement si un chantier n'est visible QUE par un de ses projets
 * (sinon `undefined` = tous les projets des chantiers visibles sont ouvrables).
 *
 * Un utilisateur doté de profils stratégiques mais d'AUCUN applicable au programme actif est
 * traité comme scopé (seule sa position nommée compte). Tout autre rôle (`strategic_lead`,
 * `comex_member`, `hr` — lecture complète —, …), un utilisateur sans aucun profil stratégique et
 * tout admin : `"unrestricted"`.
 *
 * `axes`/`chantiers`/`chantierActions` sont attendus DÉJÀ scopés au programme actif — `programId`
 * ne sert qu'à résoudre le bon profil (`resolveStrategicRoleForProgram`).
 *
 * Un utilisateur `null`/`undefined` produit un périmètre `"scoped"` à VIDE (rien de visible) :
 * un appelant qui active le filtrage sans utilisateur résolu ne retombe jamais sur "tout voir".
 */
export type StrategicOwnershipScope =
  | { mode: "unrestricted" }
  | {
      mode: "scoped";
      /** Axes visibles — axes sponsorisés, plus les axes PARENTS des chantiers visibles par un
       *  chantier ou un projet (contexte d'orientation, ne donne accès à AUCUN autre chantier). */
      axisIds: Set<string>;
      /** Chantiers visibles (voir le doc-comment de la fonction). */
      chantierIds: Set<string>;
      /** Projets réellement ouvrables parmi ceux des chantiers visibles — `undefined` = tous. */
      clickableActionIds?: Set<string>;
    };

export function resolveStrategicOwnershipScope(
  user:
    Pick<AuthUser, "username" | "profiles" | "isGlobalAdmin" | "isCompanyAdmin"> | null | undefined,
  programId: string | null | undefined,
  axes: StrategicAxis[],
  chantiers: Chantier[],
  chantierActions: ChantierAction[]
): StrategicOwnershipScope {
  if (!user) {
    return {
      mode: "scoped",
      axisIds: new Set(),
      chantierIds: new Set(),
      clickableActionIds: new Set(),
    };
  }
  if (isAnyAdmin(user)) return { mode: "unrestricted" };

  const role = resolveStrategicRoleForProgram(user, programId);
  const scoped = role
    ? OWNERSHIP_SCOPED_ROLES.includes(role)
    : getStrategicProfiles(user).length > 0;
  if (!scoped) return { mode: "unrestricted" };

  const username = user.username;
  const sponsoredAxisIds = new Set(axes.filter((a) => a.owner === username).map((a) => a.id));
  // Chantiers visibles EN ENTIER (tous leurs projets ouvrables).
  const fullChantierIds = new Set(
    chantiers
      .filter((c) => c.pilote === username || c.axisIds.some((id) => sponsoredAxisIds.has(id)))
      .map((c) => c.id)
  );
  const memberActions = chantierActions.filter((a) => isProjetMember(a, username));

  const chantierIds = new Set(fullChantierIds);
  for (const a of memberActions) chantierIds.add(a.chantierId);

  const axisIds = new Set(sponsoredAxisIds);
  for (const c of chantiers) {
    if (!chantierIds.has(c.id)) continue;
    // Chantier visible via un axe sponsorisé : ses AUTRES axes parents ne sont pas ajoutés.
    if (c.axisIds.some((id) => sponsoredAxisIds.has(id))) continue;
    for (const id of c.axisIds) axisIds.add(id);
  }

  const projectOnly = Array.from(chantierIds).some((id) => !fullChantierIds.has(id));
  const projectLevelRole = role !== undefined && PROJECT_LEVEL_ROLES.includes(role);
  if (!projectLevelRole && !projectOnly) return { mode: "scoped", axisIds, chantierIds };
  const clickableActionIds = new Set(
    chantierActions
      .filter((a) => fullChantierIds.has(a.chantierId) || isProjetMember(a, username))
      .map((a) => a.id)
  );
  return { mode: "scoped", axisIds, chantierIds, clickableActionIds };
}

/**
 * Indicateurs à risque d'UN chantier, chacun accompagné de son écart calculé (`computeIndicatorDelta`)
 * — alimente le `Popover` du badge "N à risque" (round 4, point 2) : le badge affichait un nombre
 * sans jamais dire QUELS indicateurs ni de COMBIEN ils dérapent.
 */
export function chantierAtRiskIndicators(
  chantierId: string,
  indicators: Indicator[],
  measurements: IndicatorMeasurement[]
): { indicator: Indicator; delta: IndicatorDelta | undefined }[] {
  return indicators
    .filter((indicator) => indicator.chantierId === chantierId)
    .filter((indicator) => resolveIndicatorStatus(indicator) === "at_risk")
    .map((indicator) => ({
      indicator,
      delta: computeIndicatorDelta(
        indicator,
        latestNumericMeasurement(indicator.id, measurements),
        measurements
      ),
    }));
}

// ─── Alertes de cascade de retard inter-chantiers ──────────────────────────────────────────────

/** Alerte de dépendance entre chantiers. Pendant STRICTEMENT non financier de
 *  `engine.DependencyAlert` : pas d'`impactEur` — un chantier stratégique ne porte ni gains ni
 *  coûts, l'alerte ne dit que "qui bloque qui, et de combien de jours". */
export type ChantierDependencyAlert = {
  sourceId: string;
  sourceName: string;
  sourceDate: string;
  targetId: string;
  targetName: string;
  targetDate: string;
  type: ChantierDependencyType;
  message: string;
  /** Nombre de jours de retard ou de décalage (toujours positif). */
  delayDays: number;
};

/** Tolérance (jours) pour les contraintes de simultanéité SS / FF — même valeur que
 *  `lib/engine.ts` côté leviers, pour que les deux plans se comportent pareil. */
const SIMULTANEITY_TOLERANCE_DAYS = 7;

/** Bornes temporelles d'un chantier : début de sa première action → fin de sa dernière action
 *  (vue macro du Gantt). Un chantier sans action n'a pas de bornes exploitables. */
export function chantierBounds(
  chantierId: string,
  actions: ChantierAction[]
): { start: string; end: string } | undefined {
  let start: string | undefined;
  let end: string | undefined;
  for (const action of actions) {
    if (action.chantierId !== chantierId) continue;
    if (!start || action.start < start) start = action.start;
    if (!end || action.end > end) end = action.end;
  }
  return start && end ? { start, end } : undefined;
}

/**
 * Évalue toutes les dépendances inter-chantiers contre les dates courantes et retourne les
 * contraintes violées. Aucune date n'est modifiée : c'est du signalement pur, à afficher en
 * alerte sur la fiche d'axe et le dashboard stratégique. Même logique FS/SS/FF/SF que
 * `engine.dependencyAlerts()`, sans la dimension financière.
 *
 * Les dates d'un chantier n'étant pas portées par le chantier lui-même mais dérivées de ses
 * actions (voir `chantierBounds`), `actions` est nécessaire pour produire des alertes : appelée
 * sans actions, la fonction retourne un tableau vide plutôt que d'inventer des bornes.
 */
export function chantierDependencyAlerts(
  chantiers: Chantier[],
  actions: ChantierAction[] = []
): ChantierDependencyAlert[] {
  const boundsById = new Map<string, { start: string; end: string }>();
  for (const chantier of chantiers) {
    const bounds = chantierBounds(chantier.id, actions);
    if (bounds) boundsById.set(chantier.id, bounds);
  }
  const byId = new Map(chantiers.map((c) => [c.id, c]));
  const alerts: ChantierDependencyAlert[] = [];

  for (const source of chantiers) {
    const sourceBounds = boundsById.get(source.id);
    if (!sourceBounds) continue;
    for (const dep of source.dependencies) {
      const target = byId.get(dep.targetId);
      const targetBounds = target ? boundsById.get(target.id) : undefined;
      if (!target || !targetBounds) continue;

      let violated = false;
      let message = "";
      let delayDays = 0;
      let sourceDate = "";
      let targetDate = "";

      switch (dep.type) {
        case "FS":
          // Le bloqueur (target) doit finir avant que le bloqué (source) puisse commencer.
          delayDays = daysBetween(sourceBounds.start, targetBounds.end);
          violated = delayDays > 0;
          sourceDate = sourceBounds.start;
          targetDate = targetBounds.end;
          message = `"${target.name}" se termine ${delayDays} jours après le début prévu de "${source.name}"`;
          break;
        case "SS":
          // Les deux doivent démarrer ensemble.
          delayDays = Math.abs(daysBetween(targetBounds.start, sourceBounds.start));
          violated = delayDays > SIMULTANEITY_TOLERANCE_DAYS;
          sourceDate = sourceBounds.start;
          targetDate = targetBounds.start;
          message = `"${source.name}" et "${target.name}" ont ${delayDays} jours de décalage au démarrage`;
          break;
        case "FF":
          // Les deux doivent finir ensemble.
          delayDays = Math.abs(daysBetween(targetBounds.end, sourceBounds.end));
          violated = delayDays > SIMULTANEITY_TOLERANCE_DAYS;
          sourceDate = sourceBounds.end;
          targetDate = targetBounds.end;
          message = `"${source.name}" et "${target.name}" ont ${delayDays} jours de décalage à la fin`;
          break;
        case "SF":
          // Le bloqueur (target) doit démarrer avant que le bloqué (source) puisse finir.
          delayDays = daysBetween(sourceBounds.end, targetBounds.start);
          violated = delayDays > 0;
          sourceDate = sourceBounds.end;
          targetDate = targetBounds.start;
          message = `"${target.name}" démarre ${delayDays} jours après la fin prévue de "${source.name}"`;
          break;
      }

      if (violated) {
        alerts.push({
          sourceId: source.id,
          sourceName: source.name,
          sourceDate,
          targetId: target.id,
          targetName: target.name,
          targetDate,
          type: dep.type,
          message,
          delayDays: Math.abs(delayDays),
        });
      }
    }
  }

  return alerts;
}

// ─── Santé globale d'un chantier (round 6, point 5) ────────────────────────────────────────────

/** État de santé à TROIS niveaux d'un chantier — première apparition d'un état à trois niveaux
 *  côté Plan Stratégique (le reste du domaine indicateur ne connaît que le binaire
 *  `IndicatorRiskStatus`). Alimente `ChantierHealthMatrix` (widget dashboard "chantier-health"). */
export type ChantierHealthState = "onTrack" | "watch" | "critical";

/**
 * État de santé global d'un chantier, croisant deux signaux DÉJÀ existants (`chantierAtRiskIndicators`,
 * `chantierDependencyAlerts`) — aucune nouvelle donnée saisie, purement dérivé.
 *
 * **Sens de `sourceId`/`targetId` d'une alerte** (voir `chantierDependencyAlerts` ci-dessus) :
 * `source` est le chantier qui PORTE la dépendance (`Chantier.dependencies`), `target` celui dont
 * il dépend. Une alerte violée signifie que `target` n'a pas tenu la contrainte attendue par
 * `source` — c'est donc `source` qui est concrètement BLOQUÉ/retardé par `target`, et `target` qui
 * RETARDE `source` (voir le cas FS testé dans `lib/__tests__/axisLogic.test.ts` :
 * "Déploiement terrain" est `sourceId`, bloqué par "Refonte SI" en `targetId`, qui finit en
 * retard). D'où l'affectation ci-dessous — délibérément la correspondance inverse de la première
 * lecture littérale des noms de champs :
 *  - `critical` : ce chantier est `sourceId` d'au moins une alerte — il est le côté BLOQUÉ, le
 *    signal le plus grave (son propre avancement est concrètement entravé).
 *  - `watch` : `chantierAtRiskIndicators(...)` non vide, OU ce chantier est `targetId` d'une
 *    alerte — il n'est pas lui-même bloqué, mais soit un de ses indicateurs dérape, soit sa propre
 *    lenteur retarde un AUTRE chantier en aval (signal à surveiller, pas encore critique pour LUI).
 *  - `onTrack` : sinon.
 */
// Round 7 : re-vérifiée — ne lit toujours que `chantierDependencyAlerts`/`chantierAtRiskIndicators`,
// jamais `.milestones` (chantier ou levier). Aucune modification nécessaire malgré le déplacement
// du suivi E0→E4 vers les leviers.
export function chantierHealthState(
  chantier: Chantier,
  indicators: Indicator[],
  measurements: IndicatorMeasurement[],
  chantiers: Chantier[],
  chantierActions: ChantierAction[]
): ChantierHealthState {
  const alerts = chantierDependencyAlerts(chantiers, chantierActions);
  const isBlocked = alerts.some((alert) => alert.sourceId === chantier.id);
  if (isBlocked) return "critical";

  const hasAtRiskIndicator =
    chantierAtRiskIndicators(chantier.id, indicators, measurements).length > 0;
  const isDelayingDownstream = alerts.some((alert) => alert.targetId === chantier.id);
  if (hasAtRiskIndicator || isDelayingDownstream) return "watch";

  return "onTrack";
}

// ─── Avancement d'un chantier ──────────────────────────────────────────────────────────────────

/**
 * Ratio d'avancement (0 → 1) d'une étape de maturité DANS le cycle du programme. Une étape
 * terminale vaut 1 ; les étapes de cycle sont réparties linéairement d'après leur position.
 *
 * Avec le référentiel par défaut (Défini / Validé / Planifié / Réalisé*) on obtient donc
 * 0 / 0,33 / 0,67 / 1 : la première étape du cycle ne vaut jamais rien de commencé, la terminale
 * vaut le plein. Si le programme n'a AUCUNE étape terminale, le dernier maillon du cycle vaut 1
 * (sinon aucun chantier ne pourrait jamais atteindre 100 %).
 *
 * Étape inconnue du référentiel (supprimée depuis son affectation) : 0 — même parti pris
 * défensif que `resolveMaturityStageLabel`, on ne devine pas un avancement.
 */
export function maturityStageProgressRatio(stageId: string, stages: MaturityStageConfig[]): number {
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) return 0;
  if (stage.isTerminal) return 1;
  const cycle = stages.filter((s) => !s.isTerminal);
  const position = cycle.findIndex((s) => s.id === stage.id);
  if (position < 0) return 0;
  const hasTerminal = stages.length > cycle.length;
  const steps = hasTerminal ? cycle.length : Math.max(1, cycle.length - 1);
  return Math.min(1, position / steps);
}

export type ChantierProgress = {
  /** Avancement pondéré, en pourcentage entier (0-100). */
  pct: number;
  /** Nombre total d'actions du chantier. */
  total: number;
  /** Actions ayant atteint une étape TERMINALE du programme. */
  done: number;
};

/**
 * Avancement d'un chantier, dérivé de ses actions — il n'existe aucun champ « % d'avancement »
 * saisi à la main sur `Chantier`, et on n'en introduit pas : la seule donnée fiable est l'étape de
 * maturité de chaque action.
 *
 * Définition retenue, volontairement simple et explicable au comité : moyenne des avancements
 * d'étape des actions (`maturityStageProgressRatio`), PONDÉRÉE PAR LEUR DURÉE. Une action de six
 * mois pèse donc six fois une action d'un mois — sans quoi un chantier constitué d'un long
 * déploiement et de trois jalons courts afficherait un avancement dicté par les jalons.
 *
 * Un chantier sans action retourne 0 % (et `total: 0`, ce qui permet à l'appelant de distinguer
 * « pas commencé » de « rien à mesurer »).
 */
export function chantierProgress(
  chantierId: string,
  actions: ChantierAction[],
  stages: MaturityStageConfig[]
): ChantierProgress {
  const own = actions.filter((a) => a.chantierId === chantierId);
  if (own.length === 0) return { pct: 0, total: 0, done: 0 };

  let weighted = 0;
  let totalWeight = 0;
  let done = 0;
  for (const action of own) {
    // Durée en jours, plancher à 1 : une action d'un seul jour (ou aux dates incohérentes) doit
    // peser quelque chose plutôt que d'être neutralisée.
    const weight = Math.max(1, daysBetween(action.start, action.end) + 1);
    weighted += maturityStageProgressRatio(action.status, stages) * weight;
    totalWeight += weight;
    if (stages.find((s) => s.id === action.status)?.isTerminal) done += 1;
  }

  return {
    pct: Math.round((weighted / totalWeight) * 100),
    total: own.length,
    done,
  };
}

// ─── Prérequis d'action (go/no-go) ─────────────────────────────────────────────────────────────

/**
 * Un projet est-il TERMINÉ au sens des prérequis ? Vrai s'il a VALIDÉ son dernier jalon (E4 dans
 * `passedMilestones`) ou si son avancement déclaratif (`progressOf`, par défaut
 * `milestoneProgressPct` — passer le résolveur complet `projetProgressResolver` pour tenir compte
 * des items automatiques) atteint 100 %. Remplace l'ancienne lecture de l'étape de maturité
 * (`ChantierAction.status`), figée depuis la suppression du kanban de maturité : un prérequis entre
 * projets n'était alors JAMAIS satisfait.
 */
export function isProjetDone(
  action: ChantierAction,
  progressOf: ProjetProgressLookup = (a) => milestoneProgressPct(a)
): boolean {
  const lastMilestone = MILESTONE_ORDER[MILESTONE_ORDER.length - 1];
  if (action.milestones?.passedMilestones.includes(lastMilestone)) return true;
  return progressOf(action) >= 100;
}

/**
 * Une action peut-elle démarrer, au regard de ses prérequis (`ChantierAction.prerequisites`) ?
 * v1 PUREMENT INFORMATIVE (voir plan round 4, point 5) : un prérequis non satisfait n'empêche
 * RIEN — il s'affiche seulement (badge cadenas sur le Gantt, détail sur la fiche chantier).
 *
 * Un prérequis "action" est satisfait quand le projet cible est TERMINÉ (`isProjetDone` : dernier
 * jalon validé ou avancement à 100 %). Une cible introuvable (action supprimée depuis, ou id
 * invalide) n'est jamais satisfaite mais ne lève JAMAIS d'exception — elle produit un message
 * explicite. Un prérequis "external" est satisfait quand `done === true`.
 */
export function canStartAction(
  action: Pick<ChantierAction, "prerequisites">,
  allActions: ChantierAction[],
  progressOf?: ProjetProgressLookup
): { blocked: boolean; reasons: string[] } {
  const reasons: string[] = [];

  for (const prerequisite of action.prerequisites ?? []) {
    if (prerequisite.kind === "action") {
      const target = allActions.find((a) => a.id === prerequisite.targetActionId);
      if (!target) {
        reasons.push(`Prérequis introuvable (action supprimée ou invalide)`);
        continue;
      }
      if (!isProjetDone(target, progressOf)) reasons.push(`En attente de "${target.name}"`);
    } else {
      if (!prerequisite.done) reasons.push(prerequisite.label || "Prérequis externe non satisfait");
    }
  }

  return { blocked: reasons.length > 0, reasons };
}

// ─── Jalons E0→E4 (round 5) ─────────────────────────────────────────────────────────────────────

/**
 * Libellé AFFICHÉ d'un jalon (round 19) — "J0"…"J4" au lieu de "E0"…"E4". PUREMENT cosmétique :
 * `MilestoneId` (le type), les valeurs Firestore, `MilestoneChecklistItem.itemId` (ex. "E0-A1") et
 * tout `lib/milestoneChecklist.ts` restent inchangés, toujours "E0"…"E4" — des documents Firestore
 * déjà seedés ont leur `checklists` keyée par ces littéraux exacts, les renommer casserait la
 * lecture de données existantes pour un gain purement visuel. Seul point de vérité pour cette
 * traduction d'affichage : tout rendu utilisateur d'un `MilestoneId` brut doit passer par cette
 * fonction plutôt que d'interpoler l'id directement.
 */
export function displayMilestoneId(id: MilestoneId): string {
  return id.replace("E", "J");
}

/**
 * Calcule la valeur DÉCLARATIVE (0-100, round 12) des items AUTOMATIQUES d'un jalon donné
 * (`ChecklistItemDef.auto`, contenu défini dans `lib/milestoneChecklist.ts`) — les items manuels de
 * ce même jalon n'apparaissent PAS dans le résultat, c'est à l'appelant (l'UI, ou
 * `milestoneProgressPct` via son paramètre `autoValues`) de fusionner cette map avec les valeurs
 * manuelles déjà enregistrées sur le LEVIER (`action.milestones.checklists[milestoneId]`).
 *
 * Round 12 : ENCODAGE de sortie changé de `ChecklistFlag` ("green"/"red", jamais "orange" pour un
 * item auto) à un NOMBRE — `100` où l'ancien code renvoyait "green", `0` où il renvoyait "red" —
 * pour s'aligner sur `MilestoneChecklistItem.progressPct`, qui remplace le feu discret.
 *
 * Round 26 : le tag `auto: "previousOranges"` (et sa branche de calcul) a été RETIRÉ — il
 * opérationnalisait le report d'un item orange non soldé du jalon précédent, une notion devenue
 * logiquement vide maintenant que `canPassMilestone` exige que TOUS les items du jalon courant
 * soient à 100 pour passer au suivant (plus jamais d'item partiel "laissé derrière"). `MILESTONE_
 * CHECKLISTS` ne définit donc plus d'entrée `previousOranges` sur E1→E4.
 *
 * Round 7 : retargetée du chantier vers le LEVIER (`ChantierAction`) — le suivi E0→E4 vit
 * désormais par levier (voir `ChantierAction.milestones`), un chantier regroupant plusieurs
 * leviers qui avancent chacun à leur rythme. `dependencyAlert` et `effortComplete` restent des
 * signaux CHANTIER (dépendances et grille d'effort n'ont pas été déplacées ce round) : ils
 * résolvent le chantier PARENT via `action.chantierId` puis lisent son propre état — c'est
 * pourquoi tous les leviers d'un même chantier affichent la MÊME valeur pour ces deux items,
 * intentionnellement.
 *
 * Les deux tags `auto` restants correspondent chacun à une règle de la note PMO du PO, rendue
 * automatique plutôt que posée comme une question (voir le commentaire de `ChecklistItemDef` pour
 * le détail de chaque règle) :
 *  - `dependencyAlert` : `0` si le CHANTIER PARENT du levier est le côté BLOQUÉ (`sourceId`)
 *    d'au moins une alerte de `chantierDependencyAlerts` — `100` sinon (y compris si le chantier
 *    parent est introuvable, ou si l'alerte existe mais bloque un AUTRE chantier).
 *  - `effortComplete` : `100` si les 4 dimensions de `chantierParent.effort` sont toutes
 *    renseignées (`!== undefined`), `0` sinon (y compris si le chantier parent est introuvable).
 */
export function resolveMilestoneAutoFlags(
  milestoneId: MilestoneId,
  action: ChantierAction,
  allChantiers: Chantier[],
  allActions: ChantierAction[],
  /** Alertes de dépendance déjà calculées (`chantierDependencyAlerts(allChantiers, allActions)`)
   *  — optimisation pour les appelants qui résolvent de nombreux projets d'un coup (voir
   *  `projetProgressResolver`). Omis = calculées ici. */
  precomputedAlerts?: ChantierDependencyAlert[]
): Record<string, number> {
  const flags: Record<string, number> = {};
  const parentChantier = allChantiers.find((c) => c.id === action.chantierId);

  for (const item of MILESTONE_CHECKLISTS[milestoneId]) {
    if (!item.auto) continue;

    switch (item.auto) {
      case "dependencyAlert": {
        const alerts = precomputedAlerts ?? chantierDependencyAlerts(allChantiers, allActions);
        const isAffected = parentChantier
          ? alerts.some((a) => a.sourceId === parentChantier.id)
          : false;
        flags[item.itemId] = isAffected ? 0 : 100;
        break;
      }
      case "effortComplete": {
        const effort = parentChantier?.effort;
        const isComplete =
          effort?.financialImpact !== undefined &&
          effort?.humanImpact !== undefined &&
          effort?.duration !== undefined &&
          effort?.changeManagement !== undefined;
        flags[item.itemId] = isComplete ? 100 : 0;
        break;
      }
    }
  }

  return flags;
}

/**
 * Un jalon peut-il être VALIDÉ, au regard des items de sa check-list (manuels + automatiques,
 * déjà fusionnés par l'appelant — cette fonction ne sait pas distinguer les deux) ?
 *
 * **Contrairement à `canStartAction` (round 4, purement informatif — rien n'empêche réellement une
 * action bloquée de démarrer), ce verrou est réel.**
 *
 * Round 26 : règle DURCIE — `canPass` exige désormais que CHAQUE item de la check-list soit
 * intégralement à `progressPct === 100` (remplace l'ancienne tolérance round 12, qui laissait
 * passer toute valeur strictement positive, l'ancien "orange", et ne bloquait que sur `0` ou sur
 * une valeur non déclarée). Il n'y a donc plus d'état intermédiaire non-bloquant pour le jalon
 * COURANT : soit un item est fait (100), soit il bloque, qu'il soit à 0, à une valeur partielle, ou
 * pas encore répondu (`undefined`). C'est ce nouveau "tout à 100" qui rend l'ancien verrou
 * `auto: "previousOranges"` (retiré round 26, voir `resolveMilestoneAutoFlags`) logiquement
 * superflu : plus aucun item partiel ne peut jamais être "laissé derrière" par un jalon déjà validé.
 * Ne lève jamais d'exception ; une check-list vide renvoie `canPass: true`.
 */
export function canPassMilestone(
  milestoneId: MilestoneId,
  items: MilestoneChecklistItem[]
): { canPass: boolean; reasons: string[] } {
  const reasons: string[] = [];

  for (const item of items) {
    if (item.progressPct === undefined) {
      reasons.push(`Item non répondu (${displayMilestoneId(milestoneId)}, ${item.itemId})`);
    } else if (item.progressPct !== 100) {
      reasons.push(`Item pas encore complet (${displayMilestoneId(milestoneId)}, ${item.itemId})`);
    }
  }

  return { canPass: reasons.length === 0, reasons };
}

/**
 * Fusionne les items d'un jalon donné — réponses manuelles STOCKÉES (typiquement
 * `action.milestones.checklists[milestoneId]`) + valeurs LIVE des items automatiques (typiquement
 * `resolveMilestoneAutoFlags(milestoneId, action, allChantiers, allActions)`) + actions
 * PERSONNALISÉES de ce projet (round "actions clés du jalon", typiquement
 * `action.customMilestoneActions?.[milestoneId]`) — dans l'ordre : items fixes de
 * `MILESTONE_CHECKLISTS[milestoneId]` puis actions personnalisées. Seule source de vérité pour
 * cette fusion (round "jalon validation gate") : consommée aussi bien par
 * `MilestoneChecklistPanel.tsx` (calcul du bouton "Valider le jalon", qui a déjà les trois moitiés
 * sous forme de props) que par `canPassMilestone`/`milestonePassageTarget` ci-dessous (le
 * PRÉREQUIS avant de pouvoir même soumettre une demande de validation) — les deux ne doivent
 * jamais diverger sur ce qui compte comme "complet". Reprend exactement la logique locale
 * `mergedItems` qu'avait `MilestoneChecklistPanel.tsx` avant ce round, extraite ici pour que les
 * deux appelants ne puissent plus diverger.
 *
 * `customActions` par défaut à `[]` — un appelant qui ignore encore ce paramètre (code écrit avant
 * son introduction) continue de fonctionner exactement comme avant, sans aucune action
 * personnalisée mêlée au calcul. Une action personnalisée bloque `canPassMilestone` exactement
 * comme un item fixe non complété, aucun traitement de faveur : voir le doc-comment de
 * `MilestoneCustomAction` (types/index.ts).
 *
 * `excludedItemIds` (défaut `[]`, même discipline de compat que `customActions`) : `itemId` des
 * items FIXES de `MILESTONE_CHECKLISTS[milestoneId]` dont CE projet s'exempte (voir
 * `ChantierAction.excludedMilestoneItems`) — filtrés de `fixed` AVANT la fusion avec `custom`, donc
 * absents du résultat comme s'ils n'avaient jamais existé dans le référentiel : ni affichés par
 * `MilestoneChecklistPanel.tsx`, ni exigés par `canPassMilestone` (rien à cocher = rien à
 * bloquer). Un `itemId` exclu qui ne correspond à AUCUN item du jalon (référentiel modifié depuis,
 * ou faute de frappe côté appelant) est un no-op silencieux, même parti pris défensif que le reste
 * de ce fichier (ex. `maturityStageProgressRatio`) : jamais d'exception pour une donnée orpheline.
 */
export function mergeMilestoneChecklistItems(
  milestoneId: MilestoneId,
  storedItems: MilestoneChecklistItem[],
  autoFlags: Record<string, number>,
  customActions: MilestoneCustomAction[] = [],
  excludedItemIds: string[] = []
): MilestoneChecklistItem[] {
  const fixed = MILESTONE_CHECKLISTS[milestoneId]
    .filter((def) => !excludedItemIds.includes(def.itemId))
    .map((def) =>
      def.auto
        ? autoFlags[def.itemId] !== undefined
          ? { itemId: def.itemId, progressPct: autoFlags[def.itemId] }
          : { itemId: def.itemId }
        : (storedItems.find((i) => i.itemId === def.itemId) ?? { itemId: def.itemId })
    );
  const custom = customActions.map(
    (c) => storedItems.find((i) => i.itemId === c.id) ?? { itemId: c.id }
  );
  return [...fixed, ...custom];
}

// ─── Jalon — passage de jalon (prérequis + application) ─────────────────────────────────────────
//
// Depuis le modèle à PALIERS (lib/strategicApprovals.ts), TOUT passage de jalon passe par une
// demande `StrategicApproval` "milestone" à chaîne (N+1 puis N+2 au-dessus de l'auteur), sauf pour
// le pilote du programme / un admin qui l'appliquent directement (`directMilestoneAdvance`,
// lib/strategicFiche.ts). L'ancien circuit à approbateur UNIQUE (`requestMilestoneApproval` /
// `approveMilestoneGate` / `rejectMilestoneApproval` / `canDecideMilestone`) est SUPPRIMÉ. Le
// marqueur `ChantierAction.milestoneApproval` n'est plus qu'un miroir d'affichage posé par la
// demande à chaîne (et retiré à sa clôture) ; un marqueur SANS demande à chaîne en attente est un
// reliquat de l'ancien circuit : affiché en lecture seule, effaçable par un admin
// (`legacyMilestoneMarkers` / `clearLegacyMilestoneMarker`, lib/strategicApprovals.ts).
// Ce module ne garde que la logique PURE commune : prérequis (`milestonePassageTarget`), revérification
// à la décision (`assertMilestoneStillPassable`) et avancée effective (`advanceMilestone`).

/**
 * Un profil `strategic_lead` porte-t-il l'habilitation de pilote stratégique sur CE chantier (donc
 * sur tous ses projets) ? Même convention que `lib/leversLogic.ts::isLeverCtoOf` : un profil sans
 * `programId` (pilote "tous programmes") habilite sur N'IMPORTE QUEL chantier de l'entreprise ; un
 * profil scopé à un `programId` précis n'habilite que sur les chantiers de CE programme
 * (`chantier.programId`).
 */
export function isStrategicLeadOf(
  chantier: Pick<Chantier, "programId">,
  user: Pick<AuthUser, "profiles"> | null | undefined
): boolean {
  if (!hasRole(user, "strategic_lead")) return false;
  return !!user?.profiles?.some(
    (p) =>
      p.role === "strategic_lead" && (p.programId == null || p.programId === chantier.programId)
  );
}

/**
 * PRÉREQUIS d'un passage de jalon : le projet n'est pas au dernier jalon et la check-list du jalon
 * COURANT est complète (`canPassMilestone`, fusion `mergeMilestoneChecklistItems`). Renvoie le jalon
 * courant et le jalon visé ; lève (message FR) sinon. Ne vérifie PAS qui demande : l'habilitation
 * (membre du projet ou niveau au-dessus, admin) est portée par la route de validation
 * (`resolveApprovalRoute("milestone", …)`, lib/strategicApprovals.ts).
 */
export function milestonePassageTarget(
  action: ChantierAction,
  allChantiers: Chantier[],
  allActions: ChantierAction[]
): { from: MilestoneId; targetMilestone: MilestoneId } {
  const currentMilestone = action.milestones?.currentMilestone ?? "E0";
  const targetMilestone = MILESTONE_ORDER[MILESTONE_ORDER.indexOf(currentMilestone) + 1];
  if (!targetMilestone) {
    throw new Error(
      `Le projet "${action.id}" a déjà atteint le dernier jalon (${displayMilestoneId(currentMilestone)})`
    );
  }
  const autoFlags = resolveMilestoneAutoFlags(currentMilestone, action, allChantiers, allActions);
  const storedItems = action.milestones?.checklists[currentMilestone] ?? [];
  const customActions = action.customMilestoneActions?.[currentMilestone] ?? [];
  const excludedItemIds = action.excludedMilestoneItems?.[currentMilestone] ?? [];
  const mergedItems = mergeMilestoneChecklistItems(
    currentMilestone,
    storedItems,
    autoFlags,
    customActions,
    excludedItemIds
  );
  const { canPass, reasons } = canPassMilestone(currentMilestone, mergedItems);
  if (!canPass) {
    throw new Error(
      `Le jalon ${displayMilestoneId(currentMilestone)} du projet "${action.id}" n'est pas encore complet : ${reasons.join(", ")}`
    );
  }
  return { from: currentMilestone, targetMilestone };
}

/** Vérifie, AU MOMENT DE LA DÉCISION, que la check-list du jalon courant est toujours complète
 *  (même fusion que `milestonePassageTarget`) — elle a pu régresser depuis la demande. Lève
 *  sinon. */
export function assertMilestoneStillPassable(
  action: ChantierAction,
  allChantiers: Chantier[],
  allActions: ChantierAction[]
): void {
  const current = action.milestones?.currentMilestone ?? "E0";
  const merged = mergeMilestoneChecklistItems(
    current,
    action.milestones?.checklists[current] ?? [],
    resolveMilestoneAutoFlags(current, action, allChantiers, allActions),
    action.customMilestoneActions?.[current] ?? [],
    action.excludedMilestoneItems?.[current] ?? []
  );
  const { canPass, reasons } = canPassMilestone(current, merged);
  if (!canPass) {
    throw new Error(
      `Le jalon ${displayMilestoneId(current)} du projet "${action.id}" n'est plus complet : ${reasons.join(", ")}`
    );
  }
}

/**
 * Patch qui fait RÉELLEMENT avancer le jalon : `currentMilestone` → `targetMilestone`, l'ancien
 * jalon courant ajouté à `passedMilestones` s'il n'y est pas, marqueur `milestoneApproval` retiré.
 * Lève si `targetMilestone` n'est pas strictement après le jalon courant (demande périmée).
 * Pure : l'appelant persiste le patch.
 */
export function advanceMilestone(
  action: Pick<ChantierAction, "milestones">,
  targetMilestone: MilestoneId
): Pick<ChantierAction, "milestones" | "milestoneApproval"> {
  const before: ChantierMilestoneState = action.milestones ?? {
    currentMilestone: "E0",
    passedMilestones: [],
    checklists: {},
  };
  if (
    MILESTONE_ORDER.indexOf(targetMilestone) <= MILESTONE_ORDER.indexOf(before.currentMilestone)
  ) {
    throw new Error(
      `Le projet est déjà au jalon ${displayMilestoneId(before.currentMilestone)} ou au-delà : demande périmée`
    );
  }
  const passedMilestones = before.passedMilestones.includes(before.currentMilestone)
    ? before.passedMilestones
    : [...before.passedMilestones, before.currentMilestone];
  return {
    milestones: { ...before, currentMilestone: targetMilestone, passedMilestones },
    milestoneApproval: undefined,
  };
}

/**
 * État de TRANSITION de jalon d'un projet (round "passage de jalon explicite") — répond à « que se
 * passe-t-il maintenant ? » quand la check-list du jalon courant atteint 100 % :
 *  - `"pending"`     une demande de passage est en cours (`action.milestoneApproval`) : le projet
 *                    attend la confirmation du responsable du chantier (prioritaire sur tout le
 *                    reste — même si la check-list a régressé depuis) ;
 *  - `"ready"`       la check-list du jalon courant est complète (`canPassMilestone`, même fusion
 *                    que `milestonePassageTarget`) et il existe un jalon suivant : la demande
 *                    « Demander la validation du passage en J{n+1} » peut être envoyée ;
 *  - `"final"`       check-list complète mais déjà au dernier jalon (J4) : plus rien à demander ;
 *  - `"in_progress"` check-list incomplète.
 * Aucune avancée automatique : ce n'est qu'un état dérivé, la demande reste un geste explicite.
 *
 * `autoFlags` : valeurs LIVE des items automatiques du jalon courant (`resolveMilestoneAutoFlags`).
 * Un appelant qui n'a pas `allChantiers`/`allActions` sous la main peut l'omettre — mode dégradé
 * SÛR : un item auto sans valeur compte comme non répondu, donc jamais de faux `"ready"`.
 */
export type MilestoneTransitionState =
  | { status: "in_progress"; from: MilestoneId; to?: MilestoneId }
  | { status: "ready"; from: MilestoneId; to: MilestoneId }
  | { status: "final"; from: MilestoneId }
  | {
      status: "pending";
      from: MilestoneId;
      to: MilestoneId;
      requestedBy: string;
      requestedAt: string;
    };

export function milestoneTransitionState(
  action: Pick<
    ChantierAction,
    "milestones" | "milestoneApproval" | "customMilestoneActions" | "excludedMilestoneItems"
  >,
  autoFlags: Record<string, number> = {}
): MilestoneTransitionState {
  const from = action.milestones?.currentMilestone ?? "E0";
  const next = MILESTONE_ORDER[MILESTONE_ORDER.indexOf(from) + 1] as MilestoneId | undefined;
  if (action.milestoneApproval) {
    return {
      status: "pending",
      from,
      to: action.milestoneApproval.targetMilestone,
      requestedBy: action.milestoneApproval.requestedBy,
      requestedAt: action.milestoneApproval.requestedAt,
    };
  }
  const merged = mergeMilestoneChecklistItems(
    from,
    action.milestones?.checklists[from] ?? [],
    autoFlags,
    action.customMilestoneActions?.[from] ?? [],
    action.excludedMilestoneItems?.[from] ?? []
  );
  const { canPass } = canPassMilestone(from, merged);
  if (!canPass)
    return next ? { status: "in_progress", from, to: next } : { status: "in_progress", from };
  return next ? { status: "ready", from, to: next } : { status: "final", from };
}

/** Un des 3 buckets d'affichage discrets d'un `progressPct` (0-100, voir
 *  `MilestoneChecklistItem.progressPct`) — jamais de dégradé continu. Seul point de vérité pour ce
 *  bucketing (round 14) : anciennement dupliqué localement dans `MilestoneChecklistPanel.tsx`
 *  (`bucketForPct`), extrait ici car d'autres écrans du même round en ont besoin. */
export type ProgressBucket = "empty" | "red" | "amber" | "green";

/** Bucket d'affichage d'un `progressPct` : `undefined` (pas encore déclaré) → `"empty"`, `0` →
 *  `"red"`, `100` → `"green"`, toute valeur strictement entre les deux → `"amber"` (jamais de
 *  dégradé). Même logique que l'ancien `bucketForPct` local de `MilestoneChecklistPanel.tsx`. */
export function progressBucket(pct: number | undefined): ProgressBucket {
  if (pct === undefined) return "empty";
  if (pct <= 0) return "red";
  if (pct >= 100) return "green";
  return "amber";
}

/**
 * Poids (delta, PAS cumulatif) de chaque jalon dans `milestoneProgressPct` (round 19) — donné
 * directement par le PO : J0/J1 (E0/E1) sont des étapes de cadrage très légères, J2 (E2) un peu
 * plus engageant, J3 (E3) la vraie phase d'exécution (qui concentre la moitié du poids total), J4
 * (E4) la clôture. Somme = 100. Les CLÉS restent les valeurs INTERNES `"E0"`–`"E4"` (voir
 * `displayMilestoneId` ci-dessus) : seul l'AFFICHAGE change, jamais ce référentiel.
 *
 * Remplace l'ancien poids UNIFORME (20 partout) que `milestoneProgressPct` appliquait jusqu'ici.
 */
export const MILESTONE_WEIGHT_DELTA: Record<MilestoneId, number> = {
  E0: 10,
  E1: 10,
  E2: 15,
  E3: 50,
  E4: 15,
};

/**
 * Avancement en pourcentage (0-100) d'une entité portant un état de jalon E0→E4 — remplace
 * `chantierProgress()` sur les affichages de progression, comme avant round 5.
 *
 * Round 19 : poids VARIABLE par jalon (`MILESTONE_WEIGHT_DELTA` ci-dessus), remplaçant l'ancien
 * poids uniforme de 20 par jalon. Calcul :
 *  1. Pour chaque jalon déjà validé (`passedMilestones`), crédit plein de SON PROPRE poids
 *     (`MILESTONE_WEIGHT_DELTA[m]`) — plus seulement `20`.
 *  2. PLUS, si le jalon COURANT n'est PAS déjà dans `passedMilestones` (garde-fou anti double
 *     comptage : seul cas de recoupement possible, une fois E4 validé, où le jalon courant reste
 *     E4 faute de jalon suivant) : un crédit partiel `MILESTONE_WEIGHT_DELTA[currentMilestone] *
 *     moyenne / 100`, où `moyenne` porte sur TOUS les items définis pour ce jalon dans
 *     `MILESTONE_CHECKLISTS` (pas seulement ceux déjà répondus — un item absent de
 *     `checklists[currentMilestone]` compte pour `0`, comme un item répondu à `0`) — même
 *     mécanique de crédit partiel qu'avant round 19, simplement mise à l'échelle du poids variable
 *     du jalon courant au lieu du `20` fixe.
 *  3. Total plafonné à 100 et arrondi (`Math.round`) — la somme des poids validés est exacte mais
 *     le crédit partiel de l'étape 2 ne l'est en général pas.
 *
 * **Items automatiques** (`ChecklistItemDef.auto`) : cette fonction reste typée
 * STRUCTURELLEMENT (`{ milestones? }` seulement, voir le paragraphe round 7 ci-dessous) et n'a
 * donc PAS accès à `allChantiers`/`allActions`, nécessaires à `resolveMilestoneAutoFlags` pour
 * calculer `dependencyAlert`/`effortComplete`. Le paramètre optionnel `autoValues` permet à un
 * appelant QUI A ce contexte de lui injecter le résultat déjà calculé de
 * `resolveMilestoneAutoFlags(milestones.currentMilestone, ...)` pour une moyenne exacte ; omis, un
 * item auto est traité comme un item manuel non répondu (compte pour `0`) — dégradé mais jamais
 * dans le sens d'une survalorisation. `chantierMilestoneProgressPct` (ci-dessous) n'a lui-même pas
 * accès à la liste des chantiers et appelle donc systématiquement en mode dégradé. Un `progressPct`
 * manuel déjà déclaré sur un item, même marqué `auto`, prime TOUJOURS sur `autoValues` (cas
 * résiduel seulement : l'UI n'écrit normalement jamais de valeur manuelle sur un item auto).
 *
 * Round 7 : retypé STRUCTURELLEMENT (plutôt que `Pick<Chantier, "milestones">`) pour accepter
 * aussi bien un `Chantier` (usage historique, `@deprecated` — voir son commentaire) qu'un
 * `ChantierAction`/levier (nouvel usage round 7, un jalon par levier) sans duplication de fonction.
 *
 * Aucun `milestones` du tout : `0` (comportement inchangé depuis round 5).
 */
type MilestoneProgressEntity = {
  milestones?: ChantierMilestoneState;
  customMilestoneActions?: ChantierAction["customMilestoneActions"];
  excludedMilestoneItems?: ChantierAction["excludedMilestoneItems"];
};

/**
 * Remplissage MOYEN (0-100, non arrondi) de la check-list du jalon COURANT — sur la MÊME liste que
 * la porte de validation (`mergeMilestoneChecklistItems` : items exclus par ce projet retirés,
 * actions personnalisées ajoutées). Un `progressPct` stocké prime ; sinon valeur auto live
 * (`autoValues`) pour un item automatique ; sinon 0. Aucun item (tous exclus) : 100 — rien ne
 * bloque la porte. Utilisé par `milestoneProgressPct` et par le stepper de la fiche chantier.
 */
export function currentMilestoneFillPct(
  entity: MilestoneProgressEntity,
  autoValues?: Record<string, number>
): number {
  const current = entity.milestones?.currentMilestone ?? "E0";
  const stored = entity.milestones?.checklists[current] ?? [];
  const items = mergeMilestoneChecklistItems(
    current,
    stored,
    {},
    entity.customMilestoneActions?.[current] ?? [],
    entity.excludedMilestoneItems?.[current] ?? []
  );
  if (items.length === 0) return 100;
  const autoIds = new Set(
    MILESTONE_CHECKLISTS[current].filter((def) => def.auto).map((def) => def.itemId)
  );
  let sum = 0;
  for (const item of items) {
    const storedPct = stored.find((i) => i.itemId === item.itemId)?.progressPct;
    sum +=
      storedPct !== undefined
        ? storedPct
        : ((autoIds.has(item.itemId) ? autoValues?.[item.itemId] : undefined) ?? 0);
  }
  return sum / items.length;
}

export function milestoneProgressPct(
  entity: MilestoneProgressEntity,
  /** Valeurs 0/100 des items `auto` du jalon COURANT, typiquement le résultat de
   *  `resolveMilestoneAutoFlags(entity.milestones.currentMilestone, ...)` — voir le paragraphe
   *  "Items automatiques" ci-dessus. Omis = items auto traités comme non répondus (0). */
  autoValues?: Record<string, number>
): number {
  const milestones = entity.milestones;
  if (!milestones) return 0;

  let total = milestones.passedMilestones.reduce((sum, m) => sum + MILESTONE_WEIGHT_DELTA[m], 0);

  if (!milestones.passedMilestones.includes(milestones.currentMilestone)) {
    // MÊME liste que la porte de validation (voir `currentMilestoneFillPct`) — sans quoi un jalon
    // final complet (porte "final") pouvait plafonner à 93 % et laisser le projet "en retard"
    // pour toujours.
    const average = currentMilestoneFillPct(entity, autoValues);
    total += (MILESTONE_WEIGHT_DELTA[milestones.currentMilestone] * average) / 100;
  }

  return Math.min(100, Math.round(total));
}

/** Résolveur d'avancement d'un projet (0-100) — voir `projetProgressResolver`. */
export type ProjetProgressLookup = (action: ChantierAction) => number;

/**
 * Avancement COMPLET d'un projet : `milestoneProgressPct` avec les valeurs LIVE de ses items
 * automatiques (`resolveMilestoneAutoFlags`). Seul chiffre à afficher partout (tableau de bord,
 * accordéon, Gantt, fiche chantier, feuille de route) — voir `projetProgressResolver` pour
 * résoudre de nombreux projets à moindre coût.
 */
export function projetProgressPct(
  action: ChantierAction,
  allChantiers: Chantier[],
  allActions: ChantierAction[],
  precomputedAlerts?: ChantierDependencyAlert[]
): number {
  return milestoneProgressPct(
    action,
    resolveMilestoneAutoFlags(
      action.milestones?.currentMilestone ?? "E0",
      action,
      allChantiers,
      allActions,
      precomputedAlerts
    )
  );
}

/**
 * Fabrique un résolveur mémoïsé `action → avancement` (`projetProgressPct`) sur un jeu
 * chantiers/projets donné : les alertes de dépendance sont calculées UNE fois, chaque projet au
 * plus une fois. `allChantiers`/`allActions` doivent couvrir tout le PROGRAMME (et non la seule
 * sélection filtrée de l'écran) pour que les items automatiques soient justes.
 */
export function projetProgressResolver(
  allChantiers: Chantier[],
  allActions: ChantierAction[],
  flagsOf: ProjetAutoFlagsLookup = projetAutoFlagsResolver(allChantiers, allActions)
): ProjetProgressLookup {
  const cache = new Map<string, number>();
  return (action) => {
    const cached = cache.get(action.id);
    if (cached !== undefined) return cached;
    const pct = milestoneProgressPct(action, flagsOf(action));
    cache.set(action.id, pct);
    return pct;
  };
}

/** Résolveur des valeurs LIVE des items automatiques du jalon COURANT d'un projet. */
export type ProjetAutoFlagsLookup = (action: ChantierAction) => Record<string, number>;

/** Pendant de `projetProgressResolver` pour les items automatiques eux-mêmes (état de transition
 *  `milestoneTransitionState`, remplissage du jalon courant) — alertes calculées une fois. */
export function projetAutoFlagsResolver(
  allChantiers: Chantier[],
  allActions: ChantierAction[]
): ProjetAutoFlagsLookup {
  let alerts: ChantierDependencyAlert[] | undefined;
  const cache = new Map<string, Record<string, number>>();
  return (action) => {
    const cached = cache.get(action.id);
    if (cached) return cached;
    alerts ??= chantierDependencyAlerts(allChantiers, allActions);
    const flags = resolveMilestoneAutoFlags(
      action.milestones?.currentMilestone ?? "E0",
      action,
      allChantiers,
      allActions,
      alerts
    );
    cache.set(action.id, flags);
    return flags;
  };
}

/**
 * Avancement AGRÉGÉ d'un chantier en pourcentage (round 7) — moyenne de `milestoneProgressPct`
 * sur les leviers (`ChantierAction`) du chantier, décision actée avec le PO ("agrégation chantier
 * = moyenne des leviers"). Remplace `milestoneProgressPct(chantier)` sur tous les points d'appel
 * historiques : le suivi E0→E4 vit désormais par levier, `Chantier.milestones` est `@deprecated`.
 *
 * Round 18 : le suivi E0→E4 s'applique UNIVERSELLEMENT à tous les leviers d'un chantier, avec ou
 * sans KPI rattaché (l'ancien aiguillage vers un kanban classique pour les leviers sans
 * `indicatorId` a été supprimé). La moyenne porte donc sur TOUS les leviers du chantier
 * (`a.chantierId === chantier.id`) — un levier sans `.milestones` encore renseigné contribue
 * naturellement 0 % / E0 via le repli existant de `milestoneProgressPct`, pas besoin de le filtrer.
 *
 * 0 si le chantier n'a aucun levier du tout — même parti pris que `chantierProgress()`, pas de
 * division par zéro déguisée. Arrondi (`Math.round`) car `milestoneProgressPct` ne retourne que des
 * multiples de 20 mais leur moyenne ne l'est en général pas.
 */
export function chantierMilestoneProgressPct(
  chantier: Pick<Chantier, "id">,
  actions: ChantierAction[],
  progressOf: ProjetProgressLookup = (a) => milestoneProgressPct(a)
): number {
  const own = actions.filter((a) => a.chantierId === chantier.id);
  if (own.length === 0) return 0;
  const total = own.reduce((sum, action) => sum + progressOf(action), 0);
  return Math.round(total / own.length);
}

/**
 * Avancement AGRÉGÉ d'un chantier, PONDÉRÉ par le poids déclaré de chacun de ses projets
 * (`ChantierAction.chantierWeightPct`, round "projet weighting") — remplace
 * `chantierMilestoneProgressPct` ci-dessus (moyenne SIMPLE, non pondérée) comme figure de
 * progression réellement affichée sur les écrans que ce round modifie (`ChantierDetailPanel.tsx`,
 * `ChantierGantt.tsx`). `chantierMilestoneProgressPct` reste exportée et INCHANGÉE — un point d'appel
 * hors du périmètre de ce round (`ProgramRoadmap.tsx`, qui recalcule sa propre moyenne inline plutôt
 * que d'importer l'une ou l'autre, voir son commentaire) continue de s'appuyer sur elle sans effet
 * de bord.
 *
 * Algorithme IDENTIQUE à `lib/workstreamLogic.ts::workstreamDeclaredProgress` (même mécanique de
 * poids déclaratif, adaptée au domaine chantier/projet plutôt que workstream/levier) :
 *  1. poids déclarés (`chantierWeightPct`) sommés tels quels ;
 *  2. le reste jusqu'à 100 (jamais négatif) est réparti À PARTS ÉGALES entre les projets SANS poids
 *     déclaré — un projet sans `chantierWeightPct` n'est donc jamais compté pour 0, mais reçoit un
 *     poids implicite égal aux autres projets non pondérés ;
 *  3. moyenne pondérée de `milestoneProgressPct(action)` (degré dégradé — pas d'`autoValues`, cette
 *     fonction n'a pas accès à `allChantiers`/`allActions`, même limitation assumée que
 *     `chantierMilestoneProgressPct` ci-dessus, voir son commentaire round 7) par ce poids (déclaré
 *     ou implicite) ;
 *  4. repli en moyenne SIMPLE si le poids total effectif vaut 0 (tous les poids déclarés sont à 0 ET
 *     aucun projet non pondéré pour absorber un reste — cas limite, mais `workstreamDeclaredProgress`
 *     s'en prémunit, cette fonction fait de même pour ne jamais diviser par zéro).
 *
 * Contrairement à `workstreamDeclaredProgress` (qui retourne `null`, et EXCLUT du calcul, un levier
 * sans aucune action déclarée) : `milestoneProgressPct` ne connaît PAS de notion de "projet non
 * déclaré" à exclure — un projet sans `.milestones` renseigné vaut simplement 0 (voir son propre
 * commentaire), jamais `null`. Cette fonction retourne donc toujours un `number` (jamais `null`),
 * TOUS les projets du chantier participent à la moyenne (pondérée ou implicite), aucun n'est exclu —
 * seule la notion de POIDS (pas de progression) peut être "non déclarée" ici. 0 si le chantier n'a
 * aucun projet du tout — même parti pris que `chantierMilestoneProgressPct`.
 */
export function chantierDeclaredProgress(
  chantierId: string,
  actions: ChantierAction[],
  /** Avancement de chaque projet — passer `projetProgressResolver(allChantiers, allActions)`
   *  pour inclure les items automatiques (chiffre identique partout). Omis = mode dégradé. */
  progressOf: ProjetProgressLookup = (a) => milestoneProgressPct(a)
): number {
  const own = actions.filter((a) => a.chantierId === chantierId);
  if (own.length === 0) return 0;

  const withProgress = own.map((action) => ({ action, progress: progressOf(action) }));
  const weights = effectiveProjetWeights(own);

  let weightedSum = 0;
  let totalWeight = 0;
  for (const { action, progress } of withProgress) {
    const weight = weights.get(action.id) ?? 0;
    weightedSum += weight * progress;
    totalWeight += weight;
  }
  if (totalWeight === 0) {
    // Tous les poids déclarés valent 0 (ou aucun poids, aucun reste) — repli en moyenne simple.
    return Math.round(withProgress.reduce((acc, x) => acc + x.progress, 0) / withProgress.length);
  }
  return Math.round(weightedSum / totalWeight);
}

/**
 * Poids EFFECTIF de chaque projet d'un chantier (même clé que `chantierDeclaredProgress`) :
 *  - poids déclaré (`chantierWeightPct`) tel quel ;
 *  - projets sans poids : le reste jusqu'à 100 réparti à parts égales ;
 *  - si les poids déclarés atteignent ou DÉPASSENT 100 alors qu'il reste des projets non pondérés,
 *    ceux-ci reçoivent la MOYENNE des poids déclarés (au lieu d'un poids nul qui les rendait
 *    invisibles) — la division finale par le poids total normalise l'ensemble.
 */
export function effectiveProjetWeights(
  own: Pick<ChantierAction, "id" | "chantierWeightPct">[]
): Map<string, number> {
  const declared = own.filter((a) => typeof a.chantierWeightPct === "number");
  const declaredWeightSum = declared.reduce((acc, a) => acc + (a.chantierWeightPct ?? 0), 0);
  const undeclaredCount = own.length - declared.length;
  const remainingWeight = 100 - declaredWeightSum;
  let implicitWeight = 0;
  if (undeclaredCount > 0) {
    implicitWeight =
      remainingWeight > 0
        ? remainingWeight / undeclaredCount
        : declared.length > 0
          ? declaredWeightSum / declared.length
          : 0;
  }
  const out = new Map<string, number>();
  for (const a of own) {
    out.set(a.id, typeof a.chantierWeightPct === "number" ? a.chantierWeightPct : implicitWeight);
  }
  return out;
}

/**
 * Avancement d'un AXE (feuille de route) — moyenne simple, arrondie, des avancements de ses
 * chantiers (`chantierDeclaredProgress`, le même chiffre que la fiche chantier). Un chantier
 * multi-axe compte sous chacun de ses axes. 0 si l'axe n'a aucun chantier.
 */
export function axisProgressPct(
  axisId: string,
  chantiers: Pick<Chantier, "id" | "axisIds">[],
  actions: ChantierAction[],
  progressOf?: ProjetProgressLookup
): number {
  const own = chantiers.filter((c) => c.axisIds.includes(axisId));
  if (own.length === 0) return 0;
  const total = own.reduce(
    (sum, c) => sum + chantierDeclaredProgress(c.id, actions, progressOf),
    0
  );
  return Math.round(total / own.length);
}

/** Nombre de jalons franchis d'un projet, et total de jalons (E0→E4). */
export function projetMilestoneCounts(action: Pick<ChantierAction, "milestones">): {
  passed: number;
  total: number;
} {
  return {
    passed: action.milestones?.passedMilestones.length ?? 0,
    total: Object.keys(MILESTONE_WEIGHT_DELTA).length,
  };
}

// ─── Retard d'un projet/chantier (round 20) ────────────────────────────────────────────────────

/**
 * Un PROJET est-il en retard ? Vrai si sa date de fin (`ChantierAction.end`) est STRICTEMENT
 * passée (le jour même de l'échéance n'est pas encore en retard — cohérent avec `daysBetween`, qui
 * ne compte qu'à partir du lendemain) ET que son avancement déclaratif (`milestoneProgressPct`,
 * jalons E0→E4) n'a pas atteint 100% — un projet terminé APRÈS son échéance initiale n'est donc
 * jamais "en retard" au sens de cette fonction, seulement un projet encore ouvert au-delà de sa
 * date de fin prévue.
 *
 * `today` est un paramètre injectable (défaut `new Date()`) uniquement pour les tests — aucun
 * appelant applicatif ne doit le renseigner.
 */
/** `progressPct` est fourni par l'appelant plutôt que recalculé ici : `milestoneProgressPct` seule
 *  (sans `autoValues` résolus via `resolveMilestoneAutoFlags`) peut différer du pourcentage RÉEL
 *  affiché à l'écran (ex. `programRoadmap`, qui résout les auto-flags) — un appel interne aveugle
 *  ferait apparaître un projet "en retard" alors même que l'écran affiche déjà 100% à côté. En
 *  exigeant le même `progressPct` que celui affiché, retard et pourcentage ne peuvent plus diverger. */
export function isProjetLate(
  action: ChantierAction,
  progressPct: number,
  today: Date = new Date()
): boolean {
  // Date LOCALE (`todayISO`), jamais `toISOString()` (UTC) : même "aujourd'hui" que les livrables.
  return daysBetween(action.end, todayISO(today)) > 0 && progressPct < 100;
}

/** Un CHANTIER est-il en retard ? Vrai si au moins un de ses projets l'est (`isProjetLate`
 *  ci-dessus) — dérivée directe, aucune notion de retard propre au chantier. Même parti pris que
 *  `isProjetLate` : `progressPct` est porté par chaque entrée plutôt que recalculé ici. */
export function isChantierLate(
  chantier: Pick<Chantier, "id">,
  actionsWithProgress: { action: ChantierAction; progressPct: number }[],
  today?: Date
): boolean {
  return actionsWithProgress.some(
    ({ action, progressPct }) =>
      action.chantierId === chantier.id && isProjetLate(action, progressPct, today)
  );
}

// ─── Prérequis bloquants du programme (round 9) ────────────────────────────────────────────────

/**
 * Enveloppe `canStartAction` (voir plus haut) sur TOUTES les actions passées, ne conservant que
 * celles effectivement bloquées — alimente le nouveau bloc "prérequis en attente" du dashboard,
 * en parallèle de `chantierDependencyAlerts`. Fonction pure, même parti pris purement informatif
 * que `canStartAction` (rien n'empêche réellement une action bloquée de démarrer).
 */
export function programBlockedActions(
  actions: ChantierAction[],
  progressOf?: ProjetProgressLookup
): { action: ChantierAction; reasons: string[] }[] {
  return actions
    .map((action) => ({ action, ...canStartAction(action, actions, progressOf) }))
    .filter((r) => r.blocked)
    .map(({ action, reasons }) => ({ action, reasons }));
}

// ─── Couleur déterministe par chantier (round 8) ───────────────────────────────────────────────

/** Palette catégorielle fixe (fond plein) — couleurs de la CHARTE BearingPoint uniquement (classes
 *  arbitraires `bg-[#hex]`, littérales pour le JIT Tailwind), alignées sur `CHANTIER_COLOR_HEX_PALETTE`. Purement
 *  catégorielle, sans rapport avec un statut à-risque (`rag-*`). Ordre arbitraire mais stable :
 *  ne jamais réordonner ce tableau, `colorForChantier`/`colorForDepartment` en dépendent pour
 *  rester déterministes dans le temps. */
const CHANTIER_COLOR_PALETTE = [
  "bg-[#421799]",
  "bg-[#FF3C47]",
  "bg-[#806659]",
  "bg-[#FF797B]",
  "bg-[#320300]",
  "bg-[#A99E9A]",
  "bg-[#991D1F]",
  "bg-[#FFB1B5]",
  "bg-[#1A1A1A]",
  "bg-[#CCC1BD]",
] as const;

/**
 * Couleur déterministe d'un chantier, dérivée de son id — round 8, alimente la nouvelle vue E0→E4
 * par axe ET le kanban classique (widget dashboard "État des lieux") pour qu'un même chantier
 * affiche systématiquement la MÊME couleur dans les deux blocs, sans nouveau champ Firestore (pas
 * de couleur choisie à la main, contrairement à `StrategicAxis.color`).
 *
 * Hash volontairement trivial (somme des codes de caractère de l'id, modulo la taille de la
 * palette) : aucune exigence de distribution uniforme, seulement de DÉTERMINISME (même id ⇒ même
 * couleur, à tout moment, sur tout composant) — voir le test associé dans
 * `lib/__tests__/axisLogic.test.ts`.
 */
/** Index déterministe dans `CHANTIER_COLOR_PALETTE`/`CHANTIER_COLOR_HEX_PALETTE` (même hash pour
 *  les deux, tableaux tenus dans le MÊME ordre) — extrait de `colorForChantier` pour que
 *  `hexForChantier` retombe exactement sur la même couleur que sa classe Tailwind, sans dupliquer
 *  le calcul de hash. */
function chantierColorIndex(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i += 1) sum += id.charCodeAt(i);
  return sum % CHANTIER_COLOR_PALETTE.length;
}

export function colorForChantier(chantierId: string): string {
  return CHANTIER_COLOR_PALETTE[chantierColorIndex(chantierId)];
}

/** Même hash déterministe/même palette que `colorForChantier` ci-dessus, réutilisée telle quelle
 *  pour un nom d'équipe/département (round 13 — remplace `STAFFING_FUNCTION_COLORS`, la palette à
 *  9 couleurs figées de l'ancienne union fermée `StaffingFunction`, retirée : la liste d'équipes
 *  vient désormais de la base ETP, à cardinalité arbitraire, donc pas de palette à main levée
 *  possible). Alias distinct (pas un simple ré-export de `colorForChantier`) pour que les deux
 *  usages restent lisibles séparément aux points d'appel. */
export function colorForDepartment(departmentName: string): string {
  return colorForChantier(departmentName);
}

/** Équivalents hex des classes `bg-*-500` de `CHANTIER_COLOR_PALETTE` ci-dessus, DANS LE MÊME
 *  ORDRE (valeurs figées de la palette Tailwind par défaut v3 — `blue-500` = `#3b82f6`, etc.) —
 *  pour les API qui ont besoin d'une vraie couleur (ex. `fill`/`stroke` Recharts) plutôt que d'une
 *  classe CSS (round 19, graphiques ETP par période/par axe). Ne JAMAIS réordonner indépendamment
 *  de `CHANTIER_COLOR_PALETTE` : les deux tableaux doivent rester alignés index par index pour
 *  qu'un même chantier/équipe affiche la MÊME couleur en CSS (barres plates existantes) et en
 *  Recharts (nouveaux graphiques). */
const CHANTIER_COLOR_HEX_PALETTE = [
  "#421799", // --bp-purple
  "#FF3C47", // --bp-coral
  "#806659", // --bp-warm-brown
  "#FF797B", // --bp-coral-pink
  "#320300", // --bp-deep-red
  "#A99E9A", // --bp-warm-taupe
  "#991D1F", // --bp-red-brick
  "#FFB1B5", // --bp-light-pink
  "#1A1A1A", // encre
  "#CCC1BD", // --bp-warm-gray
] as const;

/** Équivalent hex de `colorForChantier` — même hash, même index, même ordre de palette — pour les
 *  graphiques Recharts (ETP par période/par axe) qui ne peuvent pas consommer une classe
 *  Tailwind. */
export function hexForChantier(chantierId: string): string {
  return CHANTIER_COLOR_HEX_PALETTE[chantierColorIndex(chantierId)];
}

/** Équivalent hex de `colorForDepartment` — voir `hexForChantier` ci-dessus. */
export function hexForDepartment(departmentName: string): string {
  return hexForChantier(departmentName);
}

// ─── Nuances de chantier dérivées de la couleur d'axe ──────────────────────────────────────────

/** Couleur de repli quand un axe n'a pas de couleur valide — taupe BearingPoint
 *  (`--bp-warm-taupe`), même valeur que les `FALLBACK_COLOR` locaux de `ChantierGantt.tsx`/
 *  `ProgramRoadmap.tsx`. */
export const AXIS_FALLBACK_COLOR = "#a99e9a";

/** `#rgb` / `#rrggbb` → `[r, g, b]` ; `null` pour toute autre notation. Source unique, ré-exportée
 *  telle quelle par `components/strategic/TimelineBars.tsx` pour ses consommateurs historiques. */
export function hexToRgb(color: string): [number, number, number] | null {
  const hex = color.trim().replace("#", "");
  if (hex.length === 3 && /^[0-9a-f]{3}$/i.test(hex)) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  if (hex.length === 6 && /^[0-9a-f]{6}$/i.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return null;
}

/** Échelle de nuances d'un chantier au sein de son axe : >0 = mélange avec du BLANC (plus clair),
 *  <0 = mélange avec du NOIR (plus sombre), 0 = la couleur d'axe elle-même. Alterne clair/sombre
 *  pour que deux chantiers voisins restent bien distincts ; cyclique au-delà de sa longueur. */
const CHANTIER_SHADE_LADDER = [0, 0.35, -0.3, 0.55, -0.5, 0.2, -0.15] as const;

/**
 * Nuance (hex `#rrggbb`) d'un chantier dérivée de la couleur de SON axe — remplace, sur les vues
 * du Plan stratégique (onglet "Avancement", accordéon "Vue par axe", Gantt), l'ancienne palette
 * catégorielle Tailwind hors charte (`colorForChantier`). Index 0 = couleur d'axe telle quelle,
 * puis mélanges alternés vers le blanc/le noir (`CHANTIER_SHADE_LADDER`). Couleur d'axe invalide
 * ou absente → `AXIS_FALLBACK_COLOR`.
 */
export function chantierShadeForAxis(axisColor: string | undefined, index: number): string {
  const rgb = (axisColor ? hexToRgb(axisColor) : null) ?? hexToRgb(AXIS_FALLBACK_COLOR)!;
  const safeIndex = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  const step = CHANTIER_SHADE_LADDER[safeIndex % CHANTIER_SHADE_LADDER.length];
  const target = step >= 0 ? 255 : 0;
  const amount = Math.abs(step);
  return `#${rgb
    .map((c) =>
      Math.round(c + (target - c) * amount)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

/** Ordre CANONIQUE des chantiers d'un axe pour l'attribution des nuances — indépendant de l'ordre
 *  de rendu propre à chaque vue (Gantt trié par date, filtres du dashboard…) pour qu'un chantier
 *  ait la MÊME nuance partout : date de création puis id (un chantier ajouté plus tard prend la
 *  nuance suivante sans décaler celles des chantiers existants). */
function compareChantiersForShade(a: Chantier, b: Chantier): number {
  return (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id);
}

/** Nuance de chaque chantier d'UN axe (`chantierId` → hex). `axisChantiers` = les chantiers de cet
 *  axe (non filtrés par la vue, sinon les nuances glisseraient au gré des filtres). */
export function chantierShadesForAxis(
  axisColor: string | undefined,
  axisChantiers: Chantier[]
): Map<string, string> {
  const map = new Map<string, string>();
  [...axisChantiers]
    .sort(compareChantiersForShade)
    .forEach((chantier, index) => map.set(chantier.id, chantierShadeForAxis(axisColor, index)));
  return map;
}

/** `axisId` → (`chantierId` → nuance) pour tous les axes — un chantier multi-axes (`axisIds`)
 *  reçoit une nuance dans CHAQUE axe auquel il appartient. */
export function chantierShadesByAxis(
  axes: StrategicAxis[],
  chantiers: Chantier[]
): Map<string, Map<string, string>> {
  const byAxis = new Map<string, Map<string, string>>();
  for (const axis of axes) {
    byAxis.set(
      axis.id,
      chantierShadesForAxis(
        axis.color,
        chantiers.filter((c) => c.axisIds.includes(axis.id))
      )
    );
  }
  return byAxis;
}

// ─── Staffing par période (round 7) ────────────────────────────────────────────────────────────

/** Une entrée de staffing par période/fonction, alimentant `StaffingPeriodBreakdown.tsx`. */
export type StaffingPeriodBucket = {
  /** Étiquette de période, format lexicographiquement triable — même convention que
   *  `IndicatorMeasurement.period` : `"YYYY-Q#"` (trimestriel), `"YYYY-S#"` (semestriel),
   *  `"YYYY"` (annuel). */
  period: string;
  totalFte: number;
  /** Clé = nom d'équipe/département (`ChantierStaffing.function`, texte libre — voir
   *  `types/index.ts`), plus l'ancienne union fermée à 9 valeurs (round 13). */
  byFunction: Record<string, number>;
};

/** Calcule le libellé de période (voir `StaffingPeriodBucket.period`) d'une date ISO pour une
 *  granularité donnée. Exportée (round 21, cross-filtering « Effectifs & budget ») : réutilisée
 *  directement par `StaffingPeriodBreakdown.tsx` (détail par chantier du tooltip) et par
 *  `EffectifsPageClient.tsx` (filtre « Répartition par axe » sur la période cliquée dans le
 *  graphique période) — les deux devaient auparavant dupliquer cette logique localement. */
export function periodLabelForDate(
  isoDate: string,
  granularity: "quarterly" | "semiannual" | "annual"
): string {
  const year = isoDate.slice(0, 4);
  const month = Number(isoDate.slice(5, 7)); // 1-12
  switch (granularity) {
    case "quarterly": {
      const quarter = Math.floor((month - 1) / 3) + 1;
      return `${year}-Q${quarter}`;
    }
    case "semiannual": {
      const semester = month <= 6 ? 1 : 2;
      return `${year}-S${semester}`;
    }
    case "annual":
      return year;
  }
}

/**
 * Répartit les entrées de staffing DATÉES (`ChantierStaffing.startDate` défini) en buckets de
 * période calendaire, sommant les ETP par période et par période+fonction (round 7, page
 * Effectifs — vue trimestre/semestre/année). Les entrées sans `startDate` sont volontairement
 * IGNORÉES : un staffing "non daté" reste compté dans les totaux globaux existants
 * (`EffectifsPageClient.tsx`) mais ne peut pas être positionné dans le temps ici.
 *
 * Buckets triés chronologiquement croissant (tri lexicographique du `period`, cohérent avec
 * `sortMeasurementsByPeriod` — les trois formats retenus sont tous lexicographiquement ordonnés).
 *
 * Fonction pure, distincte de `DateRangePicker.summarizeRange` (qui répond à une question
 * différente — la durée d'une plage de dates, pas une répartition par période calendaire).
 */
export function staffingPeriodBuckets(
  entries: ChantierStaffing[],
  granularity: "quarterly" | "semiannual" | "annual"
): StaffingPeriodBucket[] {
  const byPeriod = new Map<string, StaffingPeriodBucket>();

  for (const entry of entries) {
    if (!entry.startDate) continue;
    const period = periodLabelForDate(entry.startDate, granularity);
    let bucket = byPeriod.get(period);
    if (!bucket) {
      bucket = { period, totalFte: 0, byFunction: {} };
      byPeriod.set(period, bucket);
    }
    bucket.totalFte += entry.fte;
    bucket.byFunction[entry.function] = (bucket.byFunction[entry.function] ?? 0) + entry.fte;
  }

  return Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period));
}

// ─── Numérotation globale des KPI (round 10) ───────────────────────────────────────────────────

/**
 * Numéro global, unique sur toute la plateforme, de chaque indicateur d'un Plan Stratégique.
 *
 * **Seul point de vérité pour la numérotation des KPI** : tout affichage d'un "numéro" d'indicateur
 * (cartes d'axe, page KPI elle-même, référence à un KPI lié depuis un levier) doit appeler CETTE
 * fonction plutôt que recalculer un numéro local/par-axe — faute de quoi le même indicateur
 * afficherait des numéros différents selon l'écran.
 *
 * Ordre — RÉPLIQUE EXACTEMENT le `grouped` useMemo de `app/(app)/kpi/KpiPageClient.tsx` (à ne
 * jamais faire diverger : toute évolution de cet ordre doit être portée dans les deux endroits, ou
 * mieux, `KpiPageClient.tsx` doit être migré pour consommer cette fonction) :
 *  1. `axes` dans son ordre d'apparition (jamais retrié).
 *  2. Pour chaque axe, d'abord ses indicateurs "macro" — `axisIndicators.filter((i) => !i.chantierId
 *     || !knownChantierIds.has(i.chantierId))` : un indicateur sans `chantierId`, OU dont le
 *     `chantierId` pointe un chantier qui n'existe plus (référence orpheline), compte comme macro —
 *     dans l'ordre de `indicators` (jamais retrié).
 *  3. Puis, pour ce même axe, ses chantiers dans l'ordre de `chantiers` (jamais retrié) ; pour
 *     chaque chantier dont `axisIds.includes(axis.id)` (un chantier multi-axe apparaît sous CHACUN
 *     de ses axes), ses indicateurs (`chantierId === chantier.id`) dans l'ordre de `indicators`.
 *  4. Le compteur ne se réinitialise JAMAIS entre deux axes : le premier indicateur du deuxième axe
 *     continue directement après le dernier numéro attribué au premier.
 *
 * Un indicateur dont l'`axisId` ne correspond à AUCUN axe de `axes` (axe supprimé, ou indicateur pas
 * encore rattaché) n'apparaît dans aucun groupe ci-dessus et ne reçoit donc pas de numéro — même
 * partition que `KpiPageClient.tsx`, où un tel indicateur est affiché à part, dans sa section
 * "orphelins", hors numérotation par axe.
 *
 * **Contrat de navigation (round 10)** : cliquer un numéro de KPI, où que ce soit sur la
 * plateforme, navigue vers `/kpi?indicator=<indicatorId>` — c'est la page `/kpi` qui lit ce
 * paramètre pour défiler jusqu'à la carte correspondante et la mettre en évidence. Cette fonction ne
 * fait que calculer le numéro ; le clic/la navigation eux-mêmes sont à la charge de chaque appelant.
 */
export function numberIndicators(
  axes: StrategicAxis[],
  chantiers: Chantier[],
  indicators: Indicator[]
): Map<string, number> {
  const numbers = new Map<string, number>();
  const knownChantierIds = new Set(chantiers.map((c) => c.id));
  let next = 1;

  for (const axis of axes) {
    const axisIndicators = indicators.filter((i) => i.axisId === axis.id);
    const macro = axisIndicators.filter(
      (i) => !i.chantierId || !knownChantierIds.has(i.chantierId)
    );
    for (const indicator of macro) {
      numbers.set(indicator.id, next);
      next += 1;
    }

    const byChantier = chantiers
      .filter((c) => c.axisIds.includes(axis.id))
      .map((chantier) => ({
        chantier,
        indicators: axisIndicators.filter((i) => i.chantierId === chantier.id),
      }))
      .filter((group) => group.indicators.length > 0);
    for (const group of byChantier) {
      for (const indicator of group.indicators) {
        numbers.set(indicator.id, next);
        next += 1;
      }
    }
  }

  return numbers;
}

// ─── Budget par projet (round 12) ──────────────────────────────────────────────────────────────
//
// Ces helpers DÉLÈGUENT tous à `rollupBudgets` (lib/budgetRollup.ts), seul point de vérité de la
// règle bottom-up projet → chantier → axe → programme. Conservés pour compat des appelants.

/** Budget ALLOUÉ d'un chantier = somme des budgets de ses projets (`ChantierAction.budget`, absent
 *  = 0). `Chantier.allocatedBudget` n'est PAS un budget alloué mais l'« enveloppe du chantier »
 *  (plafond indicatif) — voir lib/budgetRollup.ts. */
export function sumProjetBudgets(chantierId: string, actions: ChantierAction[]): number {
  return (
    rollupBudgets([], [{ id: chantierId, axisIds: [] }], actions).chantiers.get(chantierId)
      ?.allocated ?? 0
  );
}

/** Budget CONSOMMÉ d'un chantier = somme des `ChantierAction.consumedBudget` de ses projets
 *  (absent = 0). `Chantier.consumedBudget` (saisie manuelle historique) n'est plus lu. */
export function sumConsumedBudget(chantierId: string, actions: ChantierAction[]): number {
  return (
    rollupBudgets([], [{ id: chantierId, axisIds: [] }], actions).chantiers.get(chantierId)
      ?.consumed ?? 0
  );
}

/** Budget alloué TOTAL d'un programme = somme de ses projets DISTINCTS (un chantier multi-axe
 *  n'est jamais compté deux fois) — même valeur que `rollupBudgets(...).programme.allocated`. */
export function sumProgramProjetBudgets(
  programId: string,
  chantiers: Chantier[],
  actions: ChantierAction[]
): number {
  return rollupBudgets(
    [],
    chantiers.filter((c) => c.programId === programId),
    actions
  ).programme.allocated;
}

/**
 * Dépassement du budget prévisionnel total du programme (`Program.budget`) par son budget alloué
 * (somme des projets, voir `sumProgramProjetBudgets`) — `undefined` tant qu'aucun budget total n'a
 * été déclaré ou si le total ne le dépasse pas. Sinon, le montant du dépassement (> 0). SEULE
 * comparaison budgétaire au prévisionnel de l'app (puce du dashboard et alerte d'AppShell).
 */
export function programBudgetOverrun(
  program: Pick<Program, "id" | "budget">,
  chantiers: Chantier[],
  actions: ChantierAction[]
): number | undefined {
  if (program.budget === undefined) return undefined;
  const total = sumProgramProjetBudgets(program.id, chantiers, actions);
  return total > program.budget ? total - program.budget : undefined;
}

// ─── Responsable affiché d'un indicateur (round 12) ────────────────────────────────────────────

/**
 * Responsable affiché d'UN CHANTIER (round 16) — pendant granulaire/levier de `resolveIndicatorOwner`
 * ci-dessous, extrait pour les écrans dont la maille est le CHANTIER (ou le LEVIER, qui en hérite),
 * pas l'indicateur — ex. le filtre "Responsable" de la feuille de route programme
 * (`ProgramRoadmap.tsx`, `StrategicAxesView.tsx`), dont les lignes sont par levier et n'ont donc pas
 * d'`Indicator` à résoudre.
 *
 * Même chaîne de repli que la branche chantier de `resolveIndicatorOwner` : pilote opérationnel
 * (`Chantier.pilote`) en priorité, à défaut son sponsor (`Chantier.sponsorName`), à défaut le
 * `owner` de l'axe parent (`StrategicAxis.owner`, axe introuvable inclus), à défaut
 * `unassignedLabel`. Voir le doc-comment de `resolveIndicatorOwner` pour le choix de conception du
 * paramètre `unassignedLabel` (module pur, sans accès à `t()`).
 */
export function resolveChantierOwner(
  chantier: Pick<Chantier, "pilote" | "sponsorName" | "axisIds">,
  axes: StrategicAxis[],
  unassignedLabel: string
): string {
  if (chantier.pilote) return chantier.pilote;
  const axis = axes.find((a) => a.id === chantier.axisIds[0]);
  return axis?.owner ?? unassignedLabel;
}

/**
 * Libellé du "responsable" d'un indicateur pour l'AFFICHAGE (ex. colonne "Responsable" de la page
 * KPI) — PAS une habilitation : voir `canFillIndicator` pour qui a le droit de saisir une mesure,
 * une notion distincte et volontairement plus permissive (rôles/utilisateurs autorisés, pas une
 * personne unique).
 *
 * Deux niveaux de résolution, selon que l'indicateur est rattaché à un chantier ou macro (porté
 * directement par un axe) :
 *  - `indicator.chantierId` défini : résout CE CHANTIER et délègue à `resolveChantierOwner`
 *    ci-dessus (pilote opérationnel en priorité — information plus pertinente ici que le sponsor
 *    COMEX —, à défaut son sponsor, à défaut l'owner de l'axe parent, à défaut `unassignedLabel`).
 *    Chantier introuvable (référence orpheline) : `unassignedLabel`, jamais d'exception.
 *  - sinon (indicateur macro) : résout `indicator.axisId` et retourne `StrategicAxis.owner`, à
 *    défaut (ou axe introuvable) `unassignedLabel`.
 *
 * **Choix de conception — libellé de repli** : `lib/axisLogic.ts` est un module PUR, sans accès à
 * `t()` (i18n). Plutôt que de renvoyer un sentinel anglais en dur que chaque appelant devrait
 * reconnaître et retraduire lui-même, le libellé de repli est un PARAMÈTRE (`unassignedLabel`)
 * fourni par l'appelant — typiquement `t("strategicAxes.unassigned")`, la même clé déjà utilisée
 * pour ce même concept par `StrategicAxesView.tsx` et `AxisDetailClient.tsx` (voir leur usage de
 * `axis.owner ?? t("strategicAxes.unassigned")`). Un appelant sans `t()` sous la main peut passer
 * une chaîne fixe ("Non assigné" ou équivalent) — la fonction ne préjuge d'aucune langue.
 */
export function resolveIndicatorOwner(
  indicator: Pick<Indicator, "chantierId" | "axisId">,
  axes: StrategicAxis[],
  chantiers: Chantier[],
  unassignedLabel: string
): string {
  if (indicator.chantierId) {
    const chantier = chantiers.find((c) => c.id === indicator.chantierId);
    if (!chantier) return unassignedLabel;
    return resolveChantierOwner(chantier, axes, unassignedLabel);
  }
  const axis = axes.find((a) => a.id === indicator.axisId);
  return axis?.owner ?? unassignedLabel;
}

// ─── Feuille de route programme (round 15) ─────────────────────────────────────────────────────

/** Un livrable de levier, réduit aux seuls champs utiles à la feuille de route programme (marqueur
 *  de date + couleur de statut) — même sous-ensemble que celui déjà lu par l'onglet "Timeline" de
 *  `ChantierDetailPanel.tsx` (`dueDeliverables`), mais TYPÉ explicitement ici plutôt que de
 *  transporter le `Deliverable` complet (ses `phases`/`comments` ne servent à rien à ce niveau
 *  agrégé programme). */
export type ProgramRoadmapDeliverable = Pick<Deliverable, "id" | "label" | "dueDate" | "status">;

/** Échéance EFFECTIVE d'un livrable : sa `dueDate` explicite si déclarée, sinon la fin de sa
 *  DERNIÈRE `phase` (round <n> — avant ce correctif, un livrable phasé mais sans `dueDate` autonome
 *  n'apparaissait sur AUCUNE timeline, ni celle du chantier ni la feuille de route programme, alors
 *  que le PO attend qu'un livrable déclaré avec des phases reste visible : « il faut bien que tous
 *  les livrables attendus des leviers, on le voit »). `undefined` seulement si le livrable n'a NI
 *  `dueDate` NI aucune `phase` — reste alors bien absent des deux timelines, comme avant. Partagée
 *  par `normalizeRoadmapDeliverables` ci-dessous et par `ChantierDetailPanel.tsx` (import direct,
 *  pour ne pas dupliquer la règle entre les deux call sites). Désormais définie dans
 *  `lib/deliverableState.ts` (livrable = échéance unique, statut binaire) et ré-exportée ici. */
export { effectiveDueDate };

/**
 * UNE ligne de la feuille de route programme = UN LEVIER (`ChantierAction`), avec son axe et son
 * chantier parents déjà résolus — évite à l'appelant de refaire les deux `.find()` pour chaque
 * ligne. Voir `programRoadmap` ci-dessous.
 */
export type ProgramRoadmapRow = {
  axis: StrategicAxis;
  chantier: Chantier;
  action: ChantierAction;
  /** Bornes temporelles de CE LEVIER — `action.start`/`action.end` directement (mêmes champs que
   *  `chantierBounds` agrège PAR CHANTIER ; ici la maille est le LEVIER — une ligne par action —
   *  donc rien à agréger). */
  start: string;
  end: string;
  /** Avancement déclaratif 0-100 de CE levier — MÊME calcul que `progressionPctFor` (fonction
   *  privée de l'onglet "Timeline" de `ChantierDetailPanel.tsx`, hors périmètre de ce lot) : jalons
   *  E0→E4 (`milestoneProgressPct` + `resolveMilestoneAutoFlags`), UNIVERSELLEMENT pour tout levier
   *  qu'il soit rattaché à un KPI ou non (round 18, ancien aiguillage vers un kanban classique
   *  supprimé). Volontairement RECALCULÉ ici plutôt qu'importé (la fonction source n'est pas
   *  exportée) mais compose les MÊMES primitives exportées, donc les deux ne peuvent pas diverger. */
  progressPct: number;
  /** Livrables de ce levier ayant une échéance EFFECTIVE (`effectiveDueDate` : `dueDate` déclarée,
   *  ou repli sur la fin de la dernière `phase`), uniquement (un livrable sans AUCUNE des deux n'a
   *  rien à positionner sur la feuille de route) — même filtre que `dueDeliverables` dans
   *  `ChantierDetailPanel.tsx`. */
  deliverables: ProgramRoadmapDeliverable[];
};

/** Normalise `ChantierAction.deliverables` en `ProgramRoadmapDeliverable[]` — même défensif que
 *  `normalizeDeliverables` (fonction privée de `ChantierDetailPanel.tsx`, dupliquée ici plutôt
 *  qu'importée : elle n'est pas exportée et ce fichier n'est pas dans le périmètre modifiable de ce
 *  lot) : un livrable écrit AVANT l'introduction du modèle riche est une simple chaîne (`string[]`),
 *  traitée comme un livrable sans échéance ni statut plutôt que de faire planter la lecture.
 *
 *  `dueDate` posé ici est déjà l'échéance EFFECTIVE (`effectiveDueDate`, ci-dessus) plutôt que la
 *  `dueDate` brute du livrable : `ProgramRoadmap.tsx` (seul lecteur de ce type) continue de lire
 *  `.dueDate` sans rien savoir du repli sur `phases`, donc pas besoin de le toucher. */
function normalizeRoadmapDeliverables(
  raw: ChantierAction["deliverables"]
): ProgramRoadmapDeliverable[] {
  return (raw ?? []).map((d, i) =>
    typeof d === "string"
      ? { id: `legacy-${i}`, label: d }
      : { id: d.id, label: d.label, dueDate: effectiveDueDate(d), status: d.status }
  );
}

/**
 * Feuille de route PROGRAMME (round 15) — UNE LIGNE PAR LEVIER sur TOUT le programme actif (tous
 * les axes, tous les chantiers), à la différence de `ChantierGantt.tsx` qui ne couvre qu'UN axe à
 * la fois (`chantiers`/`actions` déjà filtrés par l'appelant avant l'appel). Alimente
 * `ProgramRoadmap.tsx` (dashboard, section "Feuille de route du plan").
 *
 * Ordre de sortie — REPREND la même convention que `numberIndicators` ci-dessus (jamais de tri
 * caché) : les axes dans leur ordre d'apparition dans `axes`, puis pour chaque axe ses chantiers
 * dans l'ordre de `chantiers`, puis pour chaque chantier ses leviers triés par date de début (même
 * tri que `ChantierGantt.tsx`). Un chantier dont aucun `axisIds` ne référence un axe de `axes`, ou un
 * levier dont le `chantierId` ne référence aucun chantier de `chantiers`, n'apparaît dans AUCUNE
 * ligne (référence orpheline — même parti pris défensif que `numberIndicators`/`chantierBounds` :
 * pas de ligne inventée avec un axe/chantier `undefined`). Round 24 : un chantier appartenant à
 * PLUSIEURS axes produit UN JEU DE LIGNES PAR AXE (une ligne par (axe, levier) plutôt que par
 * levier seul) — décision produit assumée, pas un bug : la feuille de route reste lue axe par axe.
 */
export function programRoadmap(
  axes: StrategicAxis[],
  chantiers: Chantier[],
  actions: ChantierAction[],
  /** Résolveur d'avancement calculé sur TOUT le programme (`useStrategicData().projetProgress`)
   *  — à fournir dès que `chantiers`/`actions` sont une sélection filtrée, sans quoi les items
   *  automatiques seraient résolus sur la seule sélection. Omis = résolu sur les entrées. */
  progressOf: ProjetProgressLookup = projetProgressResolver(chantiers, actions)
): ProgramRoadmapRow[] {
  const rows: ProgramRoadmapRow[] = [];

  for (const axis of axes) {
    const axisChantiers = chantiers.filter((c) => c.axisIds.includes(axis.id));
    for (const chantier of axisChantiers) {
      const chantierActions = actions
        .filter((a) => a.chantierId === chantier.id)
        .sort((a, b) => a.start.localeCompare(b.start));

      for (const action of chantierActions) {
        const progressPct = progressOf(action);

        rows.push({
          axis,
          chantier,
          action,
          start: action.start,
          end: action.end,
          progressPct,
          deliverables: normalizeRoadmapDeliverables(action.deliverables).filter(
            (d) => d.dueDate !== undefined
          ),
        });
      }
    }
  }

  return rows;
}

/** Bornes temporelles [min, max] de TOUTES les lignes d'une feuille de route programme
 *  (`programRoadmap` ci-dessus) — pendant de `chantierBounds` mais agrégé sur l'ensemble du
 *  programme plutôt qu'un seul chantier, pour que l'appelant règle l'échelle de `TimelineBars.tsx`
 *  (`timelineRange`) sur la largeur RÉELLE du plan plutôt que sur une plage arbitraire. `undefined`
 *  si `rows` est vide (aucune borne exploitable), même convention que `chantierBounds`. */
export function programRoadmapBounds(
  rows: Pick<ProgramRoadmapRow, "start" | "end">[]
): { start: string; end: string } | undefined {
  let start: string | undefined;
  let end: string | undefined;
  for (const row of rows) {
    if (!start || row.start < start) start = row.start;
    if (!end || row.end > end) end = row.end;
  }
  return start && end ? { start, end } : undefined;
}

// ─── Sponsor d'axe ─────────────────────────────────────────────────────────────────────────────

/** Nom complet d'un utilisateur résolu par username ; repli défensif sur la valeur brute (texte
 *  libre historique ou utilisateur retiré de l'entreprise). `undefined` si aucun username. */
export function resolveUserFullName(
  username: string | undefined | null,
  users: Pick<AuthUser, "username" | "name">[] | undefined
): string | undefined {
  if (!username) return undefined;
  return users?.find((u) => u.username === username)?.name || username;
}

/** Nom complet du sponsor d'un axe (`StrategicAxis.owner` — rôle unique, "Sponsor de l'axe" en
 *  UI), ou `undefined` si l'axe n'a pas de sponsor. */
export function axisSponsorLabel(
  axis: Pick<StrategicAxis, "owner"> | null | undefined,
  users: Pick<AuthUser, "username" | "name">[] | undefined
): string | undefined {
  return resolveUserFullName(axis?.owner, users);
}

/** Pilote(s) de décision d'un axe (validation des demandes d'axe) : le sponsor de l'axe
 *  (`StrategicAxis.owner`), rôle unique depuis la suppression de la duplication sponsor/owner. */
export function axisDecisionMakers(axis: Pick<StrategicAxis, "owner">): string[] {
  return axis.owner ? [axis.owner] : [];
}

/** Axes dont l'utilisateur est sponsor (rôle `axis_sponsor` relié à son/ses axe(s)). */
export function axesSponsoredBy(axes: StrategicAxis[], username: string): StrategicAxis[] {
  return axes.filter((a) => a.owner === username);
}
