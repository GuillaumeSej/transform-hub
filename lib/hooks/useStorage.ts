"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as leversLogic from "@/lib/leversLogic";
import * as leversDb from "@/lib/firestore/levers";
import * as workforceLogic from "@/lib/workforceLogic";
import * as workforceDb from "@/lib/firestore/workforce";
import { deriveWorkforceBaseline, withDerivedWorkforceBaseline } from "@/lib/hrEngine";
import * as alertsDb from "@/lib/firestore/alerts";
import * as programDb from "@/lib/firestore/programConfig";
import {
  ensureAdminSeeded,
  subscribeCompanies,
  subscribeHierarchyNodes,
  subscribeLifecycleConfig,
} from "@/lib/firestore/admin";
import { DEFAULT_LIFECYCLE_STAGES } from "@/lib/status-config";
import { derivePnlAccounts } from "@/lib/hierarchyLogic";
import { migrateLeversImpacts } from "@/lib/leverImpactMigration";
import type { CascadeShift } from "@/lib/engine";
import { mockData } from "@/data/mockData";
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
  LifecycleStage,
  ManualAlertInput,
  WorkforceMovement,
  Workstream,
} from "@/types";

const DEMO_USER = "Utilisateur démo";

/** Périmètre workforce vide — état initial/fallback pour une entreprise qui n'a pas (encore) de
 *  document workforce dans Firestore. Remplace l'ancien `workforceSeed()` qui retombait sur
 *  `mockData.workforce` : une entreprise fraîchement créée doit démarrer sans aucune donnée RH
 *  démo, pas avec les employés/mouvements d'Acme. */
function emptyWorkforceMeta(): workforceDb.WorkforceMeta {
  return {
    totalFTE: 0,
    massSalary: 0,
    budgetSalary: 0,
    departments: [],
    countryBaselines: [],
    workstreamBaselines: [],
  };
}

/** Config programme neutre — état initial/fallback tant que le document Firestore de
 *  l'entreprise (`meta/program__{companyId}`) n'a pas encore répondu ou n'existe pas. Remplace
 *  l'ancien `programSeed()` qui retombait sur `mockData.program`/`mockData.workstreams` : voir
 *  lib/firestore/programConfig.ts pour le retrait de l'auto-seed implicite correspondant. */
function emptyProgramConfig(): programDb.ProgramSeed {
  return {
    program: {
      id: "",
      name: "",
      sponsor: "",
      target: 0,
      currency: "EUR",
      fyStart: "",
      fyEnd: "",
      baselineEBIT: 0,
      revenue: 0,
    },
    workstreams: [],
  };
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
 *
 * `currentUser` (optionnel, round "cascade de validation") : la plupart des mutations ci-dessous
 * attribuent encore leurs entrées d'audit à `DEMO_USER` (limitation pré-existante, hors périmètre
 * de ce round) — mais `requestLeverApproval`/`approveLeverGate`/`rejectLeverApproval` ont
 * BESOIN du profil réel de l'utilisateur (nom, username, rôles, admin) pour vérifier qui a le
 * droit d'agir sur la demande de validation (voir `lib/leversLogic.ts`). Les appelants qui
 * n'utilisent pas ces 3 fonctions peuvent continuer à omettre ce paramètre sans rien changer à
 * leur comportement actuel.
 */
