import { daysBetween } from "@/lib/dateUtils";
import { MILESTONE_ORDER, MILESTONE_CHECKLISTS } from "@/lib/milestoneChecklist";
import { getStrategicProfile, hasAnyRole, isAnyAdmin } from "@/lib/roleProfiles";
import type {
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierDependencyType,
  ChantierMilestoneState,
  ChantierStaffing,
  Indicator,
  IndicatorMeasurement,
  IndicatorRiskStatus,
  MaturityStageConfig,
  MilestoneChecklistItem,
  MilestoneId,
  Program,
  ProgramType,
  StaffingFunction,
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
  indicator: Pick<Indicator, "id" | "kind" | "objectiveValue" | "direction">,
  measurements: IndicatorMeasurement[]
): IndicatorRiskStatus {
  if (indicator.kind === "qualitative") return "on_track";
  if (indicator.objectiveValue === undefined) return "on_track";
  const latest = latestMeasurement(indicator.id, measurements);
  if (!latest || latest.value === undefined) return "on_track";
  // "down" = plus bas vaut mieux (ex. délai, taux de rebut) ; défaut "up".
  return indicator.direction === "down"
    ? latest.value <= indicator.objectiveValue
      ? "on_track"
      : "at_risk"
    : latest.value >= indicator.objectiveValue
      ? "on_track"
      : "at_risk";
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
 *  l'affichage "82% vs cible 80%" (round 4, point 1 : rendre l'écart visuellement lisible). */
export type IndicatorDelta = {
  /** `latest.value - objectiveValue`, signé (positif = au-dessus de la cible). */
  delta: number;
  /** `delta / objectiveValue * 100`, signé ; 0 si `objectiveValue` vaut 0 (évite une division par
   *  zéro plutôt que de produire `Infinity`/`NaN`). */
  deltaPct: number;
  /** Progression vers la cible, 0-100, TOUJOURS bornée. Cadrage sensible au sens d'amélioration :
   *  pour "up" (plus haut vaut mieux), `valeur / objectif` ; pour "down" (plus bas vaut mieux), le
   *  cadrage est INVERSÉ (`objectif / valeur`), sans quoi une valeur descendant sous la cible
   *  afficherait une progression qui DIMINUE alors que l'indicateur s'améliore. */
  progressPct: number;
  /** `true` si l'écart va dans le bon sens — même convention de signe que `computeIndicatorStatus`
   *  ("down" : `delta <= 0` est favorable ; sinon `delta >= 0`). */
  favorable: boolean;
};

/** `undefined` avec les MÊMES garde-fous que `computeIndicatorStatus` : pas d'objectif chiffré, ou
 *  pas de mesure exploitable (absente ou sans valeur numérique) — rien à afficher plutôt qu'un
 *  écart inventé. */
