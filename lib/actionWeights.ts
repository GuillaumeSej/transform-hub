import type { LeverAction } from "@/types";

const EPS = 1e-6;

export type WeightsState = {
  /** "weighted" = toutes les actions ont un poids ET somme = 100 ; "none" = aucun poids ;
   *  "invalid" = poids partiels ou somme != 100. */
  mode: "weighted" | "none" | "invalid";
  total: number;
  missing: number;
  valid: boolean;
};

export function weightsState(actions: Pick<LeverAction, "weightPct">[]): WeightsState {
  const withW = actions.filter((a) => typeof a.weightPct === "number");
  const total = round1(withW.reduce((s, a) => s + (a.weightPct as number), 0));
  const missing = actions.length - withW.length;
  if (actions.length === 0 || withW.length === 0)
    return { mode: "none", total: 0, missing, valid: true };
  if (missing === 0 && Math.abs(total - 100) < EPS)
    return { mode: "weighted", total, missing, valid: true };
  return { mode: "invalid", total, missing, valid: false };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Poids égaux sommant exactement 100 (le reste est réparti sur les premières actions, par 0,1). */
export function distributeEvenly(count: number): number[] {
  if (count <= 0) return [];
  const units = 1000; // dixièmes de %
  const base = Math.floor(units / count);
  const rest = units - base * count;
  return Array.from({ length: count }, (_, i) => (base + (i < rest ? 1 : 0)) / 10);
}

/** Applique une répartition égale à toutes les actions. */
export function applyEvenWeights<T extends { weightPct?: number }>(actions: T[]): T[] {
  const w = distributeEvenly(actions.length);
  return actions.map((a, i) => ({ ...a, weightPct: w[i] }));
}

/** Retire tous les poids (mode non pondéré). */
export function clearWeights<T extends { weightPct?: number }>(actions: T[]): T[] {
  return actions.map((a) => {
    const rest = { ...a };
    delete rest.weightPct;
    return rest;
  });
}
