"use client";

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtCurr, isActionLate } from "@/lib/engine";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { ActionStatus, LeverAction } from "@/types";

function getColumns(
  t: (key: string, fallback?: string) => string
): { status: ActionStatus; label: string }[] {
  return [
    { status: "todo", label: t("leverDetail.todo", "À faire") },
    { status: "in_progress", label: t("leverDetail.inProgress", "En cours") },
    { status: "done", label: t("leverDetail.completed", "Fait") },
    { status: "delayed", label: t("leverDetail.late", "En retard") },
  ];
}

/** Répartit les actions par colonne — la colonne "En retard" agrège désormais TOUTE action en
 * retard au sens de `isActionLate` (date de fin dépassée sans être "done", ou statut "delayed"
 * explicitement posé), pas seulement celles au statut manuel "delayed". Une action "todo"/
 * "in_progress" dont la date est dépassée apparaît donc dans "En retard" plutôt que dans sa
 * colonne de statut d'origine — c'est le comportement voulu : le Kanban doit refléter le retard
 * réel, pas seulement le flag manuel. */
function columnActions(actions: LeverAction[], status: ActionStatus): LeverAction[] {
  if (status === "delayed") return actions.filter((a) => isActionLate(a));
  if (status === "done") return actions.filter((a) => a.status === "done");
  return actions.filter((a) => a.status === status && !isActionLate(a));
}

/** Kanban du plan d'action — même langage visuel que components/shared/Kanban.tsx, changement de
 * statut via un petit groupe de boutons sur la carte (pas de drag-and-drop, garde le composant
 * simple et sans nouvelle dépendance). */
export function ActionKanban({
  actions,
  onStatusChange,
  onCardClick,
  hasBlockingDependency,
}: {
  actions: LeverAction[];
  onStatusChange: (actionId: string, status: ActionStatus) => void;
  onCardClick: (action: LeverAction) => void;
  /** Le levier porte au moins une dépendance déclarée (Lever.dependencies) actuellement violée
   *  (voir engine.dependencyAlerts) — la dépendance est portée par le LEVIER, pas par l'action,
   *  donc affichée une seule fois en en-tête plutôt que par carte. */
  hasBlockingDependency?: boolean;
}) {
  const { t } = useTranslation();
  const COLUMNS = getColumns(t);
  return (
    <div>
      {hasBlockingDependency && (
        <div className="mb-3 flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">
          <Lock size={12} className="shrink-0" aria-hidden />
          {t("shared.actionKanban.blockingDependency", "Dépendance bloquante sur ce levier")}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 min-[901px]:grid-cols-4">
        {COLUMNS.map((col) => {
          const list = columnActions(actions, col.status);
          return (
            <div
              key={col.status}
              className="min-h-[160px] rounded-lg border border-border bg-neutral-50 p-2.5"
            >
              <div className="flex items-center justify-between px-2 pb-2.5 pt-1">
                <div className="text-[11.5px] font-bold uppercase tracking-wide text-primary">
                  {col.label}
                </div>
                <div className="rounded-full border border-border bg-white px-1.5 py-px text-[10px] font-semibold text-secondary">
                  {list.length}
                </div>
              </div>
              {list.length === 0 && (
                <div className="py-5 text-center text-[11px] text-tertiary">
                  {t("shared.actionKanban.noItems", "Aucune action")}
                </div>
              )}
              {list.map((a) => {
                const autoLate = a.status !== "delayed" && isActionLate(a);
                return (
                  <div key={a.id} className="mb-2 rounded-sm border border-border bg-white p-2.5">
                    <button
                      onClick={() => onCardClick(a)}
                      className="mb-1.5 flex w-full items-start gap-1 text-left text-xs font-semibold text-primary hover:text-primary hover:underline"
                    >
                      <span className="min-w-0 flex-1">{a.name}</span>
                      {autoLate && (
                        <span
                          className="mt-px inline-flex shrink-0 items-center gap-0.5 rounded-full bg-rag-red/10 px-1.5 py-px text-[9px] font-bold uppercase text-rag-red no-underline"
                          title={t("shared.actionKanban.overdue", "Date de fin dépassée")}
                        >
                          {t("leverDetail.late", "En retard")}
                        </span>
                      )}
                    </button>
                    <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10.5px] text-tertiary">
                      <span>
                        {a.start} → {a.end}
                      </span>
                      <span className="font-semibold text-secondary">
                        {fmtCurr(a.cost / 1000, 0)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {COLUMNS.map((c) => (
                        <button
                          key={c.status}
                          onClick={() => onStatusChange(a.id, c.status)}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[9.5px] font-semibold transition",
                            a.status === c.status
                              ? "border-bp-coral bg-black text-white"
                              : "border-border bg-white text-secondary hover:border-black"
                          )}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
