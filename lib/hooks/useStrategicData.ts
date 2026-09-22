"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  subscribeStrategicAxes,
  saveStrategicAxis,
  deleteStrategicAxis,
} from "@/lib/firestore/strategicAxes";
import { subscribeChantiers, saveChantier, deleteChantier } from "@/lib/firestore/chantiers";
import {
  subscribeChantierActions,
  saveChantierAction,
  deleteChantierAction,
} from "@/lib/firestore/chantierActions";
import { subscribeIndicators, saveIndicator, deleteIndicator } from "@/lib/firestore/indicators";
import {
  subscribeIndicatorMeasurements,
  saveIndicatorMeasurement,
  deleteIndicatorMeasurement,
} from "@/lib/firestore/indicatorMeasurements";
import {
  subscribeChantierStaffing,
  saveChantierStaffing,
  deleteChantierStaffing,
} from "@/lib/firestore/chantierStaffing";
import { subscribeUsers, subscribeCompanies } from "@/lib/firestore/admin";
import { appendAuditEntries } from "@/lib/firestore/levers";
import {
  approveMilestoneGate as approveMilestoneGateLogic,
  computeIndicatorStatus,
  rejectMilestoneApproval as rejectMilestoneApprovalLogic,
  requestMilestoneApproval as requestMilestoneApprovalLogic,
  resolveStrategicOwnershipScope,
  resolveStrategicRoleForProgram,
  type StrategicOwnershipScope,
} from "@/lib/axisLogic";
import { isLeverVisibleForClearance, resolveConfidentialityClearance } from "@/lib/leversLogic";
import { isAnyAdmin } from "@/lib/roleProfiles";
import {
  buildUpdateAuditEntries,
  makeCreatedAuditEntry,
  makeDeletedAuditEntry,
} from "@/lib/strategicAuditLogic";
import type {
  AuditEntry,
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierStaffing,
  Company,
  Indicator,
  IndicatorMeasurement,
  Role,
  StrategicAxis,
} from "@/types";

/** Journalise en tâche de fond, sans jamais faire échouer la mutation appelante si l'écriture du
 *  journal d'audit échoue (même parti pris que `persistAudit` dans `lib/hooks/useStorage.ts`,
 *  simple `.catch` + log plutôt qu'une erreur remontée à l'appelant). */
function logAudit(companyId: string | null | undefined, entries: AuditEntry[]): void {
  if (entries.length === 0) return;
  appendAuditEntries(companyId, entries).catch((err) =>
    console.error("[betrack] audit stratégique :", err)
  );
}

/**
 * Point d'accès React unique aux données du Plan Stratégique (axes / chantiers / actions /
 * indicateurs / mesures / staffing), pour UNE entreprise et UN programme. Pendant stratégique de
 * `useBeTrackData` (lib/hooks/useStorage.ts), volontairement beaucoup plus simple : pas de seed,
 * pas de migration, pas de repli mockData — le Plan Stratégique est une fonctionnalité neuve, il
 * n'y a aucune donnée historique à rattraper.
 *
 * Scoping : les abonnements Firestore filtrent par `companyId` côté serveur (voir
 * `lib/firestore/strategicAxes.ts`), le filtrage par `programId` est appliqué ici côté client —
 * un utilisateur ne charge donc que sa propre entreprise, et bascule de programme sans re-souscrire.
 *
 * Les méthodes de mutation écrivent directement dans Firestore et laissent l'abonnement
 * `onSnapshot` rafraîchir l'état (pas de mise à jour optimiste, contrairement à `useBeTrackData` :
 * les volumes sont petits et les écrans stratégiques n'ont pas d'édition en rafale à absorber).
 */

function nowDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export type StrategicData = {
  axes: StrategicAxis[];
  chantiers: Chantier[];
  chantierActions: ChantierAction[];
  indicators: Indicator[];
  measurements: IndicatorMeasurement[];
  /** Lignes de staffing (ETP par fonction) des chantiers du programme actif. */
  staffing: ChantierStaffing[];
  /** Utilisateurs de l'entreprise (`companyId`) — source unique pour `UserPicker`, RACI, sponsor/
   *  pilote de chantier, owner/sponsor d'action (round 4). Abonnement INDÉPENDANT, voir plus bas :
   *  volontairement PAS dans `pending`/`loading`, c'est une commodité additive et non une donnée
   *  cœur du plan (le contenu du plan reste affichable sans elle). */
  users: AuthUser[];
  /** true tant que les six abonnements du plan n'ont pas tous répondu au moins une fois. */
  loading: boolean;

  /** Rôle Plan Stratégique EFFECTIF de l'utilisateur pour CE programme (round 25) — voir
   *  `resolveStrategicRoleForProgram`, lib/axisLogic.ts. `undefined` si l'appelant n'a pas activé
   *  le filtrage (`user` omis, voir le paramètre `user` ci-dessous) ou si l'utilisateur n'a aucun
   *  profil stratégique. Exposé pour les écrans qui ont besoin de distinguer un rôle PRÉCIS (ex.
   *  gating du clic sur les puces d'indicateur pour `axis_sponsor`, `StrategicDashboardView.tsx`)
   *  plutôt que la simple forme "restreint/pas restreint" d'`ownershipScope` ci-dessous. */
  strategicRole: Role | undefined;
  /** Périmètre de visibilité par propriétaire nommé (round 25) déjà appliqué aux projections
   *  ci-dessus (`axes`/`chantiers`/`indicators`/`staffing`) — exposé BRUT en plus pour les
   *  appelants qui ont besoin de la distinction fine (ex. `clickableActionIds` ci-dessous). Voir
   *  `resolveStrategicOwnershipScope`, lib/axisLogic.ts. */
  ownershipScope: StrategicOwnershipScope;
  /** Projets réellement CLIQUABLES/ouvrables pour l'utilisateur courant — `"all"` (aucune
   *  restriction, le cas de TOUS les rôles sauf `chantier_contributor`) ou l'ensemble précis de
   *  leurs propres `ChantierAction.id`. Round 25, cas `chantier_contributor` : un projet peut être
   *  VISIBLE (présent dans `chantierActions` ci-dessus, parce qu'il appartient à un chantier où ce
   *  contributeur a au moins un projet à lui) sans être CLIQUABLE (ce n'est pas SON projet) — cette
   *  distinction ne peut pas être un simple filtrage de liste (l'UI doit continuer à RENDRE le
   *  projet, juste le rendre inerte au clic), d'où ce champ séparé plutôt que de le fusionner dans
   *  `chantierActions`. Consommé par `ProgramRoadmap.tsx`/`AxisChantierProjetAccordion.tsx`/
   *  `ProjetMilestoneBoard.tsx`. */
  clickableActionIds: Set<string> | "all";

  // ── Mutations ──────────────────────────────────────────────────────────────────────────────
  createAxis: (
    input: Pick<StrategicAxis, "name" | "stage"> &
      Partial<Pick<StrategicAxis, "description" | "owner" | "color" | "confidentialityLevel">>
  ) => Promise<StrategicAxis>;
  updateAxis: (id: string, patch: Partial<StrategicAxis>) => Promise<void>;
  removeAxis: (id: string) => Promise<void>;

  createChantier: (
    input: Pick<Chantier, "axisIds" | "name" | "stage"> &
      Partial<Pick<Chantier, "description" | "dependencies" | "confidentialityLevel" | "pilote">>
  ) => Promise<Chantier>;
  updateChantier: (id: string, patch: Partial<Chantier>) => Promise<void>;
  removeChantier: (id: string) => Promise<void>;

  createChantierAction: (
    input: Pick<ChantierAction, "chantierId" | "name" | "start" | "end" | "status"> &
      Partial<Pick<ChantierAction, "description" | "owner" | "deliverables">>
  ) => Promise<ChantierAction>;
  updateChantierAction: (id: string, patch: Partial<ChantierAction>) => Promise<void>;
  removeChantierAction: (id: string) => Promise<void>;

  /** Soumet une demande de validation de jalon pour ce projet (voir
   *  `lib/axisLogic.ts::requestMilestoneApproval` pour l'habilitation et les prérequis — lève si
   *  non satisfaits). Nécessite `user` (voir le doc-comment du paramètre `user` de ce hook, plus
   *  bas) : lève si omis. */
  requestMilestoneApproval: (actionId: string) => Promise<void>;
  /** Approuve la demande en cours — fait avancer `milestones.currentMilestone`/`passedMilestones`
   *  et vide `milestoneApproval` (voir `lib/axisLogic.ts::approveMilestoneGate`). */
  approveMilestoneGate: (actionId: string) => Promise<void>;
  /** Rejette (annule) la demande en cours, sans pénalité (voir
   *  `lib/axisLogic.ts::rejectMilestoneApproval`). */
  rejectMilestoneApproval: (actionId: string) => Promise<void>;

  createIndicator: (
    input: Pick<
      Indicator,
      "axisId" | "name" | "kind" | "frequency" | "objective" | "responsibleRoles"
    > &
      Partial<
        Pick<
          Indicator,
          | "chantierId"
          | "objectiveValue"
          | "direction"
          | "unit"
          | "additionalAuthorizedUserIds"
          | "confidentialityLevel"
        >
      >
  ) => Promise<Indicator>;
  updateIndicator: (id: string, patch: Partial<Indicator>) => Promise<void>;
  removeIndicator: (id: string) => Promise<void>;

  /** Ajoute une mesure ET recalcule/persiste le statut de l'indicateur concerné — la saisie d'une
   *  mesure est le SEUL évènement qui fait bouger `Indicator.status`. */
  addMeasurement: (
    input: Pick<IndicatorMeasurement, "indicatorId" | "period" | "reportedBy"> &
      Partial<Pick<IndicatorMeasurement, "value" | "note">>
  ) => Promise<IndicatorMeasurement>;
  removeMeasurement: (id: string) => Promise<void>;

  /** Ajoute une ligne de staffing sur un chantier. Pas d'`updateStaffing` : une ligne n'a que
   *  deux champs signifiants (fonction + ETP), on la corrige en la supprimant/ressaisissant. */
  createStaffing: (
    input: Pick<ChantierStaffing, "chantierId" | "function" | "fte"> &
      Partial<Pick<ChantierStaffing, "note">>
  ) => Promise<ChantierStaffing>;
  removeStaffing: (id: string) => Promise<void>;
};

