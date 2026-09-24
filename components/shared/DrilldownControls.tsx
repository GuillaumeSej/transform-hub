"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { DrilldownDimension } from "@/lib/savingsDrilldown";
import type { HierarchyLevelDef, HierarchyNode } from "@/types";
import { SegmentedControl } from "@/components/shared/SegmentedControl";

/** État + contrôles communs des pop-ups de détail (Cascade des économies, écart de la trajectoire) :
 *  bascule Chantier / Géographie et sélecteur de niveau de l'arborescence géographique. */
export function useDrilldownDimension(
  geographyLevels: HierarchyLevelDef[],
  geographyNodes: HierarchyNode[]
) {
  const { t } = useTranslation();
  const sortedLevels = useMemo(
    () => [...geographyLevels].sort((a, b) => a.order - b.order),
    [geographyLevels]
  );
  const hasTree = sortedLevels.length > 0 && geographyNodes.length > 0;
  const [dimension, setDimension] = useState<DrilldownDimension>("workstream");
  const [levelKey, setLevelKey] = useState<string>(sortedLevels[0]?.key ?? "");
  const dimLabel =
    dimension === "workstream"
      ? t("chart.waterfall.drill.workstream", "Chantier")
      : (sortedLevels.find((l) => l.key === levelKey)?.label ??
        t("chart.waterfall.drill.geography", "Géographie"));
  return { sortedLevels, hasTree, dimension, setDimension, levelKey, setLevelKey, dimLabel };
}

export function DrilldownDimensionControls({
  dimension,
  setDimension,
  levelKey,
  setLevelKey,
  sortedLevels,
  hasTree,
}: ReturnType<typeof useDrilldownDimension>) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <SegmentedControl
        label={t("common.segmented.view", "Affichage")}
        showLabel={false}
        options={[
          {
            value: "workstream" as const,
            label: t("chart.waterfall.drill.workstream", "Chantier"),
          },
          {
            value: "geography" as const,
            label: t("chart.waterfall.drill.geography", "Géographie"),
          },
        ]}
        value={dimension}
        onChange={setDimension}
      />
      {dimension === "geography" && hasTree && (
        <label className="inline-flex items-center gap-2 text-xs text-secondary">
          {t("chart.waterfall.drill.level", "Niveau")}
          <select
            value={levelKey}
            onChange={(e) => setLevelKey(e.target.value)}
            className="rounded-md border border-border bg-white px-2 py-1.5 text-xs"
          >
            {sortedLevels.map((lv) => (
              <option key={lv.key} value={lv.key}>
                {lv.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
