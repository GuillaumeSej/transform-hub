import { daysBetween } from "@/lib/dateUtils";
import type {
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierDependencyType,
  Indicator,
  IndicatorMeasurement,
  IndicatorRiskStatus,
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
