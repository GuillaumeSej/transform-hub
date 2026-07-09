"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as storage from "@/lib/storage";
import * as leversLogic from "@/lib/leversLogic";
import * as leversDb from "@/lib/firestore/levers";
import type { CascadeShift } from "@/lib/engine";
import { mockData } from "@/data/mockData";
import type { AuditEntry, Comment, Lever, LeverAction, SubLever } from "@/types";

const DEMO_USER = "Utilisateur démo";

/** Applique le verrouillage plan initial/réactualisation (voir leversLogic.applyPlanLock) au
 * seed mockData : sans ça, les leviers de démo déjà en L3+/L4+ n'auraient pas de plan figé tant
 * qu'on ne les modifie pas manuellement. */
function lockedSeed() {
  return {
    levers: mockData.levers.map((l) => leversLogic.applyPlanLock(l)),
    subLevers: mockData.subLevers.map((s) => leversLogic.applyPlanLock(s)),
    comments: mockData.comments,
    audit: mockData.audit,
  };
}

/**
 * Point d'accès React unique à la couche de persistance. Toute page/composant qui a besoin
 * des données BeTrack doit passer par ce hook plutôt que par `lib/storage.ts` ou
 * `lib/firestore/levers.ts` directement, afin que les composants abonnés se re-rendent après
 * chaque mutation.
 *
 * Le périmètre "leviers" (levers, subLevers, comments, audit) vit dans Firestore et est
 * partagé en temps réel entre utilisateurs via `onSnapshot` : chaque mutation met à jour l'état
 * local de façon optimiste (retour synchrone immédiat, comme avant) puis persiste dans Firestore
 * en tâche de fond. Le reste (program, workstreams, workforce, operations, alerts, scenarios)
 * reste sur localStorage, voir lib/storage.ts.
 */
