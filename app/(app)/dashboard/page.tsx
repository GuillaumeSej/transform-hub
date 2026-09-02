"use client";

import { Suspense } from "react";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { DashboardPagePerformance } from "./DashboardPagePerformance";
import { StrategicDashboardView } from "@/components/strategic/StrategicDashboardView";

/** Routeur de la route `/dashboard` : dashboard exécutif (Performance) ou dashboard stratégique
 *  selon le programme actif. Le dashboard Performance historique est inchangé dans
 *  `DashboardPagePerformance.tsx`.
 *
 *  Suspense : `DashboardPagePerformance` lit `useSearchParams()` (le `?program=`), ce que Next.js
 *  exige d'envelopper en prerender — la frontière vivait implicitement dans l'ancien fichier de
 *  page, elle est explicitée ici. */
export default function DashboardPage() {
  const { programType } = useActiveProgram();
  return (
    <Suspense fallback={null}>
      {programType === "strategic" ? <StrategicDashboardView /> : <DashboardPagePerformance />}
    </Suspense>
  );
}
