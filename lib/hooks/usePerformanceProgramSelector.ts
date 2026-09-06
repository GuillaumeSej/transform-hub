"use client";

import { useEffect, useMemo, useState } from "react";
import { subscribePrograms } from "@/lib/firestore/admin";
import { resolveProgramType } from "@/lib/axisLogic";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import type { Program } from "@/types";

/**
 * Sélection LOCALE (scopée à la page) d'un programme Performance parmi ceux de l'entreprise —
 * pour les vues qui agrègent des leviers de plusieurs programmes sur une seule table
 * (LeversPagePerformance, WorkstreamsPage) et doivent désormais choisir UN programme à la fois
 * pour pouvoir résoudre son cycle de vie personnalisé (voir lib/hooks/useLifecycleLabels.ts).
 *
 * Volontairement distinct du contexte global `useActiveProgram` (qui pilote la nature de la nav,
 * voir ce fichier) : ce n'est pas un sélecteur cross-cutting comme l'ancien `ProgramSwitcher`
 * (retiré du Topbar), seulement l'état d'affichage de CETTE page — mais on réutilise
 * `activeProgramId` comme valeur par défaut quand il pointe déjà vers un programme Performance,
 * pour rester cohérent avec le reste de l'app plutôt que de retomber arbitrairement sur le premier
 * programme de la liste.
 */
export function usePerformanceProgramSelector(companyId: string | null | undefined) {
  const { activeProgramId } = useActiveProgram();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsub = subscribePrograms((all) => {
      setPrograms(companyId ? all.filter((p) => p.companyId === companyId) : all);
      setLoaded(true);
    }, companyId ?? null);
    return unsub;
  }, [companyId]);

  const performancePrograms = useMemo(
    () => programs.filter((p) => resolveProgramType(p) === "performance"),
    [programs]
  );

  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);

  // Défaut : le programme actif global s'il est Performance et fait partie de la liste, sinon le
  // premier programme Performance disponible. Se réajuste aussi si la sélection courante devient
  // invalide (programme supprimé, ou changement d'entreprise).
  useEffect(() => {
    if (performancePrograms.length === 0) {
      setSelectedProgramId(null);
      return;
    }
    setSelectedProgramId((current) => {
      if (current && performancePrograms.some((p) => p.id === current)) return current;
      const preferred =
        activeProgramId && performancePrograms.some((p) => p.id === activeProgramId)
          ? activeProgramId
          : performancePrograms[0].id;
      return preferred;
    });
  }, [performancePrograms, activeProgramId]);

  return {
    /** Tous les programmes de l'entreprise (Performance + Stratégique), pour les usages qui n'ont
     *  pas besoin du filtrage par type (ex. mapping "Programme" de l'import Excel des leviers). */
    programs,
    performancePrograms,
    selectedProgramId,
    setSelectedProgramId,
    /** true dès la première réponse Firestore (ou son échec) — permet de ne pas afficher l'état
     *  vide "aucun programme Performance" pendant le tout premier rendu. */
    loaded,
  };
}
