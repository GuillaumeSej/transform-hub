"use client";

import type { ChantierHealthState } from "@/lib/axisLogic";
import type { Chantier } from "@/types";

/**
 * Matrice de santé par chantier — widget dashboard "chantier-health" (round 6, point 5 ; refonte
 * visuelle round 7, point 2). Groupée par colonne d'AXE stratégique, une LIGNE par chantier avec
 * son nom en texte visible (round 6 ne montrait le nom qu'au survol/`aria-label`, retour PO : la
 * matrice devait pouvoir se lire sans avoir à survoler chaque case).
 *
 * Contrat de props inchangé (`groups`/`labels`/`onChantierClick`, voir `StrategicDashboardView.tsx`)
 * — refonte purement interne au rendu. La couleur des pastilles utilise toujours les tokens
 * `rag-*` du domaine stratégique (`bg-rag-green`/`bg-rag-amber`/`bg-rag-red`, voir
 * `MilestoneChecklistPanel.tsx`/`ProgressBar.tsx` pour le même usage en remplissage plein), jamais
 * de couleur littérale — cohérent avec le reste du dashboard stratégique.
 */

const HEALTH_STYLE: Record<ChantierHealthState, string> = {
  onTrack: "bg-rag-green",
  watch: "bg-rag-amber",
  critical: "bg-rag-red",
};

const HEALTH_TEXT_STYLE: Record<ChantierHealthState, string> = {
  onTrack: "text-primary",
  watch: "text-rag-amber",
  critical: "text-rag-red",
};

/** Pire état d'abord au sein d'une colonne d'axe — les chantiers les plus en difficulté remontent
 *  en tête de leur groupe plutôt qu'un ordre alphabétique arbitraire. */
const HEALTH_ORDER: ChantierHealthState[] = ["critical", "watch", "onTrack"];

export type ChantierHealthCell = {
  chantier: Chantier;
  health: ChantierHealthState;
  /** Avancement (`chantierMilestoneProgressPct`, 0-100) — affiché à côté du nom du chantier. */
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

  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const cells = [...group.cells].sort(
          (a, b) => HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health)
        );
        return (
          <div key={group.key}>
            {/* En-tête de groupe (axe) — pastille colorée de l'axe + nom + volumétrie, même accent
                que le widget "Répartition par axe" juste au-dessus dans le layout par défaut. */}
            <div
              className="mb-2 flex items-center gap-2 border-b border-border pb-1.5"
              style={{ borderBottomColor: group.color ?? undefined }}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: group.color ?? "var(--bp-warm-taupe)" }}
              />
              <span className="text-[12.5px] font-bold uppercase tracking-wide text-primary">
                {group.label}
              </span>
              <span className="text-[11px] text-tertiary">({group.cells.length})</span>
            </div>
            <div className="space-y-1.5">
              {cells.map(({ chantier, health, progressPct }) => (
                <button
                  key={chantier.id}
                  type="button"
                  onClick={() => onChantierClick(chantier.id)}
                  className="flex w-full items-center gap-3 rounded-md border border-border bg-white p-2.5 text-left transition hover:-translate-y-px hover:border-black hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-black"
                  title={`${chantier.name} · ${labels[health]} · ${progressPct}%`}
                >
                  <span
                    aria-hidden
                    className={`h-3 w-3 shrink-0 rounded-full ${HEALTH_STYLE[health]}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-primary">
                    {chantier.name}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${HEALTH_TEXT_STYLE[health]}`}
                  >
                    {labels[health]}
                  </span>
                  <span className="w-9 shrink-0 text-right text-[11px] font-semibold tabular-nums text-tertiary">
                    {progressPct}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-border pt-2 text-[11px] text-secondary">
        {HEALTH_ORDER.map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${HEALTH_STYLE[status]}`} />
            {labels[status]}
          </span>
        ))}
      </div>
    </div>
  );
}
