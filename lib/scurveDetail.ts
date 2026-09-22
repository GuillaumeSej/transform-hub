import * as engine from "@/lib/engine";
import type { DrilldownEntry } from "@/lib/savingsDrilldown";
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

/** Détail de l'écart RÉALISÉ − PLANIFIÉ INITIAL à une période, par levier (signe positif = gain,
 *  négatif = perte). `savingsSeries` est rejoué sur chaque levier isolé (mêmes règles que la courbe
 *  globale ; l'écart étant additif, la somme des leviers = `gap.total` de la courbe). Champs de
 *  `DrilldownEntry` réutilisés pour partager le regroupement chantier / géographie : before =
 *  planifié initial cumulé, after = réalisé cumulé, reforecast = réactualisé cumulé, value = écart
 *  total, realized = écart de retard (réalisé − réactualisé, leviers réellement en retard
 *  uniquement), remaining = écart de performance (réactualisé − planifié initial). */
export function gapEntriesAt(
  data: BeTrackData,
  granularity: engine.TimeGranularity,
  month: string,
  today: Date = new Date()
): DrilldownEntry[] {
  const out: DrilldownEntry[] = [];
  for (const l of data.levers) {
    if (l.status === "cancelled") continue;
    const p = engine
      .savingsSeries({ ...data, levers: [l] }, granularity, today)
      .find((x) => x.month === month);
    if (!p || p.actual === null) continue;
    if (p.gap.total === 0 && p.planned === 0 && p.actual === 0) continue;
    out.push({
      leverId: l.id,
      name: l.name,
      wsId: l.ws,
      geographyLeafId: l.geographyLeafId,
      geography: l.geography,
      before: p.planned,
      after: p.actual,
      reforecast: p.reforecast,
      value: p.gap.total,
      realized: p.gap.delay,
      remaining: p.gap.adjustment,
      segments: [],
    });
  }
  return out;
}
