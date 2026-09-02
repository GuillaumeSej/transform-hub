"use client";

import { useMemo } from "react";
import { Tooltip } from "@/components/shared/Tooltip";
import { chantierBounds } from "@/lib/axisLogic";
import { parseISO } from "@/lib/dateUtils";
import { resolveMaturityStageLabel } from "@/lib/hooks/useMaturityStages";
import type { Chantier, ChantierAction, MaturityStageConfig } from "@/types";

/**
 * Gantt simplifié d'un axe stratégique : UN BLOC = UN CHANTIER, borné par la première et la
 * dernière action du chantier (`axisLogic.chantierBounds`), avec les actions individuelles
 * rendues en sous-barres fines à l'intérieur de la même ligne (les « deux mailles de lecture »
 * demandées : macro pour la vue exécutive, fine au survol/clic).
 *
 * CLONE ALLÉGÉ de `components/shared/charts/ActionGantt.tsx`, volontairement PAS une
 * généricisation de celui-ci (même convention que `StageBadge` → `AxisStageBadge`) : le Gantt
 * levier est entièrement structuré par la dimension financière (couleur = gain/coût net, montant
 * affiché en bout de barre, marqueurs de milestone CAPEX et de date d'encaissement des gains),
 * dimension qui n'existe PAS au niveau chantier/action stratégique. Il ne reste, une fois cette
 * dimension retirée, que le squelette temporel — d'où un composant neuf plutôt qu'un composant
 * commun criblé d'options.
 *
 * Aucune donnée n'est chargée ni écrite ici : les clics remontent à l'appelant
 * (`AxisDetailClient`), qui ouvre la même pop-up de détail de chantier dans les deux cas (clic sur
 * le bloc chantier OU sur une action).
 */

export type ChantierGanttLabels = {
  /** Aucun chantier du tout sur l'axe. */
  empty?: string;
  /** Titre du bloc listant les chantiers sans action (donc sans bornes exploitables). */
  unplannedTitle?: string;
  noDates?: string;
  actionsSuffix?: string;
};

type Row = {
  chantier: Chantier;
  bounds: { start: string; end: string } | undefined;
  items: ChantierAction[];
};

type PlannedRow = Row & { bounds: { start: string; end: string } };

const ROW_LABEL_WIDTH = "w-40";

