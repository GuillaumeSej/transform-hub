import {
  chantierDependencyAlerts,
  isProjetDone,
  isProjetLate,
  type ChantierDependencyAlert,
  type ProjetProgressLookup,
} from "@/lib/axisLogic";
import type { Chantier, ChantierAction, ChantierDependencyType } from "@/types";

/**
 * Carte « Dépendances » de l'onglet « Vue d'ensemble » d'une fiche chantier — helper PUR qui
 * rassemble, SANS nouvelle règle de calcul, les deux familles de dépendances existantes :
 *  - entre CHANTIERS (`Chantier.dependencies`, types FS/SS/FF/SF), statut « en retard » ssi
 *    `chantierDependencyAlerts` lève une alerte sur ce couple (même alerte que le Gantt, le
 *    dashboard et les cartes projet) ;
 *  - entre PROJETS (`ChantierAction.prerequisites`) : un prérequis « projet » signifie « doit être
 *    TERMINÉ avant que ce projet démarre », soit une relation FS. Satisfait selon `isProjetDone`
 *    (même règle que `canStartAction`), « en retard » quand le projet prédécesseur, non terminé,
 *    est lui-même en retard (`isProjetLate`). Un prérequis externe n'a pas de type.
 *
 * `direction` est lue depuis CE chantier : `predecessor` = l'autre extrémité doit avancer avant
 * nous (nous en dépendons), `successor` = l'autre extrémité dépend de nous.
 */

export type DependencyOverviewStatus = "ok" | "pending" | "late";

export type DependencyOverviewRow = {
  key: string;
  scope: "chantier" | "projet";
  direction: "predecessor" | "successor";
  /** Absent pour un prérequis externe. */
  type?: ChantierDependencyType;
  /** Côté CE chantier : le chantier lui-même (scope "chantier") ou un de ses projets. */
  localId: string;
  localName: string;
  /** Autre extrémité de la dépendance. */
  otherKind: "chantier" | "projet" | "external";
  otherId?: string;
  /** Chantier porteur de l'autre extrémité (= `otherId` pour un chantier, parent pour un projet). */
  otherChantierId?: string;
  otherName: string;
  status: DependencyOverviewStatus;
  /** Jours de décalage (dépendance chantier en alerte uniquement). */
  delayDays?: number;
};

const STATUS_RANK: Record<DependencyOverviewStatus, number> = { late: 0, pending: 1, ok: 2 };

function projetPrereqStatus(
  target: ChantierAction,
  progressOf: ProjetProgressLookup | undefined,
  today: Date | undefined
): DependencyOverviewStatus {
  if (isProjetDone(target, progressOf)) return "ok";
  const pct = progressOf ? progressOf(target) : undefined;
  // `isProjetLate` exige le MÊME pourcentage que celui affiché : on lui passe celui du résolveur,
  // à défaut 0 (non terminé, déjà établi par `isProjetDone` ci-dessus).
  return isProjetLate(target, pct ?? 0, today) ? "late" : "pending";
}

