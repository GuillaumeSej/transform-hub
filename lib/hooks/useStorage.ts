"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as leversLogic from "@/lib/leversLogic";
import * as leversDb from "@/lib/firestore/levers";
import * as workforceLogic from "@/lib/workforceLogic";
import * as workforceDb from "@/lib/firestore/workforce";
import * as alertsDb from "@/lib/firestore/alerts";
import * as programDb from "@/lib/firestore/programConfig";
import {
  ensureAdminSeeded,
  subscribeCompanies,
  subscribeHierarchyNodes,
} from "@/lib/firestore/admin";
import { derivePnlAccounts } from "@/lib/hierarchyLogic";
import { migrateMockLeversToActions } from "@/lib/mockActionMigration";
import type { CascadeShift } from "@/lib/engine";
import { mockData, legacySubLevers } from "@/data/mockData";
import type {
  AuditEntry,
  Alert,
  AlertState,
  AuthUser,
  Comment,
  Company,
  Department,
  Employee,
  Lever,
  LeverAction,
  HierarchyNode,
  ManualAlertInput,
  WorkforceMovement,
} from "@/types";

const DEMO_USER = "Utilisateur démo";

/** Applique le verrouillage plan initial/réactualisation (voir leversLogic.applyPlanLock) au
 * seed mockData : sans ça, les leviers de démo déjà en L3+/L4+ n'auraient pas de plan figé tant
 * qu'on ne les modifie pas manuellement. */
function lockedSeed() {
  const migratedLevers = migrateMockLeversToActions(mockData.levers, legacySubLevers);
  return {
    levers: migratedLevers.map((l) =>
      leversLogic.applyPlanLock({ ...l, companyId: l.companyId ?? "c1" })
    ),
    comments: mockData.comments,
    audit: mockData.audit,
  };
}

function workforceSeed(): workforceDb.WorkforceSeed {
  return {
    employees: mockData.workforce.employees,
    movements: mockData.workforce.movements,
    meta: {
      totalFTE: mockData.workforce.totalFTE,
      massSalary: mockData.workforce.massSalary,
      budgetSalary: mockData.workforce.budgetSalary,
      departments: mockData.workforce.departments,
    },
  };
}

function programSeed(): programDb.ProgramSeed {
  return { program: mockData.program, workstreams: mockData.workstreams };
}

/**
 * Point d'accès React unique à la couche de persistance. Toute page/composant qui a besoin
 * des données BeTrack doit passer par ce hook plutôt que par `lib/firestore/*` directement,
 * afin que les composants abonnés se re-rendent après chaque mutation.
 *
 * Multi-tenancy : le hook accepte un `companyId` optionnel. Les subscribers Firestore filtrent
 * les données par companyId. Un admin (companyId null) voit toutes les données.
 *
 * TOUTE la donnée métier vit dans Firestore et est partagée en temps réel entre utilisateurs
 * via `onSnapshot` : chaque mutation met à jour l'état local de façon optimiste (retour
 * synchrone immédiat) puis persiste dans Firestore en tâche de fond. La config programme
 * (program + workstreams), dernier périmètre historiquement en localStorage, a été migrée —
 * voir lib/firestore/programConfig.ts.
 */
