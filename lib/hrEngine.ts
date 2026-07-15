import type { Lever, MovementType, Workforce, WorkforceMovement } from "@/types";
import { daysBetween } from "@/lib/dateUtils";
import { STATUS_ORDER } from "@/lib/status-config";

/**
 * Moteur de calcul pur du module RH — agrégations de la base ETP et des mouvements pour le
 * Dashboard RH (waterfall, breakdowns, PSE) et les alertes de réconciliation RH ↔ leviers.
 * Séparé de lib/engine.ts (leviers) pour limiter les conflits de merge : mêmes conventions,
 * fonctions pures qui prennent les données en paramètre.
 */

/** Date de référence du scénario démo — alignée sur DEMO_NOW de lib/engine.ts. */
export const HR_TODAY = "2026-06-22";

/** Effet d'un mouvement sur l'effectif TOTAL (les redéploiements/reconversions déplacent des
 * ETP entre départements sans changer le total). */
export function fteEffect(m: WorkforceMovement): number {
  if (m.type === "Suppression") return -m.fte;
  if (m.type === "Recrutement") return +m.fte;
  return 0;
}

export function currentFTE(wf: Workforce): number {
  return wf.totalFTE + wf.movements.filter((m) => m.status === "Réalisé").reduce((s, m) => s + fteEffect(m), 0);
}

/** Atterrissage : effectif si TOUS les mouvements du plan se réalisent. */
export function plannedFTE(wf: Workforce): number {
  return wf.totalFTE + wf.movements.reduce((s, m) => s + fteEffect(m), 0);
}

export function targetFTE(wf: Workforce): number {
  return wf.departments.reduce((s, d) => s + d.fteTarget, 0);
}

// ---------- Waterfall ETP ----------

export type FteBridgeBucket = {
  /** "Jan", "Fév"… ou "T1"… */
  label: string;
  delta: number;
  cumulative: number; // effectif total en fin de bucket
  movements: WorkforceMovement[];
};

const MONTH_LABELS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

/** Projection en cascade des mouvements 2026, par mois ou trimestre, de la baseline vers
 * l'atterrissage. Chaque bucket porte ses mouvements pour la décomposition par levier au clic. */
export function fteBridge(wf: Workforce, granularity: "month" | "quarter"): FteBridgeBucket[] {
  const bucketCount = granularity === "month" ? 12 : 4;
  const buckets: FteBridgeBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    label: granularity === "month" ? MONTH_LABELS[i] : `T${i + 1}`,
    delta: 0,
    cumulative: 0,
    movements: [],
  }));

  for (const m of wf.movements) {
    const month = Number(m.plannedDate.slice(5, 7)) - 1; // 0-11
    if (Number.isNaN(month) || month < 0 || month > 11) continue;
    const idx = granularity === "month" ? month : Math.floor(month / 3);
    buckets[idx].delta += fteEffect(m);
    buckets[idx].movements.push(m);
  }

  let running = wf.totalFTE;
  for (const b of buckets) {
    running += b.delta;
    b.cumulative = Math.round(running * 10) / 10;
  }
  return buckets;
}

/** Décomposition d'un bucket par levier (pour le drill-down au clic sur la waterfall). */
export function bucketByLever(
  bucket: FteBridgeBucket,
  levers: Lever[]
): { leverId: string; leverCode: string; leverName: string; movements: WorkforceMovement[]; fte: number }[] {
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
      fte: Math.round(movements.reduce((s, m) => s + fteEffect(m), 0) * 10) / 10,
    };
  });
}

// ---------- Breakdowns ----------

export type DepartmentMovements = {
  department: string;
  suppressions: number; // ETP (positif)
  recrutements: number;
  transferts: number; // redéploiements + reconversions (entrants + sortants du département)
};

export function movementsByDepartment(wf: Workforce): DepartmentMovements[] {
  const rows = new Map<string, DepartmentMovements>();
  const row = (dept: string) => {
    if (!rows.has(dept)) rows.set(dept, { department: dept, suppressions: 0, recrutements: 0, transferts: 0 });
    return rows.get(dept)!;
  };
  for (const m of wf.movements) {
    if (m.type === "Suppression") row(m.department).suppressions += m.fte;
    else if (m.type === "Recrutement") row(m.department).recrutements += m.fte;
    else {
      row(m.department).transferts += m.fte;
      if (m.toDepartment && m.toDepartment !== m.department) row(m.toDepartment).transferts += m.fte;
    }
  }
  return Array.from(rows.values()).sort((a, b) => b.suppressions - a.suppressions);
}