export function chantierDependencyOverview(
  chantier: Pick<Chantier, "id" | "name">,
  chantiers: Chantier[],
  actions: ChantierAction[],
  options: {
    progressOf?: ProjetProgressLookup;
    today?: Date;
    /** Alertes déjà calculées (évite un second passage sur tout le programme). */
    alerts?: ChantierDependencyAlert[];
  } = {}
): DependencyOverviewRow[] {
  const { progressOf, today } = options;
  const alerts = options.alerts ?? chantierDependencyAlerts(chantiers, actions);
  const alertOf = (sourceId: string, targetId: string, type: ChantierDependencyType) =>
    alerts.find((a) => a.sourceId === sourceId && a.targetId === targetId && a.type === type);
  const chantierById = new Map(chantiers.map((c) => [c.id, c]));
  const actionById = new Map(actions.map((a) => [a.id, a]));
  const rows: DependencyOverviewRow[] = [];

  // ── Chantier → chantier ──────────────────────────────────────────────────────────────────────
  const self = chantierById.get(chantier.id);
  for (const dep of self?.dependencies ?? []) {
    const other = chantierById.get(dep.targetId);
    if (!other) continue;
    const alert = alertOf(chantier.id, other.id, dep.type);
    rows.push({
      key: `c-pred-${other.id}-${dep.type}`,
      scope: "chantier",
      direction: "predecessor",
      type: dep.type,
      localId: chantier.id,
      localName: chantier.name,
      otherKind: "chantier",
      otherId: other.id,
      otherChantierId: other.id,
      otherName: other.name,
      status: alert ? "late" : "ok",
      delayDays: alert?.delayDays,
    });
  }
  for (const other of chantiers) {
    if (other.id === chantier.id) continue;
    for (const dep of other.dependencies ?? []) {
      if (dep.targetId !== chantier.id) continue;
      const alert = alertOf(other.id, chantier.id, dep.type);
      rows.push({
        key: `c-succ-${other.id}-${dep.type}`,
        scope: "chantier",
        direction: "successor",
        type: dep.type,
        localId: chantier.id,
        localName: chantier.name,
        otherKind: "chantier",
        otherId: other.id,
        otherChantierId: other.id,
        otherName: other.name,
        status: alert ? "late" : "ok",
        delayDays: alert?.delayDays,
      });
    }
  }

  // ── Projet → projet (prérequis) ──────────────────────────────────────────────────────────────
  const own = actions.filter((a) => a.chantierId === chantier.id);
  const ownIds = new Set(own.map((a) => a.id));
  for (const action of own) {
    for (const prereq of action.prerequisites ?? []) {
      if (prereq.kind === "external") {
        rows.push({
          key: `p-pred-${action.id}-${prereq.id}`,
          scope: "projet",
          direction: "predecessor",
          localId: action.id,
          localName: action.name,
          otherKind: "external",
          otherName: prereq.label ?? "",
          status: prereq.done ? "ok" : "pending",
        });
        continue;
      }
      const target = prereq.targetActionId ? actionById.get(prereq.targetActionId) : undefined;
      if (!target) continue; // cible supprimée : déjà signalée sur la carte projet.
      rows.push({
        key: `p-pred-${action.id}-${prereq.id}`,
        scope: "projet",
        direction: "predecessor",
        type: "FS",
        localId: action.id,
        localName: action.name,
        otherKind: "projet",
        otherId: target.id,
        otherChantierId: target.chantierId,
        otherName: target.name,
        status: projetPrereqStatus(target, progressOf, today),
      });
    }
  }
  // Successeurs : projets d'AUTRES chantiers dont un prérequis vise un de nos projets (un
  // successeur interne au chantier figure déjà ci-dessus, côté prédécesseur de son projet).
  for (const action of actions) {
    if (ownIds.has(action.id)) continue;
    for (const prereq of action.prerequisites ?? []) {
      if (prereq.kind !== "action" || !prereq.targetActionId) continue;
      if (!ownIds.has(prereq.targetActionId)) continue;
      const local = actionById.get(prereq.targetActionId)!;
      rows.push({
        key: `p-succ-${action.id}-${prereq.id}`,
        scope: "projet",
        direction: "successor",
        type: "FS",
        localId: local.id,
        localName: local.name,
        otherKind: "projet",
        otherId: action.id,
        otherChantierId: action.chantierId,
        otherName: action.name,
        status: projetPrereqStatus(local, progressOf, today),
      });
    }
  }

  // Alertes d'abord, puis chantier avant projet, puis ordre de déclaration (tri stable).
  return rows
    .map((row, i) => ({ row, i }))
    .sort(
      (a, b) =>
        STATUS_RANK[a.row.status] - STATUS_RANK[b.row.status] ||
        (a.row.scope === b.row.scope ? 0 : a.row.scope === "chantier" ? -1 : 1) ||
        a.i - b.i
    )
    .map(({ row }) => row);
}
