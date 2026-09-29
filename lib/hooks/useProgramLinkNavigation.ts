"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { programSwitchForLink } from "@/lib/activeProgramSelection";
import type { ProgramType } from "@/types";

/**
 * Navigation vers un objet d'un programme / plan donné (portail « Mon espace », cloche du Topbar) :
 * active le bon programme (règle pure `programSwitchForLink`) JUSTE AVANT `router.push` — les deux
 * mises à jour sont regroupées, la page cible s'affiche donc directement sur le bon programme (et
 * le bon type de plan : `/levers/detail` rend la fiche levier OU la fiche axe selon le programme
 * actif).
 */
export function useProgramLinkNavigation(): (
  href: string,
  target?: { programId?: string; plan?: ProgramType }
) => void {
  const router = useRouter();
  const {
    activeProgramId,
    programType,
    authorizedPrograms,
    isConsolidatedView,
    consolidatedPrograms,
    setActiveProgramId,
  } = useActiveProgram();
  return useCallback(
    (href, target) => {
      const switchTo = programSwitchForLink({
        targetProgramId: target?.programId,
        targetPlan: target?.plan,
        activeProgramId,
        activeProgramType: programType,
        isConsolidatedView,
        consolidatedProgramIds: consolidatedPrograms.map((p) => p.id),
        selectablePrograms: authorizedPrograms,
      });
      if (switchTo) setActiveProgramId(switchTo);
      router.push(href);
    },
    [
      router,
      activeProgramId,
      programType,
      authorizedPrograms,
      isConsolidatedView,
      consolidatedPrograms,
      setActiveProgramId,
    ]
  );
}