export function ChantierGantt({
  chantiers,
  actions,
  stages,
  onChantierClick,
  onActionClick,
  alertedChantierIds,
  labels,
}: {
  chantiers: Chantier[];
  /** Toutes les actions du programme — filtrées par chantier ici (les bornes d'un chantier ne
   *  sont pas stockées, elles se dérivent de ses actions). */
  actions: ChantierAction[];
  /** Référentiel d'étapes du programme, pour afficher le libellé d'étape sous le nom du chantier. */
  stages: MaturityStageConfig[];
  onChantierClick?: (chantier: Chantier) => void;
  /** Clic sur une action : l'appelant ouvre la MÊME pop-up que pour son chantier, focalisée sur
   *  l'action cliquée. */
  onActionClick?: (action: ChantierAction, chantier: Chantier) => void;
  /** Chantiers concernés par une alerte de cascade de dépendance — soulignés dans le Gantt pour
   *  que l'alerte affichée au-dessus soit localisable visuellement. */
  alertedChantierIds?: Set<string>;
  labels?: ChantierGanttLabels;
}) {
  const l = {
    empty: labels?.empty ?? "Aucun chantier sur cet axe.",
    unplannedTitle: labels?.unplannedTitle ?? "Chantiers sans action planifiée",
    noDates: labels?.noDates ?? "Pas encore de date — ajoutez une action",
    actionsSuffix: labels?.actionsSuffix ?? "actions",
  };

  const rows = useMemo<Row[]>(
    () =>
      chantiers.map((chantier) => ({
        chantier,
        bounds: chantierBounds(chantier.id, actions),
        items: actions
          .filter((a) => a.chantierId === chantier.id)
          .sort((a, b) => a.start.localeCompare(b.start)),
      })),
    [chantiers, actions]
  );

  const planned = rows.filter((r): r is PlannedRow => r.bounds !== undefined);
  const unplanned = rows.filter((r) => r.bounds === undefined);

  // Échelle temporelle commune à toutes les lignes — calculée sur les bornes des chantiers, pas
  // sur celles des actions : une action ne peut pas sortir des bornes de son propre chantier.
  const { minTime, range } = useMemo(() => {
    const times = planned.flatMap((r) => [parseISO(r.bounds.start), parseISO(r.bounds.end)]);
    if (times.length === 0) return { minTime: 0, range: 1 };
    const min = Math.min(...times);
    const max = Math.max(...times);
    return { minTime: min, range: max - min || 1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const pctOf = (iso: string) => ((parseISO(iso) - minTime) / range) * 100;

  const monthLabels = useMemo(() => {
    if (planned.length === 0) return [] as { label: string; pct: number }[];
    const start = new Date(minTime);
    const end = new Date(minTime + range);
    const out: { label: string; pct: number }[] = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      const pct = ((cur.getTime() - minTime) / range) * 100;
      out.push({
        label: cur.toLocaleString("default", { month: "short" }),
        pct: Math.max(0, Math.min(100, pct)),
      });
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minTime, range, planned.length]);

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-tertiary">{l.empty}</p>;
  }

  const openChantier = (chantier: Chantier) => onChantierClick?.(chantier);

  return (
    <div className="w-full">
      {planned.length > 0 && (
        <div className="overflow-x-auto">
          <div className="min-w-[420px]">
            {planned.map(({ chantier, bounds, items }) => {
              const startPct = pctOf(bounds.start);
              const widthPct = Math.max(1.5, pctOf(bounds.end) - startPct);
              const isAlerted = alertedChantierIds?.has(chantier.id) ?? false;
              return (
                <div
                  key={chantier.id}
                  className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0"
                >
                  <div className={`${ROW_LABEL_WIDTH} shrink-0`}>
                    <div className="truncate text-[11.5px] font-semibold text-primary">
                      {chantier.name}
                    </div>
                    <div className="truncate text-[10px] text-tertiary">
                      {resolveMaturityStageLabel(chantier.stage, stages)} · {items.length}{" "}
                      {l.actionsSuffix}
                    </div>
                  </div>

                  <div className="relative h-9 flex-1">
                    {/* Repères de mois */}
                    {monthLabels.map((m, i) => (
                      <div
                        key={i}
                        className="absolute inset-y-0 border-l border-border"
                        style={{ left: `${m.pct}%` }}
                      />
                    ))}

                    {/* Bloc macro du chantier (maille exécutive) */}
                    <Tooltip
                      text={`${chantier.name} · ${bounds.start} → ${bounds.end}`}
                      className="absolute"
                      style={{ left: `${startPct}%`, width: `${widthPct}%`, top: 2 }}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={chantier.name}
                        onClick={() => openChantier(chantier)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openChantier(chantier);
                          }
                        }}
                        className={`h-4 w-full cursor-pointer rounded-sm transition hover:ring-2 hover:ring-bp-coral/40 ${
                          isAlerted
                            ? "bg-rag-amber/70 ring-1 ring-rag-amber"
                            : "bg-bp-warm-taupe/60"
                        }`}
                      />
                    </Tooltip>

                    {/* Actions individuelles (maille fine) — même pop-up au clic */}
                    {items.map((action) => {
                      const aStart = pctOf(action.start);
                      const aWidth = Math.max(1, pctOf(action.end) - aStart);
                      return (
                        <Tooltip
                          key={action.id}
                          text={`${action.name} · ${action.start} → ${action.end}${
                            action.owner ? ` · ${action.owner}` : ""
                          }`}
                          className="absolute"
                          style={{ left: `${aStart}%`, width: `${aWidth}%`, top: 24 }}
                        >
                          <div
                            role="button"
                            tabIndex={0}
                            aria-label={action.name}
                            onClick={() => onActionClick?.(action, chantier)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onActionClick?.(action, chantier);
                              }
                            }}
                            className="h-2 w-full cursor-pointer rounded-sm bg-bp-coral/80 transition hover:bg-bp-coral"
                          />
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Axe temporel (mois) */}
            <div className="flex items-start gap-2 pt-1">
              <div className={`${ROW_LABEL_WIDTH} shrink-0`} />
              <div className="relative h-4 flex-1">
                {monthLabels.map((m, i) => (
                  <span
                    key={i}
                    className="absolute text-[9px] text-tertiary"
                    style={{ left: `${m.pct}%` }}
                  >
                    {m.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {unplanned.length > 0 && (
        <div className={planned.length > 0 ? "mt-4 border-t border-border pt-3" : ""}>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
            {l.unplannedTitle}
          </div>
          <div className="flex flex-wrap gap-2">
            {unplanned.map(({ chantier }) => (
              <button
                key={chantier.id}
                onClick={() => openChantier(chantier)}
                className="rounded-md border border-dashed border-border bg-neutral-50 px-3 py-2 text-left transition hover:border-black"
              >
                <div className="text-[11.5px] font-semibold text-primary">{chantier.name}</div>
                <div className="text-[10px] text-tertiary">{l.noDates}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
