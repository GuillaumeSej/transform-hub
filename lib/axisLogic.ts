import { daysBetween } from "@/lib/dateUtils";
import { MILESTONE_ORDER, MILESTONE_CHECKLISTS } from "@/lib/milestoneChecklist";
import type {
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierDependencyType,
  ChecklistFlag,
  Indicator,
  IndicatorMeasurement,
  IndicatorRiskStatus,
  MaturityStageConfig,
  MilestoneChecklistItem,
  MilestoneId,
  Program,
  ProgramType,
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
 */
export function canFillIndicator(
  indicator: Pick<Indicator, "responsibleRoles" | "additionalAuthorizedUserIds">,
  user: Pick<AuthUser, "role" | "username"> | null | undefined
): boolean {
  if (!user) return false;
  if (user.role === "admin" || user.role === "admin_entreprise") return true;
  if (indicator.responsibleRoles.includes(user.role)) return true;
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
  user: Pick<AuthUser, "role"> | null | undefined
): boolean {
  if (!user) return false;
  if (user.role === "admin" || user.role === "admin_entreprise") return true;
  const roles = chantier.responsibleRoles ?? [];
  if (roles.length === 0) return true;
  return roles.includes(user.role);
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
 * Calcule le feu des items AUTOMATIQUES d'un jalon donné (`ChecklistItemDef.auto`, contenu défini
 * dans `lib/milestoneChecklist.ts`) — les items manuels de ce même jalon n'apparaissent PAS dans le
 * résultat, c'est à l'appelant (l'UI) de fusionner cette map avec les feux manuels déjà enregistrés
 * sur le chantier (`chantier.milestones.checklists[milestoneId]`).
 *
 * Les trois tags `auto` correspondent chacun à une règle de la note PMO du PO, rendue automatique
 * plutôt que posée comme une question (voir le commentaire de `ChecklistItemDef` pour le détail de
 * chaque règle) :
 *  - `previousOranges` : vert si tous les items orange du jalon PRÉCÉDENT sont soldés
 *    (`resolved === true`), vert aussi s'il n'y en avait aucun (vacuously) — rouge sinon. N'apparaît
 *    jamais sur E0 (pas de jalon précédent dans `MILESTONE_ORDER`).
 *  - `dependencyAlert` : rouge si ce chantier est le côté BLOQUÉ (`sourceId`) d'au moins une alerte
 *    de `chantierDependencyAlerts` — vert sinon (y compris si l'alerte existe mais bloque un AUTRE
 *    chantier).
 *  - `effortComplete` : vert si les 4 dimensions de `chantier.effort` sont toutes renseignées
 *    (`!== undefined`), rouge sinon.
 */
export function resolveMilestoneAutoFlags(
  milestoneId: MilestoneId,
  chantier: Chantier,
  allChantiers: Chantier[],
  allActions: ChantierAction[]
): Record<string, ChecklistFlag> {
  const flags: Record<string, ChecklistFlag> = {};

  for (const item of MILESTONE_CHECKLISTS[milestoneId]) {
    if (!item.auto) continue;

    switch (item.auto) {
      case "previousOranges": {
        const index = MILESTONE_ORDER.indexOf(milestoneId);
        const previousMilestone = index > 0 ? MILESTONE_ORDER[index - 1] : undefined;
        const previousItems = previousMilestone
          ? (chantier.milestones?.checklists?.[previousMilestone] ?? [])
          : [];
        const hasUnresolvedOrange = previousItems.some((i) => i.flag === "orange" && !i.resolved);
        flags[item.itemId] = hasUnresolvedOrange ? "red" : "green";
        break;
      }
      case "dependencyAlert": {
        const alerts = chantierDependencyAlerts(allChantiers, allActions);
        const isAffected = alerts.some((a) => a.sourceId === chantier.id);
        flags[item.itemId] = isAffected ? "red" : "green";
        break;
      }
      case "effortComplete": {
        const effort = chantier.effort;
        const isComplete =
          effort?.financialImpact !== undefined &&
          effort?.humanImpact !== undefined &&
          effort?.duration !== undefined &&
          effort?.changeManagement !== undefined;
        flags[item.itemId] = isComplete ? "green" : "red";
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
 * PMO du PO ("un rouge = pas de passage"). `canPass` est faux si un item quelconque est `red`, ou
 * si un item n'a encore aucun feu (pas répondu) — un item orange, en revanche, n'empêche PAS de
 * passer (c'est tout le sens du feu orange : non-bloquant, avec un plan d'action). Ne lève jamais
 * d'exception ; une check-list vide renvoie `canPass: true`.
 */
export function canPassMilestone(
  milestoneId: MilestoneId,
  items: MilestoneChecklistItem[]
): { canPass: boolean; reasons: string[] } {
  const reasons: string[] = [];

  for (const item of items) {
    if (!item.flag) {
      reasons.push(`Item non répondu (${milestoneId}, ${item.itemId})`);
    } else if (item.flag === "red") {
      reasons.push(`Item bloquant en rouge (${milestoneId}, ${item.itemId})`);
    }
  }

  return { canPass: reasons.length === 0, reasons };
}

/**
 * Avancement d'un chantier en pourcentage, dérivé du nombre de jalons E0→E4 FRANCHIS (round 5) —
 * remplace `chantierProgress()` sur les 3 affichages de progression (fiche chantier, Gantt, carte
 * d'axe). 5 jalons possibles × 20% chacun, donc toujours un multiple de 20 entre 0 et 100.
 * `chantierProgress()` reste dans le code (peut resservir) mais n'est plus branché ici.
 */
export function milestoneProgressPct(chantier: Pick<Chantier, "milestones">): number {
  return (chantier.milestones?.passedMilestones.length ?? 0) * 20;
}
