"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  DrilldownDimensionControls,
  useDrilldownDimension,
} from "@/components/shared/DrilldownControls";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  drilldownTotals,
  groupEntries,
  type DrilldownEntry,
  type DrilldownGroup,
} from "@/lib/savingsDrilldown";
import type { HierarchyLevelDef, HierarchyNode, Workstream } from "@/types";

const fmt = (v: number) => `€${Math.round(v * 10) / 10}M`;

/** Formatte un écart signé (+/−) avec sa couleur (vert = gain, rouge = perte), cohérent avec le
 *  reste de l'app (`text-rag-green-dark` / `text-rag-red`). */
const fmtSigned = (v: number) => {
  const r = Math.round(v * 10) / 10;
  const sign = r > 0 ? "+" : r < 0 ? "−" : "";
  const abs = Math.abs(r);
  const cls = r > 0 ? "text-rag-green-dark" : r < 0 ? "text-rag-red" : "text-tertiary";
  return { text: `${sign}€${abs}M`, cls };
};

/** Détail de l'écart réalisé − planifié initial à une période (signé : positif = gain, négatif =
 *  perte), regroupé par chantier ou par niveau géographique (mêmes contrôles et même regroupement
 *  que le détail de la Cascade des économies). Entrées produites par `gapEntriesAt`
 *  (lib/scurveDetail.ts). */
export function ScurveGapDrilldown({
  month,
  entries,
  workstreams,
  geographyLevels,
  geographyNodes,
}: {
  month: string;
  entries: DrilldownEntry[];
  workstreams: Pick<Workstream, "id" | "name">[];
  geographyLevels: HierarchyLevelDef[];
  geographyNodes: HierarchyNode[];
}) {
  const { t } = useTranslation();
  const dimState = useDrilldownDimension(geographyLevels, geographyNodes);
  const { sortedLevels, dimension, levelKey, dimLabel } = dimState;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const groups = useMemo(
    () =>
      groupEntries(entries, dimension, {
        workstreams,
        geographyLevels: sortedLevels,
        geographyNodes,
        geographyLevelKey: levelKey,
        unattributedLabel: t("chart.waterfall.drill.unattributed", "Non attribué"),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, dimension, workstreams, sortedLevels, geographyNodes, levelKey]
  );
  const totals = drilldownTotals(groups);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const cells = (v: {
    before: number;
    after: number;
    realized: number;
    remaining: number;
    reforecast?: number;
  }) => {
    // `realized` = écart de retard (réalisé − réactualisé, leviers réellement en retard
    // uniquement) et `remaining` = écart de performance (réactualisé − planifié initial) sont déjà
    // produits par `gapEntriesAt` (lib/scurveDetail.ts) dans la convention "positif = gain, négatif
    // = perte" — pas de signe à inverser ici.
    const delay = fmtSigned(v.realized);
    const perf = fmtSigned(v.remaining);
    return (
      <>
        <td className="px-2 text-right tabular-nums">{fmt(v.before)}</td>
        <td className="px-2 text-right tabular-nums">{fmt(v.reforecast ?? 0)}</td>
        <td className="px-2 text-right tabular-nums">{fmt(v.after)}</td>
        <td className={`px-2 text-right tabular-nums ${delay.cls}`}>{delay.text}</td>
        <td className={`pl-2 text-right tabular-nums ${perf.cls}`}>{perf.text}</td>
      </>
    );
  };

  const renderRow = (g: DrilldownGroup) => {
    const open = expanded.has(g.id);
    return (
      <Fragment key={g.id}>
        <tr
          className="cursor-pointer border-t border-border hover:bg-neutral-50"
          onClick={() => toggle(g.id)}
        >
          <td className="py-2 pr-2">
            <span className="inline-flex items-center gap-1 font-medium text-primary">
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {g.label}
              <span className="text-[11px] font-normal text-tertiary">({g.entries.length})</span>
            </span>
          </td>
          {cells(g)}
        </tr>
        {open &&
          g.entries.map((e) => (
            <tr
              key={`${g.id}-${e.leverId}`}
              className="bg-neutral-50/60 text-[12px] text-secondary"
            >
              <td className="py-1 pl-6 pr-2">{e.name}</td>
              {cells(e)}
            </tr>
          ))}
      </Fragment>
    );
  };

  return (
    <section>
      <h3 className="mb-3 text-sm font-bold text-primary">
        {t("chart.gapDrill.title", "Origine de l'écart planifié initial − réalisé")} · {month}
      </h3>
      <DrilldownDimensionControls {...dimState} />
      {groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-tertiary">
          {t("chart.gapDrill.empty", "Aucun écart à cette période.")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-tertiary">
                <th className="pb-2 font-medium">{dimLabel}</th>
                <th
                  className="px-2 text-right font-medium"
                  title={t(
                    "chart.gapDrill.plannedInitial.tooltip",
                    "Plan figé du levier (ou valeur courante si pas encore figé), cumulé à sa date de fin."
                  )}
                >
                  {t("chart.gapDrill.plannedInitial", "Planifié initial")}
                </th>
                <th
                  className="px-2 text-right font-medium"
                  title={t(
                    "chart.gapDrill.reforecast.tooltip",
                    "Cible réactualisée du levier (reforecast, ou plan figé, ou valeur courante), cumulée à sa date de fin."
                  )}
                >
                  {t("chart.gapDrill.reforecast", "Réactualisé")}
                </th>
                <th
                  className="px-2 text-right font-medium"
                  title={t(
                    "chart.gapDrill.actual.tooltip",
                    "Montant effectivement réalisé à date."
                  )}
                >
                  {t("chart.scurve.actual", "Réalisé")}
                </th>
                <th
                  className="px-2 text-right font-medium"
                  title={t(
                    "chart.gapDrill.delay.tooltip",
                    "Réalisé − réactualisé, uniquement pour les leviers ayant au moins un impact non réalisé dont la date est dépassée (retard d'exécution réel, pas juste un plan d'action en retard)."
                  )}
                >
                  {t("chart.gapDrill.delay", "Écart de retard")}
                </th>
                <th
                  className="pl-2 text-right font-medium"
                  title={t(
                    "chart.gapDrill.adjustment.tooltip",
                    "Réactualisé − planifié initial (effet du réajustement du plan lui-même : positif si la cible a été relevée, négatif si elle a été abaissée)."
                  )}
                >
                  {t("chart.gapDrill.adjustment", "Écart de performance")}
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => renderRow(g))}
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2">{t("chart.waterfall.drill.total", "Total")}</td>
                {cells(totals)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
