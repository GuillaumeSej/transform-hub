"use client";

import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { LeverDetailClientPerformance } from "./LeverDetailClientPerformance";
import { AxisDetailClient } from "@/components/strategic/AxisDetailClient";

/** Routeur de la fiche détail `/levers/detail` : fiche levier (Performance) ou fiche axe
 *  (Stratégique) selon le programme actif. Reste l'export DÉFAUT de ce fichier — `detail/page.tsx`
 *  (wrapper Suspense) l'importe ainsi et n'a pas à changer. La fiche levier historique est
 *  inchangée dans `LeverDetailClientPerformance.tsx`. */
export default function LeverDetailClient() {
  const { programType } = useActiveProgram();
  return programType === "strategic" ? <AxisDetailClient /> : <LeverDetailClientPerformance />;
}
