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
 * Rend le référentiel de cycle de vie (`lifecycleConfigs/{programId}`) réellement vivant pour les
 * consommateurs "user-facing" : s'abonne à la config Firestore DU PROGRAMME et expose des
 * fonctions de résolution de libellé prêtes à l'emploi, avec repli sur `DEFAULT_LIFECYCLE_STAGES`
 * si le programme n'a rien personnalisé (ou si `programId` est absent — aucun appel Firestore
 * n'est alors effectué).
 *
 * Scopé par programme (et non plus par entreprise, voir lib/firestore/admin.ts) depuis que le
 * cycle de vie est une config Performance par programme : un appelant qui affiche des leviers de
 * PLUSIEURS programmes à la fois (ex. LeversPagePerformance, WorkstreamsPage — pas de scope
 * programme unique dans ces vues) ne peut pas résoudre un référentiel personnalisé unique et
 * retombe donc sur `DEFAULT_LIFECYCLE_STAGES` (passer `undefined`/`null`) ; seules les vues déjà
 * scopées à un programme (Dashboard, RH, détail levier) profitent des libellés personnalisés.
 */
export function useLifecycleLabels(programId: string | null | undefined): LifecycleLabels {
  const [stages, setStages] = useState<LifecycleStage[]>(DEFAULT_LIFECYCLE_STAGES);

  useEffect(() => {
    if (!programId) {
      setStages(DEFAULT_LIFECYCLE_STAGES);
      return;
    }
    const unsub = subscribeLifecycleConfig(programId, (fetched) => {
      setStages(fetched.length > 0 ? fetched : DEFAULT_LIFECYCLE_STAGES);
    });
    return unsub;
  }, [programId]);

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