export function computeIndicatorDelta(
  indicator: Pick<Indicator, "objectiveValue" | "direction">,
  latest: IndicatorMeasurement | undefined
): IndicatorDelta | undefined {
  if (indicator.objectiveValue === undefined) return undefined;
  if (!latest || latest.value === undefined) return undefined;

  const value = latest.value;
  const objective = indicator.objectiveValue;
  const isDown = indicator.direction === "down";

  const delta = value - objective;
  const deltaPct = objective !== 0 ? (delta / objective) * 100 : 0;
  const favorable = isDown ? delta <= 0 : delta >= 0;

  const rawProgress = isDown
    ? value !== 0
      ? (objective / value) * 100
      : objective === 0
        ? 100
        : 0
    : objective !== 0
      ? (value / objective) * 100
      : value >= 0
        ? 100
        : 0;
  const progressPct = Math.max(0, Math.min(100, rawProgress));

  return { delta, deltaPct, progressPct, favorable };
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
      delta: computeIndicatorDelta(indicator, latestMeasurement(indicator.id, measurements)),
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
 * Calcule la valeur DÉCLARATIVE (0-100, round 12) des items AUTOMATIQUES d'un jalon donné
 * (`ChecklistItemDef.auto`, contenu défini dans `lib/milestoneChecklist.ts`) — les items manuels de
 * ce même jalon n'apparaissent PAS dans le résultat, c'est à l'appelant (l'UI, ou
 * `milestoneProgressPct` via son paramètre `autoValues`) de fusionner cette map avec les valeurs
 * manuelles déjà enregistrées sur le LEVIER (`action.milestones.checklists[milestoneId]`).
 *
 * Round 12 : ENCODAGE de sortie changé de `ChecklistFlag` ("green"/"red", jamais "orange" pour un
 * item auto) à un NOMBRE — `100` où l'ancien code renvoyait "green", `0` où il renvoyait "red" —
 * pour s'aligner sur `MilestoneChecklistItem.progressPct`, qui remplace le feu discret. Les
 * conditions sous-jacentes des trois règles sont INCHANGÉES, sauf `previousOranges` qui doit
 * retraduire la notion d'"orange non soldé" : le feu discret ayant disparu du modèle, l'équivalent
 * est désormais un item manuel dont le `progressPct` déclaré est STRICTEMENT compris entre 0 et
 * 100 (ni "à l'arrêt", ni "fait") et qui n'est pas `resolved` — un item non répondu (`progressPct
 * === undefined`) n'est PAS considéré ici (il bloque déjà `canPassMilestone` en amont, ce n'est
 * pas à cet item auto de le re-signaler).
 *
 * Round 7 : retargetée du chantier vers le LEVIER (`ChantierAction`) — le suivi E0→E4 vit
 * désormais par levier (voir `ChantierAction.milestones`), un chantier regroupant plusieurs
 * leviers qui avancent chacun à leur rythme. `dependencyAlert` et `effortComplete` restent des
 * signaux CHANTIER (dépendances et grille d'effort n'ont pas été déplacées ce round) : ils
 * résolvent le chantier PARENT via `action.chantierId` puis lisent son propre état — c'est
 * pourquoi tous les leviers d'un même chantier affichent la MÊME valeur pour ces deux items,
 * intentionnellement.
 *
 * Les trois tags `auto` correspondent chacun à une règle de la note PMO du PO, rendue automatique
 * plutôt que posée comme une question (voir le commentaire de `ChecklistItemDef` pour le détail de
 * chaque règle) :
 *  - `previousOranges` : `100` si tous les items à progression partielle du jalon PRÉCÉDENT du
 *    LEVIER sont soldés (`resolved === true`), `100` aussi s'il n'y en avait aucun (vacuously) —
 *    `0` sinon. N'apparaît jamais sur E0 (pas de jalon précédent dans `MILESTONE_ORDER`).
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
      case "previousOranges": {
        const index = MILESTONE_ORDER.indexOf(milestoneId);
        const previousMilestone = index > 0 ? MILESTONE_ORDER[index - 1] : undefined;
        const previousItems = previousMilestone
          ? (action.milestones?.checklists?.[previousMilestone] ?? [])
          : [];
        const hasUnresolvedPartial = previousItems.some(
          (i) =>
            i.progressPct !== undefined && i.progressPct > 0 && i.progressPct < 100 && !i.resolved
        );
        flags[item.itemId] = hasUnresolvedPartial ? 0 : 100;
        break;
      }
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
 * action bloquée de démarrer), ce verrou est réel** : correspond à la règle explicite de la note
 * PMO du PO ("un rouge = pas de passage"), retraduite en round 12 pour le modèle déclaratif
 * `progressPct` (0-100) : `canPass` est faux si un item quelconque a `progressPct === 0`
 * (équivalent de l'ancien rouge), ou si un item n'a encore aucune valeur déclarée (`progressPct
 * === undefined`, pas répondu) — toute valeur STRICTEMENT positive, aussi faible soit-elle,
 * n'empêche PAS de passer (c'est l'équivalent de l'ancien vert ET de l'ancien orange, qui
 * passaient déjà tous les deux : seul le rouge bloquait). Ne lève jamais d'exception ; une
 * check-list vide renvoie `canPass: true`.
 */
export function canPassMilestone(
  milestoneId: MilestoneId,
  items: MilestoneChecklistItem[]
): { canPass: boolean; reasons: string[] } {
  const reasons: string[] = [];

  for (const item of items) {
    if (item.progressPct === undefined) {
      reasons.push(`Item non répondu (${milestoneId}, ${item.itemId})`);
    } else if (item.progressPct === 0) {
      reasons.push(`Item bloquant en rouge (${milestoneId}, ${item.itemId})`);
    }
  }

  return { canPass: reasons.length === 0, reasons };
}

/**
 * Avancement en pourcentage (0-100) d'une entité portant un état de jalon E0→E4 — remplace
 * `chantierProgress()` sur les affichages de progression, comme avant round 5.
 *
 * Round 12 : remplissage FIN à l'intérieur du jalon COURANT, au lieu du calcul par paliers de 20
 * (`passedMilestones.length * 20`) qui traitait un jalon en cours comme s'il ne valait jamais rien
 * tant qu'il n'était pas officiellement franchi. Nouveau calcul :
 *  1. `passedMilestones.length * 20` — crédit plein pour chaque jalon déjà validé.
 *  2. PLUS, si le jalon COURANT n'est PAS déjà dans `passedMilestones` (garde-fou anti double
 *     comptage : seul cas de recoupement possible, une fois E4 validé, où le jalon courant reste
 *     E4 faute de jalon suivant) : un crédit partiel `20 * moyenne / 100`, où `moyenne` porte sur
 *     TOUS les items définis pour ce jalon dans `MILESTONE_CHECKLISTS` (pas seulement ceux déjà
 *     répondus — un item absent de `checklists[currentMilestone]` compte pour `0`, comme un item
 *     répondu à `0`).
 *  3. Total plafonné à 100 et arrondi (`Math.round`) — les paliers de 20 restent exacts mais le
 *     crédit partiel de l'étape 2 ne l'est en général pas.
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

  let total = milestones.passedMilestones.length * 20;

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
    total += (20 * average) / 100;
  }

  return Math.min(100, Math.round(total));
}

/**
 * Avancement AGRÉGÉ d'un chantier en pourcentage (round 7) — moyenne de `milestoneProgressPct`
 * sur les leviers (`ChantierAction`) du chantier, décision actée avec le PO ("agrégation chantier
 * = moyenne des leviers"). Remplace `milestoneProgressPct(chantier)` sur tous les points d'appel
 * historiques : le suivi E0→E4 vit désormais par levier, `Chantier.milestones` est `@deprecated`.
 *
 * Round 8 : le suivi E0→E4 devient CONDITIONNÉ au rattachement d'un levier à un KPI
 * (`ChantierAction.indicatorId` défini — voir son commentaire) ; un levier sans KPI utilise à la
 * place un kanban classique (`kanbanStatus`), hors de la notion de jalon. La moyenne ne porte donc
 * QUE sur les leviers du chantier RATTACHÉS À UN KPI (`a.chantierId === chantier.id && a.indicatorId`)
 * — un levier sans KPI est exclu du DÉNOMINATEUR (ni compté à 0 %, ni ignoré silencieusement dans un
 * dénominateur qui l'inclurait quand même).
 *
 * 0 si le chantier n'a aucun levier RATTACHÉ À UN KPI (aucun levier du tout, ou uniquement des
 * leviers sans KPI) — même parti pris que `chantierProgress()`, pas de division par zéro déguisée ;
 * un chantier dont aucun levier n'est KPI-lié se comporte donc exactement comme un chantier sans
 * aucun levier. Arrondi (`Math.round`) car `milestoneProgressPct` ne retourne que des multiples de
 * 20 mais leur moyenne ne l'est en général pas.
 */
export function chantierMilestoneProgressPct(
  chantier: Pick<Chantier, "id">,
  actions: ChantierAction[]
): number {
  const own = actions.filter((a) => a.chantierId === chantier.id && a.indicatorId);
  if (own.length === 0) return 0;
  const total = own.reduce((sum, action) => sum + milestoneProgressPct(action), 0);
  return Math.round(total / own.length);
}

// ─── Poids illustratif par jalon (round 9) ─────────────────────────────────────────────────────

/**
 * Poids illustratifs par jalon, donnés directement par le PO — E0/E1/E2 sont des étapes de cadrage
 * léger, E3 la vraie phase d'exécution (longue), E4 la clôture complète. Utilisés UNIQUEMENT pour
 * le remplissage visuel (fond proportionnel) des blocs de `LevierMilestoneBoard.tsx` — **ne
 * remplace ni `milestoneProgressPct` ni `chantierMilestoneProgressPct`**, qui restent la seule
 * source pour les barres de progression existantes (chantier, Gantt, etc.).
 */
export const MILESTONE_WEIGHT: Record<MilestoneId, number> = {
  E0: 10,
  E1: 15,
  E2: 20,
  E3: 60,
  E4: 100,
};

/**
 * Poids du jalon COURANT d'une entité (pas un cumul des jalons franchis, contrairement à
 * `milestoneProgressPct`) — alimente le remplissage visuel de `LevierMilestoneBoard.tsx`. Une
 * entité sans état de jalon du tout (`milestones` absent) est traitée comme si elle était à E0.
 */
export function milestoneWeightPct(entity: { milestones?: ChantierMilestoneState }): number {
  const current = entity.milestones?.currentMilestone;
  return current ? MILESTONE_WEIGHT[current] : MILESTONE_WEIGHT.E0;
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

/** Palette catégorielle fixe (Tailwind, fond plein) — même convention que
 *  `STAFFING_FUNCTION_COLORS` (`components/strategic/ChantierStaffingEditor.tsx`) : classes
 *  `bg-*-500` de la palette Tailwind par défaut, pas de token `bp-*` de marque (déjà réservés à
 *  d'autres usages). Purement catégorielle, sans rapport avec un statut à-risque (`rag-*`). Ordre
 *  arbitraire mais stable : ne jamais réordonner ce tableau, `colorForChantier` en dépend pour
 *  rester déterministe dans le temps. */
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
export function colorForChantier(chantierId: string): string {
  let sum = 0;
  for (let i = 0; i < chantierId.length; i += 1) sum += chantierId.charCodeAt(i);
  return CHANTIER_COLOR_PALETTE[sum % CHANTIER_COLOR_PALETTE.length];
}

// ─── Staffing par période (round 7) ────────────────────────────────────────────────────────────

/** Une entrée de staffing par période/fonction, alimentant `StaffingPeriodBreakdown.tsx`. */
export type StaffingPeriodBucket = {
  /** Étiquette de période, format lexicographiquement triable — même convention que
   *  `IndicatorMeasurement.period` : `"YYYY-Q#"` (trimestriel), `"YYYY-S#"` (semestriel),
   *  `"YYYY"` (annuel). */
  period: string;
  totalFte: number;
  byFunction: Partial<Record<StaffingFunction, number>>;
};

/** Calcule le libellé de période (voir `StaffingPeriodBucket.period`) d'une date ISO pour une
 *  granularité donnée. Fonction interne, pas exportée : `staffingPeriodBuckets` est le seul point
 *  d'entrée public de ce découpage. */
function periodLabelForDate(
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
 *     chaque chantier dont `axisId === axis.id`, ses indicateurs (`chantierId === chantier.id`)
 *     dans l'ordre de `indicators`.
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
      .filter((c) => c.axisId === axis.id)
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

// ─── Budget par levier (round 12) ──────────────────────────────────────────────────────────────

/**
 * Somme des budgets LEVIER (`ChantierAction.budget`, round 12) d'un chantier donné — pendant de
 * `Chantier.allocatedBudget` mais agrégé depuis les leviers plutôt que saisi directement sur le
 * chantier ; les deux budgets COEXISTENT (l'un n'est pas déduit de l'autre, l'agrégat des leviers
 * n'est PAS censé égaler `allocatedBudget`, c'est à l'appelant de les comparer si besoin).
 *
 * Un levier sans `budget` renseigné compte pour `0` (jamais exclu de la somme, contrairement à
 * `chantierMilestoneProgressPct` où un levier sans KPI est exclu du DÉNOMINATEUR d'une moyenne :
 * ici il n'y a pas de moyenne, seulement une somme, donc rien à exclure). Chantier sans aucun
 * levier, ou uniquement des leviers sans budget : `0`.
 */
export function sumLevierBudgets(chantierId: string, actions: ChantierAction[]): number {
  return actions
    .filter((action) => action.chantierId === chantierId)
    .reduce((sum, action) => sum + (action.budget ?? 0), 0);
}

// ─── Responsable affiché d'un indicateur (round 12) ────────────────────────────────────────────

/**
 * Libellé du "responsable" d'un indicateur pour l'AFFICHAGE (ex. colonne "Responsable" de la page
 * KPI) — PAS une habilitation : voir `canFillIndicator` pour qui a le droit de saisir une mesure,
 * une notion distincte et volontairement plus permissive (rôles/utilisateurs autorisés, pas une
 * personne unique).
 *
 * Deux niveaux de résolution, selon que l'indicateur est rattaché à un chantier ou macro (porté
 * directement par un axe) :
 *  - `indicator.chantierId` défini : résout CE CHANTIER et retourne son pilote opérationnel
 *    (`Chantier.pilote`) en priorité — c'est lui qui fait avancer le chantier au jour le jour,
 *    information plus pertinente ici que le sponsor COMEX — à défaut son sponsor
 *    (`Chantier.sponsorName`), à défaut des deux `unassignedLabel`. Chantier introuvable
 *    (référence orpheline) : `unassignedLabel`, jamais d'exception.
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
    return chantier?.pilote ?? chantier?.sponsorName ?? unassignedLabel;
  }
  const axis = axes.find((a) => a.id === indicator.axisId);
  return axis?.owner ?? unassignedLabel;
}
