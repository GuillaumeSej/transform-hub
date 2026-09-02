"use client";

import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { LeversPagePerformance } from "./LeversPagePerformance";
import { StrategicAxesView } from "@/components/strategic/StrategicAxesView";

/** Routeur de la route `/levers` : même URL et même item de nav pour les deux types de plan (la
 *  nav se contente de relabeler « Axes stratégiques », voir lib/nav-config.ts), mais deux pages
 *  distinctes derrière — la page Performance historique est inchangée dans
 *  `LeversPagePerformance.tsx`. */
export default function LeversPage() {
  const { programType } = useActiveProgram();
  return programType === "strategic" ? <StrategicAxesView /> : <LeversPagePerformance />;
}
