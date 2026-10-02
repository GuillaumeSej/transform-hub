/**
 * Planificateur PUR (aucun import Firebase) du nettoyage des ORPHELINS du Plan Stratégique (lot 3
 * intégrité). Utilisé par scripts/clean-strategic-orphans.js (lecture Firestore + écriture sur
 * demande explicite) et testé par lib/__tests__/strategicOrphanCleanupPlan.test.ts.
 *
 * Contexte : avant le lot 3, supprimer un chantier/projet/indicateur (directement ou via une
 * demande de validation) ne supprimait pas tout ce qui en dépendait. Ces restes faussent les
 * chiffres (ex. taux de staffing IT d'octobre à 125 % au lieu de 90 % avec 3,5 ETP orphelins,
 * indicateur orphelin compté « à risque » + alerte cloche). L'application les IGNORE désormais
 * (filtre défensif `dropOrphanStaffing`/`dropOrphanIndicators`, lib/strategicIntegrity.ts) ; ce
 * script les retire de la base, avec les MÊMES règles que la cascade de suppression
 * (`planDeletionCascade`).
 *
 * Entrée : `snapshot` = documents bruts d'UNE entreprise
 *   { axes, chantiers, chantierActions, staffing, indicators, measurements, approvals }
 * (chaque document porte son `id`). `ctx` = { now: ISO, actor: string }.
 * Sortie : `{ writes: [{ op: "delete" | "update", path, data? }], report }`.
 *
 * Écritures (automatiques, déterministes) :
 *  - projet dont le chantier n'existe plus → supprimé ;
 *  - ligne ETP dont le chantier n'existe plus, ou rattachée à un projet qui n'existe plus →
 *    supprimée ;
 *  - indicateur dont le chantier (s'il en a un) n'existe plus → supprimé ;
 *  - mesure dont l'indicateur n'existe plus (ou vient d'être supprimé) → supprimée ;
 *  - dépendance de chantier vers un chantier inexistant → retirée ;
 *  - prérequis de projet vers un projet inexistant → retiré ;
 *  - `axisIds` d'un chantier : ids d'axes inexistants retirés SI le chantier garde au moins un axe
 *    existant ;
 *  - demande de validation EN ATTENTE dont la cible n'existe plus → statut « cancelled », motif
 *    « Cible supprimée » (jamais supprimée : l'historique des décisions est conservé). Exception :
 *    `axe_create`, dont la cible est par construction l'axe à créer.
 *
 * Signalé SANS écriture (décision métier, à traiter dans l'application) :
 *  - chantier dont AUCUN axe n'existe plus (affiché sous « Sans axe ») : à rattacher à un axe ;
 *  - indicateur macro (sans chantier) dont l'axe n'existe plus ;
 *  - mesure sur une période POSTÉRIEURE à la période en cours (selon la fréquence de
 *    l'indicateur) : à corriger ou supprimer.
 *
 * Idempotent : relancé sur l'état nettoyé, ne produit aucune écriture.
 */

const TARGET_DELETED_REASON = "Cible supprimée";

/** Intervalle [start, end] de mois absolus d'une période canonique (YYYY, YYYY-MM, YYYY-Qn,
 *  YYYY-Sn) ; `null` si non reconnue. Version minimale de lib/indicatorPeriod.ts. */
function periodRange(period) {
  const s = String(period ?? "")
    .trim()
    .toUpperCase();
  let m;
  if ((m = /^(\d{4})$/.exec(s))) return { start: +m[1] * 12, end: +m[1] * 12 + 11 };
  if ((m = /^(\d{4})-Q([1-4])$/.exec(s))) {
    const base = +m[1] * 12 + (+m[2] - 1) * 3;
    return { start: base, end: base + 2 };
  }
  if ((m = /^(\d{4})-S([12])$/.exec(s))) {
    const base = +m[1] * 12 + (+m[2] - 1) * 6;
    return { start: base, end: base + 5 };
  }
  if ((m = /^(\d{4})-(\d{1,2})$/.exec(s))) {
    const month = +m[2];
    if (month < 1 || month > 12) return null;
    const idx = +m[1] * 12 + month - 1;
    return { start: idx, end: idx };
  }
  return null;
}

