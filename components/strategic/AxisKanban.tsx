"use client";

import { useMemo, useState } from "react";
import { LevierCard } from "@/components/strategic/LevierMilestoneBoard";
import { Modal } from "@/components/shared/Modal";
import {
  BudgetDonutChart,
  type BudgetDonutSlice,
} from "@/components/shared/charts/BudgetDonutChart";
import { colorForChantier, sumLevierBudgets } from "@/lib/axisLogic";
import { MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import type {
  Chantier,
  ChantierAction,
  LevierKanbanStatus,
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
 * `milestoneFilter` (round 9, point 9) : filtre "Jalon" — masque les lignes de chantier qui n'ont
 * aucun levier au(x) jalon(s) sélectionné(s). Calculé et piloté par l'appelant (`StrategicAxesView`,
 * `FilterBar` dédié), transmis ici en simple valeur : ce composant ne connaît rien de l'état de
 * filtre lui-même, seulement son résultat.
 *
 * Aucun drag & drop, inchangé : le changement de jalon/statut se fait depuis la fiche chantier.
 *
 * Round 11 : le badge d'étape de maturité (`AxisStageBadge`) est retiré des en-têtes d'axe et des
 * lignes de chantier de cette vue (le PO le juge sans intérêt à ces deux mailles) — il ne subsiste
 * plus que sur les lignes de LEVIER sans KPI (`ChantierDetailPanel`, hors périmètre de ce fichier).
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
  chantiersByAxis,
  chantierActions,
  onCardClick,
  onOpenChantier,
  milestoneFilter,
  currency,
  labels,
}: {
  axes: StrategicAxis[];
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
  /** Jalons E0-E4 sélectionnés par le filtre "Jalon" (round 9, point 9) — vide/undefined = aucun
   *  filtre, tous les chantiers restent affichés. Un chantier reste visible si AU MOINS UN de ses
   *  leviers rattachés à un KPI est actuellement à l'un des jalons sélectionnés. */
  milestoneFilter?: MilestoneId[];
  /** Devise du programme actif (`Program.currency`) — round 10, point 3 : affichée à côté du budget
   *  alloué de chaque chantier, pour rester cohérent avec la vue "Cartes". `undefined` masque
   *  simplement l'unité (chantier sans budget renseigné, ou devise indisponible). */
  currency?: string;
  labels?: {
    emptyAxisChantiers?: string;
    /** Distinct de `emptyAxisChantiers` : l'axe A des chantiers, mais aucun ne correspond au filtre
     *  "Jalon" actif. */
    filteredEmptyAxisChantiers?: string;
    chantiers?: string;
    /** Chantier sans aucun levier (ni suivi KPI, ni kanban classique). */
    noLeviers?: string;
    kanbanBadgePrefix?: string;
    kanbanStatusLabels?: Record<LevierKanbanStatus, string>;
    drilldownTitlePrefix?: string;
    drilldownEmpty?: string;
    /** Titre de la modale donut de répartition budgétaire par levier (round 12). */
    budgetByLevierModalTitle?: string;
    /** Libellé du slice représentant la part du budget chantier non affectée à un levier
     *  (round 12) — `chantier.allocatedBudget - sumLevierBudgets(...)`, quand positif. */
    budgetUnallocated?: string;
  };
}) {
  const l = {
    emptyAxisChantiers: labels?.emptyAxisChantiers ?? "Aucun chantier",
    filteredEmptyAxisChantiers: labels?.filteredEmptyAxisChantiers ?? "Aucun chantier à ce jalon",
    chantiers: labels?.chantiers ?? "chantiers",
    noLeviers: labels?.noLeviers ?? "Aucun levier",
    kanbanBadgePrefix: labels?.kanbanBadgePrefix ?? "Kanban",
    kanbanStatusLabels: labels?.kanbanStatusLabels ?? {
      todo: "À faire",
      in_progress: "En cours",
      done: "Terminé",
    },
    drilldownTitlePrefix: labels?.drilldownTitlePrefix ?? "Leviers",
    drilldownEmpty: labels?.drilldownEmpty ?? "Aucun levier à ce stade.",
    budgetByLevierModalTitle:
      labels?.budgetByLevierModalTitle ?? "Répartition du budget par levier",
    budgetUnallocated: labels?.budgetUnallocated ?? "Non affecté",
  };

  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);

  /** Chantier dont le donut de répartition budgétaire PAR LEVIER (round 12) est actuellement
   *  ouvert — `null` = modale fermée. */
  const [budgetDonutChantierId, setBudgetDonutChantierId] = useState<string | null>(null);

  /** Tous les chantiers de tous les axes, à plat, indexés par id — `chantiersByAxis` est groupé
   *  par axe, mais le donut budgétaire n'a besoin que de retrouver UN chantier par son id (pour
   *  son `allocatedBudget`), quel que soit son axe. */
  const chantierById = useMemo(() => {
    const map = new Map<string, Chantier>();
    chantiersByAxis.forEach((chantiers) => {
      chantiers.forEach((c) => map.set(c.id, c));
    });
    return map;
  }, [chantiersByAxis]);

  /** Ids de chantier ayant AU MOINS un levier avec `budget` renseigné — détermine si le budget
   *  chantier affiché plus bas (round 10) devient cliquable (round 12) ou reste un simple texte. */
  const chantierIdsWithLevierBudget = useMemo(() => {
    const set = new Set<string>();
    for (const action of chantierActions) {
      if (action.budget !== undefined) set.add(action.chantierId);
    }
    return set;
  }, [chantierActions]);

  /** Parts du donut budgétaire du chantier actuellement ouvert (`budgetDonutChantierId`) — un
   *  slice par levier du chantier AYANT `budget` renseigné (les leviers sans budget sont exclus,
   *  contrairement à `sumLevierBudgets` qui les compte pour 0 dans la somme ci-dessous), plus un
   *  slice "non affecté" si la somme des budgets leviers n'épuise pas le budget alloué du
   *  chantier. `null` tant qu'aucune modale n'est ouverte. */
  const budgetDonutSlices: BudgetDonutSlice[] | null = useMemo(() => {
    if (!budgetDonutChantierId) return null;
    const leviersWithBudget = chantierActions.filter(
      (a) => a.chantierId === budgetDonutChantierId && a.budget !== undefined
    );
    const slices: BudgetDonutSlice[] = leviersWithBudget.map((a) => ({
      name: a.name,
      value: a.budget ?? 0,
    }));
    const allocated = chantierById.get(budgetDonutChantierId)?.allocatedBudget ?? 0;
    const allocatedToLeviers = sumLevierBudgets(budgetDonutChantierId, chantierActions);
    if (allocatedToLeviers < allocated) {
      slices.push({ name: l.budgetUnallocated, value: allocated - allocatedToLeviers });
    }
    return slices;
  }, [budgetDonutChantierId, chantierActions, chantierById, l.budgetUnallocated]);

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
          return (
            <div
              key={axis.id}
              className="flex flex-col overflow-hidden rounded-lg border border-border bg-white shadow-sm"
              style={{ borderLeft: `4px solid ${axis.color ?? "var(--bp-warm-taupe)"}` }}
            >
              {/* En-tête cliquable → fiche de l'axe. `div role="button"` (pas un vrai `<button>`) car
                  le reste de la carte imbrique déjà d'autres `<button>` (lignes de chantier). */}
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
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-secondary">
                    {axisChantiers.length} {l.chantiers}
                  </span>
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
                          {chantier.allocatedBudget !== undefined &&
                            (chantierIdsWithLevierBudget.has(chantier.id) ? (
                              // Round 12 : au moins un levier a un budget renseigné → le montant
                              // devient cliquable, ouvre le donut de répartition par levier.
                              <button
                                type="button"
                                onClick={() => setBudgetDonutChantierId(chantier.id)}
                                className="shrink-0 text-[10px] font-semibold text-secondary underline-offset-2 hover:text-primary hover:underline"
                              >
                                {chantier.allocatedBudget.toLocaleString()}
                                {currency ? ` ${currency}` : ""}
                              </button>
                            ) : (
                              <span className="shrink-0 text-[10px] font-semibold text-secondary">
                                {chantier.allocatedBudget.toLocaleString()}
                                {currency ? ` ${currency}` : ""}
                              </span>
                            ))}
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

      {/* Donut de répartition budgétaire du chantier par levier (round 12) — un slice par levier
          avec `budget` renseigné, plus un slice "non affecté" si `sumLevierBudgets` n'épuise pas
          le budget alloué du chantier (`budgetDonutSlices`). Cliquer un slice ferme cette modale
          et ouvre le panneau chantier, focalisé sur le levier cliqué (sauf pour le slice "non
          affecté", qui n'a pas de levier associé). */}
      <Modal
        open={!!budgetDonutChantierId}
        onOpenChange={(open) => {
          if (!open) setBudgetDonutChantierId(null);
        }}
        title={l.budgetByLevierModalTitle}
        maxWidth="560px"
      >
        {budgetDonutChantierId && budgetDonutSlices && budgetDonutSlices.length > 0 && (
          <BudgetDonutChart
            data={budgetDonutSlices}
            formatValue={(value) => `${value.toLocaleString()}${currency ? ` ${currency}` : ""}`}
            onSliceClick={(name) => {
              const chantierId = budgetDonutChantierId;
              const action =
                name === l.budgetUnallocated
                  ? undefined
                  : chantierActions.find(
                      (a) =>
                        a.chantierId === chantierId && a.name === name && a.budget !== undefined
                    );
              setBudgetDonutChantierId(null);
              onOpenChantier(chantierId, action?.id);
            }}
          />
        )}
      </Modal>
    </>
  );
}
