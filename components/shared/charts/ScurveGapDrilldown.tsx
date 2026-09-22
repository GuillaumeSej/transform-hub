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

/** Détail de l'écart réactualisé − réalisé à une période, regroupé par chantier ou par niveau
 *  géographique (mêmes contrôles et même regroupement que le détail de la Cascade des économies).
 *  Entrées produites par `gapEntriesAt` (lib/scurveDetail.ts). */
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
    value: number;
  }) => (
    <>
      <td className="px-2 text-right tabular-nums">{fmt(v.before)}</td>
      <td className="px-2 text-right tabular-nums">{fmt(v.after)}</td>
      <td className="px-2 text-right tabular-nums">{fmt(v.realized)}</td>
      <td className="px-2 text-right tabular-nums">{fmt(v.remaining)}</td>
      <td className="pl-2 text-right font-semibold tabular-nums">{fmt(v.value)}</td>
    </>
  );

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
      <h3 className="mb-1 text-sm font-bold text-primary">
        {t("chart.gapDrill.title", "Origine de l'écart planifié initial − réalisé")} · {month}
      </h3>
      <p className="mb-3 text-xs text-secondary">
        {t(
          "chart.gapDrill.intro",
          "Écart cumulé à cette période (planifié initial − réalisé), décomposé en écart de réajustement (planifié initial − réactualisé, sur/sous-performance) et écart de retard (réactualisé − réalisé), par chantier ou par géographie. Même règle que la courbe : la somme des lignes = l'écart affiché."
        )}
      </p>
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
                <th className="px-2 text-right font-medium">
                  {t("chart.gapDrill.plannedInitial", "Planifié initial")}
                </th>
                <th className="px-2 text-right font-medium">
                  {t("chart.scurve.actual", "Réalisé")}
                </th>
                <th className="px-2 text-right font-medium">
                  {t("chart.gapDrill.delay", "dont écart de retard")}
                </th>
                <th className="px-2 text-right font-medium">
                  {t("chart.gapDrill.adjustment", "dont écart de réajustement")}
                </th>
                <th className="pl-2 text-right font-medium">
                  {t("chart.waterfall.drill.delta", "Écart")}
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
