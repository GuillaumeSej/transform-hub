"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { colorForChantier } from "@/lib/axisLogic";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Chantier, ChantierAction, ProjetKanbanStatus, StrategicAxis } from "@/types";

/**
 * Accordéon Axe → Chantier → Projet (round 24, Phase 4, Partie 3) — nouvel onglet "Vue par axe" de
 * `StrategicAxesView.tsx`, en complément de l'onglet "Avancement" (vue E0→E4 par axe, inchangée
 * dans son principe). Répond à un besoin de navigation différent : partir d'un axe et DESCENDRE
 * jusqu'au projet, plutôt que de tout voir à plat groupé par jalon courant.
 *
 * Composant SÉPARÉ (plutôt qu'inline dans `StrategicAxesView.tsx`) — la page porte déjà beaucoup
 * de logique (import, création d'axe, panneau chantier, vue E0→E4) ; l'imbrication à 3 niveaux ici
 * mérite son propre fichier.
 *
 * Tout replié par défaut (round 24 : décision produit — un programme avec plusieurs dizaines de
 * chantiers/projets ouvrirait un mur de texte si tout était déplié d'entrée).
 *
 * **Un chantier multi-axe** (`Chantier.axisIds`, round 24 Phase 2) apparaît sous CHACUN de ses
 * axes, et son état déplié/replié est suivi INDÉPENDAMMENT par axe — clé composite
 * `${axisId}:${chantierId}` dans `expandedChantierKeys`, jamais un simple id de chantier seul (qui
 * synchroniserait à tort l'état entre deux sections d'axe différentes).
 *
 * Pas de filtrage par rôle/habilitation ici (périmètre explicitement différé, voir le plan) : tout
 * utilisateur qui atteint déjà cette page voit l'accordéon complet.
 */

/** Mêmes 3 couleurs que `deliverableMarkerColor`/`deliverableStatusColor` (`ProgramRoadmap.tsx`/
 *  `ChantierDetailPanel.tsx`) — dupliquées ici plutôt qu'importées : aucun des deux fichiers
 *  n'exporte cette fonction (chacun la garde privée), même parti pris de duplication assumé que ces
 *  deux-là (voir leurs propres doc-comments). Colore les pastilles compactes de statut de livrable
 *  sous chaque projet, plus légères qu'un `TimelineMarker` (conçu pour un positionnement en
 *  pourcentage sur une piste temporelle, hors sujet ici — une simple liste plate). */
const DELIVERABLE_COLOR_RED = "#ff3c47";
const DELIVERABLE_COLOR_AMBER = "#806659";
const DELIVERABLE_COLOR_GREEN = "#1a1a1a";

function deliverableStatusColor(status: ProjetKanbanStatus | undefined): string {
  switch (status) {
    case "done":
      return DELIVERABLE_COLOR_GREEN;
    case "in_progress":
      return DELIVERABLE_COLOR_AMBER;
    default:
      return DELIVERABLE_COLOR_RED;
  }
}

