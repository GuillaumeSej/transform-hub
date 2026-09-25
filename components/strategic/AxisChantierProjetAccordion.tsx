"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { ProgressBar } from "@/components/shared/ProgressBar";
import {
  axisProgressPct,
  chantierDeclaredProgress,
  AXIS_FALLBACK_COLOR,
  chantierShadesForAxis,
  milestoneProgressPct,
  projetMilestoneCounts,
  type ProjetProgressLookup,
} from "@/lib/axisLogic";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  DeliverableDiamond,
  useDeliverableStateText,
} from "@/components/strategic/deliverableMarker";
import { deliverableLateDays, deliverableState, effectiveDueDate } from "@/lib/deliverableState";
import type { Chantier, ChantierAction, StrategicAxis } from "@/types";

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
 * Round 25 (RBAC) : le filtrage QUELS axes/chantiers/projets apparaissent ici reste entièrement à
 * la charge de l'appelant (`StrategicAxesView.tsx`, via les `axes`/`chantiers`/`chantierActions`
 * déjà scopés par `useStrategicData.ts`) — ce composant n'a toujours aucune notion de rôle. La
 * seule chose qu'il gère lui-même est la distinction plus fine `chantier_contributor` : un projet
 * VISIBLE (déjà dans `chantierActions`) mais pas CLIQUABLE (`clickableActionIds`, voir le prop
 * ci-dessous) reste affiché tel quel mais devient inerte au clic.
 */

// Étiquettes de livrable sous chaque projet : petit losange au code visuel partagé
// (`deliverableMarker.tsx` — Fait plein encre, À faire creux, En retard plein rouge corail).

/** Ligne d'arborescence commune aux 3 niveaux : nom (cliquable → fiche), responsable, décompte
 *  d'éléments en dessous et barre d'avancement + % (même composition que le plan Performance,
 *  `LeverLibraryTree.tsx`). Un clic sur la ligne déplie (`onToggle`) ; le nom ouvre la fiche. */
