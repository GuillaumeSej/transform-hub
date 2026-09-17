"use client";

import { useMemo } from "react";
import { isLeverSponsoredBy } from "@/lib/leversLogic";
import { hasRole, isAnyAdmin } from "@/lib/roleProfiles";
import type { AuthUser, BeTrackData, Lever } from "@/types";

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
 * modifié. Modèle à approbateur UNIQUE (voir lib/leversLogic.ts::approveLeverGate) : un levier
 * avec une demande en cours apparaît pour le sponsor du workstream OU le CTO habilité, peu
 * importe la porte concernée (M1→M2/M2→M3/M3→M4) — et pour tout admin (global ou entreprise),
 * habilité sur n'importe quelle demande comme `approveLeverGate`/`rejectLeverApproval`.
 */
export function resolveApprovalQueue(
  data: Pick<BeTrackData, "levers" | "workstreams">,
  user: AuthUser | null | undefined
): Lever[] {
  if (!user) return [];
  if (isAnyAdmin(user)) return data.levers.filter((lever) => !!lever.approval);
  return data.levers.filter((lever) => {
    if (!lever.approval) return false;
    const workstreamSponsorUsername = data.workstreams.find(
      (w) => w.id === lever.ws
    )?.sponsorUsername;
    return isLeverSponsoredBy(lever, workstreamSponsorUsername, user) || isCtoForLever(user, lever);
  });
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
