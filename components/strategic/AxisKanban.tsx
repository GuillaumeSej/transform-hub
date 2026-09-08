"use client";

import { useMemo, useState } from "react";
import { AtRiskCountPill } from "@/components/strategic/AtRiskCountPill";
import { AxisStageBadge } from "@/components/strategic/AxisStageBadge";
import { LevierCard } from "@/components/strategic/LevierMilestoneBoard";
import { Modal } from "@/components/shared/Modal";
import { colorForChantier } from "@/lib/axisLogic";
import { MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import type { IndicatorDelta } from "@/lib/axisLogic";
import type {
  Chantier,
  ChantierAction,
  Indicator,
  LevierKanbanStatus,
  MaturityStageConfig,
  MilestoneId,
  StrategicAxis,
} from "@/types";

/**
 * Vue "Avancement des chantiers" du portefeuille d'axes (round 9, points 3/9 — remplace le kanban
 * round 6/8 imbriquant un `ChantierProgressRow` par chantier, LUI-MÊME retiré). Le PO trouvait la
 * barre de progression % trop peu actionnable : chaque ligne de chantier affiche désormais des
 * COMPTEURS compacts par jalon E0→E4 (leviers rattachés à un KPI, bucketés par
 * `action.milestones?.currentMilestone`) plus, si le chantier a des leviers SANS KPI, un résumé
 * kanban classique (à faire/en cours/terminé) — jamais de nom de levier à ce niveau, uniquement des
 * comptes (demande PO explicite "synthétique, court").
 *
 * Chaque compteur est cliquable et ouvre un drill-down (`Modal`) listant TOUS les leviers DE L'AXE
 * (pas seulement ceux du chantier cliqué — comportement explicitement demandé) actuellement à ce
 * jalon/statut, réutilisant `LevierCard` (`LevierMilestoneBoard.tsx`, round 8) pour le même langage
 * visuel que le dashboard. Cliquer un levier dans le drill-down ferme la modale et appelle
 * `onOpenChantier(chantierId, focusActionId)` — même mécanisme `focusActionId` déjà utilisé par
 * `AxisDetailClient`/`ChantierGantt` (URLSearchParams `chantier=`/`action=` → `ChantierDetailPanel`
 * défile et surligne la bonne `<li>`), câblé tel quel par `StrategicAxesView.openChantierPanel`.
 *
 * `milestoneFilter` (round 9, point 9) : filtre "Jalon" indépendant du filtre "Étape de maturité"
 * (qui opère sur `StrategicAxis.stage`, une entité différente) — masque les lignes de chantier qui
 * n'ont aucun levier au(x) jalon(s) sélectionné(s). Calculé et piloté par l'appelant
 * (`StrategicAxesView`, `FilterBar` dédié), transmis ici en simple valeur : ce composant ne connaît
 * rien de l'état de filtre lui-même, seulement son résultat.
 *
 * Aucun drag & drop, inchangé : le changement de jalon/statut se fait depuis la fiche chantier.
 */

type ChantierCounts = {
  milestoneCounts: Record<MilestoneId, number>;
  kanbanCounts: Record<LevierKanbanStatus, number>;
};

const KANBAN_ORDER: LevierKanbanStatus[] = ["todo", "in_progress", "done"];

function emptyCounts(): ChantierCounts {
  return {
    milestoneCounts: { E0: 0, E1: 0, E2: 0, E3: 0, E4: 0 },
    kanbanCounts: { todo: 0, in_progress: 0, done: 0 },
  };
}

type Drilldown =
  | { axisId: string; kind: "milestone"; milestoneId: MilestoneId }
  | { axisId: string; kind: "kanban"; status: LevierKanbanStatus };

export function AxisKanban({
  axes,
  stages,
  chantiersByAxis,
  chantierActions,
  onCardClick,
  onOpenChantier,
  atRiskItemsOf,
  milestoneFilter,
  labels,
}: {
  axes: StrategicAxis[];
  /** Étapes du programme, déjà triées par `order` (voir `useMaturityStages`) — transmises telles
   *  quelles à `AxisStageBadge`. */
  stages: MaturityStageConfig[];
  /** Chantiers DE CHAQUE axe, déjà groupés par l'appelant (voir `StrategicAxesView.chantiersByAxis`) —
   *  TOUJOURS la liste complète, non filtrée par `milestoneFilter` : le drill-down doit pouvoir
   *  retrouver le nom de n'importe quel chantier de l'axe, y compris ceux masqués par le filtre. */
  chantiersByAxis: Map<string, Chantier[]>;
  /** Tous les leviers de l'entreprise/du programme — ce composant construit lui-même ses propres
   *  regroupements (par chantier pour les compteurs, par axe pour le drill-down) plutôt que
   *  d'exiger un pré-bucketing de l'appelant : le drill-down a besoin d'un regroupement AXE entier
   *  que les compteurs par chantier n'ont pas, les deux dérivent de la même source. */
  chantierActions: ChantierAction[];
  /** Clic sur l'en-tête de la carte d'axe → navigation vers la fiche de l'axe (inchangé). */
  onCardClick: (axisId: string) => void;
  /** Clic sur le nom d'un chantier → ouvre son panneau (sans focus). Clic sur un levier du
   *  drill-down → ouvre le MÊME panneau, focalisé sur ce levier précis (round 9, point 3). */
  onOpenChantier: (chantierId: string, focusActionId?: string) => void;
  /** Indicateurs à risque D'UN AXE (macro + tous ses chantiers confondus), écart calculé — alimente
   *  le contenu du popover déclenché par `AtRiskCountPill` au niveau de l'axe. */
  atRiskItemsOf?: (axisId: string) => { indicator: Indicator; delta: IndicatorDelta | undefined }[];
  /** Jalons E0-E4 sélectionnés par le filtre "Jalon" (round 9, point 9) — vide/undefined = aucun
   *  filtre, tous les chantiers restent affichés. Un chantier reste visible si AU MOINS UN de ses
   *  leviers rattachés à un KPI est actuellement à l'un des jalons sélectionnés. */
  milestoneFilter?: MilestoneId[];
  labels?: {
    emptyAxisChantiers?: string;
    /** Distinct de `emptyAxisChantiers` : l'axe A des chantiers, mais aucun ne correspond au filtre
     *  "Jalon" actif. */
    filteredEmptyAxisChantiers?: string;
    chantiers?: string;
    atRisk?: string;
    atRiskPopoverTitle?: string;
    atRiskTooltip?: string;
    progress?: string;
    /** Chantier sans aucun levier (ni suivi KPI, ni kanban classique). */
    noLeviers?: string;
    kanbanBadgePrefix?: string;
    kanbanStatusLabels?: Record<LevierKanbanStatus, string>;
    drilldownTitlePrefix?: string;
    drilldownEmpty?: string;
  };
}) {
  const l = {
    emptyAxisChantiers: labels?.emptyAxisChantiers ?? "Aucun chantier",
    filteredEmptyAxisChantiers: labels?.filteredEmptyAxisChantiers ?? "Aucun chantier à ce jalon",
    chantiers: labels?.chantiers ?? "chantiers",
    atRisk: labels?.atRisk ?? "à risque",
    atRiskPopoverTitle: labels?.atRiskPopoverTitle ?? "Indicateurs à risque",
    atRiskTooltip: labels?.atRiskTooltip,
    progress: labels?.progress,
    noLeviers: labels?.noLeviers ?? "Aucun levier",
    kanbanBadgePrefix: labels?.kanbanBadgePrefix ?? "Kanban",
    kanbanStatusLabels: labels?.kanbanStatusLabels ?? {
      todo: "À faire",
      in_progress: "En cours",
      done: "Terminé",
    },
    drilldownTitlePrefix: labels?.drilldownTitlePrefix ?? "Leviers",
    drilldownEmpty: labels?.drilldownEmpty ?? "Aucun levier à ce stade.",
  };

  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);

  /** Compteurs par chantier — un seul passage sur `chantierActions`, dérive à la fois les compteurs
   *  de jalon (leviers avec `indicatorId`) et de statut kanban (leviers sans), voir doc-comment de
   *  tête. */
  const perChantierCounts = useMemo(() => {
    const map = new Map<string, ChantierCounts>();
    for (const action of chantierActions) {
      const entry = map.get(action.chantierId) ?? emptyCounts();
      if (action.indicatorId) {
        const milestoneId = action.milestones?.currentMilestone ?? "E0";
        entry.milestoneCounts[milestoneId] += 1;
      } else {
        const status = action.kanbanStatus ?? "todo";
        entry.kanbanCounts[status] += 1;
      }
      map.set(action.chantierId, entry);
    }
    return map;
  }, [chantierActions]);

  const chantierMatchesMilestoneFilter = (chantierId: string): boolean => {
    if (!milestoneFilter || milestoneFilter.length === 0) return true;
    const counts = perChantierCounts.get(chantierId);
    if (!counts) return false;
    return milestoneFilter.some((m) => counts.milestoneCounts[m] > 0);
  };

  /** Leviers de l'axe du drill-down ouvert, filtrés par jalon OU statut kanban selon `drilldown.kind` —
   *  recalculé à chaque ouverture plutôt que pré-bucketé pour tous les axes/jalons à l'avance (pas
   *  besoin, un seul drill-down ouvert à la fois). */
  const drilldownItems = useMemo(() => {
    if (!drilldown) return [] as { action: ChantierAction; chantier: Chantier }[];
    const axisChantiers = chantiersByAxis.get(drilldown.axisId) ?? [];
    const chantierById = new Map(axisChantiers.map((c) => [c.id, c] as const));
    return chantierActions
      .filter((a) => chantierById.has(a.chantierId))
      .filter((a) =>
        drilldown.kind === "milestone"
          ? !!a.indicatorId && (a.milestones?.currentMilestone ?? "E0") === drilldown.milestoneId
          : !a.indicatorId && (a.kanbanStatus ?? "todo") === drilldown.status
      )
      .map((a) => ({ action: a, chantier: chantierById.get(a.chantierId)! }));
  }, [drilldown, chantierActions, chantiersByAxis]);

  const drilldownTitle = !drilldown
    ? l.drilldownTitlePrefix
    : `${l.drilldownTitlePrefix} · ${
        drilldown.kind === "milestone"
          ? drilldown.milestoneId
          : l.kanbanStatusLabels[drilldown.status]
      }`;

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {axes.map((axis) => {
          const axisChantiers = chantiersByAxis.get(axis.id) ?? [];
          const visibleChantiers = axisChantiers.filter((c) =>
            chantierMatchesMilestoneFilter(c.id)
          );
          const atRiskItems = atRiskItemsOf?.(axis.id) ?? [];
          return (
            <div
              key={axis.id}
              className="flex flex-col overflow-hidden rounded-lg border border-border bg-white shadow-sm"
              style={{ borderLeft: `4px solid ${axis.color ?? "var(--bp-warm-taupe)"}` }}
            >
              {/* En-tête cliquable → fiche de l'axe. `div role="button"` plutôt qu'un vrai `<button>` :
                  il imbrique `AtRiskCountPill`, lui-même un `<button>` (Popover-déclencheur) — un
                  bouton dans un bouton est une imbrication HTML invalide. */}
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
                  <p className="py-4 text-center text-[11px] text-tertiary">
                    {l.emptyAxisChantiers}
                  </p>
                ) : visibleChantiers.length === 0 ? (
                  <p className="py-4 text-center text-[11px] text-tertiary">
                    {l.filteredEmptyAxisChantiers}
                  </p>
                ) : (
                  visibleChantiers.map((chantier) => {
                    const counts = perChantierCounts.get(chantier.id) ?? emptyCounts();
                    const hasMilestoneTracked = MILESTONE_ORDER.some(
                      (m) => counts.milestoneCounts[m] > 0
                    );
                    const kanbanNonZero = KANBAN_ORDER.filter((s) => counts.kanbanCounts[s] > 0);
                    const hasAnyLevier = hasMilestoneTracked || kanbanNonZero.length > 0;
                    return (
                      <div
                        key={chantier.id}
                        className="rounded-md border border-border bg-white p-2"
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenChantier(chantier.id)}
                            title={chantier.name}
                            className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold text-primary hover:underline"
                          >
                            {chantier.name}
                          </button>
                          <AxisStageBadge
                            stageId={chantier.stage}
                            stages={stages}
                            className="shrink-0"
                          />
                        </div>
                        {!hasAnyLevier ? (
                          <p className="mt-1 text-[10.5px] text-tertiary">{l.noLeviers}</p>
                        ) : (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {hasMilestoneTracked &&
                              MILESTONE_ORDER.map((milestoneId) => {
                                const count = counts.milestoneCounts[milestoneId];
                                return (
                                  <button
                                    key={milestoneId}
                                    type="button"
                                    onClick={() =>
                                      setDrilldown({
                                        axisId: axis.id,
                                        kind: "milestone",
                                        milestoneId,
                                      })
                                    }
                                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold transition hover:border-black ${
                                      count > 0
                                        ? "border-border bg-neutral-100 text-secondary"
                                        : "border-border/60 bg-white text-tertiary"
                                    }`}
                                  >
                                    {milestoneId}: {count}
                                  </button>
                                );
                              })}
                            {kanbanNonZero.map((status) => (
                              <button
                                key={status}
                                type="button"
                                onClick={() =>
                                  setDrilldown({ axisId: axis.id, kind: "kanban", status })
                                }
                                className="rounded-full border border-border bg-neutral-50 px-1.5 py-0.5 text-[10px] font-semibold text-secondary transition hover:border-black"
                              >
                                {l.kanbanBadgePrefix} · {l.kanbanStatusLabels[status]} :{" "}
                                {counts.kanbanCounts[status]}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Drill-down (round 9, point 3) — leviers de l'AXE ENTIER au jalon/statut cliqué, jamais
          limité au seul chantier dont le compteur a été cliqué (demande PO explicite). */}
      <Modal
        open={!!drilldown}
        onOpenChange={(open) => {
          if (!open) setDrilldown(null);
        }}
        title={drilldownTitle}
        maxWidth="560px"
      >
        {drilldownItems.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-tertiary">{l.drilldownEmpty}</p>
        ) : (
          <div className="space-y-1.5">
            {drilldownItems.map(({ action, chantier }) => (
              <LevierCard
                key={action.id}
                action={action}
                chantier={chantier}
                chantierColor={colorForChantier(chantier.id)}
                onLevierClick={(chantierId) => {
                  setDrilldown(null);
                  onOpenChantier(chantierId, action.id);
                }}
              />
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
