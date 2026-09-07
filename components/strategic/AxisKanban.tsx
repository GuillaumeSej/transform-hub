"use client";

import { AtRiskCountPill } from "@/components/strategic/AtRiskCountPill";
import { AxisStageBadge } from "@/components/strategic/AxisStageBadge";
import { ChantierProgressRow } from "@/components/strategic/ChantierProgressRow";
import type { IndicatorDelta } from "@/lib/axisLogic";
import type {
  Chantier,
  Indicator,
  IndicatorMeasurement,
  MaturityStageConfig,
  StrategicAxis,
} from "@/types";

/**
 * Vue kanban du portefeuille d'axes — round 6, point 5 : ne bucket plus les axes par étape de
 * maturité du programme (l'étape de CHAQUE CHANTIER se lisait déjà, une fois ouvert, sur sa propre
 * fiche — colonniser les AXES par étape ne répondait pas à la vraie question du PO, « où en est
 * chaque chantier de l'axe ? »). Devient une grille de cartes, une par axe (teintée de la couleur
 * propre de l'axe, `StrategicAxis.color`), imbriquant la liste de SES chantiers via
 * `ChantierProgressRow` (round 6, point 0) — même composant que l'onglet « Chantiers » et le futur
 * widget dashboard « Répartition par axe », pour ne jamais faire diverger trois lectures du même
 * avancement.
 *
 * Aucun drag & drop, inchangé : le changement d'étape se fait depuis la fiche de l'axe (stepper) ou
 * la fiche du chantier, seuls endroits où l'on voit le contexte nécessaire pour décider d'un
 * passage d'étape.
 */
export function AxisKanban({
  axes,
  stages,
  indicators,
  measurements,
  chantiersByAxis,
  onCardClick,
  onOpenChantier,
  atRiskItemsOf,
  labels,
}: {
  axes: StrategicAxis[];
  /** Étapes du programme, déjà triées par `order` (voir `useMaturityStages`) — transmises telles
   *  quelles à `AxisStageBadge`/`ChantierProgressRow`. */
  stages: MaturityStageConfig[];
  indicators: Indicator[];
  measurements: IndicatorMeasurement[];
  /** Chantiers DE CHAQUE axe, déjà groupés par l'appelant (voir `StrategicAxesView.chantiersByAxis`) —
   *  pas de callback ici, la même map alimente déjà la vue "Chantiers" du même fichier. */
  chantiersByAxis: Map<string, Chantier[]>;
  /** Clic sur l'en-tête de la carte d'axe → navigation vers la fiche de l'axe (inchangé). */
  onCardClick: (axisId: string) => void;
  /** Clic sur une ligne de chantier → ouvre le panneau chantier (round 6, point 0). */
  onOpenChantier: (chantierId: string) => void;
  /** Indicateurs à risque D'UN AXE (macro + tous ses chantiers confondus), écart calculé — alimente
   *  le contenu du popover déclenché par `AtRiskCountPill` au niveau de l'axe, même contrat que
   *  `StrategicAxesView.axisAtRiskIndicators`. */
  atRiskItemsOf?: (axisId: string) => { indicator: Indicator; delta: IndicatorDelta | undefined }[];
  labels?: {
    emptyAxisChantiers?: string;
    chantiers?: string;
    atRisk?: string;
    atRiskPopoverTitle?: string;
    atRiskTooltip?: string;
    progress?: string;
  };
}) {
  const l = {
    emptyAxisChantiers: labels?.emptyAxisChantiers ?? "Aucun chantier",
    chantiers: labels?.chantiers ?? "chantiers",
    atRisk: labels?.atRisk ?? "à risque",
    atRiskPopoverTitle: labels?.atRiskPopoverTitle ?? "Indicateurs à risque",
    atRiskTooltip: labels?.atRiskTooltip,
    progress: labels?.progress,
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {axes.map((axis) => {
        const axisChantiers = chantiersByAxis.get(axis.id) ?? [];
        const atRiskItems = atRiskItemsOf?.(axis.id) ?? [];
        return (
          <div
            key={axis.id}
            className="flex flex-col overflow-hidden rounded-lg border border-border bg-white shadow-sm"
            style={{ borderLeft: `4px solid ${axis.color ?? "var(--bp-warm-taupe)"}` }}
          >
            {/* En-tête cliquable → fiche de l'axe. `div role="button"` plutôt qu'un vrai `<button>` :
                il imbrique `AtRiskCountPill`, lui-même un `<button>` (Popover-déclencheur) — un
                bouton dans un bouton est une imbrication HTML invalide, même motif que les vues
                "cartes"/"chantiers" de `StrategicAxesView`. */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => onCardClick(axis.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onCardClick(axis.id);
                }
              }}
              className="flex cursor-pointer items-start gap-2 border-b border-border p-3 text-left transition hover:bg-neutral-50"
            >
              <span
                aria-hidden
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: axis.color ?? "var(--bp-warm-taupe)" }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-primary">{axis.name}</span>
                {axis.owner && (
                  <span className="mt-0.5 block truncate text-[10.5px] text-tertiary">
                    {axis.owner}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                <AxisStageBadge stageId={axis.stage} stages={stages} />
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-secondary">
                  {axisChantiers.length} {l.chantiers}
                </span>
                <AtRiskCountPill
                  count={atRiskItems.length}
                  items={atRiskItems}
                  title={l.atRiskPopoverTitle}
                  label={l.atRisk}
                  progressLabel={l.progress}
                  tooltip={l.atRiskTooltip}
                />
              </span>
            </div>

            <div className="flex flex-1 flex-col gap-1.5 p-2.5">
              {axisChantiers.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-tertiary">{l.emptyAxisChantiers}</p>
              ) : (
                axisChantiers.map((chantier) => (
                  <ChantierProgressRow
                    key={chantier.id}
                    chantier={chantier}
                    stages={stages}
                    indicators={indicators}
                    measurements={measurements}
                    onOpen={onOpenChantier}
                    labels={{
                      atRisk: l.atRisk,
                      atRiskPopoverTitle: l.atRiskPopoverTitle,
                      atRiskTooltip: l.atRiskTooltip,
                      progress: l.progress,
                    }}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
