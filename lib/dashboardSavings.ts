import type { BeTrackData, HierarchyNode, Lever } from "@/types";
import type { FinanceHierarchyRow, SavingsWaterfall } from "@/lib/engine";
import {
  displayedReforecastNet,
  leverImpactsOf,
  plannedInitialNet,
  realizedSavings,
} from "@/lib/engine";

/**
 * Sélecteurs purs partagés par le dashboard exécutif (graphique "Réalisation des économies",
 * cascade) et la page Finance (tableau par niveau de hiérarchie). Leviers ANNULÉS exclus du
 * réactualisé et du réalisé, mais inclus dans le « Planifié initial » (voir `plannedInitialNet`).
 */

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Planifié initial / réactualisé / réalisé (€M) d'un groupe de leviers. Passer le groupe COMPLET
 *  (abandonnés compris) : le planifié initial les inclut (`plannedInitialNet`, décision audit C2),
 *  le réactualisé et le réalisé ne portent que sur les leviers actifs. */
export function savingsTriple(levers: Lever[]): {
  planned: number;
  reforecast: number;
  realized: number;
} {
  const active = levers.filter((l) => l.status !== "cancelled");
  return {
    planned: r1(plannedInitialNet(levers)),
    reforecast: r1(active.reduce((s, l) => s + displayedReforecastNet(l).value, 0)),
    realized: r1(active.reduce((s, l) => s + realizedSavings(l), 0)),
  };
}

// ─── Cascade (waterfall) ────────────────────────────────────────────────────

export type WaterfallBar = {
  key: string;
  label: string;
  /** "plan" = planifié → cible ; "decomp" = brut → OPEX → net ; "gap" = séparateur visuel. */
  group: "plan" | "decomp" | "gap";
  /** Segment invisible (décalage) sous la barre. */
  base: number;
  /** Total plein ou variation positive. */
  up: number;
  /** Variation négative (valeur absolue). */
  down: number;
  /** Uniquement pour la barre "Cible réactualisée" : réalisé / reste à faire (empilés). */
  realized: number;
  remaining: number;
  /** Uniquement pour la barre "OPEX récurrent" : un montant par segment (même ordre que `segments`). */
  seg: number[];
  /** Valeur signée d'origine (pour libellés/tooltip). */
  value: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Limite une liste de segments triés (décroissant) à `max` entrées : le reste est fusionné en
 *  « Autres » (total conservé). */
export function limitSegments<T extends { key: string; label: string; value: number }>(
  segments: T[],
  max: number,
  otherLabel: string
): { key: string; label: string; value: number }[] {
  const sorted = [...segments].sort((a, b) => b.value - a.value);
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1).reduce((s, x) => s + x.value, 0);
  return [...head, { key: "__others__", label: otherLabel, value: r2(rest) }];
}

/** Transforme `engine.savingsWaterfall` en barres Recharts (technique "base invisible").
 *  Groupe A : planifié initial → ± réactualisé → − annulé → cible (réalisé + reste à faire =
 *  savingsTriple). Séparateur. Groupe B : brut → OPEX récurrent (flottant, segmenté par nature,
 *  entre le net et le brut) → net. Les segments sont ajustés pour que brut − OPEX = net exact. */
