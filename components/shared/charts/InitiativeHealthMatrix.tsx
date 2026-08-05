"use client";

/**
 * Matrice santé des initiatives — inspirée du widget "OD Monitoring" Gooduelle (une case par
 * initiative, coloration selon le statut de santé, colonnes = groupement configurable).
 *
 * Zéro logique métier ici : les groupes et les statuts sont pré-calculés dans
 * `lib/leverHealth.ts::groupLeversByDimension`. Ce composant ne fait que mapper la structure
 * vers du JSX (tuiles cliquables + légende).
 */

import type { Lever } from "@/types";
import type { LeverHealthGroup, LeverHealthStatus } from "@/lib/leverHealth";

/** Palette de santé — validée dataviz (ΔE CVD PASS sur surface claire). Le gris "cancelled"
 *  s'aligne sur le style "levier annulé" utilisé partout ailleurs (KPICard status, timeline). */
const HEALTH_COLOR: Record<LeverHealthStatus, string> = {
  onTrack: "bg-rag-green",
  watch: "bg-rag-amber",
  critical: "bg-rag-red",
  cancelled: "bg-neutral-300",
};

const HEALTH_ORDER: LeverHealthStatus[] = ["critical", "watch", "onTrack", "cancelled"];

export interface InitiativeHealthMatrixLabels {
  onTrack: string;
  watch: string;
  critical: string;
  cancelled: string;
  empty: string;
}

export function InitiativeHealthMatrix({
  groups,
  labels,
  onLeverClick,
}: {
  groups: LeverHealthGroup[];
  labels: InitiativeHealthMatrixLabels;
  onLeverClick?: (lever: Lever) => void;
}) {
  if (groups.length === 0) {
    return <p className="py-10 text-center text-sm text-tertiary">{labels.empty}</p>;
  }

  // Hauteur max des colonnes (nb de tuiles empilées) — pour aligner visuellement les tops de
  // colonnes qui ont moins de leviers.
  const maxHeight = Math.max(...groups.map((g) => g.levers.length));

  return (
    <div className="flex flex-col gap-3">
      {/* Grille horizontale : scroll si trop de groupes. Chaque colonne est un flex-col
       *  décroissant (le plus critique en haut) — tri par sévérité pour donner une lecture
       *  immédiate "où sont les problèmes". */}
      <div className="overflow-x-auto">
        <div className="flex min-w-full gap-1.5 pb-2" style={{ minWidth: groups.length * 64 }}>
          {groups.map((group) => {
            const sortedLevers = [...group.levers].sort((a, b) => {
              const idxA = HEALTH_ORDER.indexOf(a.health);
              const idxB = HEALTH_ORDER.indexOf(b.health);
              return idxA - idxB;
            });
            return (
              <div key={group.group} className="flex min-w-0 flex-1 flex-col items-center">
                {/* Colonne de tuiles — hauteur alignée sur la colonne la plus haute grâce au
                 *  padding-top invisible sur les colonnes plus courtes. */}
                <div className="flex w-full flex-col justify-end gap-1">
                  {Array.from({ length: maxHeight - sortedLevers.length }).map((_, i) => (
                    <div key={`spacer-${i}`} className="h-6 w-full" aria-hidden />
                  ))}
                  {sortedLevers.map(({ lever, health }) => (
                    <button
                      key={lever.id}
                      type="button"
                      onClick={() => onLeverClick?.(lever)}
                      title={`${lever.code} · ${lever.name} — ${labels[health]}`}
                      className={`h-6 w-full rounded-sm ${HEALTH_COLOR[health]} transition hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-black`}
                      aria-label={`${lever.code} ${lever.name} ${labels[health]}`}
                    />
                  ))}
                </div>
                {/* Libellé du groupe sous la colonne (tronqué + tooltip natif) */}
                <div
                  className="mt-2 w-full truncate text-center text-[10.5px] font-semibold text-secondary"
                  title={group.group}
                >
                  {group.group}
                </div>
                <div className="text-[10px] text-tertiary">{group.levers.length}</div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Légende — pastilles colorées + libellés, ordre statut le plus grave → le moins grave. */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 border-t border-border pt-2 text-[11px] text-secondary">
        {HEALTH_ORDER.map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${HEALTH_COLOR[status]}`} />
            {labels[status]}
          </span>
        ))}
      </div>
    </div>
  );
}
