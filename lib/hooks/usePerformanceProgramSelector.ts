"use client";

import { useMemo } from "react";
import { resolveProgramType } from "@/lib/axisLogic";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";

/**
 * Vue « Plan Performance » du programme actif GLOBAL (`useActiveProgram`, sélecteur du Topbar) —
 * pour les pages Performance qui ont besoin d'UN programme Performance (cycle de vie personnalisé,
 * voir lib/hooks/useLifecycleLabels.ts) : LeversPagePerformance, WorkstreamsPage.
 *
 * Décision PO (audit fix #1) : il n'y a plus de sélection LOCALE à la page. Ce hook n'a plus d'état
 * propre ; il dérive tout du contexte global, et `setSelectedProgramId` écrit dans ce même contexte
 * (un sélecteur local éventuel n'est donc qu'une vue du Topbar, jamais une source divergente).
 *
 *  - `selectedProgramId` : le programme actif s'il est de type Performance ; `null` en vue
 *    consolidée ou si le programme actif est un Plan Stratégique (`activeIsStrategic`, à signaler
 *    par la page). Repli : sans aucun programme actif résolu (admin global, sans contexte
 *    entreprise ni sélecteur), premier programme Performance — comportement historique.
 */
export function usePerformanceProgramSelector() {
  const {
    programs,
    authorizedPrograms,
    activeProgram,
    isConsolidatedView,
    setActiveProgramId,
    loading,
  } = useActiveProgram();

  /** Tous les programmes Performance de l'entreprise (portée des données : un levier rattaché à
   *  un AUTRE programme Performance existant est masqué, voir LeversPagePerformance). */
  const performancePrograms = useMemo(
    () => programs.filter((p) => resolveProgramType(p) === "performance"),
    [programs]
  );
  /** Programmes Performance que l'utilisateur peut sélectionner (même liste que le Topbar). */
  const selectablePerformancePrograms = useMemo(
    () => authorizedPrograms.filter((p) => resolveProgramType(p) === "performance"),
    [authorizedPrograms]
  );

  const activeIsStrategic = !!activeProgram && resolveProgramType(activeProgram) === "strategic";

  const selectedProgramId: string | null = activeProgram
    ? activeIsStrategic
      ? null
      : activeProgram.id
    : isConsolidatedView
      ? null
      : (performancePrograms[0]?.id ?? null);

  return {
    /** Tous les programmes de l'entreprise (Performance + Stratégique), pour les usages qui n'ont
     *  pas besoin du filtrage par type (ex. mapping "Programme" de l'import Excel des leviers). */
    programs,
    performancePrograms,
    selectablePerformancePrograms,
    selectedProgramId,
    /** Écrit dans le programme actif GLOBAL (même état que le Topbar). */
    setSelectedProgramId: setActiveProgramId,
    isConsolidatedView,
    activeIsStrategic,
    /** true dès la première réponse Firestore — permet de ne pas afficher l'état vide "aucun
     *  programme Performance" pendant le tout premier rendu. */
    loaded: !loading,
  };
}
