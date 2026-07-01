"use client";

import { useCallback, useMemo, useState } from "react";
import * as storage from "@/lib/storage";
import type { CascadeShift } from "@/lib/engine";
import { mockData } from "@/data/mockData";
import type { Lever, LeverAction, SubLever } from "@/types";

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
      subLevers: storage.getSubLevers(),
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
      priorityLevels: mockData.priorityLevels,
      maturityLevels: mockData.maturityLevels,
      leverTypes: mockData.leverTypes,
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

  const createLever = useCallback(
    (input: Omit<Lever, "id" | "createdAt" | "lastUpdate">) => {
      const result = storage.createLever(input);
      bump();
      return result;
    },
    [bump]
  );

  const upsertLeverByCode = useCallback(
    (input: Omit<Lever, "id" | "createdAt" | "lastUpdate">) => {
      const result = storage.upsertLeverByCode(input);
      bump();
      return result;
    },
    [bump]
  );

  const createSubLever = useCallback(
    (input: Omit<SubLever, "id">) => {
      const result = storage.createSubLever(input);
      bump();
      return result;
    },
    [bump]
  );

  const updateSubLever = useCallback(
    (id: string, patch: Partial<SubLever>) => {
      const result = storage.updateSubLever(id, patch);
      bump();
      return result;
    },
    [bump]
  );

  const deleteSubLever = useCallback(
    (id: string) => {
      storage.deleteSubLever(id);
      bump();
    },
    [bump]
  );

  const createAction = useCallback(
    (scope: { leverId: string; subLeverId?: string }, input: Omit<LeverAction, "id">) => {
      const result = storage.createAction(scope, input);
      bump();
      return result;
    },
    [bump]
  );

  const updateAction = useCallback(
    (
      scope: { leverId: string; subLeverId?: string },
      actionId: string,
      patch: Partial<LeverAction>
    ) => {
      const result = storage.updateAction(scope, actionId, patch);
      bump();
      return result;
    },
    [bump]
  );

  const deleteAction = useCallback(
    (scope: { leverId: string; subLeverId?: string }, actionId: string) => {
      storage.deleteAction(scope, actionId);
      bump();
    },
    [bump]
  );

  const applyCascadeShift = useCallback(
    (shifts: CascadeShift[]) => {
      storage.applyCascadeShift(shifts);
      bump();
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
    getSubLeversForLever: (leverId: string) =>
      data.subLevers.filter((s) => s.leverId === leverId),
    updateLever,
    createLever,
    upsertLeverByCode,
    createSubLever,
    updateSubLever,
    deleteSubLever,
    createAction,
    updateAction,
    deleteAction,
    applyCascadeShift,
    addComment,
    resolveAlert,
    setActiveScenario,
    resetToMockData,
  };
}