const MONTHS_PER_FREQUENCY = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

/** Période en cours (intervalle de mois) selon la fréquence, à la date `now` (UTC). */
function currentRange(frequency, now) {
  const size = MONTHS_PER_FREQUENCY[frequency];
  if (!size) return null;
  const d = new Date(now);
  const monthIndex = d.getUTCFullYear() * 12 + d.getUTCMonth();
  const start = monthIndex - (d.getUTCMonth() % size);
  return { start, end: start + size - 1 };
}

/** La mesure porte-t-elle sur une période postérieure à la période en cours ? */
function isFuturePeriod(period, frequency, now) {
  const target = periodRange(period);
  const current = currentRange(frequency, now);
  return !!target && !!current && target.start > current.end;
}

function chantierAxisIds(c) {
  if (Array.isArray(c.axisIds) && c.axisIds.length > 0) return c.axisIds;
  return typeof c.axisId === "string" ? [c.axisId] : [];
}

function planStrategicOrphanCleanup(snapshot, ctx) {
  const now = ctx.now;
  const actor = ctx.actor || "script-nettoyage-orphelins";
  const axes = snapshot.axes || [];
  const chantiers = snapshot.chantiers || [];
  const actions = snapshot.chantierActions || [];
  const staffing = snapshot.staffing || [];
  const indicators = snapshot.indicators || [];
  const measurements = snapshot.measurements || [];
  const approvals = snapshot.approvals || [];

  const axisIds = new Set(axes.map((a) => a.id));
  const chantierIds = new Set(chantiers.map((c) => c.id));

  const writes = [];
  const report = {
    orphanActions: [],
    orphanStaffing: [],
    orphanIndicators: [],
    orphanMeasurements: [],
    dependencyUpdates: [],
    prerequisiteUpdates: [],
    axisIdsUpdates: [],
    cancelledApprovals: [],
    manual: [],
  };
  const del = (collection, id) => writes.push({ op: "delete", path: `${collection}/${id}` });

  // Projets d'un chantier disparu.
  const deadActions = new Set();
  for (const a of actions) {
    if (!chantierIds.has(a.chantierId)) {
      deadActions.add(a.id);
      report.orphanActions.push({ id: a.id, name: a.name, chantierId: a.chantierId });
      del("chantierActions", a.id);
    }
  }
  const liveActions = new Set(actions.filter((a) => !deadActions.has(a.id)).map((a) => a.id));

  // Lignes ETP : chantier disparu, ou projet disparu.
  for (const s of staffing) {
    const chantierGone = !chantierIds.has(s.chantierId);
    const actionGone = !!s.actionId && !liveActions.has(s.actionId);
    if (chantierGone || actionGone) {
      report.orphanStaffing.push({
        id: s.id,
        function: s.function,
        fte: s.fte,
        chantierId: s.chantierId,
        actionId: s.actionId || null,
        reason: chantierGone ? "chantier inexistant" : "projet inexistant",
      });
      del("chantierStaffing", s.id);
    }
  }

  // Indicateurs d'un chantier disparu ; indicateurs macro d'un axe disparu = signalés.
  const deadIndicators = new Set();
  for (const i of indicators) {
    if (i.chantierId && !chantierIds.has(i.chantierId)) {
      deadIndicators.add(i.id);
      report.orphanIndicators.push({ id: i.id, name: i.name, chantierId: i.chantierId });
      del("indicators", i.id);
    } else if (!i.chantierId && !axisIds.has(i.axisId)) {
      report.manual.push({
        path: `indicators/${i.id}`,
        issue: `indicateur macro « ${i.name} » rattaché à un axe inexistant (${i.axisId}) : à rattacher à un axe ou supprimer`,
      });
    }
  }
  const liveIndicators = new Map(
    indicators.filter((i) => !deadIndicators.has(i.id)).map((i) => [i.id, i])
  );

  // Mesures d'un indicateur disparu ; mesures futures = signalées.
  for (const m of measurements) {
    const indicator = liveIndicators.get(m.indicatorId);
    if (!indicator) {
      report.orphanMeasurements.push({ id: m.id, indicatorId: m.indicatorId, period: m.period });
      del("indicatorMeasurements", m.id);
    } else if (now && isFuturePeriod(m.period, indicator.frequency, now)) {
      report.manual.push({
        path: `indicatorMeasurements/${m.id}`,
        issue: `mesure future (${m.period}) de l'indicateur « ${indicator.name} » : à corriger ou supprimer`,
      });
    }
  }

  // Chantiers : dépendances vers un chantier disparu, axes disparus.
  for (const c of chantiers) {
    const deps = Array.isArray(c.dependencies) ? c.dependencies : [];
    const keptDeps = deps.filter((d) => chantierIds.has(d.targetId));
    const ids = chantierAxisIds(c);
    const keptAxes = ids.filter((id) => axisIds.has(id));
    const data = {};
    if (keptDeps.length !== deps.length) {
      data.dependencies = keptDeps;
      report.dependencyUpdates.push({ id: c.id, removed: deps.length - keptDeps.length });
    }
    if (keptAxes.length === 0) {
      report.manual.push({
        path: `chantiers/${c.id}`,
        issue: `chantier « ${c.name} » sans axe existant (${ids.join(", ") || "aucun"}) : affiché sous « Sans axe », à rattacher à un axe`,
      });
    } else if (keptAxes.length !== ids.length) {
      data.axisIds = keptAxes;
      report.axisIdsUpdates.push({ id: c.id, removed: ids.filter((id) => !axisIds.has(id)) });
    }
    if (Object.keys(data).length > 0)
      writes.push({ op: "update", path: `chantiers/${c.id}`, data });
  }

  // Prérequis de projet vers un projet disparu (projets survivants seulement).
  for (const a of actions) {
    if (deadActions.has(a.id) || !Array.isArray(a.prerequisites) || a.prerequisites.length === 0) {
      continue;
    }
    const kept = a.prerequisites.filter(
      (p) => !(p.kind === "action" && p.targetActionId && !liveActions.has(p.targetActionId))
    );
    if (kept.length !== a.prerequisites.length) {
      writes.push({ op: "update", path: `chantierActions/${a.id}`, data: { prerequisites: kept } });
      report.prerequisiteUpdates.push({ id: a.id, removed: a.prerequisites.length - kept.length });
    }
  }

  // Demandes en attente dont la cible n'existe plus → annulées.
  const exists = {
    axe: (id) => axisIds.has(id),
    chantier: (id) => chantierIds.has(id),
    projet: (id) => liveActions.has(id),
    indicateur: (id) => liveIndicators.has(id),
  };
  for (const a of approvals) {
    if (a.status !== "pending" || a.kind === "axe_create") continue;
    const check = exists[a.targetType];
    if (!check || check(a.targetId)) continue;
    writes.push({
      op: "update",
      path: `strategicApprovals/${a.id}`,
      data: {
        status: "cancelled",
        decidedBy: actor,
        decidedAt: now,
        decisionComment: TARGET_DELETED_REASON,
      },
    });
    report.cancelledApprovals.push({
      id: a.id,
      kind: a.kind,
      target: `${a.targetType}/${a.targetId}`,
      targetName: a.targetName || null,
    });
  }

  return { writes, report };
}

module.exports = {
  TARGET_DELETED_REASON,
  isFuturePeriod,
  planStrategicOrphanCleanup,
};
