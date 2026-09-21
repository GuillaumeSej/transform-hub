import * as engine from "@/lib/engine";
import type { BeTrackData } from "@/types";

export type WorkstreamSeries = {
  wsId: string;
  name: string;
  /** Réalisé incrémental de chaque période (source : `savingsSeries.actualDelta`). */
  actualDelta: number[];
  /** Réactualisé cumulé de chaque période. */
  reforecast: number[];
  planned: number[];
};

/** Séries de trajectoire par chantier : `savingsSeries` rejoué sur les seuls leviers du chantier
 *  (mêmes règles que la courbe globale, donc la somme des chantiers = la courbe globale). */
export function savingsSeriesByWorkstream(
  data: BeTrackData,
  workstreams: { id: string; name: string }[],
  granularity: engine.TimeGranularity,
  today: Date = new Date(),
  /** Restreint aux périodes listées (ex. plage de dates du widget). */
  months?: string[]
): WorkstreamSeries[] {
  return workstreams
    .map((ws) => {
      const sub = { ...data, levers: data.levers.filter((l) => l.ws === ws.id) };
      const series = engine
        .savingsSeries(sub, granularity, today)
        .filter((p) => !months || months.includes(p.month));
      return {
        wsId: ws.id,
        name: ws.name,
        actualDelta: series.map((p) => p.actualDelta),
        reforecast: series.map((p) => p.reforecast),
        planned: series.map((p) => p.planned),
      };
    })
    .filter((s) => s.planned.some((v) => v !== 0) || s.actualDelta.some((v) => v !== 0));
}
