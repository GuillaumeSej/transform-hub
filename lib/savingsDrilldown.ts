import type { HierarchyLevelDef, HierarchyNode, Lever, Workstream } from "@/types";
import {
  displayedReforecastNet,
  leverImpactsOf,
  leverOpexRecOf,
  realizedSavings,
  reforecastSnapshotOf,
} from "@/lib/engine";
import { resolveHierarchyNodeChain } from "@/lib/hierarchyLogic";

/**
 * Logique pure du détail (pop-up) de chaque étape de la cascade des économies. Mêmes fonctions de
 * calcul que `savingsTriple` / `engine.savingsWaterfall` (displayedReforecastNet, realizedSavings,
 * plan figé) pour une cohérence stricte avec le graphe "Réalisation des économies".
 */

export type DrilldownStepKey =
  "gross" | "initial" | "reforecast" | "cancelled" | "target" | "opexRec";
export type DrilldownDimension = "workstream" | "geography";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const lockedNet = (l: Lever) => l.lockedPlan?.netSavings ?? l.netSavings;

export type OpexSegment = { key: string; label: string; value: number };

/** Une ligne = un levier contribuant à l'étape. Montants en €M annualisés. */
export type DrilldownEntry = {
  leverId: string;
  name: string;
  wsId: string;
  geographyLeafId?: string;
  /** Texte libre historique (repli si pas d'arborescence géographique). */
  geography?: string;
  /** Plan figé (avant) et valeur affichée (après) — égaux hors étape "réactualisé". */
  before: number;
  after: number;
  /** Montant porté par l'étape (delta pour reforecast/cancelled, valeur sinon). */
  value: number;
  realized: number;
  remaining: number;
  /** Réactualisé — uniquement renseigné par le détail de la trajectoire des économies
   *  (`gapEntriesAt`, lib/scurveDetail.ts) ; absent (undefined) pour les autres drilldowns. */
  reforecast?: number;
  /** Levier abandonné (détail de la trajectoire, `gapEntriesAt`) : l'UI l'étiquette « Annulé ». */
  cancelled?: boolean;
  segments: OpexSegment[];
};

export type OpexNatureLabeler = (natureId: string | undefined) => string;

/** OPEX récurrent d'un levier segmenté par nature d'impact (nature configurable, sinon le type :
 *  ETP recrutés / non détaillé). Le total des segments = snapshot (réactualisé ?? plan figé). */
export function leverOpexRecSegments(
  lever: Lever,
  natureLabel: OpexNatureLabeler,
  labels: { fte: string; other: string }
): OpexSegment[] {
  const snap = reforecastSnapshotOf(lever) ?? lever.lockedPlan ?? lever;
  const total = snap.opexRec;
  const acc = new Map<string, OpexSegment>();
  // Clé = libellé normalisé : deux natures de même nom fusionnent en un seul segment.
  const add = (_key: string, label: string, v: number) => {
    const key = label.trim().toLowerCase();
    const cur = acc.get(key);
    if (cur) cur.value += v;
    else acc.set(key, { key, label, value: v });
  };
  for (const imp of leverImpactsOf(lever)) {
    if (imp.type === "cost" && imp.nature === "opex_rec") {
      // Nature configurée → nature ; sinon technologie renseignée ; sinon « Non détaillé » unique.
      const tech = imp.technology?.trim();
      if (imp.natureId) add(`n:${imp.natureId}`, natureLabel(imp.natureId), imp.amount);
      else if (tech) add(`t:${tech.toLowerCase()}`, tech, imp.amount);
      else add("other", labels.other, imp.amount);
    } else if (imp.type === "fte" && imp.fteDirection === "hire") {
      add("fte", labels.fte, imp.amount);
    }
  }
  const detailed = Array.from(acc.values()).reduce((s, x) => s + x.value, 0);
  const rest = r2(total - detailed);
  if (acc.size === 0 && total !== 0) add("other", labels.other, total);
  else if (Math.abs(rest) >= 0.05) add("other", labels.other, rest);
  const segs = Array.from(acc.values());
  return segs.filter((s) => Math.abs(s.value) > 0.004).map((s) => ({ ...s, value: r2(s.value) }));
}

