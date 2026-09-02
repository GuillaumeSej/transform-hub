"use client";

import { useEffect, useState } from "react";
import { subscribeMaturityStages } from "@/lib/firestore/maturityStageConfigs";
import type { MaturityStageConfig } from "@/types";

/**
 * Pendant stratégique de `useLifecycleLabels` : rend le référentiel d'étapes de maturité
 * (`maturityStageConfigs`) vivant pour les vues user-facing, trié par `order`. Deux différences
 * structurelles avec son modèle Performance :
 *  - scopé PAR PROGRAMME (`programId`) et non par entreprise ;
 *  - pas de jeu par défaut côté client — les étapes par défaut sont matérialisées EN BASE à la
 *    création du programme (`ensureDefaultMaturityStages`), parce qu'elles sont librement
 *    modifiables et supprimables ; un repli local ferait réapparaître des étapes qu'un admin
 *    aurait volontairement retirées.
 *
 * Retourne le tableau brut (et non un objet de résolveurs comme `useLifecycleLabels`) : les
 * composants stratégiques partagés reçoivent la liste d'étapes en prop (voir
 * `components/strategic/AxisStageBadge.tsx`), une seule forme circule donc partout.
 */
export function useMaturityStages(programId: string | null | undefined): MaturityStageConfig[] {
  const [stages, setStages] = useState<MaturityStageConfig[]>([]);

  useEffect(() => {
    if (!programId) {
      setStages([]);
      return;
    }
    const unsub = subscribeMaturityStages(programId, setStages);
    return unsub;
  }, [programId]);

  return stages;
}

/** Libellé d'une étape à partir de son id — repli sur l'id brut quand l'étape a été supprimée
 *  depuis (une entité peut référencer une étape qui n'existe plus dans la config du programme). */
export function resolveMaturityStageLabel(stageId: string, stages: MaturityStageConfig[]): string {
  return stages.find((s) => s.id === stageId)?.label ?? stageId;
}