export function useBeTrackData() {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const [levers, setLevers] = useState<Lever[]>([]);
  const [subLevers, setSubLevers] = useState<SubLever[]>([]);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  // Refs toujours à jour pour que les callbacks de mutation lisent l'état le plus récent sans
  // dépendre du cycle de rendu React (évite les fermetures obsolètes entre deux mutations
  // rapprochées, ex. créer un sous-levier juste après en avoir supprimé un autre).
  const leversRef = useRef(levers);
  leversRef.current = levers;
  const subLeversRef = useRef(subLevers);
  subLeversRef.current = subLevers;
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const auditRef = useRef(audit);
  auditRef.current = audit;

  useEffect(() => {
    let cancelled = false;
    leversDb
      .ensureLeversSeeded(lockedSeed())
      .catch((err) => console.error("[betrack] échec du seed Firestore des leviers :", err));

    const unsubscribers = [
      leversDb.subscribeLevers((l) => !cancelled && setLevers(l)),
      leversDb.subscribeSubLevers((s) => !cancelled && setSubLevers(s)),
      leversDb.subscribeComments((c) => !cancelled && setComments(c)),
      leversDb.subscribeAuditLog((a) => !cancelled && setAudit(a)),
    ];
    return () => {
      cancelled = true;
      unsubscribers.forEach((unsub) => unsub());
    };
  }, []);

  const persistAudit = useCallback((entries: AuditEntry[]) => {
    if (entries.length === 0) return;
    const next = [...entries.slice().reverse(), ...auditRef.current];
    auditRef.current = next;
    setAudit(next);
    leversDb.saveAuditLog(next).catch((err) => console.error("[betrack] audit :", err));
  }, []);

  const data = useMemo(
    () => ({
      program: storage.getProgram(),
      workstreams: storage.getWorkstreams(),
      levers,
      subLevers,
      workforce: storage.getWorkforce(),
      operations: storage.getOperations(),
      alerts: storage.getAlerts(),
      audit,
      comments,
      scenarios: storage.getScenarios(),
      activeScenario: storage.getActiveScenario(),
      // Référentiels statiques (jamais mutés, pas besoin de passer par une BDD)
      leverStatuses: mockData.leverStatuses,
      riskLevels: mockData.riskLevels,
      priorityLevels: mockData.priorityLevels,
      leverTypes: mockData.leverTypes,
      geographies: mockData.geographies,
      functions: mockData.functions,
      pnlAccounts: mockData.pnlAccounts,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, levers, subLevers, comments, audit]
  );

  const updateLever = useCallback(
    (id: string, patch: Partial<Lever>) => {
      const result = leversLogic.updateLever(leversRef.current, id, patch, DEMO_USER);
      leversRef.current = result.levers;
      setLevers(result.levers);
      persistAudit(result.auditEntries);
      leversDb.saveLever(result.lever).catch((err) => console.error("[betrack] lever :", err));
      return result.lever;
    },
    [persistAudit]
  );

  const createLever = useCallback(
    (input: Omit<Lever, "id" | "createdAt" | "lastUpdate">) => {
      const result = leversLogic.createLever(leversRef.current, input, DEMO_USER);
      leversRef.current = result.levers;
      setLevers(result.levers);
      persistAudit(result.auditEntries);
      leversDb.saveLever(result.lever).catch((err) => console.error("[betrack] lever :", err));
      return result.lever;
    },
    [persistAudit]
  );

  const upsertLeverByCode = useCallback(
    (input: Omit<Lever, "id" | "createdAt" | "lastUpdate">) => {
      const result = leversLogic.upsertLeverByCode(leversRef.current, input, DEMO_USER);
      leversRef.current = result.levers;
      setLevers(result.levers);
      persistAudit(result.auditEntries);
      leversDb.saveLever(result.lever).catch((err) => console.error("[betrack] lever :", err));
      return result;
    },
    [persistAudit]
  );

  const createSubLever = useCallback(
    (input: Omit<SubLever, "id">) => {
      const result = leversLogic.createSubLever(
        leversRef.current,
        subLeversRef.current,
        input,
        DEMO_USER
      );
      leversRef.current = result.levers;
      subLeversRef.current = result.subLevers;
      setLevers(result.levers);
      setSubLevers(result.subLevers);
      persistAudit(result.auditEntries);
      leversDb
        .saveSubLever(result.subLever)
        .catch((err) => console.error("[betrack] sous-levier :", err));
      if (result.changedLever) {
        leversDb
          .saveLever(result.changedLever)
          .catch((err) => console.error("[betrack] lever :", err));
      }
      return result.subLever;
    },
    [persistAudit]
  );

  const updateSubLever = useCallback(
    (id: string, patch: Partial<SubLever>) => {
      const result = leversLogic.updateSubLever(
        leversRef.current,
        subLeversRef.current,
        id,
        patch,
        DEMO_USER
      );
      leversRef.current = result.levers;
      subLeversRef.current = result.subLevers;
      setLevers(result.levers);
      setSubLevers(result.subLevers);
      persistAudit(result.auditEntries);
      leversDb
        .saveSubLever(result.subLever)
        .catch((err) => console.error("[betrack] sous-levier :", err));
      if (result.changedLever) {
        leversDb
          .saveLever(result.changedLever)
          .catch((err) => console.error("[betrack] lever :", err));
      }
      return result.subLever;
    },
    [persistAudit]
  );

  const deleteSubLever = useCallback(
    (id: string) => {
      const result = leversLogic.deleteSubLever(
        leversRef.current,
        subLeversRef.current,
        id,
        DEMO_USER
      );
      leversRef.current = result.levers;
      subLeversRef.current = result.subLevers;
      setLevers(result.levers);
      setSubLevers(result.subLevers);
      persistAudit(result.auditEntries);
      leversDb.deleteSubLeverDoc(id).catch((err) => console.error("[betrack] sous-levier :", err));
      if (result.changedLever) {
        leversDb
          .saveLever(result.changedLever)
          .catch((err) => console.error("[betrack] lever :", err));
      }
    },
    [persistAudit]
  );

  const createAction = useCallback(
    (scope: { leverId: string; subLeverId?: string }, input: Omit<LeverAction, "id">) => {
      const result = leversLogic.createAction(
        leversRef.current,
        subLeversRef.current,
        scope,
        input,
        DEMO_USER
      );
      leversRef.current = result.levers;
      subLeversRef.current = result.subLevers;
      setLevers(result.levers);
      setSubLevers(result.subLevers);
      persistAudit(result.auditEntries);
      if (result.changedLever) {
        leversDb
          .saveLever(result.changedLever)
          .catch((err) => console.error("[betrack] lever :", err));
      }
      if (result.changedSubLever) {
        leversDb
          .saveSubLever(result.changedSubLever)
          .catch((err) => console.error("[betrack] sous-levier :", err));
      }
      return result.action;
    },
    [persistAudit]
  );

  const updateAction = useCallback(
    (
      scope: { leverId: string; subLeverId?: string },
      actionId: string,
      patch: Partial<LeverAction>
    ) => {
      const result = leversLogic.updateAction(
        leversRef.current,
        subLeversRef.current,
        scope,
        actionId,
        patch,
        DEMO_USER
      );
      leversRef.current = result.levers;
      subLeversRef.current = result.subLevers;
      setLevers(result.levers);
      setSubLevers(result.subLevers);
      persistAudit(result.auditEntries);
      if (result.changedLever) {
        leversDb
          .saveLever(result.changedLever)
          .catch((err) => console.error("[betrack] lever :", err));
      }
      if (result.changedSubLever) {
        leversDb
          .saveSubLever(result.changedSubLever)
          .catch((err) => console.error("[betrack] sous-levier :", err));
      }
      return result.action;
    },
    [persistAudit]
  );

  const deleteAction = useCallback(
    (scope: { leverId: string; subLeverId?: string }, actionId: string) => {
      const result = leversLogic.deleteAction(
        leversRef.current,
        subLeversRef.current,
        scope,
        actionId
      );
      leversRef.current = result.levers;
      subLeversRef.current = result.subLevers;
      setLevers(result.levers);
      setSubLevers(result.subLevers);
      if (result.changedLever) {
        leversDb
          .saveLever(result.changedLever)
          .catch((err) => console.error("[betrack] lever :", err));
      }
      if (result.changedSubLever) {
        leversDb
          .saveSubLever(result.changedSubLever)
          .catch((err) => console.error("[betrack] sous-levier :", err));
      }
    },
    []
  );

  const applyCascadeShift = useCallback(
    (shifts: CascadeShift[]) => {
      const result = leversLogic.applyCascadeShift(
        leversRef.current,
        subLeversRef.current,
        shifts,
        DEMO_USER
      );
      leversRef.current = result.levers;
      subLeversRef.current = result.subLevers;
      setLevers(result.levers);
      setSubLevers(result.subLevers);
      persistAudit(result.auditEntries);
      result.changedLevers.forEach((l) =>
        leversDb.saveLever(l).catch((err) => console.error("[betrack] lever :", err))
      );
      result.changedSubLevers.forEach((s) =>
        leversDb.saveSubLever(s).catch((err) => console.error("[betrack] sous-levier :", err))
      );
    },
    [persistAudit]
  );

  const addComment = useCallback(
    (leverId: string, text: string) => {
      const result = leversLogic.addComment(commentsRef.current, leverId, text, DEMO_USER);
      commentsRef.current = result.comments;
      setComments(result.comments);
      persistAudit([result.auditEntry]);
      leversDb
        .saveComments(result.comments)
        .catch((err) => console.error("[betrack] commentaire :", err));
      return result.leverComments;
    },
    [persistAudit]
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
    leversDb
      .forceReseedLevers(lockedSeed())
      .catch((err) => console.error("[betrack] échec du reset Firestore des leviers :", err));
    bump();
  }, [bump]);

  return {
    ...data,
    getComments: (leverId: string) => comments[leverId] ?? [],
    getLeverById: (id: string) => data.levers.find((l) => l.id === id),
    getSubLeversForLever: (leverId: string) => data.subLevers.filter((s) => s.leverId === leverId),
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