export function useBeTrackData(companyId?: string | null, currentUser?: AuthUser | null) {
  // État initial VIDE — aucune donnée mock/démo n'est injectée ici : une entreprise démarre sans
  // leviers/programme/commentaires/audit tant que sa souscription Firestore n'a pas répondu (ou
  // tant qu'elle n'a rien créé elle-même). Voir lib/firestore/levers.ts, programConfig.ts,
  // workforce.ts et alerts.ts pour le retrait des anciens mécanismes d'auto-seed implicite
  // (`ensure*Seeded`) qui écrivaient `data/mockData.ts` dans les documents Firestore de N'IMPORTE
  // QUELLE entreprise comme simple effet de bord d'un chargement de page.
  const [levers, setLevers] = useState<Lever[]>([]);
  // true dès la première réponse Firestore de subscribeLevers (succès ou vide) — même pattern
  // que `usePerformanceProgramSelector`'s `loaded`. Permet aux pages de distinguer "pas encore
  // chargé" de "vraiment inexistant" et d'éviter un flash "Levier introuvable" juste après la
  // création d'un levier, le temps que la page de détail reçoive sa propre souscription.
  const [leversLoaded, setLeversLoaded] = useState(false);
  const [programConfig, setProgramConfig] = useState<programDb.ProgramSeed>(() =>
    emptyProgramConfig()
  );
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [audit, setAudit] = useState<AuditEntry[]>([]);
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
  const programConfigRef = useRef(programConfig);
  programConfigRef.current = programConfig;
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

  // Référentiel de cycle de vie de CHAQUE programme porteur de leviers (`lifecycleConfigs/
  // {programId}`, même source et même repli sur `DEFAULT_LIFECYCLE_STAGES` que
  // `useLifecycleLabels`) : les portes de validation effectives d'un levier sont les étapes
  // « validation requise » de SON programme (voir `gatedStatusesFor`, lib/status-config.ts).
  // Tant que la config d'un programme n'a pas répondu, aucune option n'est passée à
  // `leversLogic` → repli sur les 3 portes historiques (le plus strict).
  const [lifecycleByProgram, setLifecycleByProgram] = useState<Record<string, LifecycleStage[]>>(
    {}
  );
  const lifecycleByProgramRef = useRef(lifecycleByProgram);
  lifecycleByProgramRef.current = lifecycleByProgram;
  const leverProgramIdsKey = useMemo(
    () =>
      Array.from(new Set(levers.map((l) => l.programId).filter(Boolean)))
        .sort()
        .join("|"),
    [levers]
  );
  useEffect(() => {
    if (!leverProgramIdsKey) return;
    const unsubs = leverProgramIdsKey.split("|").map((programId) =>
      subscribeLifecycleConfig(programId, (fetched) =>
        setLifecycleByProgram((prev) => ({
          ...prev,
          [programId]: fetched.length > 0 ? fetched : DEFAULT_LIFECYCLE_STAGES,
        }))
      )
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [leverProgramIdsKey]);
  const workflowOptionsFor = useCallback((leverId: string): leversLogic.LeverWorkflowOptions => {
    const programId = leversRef.current.find((l) => l.id === leverId)?.programId;
    const lifecycleStages = programId ? lifecycleByProgramRef.current[programId] : undefined;
    return lifecycleStages ? { lifecycleStages } : {};
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubscribers: (() => void)[] = [];

    void (async () => {
      try {
        // Plus aucun seed implicite de données démo ici (voir le commentaire sur l'état initial
        // ci-dessus) — seule `ensureAdminSeeded` reste automatique, et UNIQUEMENT pour un admin
        // global (`companyId` null/undefined, voir la convention `byCompany` dans
        // lib/firestore/levers.ts et le commentaire de tête de lib/firestore/admin.ts) : elle fait
        // un `getDocs` non filtré sur `companies`/`programs`, que `firestore.rules` rejette en
        // bloc (permission-denied) pour tout utilisateur scopé à une entreprise — voir
        // `canReadCompanyScoped`. L'appeler pour un utilisateur normal ne faisait donc que jeter
        // une exception avalée ci-dessous à chaque chargement, sans jamais rien seeder.
        // `migrateCompanyIds` (migration ponctuelle historique) est retirée du chargement
        // automatique pour la même raison : son `getDocs(leversCol())` non filtré échoue
        // systématiquement pour un utilisateur scopé et ne pose jamais son flag "done", donc elle
        // re-tentait — et re-échouait — à chaque page vue. Elle reste disponible dans
        // lib/firestore/levers.ts pour un déclenchement manuel/admin si un rattrapage est encore
        // nécessaire.
        if (!companyId) await ensureAdminSeeded();
      } catch (err) {
        // Les subscriptions sont tout de même tentées : si la lecture est autorisée mais pas
        // l'admin-seed, elles peuplent l'état dès que Firestore répond.
        console.warn(
          "[betrack] Firestore indisponible, utilisation du jeu de données local :",
          err
        );
      }
      if (cancelled) return;

      unsubscribers.push(
        leversDb.subscribeLevers((l) => {
          if (cancelled) return;
          setLevers(l);
          setLeversLoaded(true);
        }, companyId),
        leversDb.subscribeComments((c) => !cancelled && setComments(c), companyId),
        leversDb.subscribeAuditLog((a) => !cancelled && setAudit(a), companyId),
        workforceDb.subscribeEmployees((e) => !cancelled && setEmployees(e), companyId),
        workforceDb.subscribeMovements((m) => !cancelled && setMovements(m), companyId),
        workforceDb.subscribeWorkforceMeta((m) => !cancelled && setWorkforceMeta(m), companyId),
        alertsDb.subscribeAlerts((a) => !cancelled && setAlerts(a), companyId),
        alertsDb.subscribeAlertStates((s) => !cancelled && setAlertStates(s), companyId),
        subscribeCompanies((items) => !cancelled && setCompanies(items), companyId),
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

  const persistAudit = useCallback(
    (entries: AuditEntry[]) => {
      if (entries.length === 0) return;
      const next = [...entries.slice().reverse(), ...auditRef.current];
      auditRef.current = next;
      setAudit(next);
      leversDb
        .saveAuditLog(companyId, next)
        .catch((err) => console.error("[betrack] audit :", err));
    },
    [companyId]
  );

  const data = useMemo(
    () => {
      const company = companies.find((item) => item.id === companyId);
      // L'ancien enrichissement démo (actions + impacts fabriqués pour les leviers à macro-valeurs
      // seules) n'est plus appliqué à la lecture : les leviers sans impact gardent leurs valeurs
      // manuelles.
      // Migration idempotente à la lecture : impacts d'actions -> impacts de levier (persistée
      // paresseusement au prochain save du levier).
      const migratedLevers = migrateLeversImpacts(levers);
      return {
        program: programConfig.program,
        workstreams: programConfig.workstreams,
        levers: migratedLevers,
        // Reconstruit au format Workforce historique pour ne pas casser les consommateurs
        // existants — mais la donnée vit désormais dans Firestore (temps réel partagé). Tant que
        // `workforceMeta` n'a pas encore été chargé (ou qu'aucun document workforce n'existe pour
        // cette entreprise), on retombe sur un périmètre VIDE — jamais sur `mockData.workforce` :
        // voir emptyWorkforceMeta() plus haut.
        // Baseline absente (entreprise neuve, base saisie sans méta) : dérivée des employés
        // (`withDerivedWorkforceBaseline`, lib/hrEngine.ts) — une méta explicite reste prioritaire.
        workforce: withDerivedWorkforceBaseline({
          ...(workforceMeta ?? emptyWorkforceMeta()),
          employees,
          movements,
        }),
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
      const result = leversLogic.updateLever(
        leversRef.current,
        id,
        patch,
        DEMO_USER,
        workflowOptionsFor(id)
      );
      leversRef.current = result.levers;
      setLevers(result.levers);
      persistAudit(result.auditEntries);
      leversDb.saveLever(result.lever).catch((err) => console.error("[betrack] lever :", err));
      return result.lever;
    },
    [persistAudit, workflowOptionsFor]
  );

  /** Point d'entrée UI de la demande de validation (voir lib/leversLogic.ts pour la logique
   *  métier complète) — appelable seulement par le porteur du levier ou un admin, sur l'un des
   *  statuts éligibles (voir `GATE_BY_STATUS`). Lève si `currentUser` n'a pas été fourni au hook
   *  (voir doc-comment ci-dessus) : ce point d'entrée n'a de sens qu'avec un utilisateur réel
   *  identifié. */
  const requestLeverApproval = useCallback(
    (id: string, users?: leversLogic.LeverDirectoryUser[]) => {
      if (!currentUser)
        throw new Error(
          "Utilisateur non identifié : impossible de soumettre la demande de validation"
        );
      // Chaîne de validation snapshotée à la demande (double validation hiérarchique) : les
      // chantiers et l'annuaire (`users`, fourni par l'appelant) résolvent les titulaires.
      const result = leversLogic.requestLeverApproval(leversRef.current, id, currentUser, {
        ...workflowOptionsFor(id),
        workstreams: programConfig.workstreams,
        users,
      });
      leversRef.current = result.levers;
      setLevers(result.levers);
      persistAudit(result.auditEntries);
      leversDb.saveLever(result.lever).catch((err) => console.error("[betrack] lever :", err));
      return result.lever;
    },
    [persistAudit, currentUser, workflowOptionsFor, programConfig.workstreams]
  );

  const approveLeverGate = useCallback(
    (id: string) => {
      if (!currentUser)
        throw new Error("Utilisateur non identifié : impossible d'approuver cette demande");
      const result = leversLogic.approveLeverGate(
        leversRef.current,
        id,
        currentUser,
        programConfig.workstreams
      );
      leversRef.current = result.levers;
      setLevers(result.levers);
      persistAudit(result.auditEntries);
      leversDb.saveLever(result.lever).catch((err) => console.error("[betrack] lever :", err));
      return result.lever;
    },
    [persistAudit, currentUser, programConfig.workstreams]
  );

  const rejectLeverApproval = useCallback(
    (id: string, reason?: string) => {
      if (!currentUser)
        throw new Error("Utilisateur non identifié : impossible de rejeter cette demande");
      const result = leversLogic.rejectLeverApproval(
        leversRef.current,
        id,
        currentUser,
        reason,
        programConfig.workstreams
      );
      leversRef.current = result.levers;
      setLevers(result.levers);
      persistAudit(result.auditEntries);
      leversDb.saveLever(result.lever).catch((err) => console.error("[betrack] lever :", err));
      return result.lever;
    },
    [persistAudit, currentUser, programConfig.workstreams]
  );

  // Suppression à double validation (CTO ↔ responsable de chantier) — voir
  // lib/leversLogic.ts::requestLeverDeletion/approveLeverDeletion/cancelLeverDeletion.
  const requestLeverDeletion = useCallback(
    (id: string, reason?: string, users?: leversLogic.LeverDirectoryUser[]) => {
      if (!currentUser) throw new Error("Utilisateur non identifié");
      const result = leversLogic.requestLeverDeletion(
        leversRef.current,
        id,
        currentUser,
        programConfig.workstreams,
        reason,
        users
      );
      leversRef.current = result.levers;
      setLevers(result.levers);
      persistAudit(result.auditEntries);
      leversDb.saveLever(result.lever).catch((err) => console.error("[betrack] lever :", err));
      return result.lever;
    },
    [persistAudit, currentUser, programConfig.workstreams]
  );

  const approveLeverDeletion = useCallback(
    async (id: string, users?: leversLogic.LeverDirectoryUser[]) => {
      if (!currentUser) throw new Error("Utilisateur non identifié");
      const result = leversLogic.approveLeverDeletion(
        leversRef.current,
        id,
        currentUser,
        programConfig.workstreams,
        users
      );
      // Non optimiste : on attend Firestore avant de retirer le levier de l'écran.
      await leversDb.deleteLeverDoc(id);
      leversRef.current = result.levers;
      setLevers(result.levers);
      persistAudit(result.auditEntries);
      return result.deleted;
    },
    [persistAudit, currentUser, programConfig.workstreams]
  );

  const cancelLeverDeletion = useCallback(
    (id: string, users?: leversLogic.LeverDirectoryUser[]) => {
      if (!currentUser) throw new Error("Utilisateur non identifié");
      const result = leversLogic.cancelLeverDeletion(
        leversRef.current,
        id,
        currentUser,
        programConfig.workstreams,
        users
      );
      leversRef.current = result.levers;
      setLevers(result.levers);
      persistAudit(result.auditEntries);
      leversDb.saveLever(result.lever).catch((err) => console.error("[betrack] lever :", err));
      return result.lever;
    },
    [persistAudit, currentUser, programConfig.workstreams]
  );

  /** Création NON optimiste (contrairement aux autres mutations de ce hook) : l'écriture Firestore
   *  est attendue AVANT de mettre à jour l'état local et le journal d'audit, et toute erreur est
   *  propagée à l'appelant. Sinon un refus des règles (ex. levier sans `companyId`, id déjà pris
   *  par une autre entreprise) affichait « Levier créé », redirigeait vers une fiche introuvable
   *  et laissait une entrée d'audit fantôme. `companyId` est rattaché ici depuis le hook quand
   *  l'appelant ne le fournit pas : un levier ne peut pas exister sans entreprise. */
  const createLever = useCallback(
    async (input: Omit<Lever, "id" | "createdAt" | "lastUpdate">): Promise<Lever> => {
      const scopedCompanyId = input.companyId ?? companyId;
      if (!scopedCompanyId)
        throw new Error("Aucune entreprise active : impossible de créer un levier");
      const result = leversLogic.createLever(
        leversRef.current,
        { ...input, companyId: scopedCompanyId },
        DEMO_USER
      );
      await leversDb.saveLever(result.lever);
      // La souscription Firestore a pu livrer le nouveau levier pendant l'attente : ne pas le
      // dupliquer, et repartir de l'état le plus récent plutôt que de `result.levers`.
      if (!leversRef.current.some((l) => l.id === result.lever.id)) {
        leversRef.current = [...leversRef.current, result.lever];
        setLevers(leversRef.current);
      }
      persistAudit(result.auditEntries);
      return result.lever;
    },
    [persistAudit, companyId]
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

  /** Import Excel en masse (leviers + actions + impacts) — voir lib/leverExcelImport.ts pour la
   *  validation/construction des lignes en amont. Un seul writeBatch Firestore pour tout le lot. */
  /** Non optimiste, comme `createLever` : l'écriture Firestore est attendue avant de mettre à
   *  jour l'écran et l'audit, et une erreur est propagée à l'appelant — sinon l'import affichait
   *  « Import Excel terminé » alors que rien n'était enregistré. */
  const importLevers = useCallback(
    async (inputs: Omit<Lever, "id" | "createdAt" | "lastUpdate">[]) => {
      const result = leversLogic.bulkUpsertLeversByCode(leversRef.current, inputs, DEMO_USER);
      await leversDb.saveLeversBatch(result.changedLevers);
      // La souscription Firestore a pu livrer une partie des écritures pendant l'attente :
      // repartir de l'état le plus récent et y remplacer/ajouter les leviers écrits.
      const changedById = new Map(result.changedLevers.map((l) => [l.id, l]));
      const next = leversRef.current.map((l) => changedById.get(l.id) ?? l);
      for (const l of result.changedLevers) if (!next.some((x) => x.id === l.id)) next.push(l);
      leversRef.current = next;
      setLevers(next);
      persistAudit(result.auditEntries);
      return result;
    },
    [persistAudit]
  );

  /** Ajoute des workstreams (upsert par id) au ProgramConfig de l'entreprise courante — aucune UI
   *  dédiée de gestion des workstreams n'existe aujourd'hui (voir lib/firestore/programConfig.ts),
   *  cette fonction est utilisée par l'import Excel des leviers pour auto-créer les workstreams
   *  référencés par un fichier mais absents de l'entreprise (voir lib/leverExcelImport.ts,
   *  LeverImportPreview.toCreateWorkstreams). */
  const addWorkstreams = useCallback(
    async (newOnes: Workstream[]) => {
      if (newOnes.length === 0) return;
      const prev = programConfigRef.current;
      const byId = new Map(prev.workstreams.map((w) => [w.id, w]));
      for (const w of newOnes) byId.set(w.id, w);
      const next = { ...prev, workstreams: Array.from(byId.values()) };
      // Attendue (et propagée en cas d'échec) : l'import écrit les leviers APRÈS les chantiers
      // qu'ils référencent, et ne doit pas annoncer un succès si ceux-ci n'ont pas été créés.
      await programDb.saveProgramConfig(next, companyId);
      programConfigRef.current = next;
      setProgramConfig(next);
    },
    [companyId]
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
    (leverId: string, text: string, user: AuthUser) => {
      const result = leversLogic.addComment(commentsRef.current, leverId, text, user.name);
      commentsRef.current = result.comments;
      setComments(result.comments);
      persistAudit([result.auditEntry]);
      leversDb
        .saveComments(companyId, result.comments)
        .catch((err) => console.error("[betrack] commentaire :", err));
      return result.leverComments;
    },
    [persistAudit, companyId]
  );

  const createManualAlert = useCallback((input: ManualAlertInput, user: AuthUser) => {
    const createdAt = new Date().toISOString();
    const alert: Alert = {
      ...input,
      id: `MANUAL-${crypto.randomUUID()}`,
      ts: createdAt,
      // Simple champ d'audit (string libre, pas le type Role) — priorité aux habilitations admin,
      // sinon le premier profil métier de l'utilisateur (round multi-profils).
      actorRole: user.isGlobalAdmin
        ? "admin"
        : user.isCompanyAdmin
          ? "admin_entreprise"
          : (user.profiles[0]?.role ?? "inconnu"),
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
        .saveMovements(companyId, result.movements)
        .catch((err) => console.error("[betrack] mouvement :", err));
      return result.movement;
    },
    [persistAudit, companyId]
  );

  const createWorkforceMovement = useCallback(
    (input: Omit<WorkforceMovement, "id">) => {
      const result = workforceLogic.createMovement(movementsRef.current, input, DEMO_USER);
      movementsRef.current = result.movements;
      setMovements(result.movements);
      persistAudit(result.auditEntries);
      workforceDb
        .saveMovements(companyId, result.movements)
        .catch((err) => console.error("[betrack] mouvement :", err));
      return result.movement;
    },
    [persistAudit, companyId]
  );

  /** Validation RH : statut Réalisé + date réelle + flag hrValidated, en un clic. */
  const validateMovement = useCallback(
    (id: string) => {
      const result = workforceLogic.validateMovement(movementsRef.current, id, DEMO_USER);
      movementsRef.current = result.movements;
      setMovements(result.movements);
      persistAudit(result.auditEntries);
      workforceDb
        .saveMovements(companyId, result.movements)
        .catch((err) => console.error("[betrack] mouvement :", err));
      return result.movement;
    },
    [persistAudit, companyId]
  );

  const deleteWorkforceMovement = useCallback(
    (id: string) => {
      const result = workforceLogic.deleteMovement(movementsRef.current, id, DEMO_USER);
      movementsRef.current = result.movements;
      setMovements(result.movements);
      persistAudit(result.auditEntries);
      workforceDb
        .saveMovements(companyId, result.movements)
        .catch((err) => console.error("[betrack] mouvement :", err));
    },
    [persistAudit, companyId]
  );

  /** Créé (import Excel, recrutement intégré) ou met à jour (édition inline) un employé. */
  const upsertEmployee = useCallback(
    (input: Employee | (Omit<Employee, "id"> & { id?: string })) => {
      const result = workforceLogic.upsertEmployee(employeesRef.current, input, DEMO_USER);
      employeesRef.current = result.employees;
      setEmployees(result.employees);
      persistAudit(result.auditEntries);
      workforceDb
        .saveEmployees(companyId, result.employees)
        .catch((err) => console.error("[betrack] employé :", err));
      return result.employee;
    },
    [persistAudit, companyId]
  );

  /** Renommage réel d'un matricule (voir `workforceLogic.renameEmployee`) — NON optimiste :
   *  l'écriture (employés + mouvements repointés, un seul batch) est attendue et toute erreur
   *  (matricule déjà pris, écriture refusée) est propagée à l'appelant. */
  const renameEmployee = useCallback(
    async (oldId: string, newId: string) => {
      const result = workforceLogic.renameEmployee(
        employeesRef.current,
        movementsRef.current,
        oldId,
        newId,
        DEMO_USER
      );
      if (result.employee.id === oldId) return result;
      await workforceDb.saveWorkforceBatch(companyId, {
        employees: result.employees,
        ...(result.movedMovements > 0 ? { movements: result.movements } : {}),
      });
      employeesRef.current = result.employees;
      setEmployees(result.employees);
      if (result.movedMovements > 0) {
        movementsRef.current = result.movements;
        setMovements(result.movements);
      }
      persistAudit(result.auditEntries);
      return result;
    },
    [persistAudit, companyId]
  );

  /** Import Excel RH en masse (voir `lib/hrExcel.ts::buildHrImportPlan`) — NON optimiste : une
   *  seule écriture groupée (liste employés + liste mouvements + baseline recalculée) attendue
   *  avant de mettre à jour l'écran ; une erreur est propagée (l'appelant affiche un toast
   *  d'échec au lieu d'un faux « Import terminé »). */
  const importWorkforce = useCallback(
    async (importedEmployees: Employee[], importedMovements: WorkforceMovement[]) => {
      const result = workforceLogic.mergeWorkforceImport(
        employeesRef.current,
        movementsRef.current,
        importedEmployees,
        importedMovements,
        DEMO_USER
      );
      const employeesChanged = importedEmployees.length > 0;
      const meta = employeesChanged
        ? workforceLogic.mergeDerivedWorkforceBaseline(
            workforceMetaRef.current ?? emptyWorkforceMeta(),
            deriveWorkforceBaseline(result.employees)
          )
        : undefined;
      await workforceDb.saveWorkforceBatch(companyId, {
        ...(employeesChanged ? { employees: result.employees } : {}),
        ...(importedMovements.length > 0 ? { movements: result.movements } : {}),
        ...(meta ? { meta } : {}),
      });
      if (employeesChanged) {
        employeesRef.current = result.employees;
        setEmployees(result.employees);
      }
      if (importedMovements.length > 0) {
        movementsRef.current = result.movements;
        setMovements(result.movements);
      }
      if (meta) {
        workforceMetaRef.current = meta;
        setWorkforceMeta(meta);
      }
      persistAudit(result.auditEntries);
      return result;
    },
    [persistAudit, companyId]
  );

  const updateDepartment = useCallback(
    (name: string, patch: Partial<Department>) => {
      const currentMeta = workforceMetaRef.current ?? emptyWorkforceMeta();
      const departments = currentMeta.departments.map((d) =>
        d.name === name ? { ...d, ...patch } : d
      );
      const nextMeta = { ...currentMeta, departments };
      workforceMetaRef.current = nextMeta;
      setWorkforceMeta(nextMeta);
      workforceDb
        .saveWorkforceMeta(companyId, nextMeta)
        .catch((err) => console.error("[betrack] workforce meta :", err));
      return departments.find((d) => d.name === name)!;
    },
    [companyId]
  );

  return {
    ...data,
    // true dès la première réponse Firestore de subscribeLevers — voir le commentaire sur
    // useState ci-dessus. Les consommateurs (ex. LeverDetailClientPerformance) l'utilisent pour
    // distinguer "en cours de chargement" de "levier introuvable".
    leversLoaded,
    getComments: (leverId: string) => comments[leverId] ?? [],
    getLeverById: (id: string) => data.levers.find((l) => l.id === id),
    updateLever,
    requestLeverApproval,
    approveLeverGate,
    rejectLeverApproval,
    requestLeverDeletion,
    approveLeverDeletion,
    cancelLeverDeletion,
    createLever,
    upsertLeverByCode,
    importLevers,
    addWorkstreams,
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
    renameEmployee,
    importWorkforce,
    updateDepartment,
  };
}
