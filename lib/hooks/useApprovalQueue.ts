"use client";

import { useMemo } from "react";
import {
  canApproveLeverDeletion,
  canDecideLeverApproval,
  filterAggregateVisibleLevers,
  type LeverDirectoryUser,
} from "@/lib/leversLogic";
import { canDecideImpactRealized, canDecideImpactRealizedOn } from "@/lib/impactStatus";
import type { StrategicApproval } from "@/lib/strategicApprovals";
import type {
  AuthUser,
  BeTrackData,
  Chantier,
  ChantierAction,
  Company,
  Lever,
  LeverImpact,
  StrategicAxis,
} from "@/types";

/**
 * Résolution PURE de la file d'attente de validation des portes de levier, extraite du hook pour
 * être testable sans rendu React (voir lib/__tests__/useApprovalQueue.test.ts). Double validation
 * hiérarchique (voir lib/leversLogic.ts::approveLeverGate) : un levier n'apparaît que pour qui peut
 * décider son palier COURANT (`canDecideLeverApproval`) — titulaire du palier (responsable de
 * chantier AVEC le rôle "sponsor", ou CTO du programme), ou admin tant qu'aucun palier de la
 * demande n'a déjà été débloqué par un admin ; jamais le demandeur, jamais une personne ayant déjà
 * validé un palier précédent.
 */
export function resolveApprovalQueue(
  data: Pick<BeTrackData, "levers" | "workstreams">,
  user: AuthUser | null | undefined
): Lever[] {
  if (!user) return [];
  return data.levers.filter(
    (lever) => !!lever.approval && canDecideLeverApproval(lever, user, data.workstreams)
  );
}

/**
 * Sur le modèle exact de `useNotifications` (lib/hooks/useNotifications.ts) : résout la file des
 * leviers dont la demande de validation (sponsor OU cto, voir `lib/leversLogic.ts::approveLeverGate`
 * pour la logique métier) attend actuellement CET utilisateur — pour alimenter le badge/dropdown
 * de notifications ET la page dédiée `/validation` ("mes leviers à valider").
 */
export function useApprovalQueue(data: BeTrackData, user: AuthUser | null | undefined) {
  const queue = useMemo(() => resolveApprovalQueue(data, user), [data, user]);

  return {
    queue,
    count: queue.length,
  };
}

// ─── Suppressions de leviers à confirmer (CTO ↔ responsable de chantier) ────────────────────

/** Leviers dont la demande de suppression attend la confirmation de CET utilisateur (rôle
 *  complémentaire de celui du demandeur, voir `canApproveLeverDeletion`). `users` (annuaire,
 *  optionnel) : permet à un admin de voir les demandes qu'il peut confirmer faute de titulaire. */
export function resolveDeletionQueue(
  data: Pick<BeTrackData, "levers" | "workstreams">,
  user: AuthUser | null | undefined,
  users?: LeverDirectoryUser[]
): Lever[] {
  if (!user) return [];
  return data.levers.filter(
    (lever) =>
      !!lever.deletionRequest && canApproveLeverDeletion(lever, user, data.workstreams, users)
  );
}

export function useDeletionQueue(
  data: Pick<BeTrackData, "levers" | "workstreams">,
  user: AuthUser | null | undefined,
  users?: LeverDirectoryUser[]
) {
  const queue = useMemo(() => resolveDeletionQueue(data, user, users), [data, user, users]);
  return { queue, count: queue.length };
}

// ─── Réalisés à valider (profil finance) ────────────────────────────────────────────────────
//
// Impacts cochés « Réalisé » par un profil non-finance : ils restent HORS du réalisé tant que la
// finance n'a pas décidé (voir `isImpactRealized`, audit C4). Avant, cette décision n'était
// possible que dans l'onglet Impact de la fiche, sans aucune file pour la finance.

/** Une ligne de la file « Réalisés à valider » : l'impact en attente et son levier. */
export type RealizedApprovalEntry = { lever: Lever; impact: LeverImpact };

