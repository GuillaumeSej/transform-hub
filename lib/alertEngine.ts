import type { Alert, BeTrackData, ProgramType } from "@/types";
import { underperformers, dependencyAlerts, leverImpactsOf } from "@/lib/engine";

/**
 * Générateur d'alertes automatiques — fonction pure qui analyse les données du programme
 * et produit des alertes structurées pour les leviers en retard, en dépassement de coûts
 * (CAPEX/one-off ou OPEX récurrent), ou avec savings réduits.
 *
 * Les alertes auto sont fusionnées avec les alertes manuelles (data.alerts) et dédupliquées
 * par scope (une alerte manuelle sur un levier a priorité sur l'auto-générée pour ce levier).
 *
 * Tri final : "À traiter" d'abord → sévérité (red > amber > green > blue) → |impactEur| décroissant.
 */

const SEVERITY_ORDER: Record<string, number> = { red: 0, amber: 1, green: 2, blue: 3 };

/** Coûts d'implémentation (CAPEX + OPEX one-off), hors OPEX récurrent. */
function implCosts(s: { capex: number; opexOneOff: number }): number {
  return s.capex + s.opexOneOff;
}

/** Formatte un montant en €K ou €M lisible. */
function fmtImpact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1) return `${v > 0 ? "+" : ""}€${v.toFixed(1)}M`;
  return `${v > 0 ? "+" : ""}€${Math.round(v * 1000)}K`;
}

/**
 * @param programType Type du programme dont on génère les alertes — voir `useActiveProgram`.
 *   Passé EXPLICITEMENT par l'appelant plutôt que déduit ici : `BeTrackData` ne porte aucune
 *   référence au `Program` sélectionné. Non renseigné = "performance", c'est-à-dire le
 *   comportement historique inchangé pour tous les appelants existants.
 *
 *   Pour un Plan Stratégique, les alertes de SEUIL FINANCIER (dépassement de coûts
 *   CAPEX/OPEX, savings réduits) ne sont pas générées : ce plan n'a aucune notion financière au
 *   niveau chantier/action. Les alertes de cascade de dépendance, elles, restent générées (côté
 *   stratégique, l'équivalent inter-chantiers vit dans `axisLogic.chantierDependencyAlerts`).
 */