/** Identifiant d'entité : suffixe aléatoire plutôt qu'un compteur `L###` comme côté leviers — il
 *  n'y a pas de code métier lisible attendu sur ces entités, et cela évite une lecture préalable
 *  de toute la collection pour trouver le prochain numéro libre. */
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Même repli que `DEMO_USER` (`lib/hooks/useStorage.ts`) pour les mutations dont l'appelant n'a
 *  pas (encore) migré vers le paramètre `user` de ce hook (voir son doc-comment) — attribution
 *  d'audit générique plutôt que de bloquer la journalisation faute d'identité connue. */
const AUDIT_FALLBACK_USER = "Utilisateur démo";

export function useStrategicData(
  companyId: string | null | undefined,
  programId: string | null | undefined,
  /**
   * Utilisateur courant — OMIS (paramètre non passé, `undefined`) par les appelants non encore
   * migrés au masquage de confidentialité (comportement inchangé : aucun filtre appliqué, comme
   * avant l'introduction de ce paramètre). Passé explicitement (objet, ou `null` si déconnecté),
   * il ACTIVE le filtrage : axes/chantiers/indicateurs confidentiels sont masqués aux profils non
   * habilités, exactement comme `isLeverVisibleForClearance`/`resolveConfidentialityClearance`
   * (lib/leversLogic.ts) le font pour les leviers du Plan de Performance — admin/admin_entreprise
   * voient toujours tout.
   *
   * Round 25 : ce MÊME paramètre active AUSSI le filtrage par propriétaire nommé (`axis_sponsor`/
   * `chantier_owner`/`chantier_contributor`, voir `resolveStrategicOwnershipScope`,
   * lib/axisLogic.ts) — un seul et même interrupteur pour les deux mécanismes (confidentialité ET
   * ownership) plutôt qu'un second paramètre : un appelant qui a migré pour activer l'un a de toute
   * façon besoin de l'autre, aucun call site connu ne veut l'un sans l'autre. `username` est
   * désormais nécessaire (en plus des champs déjà requis pour la confidentialité) pour comparer aux
   * `owner`/`pilote` des entités.
   *
   * `name` (round audit trail Plan Stratégique) sert UNIQUEMENT à attribuer les entrées d'audit
   * (`AuditEntry.user`, voir `lib/strategicAuditLogic.ts`) à un auteur lisible — même convention
   * que `leversLogic.addComment`/`useStorage.ts::addComment`, qui utilisent `user.name` (pas
   * `username`, réservé aux comparaisons d'identité strictes). Un appelant qui omet `user` (voir
   * ci-dessus) n'active pas non plus l'attribution nominative : ses mutations sont journalisées
   * sous un auteur générique (voir `AUDIT_FALLBACK_USER` ci-dessous), exactement comme les
   * mutations Plan Performance non encore migrées à l'utilisateur réel (`DEMO_USER`,
   * `lib/hooks/useStorage.ts`).
   */
  user?: Pick<
    AuthUser,
    | "username"
    | "profiles"
    | "isGlobalAdmin"
    | "isCompanyAdmin"
    | "confidentialityClearance"
    | "name"
  > | null
): StrategicData {
  const [allAxes, setAllAxes] = useState<StrategicAxis[]>([]);
  const [allChantiers, setAllChantiers] = useState<Chantier[]>([]);
  const [allActions, setAllActions] = useState<ChantierAction[]>([]);
  const [allIndicators, setAllIndicators] = useState<Indicator[]>([]);
  const [allMeasurements, setAllMeasurements] = useState<IndicatorMeasurement[]>([]);
  const [allStaffing, setAllStaffing] = useState<ChantierStaffing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) {
      setAllAxes([]);
      setAllChantiers([]);
      setAllActions([]);
      setAllIndicators([]);
      setAllMeasurements([]);
      setAllStaffing([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // `loading` ne retombe qu'une fois les six collections arrivées : afficher un écran
    // partiellement peuplé (axes sans indicateurs) donnerait de faux compteurs "0 à risque".
    const pending = new Set([
      "axes",
      "chantiers",
      "actions",
      "indicators",
      "measurements",
      "staffing",
    ]);
    const settle = (key: string) => {
      pending.delete(key);
      if (pending.size === 0) setLoading(false);
    };

    const unsubs = [
      subscribeStrategicAxes(companyId, (v) => {
        setAllAxes(v);
        settle("axes");
      }),
      subscribeChantiers(companyId, (v) => {
        setAllChantiers(v);
        settle("chantiers");
      }),
      subscribeChantierActions(companyId, (v) => {
        setAllActions(v);
        settle("actions");
      }),
      subscribeIndicators(companyId, (v) => {
        setAllIndicators(v);
        settle("indicators");
      }),
      subscribeIndicatorMeasurements(companyId, (v) => {
        setAllMeasurements(v);
        settle("measurements");
      }),
      subscribeChantierStaffing(companyId, (v) => {
        setAllStaffing(v);
        settle("staffing");
      }),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [companyId]);

  // Abonnement utilisateurs INDÉPENDANT du bloc ci-dessus : `subscribeUsers` n'est pas scopé
  // entreprise côté serveur (voir lib/firestore/admin.ts), le filtrage par `companyId` se fait ici
  // — même pattern que `components/admin/IndicatorsEditor.tsx`. Ne participe PAS au `pending`
  // settle-set qui pilote `loading` : c'est une donnée additive (RACI, UserPicker), pas une donnée
  // cœur du plan stratégique.
  const [users, setUsers] = useState<AuthUser[]>([]);
  useEffect(() => {
    if (!companyId) {
      setUsers([]);
      return;
    }
    const unsub = subscribeUsers(
      (list) => setUsers(list.filter((u) => u.companyId === companyId)),
      companyId
    );
    return unsub;
  }, [companyId]);

  // ── Habilitation de confidentialité (masquage global, même mécanisme que le Plan Performance)
  // N'est souscrite que si l'appelant a explicitement passé `user` (voir doc du paramètre
  // ci-dessus) — les appelants non migrés ne payent aucun abonnement supplémentaire.
  const filterActive = user !== undefined;
  // Auteur attribué aux entrées d'audit des mutations ci-dessous — voir le doc-comment du
  // paramètre `user` (champ `name`) et `AUDIT_FALLBACK_USER` plus haut.
  const auditUser = user?.name ?? AUDIT_FALLBACK_USER;
  const [company, setCompany] = useState<Company | null>(null);
  useEffect(() => {
    if (!filterActive || !companyId) {
      setCompany(null);
      return;
    }
    const unsub = subscribeCompanies((companies) => {
      setCompany(companies.find((c) => c.id === companyId) ?? null);
    }, companyId);
    return unsub;
  }, [filterActive, companyId]);
  const isAdmin = isAnyAdmin(user);
  const clearance = useMemo(
    () => resolveConfidentialityClearance(user, company?.roleClearance, "strategic"),
    [user, company?.roleClearance]
  );

  // ── Périmètre de visibilité par propriétaire nommé (round 25) ─────────────────────────────
  // Même interrupteur `filterActive` que la confidentialité ci-dessus (voir le doc-comment du
  // paramètre `user`) : un appelant non migré (`user` omis) ne paie ni l'un ni l'autre. Calculé à
  // partir d'axes/chantiers/actions scopés au programme actif mais AVANT le masquage de
  // confidentialité — les deux filtres sont INDÉPENDANTS (un axe doit passer les DEUX pour être
  // visible, voir `axes`/`chantiers`/`indicators`/`staffing` ci-dessous), et `owner`/`pilote` ne
  // sont pas affectés par la confidentialité.
  const programScopedAxes = useMemo(
    () => allAxes.filter((a) => a.programId === programId),
    [allAxes, programId]
  );
  const programScopedChantiers = useMemo(
    () => allChantiers.filter((c) => c.programId === programId),
    [allChantiers, programId]
  );
  const programScopedActionsForScope = useMemo(() => {
    const ids = new Set(programScopedChantiers.map((c) => c.id));
    return allActions.filter((a) => ids.has(a.chantierId));
  }, [allActions, programScopedChantiers]);
  const strategicRole = useMemo(
    () => (filterActive ? resolveStrategicRoleForProgram(user, programId) : undefined),
    [filterActive, user, programId]
  );
  const ownershipScope: StrategicOwnershipScope = useMemo(() => {
    if (!filterActive) return { mode: "unrestricted" };
    return resolveStrategicOwnershipScope(
      user,
      programId,
      programScopedAxes,
      programScopedChantiers,
      programScopedActionsForScope
    );
  }, [
    filterActive,
    user,
    programId,
    programScopedAxes,
    programScopedChantiers,
    programScopedActionsForScope,
  ]);
  /** Voir le doc-comment de `StrategicData.clickableActionIds`. */
  const clickableActionIds: Set<string> | "all" = useMemo(() => {
    if (ownershipScope.mode === "scoped" && ownershipScope.clickableActionIds) {
      return ownershipScope.clickableActionIds;
    }
    return "all";
  }, [ownershipScope]);

  // ── Projections scopées au programme actif ────────────────────────────────────────────────
  // Le masquage de confidentialité ET le périmètre par propriétaire nommé (tous deux actifs
  // seulement quand `filterActive`) s'appliquent ICI, une seule fois pour tous les écrans
  // consommateurs (StrategicAxesView, ChantierDetailClient, KpiPageClient,
  // StrategicDashboardView, …) — les actions/mesures qui en dérivent plus bas héritent donc
  // automatiquement des deux filtres sans logique dupliquée par écran. Une entité doit passer LES
  // DEUX filtres pour être visible (composition, pas substitution).
  const axes = useMemo(() => {
    let visible = programScopedAxes;
    if (filterActive && !isAdmin) {
      visible = visible.filter((a) =>
        isLeverVisibleForClearance(a.confidentialityLevel, clearance)
      );
    }
    if (ownershipScope.mode === "scoped") {
      visible = visible.filter((a) => ownershipScope.axisIds.has(a.id));
    }
    return visible;
  }, [programScopedAxes, filterActive, isAdmin, clearance, ownershipScope]);
  const chantiers = useMemo(() => {
    let visible = programScopedChantiers;
    if (filterActive && !isAdmin) {
      visible = visible.filter((c) =>
        isLeverVisibleForClearance(c.confidentialityLevel, clearance)
      );
    }
    if (ownershipScope.mode === "scoped") {
      visible = visible.filter((c) => ownershipScope.chantierIds.has(c.id));
    }
    return visible;
  }, [programScopedChantiers, filterActive, isAdmin, clearance, ownershipScope]);
  const indicators = useMemo(() => {
    let visible = allIndicators.filter((i) => i.programId === programId);
    if (filterActive && !isAdmin) {
      visible = visible.filter((i) =>
        isLeverVisibleForClearance(i.confidentialityLevel, clearance)
      );
    }
    if (ownershipScope.mode === "scoped") {
      // Indicateur chantier-scopé : visible si SON chantier l'est. Indicateur macro (pas de
      // `chantierId`, porté directement par l'axe) : visible si SON axe l'est — vrai pour
      // `axis_sponsor` (ses propres axes) et, à titre d'orientation, pour `chantier_owner`/
      // `chantier_contributor` sur l'axe PARENT de leur(s) chantier(s) visible(s) (même parti pris
      // que `axisIds` dans `resolveStrategicOwnershipScope`, lib/axisLogic.ts).
      visible = visible.filter((i) =>
        i.chantierId
          ? ownershipScope.chantierIds.has(i.chantierId)
          : ownershipScope.axisIds.has(i.axisId)
      );
    }
    return visible;
  }, [allIndicators, programId, filterActive, isAdmin, clearance, ownershipScope]);
  // Actions et mesures ne portent pas de `programId` (elles le tiennent de leur parent) : on les
  // rattache via l'ensemble des chantiers/indicateurs du programme, déjà scopés (confidentialité +
  // ownership) ci-dessus — aucun filtre supplémentaire nécessaire ici.
  const chantierActions = useMemo(() => {
    const ids = new Set(chantiers.map((c) => c.id));
    return allActions.filter((a) => ids.has(a.chantierId));
  }, [allActions, chantiers]);
  const measurements = useMemo(() => {
    const ids = new Set(indicators.map((i) => i.id));
    return allMeasurements.filter((m) => ids.has(m.indicatorId));
  }, [allMeasurements, indicators]);
  // Le staffing porte son propre `programId` (comme axes/chantiers/indicateurs) : filtrage direct,
  // sans passer par la liste des chantiers — une ligne dont le chantier vient d'être supprimé
  // reste ainsi visible dans les agrégats plutôt que de disparaître silencieusement. Round 25 :
  // ownership scoping ajouté (sinon `axis_sponsor`/`chantier_owner`/`chantier_contributor`
  // verraient les ETP de TOUT le programme sur la page Effectifs, malgré des `axes`/`chantiers`
  // déjà correctement bornés) — PAS de masquage de confidentialité ici, `ChantierStaffing` n'en
  // porte pas (comme avant ce round).
  const staffing = useMemo(() => {
    let visible = allStaffing.filter((s) => s.programId === programId);
    if (ownershipScope.mode === "scoped") {
      visible = visible.filter((s) => ownershipScope.chantierIds.has(s.chantierId));
    }
    return visible;
  }, [allStaffing, programId, ownershipScope]);

  // Refs toujours à jour : les mutations doivent lire l'état le plus récent sans être recréées à
  // chaque rendu (même motivation que les refs de `useBeTrackData`).
  const indicatorsRef = useRef(allIndicators);
  indicatorsRef.current = allIndicators;
  const measurementsRef = useRef(allMeasurements);
  measurementsRef.current = allMeasurements;
  const axesRef = useRef(allAxes);
  axesRef.current = allAxes;
  const chantiersRef = useRef(allChantiers);
  chantiersRef.current = allChantiers;
  const actionsRef = useRef(allActions);
  actionsRef.current = allActions;

  // ── Mutations ─────────────────────────────────────────────────────────────────────────────

  const createAxis = useCallback<StrategicData["createAxis"]>(
    async (input) => {
      if (!companyId || !programId) throw new Error("createAxis: companyId/programId manquant");
      const axis: StrategicAxis = {
        ...input,
        id: newId("AX"),
        companyId,
        programId,
        createdAt: nowDate(),
        lastUpdate: nowDate(),
      };
      await saveStrategicAxis(axis);
      logAudit(companyId, [makeCreatedAuditEntry(auditUser, axis.id, "axe", axis.name)]);
      return axis;
    },
    [companyId, programId, auditUser]
  );

  const updateAxis = useCallback<StrategicData["updateAxis"]>(
    async (id, patch) => {
      const existing = axesRef.current.find((a) => a.id === id);
      if (!existing) return;
      const after: StrategicAxis = { ...existing, ...patch, id, lastUpdate: nowDate() };
      await saveStrategicAxis(after);
      logAudit(companyId, buildUpdateAuditEntries(auditUser, id, patch, existing, after));
    },
    [companyId, auditUser]
  );

  const removeAxis = useCallback<StrategicData["removeAxis"]>(
    async (id) => {
      const existing = axesRef.current.find((a) => a.id === id);
      await deleteStrategicAxis(id);
      if (existing) {
        logAudit(companyId, [makeDeletedAuditEntry(auditUser, id, "axe", existing.name)]);
      }
    },
    [companyId, auditUser]
  );

  const createChantier = useCallback<StrategicData["createChantier"]>(
    async (input) => {
      if (!companyId || !programId) throw new Error("createChantier: companyId/programId manquant");
      const chantier: Chantier = {
        dependencies: [],
        ...input,
        id: newId("CH"),
        companyId,
        programId,
        createdAt: nowDate(),
        lastUpdate: nowDate(),
      };
      await saveChantier(chantier);
      logAudit(companyId, [
        makeCreatedAuditEntry(auditUser, chantier.id, "chantier", chantier.name),
      ]);
      return chantier;
    },
    [companyId, programId, auditUser]
  );

  const updateChantier = useCallback<StrategicData["updateChantier"]>(
    async (id, patch) => {
      const existing = chantiersRef.current.find((c) => c.id === id);
      if (!existing) return;
      const after: Chantier = { ...existing, ...patch, id, lastUpdate: nowDate() };
      await saveChantier(after);
      logAudit(companyId, buildUpdateAuditEntries(auditUser, id, patch, existing, after));
    },
    [companyId, auditUser]
  );

  const removeChantier = useCallback<StrategicData["removeChantier"]>(
    async (id) => {
      const existing = chantiersRef.current.find((c) => c.id === id);
      await deleteChantier(id);
      if (existing) {
        logAudit(companyId, [makeDeletedAuditEntry(auditUser, id, "chantier", existing.name)]);
      }
    },
    [companyId, auditUser]
  );

  const createChantierAction = useCallback<StrategicData["createChantierAction"]>(
    async (input) => {
      if (!companyId) throw new Error("createChantierAction: companyId manquant");
      const action: ChantierAction = { ...input, id: newId("CA"), companyId };
      await saveChantierAction(action);
      logAudit(companyId, [makeCreatedAuditEntry(auditUser, action.id, "projet", action.name)]);
      return action;
    },
    [companyId, auditUser]
  );

  const updateChantierAction = useCallback<StrategicData["updateChantierAction"]>(
    async (id, patch) => {
      const existing = actionsRef.current.find((a) => a.id === id);
      if (!existing) return;
      const after: ChantierAction = { ...existing, ...patch, id };
      // Round "projet weighting" : un appelant qui veut effacer un champ optionnel (ex.
      // `chantierWeightPct`, voir `ProjetWeightsEditor.tsx`'s "Non pondéré") passe explicitement
      // `undefined` dans `patch` — sans ce nettoyage, la clé resterait présente avec la valeur
      // `undefined` sur `after` (le spread ci-dessus la copie telle quelle) et `setDoc` (appelé SANS
      // `{ merge: true }`, voir `saveChantierAction`) rejetterait l'écriture entière ("Unsupported
      // field value: undefined") — le même piège documenté ailleurs dans ce fichier pour
      // `ChantierStaffing.note`. Ne change RIEN pour les appelants historiques, qui omettent déjà la
      // clé plutôt que d'y mettre `undefined` (voir `ChantierActionForm.tsx`, "Clés OMISES").
      for (const key of Object.keys(after) as (keyof ChantierAction)[]) {
        if (after[key] === undefined) delete after[key];
      }
      await saveChantierAction(after);
      logAudit(companyId, buildUpdateAuditEntries(auditUser, id, patch, existing, after));
    },
    [companyId, auditUser]
  );

  const removeChantierAction = useCallback<StrategicData["removeChantierAction"]>(
    async (id) => {
      const existing = actionsRef.current.find((a) => a.id === id);
      await deleteChantierAction(id);
      if (existing) {
        logAudit(companyId, [makeDeletedAuditEntry(auditUser, id, "projet", existing.name)]);
      }
    },
    [companyId, auditUser]
  );

  /** Point d'entrée UI de la demande de validation de jalon (voir `lib/axisLogic.ts` pour la
   *  logique métier complète, mirroir de `useStorage.ts::requestLeverApproval`) — la logique pure
   *  calcule le prochain `milestoneApproval`, `updateChantierAction` le persiste et journalise le
   *  changement (diff générique, même mécanisme que le reste de ce hook). Lève si `user` n'a pas été
   *  fourni au hook (voir son doc-comment) : ce point d'entrée n'a de sens qu'avec un utilisateur
   *  réel identifié, la logique pure ayant besoin de `user.username` pour l'habilitation.
   */
  const requestMilestoneApproval = useCallback<StrategicData["requestMilestoneApproval"]>(
    async (actionId) => {
      if (!user) {
        throw new Error(
          "Utilisateur non identifié : impossible de soumettre la demande de validation"
        );
      }
      const existing = actionsRef.current.find((a) => a.id === actionId);
      if (!existing) throw new Error(`Projet "${actionId}" introuvable`);
      const milestoneApproval = requestMilestoneApprovalLogic(
        existing,
        user,
        chantiersRef.current,
        actionsRef.current
      );
      await updateChantierAction(actionId, { milestoneApproval });
    },
    [user, updateChantierAction]
  );

  const approveMilestoneGate = useCallback<StrategicData["approveMilestoneGate"]>(
    async (actionId) => {
      if (!user)
        throw new Error("Utilisateur non identifié : impossible d'approuver cette demande");
      const existing = actionsRef.current.find((a) => a.id === actionId);
      if (!existing) throw new Error(`Projet "${actionId}" introuvable`);
      const patch = approveMilestoneGateLogic(existing, user, chantiersRef.current);
      await updateChantierAction(actionId, patch);
    },
    [user, updateChantierAction]
  );

  const rejectMilestoneApproval = useCallback<StrategicData["rejectMilestoneApproval"]>(
    async (actionId) => {
      if (!user) throw new Error("Utilisateur non identifié : impossible de rejeter cette demande");
      const existing = actionsRef.current.find((a) => a.id === actionId);
      if (!existing) throw new Error(`Projet "${actionId}" introuvable`);
      const patch = rejectMilestoneApprovalLogic(existing, user, chantiersRef.current);
      await updateChantierAction(actionId, patch);
    },
    [user, updateChantierAction]
  );

  const createIndicator = useCallback<StrategicData["createIndicator"]>(
    async (input) => {
      if (!companyId || !programId)
        throw new Error("createIndicator: companyId/programId manquant");
      const indicator: Indicator = {
        ...input,
        id: newId("IND"),
        companyId,
        programId,
        // Un indicateur neuf n'a aucune mesure : "on_track" par construction (voir
        // computeIndicatorStatus — l'absence de mesure n'est pas un retard).
        status: "on_track",
        createdAt: nowDate(),
        lastUpdate: nowDate(),
      };
      await saveIndicator(indicator);
      logAudit(companyId, [
        makeCreatedAuditEntry(auditUser, indicator.id, "indicateur", indicator.name),
      ]);
      return indicator;
    },
    [companyId, programId, auditUser]
  );

  const updateIndicator = useCallback<StrategicData["updateIndicator"]>(
    async (id, patch) => {
      const existing = indicatorsRef.current.find((i) => i.id === id);
      if (!existing) return;
      const next: Indicator = { ...existing, ...patch, id, lastUpdate: nowDate() };
      // Modifier l'objectif/le sens/la nature change mécaniquement le verdict sur la dernière
      // mesure — on recalcule ici pour ne pas laisser un statut périmé en base.
      next.status = computeIndicatorStatus(next, measurementsRef.current);
      await saveIndicator(next);
      // Diff sur le `patch` d'origine (pas `next`, dont `status` peut avoir été recalculé
      // au-dessus sans que l'appelant l'ait demandé) — même convention que les autres mutations.
      logAudit(companyId, buildUpdateAuditEntries(auditUser, id, patch, existing, next));
    },
    [companyId, auditUser]
  );

  const removeIndicator = useCallback<StrategicData["removeIndicator"]>(
    async (id) => {
      const existing = indicatorsRef.current.find((i) => i.id === id);
      await deleteIndicator(id);
      if (existing) {
        logAudit(companyId, [makeDeletedAuditEntry(auditUser, id, "indicateur", existing.name)]);
      }
    },
    [companyId, auditUser]
  );

  const addMeasurement = useCallback<StrategicData["addMeasurement"]>(
    async (input) => {
      if (!companyId) throw new Error("addMeasurement: companyId manquant");
      const measurement: IndicatorMeasurement = {
        ...input,
        id: newId("IM"),
        companyId,
        reportedAt: new Date().toISOString(),
      };
      await saveIndicatorMeasurement(measurement);

      // Recalcul du statut de l'indicateur sur la base incluant la mesure qu'on vient d'écrire :
      // l'abonnement Firestore n'a pas encore répondu à ce stade, on ne peut donc pas se contenter
      // de `measurementsRef.current`. `statusOverride` n'est jamais touché ici — la surcharge
      // manuelle du responsable reste prioritaire (voir resolveIndicatorStatus).
      const indicator = indicatorsRef.current.find((i) => i.id === input.indicatorId);
      if (indicator) {
        const status = computeIndicatorStatus(indicator, [...measurementsRef.current, measurement]);
        if (status !== indicator.status) {
          await saveIndicator({ ...indicator, status, lastUpdate: nowDate() });
        }
      }
      return measurement;
    },
    [companyId]
  );

  const removeMeasurement = useCallback<StrategicData["removeMeasurement"]>(async (id) => {
    await deleteIndicatorMeasurement(id);
  }, []);

  const createStaffing = useCallback<StrategicData["createStaffing"]>(
    async (input) => {
      if (!companyId || !programId) throw new Error("createStaffing: companyId/programId manquant");
      const { note, ...rest } = input;
      const entry: ChantierStaffing = {
        ...rest,
        id: newId("ST"),
        companyId,
        programId,
        createdAt: nowDate(),
        // `note` OMISE plutôt que passée à `undefined` : Firestore rejette `undefined` à
        // l'écriture (pas d'`ignoreUndefinedProperties` sur cette instance).
        ...(note && note.trim() !== "" ? { note: note.trim() } : {}),
      };
      await saveChantierStaffing(entry);
      return entry;
    },
    [companyId, programId]
  );

  const removeStaffing = useCallback<StrategicData["removeStaffing"]>(async (id) => {
    await deleteChantierStaffing(id);
  }, []);

  return {
    axes,
    chantiers,
    chantierActions,
    indicators,
    measurements,
    staffing,
    users,
    loading,
    strategicRole,
    ownershipScope,
    clickableActionIds,
    createAxis,
    updateAxis,
    removeAxis,
    createChantier,
    updateChantier,
    removeChantier,
    createChantierAction,
    updateChantierAction,
    removeChantierAction,
    requestMilestoneApproval,
    approveMilestoneGate,
    rejectMilestoneApproval,
    createIndicator,
    updateIndicator,
    removeIndicator,
    addMeasurement,
    removeMeasurement,
    createStaffing,
    removeStaffing,
  };
}
