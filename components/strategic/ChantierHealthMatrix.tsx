"use client";

import type { ChantierHealthState } from "@/lib/axisLogic";
import type { Chantier } from "@/types";

/**
 * Matrice de santé par chantier — widget dashboard "chantier-health" (round 6, point 5), inspirée
 * de `components/shared/charts/InitiativeHealthMatrix.tsx` (Plan Performance) : une grille de
 * cellules colorées cliquables, groupées par colonne, infobulle au survol. Deux différences
 * assumées avec son modèle :
 *  - les colonnes sont des AXES stratégiques (pas des workstreams) et les cellules des CHANTIERS
 *    (pas des leviers) — `ChantierHealthState` (`lib/axisLogic.ts`) plutôt que `LeverHealthStatus` ;
 *  - la couleur des cellules utilise les tokens `rag-*` du domaine stratégique (`bg-rag-green` /
 *    `bg-rag-amber` / `bg-rag-red`, voir `components/strategic/MilestoneChecklistPanel.tsx`/
 *    `components/shared/ProgressBar.tsx` pour le même usage en remplissage plein) plutôt que les
 *    hex littéraux codés en dur du composant Performance — cohérent avec la charte round 5 (seul
 *    `rag-red` rend un vrai rouge, `rag-green`/`rag-amber` restent teintés neutre/marque, voir
 *    `IndicatorDeltaStat.tsx`), et surtout avec le reste du dashboard stratégique qui ne connaît
 *    QUE ces tokens (jamais de couleur brute).
 */

const HEALTH_STYLE: Record<ChantierHealthState, string> = {
  onTrack: "bg-rag-green",
  watch: "bg-rag-amber",
  critical: "bg-rag-red",
};

/** Pire état d'abord — même tri que `InitiativeHealthMatrix` (les cellules les plus graves en
 *  tête de chaque colonne, pas d'ordre alphabétique arbitraire). */
const HEALTH_ORDER: ChantierHealthState[] = ["critical", "watch", "onTrack"];

export type ChantierHealthCell = {
  chantier: Chantier;
  health: ChantierHealthState;
  /** Avancement (`milestoneProgressPct`, 0-100) — affiché dans l'infobulle de la cellule. */
  progressPct: number;
};

export type ChantierHealthGroup = {
  /** Id de l'axe — clé React de la colonne. */
  key: string;
  /** Nom de l'axe — en-tête de colonne. */
  label: string;
  /** `StrategicAxis.color` — teinte la bordure de la colonne (round 6, cohérent avec l'accent
   *  coloré du widget "Répartition par axe" juste au-dessus dans le layout par défaut). */
  color?: string;
  cells: ChantierHealthCell[];
};

export function ChantierHealthMatrix({
  groups,
  labels,
  onChantierClick,
}: {
  groups: ChantierHealthGroup[];
  labels: Record<ChantierHealthState, string> & { empty: string };
  onChantierClick: (chantierId: string) => void;
}) {
  const totalCells = groups.reduce((sum, group) => sum + group.cells.length, 0);

  if (totalCells === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">{labels.empty}</p>;
  }

  const maxRows = Math.max(1, ...groups.map((group) => Math.ceil(group.cells.length / 4)));

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-end gap-3">
          {groups.map((group) => {
            const cells = [...group.cells].sort(
              (a, b) => HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health)
            );
            return (
              <div key={group.key} className="w-[108px] shrink-0">
                <div
                  className="flex items-end rounded-sm border border-border bg-neutral-50 p-1.5"
                  style={{
                    minHeight: `${maxRows * 22 + 12}px`,
                    ...(group.color ? { borderColor: group.color } : {}),
                  }}
                >
                  <div className="grid w-full grid-cols-4 gap-1">
                    {cells.map(({ chantier, health, progressPct }) => (
                      <button
                        key={chantier.id}
                        type="button"
                        onClick={() => onChantierClick(chantier.id)}
                        className={`h-[18px] rounded-[2px] transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-black ${HEALTH_STYLE[health]}`}
                        title={`${chantier.name}\n${group.label} · ${labels[health]}\n${progressPct}%`}
                        aria-label={`${chantier.name} ${group.label} ${labels[health]}`}
                      />
                    ))}
                  </div>
                </div>
                <div
                  className="mt-1.5 truncate text-center text-[10.5px] font-semibold text-secondary"
                  title={group.label}
                >
                  {group.label}
                </div>
                <div className="text-center text-[10px] text-tertiary">{group.cells.length}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-border pt-2 text-[11px] text-secondary">
        {HEALTH_ORDER.map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-[2px] ${HEALTH_STYLE[status]}`} />
            {labels[status]}
          </span>
        ))}
      </div>
    </div>
  );
}
