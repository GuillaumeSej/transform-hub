"use client";

import { useCallback, useMemo, useState } from "react";
import * as storage from "@/lib/storage";
import { mockData } from "@/data/mockData";
import type { Lever } from "@/types";

/**
 * Point d'accès React unique à la couche de persistance. Toute page/composant qui a besoin
 * des données BeTrack doit passer par ce hook plutôt que par `lib/storage.ts` directement,
 * afin que les composants abonnés se re-rendent après chaque mutation.
 */
export function useBeTrackData() {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const data = useMemo(
    () => ({
      program: storage.getProgram(),
      workstreams: storage.getWorkstreams(),
      levers: storage.getLevers(),
      workforce: storage.getWorkforce(),
      operations: storage.getOperations(),
      alerts: storage.getAlerts(),
      audit: storage.getAuditLog(),
      comments: storage.getAllComments(),
      scenarios: storage.getScenarios(),
      activeScenario: storage.getActiveScenario(),
      // Référentiels statiques (jamais mutés, pas besoin de passer par localStorage)
      leverStatuses: mockData.leverStatuses,
      riskLevels: mockData.riskLevels,
      geographies: mockData.geographies,
      functions: mockData.functions,
      pnlAccounts: mockData.pnlAccounts,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  );

  const updateLever = useCallback(
    (id: string, patch: Partial<Lever>) => {
      const result = storage.updateLever(id, patch);
      bump();
      return result;
    },
    [bump]
  );

  const addComment = useCallback(
    (leverId: string, text: string) => {
      const result = storage.addComment(leverId, text);
      bump();
      return result;
    },
    [bump]
  );

  const resolveAlert = useCallback(
    (alertId: string) => {
      storage.resolveAlert(alertId);
      bump();
    },
    [bump]
  );

  const setActiveScenario = useCallback(
    (scenarioId: string) => {
      storage.setActiveScenario(scenarioId);
      bump();
    },
    [bump]
  );

  const resetToMockData = useCallback(() => {
    storage.resetToMockData();
    bump();
  }, [bump]);

  return {
    ...data,
    getComments: storage.getComments,
    getLeverById: (id: string) => data.levers.find((l) => l.id === id),
    updateLever,
    addComment,
    resolveAlert,
    setActiveScenario,
    resetToMockData,
  };
}
