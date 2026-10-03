"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subscribeStrategicAxes, saveStrategicAxis } from "@/lib/firestore/strategicAxes";
import { subscribeChantiers, saveChantier } from "@/lib/firestore/chantiers";
import { subscribeChantierActions, saveChantierAction } from "@/lib/firestore/chantierActions";
import { subscribeIndicators, saveIndicator } from "@/lib/firestore/indicators";
import { deleteWithCascade } from "@/lib/firestore/strategicCascade";
import { dropOrphanIndicators, dropOrphanStaffing } from "@/lib/strategicIntegrity";
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
  computeIndicatorStatus,
  projetAutoFlagsResolver,
  projetProgressResolver,
  type ProjetAutoFlagsLookup,
  type ProjetProgressLookup,
  resolveStrategicOwnershipScope,
  resolveStrategicRoleForProgram,
  type StrategicOwnershipScope,
  withAxisDisplayColors,
} from "@/lib/axisLogic";
import { resolveConfidentialityClearance } from "@/lib/leversLogic";
import { filterStrategicByClearance } from "@/lib/strategicConfidentiality";
import type { StrategicProgramData } from "@/lib/strategicProgramScope";
import type { StrategicConfidentialityConfig } from "@/lib/strategicApprovalClearance";
import { isAnyAdmin } from "@/lib/roleProfiles";
import { todayISO } from "@/lib/dateUtils";
import { normalizePeriod } from "@/lib/indicatorPeriod";
import {
  applyMeasurementEdit,
  assertMeasurementPeriodNotFuture,
  findPeriodCollision,
  MeasurementPeriodCollisionError,
  type MeasurementEditPatch,
} from "@/lib/kpiHistory";
import {
  buildUpdateAuditEntries,
  makeCreatedAuditEntry,
  makeDeletedAuditEntry,
  withTargetConfidentiality,
} from "@/lib/strategicAuditLogic";
import { strategicTargetLevels, unionLevels } from "@/lib/strategicApprovalClearance";
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
  return todayISO();
}

/** `list` avec `item` ajouté ou remplacé (même id) — état APRÈS mutation, pour l'audit (lot 6). */
function withItem<T extends { id: string }>(list: T[], item: T): T[] {
  return [item, ...list.filter((x) => x.id !== item.id)];
}

/** Retire les clés valant `undefined` (en place) : un appelant EFFACE un champ optionnel en le
 *  passant explicitement à `undefined` dans son patch — les `save*` font un `setDoc` SANS merge
 *  (écrasement intégral), la clé absente disparaît donc réellement du document, et Firestore
 *  rejetterait sinon toute l'écriture ("Unsupported field value: undefined"). */
