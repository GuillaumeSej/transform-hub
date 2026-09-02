"use client";

import type { MaturityStageConfig, StrategicAxis } from "@/types";

/**
 * Vue kanban du portefeuille d'axes — une colonne par étape de maturité du programme. Clone
 * délibéré de `components/shared/Kanban.tsx` (pipeline des leviers) plutôt qu'une généricisation :
 * celui-ci est typé sur l'union fermée `LeverStatus`, avec 5 colonnes câblées dans la grille et
 * des cartes qui affichent des montants (`fmtCurr`) et une progression — deux hypothèses fausses
 * ici, où le nombre de colonnes est libre (4 comme 12 étapes selon le programme) et où un axe ne
 * porte aucune donnée financière.
 *
 * Aucun drag & drop : le changement d'étape se fait depuis la fiche de l'axe (stepper), seul
 * endroit où l'on voit le contexte nécessaire (chantiers, indicateurs) pour décider d'un passage
 * d'étape.
 */
export function AxisKanban({
  axes,
  stages,
  onCardClick,
  counts,
  labels,
}: {
  axes: StrategicAxis[];
  /** Étapes du programme, déjà triées par `order` (voir `useMaturityStages`). */
  stages: MaturityStageConfig[];
  onCardClick: (id: string) => void;
  /** Compteurs par axe, calculés par l'appelant (chantiers / indicateurs / indicateurs à risque). */
  counts?: (axisId: string) => { chantiers: number; indicators: number; atRisk: number };
  labels?: {
    emptyColumn?: string;
    chantiers?: string;
    indicators?: string;
    atRisk?: string;
    noStage?: string;
  };
}) {
  const l = {
    emptyColumn: labels?.emptyColumn ?? "Aucun axe",
    chantiers: labels?.chantiers ?? "chantiers",
    indicators: labels?.indicators ?? "indicateurs",
    atRisk: labels?.atRisk ?? "à risque",
    noStage: labels?.noStage ?? "Sans étape",
  };

  // Les axes dont l'étape ne correspond à aucune étape connue (étape supprimée du référentiel
  // depuis l'affectation) sont regroupés dans une colonne de rattrapage plutôt que masqués — même
  // principe que le repli sur l'id brut d'`AxisStageBadge` : jamais d'entité invisible.
  const knownStageIds = new Set(stages.map((s) => s.id));
  const orphans = axes.filter((a) => !knownStageIds.has(a.stage));
  const columns: { id: string; label: string; list: StrategicAxis[] }[] = [
    ...stages.map((s) => ({
      id: s.id,
      label: s.label,
      list: axes.filter((a) => a.stage === s.id),
    })),
    ...(orphans.length > 0 ? [{ id: "__orphans__", label: l.noStage, list: orphans }] : []),
  ];

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => (
        <div
          key={col.id}
          className="min-h-[200px] w-[240px] shrink-0 rounded-lg border border-border bg-neutral-50 p-2.5"
        >
          <div className="flex items-center justify-between gap-2 px-2 pb-2.5 pt-1">
            <div className="truncate text-[11.5px] font-bold uppercase tracking-wide text-primary">
              {col.label}
            </div>
            <div className="shrink-0 rounded-full border border-border bg-white px-1.5 py-px text-[10px] font-semibold text-secondary">
              {col.list.length}
            </div>
          </div>
          {col.list.length === 0 && (
            <div className="py-5 text-center text-[11px] text-tertiary">{l.emptyColumn}</div>
          )}
          {col.list.map((axis) => {
            const c = counts?.(axis.id);
            return (
              <button
                key={axis.id}
                onClick={() => onCardClick(axis.id)}
                className="mb-2 block w-full rounded-sm border border-border bg-white p-2.5 text-left transition hover:-translate-y-px hover:border-black hover:shadow-sm"
              >
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: axis.color ?? "var(--bp-warm-taupe)" }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-primary">{axis.name}</span>
                    {axis.owner && (
                      <span className="mt-0.5 block truncate text-[10px] text-tertiary">
                        {axis.owner}
                      </span>
                    )}
                  </span>
                </div>
                {c && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-secondary">
                      {c.chantiers} {l.chantiers}
                    </span>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-secondary">
                      {c.indicators} {l.indicators}
                    </span>
                    {c.atRisk > 0 && (
                      <span className="rounded-full bg-rag-amber-light px-2 py-0.5 font-semibold text-rag-amber">
                        {c.atRisk} {l.atRisk}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