/** Entreprise courante, pour l'habilitation de confidentialité de la file finance. */
export type RealizedQueueCompany = Pick<Company, "roleClearance" | "confidentialityLevels">;

/**
 * File « Réalisés à valider » de `user` : leviers des programmes sur lesquels il a les droits
 * finance (profil finance du programme ou tous programmes ; admin = tous), visibles pour son
 * habilitation de confidentialité (`filterAggregateVisibleLevers`, `company` = entreprise
 * courante — absente : seule l'habilitation individuelle compte), hors impacts qu'il a lui-même
 * déclarés réalisés (demandeur ≠ validateur, `canDecideImpactRealizedOn`).
 */
export function resolveRealizedApprovalQueue(
  data: Pick<BeTrackData, "levers">,
  user: AuthUser | null | undefined,
  company?: RealizedQueueCompany | null
): RealizedApprovalEntry[] {
  if (!user || !canDecideImpactRealized(user)) return [];
  return filterAggregateVisibleLevers(data.levers, user, company)
    .filter((lever) => lever.status !== "cancelled")
    .flatMap((lever) =>
      (lever.impacts ?? [])
        .filter((impact) => canDecideImpactRealizedOn(user, lever, impact))
        .map((impact) => ({ lever, impact }))
    );
}

export function useRealizedApprovalQueue(
  data: Pick<BeTrackData, "levers">,
  user: AuthUser | null | undefined,
  company?: RealizedQueueCompany | null
) {
  const queue = useMemo(
    () => resolveRealizedApprovalQueue(data, user, company),
    [data, user, company]
  );
  return { queue, count: queue.length };
}

// ─── Pendant Plan Stratégique — jalons (ANCIEN circuit, SUPPRIMÉ) ───────────────────────────────
//
// L'ancien circuit de validation de jalon à approbateur UNIQUE (`ChantierAction.milestoneApproval`
// décidé via `canDecideMilestone`) est supprimé : TOUT passage de jalon est une demande
// `StrategicApproval` "milestone" à chaîne, déjà présente au bon palier dans
// `useStrategicApprovals().pending`. Les marqueurs reliquats sont listés par
// `useStrategicApprovals().legacyMilestones` (lecture seule, effaçables par un admin).
// Les exports ci-dessous n'ont plus d'appelant applicatif (AppShell/Topbar et lib/myWorkspace.ts
// les ont retirés) ; seuls des tests de non-régression les importent. Ils renvoient TOUJOURS une
// file vide. À retirer.

/** @deprecated Ancien circuit supprimé — conservé pour compatibilité de type. */
export type MilestoneApprovalQueueEntry = {
  action: ChantierAction;
  chantier: Chantier;
};

/** @deprecated Ancien circuit supprimé : renvoie toujours `[]` (voir la note de section). */
export function resolveMilestoneApprovalQueue(
  chantierActions: ChantierAction[],
  chantiers: Chantier[],
  user: AuthUser | null | undefined,
  axes: Pick<StrategicAxis, "id" | "owner">[] = [],
  approvals: Pick<StrategicApproval, "kind" | "status" | "targetId">[] = []
): MilestoneApprovalQueueEntry[] {
  void chantierActions;
  void chantiers;
  void user;
  void axes;
  void approvals;
  return [];
}

const EMPTY_MILESTONE_QUEUE: MilestoneApprovalQueueEntry[] = [];

/** @deprecated Ancien circuit supprimé : file toujours vide (`{ queue: [], count: 0 }`). Les
 *  appelants (AppShell → Topbar) doivent retirer cet appel ; les demandes de jalon sont dans
 *  `useStrategicApprovals().pending`. */
export function useMilestoneApprovalQueue(
  data: {
    chantierActions: ChantierAction[];
    chantiers: Chantier[];
    axes?: Pick<StrategicAxis, "id" | "owner">[];
  },
  user: AuthUser | null | undefined,
  approvals?: Pick<StrategicApproval, "kind" | "status" | "targetId">[]
) {
  void data;
  void user;
  void approvals;
  return { queue: EMPTY_MILESTONE_QUEUE, count: 0 };
}
