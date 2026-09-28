"use client";

import { Suspense } from "react";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { DashboardPagePerformance } from "./DashboardPagePerformance";
import { StrategicDashboardView } from "@/components/strategic/StrategicDashboardView";

/** Routeur de la route `/dashboard` : dashboard exécutif (Performance) ou dashboard stratégique
 *  selon le programme actif. Le dashboard Performance historique est inchangé dans
 *  `DashboardPagePerformance.tsx`.
 *
 *  Programme affiché = programme actif GLOBAL (Topbar) ; un ancien lien `/dashboard?program=…`
 *  est consommé par `ActiveProgramProvider` (il pose le programme actif, stratégique compris,
 *  puis disparaît de l'URL) — ce routeur bascule donc naturellement sur la bonne vue.
 *
 *  Suspense : `DashboardPagePerformance` lit `useSearchParams()` (filtres `f_*` via
 *  `useMultiFilterBarState`), ce que Next.js exige d'envelopper en prerender. */
export default function DashboardPage() {
  const { programType } = useActiveProgram();
  return (
    <Suspense fallback={null}>
      {programType === "strategic" ? <StrategicDashboardView /> : <DashboardPagePerformance />}
    </Suspense>
  );
}