export function useBeTrackData(companyId?: string | null) {
  // Fallback immédiat : l'application reste utilisable avec le nouveau modèle même si Firestore
  // est indisponible ou si le compte courant n'a pas les droits de reseed.
  const [levers, setLevers] = useState<Lever[]>(() => lockedSeed().levers);
  const [programConfig, setProgramConfig] = useState<programDb.ProgramSeed>(() => programSeed());
  const [comments, setComments] = useState<Record<string, Comment[]>>(() => mockData.comments);
  const [audit, setAudit] = useState<AuditEntry[]>(() => mockData.audit);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [movements, setMovements] = useState<WorkforceMovement[]>([]);
  const [workforceMeta, setWorkforceMeta] = useState<workforceDb.WorkforceMeta | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertStates, setAlertStates] = useState<Record<string, AlertState>>({});
  const [companies, setCompanies] = useState<Company[]>([]);
  const [financialNodes, setFinancialNodes] = useState<HierarchyNode[]>([]);

  // Refs toujours à jour pour que les callbacks de mutation lisent l'état le plus récent sans
  // dépendre du cycle de rendu React (évite les fermetures obsolètes entre deux mutations
  // rapprochées, ex. créer une action juste après en avoir supprimé une autre).
  const leversRef = useRef(levers);
  leversRef.current = levers;
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const auditRef = useRef(audit);
  auditRef.current = audit;
  const employeesRef = useRef(employees);
  employeesRef.current = employees;
  const movementsRef = useRef(movements);
  movementsRef.current = movements;
  const workforceMetaRef = useRef(workforceMeta);
  workforceMetaRef.current = workforceMeta;

  useEffect(() => {
    let cancelled = false;
    const unsubscribers: (() => void)[] = [];

    void (async () => {
      try {
        // Le seed doit être terminé avant les subscriptions : lors d'un changement de schéma,
        // cela évite d'afficher brièvement les anciennes données/sous-leviers.
        await Promise.all([
          leversDb.ensureLeversSeeded(lockedSeed()),
          workforceDb.ensureWorkforceSeeded(workforceSeed()),
          ensureAdminSeeded(),
          alertsDb.ensureAlertsSeeded(),
          programDb.ensureProgramSeeded(programSeed(), companyId),
        ]);
        if (companyId) await leversDb.migrateCompanyIds(companyId);
      } catch (err) {
        // Le fallback seedé plus haut reste actif. Les subscriptions sont tout de même tentées :
        // si la lecture est autorisée mais pas le reseed, elles remplacent le fallback.
        console.warn(
          "[betrack] Firestore indisponible, utilisation du jeu de données local :",
          err
        );
      }
      if (cancelled) return;

      unsubscribers.push(
        leversDb.subscribeLevers((l) => !cancelled && setLevers(l), companyId),
        leversDb.subscribeComments((c) => !cancelled && setComments(c)),
        leversDb.subscribeAuditLog((a) => !cancelled && setAudit(a)),
        workforceDb.subscribeEmployees((e) => !cancelled && setEmployees(e)),
        workforceDb.subscribeMovements((m) => !cancelled && setMovements(m)),
        workforceDb.subscribeWorkforceMeta((m) => !cancelled && setWorkforceMeta(m)),
        alertsDb.subscribeAlerts((a) => !cancelled && setAlerts(a), companyId),
        alertsDb.subscribeAlertStates((s) => !cancelled && setAlertStates(s), companyId),
        subscribeCompanies((items) => !cancelled && setCompanies(items)),
        programDb.subscribeProgramConfig(
          (config) => !cancelled && config && setProgramConfig(config),
          companyId
        )
      );
      if (companyId) {
        unsubscribers.push(
          subscribeHierarchyNodes(
            companyId,
            (nodes) => !cancelled && setFinancialNodes(nodes),
            "financial"
          )
        );
      } else {
        setFinancialNodes([]);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [companyId]);

  const persistAudit = useCallback((entries: AuditEntry[]) => {
    if (entries.length === 0) return;
    const next = [...entries.slice().reverse(), ...auditRef.current];
    auditRef.current = next;
    setAudit(next);
    leversDb.saveAuditLog(next).catch((err) => console.error("[betrack] audit :", err));
  }, []);

  const data = useMemo(
    () => {
      const company = companies.find((item) => item.id === companyId);
      // Garde défensive idempotente (voir hasActionImpacts) : les leviers viennent déjà enrichis
      // de Firestore depuis le seed, ce passage ne fait plus rien en pratique — plus de
      // sous-leviers vivants à fusionner (voir lockedSeed()).
      const migratedLevers = migrateMockLeversToActions(levers, []);
      return {
        program: programConfig.program,
        workstreams: programConfig.workstreams,
        levers: migratedLevers,
        // Reconstruit au format Workforce historique pour ne pas casser les consommateurs
        // existants — mais la donnée vit désormais dans Firestore (temps réel partagé).
        workforce: {
          totalFTE: workforceMeta?.totalFTE ?? mockData.workforce.totalFTE,
          massSalary: workforceMeta?.massSalary ?? mockData.workforce.massSalary,
          budgetSalary: workforceMeta?.budgetSalary ?? mockData.workforce.budgetSalary,
          departments: workforceMeta?.departments ?? mockData.workforce.departments,
          employees,
          movements,
        },
        // Référentiel statique : le module Operations est encore un Placeholder (aucune page ne
        // lit ni ne mute ces données) — pas de persistance tant que le module n'est pas construit.
        operations: mockData.operations,
        alerts,
        alertStates,
        audit,
        comments,
        // Référentiels statiques (jamais mutés, pas besoin de passer par une BDD)
        leverStatuses: mockData.leverStatuses,
        riskLevels: mockData.riskLevels,
        leverTypes: mockData.leverTypes,
        geographies: mockData.geographies,
        functions: mockData.functions,
        pnlAccounts: derivePnlAccounts(
          company?.hierarchyLevels ?? [],
          financialNodes,
          mockData.pnlAccounts,
          [
            ...migratedLevers.map((lever) => lever.pnlMap),
            ...migratedLevers.flatMap((lever) =>
              (lever.actions ?? []).flatMap((action) =>
                (action.impacts ?? []).map((impact) => impact.pnlMap || lever.pnlMap)
              )
            ),
          ]
        ),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      programConfig,
      levers,
      comments,
      audit,
      employees,
      movements,
      workforceMeta,
      alerts,
      alertStates,
      companies,
      financialNodes,
      companyId,
    ]
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

  const createAction = useCallback(
    (scope: { leverId: string }, input: Omit<LeverAction, "id">) => {
      const result = leversLogic.createAction(leversRef.current, scope, input, DEMO_USER);
      leversRef.current = result.levers;
      setLevers(result.levers);
      persistAudit(result.auditEntries);
      if (result.changedLever) {
        leversDb
          .saveLever(result.changedLever)
          .catch((err) => console.error("[betrack] lever :", err));
      }
      return result.action;
    },
    [persistAudit]
  );

  const updateAction = useCallback(
    (scope: { leverId: string }, actionId: string, patch: Partial<LeverAction>) => {
      const result = leversLogic.updateAction(leversRef.current, scope, actionId, patch, DEMO_USER);
      leversRef.current = result.levers;
      setLevers(result.levers);
      persistAudit(result.auditEntries);
      if (result.changedLever) {
        leversDb
          .saveLever(result.changedLever)
          .catch((err) => console.error("[betrack] lever :", err));
      }
      return result.action;
    },
    [persistAudit]
  );

  const deleteAction = useCallback((scope: { leverId: string }, actionId: string) => {
    const result = leversLogic.deleteAction(leversRef.current, scope, actionId);
    leversRef.current = result.levers;
    setLevers(result.levers);
    if (result.changedLever) {
      leversDb
        .saveLever(result.changedLever)
        .catch((err) => console.error("[betrack] lever :", err));
    }
  }, []);

  const applyCascadeShift = useCallback(
    (shifts: CascadeShift[]) => {
      const result = leversLogic.applyCascadeShift(leversRef.current, shifts, DEMO_USER);
      leversRef.current = result.levers;
      setLevers(result.levers);
      persistAudit(result.auditEntries);
      result.changedLevers.forEach((l) =>
        leversDb.saveLever(l).catch((err) => console.error("[betrack] lever :", err))
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

  const createManualAlert = useCallback((input: ManualAlertInput, user: AuthUser) => {
    const createdAt = new Date().toISOString();
    const alert: Alert = {
      ...input,
      id: `MANUAL-${crypto.randomUUID()}`,
      ts: createdAt,
      actorRole: user.role,
      owner: user.name,
      source: "manual",
      companyId: user.companyId,
      createdByUsername: user.username.trim().toLowerCase(),
      createdAt,
      resolved: false,
    };
    setAlerts((current) => [...current, alert]);
    alertsDb.saveManualAlert(alert).catch((err) => console.error("[betrack] alerte :", err));
    return alert;
  }, []);

  const setAlertResolved = useCallback(
    (alertId: string, resolved: boolean, user: AuthUser, alertCompanyId?: string | null) => {
      const state: AlertState = {
        alertId,
        companyId: alertCompanyId ?? user.companyId,
        resolved,
        ...(resolved
          ? {
              resolvedAt: new Date().toISOString(),
              resolvedByUsername: user.username.trim().toLowerCase(),
            }
          : {}),
      };
      const stateKey = `${state.companyId ?? "global"}__${alertId}`;
      setAlertStates((current) => ({ ...current, [stateKey]: state }));
      alertsDb
        .saveAlertState(state)
        .catch((err) => console.error("[betrack] état d'alerte :", err));
    },
    []
  );

  const updateWorkforceMovement = useCallback(
    (id: string, patch: Partial<WorkforceMovement>) => {
      const result = workforceLogic.updateMovement(movementsRef.current, id, patch, DEMO_USER);
      movementsRef.current = result.movements;
      setMovements(result.movements);
      persistAudit(result.auditEntries);
      workforceDb
        .saveMovements(result.movements)
        .catch((err) => console.error("[betrack] mouvement :", err));
      return result.movement;
    },
    [persistAudit]
  );

  const createWorkforceMovement = useCallback(
    (input: Omit<WorkforceMovement, "id">) => {
      const result = workforceLogic.createMovement(movementsRef.current, input, DEMO_USER);
      movementsRef.current = result.movements;
      setMovements(result.movements);
      persistAudit(result.auditEntries);
      workforceDb
        .saveMovements(result.movements)
        .catch((err) => console.error("[betrack] mouvement :", err));
      return result.movement;
    },
    [persistAudit]
  );

  /** Validation RH : statut Réalisé + date réelle + flag hrValidated, en un clic. */
  const validateMovement = useCallback(
    (id: string) => {
      const result = workforceLogic.validateMovement(movementsRef.current, id, DEMO_USER);
      movementsRef.current = result.movements;
      setMovements(result.movements);
      persistAudit(result.auditEntries);
      workforceDb
        .saveMovements(result.movements)
        .catch((err) => console.error("[betrack] mouvement :", err));
      return result.movement;
    },
    [persistAudit]
  );

  const deleteWorkforceMovement = useCallback(
    (id: string) => {
      const result = workforceLogic.deleteMovement(movementsRef.current, id, DEMO_USER);
      movementsRef.current = result.movements;
      setMovements(result.movements);
      persistAudit(result.auditEntries);
      workforceDb
        .saveMovements(result.movements)
        .catch((err) => console.error("[betrack] mouvement :", err));
    },
    [persistAudit]
  );

  /** Créé (import Excel, recrutement intégré) ou met à jour (édition inline) un employé. */
  const upsertEmployee = useCallback(
    (input: Employee | (Omit<Employee, "id"> & { id?: string })) => {
      const result = workforceLogic.upsertEmployee(employeesRef.current, input, DEMO_USER);
      employeesRef.current = result.employees;
      setEmployees(result.employees);
      persistAudit(result.auditEntries);
      workforceDb
        .saveEmployees(result.employees)
        .catch((err) => console.error("[betrack] employé :", err));
      return result.employee;
    },
    [persistAudit]
  );

  const updateDepartment = useCallback((name: string, patch: Partial<Department>) => {
    const currentMeta = workforceMetaRef.current ?? workforceSeed().meta;
    const departments = currentMeta.departments.map((d) =>
      d.name === name ? { ...d, ...patch } : d
    );
    const nextMeta = { ...currentMeta, departments };
    workforceMetaRef.current = nextMeta;
    setWorkforceMeta(nextMeta);
    workforceDb
      .saveWorkforceMeta(nextMeta)
      .catch((err) => console.error("[betrack] workforce meta :", err));
    return departments.find((d) => d.name === name)!;
  }, []);

  const resetToMockData = useCallback(async () => {
    setProgramConfig(programSeed());
    await Promise.all([
      leversDb
        .forceReseedLevers(lockedSeed())
        .catch((err) => console.error("[betrack] échec du reset Firestore des leviers :", err)),
      workforceDb
        .forceReseedWorkforce(workforceSeed())
        .catch((err) => console.error("[betrack] échec du reset Firestore workforce :", err)),
      programDb
        .forceReseedProgram(programSeed(), companyId)
        .catch((err) => console.error("[betrack] échec du reset Firestore programme :", err)),
    ]);
  }, [companyId]);

  return {
    ...data,
    getComments: (leverId: string) => comments[leverId] ?? [],
    getLeverById: (id: string) => data.levers.find((l) => l.id === id),
    updateLever,
    createLever,
    upsertLeverByCode,
    createAction,
    updateAction,
    deleteAction,
    applyCascadeShift,
    addComment,
    createManualAlert,
    setAlertResolved,
    updateWorkforceMovement,
    createWorkforceMovement,
    validateMovement,
    deleteWorkforceMovement,
    upsertEmployee,
    updateDepartment,
    resetToMockData,
  };
}