export function buildDrilldownEntries(
  step: DrilldownStepKey,
  levers: Lever[],
  opts: { natureLabel?: OpexNatureLabeler; labels?: { fte: string; other: string } } = {}
): DrilldownEntry[] {
  const natureLabel = opts.natureLabel ?? (() => "—");
  const labels = opts.labels ?? { fte: "ETP", other: "Autres" };
  const base = (l: Lever) => ({
    leverId: l.id,
    name: l.name,
    wsId: l.ws,
    geographyLeafId: l.geographyLeafId,
    geography: l.geography,
    segments: [] as OpexSegment[],
  });
  const out: DrilldownEntry[] = [];
  for (const l of levers) {
    const cancelled = l.status === "cancelled";
    const locked = lockedNet(l);
    if (step === "initial") {
      out.push({
        ...base(l),
        before: locked,
        after: locked,
        value: locked,
        realized: 0,
        remaining: 0,
      });
    } else if (step === "gross") {
      if (cancelled) continue;
      const net = displayedReforecastNet(l).value;
      const opex = leverOpexRecOf(l);
      out.push({
        ...base(l),
        before: net,
        after: net + opex,
        value: net + opex,
        realized: 0,
        remaining: 0,
      });
    } else if (step === "cancelled") {
      if (cancelled)
        out.push({
          ...base(l),
          before: locked,
          after: 0,
          value: -locked,
          realized: 0,
          remaining: 0,
        });
    } else if (cancelled) {
      continue;
    } else if (step === "reforecast") {
      const refo = displayedReforecastNet(l);
      const delta = refo.value - locked;
      if (refo.isReforecast && Math.abs(delta) >= 0.005)
        out.push({
          ...base(l),
          before: locked,
          after: refo.value,
          value: delta,
          realized: 0,
          remaining: 0,
        });
    } else if (step === "target") {
      const refo = displayedReforecastNet(l).value;
      const real = realizedSavings(l);
      out.push({
        ...base(l),
        before: locked,
        after: refo,
        value: refo,
        realized: real,
        remaining: refo - real,
      });
    } else {
      const segments = leverOpexRecSegments(l, natureLabel, labels);
      const total = segments.reduce((s, x) => s + x.value, 0);
      if (Math.abs(total) >= 0.005)
        out.push({
          ...base(l),
          before: total,
          after: total,
          value: -total,
          realized: 0,
          remaining: 0,
          segments,
        });
    }
  }
  return out;
}

/** Segments d'OPEX récurrent agrégés sur un ensemble d'entrées (pour la barre segmentée). */
export function aggregateSegments(entries: DrilldownEntry[]): OpexSegment[] {
  // Fusion par libellé (deux natures homonymes / non précisées ne donnent qu'un segment).
  const acc = new Map<string, OpexSegment>();
  for (const e of entries)
    for (const s of e.segments) {
      const k = s.label.trim().toLowerCase();
      const cur = acc.get(k);
      if (cur) cur.value = r2(cur.value + s.value);
      else acc.set(k, { ...s, key: k });
    }
  return Array.from(acc.values()).sort((a, b) => b.value - a.value);
}

export type DrilldownGroup = {
  id: string;
  label: string;
  before: number;
  after: number;
  value: number;
  realized: number;
  remaining: number;
  reforecast: number;
  segments: OpexSegment[];
  entries: DrilldownEntry[];
};

export const UNATTRIBUTED_GROUP_ID = "__none__";

export type GroupContext = {
  workstreams: Pick<Workstream, "id" | "name">[];
  geographyLevels?: HierarchyLevelDef[];
  geographyNodes?: HierarchyNode[];
  /** Clé (`HierarchyLevelDef.key`) du niveau géographique de regroupement. */
  geographyLevelKey?: string;
  unattributedLabel?: string;
};

/** Nœud de regroupement d'une feuille géographique pour un niveau donné : l'ancêtre de ce niveau ;
 *  si la feuille est plus macro que le niveau, la feuille elle-même ; sinon null (non attribué). */
