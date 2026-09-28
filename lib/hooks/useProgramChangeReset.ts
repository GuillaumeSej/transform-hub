"use client";

import { useEffect, useRef } from "react";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { shouldResetProgramScopedState } from "@/lib/activeProgramSelection";

/**
 * Appelle `onChange` quand le programme actif (Topbar, vue consolidée comprise) CHANGE pendant que
 * la page est montée — pour réinitialiser l'état dérivé du programme (filtres de leviers, filtres
 * d'arborescence, plages de dates…), dont les valeurs n'ont souvent plus de sens sur un autre
 * programme. Jamais au premier rendu : un lien profond arrivant avec des filtres dans l'URL les
 * conserve (voir `shouldResetProgramScopedState`).
 */
export function useProgramChangeReset(onChange: () => void): void {
  const { activeProgramId, loading } = useActiveProgram();
  const previous = useRef<string | null>(null);
  // Toujours la dernière version du callback (il capture souvent `searchParams`/`router`).
  const callback = useRef(onChange);
  callback.current = onChange;

  useEffect(() => {
    if (loading || !activeProgramId) return;
    if (shouldResetProgramScopedState(previous.current, activeProgramId)) callback.current();
    previous.current = activeProgramId;
  }, [activeProgramId, loading]);
}