export function waterfallBars(
  w: SavingsWaterfall,
  opexSegments: { value: number }[] = []
): WaterfallBar[] {
  const bars: WaterfallBar[] = [];
  const empty = { up: 0, down: 0, realized: 0, remaining: 0, seg: [] as number[] };
  let prevGroup: "plan" | "decomp" | null = null;
  for (const step of w.steps) {
    const group: "plan" | "decomp" =
      step.key === "gross" || step.key === "opexRec" || step.key === "net" ? "decomp" : "plan";
    if (prevGroup && prevGroup !== group) {
      bars.push({ key: "gap", label: "", group: "gap", base: 0, ...empty, value: 0 });
    }
    prevGroup = group;
    const common = { key: step.key, label: step.label, group, value: step.value };
    if (step.key === "target") {
      const realized = Math.max(0, Math.min(w.realized, step.value));
      bars.push({
        ...common,
        base: 0,
        ...empty,
        realized: r1(realized),
        remaining: r1(Math.max(0, step.value - realized)),
      });
    } else if (step.key === "opexRec") {
      const total = Math.abs(step.value);
      let segs = opexSegments.length > 0 ? opexSegments.map((x) => Math.max(0, x.value)) : [total];
      // Bouclage exact : la somme des segments = |OPEX| (l'écart d'arrondi va au plus grand).
      const gap = r2(total - segs.reduce((s, v) => s + v, 0));
      if (gap !== 0 && segs.length > 0) {
        const big = segs.indexOf(Math.max(...segs));
        segs = segs.map((v, i) => (i === big ? Math.max(0, r2(v + gap)) : v));
      }
      bars.push({
        ...common,
        base: r1(Math.max(0, step.cumulative)),
        ...empty,
        seg: segs,
      });
    } else if (step.kind === "delta") {
      const before = step.cumulative - step.value;
      bars.push({
        ...common,
        base: r1(Math.max(0, Math.min(before, step.cumulative))),
        ...empty,
        up: step.value > 0 ? step.value : 0,
        down: step.value < 0 ? Math.abs(step.value) : 0,
      });
    } else {
      bars.push({ ...common, base: 0, ...empty, up: step.value });
    }
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

/** Totaux du tableau Finance, arrondis UNE fois à 0,1. Passer des lignes NON arrondies
 *  (`financeByHierarchyLevel(..., { unrounded: true })`) : sommer des lignes déjà arrondies dérive
 *  du total réel (39,3 vs 39,4 au dashboard pour les mêmes leviers). */
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

/** Ligne enfant du tableau Finance ; `isDirect` = part « (direct) » du parent (montants rattachés au
 *  nœud parent lui-même, feuille plus macro que le niveau enfant). */
export type FinanceChildRow = FinanceHierarchyRow & { isDirect?: boolean };
export type FinanceTreeRow = FinanceHierarchyRow & { children: FinanceChildRow[] };

const FINANCE_VALUE_KEYS = ["planned", "reforecast", "cancelled", "late", "realized"] as const;
type FinanceValueKey = (typeof FINANCE_VALUE_KEYS)[number];

/** Suffixe d'id de la ligne « (direct) » d'un parent. */
export const DIRECT_CHILD_SUFFIX = "__direct";

/** Rattache les lignes du niveau enfant à leurs parents (via `HierarchyNode.parentId`). Un enfant
 *  sans parent connu (ou identique au parent : feuille plus macro) n'est pas dupliqué. Pour que les
 *  enfants d'un parent SOMMENT toujours au parent, le reste (montants rattachés au parent lui-même)
 *  devient une ligne « (direct) » (`isDirect`, id `<parent>__direct`) — uniquement si le parent a
 *  déjà au moins un enfant (sinon il n'est pas dépliable). */
export function attachChildren(
  parents: FinanceHierarchyRow[],
  children: FinanceHierarchyRow[],
  nodes: HierarchyNode[]
): FinanceTreeRow[] {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const parentIds = new Set(parents.map((p) => p.nodeId));
  return parents.map((p) => {
    const own: FinanceChildRow[] = children.filter(
      (c) =>
        c.nodeId !== p.nodeId &&
        parentIds.has(parentOf.get(c.nodeId) ?? "") &&
        parentOf.get(c.nodeId) === p.nodeId
    );
    if (own.length > 0) {
      const direct: FinanceChildRow = {
        nodeId: `${p.nodeId}${DIRECT_CHILD_SUFFIX}`,
        code: p.code,
        label: p.label,
        planned: 0,
        reforecast: 0,
        cancelled: 0,
        late: 0,
        realized: 0,
        isDirect: true,
      };
      let hasResidual = false;
      for (const k of FINANCE_VALUE_KEYS) {
        const residual = p[k] - own.reduce((s, c) => s + c[k], 0);
        if (Math.abs(residual) > 1e-9) hasResidual = true;
        direct[k] = residual;
      }
      if (hasResidual) own.push(direct);
    }
    return { ...p, children: own };
  });
}

/** Arrondit `values` au pas `step` (0,1 par défaut) de sorte que leur somme égale EXACTEMENT
 *  `total` arrondi au même pas — méthode du plus fort reste (les unités manquantes vont aux plus
 *  grandes parties fractionnaires, les unités en trop sont retirées aux plus petites). Évite qu'un
 *  tableau affiche des lignes dont la somme diffère de ±0,1 du total affiché. */
export function roundLargestRemainder(values: number[], total: number, step = 0.1): number[] {
  if (values.length === 0) return [];
  const scaled = values.map((v) => v / step);
  const floors = scaled.map((v) => Math.floor(v + 1e-9));
  const target = Math.round(total / step + (total >= 0 ? 1e-9 : -1e-9));
  const diff = target - floors.reduce((s, v) => s + v, 0);
  const order = scaled
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const n = order.length;
  const out = [...floors];
  // diff > 0 : +1 aux plus grands restes ; diff < 0 : −1 aux plus petits.
  for (let k = 0; k < Math.abs(diff); k++) {
    if (diff > 0) out[order[k % n].i] += 1;
    else out[order[n - 1 - (k % n)].i] -= 1;
  }
  const decimals = Math.max(0, Math.round(-Math.log10(step)));
  return out.map((u) => Number((u * step).toFixed(decimals)));
}

/** Version ARRONDIE (0,1) d'affichage/export du tableau Finance : les parents somment exactement au
 *  total arrondi (`financeTotals`), les enfants (ligne « (direct) » comprise) à leur parent arrondi. */
export function roundFinanceTree(
  tree: FinanceTreeRow[],
  totals: Record<FinanceValueKey, number>
): FinanceTreeRow[] {
  const out: FinanceTreeRow[] = tree.map((r) => ({
    ...r,
    children: r.children.map((c) => ({ ...c })),
  }));
  for (const k of FINANCE_VALUE_KEYS) {
    const parentVals = roundLargestRemainder(
      tree.map((r) => r[k]),
      totals[k]
    );
    out.forEach((r, i) => {
      r[k] = parentVals[i];
      if (r.children.length === 0) return;
      const childVals = roundLargestRemainder(
        tree[i].children.map((c) => c[k]),
        parentVals[i]
      );
      r.children.forEach((c, j) => {
        c[k] = childVals[j];
      });
    });
  }
  return out;
}

/** Projection en barres (pont) de la série PARTAGÉE `engine.savingsSeries` : mêmes valeurs que la
 *  courbe en S (barre = réalisé de la période, ligne = réalisé cumulé, null sur le futur). */
export function seriesToBridge(
  series: { month: string; actualDelta: number; actual: number | null }[]
): { quarter: string; delta: number; cumulative: number | null }[] {
  return series.map((p) => ({ quarter: p.month, delta: p.actualDelta, cumulative: p.actual }));
}
