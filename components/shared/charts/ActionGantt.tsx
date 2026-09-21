"use client";

import type { LeverAction } from "@/types";
import { Tooltip } from "@/components/shared/Tooltip";
import { actionProgressPct } from "@/lib/engine";
import { useTranslation } from "@/lib/i18n/useTranslation";

const STATUS_COLOR: Record<string, string> = {
  done: "bg-rag-green",
  in_progress: "bg-info-blue",
  todo: "bg-neutral-400",
  delayed: "bg-bp-coral",
};

/** Mini-Gantt des actions d'un levier — barres horizontales positionnées dans le temps,
 *  colorées selon le statut, avec l'avancement (%) à droite de la barre. Clic sur une barre →
 *  ouvre la fiche action (via onActionClick). */
export function ActionGantt({
  actions,
  height,
  onActionClick,
}: {
  actions: LeverAction[];
  height?: number;
  onActionClick?: (action: LeverAction) => void;
}) {
  const { t } = useTranslation();

  if (actions.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-tertiary">
        {t("shared.actionGantt.noActions", "Aucune action définie.")}
      </p>
    );
  }

  const allDates = actions.flatMap((a) => [new Date(a.start).getTime(), new Date(a.end).getTime()]);
  const minTime = Math.min(...allDates);
  const maxTime = Math.max(...allDates);
  const range = maxTime - minTime || 1;

  // Marqueur "aujourd'hui" — même formule que `pctOf` ci-dessus pour rester exactement aligné sur
  // les barres. `null` si le jour courant tombe hors de la plage affichée : pas de marqueur plutôt
  // que de le dessiner hors-cadre ou d'élargir la plage pour l'y faire entrer.
  const now = Date.now();
  const todayPct = now >= minTime && now <= maxTime ? ((now - minTime) / range) * 100 : null;

  // Générer les labels de mois pour l'axe
  const startDate = new Date(minTime);
  const endDate = new Date(maxTime);
  const monthLabels: { label: string; pct: number }[] = [];
  const cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  while (cur <= endDate) {
    const pct = ((cur.getTime() - minTime) / range) * 100;
    const shortMonth = cur.toLocaleString("default", { month: "short" });
    monthLabels.push({ label: `${shortMonth}`, pct: Math.max(0, Math.min(100, pct)) });
    cur.setMonth(cur.getMonth() + 1);
  }

  const rowHeight = 32;
  const axisHeight = 20;
  const totalHeight = height ?? actions.length * rowHeight + axisHeight + 16;

  return (
    <div className="w-full overflow-x-auto" style={{ minHeight: totalHeight }}>
      <div
        className="relative w-full"
        style={{ height: totalHeight, minWidth: 640, marginRight: 200 }}
      >
        {/* Lignes verticales (mois) */}
        {monthLabels.map((m, i) => (
          <div
            key={i}
            className="absolute top-0 border-l border-border"
            style={{ left: `${m.pct}%`, height: totalHeight - axisHeight }}
          />
        ))}

        {/* Marqueur "aujourd'hui" — gris neutre en tirets (pas `bp-coral`, ni le vert/rouge gain-coût
            déjà utilisés pour la couleur des barres), masqué si hors plage affichée. Étiquette
            placée juste au-dessus de l'axe des mois pour ne pas chevaucher le libellé de la
            première action. */}
        {todayPct != null && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 z-[1] border-l border-dashed border-neutral-500/70"
              style={{ left: `${todayPct}%`, height: totalHeight - axisHeight }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm bg-neutral-700 px-1 py-0.5 text-[9px] font-semibold leading-none text-white"
              style={{ left: `${todayPct}%`, top: totalHeight - axisHeight }}
            >
              {t("shared.actionGantt.today", "Aujourd'hui")}
            </span>
          </>
        )}

        {/* Barres des actions */}
        {actions.map((action, idx) => {
          const startPct = ((new Date(action.start).getTime() - minTime) / range) * 100;
          const endPct = ((new Date(action.end).getTime() - minTime) / range) * 100;
          const widthPct = Math.max(2, endPct - startPct);
          const progress = Math.round(actionProgressPct(action));
          const bgColor = STATUS_COLOR[action.status] ?? "bg-neutral-400";
          const labelLeft = startPct >= 30;
          const statusLabels: Record<string, string> = {
            done: t("leverDetail.finished", "Terminé"),
            in_progress: t("leverDetail.inProgress", "En cours"),
            todo: t("leverDetail.todo", "À faire"),
            delayed: t("leverDetail.late", "En retard"),
          };

          return (
            <div
              key={action.id}
              className="absolute flex items-center"
              style={{ top: idx * rowHeight + 4, left: 0, right: 0, height: rowHeight - 8 }}
            >
              {/* Label : à gauche de la barre s'il y a la place (≥ 30 %), sinon à droite du pourcentage,
                  jamais tronqué (whitespace-nowrap) — nom complet aussi en tooltip. */}
              <div
                title={action.name}
                className="absolute whitespace-nowrap text-[10px] font-medium text-secondary"
                style={
                  labelLeft
                    ? { right: `${100 - startPct}%`, textAlign: "right", paddingRight: 6 }
                    : { left: `${Math.min(98, startPct + widthPct + 0.5)}%`, paddingLeft: 52 }
                }
              >
                {action.name}
              </div>

              {/* Barre — cliquable si onActionClick est fourni */}
              <Tooltip
                text={`${action.name} · ${statusLabels[action.status] ?? action.status} · ${progress}%`}
                className="absolute"
                style={{ left: `${startPct}%`, width: `${widthPct}%` }}
              >
                <div
                  role={onActionClick ? "button" : undefined}
                  tabIndex={onActionClick ? 0 : undefined}
                  onClick={() => onActionClick?.(action)}
                  onKeyDown={
                    onActionClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") onActionClick(action);
                        }
                      : undefined
                  }
                  className={`h-5 w-full rounded-sm ${bgColor} transition-all ${
                    onActionClick
                      ? "cursor-pointer ring-offset-1 hover:ring-2 hover:ring-bp-coral/40"
                      : ""
                  }`}
                />
              </Tooltip>

              {/* Avancement droite */}
              <div
                className="absolute text-[10px] font-bold text-secondary"
                style={{ left: `${Math.min(98, startPct + widthPct + 0.5)}%` }}
              >
                {progress}%
              </div>
            </div>
          );
        })}

        {/* Axe temporel (mois) */}
        <div
          className="absolute flex w-full justify-between text-[9px] text-tertiary"
          style={{ bottom: 0, height: axisHeight }}
        >
          {monthLabels.map((m, i) => (
            <span key={i} className="absolute" style={{ left: `${m.pct}%` }}>
              {m.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