function stripUndefined<T extends object>(entity: T): T {
  for (const key of Object.keys(entity) as (keyof T)[]) {
    if (entity[key] === undefined) delete entity[key];
  }
  return entity;
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
   *  restriction) ou l'ensemble précis des `ChantierAction.id` ouvrables : ceux des chantiers qu'il
   *  sponsorise (ou dont il sponsorise l'axe) + ceux dont il est responsable (`owner`) OU
   *  contributeur (`contributors`), traités à l'identique. Toujours un ensemble pour
   *  `chantier_contributor`/`projet_contributor`. Un projet peut être VISIBLE (présent dans
   *  `chantierActions` ci-dessus, parce qu'il appartient à un chantier où l'utilisateur est membre
   *  d'au moins un projet) sans être CLIQUABLE (il n'en est pas membre) — cette
   *  distinction ne peut pas être un simple filtrage de liste (l'UI doit continuer à RENDRE le
   *  projet, juste le rendre inerte au clic), d'où ce champ séparé plutôt que de le fusionner dans
   *  `chantierActions`. Consommé par `ProgramRoadmap.tsx`/`AxisChantierProjetAccordion.tsx`/
   *  `ProjetMilestoneBoard.tsx`. */
  clickableActionIds: Set<string> | "all";
  /** Avancement COMPLET (0-100) d'un projet, items automatiques compris (`projetProgressPct`,
   *  lib/axisLogic.ts), résolu sur TOUT le programme actif (pas seulement la partie visible) —
   *  seul chiffre à afficher pour un projet, et à passer en `progressOf` aux agrégats
   *  (`chantierDeclaredProgress`, `canStartAction`, …) pour que board, panneau, Gantt, feuille de
   *  route et tableau de bord affichent le MÊME pourcentage. */
  projetProgress: ProjetProgressLookup;
  /** Valeurs live des items automatiques du jalon courant d'un projet (même base que
   *  `projetProgress`) — à passer à `milestoneTransitionState` / `currentMilestoneFillPct`. */
  projetAutoFlags: ProjetAutoFlagsLookup;
  /** Ids de TOUS les axes du programme actif, avant filtrage de visibilité — à passer en
   *  `attributionAxes` de `rollupBudgets` (lib/budgetRollup.ts) pour que l'axe d'attribution d'un
   *  chantier ne dépende pas de ce que voit le lecteur. */
  programAxisIds: string[];
  /** `true` si l'utilisateur voit TOUS les chantiers du programme (aucun filtre de confidentialité
   *  ni de périmètre n'en masque) — seule condition pour comparer un total au budget prévisionnel
   *  du programme (`Program.budget`), qui porte sur le programme entier. */
  fullScope: boolean;
  /** Collections NON filtrées du programme actif (scopées au `programId`, AVANT confidentialité et
   *  ownership) — base de TOUS les calculs agrégés (taux de staffing et alertes de sur-staffing,
   *  avancement d'axe/programme, santé, dépendances, prérequis, validation, budget, % trajectoire)
   *  pour que le même chiffre s'affiche quel que soit le profil du lecteur. JAMAIS rendues telles
   *  quelles : l'affichage reste sur les projections filtrées ci-dessus, un élément hors périmètre
   *  n'apparaissant qu'agrégé (voir lib/strategicProgramScope.ts). */
  program: StrategicProgramData;
  /** Ids des chantiers VISIBLES du lecteur (= `chantiers`) — pour masquer à l'affichage ce que les
   *  calculs sur `program` font intervenir (`maskStaffingForDisplay`, `maskDependencyAlerts`…). */
  visibleChantierIds: ReadonlySet<string>;
  /** Ids des projets VISIBLES du lecteur (= `chantierActions`) — même usage, pour les prérequis
   *  (`canStartAction`/`programBlockedActions`, option `visibleActionIds`). */
  visibleActionIds: ReadonlySet<string>;
  /** Paramètres de confidentialité de l'entreprise (`Company.roleClearance` / `confidentialityLevels`)
   *  — habilitation des valideurs et lecteurs sur la cible d'une demande de validation (lot 5,
   *  lib/strategicApprovalClearance.ts). `null` = entreprise en cours de chargement ; `undefined` =
   *  filtrage non activé (`user` omis). */
  confidentiality?: StrategicConfidentialityConfig | null;

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

  // Passage de jalon : plus de circuit direct ici — demandes à chaîne "milestone"
  // (`milestoneFlow`, lib/strategicApprovalFlows.ts ; marqueurs reliquats :
  // `useStrategicApprovals().clearLegacyMilestone`).

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
  /** Corrige une mesure publiée (valeur / commentaire / période) et recalcule le statut de
   *  l'indicateur. Saisie d'origine (`reportedBy`/`reportedAt`) conservée, `updatedBy`/`updatedAt`
   *  posés. Lève `MeasurementPeriodCollisionError` si la nouvelle période est déjà prise par une
   *  autre mesure du même indicateur. */
  updateMeasurement: (id: string, patch: MeasurementEditPatch) => Promise<IndicatorMeasurement>;
  /** Supprime une mesure ET recalcule le statut de l'indicateur. */
  deleteMeasurement: (id: string) => Promise<void>;
  /** Alias historique de `deleteMeasurement`. */
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
   * `chantier_owner`/`chantier_contributor`/`projet_contributor`, voir `resolveStrategicOwnershipScope`,
   * lib/axisLogic.ts) — un seul et même interrupteur pour les deux mécanismes (confidentialité ET
   * ownership) plutôt qu'un second paramètre : un appelant qui a migré pour activer l'un a de toute
   * façon besoin de l'autre, aucun call site connu ne veut l'un sans l'autre. `username` est
   * désormais nécessaire (en plus des champs déjà requis pour la confidentialité) pour comparer aux
   * `owner`/`pilote`/`contributors` des entités.
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
  const [companyLoaded, setCompanyLoaded] = useState(false);
  useEffect(() => {
    if (!filterActive || !companyId) {
      setCompany(null);
      setCompanyLoaded(false);
      return;
    }
    setCompanyLoaded(false);
    const unsub = subscribeCompanies((companies) => {
      setCompany(companies.find((c) => c.id === companyId) ?? null);
      setCompanyLoaded(true);
    }, companyId);
    return unsub;
  }, [filterActive, companyId]);
  // Paramètres de confidentialité exposés pour la validation (lot 5, option A) : habilitation des
  // VALIDEURS et des lecteurs sur la cible d'une demande. `null` tant que l'entreprise n'est pas
  // chargée (les demandes sur cible confidentielle attendent : route "retry").
  const confidentiality = useMemo<StrategicConfidentialityConfig | null | undefined>(() => {
    if (!filterActive) return undefined;
    if (!companyLoaded) return null;
    return {
      roleClearance: company?.roleClearance,
      levels: company?.confidentialityLevels,
    };
  }, [filterActive, companyLoaded, company?.roleClearance, company?.confidentialityLevels]);
  const isAdmin = isAnyAdmin(user);
  const clearance = useMemo(
    () =>
      resolveConfidentialityClearance(
        user,
        company?.roleClearance,
        "strategic",
        company?.confidentialityLevels
      ),
    [user, company?.roleClearance, company?.confidentialityLevels]
  );

  // ── Périmètre de visibilité par propriétaire nommé (round 25) ─────────────────────────────
  // Même interrupteur `filterActive` que la confidentialité ci-dessus (voir le doc-comment du
  // paramètre `user`) : un appelant non migré (`user` omis) ne paie ni l'un ni l'autre. Calculé à
  // partir d'axes/chantiers/actions scopés au programme actif mais AVANT le masquage de
  // confidentialité — les deux filtres sont INDÉPENDANTS (un axe doit passer les DEUX pour être
  // visible, voir `axes`/`chantiers`/`indicators`/`staffing` ci-dessous), et `owner`/`pilote` ne
  // sont pas affectés par la confidentialité.
  // Couleurs d'axe résolues ICI sur le programme COMPLET (avant tout filtrage de visibilité) :
  // une couleur stockée hors charte (données historiques) est remplacée à la lecture par une
  // couleur de `AXIS_COLOR_PALETTE` (`axisDisplayColor`, lib/axisLogic.ts), si bien que tous les
  // écrans — y compris ceux qui ne reçoivent qu'un sous-ensemble d'axes — affichent la MÊME
  // couleur pour un même axe. Pas de migration Firestore.
  const programScopedAxes = useMemo(
    () => withAxisDisplayColors(allAxes.filter((a) => a.programId === programId)),
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

  const projetAutoFlags = useMemo(
    () => projetAutoFlagsResolver(programScopedChantiers, programScopedActionsForScope),
    [programScopedChantiers, programScopedActionsForScope]
  );
  const projetProgress = useMemo(
    () =>
      projetProgressResolver(programScopedChantiers, programScopedActionsForScope, projetAutoFlags),
    [programScopedChantiers, programScopedActionsForScope, projetAutoFlags]
  );

  // ── Projections scopées au programme actif ────────────────────────────────────────────────
  // Le masquage de confidentialité ET le périmètre par propriétaire nommé (tous deux actifs
  // seulement quand `filterActive`) s'appliquent ICI, une seule fois pour tous les écrans
  // consommateurs (StrategicAxesView, ChantierDetailClient, KpiPageClient,
  // StrategicDashboardView, …) — les actions/mesures qui en dérivent plus bas héritent donc
  // automatiquement des deux filtres sans logique dupliquée par écran. Une entité doit passer LES
  // DEUX filtres pour être visible (composition, pas substitution).
  // Masquage de confidentialité HÉRITÉE (lib/strategicConfidentiality.ts) : un chantier sous un
  // axe non accessible est masqué même sans niveau propre ; projets, indicateurs et lignes ETP
  // suivent leur chantier/axe. Admins et appelants non migrés : aucun filtre (inchangé).
  // Lot 3 — filtre DÉFENSIF des orphelins déjà en base (avant la suppression en cascade) : une ligne
  // ETP dont le chantier/projet n'existe plus et un indicateur dont le chantier n'existe plus ne
  // comptent plus nulle part (taux de staffing, alertes, compteurs d'indicateurs à risque). Même
  // règle que `chantierPlannedFte` (lib/staffingNeed.ts). Nettoyage en base :
  // scripts/clean-strategic-orphans.js.
  const programScopedIndicators = useMemo(
    () =>
      dropOrphanIndicators(
        allIndicators.filter((i) => i.programId === programId),
        allChantiers
      ),
    [allIndicators, allChantiers, programId]
  );
  const programScopedStaffing = useMemo(
    () =>
      dropOrphanStaffing(
        allStaffing.filter((s) => s.programId === programId),
        allChantiers,
        allActions
      ),
    [allStaffing, allChantiers, allActions, programId]
  );
  const clearanceFiltered = useMemo(() => {
    const input = {
      axes: programScopedAxes,
      chantiers: programScopedChantiers,
      indicators: programScopedIndicators,
      staffing: programScopedStaffing,
    };
    if (!filterActive || isAdmin) return input;
    return filterStrategicByClearance(input, clearance);
  }, [
    programScopedAxes,
    programScopedChantiers,
    programScopedIndicators,
    programScopedStaffing,
    filterActive,
    isAdmin,
    clearance,
  ]);
  const axes = useMemo(() => {
    let visible = clearanceFiltered.axes;
    if (ownershipScope.mode === "scoped") {
      visible = visible.filter((a) => ownershipScope.axisIds.has(a.id));
    }
    return visible;
  }, [clearanceFiltered, ownershipScope]);
  const chantiers = useMemo(() => {
    let visible = clearanceFiltered.chantiers;
    if (ownershipScope.mode === "scoped") {
      visible = visible.filter((c) => ownershipScope.chantierIds.has(c.id));
    }
    return visible;
  }, [clearanceFiltered, ownershipScope]);
  const indicators = useMemo(() => {
    let visible = clearanceFiltered.indicators;
    if (ownershipScope.mode === "scoped") {
      // Indicateur chantier-scopé : visible si SON chantier l'est. Indicateur macro (pas de
      // `chantierId`, porté directement par l'axe) : visible si SON axe l'est — vrai pour
      // l'axe sponsorisé et, à titre d'orientation, l'axe PARENT d'un chantier visible via son
      // sponsor ou l'un de ses projets (responsable ou contributeur) (même parti pris
      // que `axisIds` dans `resolveStrategicOwnershipScope`, lib/axisLogic.ts).
      visible = visible.filter((i) =>
        i.chantierId
          ? ownershipScope.chantierIds.has(i.chantierId)
          : ownershipScope.axisIds.has(i.axisId)
      );
    }
    return visible;
  }, [clearanceFiltered, ownershipScope]);
  // Actions et mesures ne portent pas de `programId` (elles le tiennent de leur parent) : on les
  // rattache via l'ensemble des chantiers/indicateurs du programme, déjà scopés (confidentialité +
  // ownership) ci-dessus — aucun filtre supplémentaire nécessaire ici.
  const programAxisIds = useMemo(() => programScopedAxes.map((a) => a.id), [programScopedAxes]);
  const fullScope = chantiers.length === programScopedChantiers.length;
  const chantierActions = useMemo(() => {
    const ids = new Set(chantiers.map((c) => c.id));
    return allActions.filter((a) => ids.has(a.chantierId));
  }, [allActions, chantiers]);
  const measurements = useMemo(() => {
    const ids = new Set(indicators.map((i) => i.id));
    return allMeasurements.filter((m) => ids.has(m.indicatorId));
  }, [allMeasurements, indicators]);
  // Le staffing porte son propre `programId` (comme axes/chantiers/indicateurs) : filtrage direct,
  // sans passer par la liste des chantiers VISIBLES (les lignes orphelines, chantier/projet
  // supprimé, sont déjà écartées par `programScopedStaffing`, lot 3). Round 25 :
  // ownership scoping ajouté (sinon `axis_sponsor`/`chantier_owner`/`chantier_contributor`
  // verraient les ETP de TOUT le programme sur la page Effectifs, malgré des `axes`/`chantiers`
  // déjà correctement bornés). Confidentialité : `ChantierStaffing` ne porte pas de niveau propre,
  // mais une ligne d'un chantier masqué (niveau propre ou hérité de l'axe) l'est aussi.
  const staffing = useMemo(() => {
    let visible = clearanceFiltered.staffing;
    if (ownershipScope.mode === "scoped") {
      visible = visible.filter((s) => ownershipScope.chantierIds.has(s.chantierId));
    }
    return visible;
  }, [clearanceFiltered, ownershipScope]);

  // ── Programme COMPLET (lot 3) : mêmes collections, AVANT tout filtre de visibilité — exposées
  // pour les calculs agrégés uniquement (voir `StrategicData.program`). Mesures rattachées via les
  // indicateurs du programme (elles ne portent pas de `programId`).
  const programScopedMeasurements = useMemo(() => {
    const ids = new Set(programScopedIndicators.map((i) => i.id));
    return allMeasurements.filter((m) => ids.has(m.indicatorId));
  }, [allMeasurements, programScopedIndicators]);
  const program: StrategicProgramData = useMemo(
    () => ({
      axes: programScopedAxes,
      chantiers: programScopedChantiers,
      chantierActions: programScopedActionsForScope,
      indicators: programScopedIndicators,
      measurements: programScopedMeasurements,
      staffing: programScopedStaffing,
    }),
    [
      programScopedAxes,
      programScopedChantiers,
      programScopedActionsForScope,
      programScopedIndicators,
      programScopedMeasurements,
      programScopedStaffing,
    ]
  );
  const visibleChantierIds = useMemo(() => new Set(chantiers.map((c) => c.id)), [chantiers]);
  const visibleActionIds = useMemo(
    () => new Set(chantierActions.map((a) => a.id)),
    [chantierActions]
  );

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
  const staffingRef = useRef(allStaffing);
  staffingRef.current = allStaffing;

  // Lot 6 : niveaux de confidentialité de la cible ENREGISTRÉS dans chaque entrée d'audit
  // (`withTargetConfidentiality`) — résolus sur toutes les données de l'entreprise (jamais sur la
  // vue filtrée du lecteur), `overrides` = état après mutation (élément créé / modifié).
  const levelsOf = useCallback(
    (
      type: Parameters<typeof strategicTargetLevels>[0],
      id: string,
      overrides: Partial<Parameters<typeof strategicTargetLevels>[2]> = {}
    ) =>
      strategicTargetLevels(type, id, {
        axes: overrides.axes ?? axesRef.current,
        chantiers: overrides.chantiers ?? chantiersRef.current,
        chantierActions: overrides.chantierActions ?? actionsRef.current,
        indicators: overrides.indicators ?? indicatorsRef.current,
      }),
    []
  );

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
      logAudit(
        companyId,
        withTargetConfidentiality(
          [makeCreatedAuditEntry(auditUser, axis.id, "axe", axis.name)],
          levelsOf("axe", axis.id, { axes: withItem(axesRef.current, axis) })
        )
      );
      return axis;
    },
    [companyId, programId, auditUser, levelsOf]
  );

  const updateAxis = useCallback<StrategicData["updateAxis"]>(
    async (id, patch) => {
      const existing = axesRef.current.find((a) => a.id === id);
      if (!existing) return;
      const after: StrategicAxis = stripUndefined({
        ...existing,
        ...patch,
        id,
        lastUpdate: nowDate(),
      });
      // Niveaux AVANT et APRÈS (un changement de confidentialité protège les deux états).
      const levels = unionLevels(
        levelsOf("axe", id),
        levelsOf("axe", id, { axes: withItem(axesRef.current, after) })
      );
      await saveStrategicAxis(after);
      logAudit(
        companyId,
        withTargetConfidentiality(
          buildUpdateAuditEntries(auditUser, id, patch, existing, after),
          levels
        )
      );
    },
    [companyId, auditUser, levelsOf]
  );

  // Auteur des suppressions en cascade (annulation des demandes en attente qui visent la cible).
  const cascadeActor = useMemo(
    () => ({ username: user?.username ?? auditUser, name: user?.name }),
    [user?.username, user?.name, auditUser]
  );

  const removeAxis = useCallback<StrategicData["removeAxis"]>(
    async (id) => {
      if (!companyId) throw new Error("removeAxis: companyId manquant");
      const existing = axesRef.current.find((a) => a.id === id);
      const levels = levelsOf("axe", id); // avant suppression (lot 6)
      // Lot 3 : suppression BLOQUÉE tant que l'axe porte des chantiers/indicateurs
      // (`AxisNotEmptyError`, rien d'écrit) — ses chantiers gardaient sinon un `axisIds`
      // inexistant (comptés dans la puce, absents de la feuille de route). Axe vide : supprimé avec
      // annulation des demandes en attente qui le visent, en un seul batch.
      await deleteWithCascade(companyId, { axisIds: [id] }, cascadeActor);
      if (existing) {
        logAudit(
          companyId,
          withTargetConfidentiality(
            [makeDeletedAuditEntry(auditUser, id, "axe", existing.name)],
            levels
          )
        );
      }
    },
    [companyId, auditUser, cascadeActor, levelsOf]
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
      logAudit(
        companyId,
        withTargetConfidentiality(
          [makeCreatedAuditEntry(auditUser, chantier.id, "chantier", chantier.name)],
          levelsOf("chantier", chantier.id, {
            chantiers: withItem(chantiersRef.current, chantier),
          })
        )
      );
      return chantier;
    },
    [companyId, programId, auditUser, levelsOf]
  );

  const updateChantier = useCallback<StrategicData["updateChantier"]>(
    async (id, patch) => {
      const existing = chantiersRef.current.find((c) => c.id === id);
      if (!existing) return;
      const after: Chantier = stripUndefined({ ...existing, ...patch, id, lastUpdate: nowDate() });
      const levels = unionLevels(
        levelsOf("chantier", id),
        levelsOf("chantier", id, { chantiers: withItem(chantiersRef.current, after) })
      );
      await saveChantier(after);
      logAudit(
        companyId,
        withTargetConfidentiality(
          buildUpdateAuditEntries(auditUser, id, patch, existing, after),
          levels
        )
      );
    },
    [companyId, auditUser, levelsOf]
  );

  const removeChantier = useCallback<StrategicData["removeChantier"]>(
    async (id) => {
      if (!companyId) throw new Error("removeChantier: companyId manquant");
      const existing = chantiersRef.current.find((c) => c.id === id);
      const levels = levelsOf("chantier", id); // avant suppression (lot 6)
      // Lot 3 : cascade en UN SEUL batch — projets, lignes ETP (chantier ET projets), indicateurs
      // et leurs mesures, dépendances/prérequis qui les citent, demandes en attente annulées. Les
      // lignes ETP de niveau chantier restaient sinon comptées (IT 125 % au lieu de 90 %).
      await deleteWithCascade(companyId, { chantierIds: [id] }, cascadeActor);
      if (existing) {
        logAudit(
          companyId,
          withTargetConfidentiality(
            [makeDeletedAuditEntry(auditUser, id, "chantier", existing.name)],
            levels
          )
        );
      }
    },
    [companyId, auditUser, cascadeActor, levelsOf]
  );

  const createChantierAction = useCallback<StrategicData["createChantierAction"]>(
    async (input) => {
      if (!companyId) throw new Error("createChantierAction: companyId manquant");
      const action: ChantierAction = { ...input, id: newId("CA"), companyId };
      await saveChantierAction(action);
      logAudit(
        companyId,
        withTargetConfidentiality(
          [makeCreatedAuditEntry(auditUser, action.id, "projet", action.name)],
          levelsOf("projet", action.id, {
            chantierActions: withItem(actionsRef.current, action),
          })
        )
      );
      return action;
    },
    [companyId, auditUser, levelsOf]
  );

  const updateChantierAction = useCallback<StrategicData["updateChantierAction"]>(
    async (id, patch) => {
      const existing = actionsRef.current.find((a) => a.id === id);
      if (!existing) return;
      const after: ChantierAction = stripUndefined({ ...existing, ...patch, id });
      // Round "projet weighting" : un appelant qui veut effacer un champ optionnel (ex.
      // `chantierWeightPct`, voir `ProjetWeightsEditor.tsx`'s "Non pondéré") passe explicitement
      // `undefined` dans `patch` — sans ce nettoyage, la clé resterait présente avec la valeur
      // `undefined` sur `after` (le spread ci-dessus la copie telle quelle) et `setDoc` (appelé SANS
      // `{ merge: true }`, voir `saveChantierAction`) rejetterait l'écriture entière ("Unsupported
      // field value: undefined") — le même piège documenté ailleurs dans ce fichier pour
      // `ChantierStaffing.note`. Ne change RIEN pour les appelants historiques, qui omettent déjà la
      // clé plutôt que d'y mettre `undefined` (voir `ChantierActionForm.tsx`, "Clés OMISES").
      const levels = unionLevels(
        levelsOf("projet", id),
        levelsOf("projet", id, { chantierActions: withItem(actionsRef.current, after) })
      );
      await saveChantierAction(after);
      logAudit(
        companyId,
        withTargetConfidentiality(
          buildUpdateAuditEntries(auditUser, id, patch, existing, after),
          levels
        )
      );
    },
    [companyId, auditUser, levelsOf]
  );

  const removeChantierAction = useCallback<StrategicData["removeChantierAction"]>(
    async (id) => {
      if (!companyId) throw new Error("removeChantierAction: companyId manquant");
      const existing = actionsRef.current.find((a) => a.id === id);
      const levels = levelsOf("projet", id); // avant suppression (lot 6)
      // Suppression en CASCADE (un seul batch, lot 3) : lignes de staffing du projet (elles
      // restaient comptées au niveau du chantier, audit DB-14 / KPI-02), prérequis qui le citent,
      // demandes en attente qui le visent (annulées).
      await deleteWithCascade(companyId, { actionIds: [id] }, cascadeActor);
      if (existing) {
        logAudit(
          companyId,
          withTargetConfidentiality(
            [makeDeletedAuditEntry(auditUser, id, "projet", existing.name)],
            levels
          )
        );
      }
    },
    [companyId, auditUser, cascadeActor, levelsOf]
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
      logAudit(
        companyId,
        withTargetConfidentiality(
          [makeCreatedAuditEntry(auditUser, indicator.id, "indicateur", indicator.name)],
          levelsOf("indicateur", indicator.id, {
            indicators: withItem(indicatorsRef.current, indicator),
          })
        )
      );
      return indicator;
    },
    [companyId, programId, auditUser, levelsOf]
  );

  const updateIndicator = useCallback<StrategicData["updateIndicator"]>(
    async (id, patch) => {
      const existing = indicatorsRef.current.find((i) => i.id === id);
      if (!existing) return;
      const next: Indicator = stripUndefined({ ...existing, ...patch, id, lastUpdate: nowDate() });
      // Modifier l'objectif/le sens/la nature change mécaniquement le verdict sur la dernière
      // mesure — on recalcule ici pour ne pas laisser un statut périmé en base.
      next.status = computeIndicatorStatus(next, measurementsRef.current);
      const levels = unionLevels(
        levelsOf("indicateur", id),
        levelsOf("indicateur", id, { indicators: withItem(indicatorsRef.current, next) })
      );
      await saveIndicator(next);
      // Diff sur le `patch` d'origine (pas `next`, dont `status` peut avoir été recalculé
      // au-dessus sans que l'appelant l'ait demandé) — même convention que les autres mutations.
      logAudit(
        companyId,
        withTargetConfidentiality(
          buildUpdateAuditEntries(auditUser, id, patch, existing, next),
          levels
        )
      );
    },
    [companyId, auditUser, levelsOf]
  );

  const removeIndicator = useCallback<StrategicData["removeIndicator"]>(
    async (id) => {
      if (!companyId) throw new Error("removeIndicator: companyId manquant");
      const existing = indicatorsRef.current.find((i) => i.id === id);
      const levels = levelsOf("indicateur", id); // avant suppression (lot 6)
      // Lot 3 : ses mesures partent avec lui (un seul batch), demandes en attente qui le visent
      // (valeur KPI, objectif) annulées.
      await deleteWithCascade(companyId, { indicatorIds: [id] }, cascadeActor);
      if (existing) {
        logAudit(
          companyId,
          withTargetConfidentiality(
            [makeDeletedAuditEntry(auditUser, id, "indicateur", existing.name)],
            levels
          )
        );
      }
    },
    [companyId, auditUser, cascadeActor, levelsOf]
  );

  const addMeasurement = useCallback<StrategicData["addMeasurement"]>(
    async (input) => {
      if (!companyId) throw new Error("addMeasurement: companyId manquant");
      // Période normalisée au format canonique quand elle est reconnue ("2026-3" → "2026-03").
      const period = normalizePeriod(input.period) ?? input.period.trim();
      // Garde-fou : jamais de mesure sur une période postérieure à la période en cours (selon la
      // fréquence de l'indicateur) — elle deviendrait la « dernière valeur » partout.
      assertMeasurementPeriodNotFuture(
        period,
        indicatorsRef.current.find((i) => i.id === input.indicatorId)?.frequency
      );
      // Garde-fou : jamais deux mesures pour la même période d'un indicateur (une seconde valeur
      // était ignorée partout sauf sur le graphique). L'UI propose le REMPLACEMENT (correction de
      // la mesure existante, `updateMeasurement`) avant d'arriver ici.
      const taken = findPeriodCollision(measurementsRef.current, input.indicatorId, period);
      if (taken) throw new MeasurementPeriodCollisionError(period, taken.id);
      const measurement: IndicatorMeasurement = {
        ...input,
        period,
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

  /** Recalcule/persiste le statut calculé d'un indicateur sur une base de mesures donnée — même
   *  règle que `addMeasurement` (`statusOverride` jamais touché). */
  const recomputeIndicatorStatus = useCallback(
    async (indicatorId: string, nextMeasurements: IndicatorMeasurement[]) => {
      const indicator = indicatorsRef.current.find((i) => i.id === indicatorId);
      if (!indicator) return;
      const status = computeIndicatorStatus(indicator, nextMeasurements);
      if (status !== indicator.status) {
        await saveIndicator({ ...indicator, status, lastUpdate: nowDate() });
      }
    },
    []
  );

  const updateMeasurement = useCallback<StrategicData["updateMeasurement"]>(
    async (id, patch) => {
      const existing = measurementsRef.current.find((m) => m.id === id);
      if (!existing) throw new Error("updateMeasurement: mesure introuvable");
      if (
        patch.period !== undefined &&
        findPeriodCollision(measurementsRef.current, existing.indicatorId, patch.period, id)
      ) {
        throw new MeasurementPeriodCollisionError(patch.period.trim());
      }
      if (patch.period !== undefined) {
        patch = { ...patch, period: normalizePeriod(patch.period) ?? patch.period.trim() };
      }
      assertMeasurementPeriodNotFuture(
        patch.period ?? existing.period,
        indicatorsRef.current.find((i) => i.id === existing.indicatorId)?.frequency
      );
      const next = applyMeasurementEdit(
        existing,
        patch,
        user?.username ?? auditUser,
        new Date().toISOString()
      );
      if (!next) throw new Error("updateMeasurement: valeur ou commentaire requis");
      // `setDoc` sur le MÊME id (écrasement complet) : autorisé par la règle `update` de
      // `indicatorMeasurements` (companyId inchangé) — et c'est ce qui permet de RETIRER un champ
      // vidé (valeur/commentaire), ce qu'un merge ne ferait pas.
      await saveIndicatorMeasurement(next);
      await recomputeIndicatorStatus(existing.indicatorId, [
        ...measurementsRef.current.filter((m) => m.id !== id),
        next,
      ]);
      return next;
    },
    [user?.username, auditUser, recomputeIndicatorStatus]
  );

  const deleteMeasurement = useCallback<StrategicData["deleteMeasurement"]>(
    async (id) => {
      const existing = measurementsRef.current.find((m) => m.id === id);
      await deleteIndicatorMeasurement(id);
      if (existing) {
        await recomputeIndicatorStatus(
          existing.indicatorId,
          measurementsRef.current.filter((m) => m.id !== id)
        );
      }
    },
    [recomputeIndicatorStatus]
  );
  const removeMeasurement = deleteMeasurement;

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
    projetProgress,
    projetAutoFlags,
    programAxisIds,
    fullScope,
    program,
    visibleChantierIds,
    visibleActionIds,
    confidentiality,
    createAxis,
    updateAxis,
    removeAxis,
    createChantier,
    updateChantier,
    removeChantier,
    createChantierAction,
    updateChantierAction,
    removeChantierAction,
    createIndicator,
    updateIndicator,
    removeIndicator,
    addMeasurement,
    updateMeasurement,
    deleteMeasurement,
    removeMeasurement,
    createStaffing,
    removeStaffing,
  };
}
