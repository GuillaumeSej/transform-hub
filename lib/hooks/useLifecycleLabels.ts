"use client";

import { useEffect, useMemo, useState } from "react";
import { subscribeLifecycleConfig } from "@/lib/firestore/admin";
import {
  DEFAULT_LIFECYCLE_STAGES,
  resolveActiveCycle,
  resolveStatusLabel,
  resolveStatusShortLabel,
} from "@/lib/status-config";
import type { LeverStatus, LifecycleStage } from "@/types";

export type LifecycleLabels = {
  /** Étapes actives du cycle de vie, dans l'ordre configuré par l'entreprise (ou par défaut). */
  stages: LifecycleStage[];
  /** Libellé complet d'un statut, tenant compte de la config entreprise si elle existe. */
  label: (status: LeverStatus) => string;
  /** Libellé court d'un statut (badges, colonnes Kanban...), tenant compte de la config entreprise. */
  shortLabel: (status: LeverStatus) => string;
  /** Cycle actif (clés de statut dans l'ordre configuré, hors "cancelled"). */
  activeCycle: LeverStatus[];
};

/**
 * Rend le référentiel de cycle de vie (`lifecycleConfigs/{companyId}`) réellement vivant pour les
 * consommateurs "user-facing" : s'abonne à la config Firestore de l'entreprise et expose des
 * fonctions de résolution de libellé prêtes à l'emploi, avec repli sur `DEFAULT_LIFECYCLE_STAGES`
 * si l'entreprise n'a rien personnalisé (ou si `companyId` est absent — aucun appel Firestore n'est
 * alors effectué).
 */
export function useLifecycleLabels(companyId: string | null | undefined): LifecycleLabels {
  const [stages, setStages] = useState<LifecycleStage[]>(DEFAULT_LIFECYCLE_STAGES);

  useEffect(() => {
    if (!companyId) {
      setStages(DEFAULT_LIFECYCLE_STAGES);
      return;
    }
    const unsub = subscribeLifecycleConfig(companyId, (fetched) => {
      setStages(fetched.length > 0 ? fetched : DEFAULT_LIFECYCLE_STAGES);
    });
    return unsub;
  }, [companyId]);

  return useMemo(
    () => ({
      stages,
      label: (status: LeverStatus) => resolveStatusLabel(status, stages),
      shortLabel: (status: LeverStatus) => resolveStatusShortLabel(status, stages),
      activeCycle: resolveActiveCycle(stages),
    }),
    [stages]
  );
}
