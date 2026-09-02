"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { subscribePrograms } from "@/lib/firestore/admin";
import { resolveProgramType } from "@/lib/axisLogic";
import { useRole } from "@/lib/hooks/useRole";
import type { Program, ProgramType } from "@/types";

/**
 * Contexte global "programme actif" — le programme sélectionné détermine désormais la NATURE des
 * pages affichées (Plan Performance vs Plan Stratégique), pas seulement le périmètre de données
 * du dashboard exécutif. Il doit donc vivre au-dessus des pages (monté dans
 * `app/(app)/layout.tsx`), et non dans l'état local du dashboard comme c'était le cas avant.
 *
 * Sélection : le programme actif est mémorisé par `activeProgramId` ; en l'absence de sélection
 * explicite (premier chargement, ou programme devenu invalide après suppression), on retombe sur
 * le PREMIER programme de l'entreprise de l'utilisateur — même repli que le sélecteur historique
 * du dashboard, pour que rien ne change pour un utilisateur mono-programme.
 *
 * `programType` est le champ réellement consommé par la nav (`lib/nav-config.ts`) et les routeurs
 * de page : il vaut "performance" tant qu'aucun programme n'est résolu, de sorte qu'un incident de
 * chargement dégrade vers le comportement historique plutôt que vers un écran stratégique vide.
 */
type ActiveProgramContextValue = {
  /** Tous les programmes visibles par l'utilisateur courant (son entreprise, ou tous si admin). */
  programs: Program[];
  /** Programme actif résolu, ou null tant qu'aucun programme n'est disponible. */
  activeProgram: Program | null;
  activeProgramId: string | null;
  /** Type du programme actif — "performance" par défaut (voir `resolveProgramType`). */
  programType: ProgramType;
  setActiveProgramId: (id: string | null) => void;
  /** true tant que la première réponse Firestore n'est pas arrivée. */
  loading: boolean;
};

const ActiveProgramContext = createContext<ActiveProgramContextValue | null>(null);

export function ActiveProgramProvider({ children }: { children: React.ReactNode }) {
  const { user } = useRole();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const companyId = user?.companyId ?? null;

  useEffect(() => {
    const unsub = subscribePrograms((all) => {
      // Un admin global (companyId null) voit tous les programmes ; les autres sont scopés à leur
      // entreprise — même règle que partout ailleurs (voir useBeTrackData).
      setPrograms(companyId ? all.filter((p) => p.companyId === companyId) : all);
      setLoading(false);
    });
    return unsub;
  }, [companyId]);

  const activeProgram = useMemo(() => {
    if (programs.length === 0) return null;
    return programs.find((p) => p.id === selectedId) ?? programs[0];
  }, [programs, selectedId]);

  const setActiveProgramId = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const value = useMemo<ActiveProgramContextValue>(
    () => ({
      programs,
      activeProgram,
      activeProgramId: activeProgram?.id ?? null,
      programType: resolveProgramType(activeProgram),
      setActiveProgramId,
      loading,
    }),
    [programs, activeProgram, setActiveProgramId, loading]
  );

  return <ActiveProgramContext.Provider value={value}>{children}</ActiveProgramContext.Provider>;
}

export function useActiveProgram(): ActiveProgramContextValue {
  const ctx = useContext(ActiveProgramContext);
  if (!ctx) throw new Error("useActiveProgram doit être utilisé dans un <ActiveProgramProvider>");
  return ctx;
}