export function geographyGroupNode(
  leafId: string | undefined,
  levelKey: string | undefined,
  nodes: HierarchyNode[],
  levels: HierarchyLevelDef[]
): HierarchyNode | null {
  if (!leafId || !levelKey) return null;
  const chain = resolveHierarchyNodeChain(leafId, nodes, levels);
  if (chain.length === 0) return null;
  const exact = chain.find((n) => n.levelKey === levelKey);
  if (exact) return exact;
  const targetOrder = levels.find((lv) => lv.key === levelKey)?.order;
  if (targetOrder === undefined) return null;
  const orderOf = (n: HierarchyNode) => levels.find((lv) => lv.key === n.levelKey)?.order ?? 0;
  const above = chain.filter((n) => orderOf(n) <= targetOrder);
  return above.length > 0 ? above[above.length - 1] : null;
}

/** Regroupe les entrées par chantier ou par nœud géographique du niveau choisi. Les totaux de tous
 *  les groupes = somme des entrées (rien n'est perdu : "Non attribué" en dernier recours). */
export function groupEntries(
  entries: DrilldownEntry[],
  dimension: DrilldownDimension,
  ctx: GroupContext
): DrilldownGroup[] {
  const none = ctx.unattributedLabel ?? "Non attribué";
  const wsName = new Map(ctx.workstreams.map((w) => [w.id, w.name]));
  const levels = ctx.geographyLevels ?? [];
  const nodes = ctx.geographyNodes ?? [];
  const useTree = dimension === "geography" && levels.length > 0 && nodes.length > 0;
  const groups = new Map<string, DrilldownGroup>();
  for (const e of entries) {
    let id: string;
    let label: string;
    if (dimension === "workstream") {
      id = e.wsId || UNATTRIBUTED_GROUP_ID;
      label = wsName.get(e.wsId) ?? (e.wsId || none);
    } else if (useTree) {
      const node = geographyGroupNode(e.geographyLeafId, ctx.geographyLevelKey, nodes, levels);
      id = node?.id ?? UNATTRIBUTED_GROUP_ID;
      label = node?.label ?? none;
    } else {
      id = e.geography || UNATTRIBUTED_GROUP_ID;
      label = e.geography || none;
    }
    let g = groups.get(id);
    if (!g) {
      g = {
        id,
        label,
        before: 0,
        after: 0,
        value: 0,
        realized: 0,
        remaining: 0,
        reforecast: 0,
        segments: [],
        entries: [],
      };
      groups.set(id, g);
    }
    g.before += e.before;
    g.after += e.after;
    g.value += e.value;
    g.realized += e.realized;
    g.remaining += e.remaining;
    g.reforecast += e.reforecast ?? 0;
    g.entries.push(e);
  }
  // Pas d'arrondi ici (avant round 7 : chaque groupe était arrondi à 1 décimale AVANT d'être
  // sommé par `drilldownTotals`, ce qui produisait un "total = somme des écarts arrondis" légèrement
  // différent du véritable écart total — l'arrondi ne doit se faire qu'à l'AFFICHAGE final (voir
  // `fmt()` côté composants), jamais sur une valeur intermédiaire encore utilisée dans un calcul).
  const out = Array.from(groups.values()).map((g) => ({
    ...g,
    segments: aggregateSegments(g.entries),
    entries: [...g.entries].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
  }));
  return out.sort((a, b) => {
    if (a.id === UNATTRIBUTED_GROUP_ID) return 1;
    if (b.id === UNATTRIBUTED_GROUP_ID) return -1;
    return Math.abs(b.value) - Math.abs(a.value) || a.label.localeCompare(b.label, "fr");
  });
}

export function drilldownTotals(groups: DrilldownGroup[]) {
  const sum = (k: "before" | "after" | "value" | "realized" | "remaining" | "reforecast") =>
    r1(groups.reduce((s, g) => s + g[k], 0));
  return {
    before: sum("before"),
    after: sum("after"),
    value: sum("value"),
    realized: sum("realized"),
    remaining: sum("remaining"),
    reforecast: sum("reforecast"),
  };
}
