"use client";

import type { LeverAction, RecognitionMode } from "@/types";
import { Tooltip } from "@/components/shared/Tooltip";

const STATUS_FILL: Record<string, string> = {
  done: "opacity-100",
  in_progress: "opacity-70",
  todo: "opacity-30",
  delayed: "opacity-50",
};

/** Montant net d'une action (savings − coûts) depuis ses impacts. */
function actionNet(action: LeverAction): number {
  let net = 0;
  for (const imp of action.impacts ?? []) {
    net += imp.type === "saving" ? imp.amount : -imp.amount;
  }
  return Math.round(net * 100) / 100;
}

/** Mini-Gantt des actions d'un levier — barres horizontales positionnées dans le temps,
 *  colorées vert (gain net) ou rouge (coût net), avec remplissage selon le statut. Affiche en
 *  plus, par ligne d'impact : un marqueur losange pour le milestone CAPEX (date d'engagement à
 *  100%) et un marqueur/bande pour le gain (bande depuis le début de l'action si lissé, marqueur
 *  ponctuel à la date d'encaissement si one-shot). Clic sur une barre → ouvre la fiche action
 *  (via onActionClick). */
export function ActionGantt({
  actions,
  height,
  onActionClick,
  defaultRecognition = "smoothing",
}: {
  actions: LeverAction[];
  height?: number;
  onActionClick?: (action: LeverAction) => void;
  /** Mode de reconnaissance par défaut de l'entreprise (Company.defaultRecognition), utilisé pour
   * les lignes d'impact qui ne surchargent pas explicitement `recognition`. */
  defaultRecognition?: RecognitionMode;
}) {
  if (actions.length === 0) {
    return <p className="py-6 text-center text-sm text-tertiary">Aucune action définie.</p>;
  }

  // Calculer l'intervalle temporel global — inclut les dates de milestone CAPEX/gain pour que les
  // marqueurs qui tombent hors de la plage start/end des actions restent visibles.
  const allDates = actions.flatMap((a) => [
    new Date(a.start).getTime(),
    new Date(a.end).getTime(),
    ...(a.impacts ?? []).flatMap((i) =>
      [i.capexDeploymentDate, i.gainDate]
        .filter(Boolean)
        .map((d) => new Date(d as string).getTime())
    ),
  ]);
  const minTime = Math.min(...allDates);
  const maxTime = Math.max(...allDates);
  const range = maxTime - minTime || 1;
  const pctOf = (iso: string) => ((new Date(iso).getTime() - minTime) / range) * 100;

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
      <div className="relative w-full" style={{ height: totalHeight, minWidth: 400 }}>
        {/* Lignes verticales (mois) */}
        {monthLabels.map((m, i) => (
          <div
            key={i}
            className="absolute top-0 border-l border-border"
            style={{ left: `${m.pct}%`, height: totalHeight - axisHeight }}
          />
        ))}

        {/* Barres des actions */}
        {actions.map((action, idx) => {
          const startPct = ((new Date(action.start).getTime() - minTime) / range) * 100;
          const endPct = ((new Date(action.end).getTime() - minTime) / range) * 100;
          const widthPct = Math.max(2, endPct - startPct);
          const net = actionNet(action);
          const isGain = net >= 0;
          const bgColor = isGain ? "bg-rag-green" : "bg-bp-coral";
          const statusClass = STATUS_FILL[action.status] ?? "opacity-50";
          const fmtAmount =
            Math.abs(net) >= 1 ? `€${net.toFixed(1)}M` : `€${Math.round(net * 1000)}K`;
          const statusLabels: Record<string, string> = {
            done: "Terminé",
            in_progress: "En cours",
            todo: "À faire",
            delayed: "En retard",
          };

          return (
            <div
              key={action.id}
              className="absolute flex items-center"
              style={{ top: idx * rowHeight + 4, left: 0, right: 0, height: rowHeight - 8 }}
            >
              {/* Label gauche */}
              <div
                className="absolute truncate text-[10px] font-medium text-secondary"
                style={{
                  left: 0,
                  width: `${Math.max(0, startPct - 1)}%`,
                  textAlign: "right",
                  paddingRight: 6,
                }}
              >
                {action.name}
              </div>

              {/* Barre — cliquable si onActionClick est fourni */}
              <Tooltip
                text={`${action.name} · ${statusLabels[action.status] ?? action.status} · ${fmtAmount}`}
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
                  className={`h-5 w-full rounded-sm ${bgColor} ${statusClass} transition-all ${
                    onActionClick
                      ? "cursor-pointer ring-offset-1 hover:ring-2 hover:ring-bp-coral/40"
                      : ""
                  }`}
                />
              </Tooltip>

              {/* Montant droite */}
              <div
                className={`absolute text-[10px] font-bold ${isGain ? "text-rag-green-dark" : "text-bp-coral"}`}
                style={{ left: `${Math.min(98, startPct + widthPct + 0.5)}%` }}
              >
                {fmtAmount}
              </div>

              {/* Milestones CAPEX / gain par ligne d'impact */}
              {(action.impacts ?? []).map((impact) => {
                const mode = impact.recognition ?? defaultRecognition;
                return (
                  <span key={impact.id}>
                    {impact.capexDeploymentDate && (
                      <Tooltip
                        text={`CAPEX ${impact.amount}€M engagé au ${impact.capexDeploymentDate}`}
                        className="absolute"
                        style={{ left: `${pctOf(impact.capexDeploymentDate)}%`, top: "50%" }}
                      >
                        <span className="block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-white bg-info-blue" />
                      </Tooltip>
                    )}
                    {impact.gainDate &&
                      (mode === "one_shot" ? (
                        <Tooltip
                          text={`Gain ${impact.amount}€M encaissé (one-shot) au ${impact.gainDate}`}
                          className="absolute"
                          style={{ left: `${pctOf(impact.gainDate)}%`, top: "50%" }}
                        >
                          <span className="block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-rag-green" />
                        </Tooltip>
                      ) : (
                        <span
                          className="absolute top-0 h-1.5 rounded-sm bg-rag-green/40"
                          style={{
                            left: `${startPct}%`,
                            width: `${Math.max(0, pctOf(impact.gainDate) - startPct)}%`,
                          }}
                          title={`Gain ${impact.amount}€M lissé jusqu'au ${impact.gainDate}`}
                        />
                      ))}
                  </span>
                );
              })}
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
      {actions.some((a) => (a.impacts ?? []).some((i) => i.capexDeploymentDate || i.gainDate)) && (
        <div className="mt-2 flex flex-wrap items-center gap-4 text-[10px] text-tertiary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rotate-45 border border-white bg-info-blue" />{" "}
            Milestone CAPEX
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-rag-green" /> Gain encaissé
            (one-shot)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-rag-green/40" /> Gain lissé
          </span>
        </div>
      )}
    </div>
  );
}
