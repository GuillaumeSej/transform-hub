import { daysBetween } from "@/lib/dateUtils";
import { MILESTONE_CHECKLISTS, MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import {
  getStrategicProfile,
  getStrategicProfiles,
  hasAnyRole,
  hasRole,
  isAnyAdmin,
} from "@/lib/roleProfiles";
import type {
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierDependencyType,
  ChantierMilestoneApproval,
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

/** Dernière mesure connue d'un indicateur (période la plus récente au sens lexicographique — voir
 *  `IndicatorMeasurement.period`), ou `undefined` si l'indicateur n'a jamais été mesuré. */
export function latestMeasurement(
  indicatorId: string,
  measurements: IndicatorMeasurement[]
): IndicatorMeasurement | undefined {
  let latest: IndicatorMeasurement | undefined;
  for (const m of measurements) {
    if (m.indicatorId !== indicatorId) continue;
    if (!latest || m.period > latest.period) latest = m;
  }
  return latest;
}

/** Copie triée chronologiquement des mesures (`period` est lexicographiquement ordonnée, voir
 *  `IndicatorMeasurement.period`). Ne mute jamais l'entrée : les mesures arrivent dans l'ordre
 *  arbitraire de Firestore et sont partagées entre plusieurs composants. */
export function sortMeasurementsByPeriod<T extends { period: string }>(measurements: T[]): T[] {
  return [...measurements].sort((a, b) => a.period.localeCompare(b.period));
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
export function recentMeasurementWindow<T extends { period: string }>(
  measurements: T[],
  frequency?: Indicator["frequency"]
): { all: T[]; visible: T[]; hidden: number } {
  const all = sortMeasurementsByPeriod(measurements);
  const size = frequency ? RECENT_MEASUREMENT_POINTS[frequency] : DEFAULT_RECENT_MEASUREMENT_POINTS;
  const visible = all.length > size ? all.slice(all.length - size) : all;
  return { all, visible, hidden: all.length - visible.length };
}

/**
 * Statut de risque CALCULÉ d'un indicateur, à partir de sa dernière mesure comparée à son
 * objectif chiffré. Volontairement binaire et sans bande de tolérance : le PO veut un signal
 * simple "dans les clous / en retard", la nuance passant par la surcharge manuelle
 * (`Indicator.statusOverride`, voir `resolveIndicatorStatus`).
 *
 * Retourne "on_track" — jamais "at_risk" — dès qu'il n'y a rien à comparer :
 *   - aucune mesure enregistrée (ou mesure sans valeur numérique) ;
 *   - indicateur qualitatif (pas de valeur à comparer) ;
 *   - pas d'`objectiveValue` définie.
 * Un indicateur non renseigné n'est PAS un indicateur en retard : le signalement des mesures
 * manquantes relève du suivi de reporting, pas du statut de risque.
 */
export function computeIndicatorStatus(
  indicator: Pick<Indicator, "id" | "kind" | "objectiveValue" | "direction" | "targetSchedule">,
  measurements: IndicatorMeasurement[]
): IndicatorRiskStatus {
  if (indicator.kind === "qualitative") return "on_track";
  const latest = latestMeasurement(indicator.id, measurements);
  if (!latest || latest.value === undefined) return "on_track";
  // Round "cible évolutive" : compare à la cible APPLICABLE à la période de cette mesure (le
  // palier courant d'une trajectoire, ou `objectiveValue` pour une cible fixe) — jamais toujours
  // la cible finale, qui rendrait "at_risk" une mesure pourtant conforme au palier du moment.
  const target = resolveIndicatorTargetForPeriod(indicator, latest.period);
  if (target === undefined) return "on_track";
  // "down" = plus bas vaut mieux (ex. délai, taux de rebut) ; défaut "up".
  return indicator.direction === "down"
    ? latest.value <= target
      ? "on_track"
      : "at_risk"
    : latest.value >= target
      ? "on_track"
      : "at_risk";
}

/**
 * Cible APPLICABLE d'un indicateur pour une PÉRIODE donnée (round "cible évolutive") — pour un
 * indicateur à cible FIXE (`targetSchedule` absent/vide), toujours `objectiveValue`, quelle que
 * soit la période (comportement historique, inchangé). Pour un indicateur à cible ÉVOLUTIVE, le
 * dernier palier de `targetSchedule` dont `period` est <= la période demandée (ordre
 * lexicographique, même convention que `IndicatorMeasurement.period`) ; si `period` est
 * antérieure à TOUS les paliers déclarés (déclaration incomplète), ou postérieure au dernier,
 * replie sur `objectiveValue` (la cible finale) — jamais une valeur interpolée/inventée.
 */
export function resolveIndicatorTargetForPeriod(
  indicator: Pick<Indicator, "objectiveValue" | "targetSchedule">,
  period: string
): number | undefined {
  const schedule = indicator.targetSchedule;
  if (!schedule || schedule.length === 0) return indicator.objectiveValue;
  const sorted = [...schedule].sort((a, b) => a.period.localeCompare(b.period));
  // Au-delà du DERNIER palier déclaré : la cible finale prend le relais (voir doc-comment) —
  // sans ce garde-fou, le dernier palier resterait "actif" indéfiniment plutôt que de converger
  // vers l'objectif final une fois la trajectoire intermédiaire épuisée.
  if (period > sorted[sorted.length - 1].period) return indicator.objectiveValue;
  let applicable: number | undefined;
  for (const step of sorted) {
    if (step.period <= period) applicable = step.value;
    else break;
  }
  return applicable ?? indicator.objectiveValue;
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
  const sorted = [...schedule].sort((a, b) => a.period.localeCompare(b.period));
  if (period > sorted[sorted.length - 1].period) return final;
  let applicable: { value: number; period: string } | undefined;
  for (const step of sorted) {
    if (step.period <= period) applicable = { value: step.value, period: step.period };
    else break;
  }
  return applicable ?? final;
}

/** Mesure de BASELINE ("Valeur initiale") d'un indicateur : sa mesure NUMÉRIQUE la plus ancienne
 *  (période la plus petite au sens lexicographique ; à période égale, la plus anciennement saisie
 *  via `reportedAt`). Aucun drapeau dédié n'existe sur `IndicatorMeasurement` : l'import Excel
 *  (`lib/strategicExcelImport.ts`, colonne "Valeur initiale") crée simplement une première mesure,
 *  c'est donc la convention "première mesure = situation initiale" qui fait foi. */
export function baselineMeasurement(
  indicatorId: string,
  measurements: IndicatorMeasurement[]
): IndicatorMeasurement | undefined {
  let first: IndicatorMeasurement | undefined;
  for (const m of measurements) {
    if (m.indicatorId !== indicatorId || m.value === undefined) continue;
    if (
      !first ||
      m.period < first.period ||
      (m.period === first.period && m.reportedAt < first.reportedAt)
    ) {
      first = m;
    }
  }
  return first;
}

/** Statut EFFECTIF d'un indicateur : la surcharge manuelle du responsable prime toujours sur le
 *  statut calculé. Seul point de vérité pour l'affichage — ne jamais lire `indicator.status` nu. */
export function resolveIndicatorStatus(
  indicator: Pick<Indicator, "status" | "statusOverride">
): IndicatorRiskStatus {
  return indicator.statusOverride ?? indicator.status;
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
 *  applicable — pas de baseline connue, ou baseline égale à la cible (dénominateur nul) : on
 *  revient à l'ancien ratio (`valeur / cible` pour "up", `cible / valeur` pour "down").
 *  Une seule mesure qui EST la baseline donne un avancement exact de 0 (rien n'a encore bougé).
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
 *  ("down", cadrage inversé), gardé non borné. */
function ratioProgress(value: number, target: number, isDown: boolean): number {
  if (isDown) return value !== 0 ? (target / value) * 100 : target === 0 ? 100 : 0;
  return target !== 0 ? (value / target) * 100 : value >= 0 ? 100 : 0;
}

/** Avancement depuis la baseline vers `target` — voir le doc-comment de `IndicatorDelta`. */
function progressFromBaseline(
  value: number,
  target: number,
  baseline: number | undefined,
  isDown: boolean
): { raw: number; approximate: boolean } {
  if (baseline === undefined || baseline === target) {
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
    const latest = latestMeasurement(indicator.id, measurements);
    if (latest?.value !== undefined) sum += latest.value;
  }
  return sum;
}

/** Compteur global "X sur la trajectoire · Y à risque" — sur le statut EFFECTIF (surcharge
 *  manuelle comprise), pas sur le statut calculé brut. */
export function countOnTrackAtRisk(indicators: Indicator[]): {
  total: number;
  onTrack: number;
  atRisk: number;
} {
  let onTrack = 0;
  let atRisk = 0;
  for (const indicator of indicators) {
    if (resolveIndicatorStatus(indicator) === "at_risk") atRisk += 1;
    else onTrack += 1;
  }
  return { total: indicators.length, onTrack, atRisk };
}

/**
 * Un utilisateur peut-il renseigner une mesure (et ajuster l'objectif/le seuil) de cet
 * indicateur ? Seul point de vérité pour ce contrôle — utilisé aussi bien pour griser le
 * formulaire de saisie que pour l'édition inline de l'objectif sur la page KPI.
 *
 * Règle (voir plan, section "Responsable d'un indicateur") : le rôle de l'utilisateur est dans
 * `responsibleRoles`, OU son identifiant est listé dans `additionalAuthorizedUserIds` (comptes
 * ajoutés au cas par cas, en plus des rôles). admin/admin_entreprise sont toujours autorisés,
 * comme partout ailleurs dans l'app (voir `leversLogic.canUserViewLever`).
 *
 * Round 6, point 7 : le pilote (`strategic_lead`) peut en plus renseigner N'IMPORTE QUEL
 * indicateur de SON programme, même sans figurer dans `responsibleRoles`/
 * `additionalAuthorizedUserIds` — un `strategic_lead` sans `programId` (profil non rattaché à un
 * programme précis) est autorisé sur TOUS les programmes, cohérent avec `getAuthorizedPrograms`.
 */
export function canFillIndicator(
  indicator: Pick<Indicator, "responsibleRoles" | "additionalAuthorizedUserIds" | "programId">,
  user:
    Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin" | "username"> | null | undefined
): boolean {
  if (!user) return false;
  if (isAnyAdmin(user)) return true;
  const strategicProfile = getStrategicProfile(user);
  if (
    strategicProfile?.role === "strategic_lead" &&
    (!strategicProfile.programId || strategicProfile.programId === indicator.programId)
  ) {
    return true;
  }
  if (hasAnyRole(user, indicator.responsibleRoles)) return true;
  return (indicator.additionalAuthorizedUserIds ?? []).includes(user.username);
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
 * Rôle Plan Stratégique EFFECTIF de l'utilisateur pour UN programme précis — distinct de
 * `getStrategicProfile` (lib/roleProfiles.ts), qui renvoie le PREMIER profil stratégique trouvé
 * sans tenir compte du programme affiché. Nécessaire ici : `resolveStrategicOwnershipScope`
 * ci-dessous doit résoudre le bon rôle pour le programme ACTIF, faute de quoi un utilisateur
 * cumulant deux profils stratégiques sur deux programmes distincts (autorisé par
 * `assertValidProfiles`, lib/roleProfiles.ts) pourrait se voir appliquer le périmètre du MAUVAIS
 * programme (ex. traité comme "internal_comm" — non restreint — sur le programme A alors qu'il
 * est "axis_sponsor" — restreint — dessus, simplement parce que son profil B est listé en premier).
 *
 * Priorité : le profil dont `programId` correspond EXACTEMENT au programme actif ; à défaut, un
 * profil "tous programmes" (`programId` absent) ; à défaut, le premier profil stratégique
 * disponible (repli défensif, ne devrait pas survenir en pratique compte tenu des contraintes de
 * `assertValidProfiles`, mais évite de retourner `undefined` sur un utilisateur qui a bien un
 * profil stratégique, simplement sur un autre programme).
 */
export function resolveStrategicRoleForProgram(
  user: Pick<AuthUser, "profiles"> | null | undefined,
  programId: string | null | undefined
): Role | undefined {
  const profiles = getStrategicProfiles(user);
  const forProgram = profiles.find((p) => p.programId && p.programId === programId);
  if (forProgram) return forProgram.role;
  const global = profiles.find((p) => !p.programId);
  if (global) return global.role;
  return profiles[0]?.role;
}

/**
 * Périmètre de visibilité "propriétaire nommé" (round 25) — QUI voit QUOI dans le Plan
 * Stratégique, pour les 3 rôles à ownership nominatif (voir le plan, section RBAC) :
 *  - `axis_sponsor` : uniquement le(s) axe(s) dont il est `StrategicAxis.owner` (sponsor de l'axe — rôle unique, décision explicite : plus de duplication sponsor COMEX / responsable au niveau axe), plus tout ce qui
 *    en dépend (chantiers de ces axes, et — voir `indicators` de `useStrategicData.ts` — les
 *    indicateurs macro de ces axes et chantier-scopés de ces chantiers).
 *  - `chantier_owner` : uniquement le(s) chantier(s) dont il est `Chantier.pilote`. Les axes
 *    PARENTS de ces chantiers restent dans `axisIds` (pour que le nom/contexte de l'axe reste
 *    affichable — "pour orientation") mais ça ne donne PAS accès aux AUTRES chantiers de ce même
 *    axe : c'est `chantierIds`, jamais `axisIds`, qui borne la liste des chantiers visibles.
 *  - `chantier_contributor` : même granularité de VISIBILITÉ chantier que `chantier_owner`, mais
 *    résolue différemment — un contributeur n'a pas de champ "mon chantier" propre (`pilote` reste
 *    la notion du RESPONSABLE de chantier), donc un chantier est visible pour lui dès qu'AU MOINS
 *    UN de ses projets (`ChantierAction.owner`) lui appartient. En plus de ça, `clickableActionIds`
 *    restreint, DANS un chantier visible, les projets réellement OUVRABLES aux siens propres — les
 *    autres projets du même chantier restent dans `chantierIds` (donc affichés, ex. sur le Gantt/
 *    l'accordéon/le board E0→E4) mais l'appelant UI doit les rendre INERTES au clic plutôt que de
 *    les omettre (voir `ProgramRoadmap.tsx`/`AxisChantierProjetAccordion.tsx`/
 *    `ProjetMilestoneBoard.tsx`).
 *  - tout autre rôle stratégique (`strategic_lead`, `internal_comm`, `budget_control`,
 *    `comex_member`) et tout admin (`isGlobalAdmin`/`isCompanyAdmin`) : `"unrestricted"`, aucun
 *    filtrage — comportement historique inchangé.
 *
 * `axes`/`chantiers`/`chantierActions` sont attendus DÉJÀ scopés au programme actif (même
 * convention que `programRoadmap` ci-dessus) — cette fonction ne filtre jamais par `programId`
 * elle-même, seul `programId` (passé séparément) sert à résoudre le bon profil via
 * `resolveStrategicRoleForProgram`.
 *
 * Un utilisateur `null`/`undefined` produit un périmètre `"scoped"` à VIDE (rien de visible)
 * plutôt que `"unrestricted"` : un appelant qui active le filtrage (voir `useStrategicData.ts`,
 * `filterActive`) sans utilisateur résolu (session en cours de déconnexion, par ex.) ne doit
 * jamais retomber sur "tout voir" par défaut.
 */
export type StrategicOwnershipScope =
  | { mode: "unrestricted" }
  | {
      mode: "scoped";
      /** Axes visibles — pour `axis_sponsor`, ses axes possédés ; pour `chantier_owner`/
       *  `chantier_contributor`, les axes PARENTS de leurs chantiers visibles (contexte
       *  d'orientation uniquement, ne donne accès à AUCUN autre chantier de cet axe). */
      axisIds: Set<string>;
      /** Chantiers visibles (voir le détail par rôle dans le doc-comment de la fonction). */
      chantierIds: Set<string>;
      /** Uniquement pour `chantier_contributor` : parmi les projets des chantiers visibles
       *  ci-dessus, ceux réellement cliquables/ouvrables (les siens). `undefined` pour les deux
       *  autres rôles scopés (`axis_sponsor`/`chantier_owner`) : TOUS les projets des chantiers
       *  visibles sont cliquables pour eux, aucune restriction supplémentaire au niveau projet. */
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

  if (role === "axis_sponsor") {
    const axisIds = new Set(axes.filter((a) => a.owner === user.username).map((a) => a.id));
    const chantierIds = new Set(
      chantiers.filter((c) => c.axisIds.some((id) => axisIds.has(id))).map((c) => c.id)
    );
    return { mode: "scoped", axisIds, chantierIds };
  }

  if (role === "chantier_owner") {
    const chantierIds = new Set(
      chantiers.filter((c) => c.pilote === user.username).map((c) => c.id)
    );
    const axisIds = new Set(
      chantiers.filter((c) => chantierIds.has(c.id)).flatMap((c) => c.axisIds)
    );
    return { mode: "scoped", axisIds, chantierIds };
  }

  if (role === "chantier_contributor") {
    const ownActions = chantierActions.filter((a) => a.owner === user.username);
    const chantierIds = new Set(ownActions.map((a) => a.chantierId));
    const axisIds = new Set(
      chantiers.filter((c) => chantierIds.has(c.id)).flatMap((c) => c.axisIds)
    );
    const clickableActionIds = new Set(ownActions.map((a) => a.id));
    return { mode: "scoped", axisIds, chantierIds, clickableActionIds };
  }

  return { mode: "unrestricted" };
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
        latestMeasurement(indicator.id, measurements),
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
 * Une action peut-elle démarrer, au regard de ses prérequis (`ChantierAction.prerequisites`) ?
 * v1 PUREMENT INFORMATIVE (voir plan round 4, point 5) : rien dans l'app n'intercepte aujourd'hui
 * un changement de statut/étape, donc un prérequis non satisfait n'empêche RIEN — il s'affiche
 * seulement (badge cadenas sur le Gantt, détail sur la fiche chantier).
 *
 * Un prérequis "action" est satisfait quand l'étape COURANTE de l'action cible est `isTerminal`
 * dans le référentiel `stages` du programme (même notion que `chantierProgress`/
 * `maturityStageProgressRatio`). Une cible introuvable (action supprimée depuis, ou id invalide)
 * n'est jamais satisfaite mais ne lève JAMAIS d'exception — elle produit un message explicite.
 * Un prérequis "external" est satisfait quand `done === true`.
 */
export function canStartAction(
  action: Pick<ChantierAction, "prerequisites">,
  allActions: ChantierAction[],
  stages: MaturityStageConfig[]
): { blocked: boolean; reasons: string[] } {
  const reasons: string[] = [];

  for (const prerequisite of action.prerequisites ?? []) {
    if (prerequisite.kind === "action") {
      const target = allActions.find((a) => a.id === prerequisite.targetActionId);
      if (!target) {
        reasons.push(`Prérequis introuvable (action supprimée ou invalide)`);
        continue;
      }
      const isTerminal = stages.find((s) => s.id === target.status)?.isTerminal ?? false;
      if (!isTerminal) reasons.push(`En attente de "${target.name}"`);
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
  allActions: ChantierAction[]
): Record<string, number> {
  const flags: Record<string, number> = {};
  const parentChantier = allChantiers.find((c) => c.id === action.chantierId);

  for (const item of MILESTONE_CHECKLISTS[milestoneId]) {
    if (!item.auto) continue;

    switch (item.auto) {
      case "dependencyAlert": {
        const alerts = chantierDependencyAlerts(allChantiers, allActions);
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
 * sous forme de props) que par `canPassMilestone`/`requestMilestoneApproval` ci-dessous (le
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

// ─── Jalon — porte de validation (round "jalon validation gate") ──────────────────────────────
//
// Mirroir stratégique de `lib/leversLogic.ts::requestLeverApproval`/`approveLeverGate`/
// `rejectLeverApproval` (mêmes noms de fonction, même découpage requête → approbation/rejet), avec
// deux différences assumées :
//  - le Plan Performance ne protège que 3 des transitions de statut d'un levier (avec un modèle à
//    DEUX approbateurs possibles, sponsor OU cto) ; ici, TOUTES les transitions de jalon (E0→E1 …
//    E3→E4) sont protégées, avec un SEUL rôle approbateur : `strategic_lead` (voir
//    `isStrategicLeadOf` ci-dessous, pendant de `isLeverCtoOf`) ;
//  - `lib/leversLogic.ts` opère sur un TABLEAU de leviers (le hook `useBeTrackData` maintient un
//    état local optimiste) et retourne `{ levers, lever, auditEntries }` ; `useStrategicData` n'a
//    pas cette couche (mutations écrites directement dans Firestore, voir son commentaire de tête)
//    — ces trois fonctions opèrent donc sur UN SEUL projet et retournent soit la nouvelle valeur de
//    `milestoneApproval` (requête), soit un PATCH `Partial<ChantierAction>` (approbation/rejet) que
//    l'appelant (`lib/hooks/useStrategicData.ts`) passe tel quel à `updateChantierAction`.

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
 * Soumet une demande de validation pour faire passer un projet à son JALON SUIVANT — appelable
 * uniquement par le propriétaire du projet (`ChantierAction.owner`) ou un admin, et UNIQUEMENT si
 * `canPassMilestone` est déjà satisfait pour le jalon COURANT (le verrou "tous les items à 100"
 * reste un PRÉREQUIS, pas remplacé par ce nouveau verrou d'approbation — les deux s'appliquent en
 * séquence). Pure : ne fait QUE calculer/valider la nouvelle valeur de `milestoneApproval`, ne mute
 * rien — c'est à l'appelant (`useStrategicData.ts`) de la persister via `updateChantierAction`.
 * Lève une erreur (jamais un simple `false`) sur toute condition non satisfaite, même convention que
 * `requestLeverApproval`.
 */
export function requestMilestoneApproval(
  action: ChantierAction,
  user: Pick<AuthUser, "username" | "isGlobalAdmin" | "isCompanyAdmin">,
  allChantiers: Chantier[],
  allActions: ChantierAction[]
): ChantierMilestoneApproval {
  if (!isAnyAdmin(user) && action.owner !== user.username) {
    throw new Error(
      `Seul le propriétaire du projet "${action.id}" (ou un admin) peut soumettre une demande de validation de jalon`
    );
  }
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
  return {
    targetMilestone,
    requestedBy: user.username,
    requestedAt: new Date().toISOString(),
  };
}

/**
 * Approuve la demande de validation en cours — vérifie que l'appelant est habilité (`strategic_lead`
 * scopé au programme du chantier parent, voir `isStrategicLeadOf`, ou admin). Fait RÉELLEMENT
 * avancer le jalon (`currentMilestone` → `milestoneApproval.targetMilestone`, l'ancien
 * `currentMilestone` poussé sur `passedMilestones` s'il n'y est pas déjà) et vide `milestoneApproval`
 * — c'est le SEUL chemin légitime vers une avancée de jalon, voir le commentaire de tête de cette
 * section. Chantier parent introuvable (référence orpheline) : traité comme non habilité plutôt que
 * de lever une exception distincte, seul un admin peut alors approuver.
 */
export function approveMilestoneGate(
  action: ChantierAction,
  user: Pick<AuthUser, "username" | "profiles" | "isGlobalAdmin" | "isCompanyAdmin">,
  allChantiers: Chantier[]
): Pick<ChantierAction, "milestones" | "milestoneApproval"> {
  const approval = action.milestoneApproval;
  if (!approval) {
    throw new Error(`Le projet "${action.id}" n'a pas de demande de validation de jalon en cours`);
  }
  const parentChantier = allChantiers.find((c) => c.id === action.chantierId);
  const authorized =
    isAnyAdmin(user) || (!!parentChantier && isStrategicLeadOf(parentChantier, user));
  if (!authorized) {
    throw new Error(`Vous n'êtes pas habilité à approuver cette demande de validation de jalon`);
  }

  const before: ChantierMilestoneState = action.milestones ?? {
    currentMilestone: "E0",
    passedMilestones: [],
    checklists: {},
  };
  const passedMilestones = before.passedMilestones.includes(before.currentMilestone)
    ? before.passedMilestones
    : [...before.passedMilestones, before.currentMilestone];

  return {
    milestones: {
      ...before,
      currentMilestone: approval.targetMilestone,
      passedMilestones,
    },
    milestoneApproval: undefined,
  };
}

/**
 * Rejette (annule) la demande en cours — habilité : `strategic_lead` du chantier parent, un admin,
 * OU le propriétaire du projet lui-même (mirroir de `rejectLeverApproval`, qui autorise de même le
 * porteur du levier à annuler sa propre demande). Vide `milestoneApproval` : le projet reste sur son
 * jalon courant, sans pénalité — une nouvelle demande peut être soumise plus tard via
 * `requestMilestoneApproval` dès que `canPassMilestone` est de nouveau satisfait.
 */
export function rejectMilestoneApproval(
  action: ChantierAction,
  user: Pick<AuthUser, "username" | "profiles" | "isGlobalAdmin" | "isCompanyAdmin">,
  allChantiers: Chantier[]
): Pick<ChantierAction, "milestoneApproval"> {
  if (!action.milestoneApproval) {
    throw new Error(`Le projet "${action.id}" n'a pas de demande de validation de jalon en cours`);
  }
  const parentChantier = allChantiers.find((c) => c.id === action.chantierId);
  const authorized =
    isAnyAdmin(user) ||
    action.owner === user.username ||
    (!!parentChantier && isStrategicLeadOf(parentChantier, user));
  if (!authorized) {
    throw new Error(`Vous n'êtes pas habilité à rejeter cette demande de validation de jalon`);
  }
  return { milestoneApproval: undefined };
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
export function milestoneProgressPct(
  entity: { milestones?: ChantierMilestoneState },
  /** Valeurs 0/100 des items `auto` du jalon COURANT, typiquement le résultat de
   *  `resolveMilestoneAutoFlags(entity.milestones.currentMilestone, ...)` — voir le paragraphe
   *  "Items automatiques" ci-dessus. Omis = items auto traités comme non répondus (0). */
  autoValues?: Record<string, number>
): number {
  const milestones = entity.milestones;
  if (!milestones) return 0;

  let total = milestones.passedMilestones.reduce((sum, m) => sum + MILESTONE_WEIGHT_DELTA[m], 0);

  if (!milestones.passedMilestones.includes(milestones.currentMilestone)) {
    const defs = MILESTONE_CHECKLISTS[milestones.currentMilestone];
    const stored = milestones.checklists[milestones.currentMilestone] ?? [];

    let sum = 0;
    for (const def of defs) {
      const storedItem = stored.find((i) => i.itemId === def.itemId);
      const value =
        storedItem?.progressPct !== undefined
          ? storedItem.progressPct
          : ((def.auto ? autoValues?.[def.itemId] : undefined) ?? 0);
      sum += value;
    }
    const average = defs.length > 0 ? sum / defs.length : 0;
    total += (MILESTONE_WEIGHT_DELTA[milestones.currentMilestone] * average) / 100;
  }

  return Math.min(100, Math.round(total));
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
  actions: ChantierAction[]
): number {
  const own = actions.filter((a) => a.chantierId === chantier.id);
  if (own.length === 0) return 0;
  const total = own.reduce((sum, action) => sum + milestoneProgressPct(action), 0);
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
export function chantierDeclaredProgress(chantierId: string, actions: ChantierAction[]): number {
  const own = actions.filter((a) => a.chantierId === chantierId);
  if (own.length === 0) return 0;

  const withProgress = own.map((action) => ({ action, progress: milestoneProgressPct(action) }));

  const declaredWeightSum = withProgress.reduce(
    (acc, x) =>
      acc + (typeof x.action.chantierWeightPct === "number" ? x.action.chantierWeightPct : 0),
    0
  );
  const undeclaredCount = withProgress.filter(
    (x) => typeof x.action.chantierWeightPct !== "number"
  ).length;
  const remainingWeight = Math.max(0, 100 - declaredWeightSum);
  const implicitWeight = undeclaredCount > 0 ? remainingWeight / undeclaredCount : 0;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const { action, progress } of withProgress) {
    const weight =
      typeof action.chantierWeightPct === "number" ? action.chantierWeightPct : implicitWeight;
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
 * Avancement d'un AXE (feuille de route) — moyenne simple, arrondie, des avancements de ses
 * chantiers (`chantierDeclaredProgress`, le même chiffre que la fiche chantier). Un chantier
 * multi-axe compte sous chacun de ses axes. 0 si l'axe n'a aucun chantier.
 */
export function axisProgressPct(
  axisId: string,
  chantiers: Pick<Chantier, "id" | "axisIds">[],
  actions: ChantierAction[]
): number {
  const own = chantiers.filter((c) => c.axisIds.includes(axisId));
  if (own.length === 0) return 0;
  const total = own.reduce((sum, c) => sum + chantierDeclaredProgress(c.id, actions), 0);
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
  const todayISO = today.toISOString().slice(0, 10);
  return daysBetween(action.end, todayISO) > 0 && progressPct < 100;
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
  stages: MaturityStageConfig[]
): { action: ChantierAction; reasons: string[] }[] {
  return actions
    .map((action) => ({ action, ...canStartAction(action, actions, stages) }))
    .filter((r) => r.blocked)
    .map(({ action, reasons }) => ({ action, reasons }));
}

// ─── Couleur déterministe par chantier (round 8) ───────────────────────────────────────────────

/** Palette catégorielle fixe (Tailwind, fond plein) — classes `bg-*-500` de la palette Tailwind
 *  par défaut, pas de token `bp-*` de marque (déjà réservés à d'autres usages). Purement
 *  catégorielle, sans rapport avec un statut à-risque (`rag-*`). Ordre arbitraire mais stable :
 *  ne jamais réordonner ce tableau, `colorForChantier`/`colorForDepartment` en dépendent pour
 *  rester déterministes dans le temps. */
const CHANTIER_COLOR_PALETTE = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-pink-500",
  "bg-amber-500",
  "bg-indigo-500",
  "bg-teal-500",
  "bg-orange-500",
  "bg-rose-500",
  "bg-cyan-500",
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
  "#3b82f6", // bg-blue-500
  "#10b981", // bg-emerald-500
  "#8b5cf6", // bg-violet-500
  "#ec4899", // bg-pink-500
  "#f59e0b", // bg-amber-500
  "#6366f1", // bg-indigo-500
  "#14b8a6", // bg-teal-500
  "#f97316", // bg-orange-500
  "#f43f5e", // bg-rose-500
  "#06b6d4", // bg-cyan-500
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

/**
 * Somme des budgets PROJET (`ChantierAction.budget`, round 12) d'un chantier donné — pendant de
 * `Chantier.allocatedBudget` mais agrégé depuis les projets plutôt que saisi directement sur le
 * chantier ; les deux budgets COEXISTENT (l'un n'est pas déduit de l'autre, l'agrégat des projets
 * n'est PAS censé égaler `allocatedBudget`, c'est à l'appelant de les comparer si besoin).
 *
 * Un projet sans `budget` renseigné compte pour `0` (jamais exclu de la somme, contrairement à
 * `chantierMilestoneProgressPct` où un projet sans KPI est exclu du DÉNOMINATEUR d'une moyenne :
 * ici il n'y a pas de moyenne, seulement une somme, donc rien à exclure). Chantier sans aucun
 * projet, ou uniquement des projets sans budget : `0`.
 */
export function sumProjetBudgets(chantierId: string, actions: ChantierAction[]): number {
  return actions
    .filter((action) => action.chantierId === chantierId)
    .reduce((sum, action) => sum + (action.budget ?? 0), 0);
}

/**
 * Somme des montants CONSOMMÉS levier (`ChantierAction.consumedBudget`) d'un chantier donné —
 * pendant de `sumProjetBudgets` ci-dessus mais pour le consommé plutôt que le planifié ; même
 * remarque : ne pas comparer directement à `Chantier.consumedBudget`, les deux coexistent sans
 * qu'un des deux soit déduit de l'autre.
 *
 * Un levier sans `consumedBudget` renseigné compte pour `0` (jamais exclu de la somme). Chantier
 * sans aucun levier, ou uniquement des leviers sans consommé : `0`.
 */
export function sumConsumedBudget(chantierId: string, actions: ChantierAction[]): number {
  return actions
    .filter((action) => action.chantierId === chantierId)
    .reduce((sum, action) => sum + (action.consumedBudget ?? 0), 0);
}

/**
 * Somme des budgets PROJET (`ChantierAction.budget`) de TOUT un programme (round "budget du plan
 * stratégique") — comparée à `Program.budget` (le budget prévisionnel total déclaré) pour détecter
 * un dépassement, voir `programBudgetOverrun` ci-dessous.
 *
 * Somme DIRECTEMENT sur les projets du programme (via leur chantier parent), jamais en sommant des
 * sous-totaux PAR AXE : un chantier peut appartenir à plusieurs axes (`Chantier.axisIds`), sommer
 * un sous-total par axe compterait alors plusieurs fois le budget d'un même chantier partagé. Ici,
 * chaque projet ne compte qu'UNE fois, quel que soit le nombre d'axes de son chantier.
 */
export function sumProgramProjetBudgets(
  programId: string,
  chantiers: Chantier[],
  actions: ChantierAction[]
): number {
  const chantierIds = new Set(chantiers.filter((c) => c.programId === programId).map((c) => c.id));
  return actions
    .filter((action) => chantierIds.has(action.chantierId))
    .reduce((sum, action) => sum + (action.budget ?? 0), 0);
}

/**
 * Dépassement du budget prévisionnel total du programme (`Program.budget`) — `undefined` tant
 * qu'aucun budget total n'a été déclaré (rien à comparer, voir le commentaire de `Program.budget`
 * dans `types/index.ts`) ou si la somme réelle ne dépasse pas ce budget (pas de dépassement à
 * signaler). Sinon, le montant du dépassement (toujours strictement positif).
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
  if (chantier.sponsorName) return chantier.sponsorName;
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
 *  pour ne pas dupliquer la règle entre les deux call sites). */
export function effectiveDueDate(d: Pick<Deliverable, "dueDate" | "phases">): string | undefined {
  return d.dueDate ?? d.phases?.[d.phases.length - 1]?.end;
}

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
  actions: ChantierAction[]
): ProgramRoadmapRow[] {
  const rows: ProgramRoadmapRow[] = [];

  for (const axis of axes) {
    const axisChantiers = chantiers.filter((c) => c.axisIds.includes(axis.id));
    for (const chantier of axisChantiers) {
      const chantierActions = actions
        .filter((a) => a.chantierId === chantier.id)
        .sort((a, b) => a.start.localeCompare(b.start));

      for (const action of chantierActions) {
        const progressPct = milestoneProgressPct(
          action,
          resolveMilestoneAutoFlags(
            action.milestones?.currentMilestone ?? "E0",
            action,
            chantiers,
            actions
          )
        );

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
