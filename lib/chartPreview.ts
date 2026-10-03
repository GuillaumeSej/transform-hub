import type { SavingsWaterfall } from "@/lib/engine";

/**
 * Sélecteurs purs des aperçus au survol des graphiques du dashboard (cascade des économies,
 * "Réalisation des économies"). Aucun calcul métier nouveau : ils ne font que réorganiser les
 * données déjà utilisées par les graphes et leurs détails au clic.
 */

/** Levier contribuant à une barre / étape — `value` signée en €M. */
export type PreviewContributor = { id: string; name: string; value: number };

/** `n` premiers éléments par valeur absolue décroissante, en ignorant les montants négligeables
 *  (|value| < `min`, soit < 0,05 M€ par défaut : affichés « 0,0 » ils n'apportent rien). */
export function topContributors<T extends { value: number }>(items: T[], n = 3, min = 0.05): T[] {
  return items
    .filter((x) => Number.isFinite(x.value) && Math.abs(x.value) >= min)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, n);
}

export type WaterfallStepSummary = {
  kind: "total" | "delta";
  /** Montant signé de l'étape (variation pour une étape delta, niveau pour un total). */
  value: number;
  /** Niveau cumulé avant / après l'étape — `before` null pour un total. */
  before: number | null;
  after: number;
  /** Part de l'étape dans le total de référence de son groupe (signée), null pour la référence
   *  elle-même ou si la référence est nulle. */
  share: number | null;
  /** Référence du ratio : planifié initial (groupe plan) ou gain brut (groupe décomposition). */
  shareBase: "initial" | "gross";
};

/** Résumé d'une étape de la cascade (`engine.savingsWaterfall`) pour l'aperçu au survol. */
export function waterfallStepSummary(
  w: SavingsWaterfall,
  key: string
): WaterfallStepSummary | null {
  const step = w.steps.find((s) => s.key === key);
  if (!step) return null;
  const shareBase = key === "gross" || key === "opexRec" || key === "net" ? "gross" : "initial";
  const base = shareBase === "gross" ? w.gross : w.initial;
  const share = key === shareBase || !(Math.abs(base) > 1e-9) ? null : step.value / base;
  const isDelta = step.kind === "delta";
  return {
    kind: isDelta ? "delta" : "total",
    value: step.value,
    // NON arrondi : l'arrondi se fait une seule fois, à l'affichage (`fmt`). Avant, `before` était
    // arrondi à 0,1 ici puis reformaté — un niveau de 0,04 M€ s'affichait « 0,0 » et la barre
    // « avant » d'un petit montant tombait à 0.
    before: isDelta ? step.cumulative - step.value : null,
    after: step.cumulative,
    share,
    shareBase,
  };
}

/** Écart réalisé − réactualisé par levier d'une barre "Réalisation des économies" (détail
 *  `leverBreakdown` du graphe), trié par importance — alimente les principaux écarts de l'aperçu. */
export function leverGapContributors(breakdown?: {
  target: { name: string; value: number }[];
  realized: { name: string; value: number }[];
}): PreviewContributor[] {
  if (!breakdown) return [];
  const byName = new Map<string, { target: number; realized: number }>();
  for (const x of breakdown.target) {
    const cur = byName.get(x.name) ?? { target: 0, realized: 0 };
    cur.target += x.value;
    byName.set(x.name, cur);
  }
  for (const x of breakdown.realized) {
    const cur = byName.get(x.name) ?? { target: 0, realized: 0 };
    cur.realized += x.value;
    byName.set(x.name, cur);
  }
  return topContributors(
    Array.from(byName.entries()).map(([name, v]) => ({
      id: name,
      name,
      value: Math.round((v.realized - v.target) * 100) / 100,
    })),
    Number.POSITIVE_INFINITY
  );
}