export function generateAlerts(
  data: BeTrackData,
  programType: ProgramType = "performance"
): Alert[] {
  const auto: Alert[] = [];
  const active = data.levers.filter((l) => l.status !== "cancelled");
  const financialAlertsEnabled = programType !== "strategic";

  // ── 1. Leviers en retard — dérivé UNIQUEMENT du retard de leurs actions ────
  // (voir engine.underperformers / engine.isActionLate : c'est le seul mécanisme de détection).
  const underperf = underperformers(data);
  for (const u of underperf) {
    const totalActions = u.actions?.length ?? 0;
    const lateRatio = totalActions > 0 ? u.lateActionsCount / totalActions : 0;
    // Impact = montant RÉEL des actions en retard (somme des ActionImpact.amount de type "saving"
    // des actions en retard), pas netSavings du levier × ratio d'actions en retard — c'est le gain
    // potentiellement perdu si ces actions en retard ne se réalisent pas, pas une estimation
    // proportionnelle déconnectée des impacts réellement saisis.
    // Impacts désormais portés par le levier : on prend les gains récurrents du levier au prorata
    // des actions en retard (les gains one-off restent hors périmètre).
    const leverSavings = leverImpactsOf(u)
      .filter((i) => i.type === "saving" && i.gainRecurrence !== "oneoff")
      .reduce((s, i) => s + i.amount, 0);
    const lateSavingsImpact = lateRatio * leverSavings;
    const impact = -lateSavingsImpact;
    auto.push({
      id: `AUTO-DELAY-${u.id}`,
      type: lateRatio > 0.5 ? "red" : "amber",
      ts: u.lastUpdate || "",
      scope: u.id,
      title: `Levier "${u.name}" en retard : ${u.lateActionsCount} action(s) sur ${totalActions}`,
      desc: `${u.lateActionsCount} action(s) du plan d'action sont en retard (date de fin dépassée ou statut "En retard"). Impact estimé : ${fmtImpact(impact)} sur le run-rate.`,
      actorRole: "lever",
      impactEur: Math.round(impact * 1000000),
      owner: u.owner,
      companyId: u.companyId,
      source: "auto",
      resolved: false,
    });
  }

  // ── 2. Conflits de dépendances ──────────────────────────────────────────────
  const depAlerts = dependencyAlerts(data);
  for (const da of depAlerts) {
    const sourceLever = data.levers.find((l) => l.id === da.sourceId);
    auto.push({
      id: `AUTO-DEP-${da.sourceId}-${da.targetId}`,
      type: "amber",
      ts: sourceLever?.lastUpdate || "",
      scope: da.sourceId,
      title: `Dépendance bloquée : ${da.sourceName} → ${da.targetName}`,
      desc: da.message,
      actorRole: "lever",
      impactEur: sourceLever ? Math.round(-(sourceLever.netSavings * 1000000)) : undefined,
      owner: sourceLever?.owner,
      companyId: sourceLever?.companyId,
      source: "auto",
      resolved: false,
    });
  }

  // ── 3. Dépassement de coûts (dès le 1er €) — Plan Performance uniquement ───
  for (const l of financialAlertsEnabled ? active : []) {
    if (!l.reforecast || !l.lockedPlan) continue;
    const planCost = implCosts(l.lockedPlan);
    const refCost = implCosts(l.reforecast);
    if (refCost > planCost) {
      const delta = refCost - planCost;
      auto.push({
        id: `AUTO-COST-${l.id}`,
        type: "red",
        ts: l.lastUpdate,
        scope: l.id,
        title: `Dépassement coûts : ${l.name}`,
        desc: `Reforecast ${fmtImpact(refCost)} vs plan ${fmtImpact(planCost)} (+${fmtImpact(delta)}).`,
        actorRole: "finance",
        impactEur: Math.round(-delta * 1000000),
        owner: l.owner,
        companyId: l.companyId,
        source: "auto",
        resolved: false,
      });
    }
  }

  // ── 3bis. Dépassement OPEX récurrent (dès le 1er €) — Plan Performance uniquement ─
  for (const l of financialAlertsEnabled ? active : []) {
    if (!l.reforecast || !l.lockedPlan) continue;
    if (l.reforecast.opexRec > l.lockedPlan.opexRec) {
      const delta = l.reforecast.opexRec - l.lockedPlan.opexRec;
      auto.push({
        id: `AUTO-OPEXREC-${l.id}`,
        type: "red",
        ts: l.lastUpdate,
        scope: l.id,
        title: `Dépassement OPEX récurrent : ${l.name}`,
        desc: `Reforecast ${fmtImpact(l.reforecast.opexRec)} vs plan ${fmtImpact(l.lockedPlan.opexRec)} (+${fmtImpact(delta)}).`,
        actorRole: "finance",
        impactEur: Math.round(-delta * 1000000),
        owner: l.owner,
        companyId: l.companyId,
        source: "auto",
        resolved: false,
      });
    }
  }

  // ── 4. Savings réduits (dès le 1er €) — Plan Performance uniquement ─────────
  for (const l of financialAlertsEnabled ? active : []) {
    if (!l.reforecast || !l.lockedPlan) continue;
    if (l.reforecast.netSavings < l.lockedPlan.netSavings) {
      const delta = l.lockedPlan.netSavings - l.reforecast.netSavings;
      auto.push({
        id: `AUTO-SAVINGS-${l.id}`,
        type: "amber",
        ts: l.lastUpdate,
        scope: l.id,
        title: `Savings réduits : ${l.name}`,
        desc: `Reforecast ${fmtImpact(l.reforecast.netSavings)} vs plan ${fmtImpact(l.lockedPlan.netSavings)} (−${fmtImpact(delta)}).`,
        actorRole: "finance",
        impactEur: Math.round(-delta * 1000000),
        owner: l.owner,
        companyId: l.companyId,
        source: "auto",
        resolved: false,
      });
    }
  }

  // ── Fusion avec alertes manuelles ──────────────────────────────────────────
  // Une alerte manuelle ne masque les alertes automatiques du scope que si son auteur a choisi
  // explicitement cette option lors de la création.
  const manualScopes = new Set(
    data.alerts
      .filter((a) => a.suppressAutomaticAlerts === true)
      .map((a) => `${a.companyId ?? "global"}__${a.scope}`)
  );
  const manualAlerts: Alert[] = data.alerts.map((a) => ({
    ...a,
    source: a.source ?? ("manual" as const),
    resolved: a.resolved ?? false,
  }));
  const dedupedAuto = auto.filter(
    (a) => !manualScopes.has(`${a.companyId ?? "global"}__${a.scope}`)
  );
  const merged = [...manualAlerts, ...dedupedAuto].map((alert) => {
    const stateKey = `${alert.companyId ?? "global"}__${alert.id}`;
    const state = data.alertStates?.[stateKey] ?? data.alertStates?.[alert.id];
    return state ? { ...alert, ...state } : alert;
  });

  // ── Tri : "À traiter" d'abord → sévérité → |impactEur| décroissant ────────
  merged.sort((a, b) => {
    // À traiter avant résolu
    const ra = a.resolved ? 1 : 0;
    const rb = b.resolved ? 1 : 0;
    if (ra !== rb) return ra - rb;
    // Sévérité
    const sa = SEVERITY_ORDER[a.type] ?? 9;
    const sb = SEVERITY_ORDER[b.type] ?? 9;
    if (sa !== sb) return sa - sb;
    // Impact € décroissant (en valeur absolue)
    return Math.abs(b.impactEur ?? 0) - Math.abs(a.impactEur ?? 0);
  });

  return merged;
}
