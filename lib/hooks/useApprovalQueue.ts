"use client";

import { useMemo } from "react";
import { isLeverSponsoredBy } from "@/lib/leversLogic";
import { hasRole } from "@/lib/roleProfiles";
import type { AuthUser, BeTrackData, Lever } from "@/types";

/**
 * Types de la cascade de validation ("owner" -> "sponsor" -> "cto"). Dupliqués ici plutôt
 * qu'importés de `types/index.ts` : au moment où ce fichier a été écrit, la fondation de types
 * de la cascade (branche parallèle d'un autre agent) n'était pas encore mergée sur cette worktree
 * — `types/index.ts` est en lecture seule pour cet agent (voir consignes de la tâche). Cette
 * définition doit rester STRICTEMENT identique à celle qui sera mergée dans `types/index.ts`
 * (`LeverApprovalStep`/`LeverApproval`, `Lever.approval?: LeverApproval`) pour que `LeverWithApproval`
 * ci-dessous coïncide avec le vrai type une fois la fusion faite.
 */
export type LeverApprovalStep = "owner" | "sponsor" | "cto";
export type LeverApproval = {
  pendingStep: LeverApprovalStep;
  ownerApprovedAt?: string;
  sponsorApprovedAt?: string;
  ctoApprovedAt?: string;
  requestedBy: string;
  requestedAt: string;
};
/** `Lever` enrichi du champ `approval` (pas encore présent sur `Lever` dans cette worktree —
 *  voir le commentaire ci-dessus). */
export type LeverWithApproval = Lever & { approval?: LeverApproval };

/** L'utilisateur a-t-il le rôle "cto" sur le programme de ce levier ? Fonction LOCALE à ce
 *  fichier (ne pas la déplacer dans `lib/leversLogic.ts`, réservé à l'autre agent qui implémente
 *  la logique métier de la cascade) : un profil "cto" sans `programId` couvre tous les
 *  programmes, un profil scopé à un programme ne couvre que celui-ci — même convention que
 *  `getAuthorizedPrograms` dans `lib/roleProfiles.ts`. */
function isCtoForLever(
  user: Pick<AuthUser, "profiles"> | null | undefined,
  lever: Pick<Lever, "programId">
): boolean {
  return (
    hasRole(user, "cto") &&
    !!user?.profiles?.some(
      (p) => p.role === "cto" && (!p.programId || p.programId === lever.programId)
    )
  );
}

/**
 * Résolution PURE de la file d'attente de validation, extraite du hook pour être testable sans
 * rendu React (voir lib/hooks/useApprovalQueue.test.ts). Même mécanique que `canUserViewLever`
 * (lib/leversLogic.ts) pour la résolution du sponsor de workstream : lu pour s'en inspirer, non
 * modifié.
 */
export function resolveApprovalQueue(
  data: Pick<BeTrackData, "levers" | "workstreams">,
  user: AuthUser | null | undefined
): LeverWithApproval[] {
  if (!user) return [];
  const levers = data.levers as LeverWithApproval[];
  return levers.filter((lever) => {
    const approval = lever.approval;
    if (!approval) return false;
    if (approval.pendingStep === "sponsor") {
      const workstreamSponsorUsername = data.workstreams.find(
        (w) => w.id === lever.ws
      )?.sponsorUsername;
      return isLeverSponsoredBy(lever, workstreamSponsorUsername, user);
    }
    if (approval.pendingStep === "cto") {
      return isCtoForLever(user, lever);
    }
    return false;
  });
}

/**
 * Sur le modèle exact de `useNotifications` (lib/hooks/useNotifications.ts) : résout la file des
 * leviers dont la validation en cascade (owner -> sponsor -> cto, voir `lib/leversLogic.ts` de
 * l'autre agent pour la logique métier) attend actuellement CET utilisateur — pour alimenter un
 * badge/dropdown de notifications ("mes leviers à valider").
 */
export function useApprovalQueue(data: BeTrackData, user: AuthUser | null | undefined) {
  const queue = useMemo(() => resolveApprovalQueue(data, user), [data, user]);

  return {
    queue,
    count: queue.length,
  };
}