function TreeRow({
  level,
  open,
  onToggle,
  onOpen,
  dot,
  name,
  owner,
  count,
  pct,
  openLabel,
  indentClass,
  dimmed,
}: {
  level: "axis" | "chantier" | "projet";
  open?: boolean;
  onToggle?: () => void;
  onOpen?: () => void;
  dot: ReactNode;
  name: string;
  owner: string;
  count: string;
  pct: number;
  openLabel: string;
  indentClass: string;
  dimmed?: boolean;
}) {
  const expandable = level !== "projet";
  const activate = expandable ? onToggle : onOpen;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div
      role="button"
      tabIndex={activate ? 0 : undefined}
      aria-expanded={expandable ? open : undefined}
      onClick={activate}
      onKeyDown={(e) => {
        if (activate && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          activate();
        }
      }}
      className={`group flex w-full items-center gap-3 pr-5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-black ${indentClass} ${
        activate ? "cursor-pointer hover:bg-neutral-100" : "opacity-60"
      } ${dimmed ? "opacity-60" : ""} ${level === "axis" ? "bg-neutral-50 py-4" : level === "chantier" ? "py-3.5" : "py-3"}`}
    >
      {expandable ? (
        <Chevron size={18} className="shrink-0 text-tertiary" aria-hidden />
      ) : (
        <span className="w-[18px] shrink-0" aria-hidden />
      )}
      {dot}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {onOpen && expandable ? (
            <button
              type="button"
              title={openLabel}
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
              className="inline-flex min-w-0 items-center gap-1 text-left hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
            >
              <span
                className={`truncate ${level === "axis" ? "text-[15px] font-bold text-primary" : "text-[14px] font-semibold text-primary"}`}
              >
                {name}
              </span>
              <ExternalLink
                size={13}
                className="shrink-0 text-tertiary opacity-0 transition group-hover:opacity-100"
                aria-hidden
              />
            </button>
          ) : (
            <span className="truncate text-[13.5px] font-medium text-primary">{name}</span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-tertiary">{owner}</span>
      </span>
      <span className="hidden shrink-0 rounded-full border border-border bg-white px-2.5 py-0.5 text-[11.5px] font-semibold text-secondary sm:inline">
        {count}
      </span>
      <span className="w-[160px] shrink-0">
        <ProgressBar pct={pct} />
      </span>
    </div>
  );
}

/** Repli quand le chantier n'a ni pilote ni sponsor : responsable le plus fréquent de ses projets. */
function mostFrequentOwner(projets: { owner?: string }[]): string | undefined {
  const counts = new Map<string, number>();
  for (const p of projets) if (p.owner) counts.set(p.owner, (counts.get(p.owner) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function AxisChantierProjetAccordion({
  axes,
  chantiers,
  chantierActions,
  onProjetClick,
  onDeliverableClick,
  onAxisClick,
  expandAllSignal = 0,
  clickableActionIds = "all",
  progressOf = (a) => milestoneProgressPct(a),
}: {
  /** Ordre d'apparition = numérotation "Axe {n}" (position 1-based, jamais retriée). */
  axes: StrategicAxis[];
  chantiers: Chantier[];
  chantierActions: ChantierAction[];
  /** Clic sur un projet (ou, sans `focusActionId`, sur un chantier) — ouvre le panneau chantier. */
  onProjetClick: (chantierId: string, focusActionId?: string) => void;
  /** Clic sur UN livrable précis — contrat séparé de `onProjetClick`. */
  onDeliverableClick: (chantierId: string, actionId: string, deliverableId: string) => void;
  /** Ouvre la fiche d'un axe (route existante `/levers/detail?id=`). */
  onAxisClick?: (axisId: string) => void;
  /** Incrémenter pour déplier tous les axes (clic sur « axes » de l'en-tête de la vue). */
  expandAllSignal?: number;
  /** Round 25 (RBAC `chantier_contributor`) — un projet hors de cet ensemble reste rendu mais inerte. */
  clickableActionIds?: Set<string> | "all";
  /** Avancement complet d'un projet (`useStrategicData().projetProgress`, items auto compris) —
   *  même chiffre que le board et la fiche chantier. Omis = mode dégradé. */
  progressOf?: ProjetProgressLookup;
}) {
  const { t } = useTranslation();
  const { tooltip: deliverableTooltip } = useDeliverableStateText();
  const [expandedAxisIds, setExpandedAxisIds] = useState<Set<string>>(new Set());
  /** Clé composite `${axisId}:${chantierId}` — voir le doc-comment de tête de ce fichier. */
  const [expandedChantierKeys, setExpandedChantierKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (expandAllSignal > 0) setExpandedAxisIds(new Set(axes.map((a) => a.id)));
  }, [expandAllSignal, axes]);

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

  const noOwner = t("strategicAxes.tree.noOwner", "Aucun responsable");
  const openLabel = t("strategicAxes.tree.open", "Ouvrir la fiche");
  const fmt = (key: string, fallback: string, vars: Record<string, number>) =>
    Object.entries(vars).reduce(
      (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
      t(key, fallback)
    );

  return (
    <div className="space-y-3">
      {axes.map((axis, axisIndex) => {
        const axisChantiers = chantiers.filter((c) => c.axisIds.includes(axis.id));
        // Nuance de la couleur d'axe par chantier — même calcul que l'onglet "Avancement" et les
        // Gantt (`chantierShadesForAxis`, lib/axisLogic.ts) : un chantier a la même couleur partout.
        const chantierShades = chantierShadesForAxis(axis.color, axisChantiers);
        const axisOpen = expandedAxisIds.has(axis.id);
        return (
          <div key={axis.id} className="overflow-hidden rounded-lg border border-border bg-white">
            <TreeRow
              level="axis"
              open={axisOpen}
              onToggle={() => toggleAxis(axis.id)}
              onOpen={onAxisClick ? () => onAxisClick(axis.id) : undefined}
              indentClass="pl-5"
              openLabel={openLabel}
              dot={
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: axis.color ?? "var(--bp-warm-taupe)" }}
                />
              }
              name={t("strategicAxes.axisNumberPrefix", "Axe {n} : {name}")
                .replace("{n}", String(axisIndex + 1))
                .replace("{name}", axis.name)}
              owner={axis.owner ?? noOwner}
              count={fmt("strategicAxes.tree.chantiersN", "{n} chantier(s)", {
                n: axisChantiers.length,
              })}
              pct={axisProgressPct(axis.id, chantiers, chantierActions, progressOf)}
            />

            {axisOpen && (
              <div className="divide-y divide-border border-t border-border">
                {axisChantiers.length === 0 ? (
                  <p className="px-5 py-4 text-center text-[13px] text-tertiary">
                    {t("strategicAxes.axisNoChantier")}
                  </p>
                ) : (
                  axisChantiers.map((chantier) => {
                    const chantierKey = `${axis.id}:${chantier.id}`;
                    const chantierOpen = expandedChantierKeys.has(chantierKey);
                    const projets = chantierActions.filter((a) => a.chantierId === chantier.id);
                    return (
                      <div key={chantierKey}>
                        <TreeRow
                          level="chantier"
                          open={chantierOpen}
                          onToggle={() => toggleChantier(chantierKey)}
                          onOpen={() => onProjetClick(chantier.id)}
                          indentClass="pl-10"
                          openLabel={openLabel}
                          dot={
                            <span
                              aria-hidden
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{
                                backgroundColor:
                                  chantierShades.get(chantier.id) ?? AXIS_FALLBACK_COLOR,
                              }}
                            />
                          }
                          name={chantier.name}
                          owner={chantier.pilote ?? mostFrequentOwner(projets) ?? noOwner}
                          count={fmt("strategicAxes.tree.projetsN", "{n} projet(s)", {
                            n: projets.length,
                          })}
                          pct={chantierDeclaredProgress(chantier.id, chantierActions, progressOf)}
                        />

                        {chantierOpen && (
                          <div className="space-y-2.5 bg-neutral-50/70 py-4 pl-[4.5rem] pr-5">
                            {projets.length === 0 ? (
                              <p className="py-2 text-[13px] text-tertiary">
                                {t("strategicAxes.chantierNoProjet")}
                              </p>
                            ) : (
                              projets.map((action) => {
                                const projetClickable =
                                  clickableActionIds === "all" || clickableActionIds.has(action.id);
                                const { passed, total } = projetMilestoneCounts(action);
                                return (
                                  <div
                                    key={action.id}
                                    className="overflow-hidden rounded-md border border-border bg-white shadow-sm"
                                  >
                                    <TreeRow
                                      level="projet"
                                      onOpen={
                                        projetClickable
                                          ? () => onProjetClick(chantier.id, action.id)
                                          : undefined
                                      }
                                      indentClass="pl-4"
                                      openLabel={openLabel}
                                      dot={<span className="hidden" />}
                                      name={action.name}
                                      owner={action.owner ?? noOwner}
                                      count={fmt(
                                        "strategicAxes.tree.milestonesN",
                                        "{p}/{t} jalons",
                                        {
                                          p: passed,
                                          t: total,
                                        }
                                      )}
                                      pct={progressOf(action)}
                                    />
                                    {action.deliverables && action.deliverables.length > 0 && (
                                      <span className="flex flex-wrap items-center gap-2 pb-3.5 pl-[46px] pr-5">
                                        {action.deliverables.map((deliverable) => (
                                          <button
                                            key={deliverable.id}
                                            type="button"
                                            disabled={!projetClickable}
                                            onClick={
                                              projetClickable
                                                ? () =>
                                                    onDeliverableClick(
                                                      chantier.id,
                                                      action.id,
                                                      deliverable.id
                                                    )
                                                : undefined
                                            }
                                            title={deliverableTooltip(
                                              deliverable.label,
                                              effectiveDueDate(deliverable),
                                              deliverableState(deliverable),
                                              deliverableLateDays(deliverable)
                                            )}
                                            className={`inline-flex max-w-[18rem] items-center gap-2 rounded-full border border-border bg-neutral-50 px-3 py-1 text-[12px] font-medium text-secondary transition focus:outline-none ${
                                              projetClickable
                                                ? "hover:border-black hover:bg-white focus:ring-2 focus:ring-black"
                                                : ""
                                            }`}
                                          >
                                            <DeliverableDiamond
                                              state={deliverableState(deliverable)}
                                              size={8}
                                            />
                                            <span className="truncate">{deliverable.label}</span>
                                          </button>
                                        ))}
                                      </span>
                                    )}
                                  </div>
                                );
                              })
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