export function movementsByCountry(wf: Workforce): { country: string; fte: number; count: number }[] {
  const rows = new Map<string, { country: string; fte: number; count: number }>();
  for (const m of wf.movements) {
    const r = rows.get(m.country) ?? { country: m.country, fte: 0, count: 0 };
    r.fte += m.fte;
    r.count += 1;
    rows.set(m.country, r);
  }
  return Array.from(rows.values()).sort((a, b) => b.fte - a.fte);
}

export type MovementTypeSummary = { type: MovementType; count: number; fte: number };

export function movementsByType(wf: Workforce): MovementTypeSummary[] {
  const types: MovementType[] = ["Suppression", "Redéploiement", "Reconversion", "Recrutement"];
  return types
    .map((type) => {
      const list = wf.movements.filter((m) => m.type === type);
      return { type, count: list.length, fte: Math.round(list.reduce((s, m) => s + m.fte, 0) * 10) / 10 };
    })
    .filter((t) => t.count > 0);
}

// ---------- Masse salariale ----------

export type SalaryBridgeBucket = { label: string; delta: number; cumulative: number };

/** Impact cumulé des mouvements sur la masse salariale annuelle (€M) — baseline massSalary,
 * chaque bucket ajoute les salaryImpact des mouvements planifiés dessus. */
export function salaryBridge(wf: Workforce, granularity: "month" | "quarter"): SalaryBridgeBucket[] {
  const fte = fteBridge(wf, granularity);
  let running = wf.massSalary;
  return fte.map((b) => {
    const deltaM = b.movements.reduce((s, m) => s + m.salaryImpact, 0) / 1_000_000;
    running += deltaM;
    return { label: b.label, delta: Math.round(deltaM * 100) / 100, cumulative: Math.round(running * 100) / 100 };
  });
}

/** Économies salariales annualisées des seuls mouvements réalisés (€). */
export function realizedSalarySavings(wf: Workforce): number {
  return wf.movements
    .filter((m) => m.status === "Réalisé")
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
  const pse = wf.movements.filter((m) => m.inPSE);
  return {
    postes: Math.round(pse.reduce((s, m) => s + m.fte, 0) * 10) / 10,
    enCours: pse.filter((m) => m.status === "En cours").length,
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
      .filter((m) => m.department === d.name || m.toDepartment === d.name)
      .reduce((s, m) => {
        if (m.type === "Suppression" && m.department === d.name) return s - m.fte;
        if (m.type === "Recrutement" && m.department === d.name) return s + m.fte;
        if ((m.type === "Redéploiement" || m.type === "Reconversion") && m.toDepartment) {
          if (m.toDepartment === d.name && m.department !== d.name) return s + m.fte;
          if (m.department === d.name && m.toDepartment !== d.name) return s - m.fte;
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

export type MovementAlert = {
  movement: WorkforceMovement;
  kind: MovementAlertKind;
  message: string;
};

const DUE_WINDOW_DAYS = 7;

/**
 * Alertes actionnables pour le RH :
 * - `overdue`  : échéance dépassée sans réalisation — relancer l'owner du levier.
 * - `due`      : échéance dans ≤ 7 jours — préparer/valider le mouvement.
 * - `toValidate` : réalisé opérationnellement mais pas encore validé RH.
 * - `leverMismatch` : le levier lié est annulé ou se termine avant la date du mouvement —
 *   le plan RH et le plan levier ne sont plus synchronisés.
 */
export function movementAlerts(
  wf: Workforce,
  levers: Lever[],
  today: string = HR_TODAY
): MovementAlert[] {
  const alerts: MovementAlert[] = [];

  for (const m of wf.movements) {
    if (m.status === "Réalisé" && !m.hrValidated) {
      alerts.push({
        movement: m,
        kind: "toValidate",
        message: `${m.label} — réalisé le ${m.actualDate ?? m.plannedDate}, en attente de validation RH`,
      });
      continue;
    }

    if (m.status !== "Réalisé") {
      const days = daysBetween(today, m.plannedDate);
      if (days < 0) {
        alerts.push({
          movement: m,
          kind: "overdue",
          message: `${m.label} — échéance dépassée de ${-days} j (prévu le ${m.plannedDate})`,
        });
      } else if (days <= DUE_WINDOW_DAYS) {
        alerts.push({
          movement: m,
          kind: "due",
          message: `${m.label} — échéance dans ${days} j (${m.plannedDate})`,
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
        });
      } else if (lever.end < m.plannedDate && STATUS_ORDER[lever.status] < STATUS_ORDER.delivered) {
        alerts.push({
          movement: m,
          kind: "leverMismatch",
          message: `${m.label} — planifié le ${m.plannedDate}, après la fin du levier ${lever.code} (${lever.end})`,
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
