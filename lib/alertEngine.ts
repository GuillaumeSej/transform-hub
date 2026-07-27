import type { Alert, BeTrackData, Lever } from "@/types";
import { realizedSavings, underperformers, dependencyAlerts } from "@/lib/engine";

/**
 * Générateur d'alertes automatiques — fonction pure qui analyse les données du programme
 * et produit des alertes structurées pour les leviers en retard, en dépassement de coûts,
 * avec savings réduits, ou récemment avancés à M4/M5.
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

/** Vérifie si la dernière mise à jour d'un levier date de moins de N jours. */
function isRecentUpdate(lever: Lever, withinDays: number): boolean {
  if (!lever.lastUpdate) return false;
  const diff = Date.now() - new Date(lever.lastUpdate).getTime();
  return diff >= 0 && diff < withinDays * 24 * 60 * 60 * 1000;
}

/** Formatte un montant en €K ou €M lisible. */
function fmtImpact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1) return `${v > 0 ? "+" : ""}€${v.toFixed(1)}M`;
  return `${v > 0 ? "+" : ""}€${Math.round(v * 1000)}K`;
}

export function generateAlerts(data: BeTrackData): Alert[] {
  const auto: Alert[] = [];
  const active = data.levers.filter((l) => l.status !== "cancelled");

  // ── 1. Leviers en retard (dès qu'il y a un écart) ──────────────────────────
  const underperf = underperformers(data);
  for (const u of underperf) {
    const gap = u.gap;
    if (gap <= 0) continue;
    const impact = -(u.netSavings * gap) / 100;
    auto.push({
      id: `AUTO-DELAY-${u.id}`,
      type: gap > 20 ? "red" : "amber",
      ts: u.lastUpdate || "",
      scope: u.id,
      title: `Levier "${u.name}" en retard de ${gap} pts`,
      desc: `Progression attendue ${u.expectedProgress}% vs réelle ${u.progress}%. Impact estimé : ${fmtImpact(impact)} sur le run-rate.`,
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
    const sourceSubLever = data.subLevers.find((l) => l.id === da.sourceId);
    const sourceLever = data.levers.find(
      (l) => l.id === da.sourceId || l.id === sourceSubLever?.leverId
    );
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
      companyId: sourceLever?.companyId ?? sourceSubLever?.companyId,
      source: "auto",
      resolved: false,
    });
  }

  // ── 3. Dépassement de coûts (dès le 1er €) ─────────────────────────────────
  for (const l of active) {
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

  // ── 4. Savings réduits (dès le 1er €) ───────────────────────────────────────
  for (const l of active) {
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

  // ── 5. Levier passé à Exécuté (M4) ou Réalisé (M5) récemment (< 7j) ──────
  for (const l of data.levers) {
    if (l.status === "in_progress" && isRecentUpdate(l, 7)) {
      auto.push({
        id: `AUTO-M4-${l.id}`,
        type: "green",
        ts: l.lastUpdate,
        scope: l.id,
        title: `Levier passé en exécution : ${l.name}`,
        desc: `Le levier est désormais en cours d'exécution (M4).`,
        actorRole: "lever",
        impactEur: 0,
        owner: l.owner,
        companyId: l.companyId,
        source: "auto",
        resolved: false,
      });
    }
    if (l.status === "delivered" && isRecentUpdate(l, 7)) {
      const realized = realizedSavings(l);
      auto.push({
        id: `AUTO-M5-${l.id}`,
        type: "green",
        ts: l.lastUpdate,
        scope: l.id,
        title: `Levier réalisé : ${l.name}`,
        desc: `Valeur réalisée : ${fmtImpact(realized)}.`,
        actorRole: "lever",
        impactEur: Math.round(realized * 1000000),
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