export function AxisChantierProjetAccordion({
  axes,
  chantiers,
  chantierActions,
  onProjetClick,
  onDeliverableClick,
}: {
  /** Ordre d'apparition = numérotation "Axe {n}" (même convention que la section "Avancement" de
   *  `StrategicAxesView.tsx` : position 1-based dans ce tableau, jamais retriée). */
  axes: StrategicAxis[];
  chantiers: Chantier[];
  chantierActions: ChantierAction[];
  /** Clic sur un projet (ou, sans `focusActionId`, sur un chantier) — ouvre le panneau chantier de
   *  l'appelant, même contrat que `openChantierPanel` de `StrategicAxesView.tsx`. */
  onProjetClick: (chantierId: string, focusActionId?: string) => void;
  /** Clic sur UN livrable précis (round <n>) — contrat SÉPARÉ de `onProjetClick` ci-dessus plutôt
   *  qu'un 3e paramètre optionnel sur celui-ci : les deux gestes sont sémantiquement distincts
   *  ("ouvre le panneau sur ce projet" vs. "ouvre le panneau ET la modale de CE livrable précis"),
   *  et l'appelant (`StrategicAxesView.tsx`) doit de toute façon distinguer les deux pour poser le
   *  bon état d'ouverture du panneau (`ChantierDetailPanel`'s `initialOpenDeliverable`). */
  onDeliverableClick: (chantierId: string, actionId: string, deliverableId: string) => void;
}) {
  const { t } = useTranslation();
  const [expandedAxisIds, setExpandedAxisIds] = useState<Set<string>>(new Set());
  /** Clé composite `${axisId}:${chantierId}` — voir le doc-comment de tête de ce fichier. */
  const [expandedChantierKeys, setExpandedChantierKeys] = useState<Set<string>>(new Set());

  const toggleAxis = (axisId: string) => {
    setExpandedAxisIds((prev) => {
      const next = new Set(prev);
      if (next.has(axisId)) next.delete(axisId);
      else next.add(axisId);
      return next;
    });
  };

  const toggleChantier = (key: string) => {
    setExpandedChantierKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (axes.length === 0) {
    return <p className="py-6 text-center text-sm text-tertiary">{t("strategicAxes.empty")}</p>;
  }

  return (
    <div className="space-y-2">
      {axes.map((axis, axisIndex) => {
        // Round 24 (Phase 2) : appartenance multi-axe — un chantier figure sous CHAQUE axe listé
        // dans son `axisIds`, pas seulement le premier (même règle que `chantiersByAxis` de
        // `StrategicAxesView.tsx`).
        const axisChantiers = chantiers.filter((c) => c.axisIds.includes(axis.id));
        const axisOpen = expandedAxisIds.has(axis.id);
        return (
          <div key={axis.id} className="overflow-hidden rounded-lg border border-border bg-white">
            <button
              type="button"
              onClick={() => toggleAxis(axis.id)}
              aria-expanded={axisOpen}
              className="flex w-full items-center gap-2 bg-neutral-50 px-3.5 py-2.5 text-left transition hover:bg-neutral-100"
            >
              {axisOpen ? (
                <ChevronDown size={14} className="shrink-0 text-tertiary" aria-hidden />
              ) : (
                <ChevronRight size={14} className="shrink-0 text-tertiary" aria-hidden />
              )}
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: axis.color ?? "var(--bp-warm-taupe)" }}
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-primary">
                {t("strategicAxes.axisNumberPrefix", "Axe {n} : {name}")
                  .replace("{n}", String(axisIndex + 1))
                  .replace("{name}", axis.name)}
              </span>
              <span className="shrink-0 rounded-full border border-border bg-white px-1.5 py-px text-[10px] font-semibold text-tertiary">
                {axisChantiers.length}
              </span>
            </button>

            {axisOpen && (
              <div className="divide-y divide-border border-t border-border">
                {axisChantiers.length === 0 ? (
                  <p className="px-4 py-3 text-center text-[12px] text-tertiary">
                    {t("strategicAxes.axisNoChantier")}
                  </p>
                ) : (
                  axisChantiers.map((chantier) => {
                    const chantierKey = `${axis.id}:${chantier.id}`;
                    const chantierOpen = expandedChantierKeys.has(chantierKey);
                    const projets = chantierActions.filter((a) => a.chantierId === chantier.id);
                    return (
                      <div key={chantierKey}>
                        <button
                          type="button"
                          onClick={() => toggleChantier(chantierKey)}
                          aria-expanded={chantierOpen}
                          className="flex w-full items-center gap-2 py-2.5 pl-8 pr-3.5 text-left transition hover:bg-neutral-50"
                        >
                          {chantierOpen ? (
                            <ChevronDown size={13} className="shrink-0 text-tertiary" aria-hidden />
                          ) : (
                            <ChevronRight
                              size={13}
                              className="shrink-0 text-tertiary"
                              aria-hidden
                            />
                          )}
                          <span
                            aria-hidden
                            className={`h-2 w-2 shrink-0 rounded-full ${colorForChantier(chantier.id)}`}
                          />
                          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-secondary">
                            {chantier.name}
                          </span>
                          <span className="shrink-0 rounded-full border border-border bg-white px-1.5 py-px text-[10px] font-semibold text-tertiary">
                            {projets.length}
                          </span>
                        </button>

                        {chantierOpen && (
                          <div className="space-y-1.5 bg-neutral-50/70 py-2 pl-14 pr-3.5">
                            {projets.length === 0 ? (
                              <p className="py-1.5 text-[11.5px] text-tertiary">
                                {t("strategicAxes.chantierNoProjet")}
                              </p>
                            ) : (
                              projets.map((action) => (
                                // Round <n> : DIV cliquable (pas `<button>`) — les livrables
                                // ci-dessous sont désormais eux-mêmes des `<button>` individuels
                                // (voir plus bas), et un `<button>` imbriqué dans un autre
                                // `<button>` est du HTML invalide (le navigateur "referme" le
                                // parent au premier `<button>` enfant rencontré, cassant le clic
                                // sur la carte). `role="button"`/`tabIndex`/`onKeyDown` reproduisent
                                // le comportement clavier qu'un vrai `<button>` offrait gratuitement.
                                <div
                                  key={action.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => onProjetClick(chantier.id, action.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      onProjetClick(chantier.id, action.id);
                                    }
                                  }}
                                  className="flex w-full cursor-pointer flex-col items-start gap-1.5 rounded-md border border-border bg-white px-2.5 py-1.5 text-left transition hover:-translate-y-px hover:border-black hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-black"
                                >
                                  <span className="w-full truncate text-[11.5px] font-medium text-primary">
                                    {action.name}
                                  </span>
                                  {/* Livrables (round 24, Phase 4 ; round <n> : pastille anonyme →
                                      étiquette nommée individuellement cliquable) — même code
                                      couleur de statut que la timeline fusionnée de
                                      `ChantierDetailPanel.tsx`/le Gantt programme
                                      (`ProgramRoadmap.tsx`) — pas le `TimelineMarker` lui-même
                                      (conçu pour un positionnement temporel en %, hors sujet dans
                                      une simple liste). Chaque étiquette ouvre directement LA
                                      modale de CE livrable (`onDeliverableClick`), pas seulement
                                      le projet — `e.stopPropagation()` empêche le clic de
                                      remonter au conteneur de la carte projet ci-dessus (qui
                                      ouvrirait sinon le panneau SANS cibler le livrable). */}
                                  {action.deliverables && action.deliverables.length > 0 && (
                                    <span className="flex flex-wrap items-center gap-1">
                                      {action.deliverables.map((deliverable) => (
                                        <button
                                          key={deliverable.id}
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onDeliverableClick(
                                              chantier.id,
                                              action.id,
                                              deliverable.id
                                            );
                                          }}
                                          title={deliverable.label}
                                          className="inline-flex max-w-[10rem] items-center gap-1 rounded-full border border-border bg-neutral-50 px-1.5 py-0.5 text-[10px] font-medium text-secondary transition hover:border-black hover:bg-white focus:outline-none focus:ring-2 focus:ring-black"
                                        >
                                          <span
                                            aria-hidden
                                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                                            style={{
                                              backgroundColor: deliverableStatusColor(
                                                deliverable.status
                                              ),
                                            }}
                                          />
                                          <span className="truncate">{deliverable.label}</span>
                                        </button>
                                      ))}
                                    </span>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
