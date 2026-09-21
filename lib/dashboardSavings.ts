import type { BeTrackData, HierarchyNode, Lever } from "@/types";
import type { FinanceHierarchyRow, SavingsWaterfall } from "@/lib/engine";
import { displayedReforecastNet, leverImpactsOf, realizedSavings } from "@/lib/engine";

/**
 * Sélecteurs purs partagés par le dashboard exécutif (graphique "Réalisation des économies",
 * cascade) et la page Finance (tableau par niveau de hiérarchie). Leviers ANNULÉS toujours exclus
 * des totaux (seule la colonne/étape "Annulé" les mentionne).
 */

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Planifié initial (plan figé) / réactualisé / réalisé (€M) d'un groupe de leviers actifs. */
export function savingsTriple(levers: Lever[]): {
  planned: number;
  reforecast: number;
  realized: number;
} {
  const active = levers.filter((l) => l.status !== "cancelled");
  return {
    planned: r1(active.reduce((s, l) => s + (l.lockedPlan?.netSavings ?? l.netSavings), 0)),
    reforecast: r1(active.reduce((s, l) => s + displayedReforecastNet(l).value, 0)),
    realized: r1(active.reduce((s, l) => s + realizedSavings(l), 0)),
  };
}

// ─── Cascade (waterfall) ────────────────────────────────────────────────────

export type WaterfallBar = {
  key: string;
  label: string;
  /** Segment invisible (décalage) sous la barre. */
  base: number;
  /** Total plein (initial) ou variation positive. */
  up: number;
  /** Variation négative (valeur absolue). */
  down: number;
  /** Uniquement pour la barre finale : réalisé / reste à faire (empilés). */
  realized: number;
  remaining: number;
  /** Valeur signée d'origine (pour libellés/tooltip). */
  value: number;
};

/** Transforme `engine.savingsWaterfall` en barres Recharts (technique "base invisible"). La barre
 *  finale "Total attendu" est scindée en réalisé + reste à faire. */
export function waterfallBars(w: SavingsWaterfall): WaterfallBar[] {
  const bars: WaterfallBar[] = [];
  let prev = 0;
  for (const step of w.steps) {
    const empty = { up: 0, down: 0, realized: 0, remaining: 0 };
    if (step.key === "expected") {
      const realized = Math.max(0, Math.min(w.realized, step.value));
      bars.push({
        key: step.key,
        label: step.label,
        base: 0,
        ...empty,
        realized: r1(realized),
        remaining: r1(Math.max(0, step.value - realized)),
        value: step.value,
      });
    } else if (step.kind === "total") {
      bars.push({
        key: step.key,
        label: step.label,
        base: 0,
        ...empty,
        up: step.value,
        value: step.value,
      });
    } else {
      const cum = step.cumulative;
      const lo = Math.min(prev, cum);
      bars.push({
        key: step.key,
        label: step.label,
        base: r1(Math.max(0, lo)),
        ...empty,
        up: step.value >= 0 ? r1(Math.abs(step.value)) : 0,
        down: step.value < 0 ? r1(Math.abs(step.value)) : 0,
        value: step.value,
      });
    }
    prev = step.cumulative;
  }
  return bars;
}

/** Gains one-off (actifs) — JAMAIS dans les totaux savings ; à afficher à part. */
export function oneOffGainsTotal(data: BeTrackData): number {
  return r1(
    data.levers
      .filter((l) => l.status !== "cancelled")
      .reduce(
        (s, l) =>
          s +
          leverImpactsOf(l)
            .filter((i) => i.type === "saving" && i.gainRecurrence === "oneoff")
            .reduce((a, i) => a + i.amount, 0),
        0
      )
  );
}

// ─── Tableau finance par niveau de hiérarchie ───────────────────────────────

export type FinanceSortKey = "label" | "planned" | "reforecast" | "cancelled" | "late" | "realized";

export function sortFinanceRows<T extends FinanceHierarchyRow>(
  rows: T[],
  key: FinanceSortKey,
  dir: "asc" | "desc"
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) =>
    key === "label"
      ? sign * a.label.localeCompare(b.label, "fr")
      : sign * (a[key] - b[key]) || a.label.localeCompare(b.label, "fr")
  );
}

export function financeTotals(rows: FinanceHierarchyRow[]) {
  const sum = (k: "planned" | "reforecast" | "cancelled" | "late" | "realized") =>
    r1(rows.reduce((s, r) => s + r[k], 0));
  return {
    planned: sum("planned"),
    reforecast: sum("reforecast"),
    cancelled: sum("cancelled"),
    late: sum("late"),
    realized: sum("realized"),
  };
}

export type FinanceTreeRow = FinanceHierarchyRow & { children: FinanceHierarchyRow[] };

/** Rattache les lignes du niveau enfant à leurs parents (via `HierarchyNode.parentId`). Un enfant
 *  sans parent connu (ou identique au parent : feuille plus macro) n'est pas dupliqué. */
export function attachChildren(
  parents: FinanceHierarchyRow[],
  children: FinanceHierarchyRow[],
  nodes: HierarchyNode[]
): FinanceTreeRow[] {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const parentIds = new Set(parents.map((p) => p.nodeId));
  return parents.map((p) => ({
    ...p,
    children: children.filter(
      (c) =>
        c.nodeId !== p.nodeId &&
        parentIds.has(parentOf.get(c.nodeId) ?? "") &&
        parentOf.get(c.nodeId) === p.nodeId
    ),
  }));
}

/** Projection en barres (pont) de la série PARTAGÉE `engine.savingsSeries` : mêmes valeurs que la
 *  courbe en S (barre = réalisé de la période, ligne = réalisé cumulé, null sur le futur). */
export function seriesToBridge(
  series: { month: string; actualDelta: number; actual: number | null }[]
): { quarter: string; delta: number; cumulative: number | null }[] {
  return series.map((p) => ({ quarter: p.month, delta: p.actualDelta, cumulative: p.actual }));
}
