"use client";

import type { HierarchyLevelDef, HierarchyNode, Workstream } from "@/types";
import type { DrilldownEntry } from "@/lib/savingsDrilldown";
import { ScurveGapDrilldown } from "./ScurveGapDrilldown";

/** Détail de la trajectoire (contenu de la pop-up ouverte au clic sur la courbe en S) :
 *  origine de l'écart réactualisé − réalisé (filtre chantier / géographie). */
export function SCurveDetail({
  gap,
}: {
  gap: {
    month: string;
    entries: DrilldownEntry[];
    workstreams: Pick<Workstream, "id" | "name">[];
    geographyLevels: HierarchyLevelDef[];
    geographyNodes: HierarchyNode[];
  };
}) {
  return <ScurveGapDrilldown {...gap} />;
}
